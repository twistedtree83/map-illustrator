#!/usr/bin/env node
// Fetch one or more neighbouring regions from OpenStreetMap and boil them down
// to what the illustrated map needs: a merged outline, selectable districts
// (as a shared-edge topology, so neighbours stay seamless after smoothing),
// water, parks, streets and landmarks.
//
//   node scripts/fetch-osm.mjs <name> "<place search>"[; "<place search>" …]
//   node scripts/fetch-osm.mjs <name> --relation <id>[,<id>…] [--title "…"]
//
//   node scripts/fetch-osm.mjs prague "Prague, Czechia"
//   node scripts/fetch-osm.mjs treasure-valley "Boise, Idaho; Meridian, Idaho; Eagle, Idaho" --title "Treasure Valley"
//   node scripts/fetch-osm.mjs prague --relation 435514
//
// Each region uses its own sub-districts where OSM has them; a region without
// any becomes a single selectable area. With several regions, "one area per
// region" is also offered as a level.
//
// Writes data/<name>.json and updates data/index.json.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import osmtogeojson from "osmtogeojson";
import { topology } from "topojson-server";
import { findLocalFile, localRegions, localExtract, localBoundaries, localFeatures, localAddresses } from "./osm-local.mjs";
import { addressFromTags, addressFromOverture, regionDefaults, fillAddresses } from "./addresses.mjs";
import { overpass, round, roundCoords, isArea, isLine, polys, lines, pointsOf, centroid, interiorPoint, contains, englishName, applyWikidataLabels, websiteFromTags, cleanWebsite, applyWikidataWebsites } from "./osm-lib.mjs";

const UA = "mapinteractive-prototype/0.3";

// ------------------------------------------------------------ arguments

const argv = process.argv.slice(2);
const name = argv[0];
let relationIds = [];
let searches = [];
let title = null;
let useOverture = true;
let useLocal = true; // use a downloaded .osm.pbf in data-src/ when it covers the regions
let allowLarge = false;
const MAX_KM2 = 20000; // above this, street-level data gets very slow/heavy
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--relation") relationIds = argv[++i].split(",").map((s) => Number(s.trim())).filter(Boolean);
  else if (argv[i] === "--title") title = argv[++i];
  else if (argv[i] === "--no-overture") useOverture = false;
  else if (argv[i] === "--no-local") useLocal = false;
  else if (argv[i] === "--large") allowLarge = true;
  else searches.push(...argv[i].split(";").map((s) => s.trim()).filter(Boolean));
}
if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name) || (!relationIds.length && !searches.length)) {
  console.error('usage: node scripts/fetch-osm.mjs <name> "<place>"[; "<place>"] | --relation <id>[,<id>] [--title "…"]');
  console.error("       <name> is lowercase letters, numbers and dashes");
  process.exit(1);
}

// ------------------------------------------------------------ resolve places

