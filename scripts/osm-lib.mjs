// Shared OpenStreetMap helpers for the fetch scripts.

export const UA = "mapinteractive-prototype/0.3";

export const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Progress goes to `log` (stdout by default; stderr for scripts that print JSON).
export async function overpass(q, label, log = process.stdout) {
  let wait = 5_000;
  for (let attempt = 0; attempt < 12; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      log.write(`${label}: ${new URL(url).host} (attempt ${attempt + 1}) … `);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
        body: "data=" + encodeURIComponent(q),
        signal: AbortSignal.timeout(300_000),
      });
      const text = await res.text();
      if (res.ok && text.trimStart().startsWith("{")) {
        const json = JSON.parse(text);
        if (json.remark && /runtime error/i.test(json.remark)) throw new Error(json.remark);
        log.write(`ok (${(text.length / 1e6).toFixed(1)} MB)\n`);
        return json;
      }
      log.write(`HTTP ${res.status}\n`);
    } catch (e) {
      log.write((e.name === "TimeoutError" ? "timeout" : e.message) + "\n");
    }
    log.write(`  waiting ${wait / 1000}s\n`);
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 60_000);
  }
  throw new Error("All Overpass endpoints failed. Try again later.");
}


export const round = (n) => Math.round(n * 1e5) / 1e5;
export const roundCoords = (c) => (typeof c[0] === "number" ? [round(c[0]), round(c[1])] : c.map(roundCoords));
export const isArea = (g) => g && (g.type === "Polygon" || g.type === "MultiPolygon");
export const isLine = (g) => g && (g.type === "LineString" || g.type === "MultiLineString");
export const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
export const lines = (g) => (g.type === "LineString" ? [g.coordinates] : g.coordinates);

export function pointsOf(geom) {
  const pts = [];
  const walk = (c) => (typeof c[0] === "number" ? pts.push(c) : c.forEach(walk));
  walk(geom.coordinates);
  return pts;
}
export function centroid(geom) {
  if (geom.type === "Point") return geom.coordinates;
  const pts = pointsOf(geom);
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}
// Area-weighted centroid of the largest ring: a better "inside" point for districts.
export function interiorPoint(geom) {
  let best = null, bestA = 0;
  for (const poly of polys(geom)) {
    const r = poly[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
    }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
  }
  return best;
}
// Planar even-odd point-in-polygon; fine at city scale.
export function contains(geom, [x, y]) {
  let inside = false;
  for (const poly of polys(geom)) for (const ring of poly)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}


// Best English label from OSM tags. `source` records where it came from so the
// editor can flag names that are only in the local language.
export function englishName(t = {}) {
  const local = t.name || null;
  if (t["name:en"]) return { name: t["name:en"], local, source: "osm-en" };
  if (t.int_name) return { name: t.int_name, local, source: "osm-int" };
  return { name: local, local, source: "local" };
}

// English labels from Wikidata, 50 ids per request.
export async function wikidataLabels(qids, log = process.stdout) {
  const ids = [...new Set(qids.filter((q) => /^Q\d+$/.test(q || "")))];
  const out = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&props=labels&languages=en&ids=${batch.join("|")}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) });
      const ents = (await res.json()).entities || {};
      for (const [q, e] of Object.entries(ents)) if (e.labels?.en?.value) out.set(q, e.labels.en.value);
    } catch (e) {
      log.write(`  wikidata batch failed (${e.message}); keeping OSM names for those\n`);
    }
  }
  return out;
}

// Upgrade local-only / international names to Wikidata's English label.
export async function applyWikidataLabels(items, log = process.stdout) {
  const need = items.filter((x) => x.qid && x.nameSource !== "osm-en" && x.nameSource !== "overture-en");
  if (!need.length) return 0;
  const labels = await wikidataLabels(need.map((x) => x.qid), log);
  let n = 0;
  for (const x of need) {
    const en = labels.get(x.qid);
    if (en && en !== x.name) { x.name = en; x.nameSource = "wikidata"; n++; }
    else if (en) x.nameSource = "wikidata";
  }
  return n;
}

// A usable http(s) URL from a tag value, or null ("example.com" -> "https://example.com").
export function cleanWebsite(v) {
  if (!v) return null;
  let u = String(v).split(";")[0].trim();
  if (!u || /\s/.test(u)) return null;
  if (!/^https?:\/\//i.test(u)) u = `https://${u.replace(/^\/+/, "")}`;
  try {
    const url = new URL(u);
    // Reference pages aren't the place's own website (Wikipedia has its own field).
    if (/(^|\.)(wikipedia|wikidata|wikimedia|openstreetmap|wikivoyage)\.org$/i.test(url.hostname)) return null;
    return /^https?:$/.test(url.protocol) && url.hostname.includes(".") ? url.href : null;
  } catch { return null; }
}

export const websiteFromTags = (t = {}) => cleanWebsite(t.website || t["contact:website"] || t.url);

// Official websites (P856) from Wikidata for items that don't have one yet.
export async function applyWikidataWebsites(items, log = process.stdout) {
  const need = items.filter((x) => !x.website && /^Q\d+$/.test(x.qid || ""));
  const ids = [...new Set(need.map((x) => x.qid))];
  const found = new Map();
  for (let i = 0; i < ids.length; i += 50) {
    const url = `https://www.wikidata.org/w/api.php?format=json&action=wbgetentities&props=claims&ids=${ids.slice(i, i + 50).join("|")}`;
    try {
      const ents = (await (await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(30000) })).json()).entities || {};
      for (const [q, e] of Object.entries(ents)) {
        const site = cleanWebsite(e.claims?.P856?.[0]?.mainsnak?.datavalue?.value);
        if (site) found.set(q, site);
      }
    } catch (e) { log.write(`  wikidata websites batch failed (${e.message})\n`); }
  }
  let n = 0;
  for (const x of need) if (found.has(x.qid)) { x.website = found.get(x.qid); x.websiteSource = "wikidata"; n++; }
  return n;
}
