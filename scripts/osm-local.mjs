// Read OpenStreetMap data from downloaded .osm.pbf files in data-src/ using
// osmium, as a fast offline alternative to the public Overpass servers.
//
// Output mirrors osmtogeojson's: features with id "relation/123" / "way/45" /
// "node/6" and the OSM tags as properties, so the rest of the build is shared.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const DATA_SRC = path.resolve(import.meta.dirname, "..", "data-src");

function osmium(args) {
  const r = spawnSync("osmium", args, { encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.error) throw r.error;
  return r;
}

export function osmiumAvailable() {
  try { return osmium(["--version"]).status === 0; } catch { return false; }
}

export function localFiles() {
  try {
    return fs.readdirSync(DATA_SRC).filter((f) => f.endsWith(".osm.pbf")).map((f) => path.join(DATA_SRC, f));
  } catch { return []; }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mapinteractive-"));
let tmpN = 0;
const tmp = (ext) => path.join(tmpDir, `${++tmpN}.${ext}`);
process.on("exit", () => fs.rmSync(tmpDir, { recursive: true, force: true }));

function check(r, what) {
  if (r.status !== 0) throw new Error(`osmium ${what} failed: ${(r.stderr || "").trim().split("\n").pop()}`);
}

// osmium export → osmtogeojson-style features.
function exportFeatures(pbf) {
  const out = tmp("geojson");
  check(osmium(["export", pbf, "-o", out, "-O", "-f", "geojson", "-a", "type,id"]), "export");
  const gj = JSON.parse(fs.readFileSync(out, "utf8"));
  fs.rmSync(out, { force: true });
  return gj.features.map((f) => {
    const { "@type": type, "@id": id, ...tags } = f.properties || {};
    return { type: "Feature", id: `${type}/${id}`, properties: tags, geometry: f.geometry };
  });
}

// The first local file that contains every requested relation, or null.
export function findLocalFile(relationIds) {
  if (!osmiumAvailable()) return null;
  for (const file of localFiles()) {
    const probe = tmp("pbf");
    const r = osmium(["getid", file, ...relationIds.map((id) => `r${id}`), "-o", probe, "-O"]);
    fs.rmSync(probe, { force: true });
    if (r.status === 0) return file; // exits non-zero when any id is missing
  }
  return null;
}

// Region outlines (complete relations) from a local file.
export function localRegions(file, relationIds) {
  const out = tmp("pbf");
  check(osmium(["getid", "-r", file, ...relationIds.map((id) => `r${id}`), "-o", out, "-O"]), "getid");
  const feats = exportFeatures(out);
  fs.rmSync(out, { force: true });
  return feats;
}

// Cut a bounding box out of the big file once; later filters run on the cut.
export function localExtract(file, [w, s, e, n]) {
  const pad = 0.01;
  const out = tmp("pbf");
  // "smart" completes relations crossing the box edge; by default only
  // multipolygons, so boundaries (suburbs straddling the edge) are added too.
  check(osmium(["extract", "-b", `${w - pad},${s - pad},${e + pad},${n + pad}`, "-s", "smart", "-S", "types=multipolygon,boundary", file, "-o", out, "-O"]), "extract");
  return out;
}

export function localBoundaries(cut) {
  const out = tmp("pbf");
  check(osmium(["tags-filter", cut, "r/boundary=administrative", "-o", out, "-O"]), "tags-filter");
  const feats = exportFeatures(out);
  fs.rmSync(out, { force: true });
  return feats;
}

// Same feature set as the Overpass feature query.
export function localFeatures(cut) {
  const filters = [
    "nwr/natural=water,wood,scrub",
    "nwr/waterway=riverbank,river,canal",
    "nwr/leisure=park,nature_reserve,garden,stadium",
    "nwr/landuse=forest,grass,meadow,recreation_ground,cemetery,vineyard",
    "w/highway=motorway,trunk,primary,secondary,tertiary,residential,living_street,pedestrian",
    "nwr/tourism=attraction,museum,viewpoint,zoo,gallery",
    "nwr/historic=castle,monument,memorial,church,city_gate,tower,fort,palace",
    "nwr/amenity=place_of_worship,school,university,hospital,theatre",
    "nwr/man_made=bridge,tower",
  ];
  const out = tmp("pbf");
  check(osmium(["tags-filter", cut, ...filters, "-o", out, "-O"]), "tags-filter");
  const feats = exportFeatures(out);
  fs.rmSync(out, { force: true });
  return feats;
}

// Address points (buildings/entrances/nodes with a house number and street).
export function localAddresses(cut) {
  const out = tmp("pbf");
  check(osmium(["tags-filter", cut, "nwr/addr:housenumber", "-o", out, "-O"]), "tags-filter");
  const feats = exportFeatures(out).filter((f) => f.properties["addr:street"] || f.properties["addr:place"]);
  fs.rmSync(out, { force: true });
  return feats;
}