for (const q of searches) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`;
  const hits = await (await fetch(url, { headers: { "User-Agent": UA } })).json();
  const hit = hits.find((h) => h.osm_type === "relation");
  if (!hit) {
    console.error(`No boundary found for "${q}". Try --relation <id> (find it on openstreetmap.org).`);
    process.exit(1);
  }
  relationIds.push(hit.osm_id);
  console.log(`resolved "${q}" → relation ${hit.osm_id} (${hit.display_name})`);
  await new Promise((r) => setTimeout(r, 1100)); // Nominatim: max 1 request/second
}
relationIds = [...new Set(relationIds)];

// ------------------------------------------------------------ overpass

const AREA = `(${relationIds.map((id) => `rel(${id});`).join("")})->.city; .city map_to_area->.a;`;

const boundaryQuery = `
[out:json][timeout:240];
${AREA}
(
  .city;
  rel(area.a)["boundary"="administrative"]["admin_level"~"^(6|7|8|9|10|11)$"];
);
out body; >; out skel qt;`;

const featureQuery = `
[out:json][timeout:280];
${AREA}
(
  way["natural"="water"](area.a);
  relation["natural"="water"](area.a);
  way["waterway"="riverbank"](area.a);
  way["waterway"~"^(river|canal)$"](area.a);

  way["leisure"~"^(park|nature_reserve|garden)$"](area.a);
  relation["leisure"~"^(park|nature_reserve)$"](area.a);
  way["landuse"~"^(forest|grass|meadow|recreation_ground|cemetery|vineyard)$"](area.a);
  relation["landuse"="forest"](area.a);
  way["natural"~"^(wood|scrub)$"](area.a);
  relation["natural"="wood"](area.a);

  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|living_street|pedestrian)$"](area.a);

  nwr["tourism"~"^(attraction|museum|viewpoint|zoo|gallery)$"]["wikidata"](area.a);
  nwr["historic"~"^(castle|monument|memorial|church|city_gate|tower|fort|palace)$"]["wikidata"](area.a);
  nwr["amenity"~"^(place_of_worship|school|university|hospital|theatre)$"]["wikidata"](area.a);
  nwr["man_made"~"^(bridge|tower)$"]["wikidata"](area.a);
  nwr["leisure"="stadium"]["wikidata"](area.a);
);
out body; >; out skel qt;`;

function landmarkKind(t) {
  if (t.historic === "castle" && /^(stately|palace|manor)$/.test(t.castle_type || "")) return "palace";
  if (t.historic === "castle" || t.historic === "fort") return "castle";
  if (t.historic === "palace") return "palace";
  if (t.amenity === "place_of_worship" || t.historic === "church") return "worship";
  if (t.tourism === "museum" || t.tourism === "gallery") return "museum";
  if (t.amenity === "theatre") return "theatre";
  if (t.amenity === "school" || t.amenity === "university") return "school";
  if (t.amenity === "hospital") return "hospital";
  if (t.tourism === "viewpoint") return "viewpoint";
  if (t.man_made === "bridge") return "bridge";
  if (t.man_made === "tower" || t.historic === "tower" || t.historic === "city_gate") return "tower";
  if (t.leisure === "stadium") return "stadium";
  if (t.tourism === "zoo") return "zoo";
  if (t.historic === "monument" || t.historic === "memorial") return "monument";
  return "attraction";
}

const feature = (f, props = {}) => ({
  type: "Feature",
  id: f.id,
  properties: (() => {
    const en = englishName(f.properties);
    return { name: en.name || f.id, local: en.local, nameSource: en.source, qid: f.properties.wikidata || null, label: interiorPoint(f.geometry).map(round), ...props };
  })(),
  geometry: { type: f.geometry.type, coordinates: roundCoords(f.geometry.coordinates) },
});

// ------------------------------------------------------------ boundaries

// Prefer a downloaded OSM file (fast, no busy servers); fall back to Overpass.
const localFile = useLocal ? findLocalFile(relationIds) : null;
let bgj, localCut = null;
if (localFile) {
  const t0 = Date.now();
  const regs = localRegions(localFile, relationIds).filter((f) => f.id.startsWith("relation/") && isArea(f.geometry));
  const pts = regs.flatMap((r) => pointsOf(r.geometry));
  localCut = localExtract(localFile, [
    Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
    Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])),
  ]);
  const ids = new Set(regs.map((r) => r.id));
  bgj = { features: [...regs, ...localBoundaries(localCut).filter((f) => !ids.has(f.id))] };
  console.log(`boundaries: local file ${path.basename(localFile)} … ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} else {
  bgj = osmtogeojson(await overpass(boundaryQuery, "boundaries"));
}
const regions = relationIds.map((id) => bgj.features.find((f) => f.id === `relation/${id}`)).filter((f) => f && isArea(f.geometry));
if (!regions.length) throw new Error("None of the regions came back as a polygon.");
if (regions.length < relationIds.length) console.warn(`! ${relationIds.length - regions.length} region(s) had no usable outline and were skipped.`);
console.log(`regions: ${regions.map((r) => r.properties.name).join(", ")}`);
const inAnyRegion = (pt) => regions.some((r) => contains(r.geometry, pt));
{
  const pts = regions.flatMap((r) => pointsOf(r.geometry));
  const [w, e] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  const [s, n] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  const km2 = (e - w) * 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180) * (n - s) * 110.57;
  console.log(`extent: ≈ ${Math.round(km2).toLocaleString()} km² (bounding box)`);
  if (km2 > MAX_KM2 && !allowLarge) {
    console.error(`! That's larger than ${MAX_KM2.toLocaleString()} km², which is too big for street-level detail from the public servers.`);
    console.error("  Pick smaller areas (e.g. councils rather than a whole state), or run from the command line with --large.");
    process.exit(2);
  }
}

// For each admin level, each region contributes its own sub-districts at that
// level if it has at least two; otherwise the whole region is one area.
const candidates = bgj.features.filter((f) => f.properties?.boundary === "administrative" && isArea(f.geometry) && !regions.includes(f));
const childrenOf = (region, lvl) => {
  const rl = Number(region.properties.admin_level || 0);
  if (!(lvl > rl)) return [];
  return candidates.filter((f) => Number(f.properties.admin_level) === lvl && contains(region.geometry, interiorPoint(f.geometry) || [0, 0]));
};

