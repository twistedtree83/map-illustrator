#!/usr/bin/env node
// List the suburbs/districts inside an OSM boundary relation, so a large area
// (e.g. a council) can be narrowed to a few of its suburbs.
//
//   node scripts/children.mjs <relation id>
//
// Prints JSON to stdout; progress goes to stderr.

import osmtogeojson from "osmtogeojson";
import { overpass, isArea, polys, pointsOf, interiorPoint, contains } from "./osm-lib.mjs";
import { findLocalFile, localRegions, localExtract, localBoundaries } from "./osm-local.mjs";

const id = Number(process.argv[2]);
if (!id) {
  console.error("usage: node scripts/children.mjs <relation id>");
  process.exit(1);
}

const q = `
[out:json][timeout:180];
rel(${id})->.r; .r map_to_area->.a;
( .r; rel(area.a)["boundary"="administrative"]["admin_level"~"^(7|8|9|10|11)$"]; );
out body; >; out skel qt;`;

// Local downloaded file first (a few seconds), then the public servers.
let gj;
const localFile = findLocalFile([id]);
if (localFile) {
  const regs = localRegions(localFile, [id]).filter((f) => f.id === `relation/${id}` && isArea(f.geometry));
  if (regs.length) {
    const pts = pointsOf(regs[0].geometry);
    const cut = localExtract(localFile, [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]);
    gj = { features: [regs[0], ...localBoundaries(cut).filter((f) => f.id !== regs[0].id)] };
    process.stderr.write("boundaries: local file … ok\n");
  }
}
if (!gj) gj = osmtogeojson(await overpass(q, "boundaries", process.stderr));
const region = gj.features.find((f) => f.id === `relation/${id}`);
if (!region || !isArea(region.geometry)) {
  console.log(JSON.stringify({ error: "That area has no usable outline in OpenStreetMap." }));
  process.exit(0);
}
const rl = Number(region.properties.admin_level || 0);

// Rough area in km² of a polygon (planar, scaled at its latitude).
function km2(geom) {
  let total = 0;
  for (const poly of polys(geom)) {
    poly.forEach((ring, i) => {
      const lat = ring[0][1], kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
      let a = 0;
      for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) a += (ring[k][0] * kx) * (ring[j][1] * ky) - (ring[j][0] * kx) * (ring[k][1] * ky);
      total += (i === 0 ? 1 : -1) * Math.abs(a / 2);
    });
  }
  return Math.max(0, total);
}

// Keep areas whose interior point falls inside the region (drops neighbours
// that only touch its border), grouped by admin level.
const byLevel = new Map();
for (const f of gj.features) {
  const t = f.properties || {};
  if (f === region || t.boundary !== "administrative" || !isArea(f.geometry)) continue;
  const lvl = Number(t.admin_level);
  if (!(lvl > rl)) continue;
  const p = interiorPoint(f.geometry);
  if (!p || !contains(region.geometry, p)) continue;
  if (!byLevel.has(lvl)) byLevel.set(lvl, []);
  byLevel.get(lvl).push({
    id: Number(f.id.split("/")[1]),
    name: t["name:en"] || t.name || f.id,
    qid: t.wikidata || null,
    km2: Math.round(km2(f.geometry) * 10) / 10,
  });
}

const levels = [...byLevel.entries()]
  .filter(([, list]) => list.length >= 2)
  .map(([level, list]) => ({ level, count: list.length, children: list.sort((a, b) => a.name.localeCompare(b.name)) }))
  .sort((a, b) => b.count - a.count);

console.log(JSON.stringify({
  region: { id, name: region.properties["name:en"] || region.properties.name, level: rl, km2: Math.round(km2(region.geometry)) },
  levels,
}));
