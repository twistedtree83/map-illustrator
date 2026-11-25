import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import { simplify, chaikin, ringArea, wobble, toPath } from "./geometry.js";
import { PALETTES } from "./palettes.js";
import { iconDefs, iconId, iconSVG, ICON_KINDS, KIND_LABELS, RANK } from "./icons.js";
import { buildKit } from "./kit/export-kit.js";
import { formatAddress, formatLine } from "../scripts/addresses.mjs";
import { DOODLES, northArrow, grainPattern } from "./decor.js";
import { playReveal, popSprites, fadeIn } from "./reveal.js";
import { initBuilder } from "./builder.js";

const W = 1600;
const H = 1000;
const NS = "http://www.w3.org/2000/svg";
const FONT = "Nunito, system-ui, sans-serif";
// Display name: your override, else English (or local, per the Labels setting).
function nameOf(obj, id) {
  if (id && state.names[id]) return state.names[id];
  if (!obj) return "";
  return state.params.lang === "local" ? obj.local || obj.name : obj.name || obj.local || "";
}
const riverKey = (r) => `river:${r.local || r.name}`;

const DISPLAY = "'Bricolage Grotesque', 'Avenir Next', system-ui, sans-serif";

const DEFAULT_PARAMS = {
  level: null, // topology object key, e.g. "level10"
  simplify: 1.5,
  smooth: 2,
  minArea: 400,
  border: 1.8,
  soften: 28,
  wobble: 0,
  flowSpeed: 2,
  decorDensity: 1,
  showRoads: true,
  showGreen: true,
  showLabels: true,
  showDecor: false,
  showRipples: true,
  labelMode: "legend",
  palette: "meadow",
  showIcons: true,
  grain: true,
  lang: "en",
  autoplay: true,
  introSpeed: 1,
};

const state = {
  area: null,
  data: null,
  projection: null,
  params: { ...DEFAULT_PARAMS },
  title: "",
  subtitle: "",
  names: {}, // district id -> renamed label
  selected: new Set(),
  pois: [], // {id, name, kind, coord:[lon,lat], source}
  focus: null, // district id currently zoomed into
  placing: false,
  zoomK: 1,
};

const svg = d3.select("#map");
const $ = (id) => document.getElementById(id);
let zoom; // d3 zoom behaviour, set in initControls
let districtEls = new Map(); // id -> {path, feature, d}

// ---------------------------------------------------------------- persistence

const storeKey = () => `mapinteractive:v2:${state.area}`;
function save() {
  try { localStorage.setItem(storeKey(), JSON.stringify(projectJSON())); } catch {}
}
function projectJSON() {
  return { version: 2, area: state.area, params: state.params, title: state.title, subtitle: state.subtitle, names: state.names, selected: [...state.selected], pois: state.pois };
}
function applyProject(p) {
  state.params = { ...DEFAULT_PARAMS, ...(p.params || {}) };
  if (!state.data.topology.objects[state.params.level]) {
    // Default to the level with the most districts that's still readable.
    // Prefer official districts, then Overture neighbourhoods; micro-neighbourhoods
    // (often just squares) only as a last resort. Within a tier, most areas wins.
    const tier = (l) => (l.key === "ov-microhood" ? 3 : l.key === "regions" ? 2 : l.source === "overture" ? 1 : 0);
    const lv = [...state.data.levels].filter((l) => l.count <= 120).sort((a, b) => tier(a) - tier(b) || b.count - a.count)[0] || state.data.levels[0];
    state.params.level = lv?.key || null;
  }
  state.title = p.title ?? state.data.title;
  state.subtitle = p.subtitle ?? "";
  state.names = p.names || {};
  state.selected = new Set(p.selected || []);
  state.pois = p.pois || [];
}

// ---------------------------------------------------------------- loading

async function loadArea(name) {
  state.area = name;
  state.focus = null;
  $("map-status").textContent = "Loading map data…";
  state.data = await (await fetch(`data/${name}.json`)).json();
  cleanLandmarks(state.data);
  $("map-status").textContent = "";
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(storeKey()) || "null"); } catch {}
  applyProject(saved || {});

  // Fit the city outline into the canvas, leaving paper around it.
  const pts = [];
  const walk = (c) => (typeof c[0] === "number" ? pts.push(c) : c.forEach(walk));
  walk(state.data.topology.arcs);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const corners = { type: "MultiPoint", coordinates: [[d3.min(xs), d3.min(ys)], [d3.max(xs), d3.max(ys)]] };
  state.corners = corners;
  fitProjection();

  svg.attr("viewBox", `0 0 ${W} ${H}`);
  svg.call(zoom.transform, d3.zoomIdentity);
  syncControls();
  render();
  renderLandmarkList();
  renderLabels();
  if (state.params.autoplay) replayIntro();
}

// Tidy the landmark list from OSM/Overture: fix common mis-typing, drop entries
// that are really places (suburbs, regions, counties) and near-duplicates.
function cleanLandmarks(data) {
  const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const placeNames = new Set();
  for (const o of Object.values(data.topology.objects)) for (const g of o.geometries || []) {
    for (const n of [g.properties?.name, g.properties?.local]) if (n) placeNames.add(norm(n).replace(/^(city of|municipality of) /, ""));
  }
  for (const r of data.regions || []) placeNames.add(norm(r).replace(/ (city council|council|shire)$/, ""));
  const regionWords = [...placeNames].filter((n) => n.split(" ").length <= 3);
  const isPlaceName = (name) => {
    const base = norm(name.replace(/\s*\([^)]*\)\s*$/, "").replace(/,.*$/, ""));
    if (placeNames.has(base)) return true;
    // "Blackheath Blue Mountains" = a place name followed by a region name.
    return regionWords.some((a) => base.startsWith(a + " ") && placeNames.has(base.slice(a.length + 1)));
  };
  const seen = [];
  data.landmarks = data.landmarks.filter((lm) => {
    // OSM often tags palaces and manor houses as castles.
    if (lm.kind === "castle" && /pal[aá]c|palace|palais|palazzo|manor|zámek|schloss/i.test(lm.name) && !/castle|hrad\b|burg/i.test(lm.name)) lm.kind = "palace";
    if (/\b(look-?out|viewpoint|overlook|scenic view)\b/i.test(lm.name) && lm.kind !== "tower") lm.kind = "viewpoint";
    if (isPlaceName(lm.name) || /\b(county|parish|locality)\b/i.test(lm.name)) return false;
    const key = norm(lm.name);
    const dup = seen.find((s) => s.key === key && Math.hypot(s.c[0] - lm.coord[0], s.c[1] - lm.coord[1]) < 0.01);
    if (dup) return false;
    seen.push({ key, c: lm.coord });
    return true;
  });
}

// Leave room for the header band, and for the legend panel when it's shown.
function fitProjection() {
  const legend = state.params.labelMode === "legend" && state.params.level;
  const extent = legend ? [[80, 175], [1170, 950]] : [[120, 175], [W - 120, H - 60]];
  state.projection = d3.geoMercator().fitExtent(extent, state.corners);
}

function replayIntro() {
  if (state.focus) { state.focus = null; $("detail").replaceChildren(); updateFocusUI(); }
  svg.interrupt().call(zoom.transform, d3.zoomIdentity);
  render();
  const b = $("city-outline").getBBox();
  playReveal(svg.node(), [b.x + b.width / 2, b.y + b.height / 2], state.params.introSpeed);
}

// ---------------------------------------------------------------- geometry

const project = (c) => state.projection(c);

// Topology arcs are shared by neighbouring districts. Simplifying and
// smoothing each arc once (endpoints fixed) keeps borders seamless.
function buildArcs(p) {
  return state.data.topology.arcs.map((arc, i) => {
    let pts = simplify(arc.map(project), p.simplify);
    pts = chaikin(pts, p.smooth, false);
    if (p.wobble) pts = [pts[0], ...wobble(pts.slice(1, -1), p.wobble, i), pts[pts.length - 1]];
    return pts;
  });
}

function ringFromArcs(arcs, idxs) {
  const ring = [];
  for (const i of idxs) {
    const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    ring.push(...(ring.length ? a.slice(1) : a));
  }
  return ring;
}

function geometryPath(arcs, geom) {
  const polysArcs = geom.type === "Polygon" ? [geom.arcs] : geom.type === "MultiPolygon" ? geom.arcs : [];
  let d = "";
  for (const poly of polysArcs) for (const ringIdx of poly) d += toPath(ringFromArcs(arcs, ringIdx), true);
  return d;
}