const objects = {
  city: { type: "FeatureCollection", features: regions.map((r) => feature(r)) },
};
const levelInfo = [];
for (const lvl of [7, 8, 9, 10, 11]) {
  let withChildren = 0;
  const seen = new Set();
  const fs_ = [];
  for (const r of regions) {
    const kids = childrenOf(r, lvl).filter((k) => !seen.has(k.id));
    if (kids.length >= 2) {
      withChildren++;
      for (const k of kids) { seen.add(k.id); fs_.push(feature(k, { region: r.properties.name })); }
    } else {
      fs_.push(feature(r, { region: r.properties.name }));
    }
  }
  if (!withChildren || fs_.length > 250) continue;
  const key = `level${lvl}`;
  objects[key] = { type: "FeatureCollection", features: fs_ };
  levelInfo.push({ key, admin_level: lvl, count: fs_.length, label: `${fs_.length} districts (admin level ${lvl})` });
}
// ------------------------------------------------------------ Overture Maps (optional)
// Neighbourhood polygons (often richer than OSM's admin levels) and
// well-categorised landmark places. Needs `uv`; skipped quietly if missing.
let overture = null;
if (useOverture) {
  const pts = regions.flatMap((r) => pointsOf(r.geometry));
  const bb = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const tmp = path.join(os.tmpdir(), `overture-${name}-${process.pid}.json`);
  const run = spawnSync("uv", ["run", "--quiet", "--with", "duckdb", "python", path.join(import.meta.dirname, "fetch-overture.py"), "--bbox", bb.join(","), "--out", tmp], { stdio: ["ignore", "inherit", "inherit"] });
  if (run.error) console.warn(`! Overture skipped (${run.error.code === "ENOENT" ? "uv not installed" : run.error.message})`);
  else if (run.status !== 0) console.warn("! Overture step failed; continuing with OpenStreetMap only");
  else {
    overture = JSON.parse(await fs.readFile(tmp, "utf8"));
    await fs.rm(tmp, { force: true });
  }
}
if (overture) {
  const labels = { macrohood: "neighbourhoods", neighborhood: "neighbourhoods", microhood: "micro-neighbourhoods" };
  for (const subtype of ["macrohood", "neighborhood", "microhood"]) {
    const fsOv = overture.areas
      .filter((a) => a.subtype === subtype && isArea(a.geometry))
      .filter((a) => { const p = interiorPoint(a.geometry); return p && inAnyRegion(p); })
      .map((a) => feature({ id: `overture/${a.id}`, properties: { name: a.name }, geometry: a.geometry },
        { source: "overture", name: a.name_en || a.name, local: a.name, nameSource: a.name_en ? "overture-en" : "local" }));
    if (fsOv.length < 3 || fsOv.length > 250) continue;
    const key = `ov-${subtype}`;
    objects[key] = { type: "FeatureCollection", features: fsOv };
    levelInfo.push({ key, admin_level: null, source: "overture", count: fsOv.length, label: `${fsOv.length} ${labels[subtype]} (Overture)` });
  }
}

if (regions.length > 1 || !levelInfo.length) {
  objects.regions = { type: "FeatureCollection", features: regions.map((r) => feature(r, { region: r.properties.name })) };
  levelInfo.push({ key: "regions", admin_level: null, count: regions.length, label: `${regions.length} region${regions.length > 1 ? "s" : ""} (as entered)` });
}
// English names: fill gaps from Wikidata's curated labels.
{
  const props = Object.values(objects).flatMap((o) => o.features.map((f) => f.properties));
  const n = await applyWikidataLabels(props);
  const local = props.filter((p) => p.nameSource === "local" && p.local && /[^\x00-\x7F]/.test(p.local)).length;
  console.log(`labels: ${n} area names upgraded from Wikidata${local ? `; ${local} still local-only (check in the Labels panel)` : ""}`);
}

// No quantisation: arcs keep real lon/lat so the browser can project them.
const topo = topology(objects);
console.log(`areas: ${levelInfo.map((l) => l.label).join(", ")}`);

// ------------------------------------------------------------ features

