// Shared helpers for the directory site. Everything is read from ../map.json at
// runtime, so a rebuilt map (new areas, places, palette, fonts) needs no code changes.

const KIT_ROOT = new URL("../../", import.meta.url);
export const MANIFEST_URL = new URL("map.json", KIT_ROOT);

const FALLBACK_DISPLAY = `"Avenir Next", "Segoe UI", system-ui, sans-serif`;
const FALLBACK_BODY = `system-ui, -apple-system, "Segoe UI", sans-serif`;

export const esc = (t) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Lower-case, accent-free text for search matching. */
export const norm = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Wikidata-style short descriptions are lower-case fragments; make them read as a sentence. */
export const sentence = (t) => {
  const s = String(t ?? "").trim();
  if (!s) return "";
  return s[0].toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");
};

export const areaHref = (slug) => `area.html?slug=${encodeURIComponent(slug)}`;
export const placeHref = (slug) => `place.html?slug=${encodeURIComponent(slug)}`;

/** coord is [lon, lat]. */
// A place's primary link: its own website when known, otherwise its page here.
export const linkFor = (item) =>
  item.website ? { href: item.website, external: true } : item.slug ? { href: placeHref(item.slug), external: false } : { href: osmHref(item.coord), external: true };

// A directory row for a place or landmark.
export function listingRow(kit, item, size = 28) {
  const { href, external } = linkFor(item);
  const ext = external ? ` target="_blank" rel="noopener"` : "";
  const mark = external ? `<span class="ext-mark" aria-hidden="true">↗</span><span class="visually-hidden"> (opens ${item.website ? "its website" : "a map"})</span>` : "";
  const addr = item.address?.formatted ? `<span class="addr">${item.address.approximate ? "near " : ""}${esc(item.address.formatted)}</span>` : "";
  return `<a class="row" href="${esc(href)}"${ext}>${iconImg(kit, item, size)}<span class="name">${esc(item.name)}${mark}${addr}</span><span class="type">${esc(kit.typeLabel(item))}</span></a>`;
}

export const osmHref = ([lon, lat]) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`;

export const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export const param = (name) => new URLSearchParams(location.search).get(name);

/**
 * Resolves when the <illustrated-map> has drawn. Call this before any await so the
 * one-off "map-ready" event can't fire before we listen.
 */
export function mapReady(el) {
  return new Promise((resolve) => {
    if (el.areaEls) return resolve(el.manifest); // already drawn (component has no public "ready" flag)
    el.addEventListener("map-ready", (e) => resolve(e.detail.map), { once: true });
  });
}

/** Fetch map.json, apply its palette/fonts/attribution to the page and build lookups. */
export async function loadKit() {
  let data;
  try {
    const res = await fetch(MANIFEST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    showFatal(
      `Couldn't load the map data (${esc(err.message)}). ` +
        (location.protocol === "file:" ? "Open this site through a web server rather than from the file system." : "Please try again later.")
    );
    throw err;
  }
  applyTheme(data);
  applyChrome(data);
  return buildIndex(data);
}

