// Street addresses for landmarks and places.
//
// Order of preference:
//   1. the feature's own address (OSM addr:* tags, or Overture's address)   exact
//   2. the nearest OSM address point within ~80 m                           approximate
//   3. the nearest named street within ~80 m                                approximate
// Suburb comes from the address or the containing district; postcode from the
// address or the nearest address point that has one; state/country from one
// reverse-geocode of the map centre.

import { UA } from "./osm-lib.mjs";

// Countries that write the house number before the street name.
const NUMBER_FIRST = new Set(["au", "nz", "us", "ca", "gb", "ie", "fr", "za", "in", "sg", "my", "ph", "lk", "ng", "ke"]);
const AU_STATES = {
  "new south wales": "NSW", victoria: "VIC", queensland: "QLD", "south australia": "SA", "western australia": "WA",
  tasmania: "TAS", "northern territory": "NT", "australian capital territory": "ACT",
};

export function addressFromTags(t = {}) {
  const street = t["addr:street"] || t["addr:place"] || null;
  if (!street) return null;
  return {
    housenumber: t["addr:housenumber"] || null,
    street,
    suburb: t["addr:suburb"] || t["addr:city"] || null,
    postcode: t["addr:postcode"] || null,
    state: t["addr:state"] || null,
  };
}

// Overture's address record: { freeform: "12 High St", locality, postcode, region, country }.
export function addressFromOverture(a) {
  if (!a?.freeform) return null;
  const m = a.freeform.match(/^(\d+[a-zA-Z]?(?:[-/]\d+[a-zA-Z]?)?)\s+(.+)$/) || a.freeform.match(/^(.+?)\s+(\d+[a-zA-Z]?(?:\/\d+)?)$/);
  const [housenumber, street] = !m ? [null, a.freeform] : /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  // Overture regions are often ISO codes like "AU-NSW"; keep the subdivision part.
  const state = a.region ? a.region.replace(/^[A-Z]{2}-/, "") : null;
  return { housenumber, street, suburb: a.locality || null, postcode: a.postcode || null, state };
}

// One reverse-geocode for the whole map: state and country names.
export async function regionDefaults([lon, lat]) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=8&addressdetails=1&accept-language=en&lat=${lat}&lon=${lon}`;
    const r = await (await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) })).json();
    const a = r.address || {};
    return { state: a.state || a.region || null, country: a.country || null, countryCode: (a.country_code || "").toLowerCase() || null };
  } catch {
    return { state: null, country: null, countryCode: null };
  }
}

// Simple spatial grid for nearest-point lookups (lon/lat, small distances).
class Grid {
  constructor(cell = 0.004) { this.cell = cell; this.cells = new Map(); }
  key(x, y) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`; }
  add(x, y, item) {
    const k = this.key(x, y);
    if (!this.cells.has(k)) this.cells.set(k, []);
    this.cells.get(k).push([x, y, item]);
  }
  nearest([x, y], maxMetres, accept = () => true) {
    const kx = 111320 * Math.cos((y * Math.PI) / 180), ky = 110540;
    const r = Math.ceil(maxMetres / (Math.min(kx, ky) * this.cell));
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best = null, bestD = maxMetres;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
      for (const [px, py, item] of this.cells.get(`${cx + i},${cy + j}`) || []) {
        const d = Math.hypot((px - x) * kx, (py - y) * ky);
        if (d < bestD && accept(item)) { bestD = d; best = item; }
      }
    }
    return best ? { item: best, metres: Math.round(bestD) } : null;
  }
}

/**
 * Fill `item.address` for every item ({coord, address?}).
 *   points:   [{coord, tags}] OSM address points (addr:housenumber + addr:street)
 *   streets:  [{coord, name}] sampled vertices of named roads
 *   suburbOf: (coord) => name of the containing district, or null
 *   defaults: { state, country, countryCode }
 */
export function fillAddresses(items, { points, streets, suburbOf, defaults }) {
  const addrGrid = new Grid(0.002), pcGrid = new Grid(0.02), streetGrid = new Grid(0.002);
  for (const p of points) {
    const a = addressFromTags(p.tags);
    if (a) addrGrid.add(p.coord[0], p.coord[1], a);
    if (p.tags["addr:postcode"]) pcGrid.add(p.coord[0], p.coord[1], p.tags["addr:postcode"]);
  }
  for (const s of streets) streetGrid.add(s.coord[0], s.coord[1], s.name);

  const stats = { exact: 0, nearestAddress: 0, nearestStreet: 0, areaOnly: 0, none: 0 };
  for (const it of items) {
    let a = it.address ? { ...it.address } : null;
    let source = it.addressSource || (a ? "feature" : null);
    let approximate = false;
    if (!a) {
      const hit = addrGrid.nearest(it.coord, 80);
      if (hit) { a = { ...hit.item }; source = "nearest-address"; approximate = true; }
    }
    if (!a) {
      // Lookouts and parks are often well off the road; 400 m still names the access road.
      const hit = streetGrid.nearest(it.coord, 400);
      if (hit) { a = { housenumber: null, street: hit.item, suburb: null, postcode: null, state: null, streetDistance: hit.metres }; source = "nearest-street"; approximate = true; }
    }
    if (!a && suburbOf(it.coord)) {
      // Last resort: suburb, state and postcode only.
      a = { housenumber: null, street: null, suburb: null, postcode: null, state: null };
      source = "area";
      approximate = true;
    }
    if (!a) { stats.none++; it.address = null; continue; }
    // Sources sometimes give the council as the locality; prefer the actual suburb.
    if (!a.suburb || /\b(council|shire|city of|municipality|region)\b/i.test(a.suburb)) a.suburb = suburbOf(it.coord) || a.suburb || null;
    if (!a.postcode) a.postcode = pcGrid.nearest(it.coord, 6000)?.item || null;
    a.state = a.state || defaults.state || null;
    a.country = defaults.country || null;
    a.countryCode = defaults.countryCode || null;
    a.line = formatLine(a, defaults.countryCode);
    a.formatted = formatAddress(a, defaults.countryCode);
    a.approximate = approximate;
    a.source = source;
    it.address = a;
    stats[{ "nearest-address": "nearestAddress", "nearest-street": "nearestStreet", area: "areaOnly" }[source] || "exact"]++;
  }
  return stats;
}

export function formatLine(a, cc) {
  if (!a.street) return null;
  if (!a.housenumber) return a.street;
  return NUMBER_FIRST.has(cc) ? `${a.housenumber} ${a.street}` : `${a.street} ${a.housenumber}`;
}

// Local conventions: "1 High St, Penrith NSW 2750" / "Karlova 12, 110 00 Praha".
export function formatAddress(a, cc) {
  const line = formatLine(a, cc);
  if (cc === "au") {
    const st = AU_STATES[(a.state || "").toLowerCase()] || a.state;
    return [line, [a.suburb, st, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  }
  if (cc === "us" || cc === "ca") return [line, a.suburb, [a.state, a.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  if (cc === "gb" || cc === "ie" || cc === "nz") return [line, a.suburb, a.postcode].filter(Boolean).join(", ");
  return [line, [a.postcode, a.suburb].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}