function polyPath(polygons, p, seed) {
  let d = "";
  for (const poly of polygons) {
    for (let r = 0; r < poly.length; r++) {
      let pts = simplify(poly[r].map(project), p.simplify);
      if (pts.length < 3) continue;
      if (ringArea(pts) < (r === 0 ? p.minArea : p.minArea * 0.5)) {
        if (r === 0) break;
        continue;
      }
      pts = wobble(chaikin(pts, p.smooth + 1, true), p.wobble, seed + r);
      d += toPath(pts, true);
    }
  }
  return d;
}

function linePath(lines, p, tol = 1) {
  return lines
    .map((line) => toPath(wobble(chaikin(simplify(line.map(project), p.simplify * tol), Math.min(p.smooth, 3), false), p.wobble * 0.4), false))
    .join("");
}

// Union of the regions, then a morphological close (grow, shrink) to fill
// notches and an open (shrink, grow) to round corners. Uses Clipper.
function softSilhouette(arcs, geoms, r) {
  const C = window.ClipperLib;
  if (!C) return null;
  const S = 100; // Clipper works in integers
  let paths = [];
  for (const g of geoms) {
    const polysArcs = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
    for (const poly of polysArcs) for (const ringIdx of poly) {
      paths.push(ringFromArcs(arcs, ringIdx).map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })));
    }
  }
  const union = new C.Clipper();
  union.AddPaths(paths, C.PolyType.ptSubject, true);
  const merged = new C.Paths();
  union.Execute(C.ClipType.ctUnion, merged, C.PolyFillType.pftEvenOdd, C.PolyFillType.pftEvenOdd);
  const offset = (ps, d) => {
    const co = new C.ClipperOffset(2, 0.2 * S);
    co.AddPaths(ps, C.JoinType.jtRound, C.EndType.etClosedPolygon);
    const out = new C.Paths();
    co.Execute(out, d * S);
    return out;
  };
  paths = merged;
  if (r > 0) {
    // Generous close fills the notch where regions meet with a smooth fillet;
    // a gentle open only rounds sharp outer corners (so narrow necks survive).
    const close = r * 2.5, open = Math.min(r * 0.25, 5);
    paths = offset(offset(paths, close), -close);
    paths = offset(offset(paths, -open), open);
  }
  return paths
    .filter((ps) => Math.abs(C.Clipper.Area(ps)) > 4 * S * S)
    .map((ps) => toPath(chaikin(simplify(ps.map((q) => [q.X / S, q.Y / S]), 0.4), 1, true), true))
    .join("");
}