let fgj;
if (localCut) {
  const t0 = Date.now();
  fgj = { features: localFeatures(localCut) };
  console.log(`features: local file … ok (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} else {
  fgj = osmtogeojson(await overpass(featureQuery, "features"));
}
const names = objects.city.features.map((f) => f.properties.name);
const out = {
  name,
  title: title || (names.length <= 2 ? names.join(" & ") : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`),
  relations: relationIds,
  regions: names,
  fetched: new Date().toISOString(),
  osmSource: localFile ? `local:${path.basename(localFile)}` : "overpass",
  attribution: "© OpenStreetMap contributors (ODbL)",
  levels: levelInfo,
  topology: topo,
  water: [], rivers: [], green: [], roads: [], landmarks: [],
};
const seen = new Set();
const streetPoints = []; // named road vertices, for "nearest street" addresses

// A local cut is a rectangle; keep only features that reach into the regions
// (like Overpass's area query), sampling up to 24 points per feature.
const touchesRegions = (g) => {
  const pts = pointsOf(g);
  const step = Math.max(1, Math.floor(pts.length / 24));
  for (let i = 0; i < pts.length; i += step) if (inAnyRegion(pts[i])) return true;
  return inAnyRegion(pts[pts.length - 1]);
};

for (const f of fgj.features) {
  const t = f.properties || {};
  const g = f.geometry;
  if (!g) continue;
  if (localCut && !Object.keys(t).length) continue; // untagged relation members
  if (localCut && !touchesRegions(g)) continue;
  if (isLine(g) && t.highway && t.name) for (const line of lines(g)) for (const c of line) streetPoints.push({ coord: c, name: t.name });
  if (t.wikidata && (t.tourism || t.historic || t.amenity || t.man_made || t.leisure === "stadium")) {
    const c = centroid(g);
    if (t.name && !seen.has(t.wikidata) && inAnyRegion(c)) {
      seen.add(t.wikidata);
      const en = englishName(t);
      out.landmarks.push({ id: f.id, name: en.name, local: en.local, nameSource: en.source, qid: t.wikidata, kind: landmarkKind(t), coord: roundCoords(c), address: addressFromTags(t), website: websiteFromTags(t), websiteSource: websiteFromTags(t) ? "osm" : null });
    }
  }
  if (isArea(g) && (t.natural === "water" || t.waterway === "riverbank")) {
    out.water.push({ coords: roundCoords(polys(g)) });
  } else if (isLine(g) && /^(river|canal)$/.test(t.waterway || "")) {
    const en = englishName(t);
    out.rivers.push({ name: en.name, local: en.local, nameSource: en.source, qid: t.wikidata || null, type: t.waterway, coords: roundCoords(lines(g)) });
  } else if (isArea(g) && (t.leisure || t.landuse || /^(wood|scrub)$/.test(t.natural || ""))) {
    const kind = t.landuse === "forest" || t.natural === "wood" ? "forest" : t.landuse === "cemetery" ? "cemetery" : "park";
    out.green.push({ kind, coords: roundCoords(polys(g)) });
  } else if (isLine(g) && t.highway) {
    out.roads.push({ type: t.highway, coords: roundCoords(lines(g)) });
  }
}

// Overture places fill gaps in OSM's landmark list (skipping near-duplicates).
if (overture) {
  const ovKind = (c) =>
    /castle|fort/.test(c) ? "castle" : /palace/.test(c) ? "palace" : /museum|gallery/.test(c) ? "museum" :
    /church|cathedral|religious|worship|temple|mosque|synagogue/.test(c) ? "worship" : /theat/.test(c) ? "theatre" :
    /stadium|arena/.test(c) ? "stadium" : /zoo|aquarium|wildlife/.test(c) ? "zoo" : /bridge/.test(c) ? "bridge" :
    /lookout|scenic|viewpoint|overlook/.test(c) ? "viewpoint" :
    /tower|observatory/.test(c) ? "tower" : /monument|memorial/.test(c) ? "monument" : "attraction";
  const near = (a, b, m) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110540) < m;
  const norm = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "").slice(0, 8);
  let added = 0;
  for (const p of overture.places) {
    if (!inAnyRegion(p.coord)) continue;
    const dup = out.landmarks.find((l) => near(l.coord, p.coord, 30) || (near(l.coord, p.coord, 200) && norm(l.name) === norm(p.name)));
    if (dup) {
      // Same place in both: keep the OSM entry but borrow Overture's website/address if it lacks one.
      if (!dup.website && p.website) { dup.website = cleanWebsite(p.website); dup.websiteSource = "overture"; }
      if (!dup.address && p.address) dup.address = addressFromOverture(p.address);
      continue;
    }
    out.landmarks.push({ id: `overture/${p.id}`, address: addressFromOverture(p.address), website: cleanWebsite(p.website), websiteSource: p.website ? "overture" : null, name: p.name_en || p.name, local: p.name, nameSource: p.name_en ? "overture-en" : "local", kind: ovKind(p.cat || ""), category: p.cat, confidence: p.confidence, source: "overture", coord: p.coord });
    added++;
  }
  out.overtureRelease = overture.release;
  out.attribution = "© OpenStreetMap contributors (ODbL) · Overture Maps Foundation";
  console.log(`overture: added ${added} landmarks not already in OSM`);
}