function buildIndex(data) {
  const areas = new Map(data.areas.map((a) => [a.slug, a]));
  const places = new Map(data.places.map((p) => [p.slug, p]));
  // Landmarks share the slug namespace, so place.html can show them too.
  const listings = new Map([...places, ...(data.moreLandmarks || []).filter((l) => l.slug).map((l) => [l.slug, l])]);
  const types = new Map((data.types || []).map((t) => [t.kind, t]));
  const landmarksByArea = new Map();
  for (const l of data.moreLandmarks || []) {
    if (!landmarksByArea.has(l.area)) landmarksByArea.set(l.area, []);
    landmarksByArea.get(l.area).push(l);
  }
  for (const list of landmarksByArea.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const land = data.palette?.land || [];
  const areaIndex = new Map(data.areas.map((a, i) => [a.slug, i]));

  const kit = {
    data,
    areas,
    places,
    listings,
    types,
    /** On-map places in an area, in manifest order. */
    placesIn: (slug) => (areas.get(slug)?.places || []).map((s) => places.get(s)).filter(Boolean),
    /** moreLandmarks (not drawn on the map) in an area, A–Z. */
    landmarksIn: (slug) => landmarksByArea.get(slug) || [],
    typeLabel: (item) => item.typeLabel || types.get(item.kind)?.label || item.kind,
    iconFor: (item) => {
      const path = item.icon || types.get(item.kind)?.icon || `${data.files?.icons || "icons/"}${item.kind}.svg`;
      return new URL(path, MANIFEST_URL).href;
    },
    /** A land colour from the palette, so area badges echo the map's fills. */
    tint: (slug) => {
      if (!land.length) return "var(--green)";
      const a = areas.get(slug);
      const i = a?.number ?? areaIndex.get(slug) ?? 0;
      return land[i % land.length];
    },
  };
  return kit;
}

function applyTheme(data) {
  const p = data.palette || {};
  const root = document.documentElement.style;
  const set = (k, v) => typeof v === "string" && v && root.setProperty(k, v);
  for (const key of ["paper", "ink", "text", "water", "green", "accent", "accent2", "roof", "selected"]) set(`--${key}`, p[key]);
  (p.land || []).forEach((c, i) => set(`--land-${i}`, c));

  const f = data.fonts || {};
  if (f.display) set("--font-display", `"${f.display}", ${FALLBACK_DISPLAY}`);
  if (f.body) set("--font-body", `"${f.body}", ${FALLBACK_BODY}`);
  if (typeof f.googleFonts === "string" && f.googleFonts.startsWith("https://fonts.googleapis.com/") && !document.querySelector("link[data-kit-fonts]")) {
    for (const href of ["https://fonts.googleapis.com", "https://fonts.gstatic.com"]) {
      const pre = document.createElement("link");
      pre.rel = "preconnect";
      pre.href = href;
      if (href.includes("gstatic")) pre.crossOrigin = "";
      document.head.append(pre);
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = f.googleFonts;
    link.dataset.kitFonts = "";
    document.head.append(link);
  }
}

function applyChrome(data) {
  for (const el of document.querySelectorAll("[data-kit-title]")) el.textContent = data.title;
  for (const el of document.querySelectorAll("[data-kit-attribution]")) el.textContent = data.attribution;
  const stats = document.querySelector("[data-kit-stats]");
  if (stats) {
    const more = (data.moreLandmarks || []).length;
    stats.textContent = [plural(data.areas.length, "area"), `${plural(data.places.length, "place")} on the map`, more ? `${more} more landmarks` : ""]
      .filter(Boolean)
      .join(" · ");
  }
  const gen = document.querySelector("[data-kit-generated]");
  if (gen && data.generatedAt) {
    const d = new Date(data.generatedAt);
    if (!isNaN(d)) gen.textContent = `Map data compiled ${d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}.`;
  }
}

export function setTitle(kit, name) {
  document.title = name ? `${name} · ${kit.data.title}` : kit.data.title;
}

export function showFatal(html) {
  const main = document.querySelector("main");
  if (main) main.innerHTML = `<div class="notice" role="alert"><h1>Something went wrong</h1><p>${html}</p></div>`;
}

export function showNotFound(kind, slug) {
  const main = document.querySelector("main");
  main.innerHTML = `<div class="notice" role="alert">
    <h1>${esc(kind)} not found</h1>
    <p>${slug ? `There's no ${esc(kind.toLowerCase())} called “${esc(slug)}” on this map.` : `No ${esc(kind.toLowerCase())} was given.`}
    It may have been renamed when the map was rebuilt.</p>
    <p><a class="button" href="index.html">Browse the directory</a></p></div>`;
}

/** Icon <img>. Decorative: the label next to it carries the meaning. */
export const iconImg = (kit, item, size = 28) =>
  `<img class="icon" src="${esc(kit.iconFor(item))}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async">`;

export const areaBadge = (kit, area) =>
  area.number != null ? `<span class="num" style="--tint:${esc(kit.tint(area.slug))}" aria-label="Map number ${area.number}">${area.number}</span>` : "";

// Hide icons that fail to load (e.g. a landmark kind with no icon file) rather than show a broken image.
document.addEventListener(
  "error",
  (e) => {
    if (e.target instanceof HTMLImageElement && e.target.classList.contains("icon")) e.target.classList.add("is-broken");
  },
  true
);
