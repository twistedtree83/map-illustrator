#!/usr/bin/env node
// Build a searchable index of every named area outline (councils, suburbs,
// localities, regions…) in the downloaded .osm.pbf files, so the editor's
// search can find areas instantly and without the public servers.
//
//   node scripts/area-index.mjs          # (re)builds data-src/<file>.areas.json if the .pbf is newer
//
// Each entry: id (relation), name, alt (other names), kind, level, wikidata,
// bbox [w,s,e,n], km2, in (containing council, or state).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { isArea, polys, interiorPoint, contains } from "./osm-lib.mjs";
import { localFiles } from "./osm-local.mjs";

const KIND = {
  2: "Country", 3: "Region", 4: "State", 5: "Region", 6: "Council area", 7: "District",
  8: "Municipality", 9: "Suburb", 10: "Suburb", 11: "Neighbourhood",
};
const PLACE_KIND = {
  region: "Region", borough: "Region", district: "District", territory: "Territory", state: "State",
  municipality: "Municipality", city: "City", town: "Town", village: "Village", suburb: "Suburb",
  quarter: "Quarter", neighbourhood: "Neighbourhood", locality: "Locality", hamlet: "Hamlet",
};

function km2(geom) {
  let total = 0;
  for (const poly of polys(geom)) {
    poly.forEach((ring, i) => {
      const lat = ring[0][1], kx = 111.32 * Math.cos((lat * Math.PI) / 180), ky = 110.57;
      let a = 0;
      for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) a += ring[k][0] * kx * (ring[j][1] * ky) - ring[j][0] * kx * (ring[k][1] * ky);
      total += (i === 0 ? 1 : -1) * Math.abs(a / 2);
    });
  }
  return Math.max(0, total);
}

function bboxOf(geom) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of polys(geom)) for (const [x, y] of poly[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return [w, s, e, n].map((v) => Math.round(v * 1e4) / 1e4);
}

export const indexPath = (pbf) => pbf.replace(/\.osm\.pbf$/, ".areas.json");

async function build(pbf) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "areas-"));
  try {
    const cut = path.join(tmp, "a.pbf"), seq = path.join(tmp, "a.geojsonseq");
    let r = spawnSync("osmium", ["tags-filter", pbf, "r/boundary=administrative", "r/place", "-o", cut, "-O"], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    r = spawnSync("osmium", ["export", cut, "-f", "geojsonseq", "-a", "type,id", "-o", seq, "-O"], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);

    const items = [];
    const rl = readline.createInterface({ input: fs.createReadStream(seq) });
    for await (const line of rl) {
      const f = JSON.parse(line.replace(/^\x1e/, ""));
      const { "@type": type, "@id": id, ...t } = f.properties || {};
      if (type !== "relation" || !t.name || !isArea(f.geometry)) continue;
      const level = Number(t.admin_level) || null;
      const kind = (t.boundary === "administrative" && KIND[level]) || PLACE_KIND[t.place] || "Area";
      if (t.place === "island" || t.place === "islet" || t.place === "farm" || t.place === "square") continue;
      const alt = [t["name:en"], t.alt_name, t.official_name, t.short_name, t.old_name]
        .filter(Boolean).flatMap((v) => v.split(";")).filter((v) => v !== t.name);
      items.push({ id: Number(id), name: t.name, alt, kind, level, wikidata: t.wikidata || null,
        bbox: bboxOf(f.geometry), km2: Math.round(km2(f.geometry) * 10) / 10, _g: f.geometry, _p: interiorPoint(f.geometry) });
    }
    // "in": the council containing it (or the state, for councils and bigger).
    const councils = items.filter((i) => i.level === 6), states = items.filter((i) => i.level === 4);
    const inside = (c, [x, y]) => x >= c.bbox[0] && x <= c.bbox[2] && y >= c.bbox[1] && y <= c.bbox[3] && contains(c._g, [x, y]);
    for (const i of items) {
      const p = i._p;
      const c = i.level !== 6 && i.level !== 4 && councils.find((c) => c.id !== i.id && c.km2 > i.km2 * 1.05 && inside(c, p));
      const s = states.find((s) => s.id !== i.id && inside(s, p));
      i.in = [c?.name, s?.name].filter(Boolean).join(", ") || null;
    }
    for (const i of items) { delete i._g; delete i._p; }
    return items.filter((i) => i.km2 >= 0.05); // drops wharves etc. mis-tagged as boundaries
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Index for every local file, rebuilt when the .pbf is newer than its index.
export async function loadIndexes(log = process.stderr) {
  const all = [];
  for (const pbf of localFiles()) {
    const out = indexPath(pbf);
    let fresh = false;
    try { fresh = fs.statSync(out).mtimeMs >= Math.max(fs.statSync(pbf).mtimeMs, fs.statSync(import.meta.filename).mtimeMs); } catch {}
    if (!fresh) {
      log.write(`indexing areas in ${path.basename(pbf)} …\n`);
      fs.writeFileSync(out, JSON.stringify(await build(pbf)));
    }
    all.push(...JSON.parse(fs.readFileSync(out, "utf8")));
  }
  return all;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const t = Date.now();
  const items = await loadIndexes();
  console.log(`${items.length} areas indexed (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}
