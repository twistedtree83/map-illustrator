// Builds a "site kit" from the map currently open in the editor: everything an
// agent (or developer) needs to build a website around the map.
//
//   map.svg        artwork; every area has data-area="<slug>", every place data-place="<slug>"
//   map.json       manifest (areas, places, palette, attribution) — the source of truth
//   map-viewer.js  <illustrated-map> web component
//   icons/*.svg    each illustrated icon on its own
//   schema.json    JSON Schema for map.json
//   AGENTS.md      the brief for building a site from the kit
//   quickstart.html minimal working page

const NS = "http://www.w3.org/2000/svg";

export const slugify = (s) =>
  String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function uniqueSlugger() {
  const used = new Set();
  return (name, fallback) => {
    const base = slugify(name) || fallback;
    let s = base, i = 2;
    while (used.has(s)) s = `${base}-${i++}`;
    used.add(s);
    return s;
  };
}

// Short English descriptions from Wikidata, e.g. "suburb of Sydney, Australia".
async function wikidataDescriptions(qids) {
  const ids = [...new Set(qids.filter((q) => /^Q\d+$/.test(q || "")))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const url = `https://www.wikidata.org/w/api.php?format=json&origin=*&action=wbgetentities&props=descriptions|sitelinks/urls&sitefilter=enwiki&languages=en&ids=${ids.slice(i, i + 50).join("|")}`;
    try {
      const ents = (await (await fetch(url, { signal: AbortSignal.timeout(20000) })).json()).entities || {};
      for (const [q, e] of Object.entries(ents)) out.set(q, { description: e.descriptions?.en?.value || null, wikipedia: e.sitelinks?.enwiki?.url || null });
    } catch {}
  }
  return out;
}

const r1 = (n) => Math.round(n * 10) / 10;
// Address as published: formatted text + parts + how sure we are.
const cleanAddress = (a) => (a?.formatted ? {
  formatted: a.formatted, line: a.line || null, housenumber: a.housenumber || null, street: a.street || null,
  suburb: a.suburb || null, postcode: a.postcode || null, state: a.state || null, country: a.country || null,
  approximate: !!a.approximate, source: a.source || null,
} : null);
// A "local name" only when it's genuinely another language (has non-English
// letters); otherwise it's just an alternative spelling and is left out.
const localOf = (local, name) => (local && local !== name && /[^\x00-\x7F]/.test(local) ? local : null);
const r6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * ctx: { state, svgNode, districtEls, project, nameOf, landmarksIn, palette, kindLabels, iconSVG, level }
 */