{
  const n = await applyWikidataLabels([...out.landmarks, ...out.rivers]);
  console.log(`labels: ${n} landmark/river names upgraded from Wikidata`);
  const w = await applyWikidataWebsites(out.landmarks);
  console.log(`websites: ${out.landmarks.filter((l) => l.website).length} of ${out.landmarks.length} landmarks (${w} from Wikidata)`);
}

// ------------------------------------------------------------ addresses
{
  const t0 = Date.now();
  const need = out.landmarks.filter((l) => !l.address);
  let points = [];
  if (localCut) {
    points = localAddresses(localCut).map((f) => ({ coord: f.geometry.type === "Point" ? f.geometry.coordinates : centroid(f.geometry), tags: f.properties }));
  } else if (need.length) {
    // Only fetch address points near landmarks that need one (keeps the query small).
    for (let i = 0; i < need.length; i += 120) {
      const parts = need.slice(i, i + 120).map((l) => `nwr(around:80,${l.coord[1]},${l.coord[0]})["addr:housenumber"];`).join("");
      try {
        const j = await overpass(`[out:json][timeout:120];(${parts});out center tags;`, "addresses");
        for (const e of j.elements || []) {
          const c = e.type === "node" ? [e.lon, e.lat] : e.center ? [e.center.lon, e.center.lat] : null;
          if (c && e.tags) points.push({ coord: c, tags: e.tags });
        }
      } catch (e) { console.warn(`! address lookup skipped: ${e.message}`); }
    }
  }
  // Suburb = the finest official district containing the point.
  const districtLevels = Object.entries(objects).filter(([k]) => /^level\d+$/.test(k)).sort((a, b) => Number(b[0].slice(5)) - Number(a[0].slice(5)));
  const suburbOf = (c) => {
    for (const [, o] of districtLevels) for (const f of o.features) if (contains(f.geometry, c)) return f.properties.name;
    for (const f of objects.city.features) if (contains(f.geometry, c)) return f.properties.name;
    return null;
  };
  const cpts = regions.flatMap((r) => pointsOf(r.geometry));
  const centre = [(Math.min(...cpts.map((p) => p[0])) + Math.max(...cpts.map((p) => p[0]))) / 2, (Math.min(...cpts.map((p) => p[1])) + Math.max(...cpts.map((p) => p[1]))) / 2];
  const defaults = await regionDefaults(centre);
  for (const l of out.landmarks) if (l.address) l.addressSource = l.source === "overture" ? "overture" : "osm";
  const st = fillAddresses(out.landmarks, { points, streets: streetPoints, suburbOf, defaults });
  out.region = defaults;
  console.log(`addresses: ${st.exact} exact, ${st.nearestAddress} from nearest address, ${st.nearestStreet} from nearest street, ${st.areaOnly} suburb only, ${st.none} none (${((Date.now() - t0) / 1000).toFixed(1)}s, ${points.length} address points)`);
}

const dataDir = path.resolve(import.meta.dirname, "..", "data");
await fs.mkdir(dataDir, { recursive: true });
const json = JSON.stringify(out);
await fs.writeFile(path.join(dataDir, `${name}.json`), json);
const indexPath = path.join(dataDir, "index.json");
let index = [];
try { index = JSON.parse(await fs.readFile(indexPath, "utf8")); } catch {}
index = index.filter((e) => e.name !== name && (e.relation || e.relations));
index.push({ name, title: out.title, relations: relationIds });
await fs.writeFile(indexPath, JSON.stringify(index, null, 2));

console.log(
  `wrote data/${name}.json (${(json.length / 1e6).toFixed(1)} MB) — water ${out.water.length}, rivers ${out.rivers.length}, ` +
    `green ${out.green.length}, roads ${out.roads.length}, landmarks ${out.landmarks.length}`
);
console.log(`DONE ${name}`);