// Outer edge vs shared borders of a set of polygons in the topology.
function splitArcs(arcs, geoms) {
  const count = new Map();
  const walk = (a) => (typeof a === "number" ? count.set(a < 0 ? ~a : a, (count.get(a < 0 ? ~a : a) || 0) + 1) : a.forEach(walk));
  geoms.forEach((g) => walk(g.arcs || []));
  let outer = "", inner = "";
  for (const [i, n] of count) {
    const d = toPath(arcs[i], false);
    if (n === 1) outer += d; else inner += d;
  }
  return { outer, inner };
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------------------------------------------------------------- render

function el(parent, tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  parent.appendChild(n);
  return n;
}

// Elements that should keep their on-screen size while zooming.
function fixedSize(parent, x, y, cls = "") {
  const g = el(parent, "g", { class: `fx ${cls}`, "data-x": x.toFixed(1), "data-y": y.toFixed(1) });
  g.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${(1 / state.zoomK).toFixed(4)})`);
  return g;
}

function render() {
  const p = state.params;
  const pal = PALETTES[p.palette];
  const topo = state.data.topology;
  const root = svg.node();
  root.replaceChildren();
  root.style.background = pal.bg;
  districtEls = new Map();
  fitProjection();

  const arcs = buildArcs(p);
  // With several regions: outer edge = arcs used once; region borders = arcs shared.
  const { outer: arcOutlineD, inner: regionBordersD } = splitArcs(arcs, topo.objects.city.geometries);
  // Merge regions into one silhouette and round it (fills tight notches where
  // regions meet). Falls back to the raw arcs if the geometry library is missing.
  const softD = softSilhouette(arcs, topo.objects.city.geometries, p.soften);
  const cityD = softD || topo.objects.city.geometries.map((g) => geometryPath(arcs, g)).join("");
  const outlineD = softD || arcOutlineD;

  const defs = el(root, "defs");
  defs.innerHTML =
    `<clipPath id="city-clip"><path d="${cityD}"/></clipPath>` + grainPattern(pal) + iconDefs(pal) +
    `<pattern id="wave-lines" width="26" height="12" patternUnits="userSpaceOnUse"><path d="M0 6q6.5-5 13 0t13 0" fill="none" stroke="${pal.flow}" stroke-width="1.2" opacity="0.7"/></pattern>` +
    `<pattern id="sel-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)"><path d="M0 0V8" stroke="${pal.ink}" stroke-width="2" opacity="0.28"/></pattern>` +
    `<pattern id="stipple"width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="3" cy="3" r="1.1" fill="${pal.ink}" opacity="0.16"/><circle cx="9" cy="9" r="1.1" fill="${pal.ink}" opacity="0.16"/></pattern>` +
    `<pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V7" stroke="${pal.ink}" stroke-width="1" opacity="0.12"/></pattern>`;
  el(root, "style").textContent =
    `.flow{stroke-dasharray:4 16;animation:flow ${(4 / Math.max(p.flowSpeed, 0.1)).toFixed(2)}s linear infinite}` +
    `@keyframes flow{to{stroke-dashoffset:-20}}` +
    `.district{transition:opacity .5s,fill .2s}.dim{opacity:.28}.fade{transition:opacity .5s}`;

  el(root, "rect", { id: "paper", width: W, height: H, fill: pal.bg });
  const viewport = el(root, "g", { id: "viewport" });

  // Paper doodles, compass and title live outside the zoomable city.
  const gDecor = el(viewport, "g", { id: "decor", "pointer-events": "none", class: "fade" });

  // Contour ripples spreading out from the city edge (drawn as nested strokes).
  if (p.showRipples) {
    const gR = el(viewport, "g", { id: "ripples", "pointer-events": "none", class: "fade" });
    for (let i = 6; i >= 1; i--) {
      const r = i * 16;
      const ring = el(gR, "g", { "data-ring": i });
      el(ring, "path", { d: cityD, fill: "none", stroke: i % 2 ? pal.accent2 : pal.decor, "stroke-width": 2 * r + 1.6, "stroke-linejoin": "round", opacity: (0.62 - i * 0.07).toFixed(2) });
      el(ring, "path", { d: cityD, fill: "none", stroke: pal.bg, "stroke-width": 2 * r, "stroke-linejoin": "round" });
    }
  }

  // Raised slab: stacked copies give the city a solid, extruded edge.
  const gSlab = el(viewport, "g", { id: "city-slab", "pointer-events": "none" });
  el(gSlab, "path", { d: cityD, fill: pal.ink, opacity: 0.14, transform: "translate(7,18)", "fill-rule": "evenodd" });
  for (let j = 10; j >= 1; j--) el(gSlab, "path", { d: cityD, fill: pal.slab, transform: `translate(0,${j})`, "fill-rule": "evenodd" });
  el(gSlab, "path", { d: cityD, fill: "url(#hatch)", transform: "translate(0,10)", "fill-rule": "evenodd" });

  const gCity = el(viewport, "g", { id: "city" });

  // Districts
  // Base fill so any district missing from OSM never shows a hole.
  el(gCity, "path", { id: "city-base", d: cityD, fill: pal.land[0], "fill-rule": "evenodd", "pointer-events": "none" });
  const gDistricts = el(gCity, "g", { id: "districts", "clip-path": "url(#city-clip)" });
  const level = p.level && topo.objects[p.level];
  if (level) {
    const colour = patchworkColours(level.geometries, pal.land.length);
    for (const g of level.geometries) {
      const d = geometryPath(arcs, g);
      if (!d) continue;
      const sel = state.selected.has(g.id);
      const path = el(gDistricts, "path", {
        d,
        fill: sel ? pal.selected : pal.land[colour.get(g.id)],
        "data-fill": pal.land[colour.get(g.id)],
        "fill-rule": "evenodd",
        class: "district",
        "data-id": g.id,
      });
      path.addEventListener("mouseenter", (ev) => showHover(g.id, ev));
      path.addEventListener("mousemove", moveTip);
      path.addEventListener("mouseleave", hideHover);
      path.addEventListener("click", (ev) => {
        if (state.placing) return;
        ev.stopPropagation();
        if (ev.shiftKey) toggleSelected(g.id);
        else if (state.focus === g.id) unfocus();
        else focusDistrict(g.id);
      });
      districtEls.set(g.id, { path, feature: g, d });
    }
  } else {
    el(gDistricts, "path", { d: cityD, fill: pal.land[0], "fill-rule": "evenodd" });
  }

  // Everything else is clipped to the city outline.
  const gInside = el(gCity, "g", { id: "inside", "clip-path": "url(#city-clip)", "pointer-events": "none" });

  if (p.showGreen) {
    const gGreen = el(gInside, "g", { id: "green" });
    for (const kind of ["park", "cemetery", "forest"]) {
      const d = state.data.green.filter((g) => g.kind === kind).map((g, i) => polyPath(g.coords, p, i)).join("");
      if (!d) continue;
      el(gGreen, "path", { d, fill: kind === "forest" ? pal.forest : pal.green, "fill-rule": "evenodd", opacity: 0.85 });
      if (kind !== "park") el(gGreen, "path", { d, fill: "url(#stipple)", "fill-rule": "evenodd" });
    }
  }

  const gWater = el(gInside, "g", { id: "water" });
  const waterD = state.data.water.map((w, i) => polyPath(w.coords, { ...p, minArea: p.minArea * 0.3 }, i)).join("");
  el(gWater, "path", { d: waterD, fill: pal.water, stroke: pal.water, "stroke-width": 2, "stroke-linejoin": "round" });
  const riverD = { river: "", canal: "" };
  for (const r of state.data.rivers) riverD[r.type] += linePath(r.coords, p);
  el(gWater, "path", { d: riverD.river, fill: "none", stroke: pal.water, "stroke-width": 6, "stroke-linecap": "round", "stroke-linejoin": "round" });
  el(gWater, "path", { d: riverD.canal, fill: "none", stroke: pal.water, "stroke-width": 3, "stroke-linecap": "round" });
  el(gInside, "path", { id: "water-texture", d: waterD, fill: "url(#wave-lines)" });
  if (p.flowSpeed > 0) {
    el(gInside, "path", { id: "river-flow", class: "flow", d: riverD.river + riverD.canal, fill: "none", stroke: pal.flow, "stroke-width": 1.4, "stroke-linecap": "round", opacity: 0.9, "vector-effect": "non-scaling-stroke" });
  }

  if (p.showRoads) {
    const gRoads = el(gInside, "g", { id: "roads" });
    const widths = { motorway: 2.2, trunk: 1.9, primary: 1.5 };
    for (const type of ["primary", "trunk", "motorway"]) {
      const d = state.data.roads.filter((r) => r.type === type).map((r) => linePath(r.coords, p, 2)).join("");
      if (d) el(gRoads, "path", { d, fill: "none", stroke: pal.road, "stroke-width": widths[type], "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" });
    }
  }

  // District borders on top of the fills, then the city outline.
  if (level) {
    el(gCity, "path", {
      // Only borders shared by two areas, so softened notches stay clean. Sources
      // without shared edges (e.g. Overture polygons) fall back to full outlines.
      id: "district-borders", "clip-path": "url(#city-clip)",
      d: splitArcs(arcs, level.geometries).inner || [...districtEls.values()].map((x) => x.d).join(""), fill: "none", stroke: pal.border,
      "stroke-width": p.border, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none",
    });
  }
  if (regionBordersD) {
    el(gCity, "path", { id: "region-borders", d: regionBordersD, fill: "none", stroke: pal.outline, "stroke-width": p.border * 1.1, "stroke-dasharray": "7 5", "stroke-linecap": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none" });
  }
  el(gCity, "path", { id: "city-outline", d: outlineD, fill: "none", stroke: pal.outline, "stroke-width": p.border * 1.3, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none" });

  // Selected areas: hatched, with a bold outline.
  const selD = [...state.selected].map((id) => districtEls.get(id)?.d || "").join("");
  if (selD) {
    const gSel = el(gCity, "g", { id: "selection", "pointer-events": "none", "clip-path": "url(#city-clip)" });
    el(gSel, "path", { d: selD, fill: "url(#sel-hatch)", "fill-rule": "evenodd" });
    el(gSel, "path", { d: selD, fill: "none", stroke: pal.ink, "stroke-width": 2.2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" });
  }
  // Hover outline (filled in by showHover)
  el(gCity, "path", { id: "hover-outline", "clip-path": "url(#city-clip)", d: "", fill: pal.wall, "fill-opacity": 0.18, stroke: pal.ink, "stroke-width": 2.4, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke", "pointer-events": "none" });

  // River names set along the water.
  if (p.showLabels) drawRiverLabels(el(viewport, "g", { id: "river-labels", "pointer-events": "none", class: "fade" }), pal);

  // Detail layer (only while zoomed into a district)
  el(viewport, "g", { id: "detail", "pointer-events": "none" });

  // One headline landmark per district, so the overview reads as illustrated.
  const gIcons = el(viewport, "g", { id: "landmark-icons-overview", "pointer-events": "none", class: "fade" });
  const iconPicks = p.showIcons && level ? drawOverviewIcons(gIcons) : [];

  // Labels: numbered badges (with legend) or names
  const gLabels = el(viewport, "g", { id: "district-labels", "pointer-events": "none", class: "fade" });
  const numbers = level ? districtNumbers(level.geometries) : new Map();
  for (const [id, n] of numbers) if (districtEls.has(id)) districtEls.get(id).num = n;
  if (p.showLabels && level) {
    for (const g of level.geometries) {
      let [x, y] = project(g.properties.label);
      // Nudge the badge off any landmark icon sitting on the same spot.
      for (const ic of iconPicks) {
        const dx = x - ic.x, dy = y - (ic.y - 6), dd = Math.hypot(dx, dy);
        if (dd < 30) { const s = (30 - dd) / Math.max(dd, 0.01); x += dx * s || 30; y += dy * s; }
      }
      const fx = fixedSize(gLabels, x, y);
      if (p.labelMode === "legend") {
        el(fx, "circle", { r: 10.5, fill: pal.wall, stroke: pal.ink, "stroke-width": 1.4 });
        el(fx, "text", { "text-anchor": "middle", "dominant-baseline": "central", fill: pal.ink, "font-family": DISPLAY, "font-size": 10.5, "font-weight": 800 }).textContent = numbers.get(g.id);
      } else {
        el(fx, "text", {
          "text-anchor": "middle", "dominant-baseline": "middle", fill: pal.text, "font-family": FONT, "font-size": 10.5,
          "font-weight": 800, "letter-spacing": 0.8, stroke: pal.border, "stroke-width": 3, "paint-order": "stroke", "stroke-linejoin": "round",
        }).textContent = nameOf(g.properties, g.id).toUpperCase();
      }
    }
  }

  // User points of interest
  const gPois = el(viewport, "g", { id: "pois" });
  for (const poi of state.pois) drawPoi(gPois, poi, pal);

  // Paper grain sits over everything for a printed feel.
  if (p.grain) el(root, "rect", { id: "paper-grain", width: W, height: H, fill: "url(#grain)", "pointer-events": "none" });

  // Header band, frame, legend: on the paper, outside the zoomable viewport.
  const gFrame = el(root, "g", { id: "frame", "pointer-events": "none", class: "fade" });
  el(gFrame, "rect", { x: 16, y: 16, width: W - 32, height: H - 32, rx: 14, fill: "none", stroke: pal.text, "stroke-width": 1.6, opacity: 0.6 });
  const [clon, clat] = state.projection.invert([W / 2, H / 2]);
  const coords = `${Math.abs(clat).toFixed(2)}°${clat >= 0 ? "N" : "S"}  ${Math.abs(clon).toFixed(2)}°${clon >= 0 ? "E" : "W"}`;
  const meta = [state.subtitle, level ? `${level.geometries.length} areas` : "", coords].filter(Boolean).join("  ·  ").toUpperCase();
  el(gFrame, "g", { id: "title", transform: "translate(56,58)" }).innerHTML = `<g class="r-in">${header(pal, state.title || "", meta)}</g>`;
  const legendOn = p.labelMode === "legend" && level && p.showLabels;
  el(gFrame, "g", { id: "north-arrow", transform: `translate(${legendOn ? 1520 : W - 90},${legendOn ? 92 : 92}) scale(0.8)` }).innerHTML = `<g class="r-in">${northArrow(pal)}</g>`;
  if (legendOn) drawLegend(root, level.geometries, numbers, pal);

  if (p.showDecor) placeDoodles(gDecor, pal, cityD);
  const t = d3.zoomTransform(root);
  viewport.setAttribute("transform", t);
  gFrame.style.opacity = t.k > 1.4 ? 0 : 1;
  const lg = $("legend");
  if (lg) lg.style.opacity = t.k > 1.4 ? 0 : 1;
  if (state.focus) {
    gDecor.style.opacity = 0.25;
    $("ripples") && ($("ripples").style.opacity = 0.25);
    gLabels.style.opacity = 0;
    gIcons.style.opacity = 0;
    drawDetail(state.focus);
  }
  renderSelectedList();
  updateFocusUI();
}

// Number districts in reading order (rows top to bottom, left to right).
function districtNumbers(geoms) {
  const pts = geoms.map((g) => ({ id: g.id, xy: project(g.properties.label) }));
  const row = 70;
  pts.sort((a, b) => Math.floor(a.xy[1] / row) - Math.floor(b.xy[1] / row) || a.xy[0] - b.xy[0]);
  return new Map(pts.map((q, i) => [q.id, i + 1]));
}

function header(pal, title, meta) {
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  return `<text x="0" y="40" font-family="${DISPLAY}" font-size="58" font-weight="800" letter-spacing="-1" fill="${pal.text}">${esc(title)}</text>
    <rect x="2" y="56" width="46" height="6" rx="3" fill="${pal.roof}"/><rect x="54" y="56" width="16" height="6" rx="3" fill="${pal.accent}"/><rect x="76" y="56" width="8" height="6" rx="3" fill="${pal.accent2}"/>
    <text x="96" y="62" font-family="${FONT}" font-size="12.5" font-weight="800" letter-spacing="2.4" fill="${pal.decor}">${esc(meta)}</text>`;
}

// Clickable legend panel listing every district by number.
function drawLegend(root, geoms, numbers, pal) {
  const x0 = 1210, y0 = 150, w = 350, h = 805;
  const g = el(root, "g", { id: "legend", class: "fade" });
  el(g, "rect", { x: x0 + 4, y: y0 + 6, width: w, height: h, rx: 14, fill: pal.ink, opacity: 0.12 });
  el(g, "rect", { x: x0, y: y0, width: w, height: h, rx: 14, fill: pal.wall, stroke: pal.ink, "stroke-width": 1.4 });
  el(g, "text", { x: x0 + 22, y: y0 + 36, "font-family": DISPLAY, "font-size": 18, "font-weight": 800, fill: pal.ink }).textContent = "Districts";
  el(g, "text", { x: x0 + w - 22, y: y0 + 36, "text-anchor": "end", "font-family": FONT, "font-size": 11, "font-weight": 700, fill: pal.decor }).textContent = "click to explore";
  el(g, "path", { d: `M${x0 + 18},${y0 + 52}H${x0 + w - 18}`, stroke: pal.ink, "stroke-width": 1, opacity: 0.25 });
  const list = [...geoms].sort((a, b) => numbers.get(a.id) - numbers.get(b.id));
  const cols = list.length > 28 ? 2 : 1;
  const perCol = Math.ceil(list.length / cols);
  const kinds = (state.overviewKinds || []).slice(0, 6);
  const keyH = kinds.length ? 96 : 0;
  const lineH = Math.min(26, (h - 84 - keyH) / perCol);
  const colW = (w - 36) / cols;
  list.forEach((d, i) => {
    const cx = x0 + 18 + Math.floor(i / perCol) * colW, cy = y0 + 72 + (i % perCol) * lineH;
    const e = el(g, "g", { class: "entry", transform: `translate(${cx},${cy})`, "data-id": d.id });
    const info = districtEls.get(d.id);
    el(e, "rect", { x: -4, y: -lineH / 2, width: colW - 4, height: lineH, rx: 6, fill: "transparent", class: "hit" });
    el(e, "circle", { cx: 8, r: 8.5, fill: state.selected.has(d.id) ? pal.selected : info?.path.dataset.fill || pal.land[0], stroke: pal.ink, "stroke-width": 1.2 });
    el(e, "text", { x: 8, "text-anchor": "middle", "dominant-baseline": "central", "font-family": DISPLAY, "font-size": 9, "font-weight": 800, fill: pal.ink }).textContent = numbers.get(d.id);
    const name = nameOf(d.properties, d.id).replace(/^Praha-/, "");
    el(e, "text", { x: 23, "dominant-baseline": "central", "font-family": FONT, "font-size": 11.5, "font-weight": 700, fill: pal.text }).textContent = name.length > 17 ? name.slice(0, 16) + "…" : name;
    e.addEventListener("click", () => focusDistrict(d.id));
    e.addEventListener("mouseenter", () => info && $("hover-outline")?.setAttribute("d", info.d));
    e.addEventListener("mouseleave", () => $("hover-outline")?.setAttribute("d", ""));
  });

  // Icon key: the landmark types shown on the overview.
  if (kinds.length) {
    const ky = y0 + h - keyH;
    el(g, "path", { d: `M${x0 + 18},${ky}H${x0 + w - 18}`, stroke: pal.ink, "stroke-width": 1, opacity: 0.25 });
    el(g, "text", { x: x0 + 22, y: ky + 22, "font-family": FONT, "font-size": 10.5, "font-weight": 800, "letter-spacing": 2, fill: pal.decor }).textContent = "LANDMARKS";
    const step = (w - 36) / kinds.length;
    kinds.forEach((k, i) => {
      const cx = x0 + 18 + step * (i + 0.5);
      const kg = el(g, "g", { class: "key", transform: `translate(${cx},${ky + 64})` });
      el(kg, "use", { href: `#${iconId(k)}`, x: -17, y: -34, width: 34, height: 34 });
      el(kg, "text", { y: 16, "text-anchor": "middle", "font-family": FONT, "font-size": 10, "font-weight": 700, fill: pal.text }).textContent = KIND_LABELS[k] || k;
    });
  }
}

// Scatter doodles on the paper, avoiding the city, the title and the compass.
function placeDoodles(parent, pal, cityD) {
  const probe = el(parent, "path", { d: cityD, fill: "none" });
  const rnd = seeded(42);
  const kinds = ["hills", "hills", "cloud", "cloud", "cloud", "birds", "birds", "waves", "sparkle"];
  const specials = { 2: "balloon", 5: "kite", 8: "sun" };
  const placed = [];
  const blocked = (x, y) =>
    y < 150 || (state.params.labelMode === "legend" && x > 1180) ||
    placed.some(([px, py]) => Math.hypot(px - x, py - y) < 110) ||
    [[0, 0], [40, 0], [-40, 0], [0, 30], [0, -30], [60, 40], [-60, -40]].some(([dx, dy]) => probe.isPointInFill(new DOMPoint(x + dx, y + dy)));
  const target = Math.round(18 * state.params.decorDensity);
  for (let tries = 0; placed.length < target && tries < 600; tries++) {
    const x = 60 + rnd() * (W - 120), y = 60 + rnd() * (H - 120);
    if (blocked(x, y)) continue;
    placed.push([x, y]);
    const kind = specials[placed.length] || kinds[Math.floor(rnd() * kinds.length)];
    const g = el(parent, "g", { transform: `translate(${x.toFixed(0)},${y.toFixed(0)}) scale(${(0.9 + rnd() * 0.6).toFixed(2)})` });
    g.innerHTML = `<g class="r-in">${DOODLES[kind](pal)}</g>`;
  }
  probe.remove();
}

// Place an illustrated icon so its ground line sits on the point.
function iconAt(parent, kind, x, y, size, title) {
  const fx = fixedSize(parent, x, y);
  el(fx, "use", { href: `#${iconId(kind)}`, x: -size / 2, y: -size * 0.92, width: size, height: size });
  if (title) el(fx, "title").textContent = title;
  return fx;
}

function drawPoi(parent, poi, pal) {
  const [x, y] = project(poi.coord);
  const g = fixedSize(parent, x, y, "poi");
  g.id = `poi-${poi.id}`;
  el(g, "ellipse", { cx: 0, cy: 1, rx: 8, ry: 2.6, fill: pal.ink, opacity: 0.2 });
  el(g, "path", { d: "M0,0 L-7,-12 A22,22 0 1 1 7,-12 Z", fill: pal.wall, stroke: pal.ink, "stroke-width": 1.6, "stroke-linejoin": "round" });
  el(g, "circle", { cx: 0, cy: -30, r: 17, fill: "none", stroke: pal.accent, "stroke-width": 2.5 });
  el(g, "use", { href: `#${iconId(poi.kind)}`, x: -15, y: -46, width: 30, height: 30 });
  el(g, "text", {
    y: 16, "text-anchor": "middle", fill: pal.text, "font-family": FONT, "font-size": 12.5, "font-weight": 800,
    stroke: pal.bg, "stroke-width": 4, "paint-order": "stroke", "stroke-linejoin": "round",
  }).textContent = poi.name;

  d3.select(g).call(
    d3.drag()
      .container(() => $("viewport"))
      .on("start", (ev) => ev.sourceEvent.stopPropagation())
      .on("drag", (ev) => {
        g.dataset.x = ev.x; g.dataset.y = ev.y;
        g.setAttribute("transform", `translate(${ev.x.toFixed(1)},${ev.y.toFixed(1)}) scale(${(1 / state.zoomK).toFixed(4)})`);
        poi.coord = state.projection.invert([ev.x, ev.y]).map((v) => Math.round(v * 1e6) / 1e6);
      })
      .on("end", () => { save(); if (poi.source === "custom") lookupAddress(poi); })
  );
}

// Greedy colouring over shared borders so neighbouring districts never match.
function patchworkColours(geoms, k) {
  const arcOwners = new Map();
  const arcsOf = (g) => {
    const out = [];
    const walk = (a) => (typeof a === "number" ? out.push(a < 0 ? ~a : a) : a.forEach(walk));
    walk(g.arcs || []);
    return out;
  };
  for (const g of geoms) for (const a of arcsOf(g)) {
    if (!arcOwners.has(a)) arcOwners.set(a, []);
    arcOwners.get(a).push(g.id);
  }
  const colour = new Map();
  const order = [...geoms].sort((a, b) => arcsOf(b).length - arcsOf(a).length);
  for (const g of order) {
    const used = new Set();
    for (const a of arcsOf(g)) for (const n of arcOwners.get(a)) if (colour.has(n)) used.add(colour.get(n));
    let c = 0;
    while (used.has(c) && c < k - 1) c++;
    colour.set(g.id, c);
  }
  return colour;
}

// Best-ranked landmark per district, spaced out, as a small illustrated icon.
function drawOverviewIcons(parent) {
  const placedIds = new Set(state.pois.map((q) => q.id));
  const picks = [];
  // Rank by type, then prefer landmarks with a Wikidata entry (a good sign of notability).
  const lms = [...state.data.landmarks].sort((a, b) => (RANK[a.kind] ?? 20) - (RANK[b.kind] ?? 20) || !(a.qid || a.wikidata) - !(b.qid || b.wikidata));
  for (const [id, info] of districtEls) {
    const box = info.path.getBBox();
    for (const lm of lms) {
      if (placedIds.has(lm.id) || (RANK[lm.kind] ?? 20) > 9) continue;
      const [x, y] = project(lm.coord);
      if (x < box.x || x > box.x + box.width || y < box.y || y > box.y + box.height) continue;
      if (!info.path.isPointInFill(new DOMPoint(x, y))) continue;
      if (picks.some((q) => Math.hypot(q.x - x, q.y - y) < 60)) continue;
      picks.push({ x, y, lm, id });
      break;
    }
  }
  picks.sort((a, b) => a.y - b.y).forEach(({ x, y, lm }) => iconAt(parent, lm.kind, x, y + 10, 40, withAddress(lm)));
  state.overviewKinds = [...new Set(picks.map((q) => q.lm.kind))];
  state.overviewPicks = picks;
  return picks;
}

// Chain same-named river segments, then set the name along the longest run.
function drawRiverLabels(parent, pal) {
  const byName = new Map();
  for (const r of state.data.rivers) {
    if (!(r.name || r.local) || r.type !== "river") continue;
    const label = nameOf(r, riverKey(r));
    if (!byName.has(label)) byName.set(label, []);
    byName.get(label).push(...r.coords.map((l) => l.slice()));
  }
  const key = (c) => c[0] + "," + c[1];
  let n = 0;
  for (const [name, segs] of byName) {
    // Greedy chaining by shared endpoints.
    const chains = [];
    const pool = segs.slice();
    while (pool.length) {
      let chain = pool.pop();
      let grew = true;
      while (grew) {
        grew = false;
        for (let i = 0; i < pool.length; i++) {
          const s = pool[i];
          if (key(s[0]) === key(chain[chain.length - 1])) chain = chain.concat(s.slice(1));
          else if (key(s[s.length - 1]) === key(chain[0])) chain = s.concat(chain.slice(1));
          else continue;
          pool.splice(i, 1); grew = true; break;
        }
      }
      chains.push(chain);
    }
    let pts = chains.map((c) => c.map(project)).sort((a, b) => lineLen(b) - lineLen(a))[0];
    if (!pts || lineLen(pts) < 160) continue;
    pts = chaikin(simplify(pts, 8), 3, false);
    if (pts[pts.length - 1][0] < pts[0][0]) pts.reverse(); // keep text upright
    const id = `river-label-${n++}`;
    el(parent, "path", { id, d: toPath(pts, false), fill: "none" });
    const t = el(parent, "text", {
      "font-family": DISPLAY, "font-size": 15, "font-weight": 700, "font-style": "italic", "letter-spacing": 5,
      fill: pal.accent2, stroke: pal.bg, "stroke-width": 3.5, "paint-order": "stroke", "stroke-linejoin": "round", dy: -9,
    });
    const tp = el(t, "textPath", { href: `#${id}`, startOffset: "50%", "text-anchor": "middle" });
    tp.textContent = name;
  }
}

const lineLen = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

// ---------------------------------------------------------------- hover tooltip

function showHover(id, ev) {
  const info = districtEls.get(id);
  if (!info || state.focus) return;
  $("hover-outline")?.setAttribute("d", info.d);
  const tip = $("tip");
  const num = info.num ? `<b class="num">${info.num}</b>` : "";
  tip.innerHTML = `${num}<span><strong>${escHTML(nameOf(info.feature.properties, id))}</strong><small>${landmarksIn(id).length} landmarks · click to explore</small></span>`;
  tip.hidden = false;
  moveTip(ev);
}
function moveTip(ev) {
  const tip = $("tip");
  const r = tip.parentElement.getBoundingClientRect();
  tip.style.left = `${ev.clientX - r.left + 14}px`;
  tip.style.top = `${ev.clientY - r.top + 14}px`;
}
function hideHover() {
  $("hover-outline")?.setAttribute("d", "");
  $("tip").hidden = true;
}
const escHTML = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------------------------------------------------------------- focus (zoom into a district)

function landmarksIn(id) {
  const path = districtEls.get(id)?.path;
  if (!path) return [];
  return state.data.landmarks.filter((lm) => {
    const [x, y] = project(lm.coord);
    return path.isPointInFill(new DOMPoint(x, y));
  });
}

// Paper-coloured veil over everything except the focused district.
function drawMask(id) {
  const info = districtEls.get(id);
  const g = $("detail");
  g.querySelector("#focus-mask")?.remove();
  if (!info) return;
  const pal = PALETTES[state.params.palette];
  const m = el(g, "path", { id: "focus-mask", d: `M-20000,-20000H20000V20000H-20000Z${info.d}`, "fill-rule": "evenodd", fill: pal.bg, opacity: 0.66 });
  g.prepend(m);
}

function drawDetail(id, animate = false) {
  const info = districtEls.get(id);
  const g = $("detail");
  g.replaceChildren();
  if (!info) return;
  const p = state.params;
  const pal = PALETTES[p.palette];
  const k = state.zoomK;
  drawMask(id);
  const defs = svg.node().querySelector("defs");
  defs.querySelector("#focus-clip")?.remove();
  defs.insertAdjacentHTML("beforeend", `<clipPath id="focus-clip"><path d="${info.d}"/></clipPath>`);
  const inside = el(g, "g", { "clip-path": "url(#focus-clip)" });
  const box = info.path.getBBox();
  const pad = 20;
  const inBox = (pts) => pts.some(([x, y]) => x > box.x - pad && x < box.x + box.width + pad && y > box.y - pad && y < box.y + box.height + pad);
  const path = info.path;
  const inDistrict = (x, y) => path.isPointInFill(new DOMPoint(x, y));
  const rnd = seeded([...id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7));
  const taken = []; // [x, y, radius] in map units, shared so nothing overlaps
  const free = (x, y, r) => taken.every(([tx, ty, tr]) => Math.hypot(tx - x, ty - y) > r + tr);

  // Streets: everything down to residential, but only near this district.
  const minor = { secondary: [2, pal.road], tertiary: [1.6, pal.road], residential: [1.1, pal.roadMinor], living_street: [1, pal.roadMinor], pedestrian: [1, pal.roadMinor] };
  const streetLines = [];
  for (const [type, [w, c]] of Object.entries(minor)) {
    const lines = state.data.roads
      .filter((r) => r.type === type)
      .map((r) => r.coords.map((l) => chaikin(simplify(l.map(project), Math.max(0.3, p.simplify / 3)), 1, false)))
      .filter((ls) => ls.some(inBox));
    if (type === "residential" || type === "living_street") streetLines.push(...lines.flat());
    const d = lines.map((ls) => ls.map((l) => toPath(l, false)).join("")).join("");
    if (d) el(inside, "path", { d, fill: "none", stroke: c, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" });
  }

  const sprites = []; // {kind, x, y, size, title} drawn in y order at the end

  // 1. Real landmarks claim space first.
  const placedIds = new Set(state.pois.map((q) => q.id));
  const lms = landmarksIn(id).sort((a, b) => (RANK[a.kind] ?? 20) - (RANK[b.kind] ?? 20));
  let nLm = 0;
  const perKind = {};
  for (const lm of lms) {
    if (placedIds.has(lm.id)) continue;
    if ((perKind[lm.kind] = (perKind[lm.kind] || 0) + 1) > 4) continue; // keep a varied mix
    const [x, y] = project(lm.coord);
    if (!free(x, y, 38 / k)) continue;
    taken.push([x, y, 38 / k]);
    sprites.push({ kind: lm.kind, x, y, size: 62, title: withAddress(lm) });
    if (++nLm >= 24) break;
  }

  // 2. Little house clusters along residential streets.
  let houses = 0;
  const step = 84 / k;
  for (const line of streetLines) {
    if (houses >= 45) break;
    let acc = rnd() * step;
    for (let i = 1; i < line.length && houses < 45; i++) {
      const [ax, ay] = line[i - 1], [bx, by] = line[i];
      const len = Math.hypot(bx - ax, by - ay);
      for (; acc < len; acc += step) {
        const t = acc / len, side = rnd() < 0.5 ? -1 : 1;
        const nx = -(by - ay) / len, ny = (bx - ax) / len;
        const x = ax + (bx - ax) * t + nx * side * (15 / k), y = ay + (by - ay) * t + ny * side * (15 / k);
        if (!inDistrict(x, y) || !free(x, y, 20 / k)) continue;
        taken.push([x, y, 20 / k]);
        sprites.push({ kind: rnd() < 0.35 ? "home" : "houses", x, y, size: 36 });
        houses++;
      }
      acc -= len;
    }
  }

  // 3. Trees over parks and woods.
  const ctx = drawDetail.ctx || (drawDetail.ctx = document.createElement("canvas").getContext("2d"));
  let trees = 0;
  outer: for (const gr of state.data.green) {
    for (const poly of gr.coords) {
      const ring = poly[0].map(project);
      if (!inBox(ring)) continue;
      const n = Math.min(10, Math.floor((ringArea(ring) * k * k) / 1500));
      if (!n) continue;
      const xs = ring.map((q) => q[0]), ys = ring.map((q) => q[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const probe = new Path2D(toPath(ring, true));
      for (let c = 0, t = 0; c < n && t < n * 10; t++) {
        const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
        if (!ctx.isPointInPath(probe, x, y) || !inDistrict(x, y) || !free(x, y, 14 / k)) continue;
        taken.push([x, y, 14 / k]);
        sprites.push({ kind: gr.kind === "forest" || rnd() < 0.3 ? "pine" : "tree", x, y, size: 30 + rnd() * 10 });
        c++;
        if (++trees > 220) break outer;
      }
    }
  }

  const gSprites = el(g, "g", { id: "detail-sprites" });
  const nodes = sprites.sort((a, b) => a.y - b.y).map((s) => iconAt(gSprites, s.kind, s.x, s.y, s.size, s.title));
  if (animate) {
    fadeIn(inside, 500);
    popSprites(nodes, [box.x + box.width / 2, box.y + box.height / 2], state.params.introSpeed);
  }
}

function focusDistrict(id) {
  const info = districtEls.get(id);
  if (!info) return;
  state.focus = id;
  $("detail").replaceChildren();
  drawMask(id);
  fadeIn($("focus-mask"), 600);
  $("decor").style.opacity = 0.25;
  $("district-labels").style.opacity = 0;
  $("landmark-icons-overview").style.opacity = 0;
  if ($("ripples")) $("ripples").style.opacity = 0.25;
  const b = info.path.getBBox();
  const k = Math.min(10, 0.75 / Math.max(b.width / W, b.height / H));
  const t = d3.zoomIdentity.translate(W / 2, H / 2).scale(k).translate(-(b.x + b.width / 2), -(b.y + b.height / 2));
  svg.transition().duration(800).ease(d3.easeCubicInOut).call(zoom.transform, t).on("end", () => drawDetail(id, true));
  updateFocusUI();
}

function unfocus() {
  state.focus = null;
  $("detail").replaceChildren();
  $("decor").style.opacity = 1;
  $("district-labels").style.opacity = 1;
  $("landmark-icons-overview").style.opacity = 1;
  if ($("ripples")) $("ripples").style.opacity = 1;
  svg.transition().duration(700).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity);
  updateFocusUI();
}

function updateFocusUI() {
  const card = $("focus-card");
  if (!state.focus || !districtEls.has(state.focus)) { card.hidden = true; return; }
  const g = districtEls.get(state.focus).feature;
  card.hidden = false;
  $("focus-name").textContent = nameOf(g.properties, g.id);
  const lms = landmarksIn(state.focus);
  $("focus-meta").textContent = `${lms.length} landmark${lms.length === 1 ? "" : "s"} from OSM`;
  $("focus-select").textContent = state.selected.has(g.id) ? "Selected ✓" : "Select area";
}

// ---------------------------------------------------------------- selection

function toggleSelected(id) {
  state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
  save();
  render(); // redraws hatching, legend swatches and the selected list
}

function renderSelectedList() {
  const ul = $("selected-list");
  ul.replaceChildren();
  for (const id of state.selected) {
    const info = districtEls.get(id);
    if (!info) continue;
    const orig = nameOf(info.feature.properties);
    const li = document.createElement("li");
    const input = document.createElement("input");
    input.value = state.names[id] || orig;
    input.title = "Rename area";
    input.addEventListener("change", () => {
      const v = input.value.trim();
      if (v && v !== orig) state.names[id] = v; else delete state.names[id];
      save(); render();
    });
    const go = document.createElement("button");
    go.textContent = "↗"; go.title = "Zoom to";
    go.onclick = () => focusDistrict(id);
    const rm = document.createElement("button");
    rm.textContent = "×"; rm.title = "Deselect";
    rm.onclick = () => toggleSelected(id);
    li.append(input, go, rm);
    ul.append(li);
  }
  $("selected-empty").hidden = state.selected.size > 0;
}

// ---------------------------------------------------------------- landmarks & custom points

function renderLandmarkList() {
  const filter = $("landmark-filter").value.toLowerCase();
  const ul = $("landmark-list");
  ul.replaceChildren();
  const placed = new Set(state.pois.map((p) => p.id));
  const items = [...state.data.landmarks].sort((a, b) => nameOf(a, a.id).localeCompare(nameOf(b, b.id)));
  let shown = 0;
  for (const lm of items) {
    if (filter && !`${lm.name} ${lm.local || ""}`.toLowerCase().includes(filter) && !lm.kind.includes(filter)) continue;
    if (++shown > 300) break;
    const li = document.createElement("li");
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = placed.has(lm.id);
    cb.onchange = () => {
      if (cb.checked) state.pois.push({ id: lm.id, name: nameOf(lm, lm.id), kind: lm.kind, coord: lm.coord, source: lm.source || "osm" });
      else state.pois = state.pois.filter((p) => p.id !== lm.id);
      save(); render(); renderCustomList();
    };
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = KIND_LABELS[lm.kind] || lm.kind;
    label.append(cb, " ", nameOf(lm, lm.id), kind);
    li.append(label);
    ul.append(li);
  }
  $("landmark-count").textContent = `${state.data.landmarks.length} in OSM`;
  renderCustomList();
}

function renderCustomList() {
  const ul = $("poi-list");
  ul.replaceChildren();
  for (const poi of state.pois) {
    const li = document.createElement("li");
    const input = document.createElement("input");
    input.value = poi.name;
    input.onchange = () => { poi.name = input.value.trim() || poi.name; save(); render(); };
    const sel = document.createElement("select");
    for (const k of ICON_KINDS) sel.add(new Option(KIND_LABELS[k] || k, k, false, k === poi.kind));
    sel.onchange = () => { poi.kind = sel.value; save(); render(); };
    const rm = document.createElement("button");
    rm.textContent = "×"; rm.title = "Remove";
    rm.onclick = () => { state.pois = state.pois.filter((p) => p !== poi); save(); render(); renderLandmarkList(); };
    li.append(input, sel, rm);
    // Address: looked up automatically for custom pins, editable for any pin.
    const lm = state.data.landmarks.find((l) => l.id === poi.id);
    const addr = document.createElement("input");
    addr.className = "addr";
    addr.placeholder = poi.addressPending ? "Looking up address…" : "Address";
    addr.value = (poi.address || lm?.address)?.formatted || "";
    addr.title = (poi.address || lm?.address)?.approximate ? "Approximate (nearest address or street). Edit to correct it." : "";
    addr.onchange = () => {
      const v = addr.value.trim();
      poi.address = v ? { formatted: v, line: null, housenumber: null, street: null, suburb: null, postcode: null, approximate: false, source: "manual" } : null;
      save();
    };
    const web = document.createElement("input");
    web.className = "addr";
    web.type = "url";
    web.placeholder = "Website (https://…)";
    web.value = poi.website || lm?.website || "";
    web.onchange = () => {
      let v = web.value.trim();
      if (v && !/^https?:\/\//i.test(v)) v = `https://${v}`;
      poi.website = v || null;
      web.value = v;
      save();
    };
    li.append(addr, web);
    ul.append(li);
  }
  $("poi-empty").hidden = state.pois.length > 0;
}

// ---------------------------------------------------------------- addresses

function withAddress(lm) {
  const name = nameOf(lm, lm.id);
  return lm.address?.formatted ? `${name}\n${lm.address.formatted}${lm.address.approximate ? " (approx.)" : ""}` : name;
}

// Reverse-geocode a custom pin (one request per drop/move; Nominatim allows 1/s).
let geocodeChain = Promise.resolve();
function lookupAddress(poi) {
  if (poi.address?.source === "manual") return;
  poi.addressPending = true;
  renderCustomList();
  geocodeChain = geocodeChain.then(async () => {
    const [lon, lat] = poi.coord;
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat}&lon=${lon}`;
      const r = await (await fetch(url, { signal: AbortSignal.timeout(15000) })).json();
      const a = r.address || {};
      const cc = (a.country_code || "").toLowerCase();
      const parts = {
        housenumber: a.house_number || null,
        street: a.road || a.pedestrian || a.footway || a.path || null,
        suburb: a.suburb || a.neighbourhood || a.town || a.village || a.city || null,
        postcode: a.postcode || null,
        state: a.state || null,
        country: a.country || null,
        countryCode: cc || null,
      };
      if (parts.street || parts.suburb) {
        poi.address = { ...parts, line: formatLine(parts, cc), formatted: formatAddress(parts, cc), approximate: !parts.housenumber, source: "reverse-geocode" };
      }
    } catch {}
    poi.addressPending = false;
    save();
    renderCustomList();
    await new Promise((ok) => setTimeout(ok, 1100));
  });
}

// ---------------------------------------------------------------- label review

const SOURCE_TAGS = {
  "osm-en": ["EN", "English name from OpenStreetMap"],
  wikidata: ["EN", "English label from Wikidata"],
  "overture-en": ["EN", "English name from Overture"],
  "osm-int": ["INT", "International name from OpenStreetMap"],
  local: ["LOCAL", "Only a local-language name was found"],
};

// Every label on the map, with where its English came from; edits override.
function renderLabels() {
  const ul = $("label-list");
  if (!ul || !state.data) return;
  const onlyIssues = $("label-issues").checked;
  const f = $("label-filter").value.toLowerCase();
  const level = state.params.level && state.data.topology.objects[state.params.level];
  const rows = [];
  for (const g of level?.geometries || []) rows.push({ group: "Areas", id: g.id, obj: g.properties });
  const seenRivers = new Set();
  for (const r of state.data.rivers) {
    const k = riverKey(r);
    if (!(r.name || r.local) || seenRivers.has(k)) continue;
    seenRivers.add(k);
    rows.push({ group: "Rivers", id: k, obj: r });
  }
  for (const lm of state.data.landmarks) rows.push({ group: "Landmarks", id: lm.id, obj: lm });

  // Flag local-only names, and "English" names that are just the local name
  // with non-English letters (Wikidata sometimes copies the local name).
  const nonAscii = (t) => /[^\x00-\x7F]/.test(t || "");
  // In English-speaking places the local name *is* English, so a local-only
  // name is only suspicious when it has non-English letters.
  const issue = (o) => nonAscii(o.name) && (o.nameSource === "local" || !o.nameSource || o.name === o.local);
  ul.replaceChildren();
  const issues = rows.filter((r) => issue(r.obj) && !state.names[r.id]).length;
  let shown = 0, lastGroup = "";
  for (const r of rows) {
    const bad = issue(r.obj) && !state.names[r.id];
    if (onlyIssues && !bad) continue;
    const text = `${r.obj.name || ""} ${r.obj.local || ""} ${state.names[r.id] || ""}`.toLowerCase();
    if (f && !text.includes(f)) continue;
    if (++shown > 250) break;
    if (r.group !== lastGroup) {
      const h = document.createElement("li");
      h.className = "group";
      h.textContent = r.group;
      ul.append(h);
      lastGroup = r.group;
    }
    const li = document.createElement("li");
    const [tag, why] = state.names[r.id] ? ["EDITED", "You renamed this"] : SOURCE_TAGS[r.obj.nameSource] || (issue(r.obj) ? ["?", "Older data: language unknown"] : ["", ""]);
    const badge = document.createElement("span");
    badge.className = `src ${tag === "LOCAL" || tag === "?" ? "warn" : tag === "EDITED" ? "edited" : ""}`;
    badge.textContent = tag || "·";
    badge.title = why;
    const input = document.createElement("input");
    input.value = nameOf(r.obj, r.id);
    const auto = nameOf(r.obj);
    input.title = r.obj.local && r.obj.local !== r.obj.name ? `Local: ${r.obj.local}` : "";
    input.onchange = () => {
      const v = input.value.trim();
      if (v && v !== auto) state.names[r.id] = v; else delete state.names[r.id];
      save(); render(); renderLabels(); renderLandmarkList();
    };
    li.append(badge, input);
    if (r.obj.local && r.obj.local !== input.value) {
      const sm = document.createElement("small");
      sm.textContent = r.obj.local;
      li.append(sm);
    }
    ul.append(li);
  }
  $("label-summary").textContent = issues
    ? `${issues} name${issues === 1 ? "" : "s"} may not be in English. Edit them below, or rebuild the map to pull English names.`
    : "All names have an English source (or have been edited).";
}

// ---------------------------------------------------------------- export

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function exportSVG() {
  const clone = svg.node().cloneNode(true);
  clone.setAttribute("xmlns", NS);
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("xmlns:inkscape", "http://www.inkscape.org/namespaces/inkscape");
  clone.setAttribute("width", W);
  clone.setAttribute("height", H);
  clone.removeAttribute("style");
  clone.querySelector("#viewport").removeAttribute("transform");
  clone.querySelectorAll(".fx").forEach((g) => g.setAttribute("transform", `translate(${g.dataset.x},${g.dataset.y})`));
  clone.querySelectorAll(".dim").forEach((n) => n.classList.remove("dim"));
  clone.querySelectorAll("[style]").forEach((n) => n.removeAttribute("style"));
  clone.querySelector("#detail")?.replaceChildren();
  clone.querySelectorAll("g[id]").forEach((g) => {
    g.setAttribute("inkscape:groupmode", "layer");
    g.setAttribute("inkscape:label", g.id);
  });
  clone.querySelectorAll("use").forEach((u) => u.setAttribute("xlink:href", u.getAttribute("href")));
  const pal = PALETTES[state.params.palette];
  el(clone, "text", { x: W - 24, y: H - 24, "text-anchor": "end", "font-size": 11, fill: pal.text, opacity: 0.6, "font-family": "system-ui, sans-serif" }).textContent = state.data.attribution;
  download(`${state.area}-map.svg`, new XMLSerializer().serializeToString(clone), "image/svg+xml");
}

// ---------------------------------------------------------------- site kit

async function exportKit() {
  const btn = $("export-kit"), status = $("kit-status");
  const level = state.params.level && state.data.topology.objects[state.params.level];
  if (!level) { status.textContent = "Pick a Districts level first."; return; }
  btn.disabled = true;
  try {
    if (state.focus) unfocus();
    const { files, manifest } = await buildKit({
      state, svgNode: svg.node(), districtEls, project, nameOf, landmarksIn,
      palette: PALETTES[state.params.palette], kindLabels: KIND_LABELS, iconSVG, level,
    }, (msg) => (status.textContent = msg));
    status.textContent = "Writing files…";
    const res = await fetch("api/kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: state.area, files }) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || res.statusText);
    status.innerHTML = `Saved <code>${out.path}</code>: ${manifest.areas.length} areas, ${manifest.places.length} places on the map. <a href="${out.path}quickstart.html" target="_blank">Open quickstart</a>`;
  } catch (e) {
    status.textContent = `Couldn't export: ${e.message}. Is the dev server running (npm run serve)?`;
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- controls

const NUMERIC = ["simplify", "smooth", "minArea", "border", "soften", "wobble", "flowSpeed", "decorDensity", "introSpeed"];
const CHECKS = ["showRoads", "showGreen", "showLabels", "showDecor", "showIcons", "grain", "autoplay", "showRipples"];

function syncControls() {
  for (const k of NUMERIC) { $(k).value = state.params[k]; $(`${k}-val`).textContent = state.params[k]; }
  for (const k of CHECKS) $(k).checked = state.params[k];
  const lv = $("level");
  lv.replaceChildren();
  state.data.levels.forEach((l) => lv.add(new Option(l.label || `${l.count} districts (admin level ${l.admin_level})`, l.key)));
  lv.value = state.params.level;
  $("palette").value = state.params.palette;
  $("labelMode").value = state.params.labelMode;
  $("lang").value = state.params.lang;
  $("title-input").value = state.title;
  $("subtitle-input").value = state.subtitle;
}

let raf = 0;
const scheduleRender = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { render(); save(); }); };

function initControls() {
  for (const k of NUMERIC) {
    $(k).addEventListener("input", (e) => {
      state.params[k] = Number(e.target.value);
      $(`${k}-val`).textContent = e.target.value;
      scheduleRender();
    });
  }
  for (const k of CHECKS) $(k).addEventListener("change", (e) => { state.params[k] = e.target.checked; scheduleRender(); });
  $("lang").addEventListener("change", (e) => { state.params.lang = e.target.value; scheduleRender(); renderLabels(); renderLandmarkList(); });
  $("label-issues").addEventListener("change", renderLabels);
  $("label-filter").addEventListener("input", renderLabels);
  $("labelMode").addEventListener("change", (e) => { state.params.labelMode = e.target.value; scheduleRender(); });
  $("level").addEventListener("change", (e) => { state.params.level = e.target.value; state.focus = null; svg.call(zoom.transform, d3.zoomIdentity); scheduleRender(); });
  const pal = $("palette");
  for (const [k, v] of Object.entries(PALETTES)) pal.add(new Option(v.label, k));
  pal.addEventListener("change", (e) => { state.params.palette = e.target.value; scheduleRender(); });
  $("title-input").addEventListener("input", (e) => { state.title = e.target.value; scheduleRender(); });
  $("subtitle-input").addEventListener("input", (e) => { state.subtitle = e.target.value; scheduleRender(); });

  $("landmark-filter").addEventListener("input", renderLandmarkList);
  $("clear-selection").onclick = () => { state.selected.clear(); save(); render(); };
  $("reset-params").onclick = () => { state.params = { ...DEFAULT_PARAMS, palette: state.params.palette, level: state.params.level }; syncControls(); scheduleRender(); };

  $("focus-close").onclick = unfocus;
  $("focus-select").onclick = () => state.focus && toggleSelected(state.focus);

  $("add-poi").onclick = () => {
    state.placing = !state.placing;
    $("add-poi").classList.toggle("active", state.placing);
    $("add-poi").textContent = state.placing ? "Click the map… (Esc to cancel)" : "+ Add custom point";
    document.body.classList.toggle("placing", state.placing);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.placing) $("add-poi").click();
    else if (state.focus) unfocus();
  });
  svg.on("click", (ev) => {
    if (!state.placing) return;
    const [x, y] = d3.pointer(ev, $("viewport"));
    const coord = state.projection.invert([x, y]).map((v) => Math.round(v * 1e6) / 1e6);
    const pin = { id: `custom-${Date.now()}`, name: "New place", kind: "star", coord, source: "custom" };
    state.pois.push(pin);
    lookupAddress(pin);
    $("add-poi").click();
    save(); render(); renderCustomList();
    const inputs = $("poi-list").querySelectorAll("input");
    inputs[inputs.length - 1]?.select();
  });

  $("export-svg").onclick = exportSVG;
  $("export-kit").onclick = exportKit;
  $("play-intro").onclick = replayIntro;
  $("export-json").onclick = () => download(`${state.area}-project.json`, JSON.stringify(projectJSON(), null, 2), "application/json");
  $("import-json").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const p = JSON.parse(await file.text());
    if (p.area && p.area !== state.area) { $("area").value = p.area; await loadArea(p.area); }
    applyProject(p);
    syncControls(); save(); render(); renderLandmarkList();
    e.target.value = "";
  };

  zoom = d3.zoom()
    .scaleExtent([0.6, 14])
    // Keep at least part of the map on screen while panning.
    .translateExtent([[-W * 0.6, -H * 0.6], [W * 1.6, H * 1.6]])
    // d3 handles drag-to-pan with the left, middle or right button (not on a
    // pin, except right-drag which always pans); wheel is handled below.
    .filter((ev) => ev.type !== "wheel" && (ev.button === 2 || (!ev.target.closest?.(".poi") && (ev.button || 0) <= 1)))
    .on("zoom", (ev) => {
      const t = ev.transform;
      $("viewport")?.setAttribute("transform", t);
      if (t.k !== state.zoomK) {
        state.zoomK = t.k;
        const s = (1 / t.k).toFixed(4);
        svg.node().querySelectorAll(".fx").forEach((g) => g.setAttribute("transform", `translate(${g.dataset.x},${g.dataset.y}) scale(${s})`));
      }
      const frame = $("frame");
      if (frame) frame.style.opacity = t.k > 1.4 ? 0 : 1;
      document.body.classList.toggle("zoomed", t.k > 1.2);
      const rivers = $("river-labels");
      if (rivers) rivers.style.opacity = t.k > 1.8 ? 0 : 1; // they scale with the map
      const legend = $("legend");
      if (legend) {
        legend.style.opacity = t.k > 1.4 ? 0 : 1;
        legend.style.pointerEvents = t.k > 1.4 ? "none" : "";
      }
    });
  svg.call(zoom).on("dblclick.zoom", null);
  // Right-drag pans, so the browser's context menu stays out of the way on the map.
  svg.on("contextmenu.nav", (ev) => ev.preventDefault());
  // Middle-click would otherwise start the browser's autoscroll.
  svg.on("mousedown.nav", (ev) => { if (ev.button === 1) ev.preventDefault(); });

  // Wheel: a notched mouse wheel zooms at the cursor; a trackpad or Magic Mouse
  // swipe pans; pinch (reported as ctrl+wheel) or ⌘/ctrl+scroll zooms.
  const toView = () => W / svg.node().clientWidth; // screen px → SVG units
  svg.on("wheel.nav", (ev) => {
    ev.preventDefault();
    const pinch = ev.ctrlKey || ev.metaKey;
    const notched = ev.deltaMode === 1 || (ev.deltaX === 0 && Number.isInteger(ev.deltaY) && Math.abs(ev.deltaY) >= 40);
    if (pinch || notched) {
      const unit = ev.deltaMode === 1 ? 0.05 : pinch ? 0.012 : 0.002;
      svg.call(zoom.scaleBy, Math.pow(2, -ev.deltaY * unit), d3.pointer(ev, svg.node()));
    } else {
      const k = d3.zoomTransform(svg.node()).k;
      const f = toView();
      svg.call(zoom.translateBy, (-ev.deltaX * f) / k, (-ev.deltaY * f) / k);
    }
  }, { passive: false });

  // On-screen and keyboard controls.
  const zoomAt = (factor) => svg.transition().duration(250).call(zoom.scaleBy, factor);
  $("zoom-in").onclick = () => zoomAt(1.6);
  $("zoom-out").onclick = () => zoomAt(1 / 1.6);
  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, select, textarea")) return;
    const k = d3.zoomTransform(svg.node()).k;
    const step = 90 / k;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { e.preventDefault(); svg.interrupt().call(zoom.translateBy, ...moves[e.key]); } // instant, so holding a key scrolls smoothly
    else if (e.key === "+" || e.key === "=") zoomAt(1.4);
    else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.4);
  });

  $("reset-view").onclick = () => (state.focus ? unfocus() : svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity));
}

// ---------------------------------------------------------------- boot

initControls();

async function refreshIndex() {
  let index = [];
  try { index = await (await fetch("data/index.json")).json(); } catch {}
  index = index.filter((a) => a.relation || a.relations);
  const areaSel = $("area");
  areaSel.replaceChildren();
  for (const a of index) areaSel.add(new Option(a.title || a.name, a.name));
  return index;
}

$("area").addEventListener("change", (e) => loadArea(e.target.value));
initBuilder({
  onBuilt: async (name) => {
    await refreshIndex();
    $("area").value = name;
    await loadArea(name);
  },
});

const index = await refreshIndex();
if (!index.length) {
  $("map-status").textContent = "No maps yet. Use “New map” in the sidebar to build one.";
} else {
  await loadArea(index[0].name);
}