export async function buildKit(ctx, onProgress = () => {}) {
  const { state, svgNode, districtEls, project, nameOf, palette, kindLabels, iconSVG, level } = ctx;
  const data = state.data;

  // ---------------------------------------------------------------- areas
  onProgress("Collecting areas…");
  const areaSlug = uniqueSlugger();
  const areas = [];
  const areaById = new Map();
  for (const g of level.geometries) {
    const info = districtEls.get(g.id);
    if (!info) continue;
    const b = info.path.getBBox();
    const [cx, cy] = project(g.properties.label);
    const a = {
      id: String(g.id),
      slug: areaSlug(nameOf(g.properties, g.id), `area-${areas.length + 1}`),
      name: nameOf(g.properties, g.id),
      localName: localOf(g.properties.local, nameOf(g.properties, g.id)),
      number: info.num || null,
      region: g.properties.region || null,
      wikidata: g.properties.qid || null,
      center: g.properties.label.map(r6),
      svgCenter: [r1(cx), r1(cy)],
      bbox: [r1(b.x), r1(b.y), r1(b.width), r1(b.height)],
      color: info.path.dataset.fill || info.path.getAttribute("fill") || null,
      neighbours: [],
      places: [],
      placeCount: 0,
      landmarks: [],
      landmarkCount: 0,
      description: null,
      wikipedia: null,
      selected: state.selected.has(g.id),
    };
    areas.push(a);
    areaById.set(g.id, a);
  }
  // Neighbours share a topology arc.
  const owners = new Map();
  const walk = (arr, id) => (typeof arr === "number" ? owners.set(arr < 0 ? ~arr : arr, [...(owners.get(arr < 0 ? ~arr : arr) || []), id]) : arr.forEach((x) => walk(x, id)));
  for (const g of level.geometries) walk(g.arcs || [], g.id);
  for (const ids of owners.values()) for (const a of ids) for (const b of ids) {
    if (a !== b && areaById.has(a) && areaById.has(b)) {
      const A = areaById.get(a), B = areaById.get(b);
      if (!A.neighbours.includes(B.slug)) A.neighbours.push(B.slug);
    }
  }
  if (areas.every((a) => !a.neighbours.length)) {
    // Sources without shared edges (e.g. Overture): fall back to touching bounding boxes.
    for (const A of areas) for (const B of areas) {
      if (A === B) continue;
      const [ax, ay, aw, ah] = A.bbox, [bx, by, bw, bh] = B.bbox;
      if (ax <= bx + bw && bx <= ax + aw && ay <= by + bh && by <= ay + ah) A.neighbours.push(B.slug);
    }
  }

  const areaAt = (x, y) => {
    for (const a of areas) {
      const [bx, by, bw, bh] = a.bbox;
      if (x < bx || y < by || x > bx + bw || y > by + bh) continue;
      if (districtEls.get(isNaN(+a.id) ? a.id : a.id)?.path.isPointInFill(new DOMPoint(x, y))) return a;
    }
    for (const a of areas) if (districtEls.get(a.id)?.path.isPointInFill(new DOMPoint(x, y))) return a;
    return null;
  };

  // ---------------------------------------------------------------- places
  onProgress("Collecting places…");
  const placeSlug = uniqueSlugger();
  const chosen = new Map(); // id -> {lm|poi}
  for (const pick of state.overviewPicks || []) chosen.set(pick.lm.id, { src: pick.lm, featured: true });
  for (const poi of state.pois) {
    const lm = data.landmarks.find((l) => l.id === poi.id);
    chosen.set(poi.id, { src: lm || poi, poi, featured: true, custom: poi.source === "custom" });
  }
  const places = [];
  for (const [id, { src, poi, custom }] of chosen) {
    const coord = poi?.coord || src.coord;
    const [x, y] = project(coord);
    const area = areaAt(x, y);
    const name = poi ? poi.name : nameOf(src, src.id);
    const kind = poi?.kind || src.kind;
    const p = {
      id: String(id),
      slug: placeSlug(name, `place-${places.length + 1}`),
      name,
      localName: localOf(src.local, name),
      kind,
      typeLabel: kindLabels[kind] || kind,
      category: src.category || null,
      icon: `icons/${kind}.svg`,
      coord: coord.map(r6),
      svg: [r1(x), r1(y)],
      area: area?.slug || null,
      wikidata: src.qid || src.wikidata || null,
      source: custom ? "custom" : src.source || "openstreetmap",
      onMap: true,
      description: null,
      wikipedia: null,
      address: cleanAddress(poi?.address || src.address),
      website: poi?.website || src.website || null,
      fields: poi?.fields || {},
    };
    places.push(p);
    if (area) { area.places.push(p.slug); area.placeCount++; }
  }

  // Every other known landmark, not drawn on the map, for directory listings.
  // Same slug namespace as places, so one page template can serve both.
  const more = [];
  for (const lm of data.landmarks) {
    if (chosen.has(lm.id)) continue;
    const [x, y] = project(lm.coord);
    const area = areaAt(x, y);
    if (!area) continue;
    const name = nameOf(lm, lm.id);
    const m = {
      id: String(lm.id), slug: placeSlug(name, `landmark-${more.length + 1}`), name,
      localName: localOf(lm.local, name),
      kind: lm.kind, typeLabel: kindLabels[lm.kind] || lm.kind, category: lm.category || null, icon: `icons/${lm.kind}.svg`,
      coord: lm.coord.map(r6), svg: [r1(x), r1(y)], area: area.slug, wikidata: lm.qid || lm.wikidata || null,
      source: lm.source || "openstreetmap", onMap: false, description: null, wikipedia: null,
      address: cleanAddress(lm.address),
      website: lm.website || null,
    };
    more.push(m);
    area.landmarks.push(m.slug);
    area.landmarkCount++;
  }

  // ---------------------------------------------------------------- descriptions
  onProgress("Fetching short descriptions from Wikidata…");
  const desc = await wikidataDescriptions([...areas, ...places, ...more].map((x) => x.wikidata));
  const sentence = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".") : null);
  for (const x of [...areas, ...places, ...more]) {
    const d = desc.get(x.wikidata);
    if (d) { x.description = sentence(d.description); x.wikipedia = d.wikipedia; }
  }

  // ---------------------------------------------------------------- svg
  onProgress("Preparing artwork…");
  const clone = svgNode.cloneNode(true);
  clone.setAttribute("xmlns", NS);
  clone.removeAttribute("style");
  clone.querySelector("#viewport")?.removeAttribute("transform");
  for (const sel of ["#legend", "#hover-outline", "#focus-mask", "#selection", "#landmark-icons-overview", "#pois", "#paper-grain"]) clone.querySelector(sel)?.remove();
  clone.querySelector("#detail")?.replaceChildren();
  clone.querySelectorAll("[style]").forEach((n) => n.removeAttribute("style"));
  clone.querySelectorAll(".fx").forEach((g) => g.setAttribute("transform", `translate(${g.dataset.x},${g.dataset.y})`));
  clone.querySelectorAll("path.district").forEach((p) => {
    const a = areaById.get(p.dataset.id) || areaById.get(Number(p.dataset.id));
    if (!a) return;
    p.id = `area-${a.slug}`;
    p.setAttribute("data-area", a.slug);
    p.removeAttribute("data-fill");
    if (a.selected) p.setAttribute("fill", p.getAttribute("fill")); // keep look; selection is a site concern
    const t = document.createElementNS(NS, "title");
    t.textContent = a.name;
    p.append(t);
  });
  // Paper grain on top would block clicks in a site; put it under the map instead.
  const grain = svgNode.querySelector("#paper-grain")?.cloneNode(true);
  if (grain) clone.querySelector("#paper")?.after(grain);
  const gPlaces = document.createElementNS(NS, "g");
  gPlaces.id = "places";
  for (const p of [...places].sort((a, b) => a.svg[1] - b.svg[1])) {
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "fx");
    g.setAttribute("id", `place-${p.slug}`);
    g.setAttribute("data-place", p.slug);
    g.setAttribute("data-x", p.svg[0]);
    g.setAttribute("data-y", p.svg[1]);
    g.setAttribute("transform", `translate(${p.svg[0]},${p.svg[1]})`);
    const use = document.createElementNS(NS, "use");
    use.setAttribute("href", `#icon-${p.kind}`);
    use.setAttribute("x", -20); use.setAttribute("y", -36.8); use.setAttribute("width", 40); use.setAttribute("height", 40);
    const t = document.createElementNS(NS, "title");
    t.textContent = p.name;
    g.append(use, t);
    gPlaces.append(g);
  }
  clone.querySelector("#viewport").append(gPlaces);
  const svgText = `<?xml version="1.0" encoding="UTF-8"?>\n<!-- ${data.attribution} -->\n` + new XMLSerializer().serializeToString(clone);

  // ---------------------------------------------------------------- manifest
  const kinds = [...new Set([...places, ...more].map((p) => p.kind))];
  const count = (list, k) => list.filter((p) => p.kind === k).length;
  const manifest = {
    $schema: "./schema.json",
    version: 1,
    title: state.title || data.title,
    subtitle: state.subtitle || null,
    generatedAt: new Date().toISOString(),
    files: { svg: "map.svg", viewer: "map-viewer.js", icons: "icons/" },
    viewBox: [0, 0, +svgNode.viewBox.baseVal.width, +svgNode.viewBox.baseVal.height],
    attribution: data.attribution,
    attributionLinks: [
      { text: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" },
      ...(data.overtureRelease ? [{ text: "Overture Maps Foundation", href: "https://overturemaps.org" }] : []),
      { text: "Wikidata", href: "https://www.wikidata.org" },
    ],
    dataSources: { osm: data.osmSource || "overpass", overtureRelease: data.overtureRelease || null, regions: data.regions || [] },
    palette: {
      paper: palette.bg, card: palette.wall, ink: palette.ink, text: palette.text, land: palette.land, water: palette.water,
      green: palette.green, accent: palette.accent, accent2: palette.accent2, roof: palette.roof, selected: palette.selected,
    },
    fonts: { display: "Bricolage Grotesque", body: "Nunito", googleFonts: "https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Nunito:wght@500;700;800&display=swap" },
    types: kinds.map((k) => ({ kind: k, label: kindLabels[k] || k, icon: `icons/${k}.svg`, onMap: count(places, k), landmarks: count(more, k) }))
      .sort((a, b) => b.onMap + b.landmarks - (a.onMap + a.landmarks)),
    areas: areas.map(({ selected, ...a }) => a),
    places,
    moreLandmarks: more,
  };

  // ---------------------------------------------------------------- files
  onProgress("Bundling files…");
  const [viewer, agents, schema, quick] = await Promise.all(
    ["src/kit/illustrated-map.js", "src/kit/AGENTS.template.md", "src/kit/schema.json", "src/kit/quickstart.template.html"].map(async (u) => (await fetch(u)).text())
  );
  const exampleArea = areas.find((a) => a.placeCount) || areas[0];
  const examplePlace = places[0];
  const fill = (t) => t
    .replaceAll("{{TITLE}}", manifest.title)
    .replaceAll("{{AREA_COUNT}}", String(areas.length))
    .replaceAll("{{PLACE_COUNT}}", String(places.length))
    .replaceAll("{{MORE_COUNT}}", String(more.length))
    .replaceAll("{{TYPES}}", manifest.types.map((t) => `\`${t.kind}\` (${t.label})`).join(", ") || "none yet")
    .replaceAll("{{EXAMPLE_AREA}}", exampleArea?.slug || "example-area")
    .replaceAll("{{EXAMPLE_PLACE}}", examplePlace?.slug || "example-place")
    .replaceAll("{{ATTRIBUTION}}", data.attribution)
    .replaceAll("{{PAPER}}", palette.bg).replaceAll("{{INK}}", palette.ink).replaceAll("{{ACCENT}}", palette.accent)
    .replaceAll("{{GENERATED}}", manifest.generatedAt.slice(0, 10));

  const files = {
    "map.svg": svgText,
    "map.json": JSON.stringify(manifest, null, 2),
    "map-viewer.js": viewer,
    "schema.json": schema,
    "AGENTS.md": fill(agents),
    "quickstart.html": fill(quick),
  };
  for (const k of Object.keys(kindLabels)) files[`icons/${k}.svg`] = iconSVG(k, palette);
  return { files, manifest };
}
