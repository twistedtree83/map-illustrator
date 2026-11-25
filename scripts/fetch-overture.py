#!/usr/bin/env python3
"""Pull neighbourhood boundaries and landmark-type places from Overture Maps.

Overture publishes GeoParquet files on a public S3 bucket (no key needed).
DuckDB reads only the rows inside the bounding box, so this is quick.

Run via uv so DuckDB doesn't need installing globally:
  uv run --quiet --with duckdb python scripts/fetch-overture.py --bbox W,S,E,N --out file.json
"""
import argparse, json, re, sys, time, urllib.request

import duckdb

BUCKET = "overturemaps-us-west-2"

ap = argparse.ArgumentParser()
ap.add_argument("--bbox", required=True, help="west,south,east,north")
ap.add_argument("--out", required=True)
ap.add_argument("--release", help="defaults to the latest release")
a = ap.parse_args()
w, s, e, n = (float(v) for v in a.bbox.split(","))


def latest_release():
    url = f"https://{BUCKET}.s3.amazonaws.com/?list-type=2&prefix=release/&delimiter=/"
    xml = urllib.request.urlopen(url, timeout=30).read().decode()
    releases = re.findall(r"<Prefix>release/([^/<]+)/</Prefix>", xml)
    if not releases:
        sys.exit("Could not list Overture releases")
    return sorted(releases)[-1]


release = a.release or latest_release()
base = f"s3://{BUCKET}/release/{release}"
print(f"overture: release {release}", flush=True)

con = duckdb.connect()
con.execute("INSTALL spatial; LOAD spatial; INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
inside = f"bbox.xmin < {e} AND bbox.xmax > {w} AND bbox.ymin < {n} AND bbox.ymax > {s}"

t = time.time()
areas = con.execute(f"""
  SELECT id, subtype, names.primary AS name, names.common['en'] AS name_en, ST_AsGeoJSON(geometry) AS geom
  FROM read_parquet('{base}/theme=divisions/type=division_area/*', hive_partitioning=1)
  WHERE {inside} AND subtype IN ('macrohood', 'neighborhood', 'microhood') AND names.primary IS NOT NULL
""").fetchall()
print(f"overture: {len(areas)} neighbourhood areas ({time.time() - t:.0f}s)", flush=True)

PLACE_RE = "museum|church|cathedral|religious|worship|temple|mosque|synagogue|castle|palace|monument|stadium|arena|zoo|aquarium|theatre|theater|bridge|landmark|historic|tower|observatory|amusement|tourist_attraction"
t = time.time()
places = con.execute(f"""
  SELECT id, names.primary AS name, names.common['en'] AS name_en, taxonomy.primary AS cat, basic_category AS basic, confidence,
         addresses[1].freeform AS a_free, addresses[1].locality AS a_loc, addresses[1].postcode AS a_pc, addresses[1].region AS a_reg,
         websites[1] AS website,
         ST_X(ST_Centroid(geometry)) AS x, ST_Y(ST_Centroid(geometry)) AS y
  FROM read_parquet('{base}/theme=places/type=place/*', hive_partitioning=1)
  WHERE {inside} AND confidence >= 0.75 AND names.primary IS NOT NULL
    AND regexp_matches(coalesce(taxonomy.primary, '') || ' ' || coalesce(basic_category, ''), '{PLACE_RE}')
    AND NOT regexp_matches(coalesce(taxonomy.primary, '') || ' ' || coalesce(basic_category, ''), 'movie|cinema|drive_in|production|_service|school')
""").fetchall()
print(f"overture: {len(places)} landmark places ({time.time() - t:.0f}s)", flush=True)

out = {
    "release": release,
    "areas": [{"id": i, "subtype": st, "name": nm, "name_en": en, "geometry": json.loads(g)} for i, st, nm, en, g in areas],
    "places": [
        {"id": i, "name": nm, "name_en": en, "cat": c or b, "confidence": round(conf, 2), "coord": [round(x, 6), round(y, 6)],
         "address": {"freeform": af, "locality": al, "postcode": apc, "region": ar} if af else None,
         "website": web}
        for i, nm, en, c, b, conf, af, al, apc, ar, web, x, y in places
    ],
}
with open(a.out, "w") as f:
    json.dump(out, f)
print("overture: done", flush=True)
