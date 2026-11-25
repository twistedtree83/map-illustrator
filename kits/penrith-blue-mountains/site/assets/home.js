import { loadKit, mapReady, esc, norm, plural, areaHref, placeHref, osmHref, iconImg, areaBadge , listingRow } from "./common.js";

const map = document.getElementById("map");
const ready = mapReady(map); // listen before any await
const input = document.getElementById("q");
const clearBtn = document.querySelector(".search .clear");
const chipsEl = document.getElementById("chips");
const statusEl = document.getElementById("status");
const dirEl = document.getElementById("directory");

const kit = await loadKit();
const { data } = kit;
document.title = `${data.title}: map & directory`;

// ------------------------------------------------------------ build the directory

const byName = (a, b) => a.name.localeCompare(b.name);
const listed = data.areas.filter((a) => kit.placesIn(a.slug).length || kit.landmarksIn(a.slug).length).sort(byName);
const unlisted = data.areas.filter((a) => !listed.includes(a)).sort(byName);

const placeRow = (p) => `
  <li data-area="${esc(p.area || "")}" data-place="${esc(p.slug)}">
    ${listingRow(kit, p)}
  </li>`;

const landmarkRow = (l, i) => `
  <li data-area="${esc(l.area)}" data-landmark="${i}">
    ${listingRow(kit, l)}
  </li>`;

dirEl.innerHTML =
  listed
    .map((a) => {
      const places = kit.placesIn(a.slug);
      const more = kit.landmarksIn(a.slug);
      const meta = [places.length ? plural(places.length, "place") + " on map" : "", more.length ? plural(more.length, "landmark") : ""].filter(Boolean).join(" · ");
      return `
      <section class="group" data-area="${esc(a.slug)}" aria-labelledby="g-${esc(a.slug)}">
        <header>
          <h3 id="g-${esc(a.slug)}"><a href="${areaHref(a.slug)}">${areaBadge(kit, a)}<span>${esc(a.name)}</span></a></h3>
          <span class="meta">${meta}</span>
        </header>
        ${places.length ? `<ul class="rows">${places.map(placeRow).join("")}</ul>` : ""}
        ${
          more.length
            ? `<details class="more"${places.length ? "" : " open"}>
                <summary>${places.length ? `${plural(more.length, "more landmark")}` : plural(more.length, "landmark")} <span class="visually-hidden">in ${esc(a.name)}</span></summary>
                <ul class="rows small">${more.map((l) => landmarkRow(l, data.moreLandmarks.indexOf(l))).join("")}</ul>
              </details>`
            : ""
        }
      </section>`;
    })
    .join("") +
  (unlisted.length
    ? `<section class="other-areas" data-other aria-labelledby="other-title">
        <h2 id="other-title">Other areas</h2>
        <p>No places listed here yet, but each has its own page.</p>
        <ul class="pills">${unlisted.map((a) => `<li data-area="${esc(a.slug)}"><a href="${areaHref(a.slug)}">${areaBadge(kit, a)}${esc(a.name)}</a></li>`).join("")}</ul>
      </section>`
    : "") +
  `<p class="empty" id="empty" hidden></p>`;

// Landmark-only groups start open; remember that so clearing a search restores it.
for (const d of dirEl.querySelectorAll("details.more")) d.dataset.defaultOpen = d.open ? "1" : "";

// ------------------------------------------------------------ type chips

const countKind = (kind) => data.places.filter((p) => p.kind === kind).length;
chipsEl.innerHTML =
  `<button type="button" class="chip all" data-kind="" aria-pressed="true">All</button>` +
  (data.types || [])
    .map((t) => `<button type="button" class="chip" data-kind="${esc(t.kind)}" aria-pressed="false">${iconImg(kit, t)}${esc(t.label)} <span class="count">${countKind(t.kind)}</span></button>`)
    .join("");

// ------------------------------------------------------------ filtering

const state = { q: "", kind: "" };
const placeHay = new Map(data.places.map((p) => [p.slug, norm([p.name, p.localName, kit.typeLabel(p), p.category].join(" "))]));
const landmarkHay = (data.moreLandmarks || []).map((l) => norm([l.name, kit.typeLabel(l)].join(" ")));
const areaHit = (a, q) => norm(a.name).includes(q) || norm(a.localName).includes(q) || String(a.number) === q;

let searchHighlight = [];

function applyFilters({ fromUser = true } = {}) {
  const q = norm(state.q);
  const kind = state.kind;
  const active = Boolean(q || kind);
  const shownPlaces = [];
  const litAreas = new Set();
  let nPlaces = 0, nLandmarks = 0, nAreas = 0;

  for (const group of dirEl.querySelectorAll(".group")) {
    const slug = group.dataset.area;
    const area = kit.areas.get(slug);
    const areaMatch = q && areaHit(area, q);
    let visible = 0;

    for (const li of group.querySelectorAll("li[data-place]")) {
      const p = kit.places.get(li.dataset.place);
      const ok = (!kind || p.kind === kind) && (!q || areaMatch || placeHay.get(p.slug).includes(q));
      li.hidden = !ok;
      if (ok) { visible++; nPlaces++; shownPlaces.push(p.slug); }
    }
    let lmVisible = 0;
    for (const li of group.querySelectorAll("li[data-landmark]")) {
      const l = data.moreLandmarks[+li.dataset.landmark];
      const ok = (!kind || l.kind === kind) && (!q || areaMatch || landmarkHay[+li.dataset.landmark].includes(q));
      li.hidden = !ok;
      if (ok) { lmVisible++; nLandmarks++; }
    }
    const details = group.querySelector("details.more");
    if (details) {
      details.hidden = lmVisible === 0;
      details.open = active ? lmVisible > 0 && (Boolean(q) || !group.querySelector("li[data-place]:not([hidden])")) : Boolean(details.dataset.defaultOpen);
    }
    const show = visible + lmVisible > 0 || (areaMatch && !kind);
    group.hidden = !show;
    if (show) {
      nAreas++;
      if (q || visible) litAreas.add(slug);
    }
  }

  const other = dirEl.querySelector("[data-other]");
  if (other) {
    let n = 0;
    for (const li of other.querySelectorAll("li")) {
      const ok = !kind && (!q || areaHit(kit.areas.get(li.dataset.area), q));
      li.hidden = !ok;
      if (ok) { n++; if (q) litAreas.add(li.dataset.area); }
    }
    other.hidden = n === 0;
    if (q) nAreas += n;
  }

  // Map: matching place icons only, matching areas highlighted.
  mapCall("showPlaces", active ? shownPlaces : null);
  searchHighlight = active ? [...litAreas] : [];
  mapCall("highlight", searchHighlight);

  // Status + empty state
  const empty = document.getElementById("empty");
  const nothing = active && nPlaces + nLandmarks === 0 && nAreas === 0;
  empty.hidden = !nothing;
  if (nothing) empty.textContent = `Nothing matches${q ? ` “${state.q.trim()}”` : ""}${kind ? ` among ${labelFor(kind).toLowerCase()}s` : ""}.`;
  if (!active) {
    statusEl.textContent = "";
  } else {
    const bits = [];
    if (nPlaces) bits.push(plural(nPlaces, "place") + " on the map");
    if (nLandmarks) bits.push(plural(nLandmarks, "landmark"));
    statusEl.innerHTML = `${nothing ? "No results." : `${esc(bits.join(" and ") || plural(nAreas, "area"))}${bits.length ? ` in ${plural(nAreas, "area")}` : ""}.`} <button type="button" data-reset>Show everything</button>`;
  }

  clearBtn.hidden = !state.q;
  for (const chip of chipsEl.querySelectorAll(".chip")) chip.setAttribute("aria-pressed", String(chip.dataset.kind === kind));
  if (fromUser) syncUrl();
}

const labelFor = (kind) => kit.types.get(kind)?.label || kind;

function syncUrl() {
  const u = new URL(location.href);
  state.q.trim() ? u.searchParams.set("q", state.q.trim()) : u.searchParams.delete("q");
  state.kind ? u.searchParams.set("type", state.kind) : u.searchParams.delete("type");
  history.replaceState(null, "", u);
}

// Map calls wait for the map; filters still work on the list if the map never loads.
let mapIsReady = false;
const pending = new Map();
function mapCall(method, arg) {
  if (mapIsReady) map[method](arg);
  else pending.set(method, arg);
}
ready.then(() => {
  mapIsReady = true;
  for (const [m, arg] of pending) map[m](arg);
  pending.clear();
});

// ------------------------------------------------------------ wiring

input.addEventListener("input", () => { state.q = input.value; applyFilters(); });
input.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; state.q = ""; applyFilters(); }
});
clearBtn.addEventListener("click", () => { input.value = ""; state.q = ""; applyFilters(); input.focus(); });
chipsEl.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.kind = chip.dataset.kind === state.kind ? "" : chip.dataset.kind;
  applyFilters();
});
statusEl.addEventListener("click", (e) => {
  if (!e.target.closest("[data-reset]")) return;
  input.value = ""; state.q = ""; state.kind = "";
  applyFilters();
  input.focus();
});

// Map → pages
map.addEventListener("area-select", (e) => (location.href = areaHref(e.detail.slug)));
map.addEventListener("place-select", (e) => (location.href = placeHref(e.detail.slug)));

// Map hover → mark the matching directory entry (no scrolling: that would yank the page).
let mapHover = null;
map.addEventListener("area-hover", (e) => {
  if (mapHover) for (const el of dirEl.querySelectorAll(`[data-area="${CSS.escape(mapHover)}"]`)) el.classList.remove("is-maphover");
  mapHover = e.detail.slug;
  if (!mapHover) return;
  const group = dirEl.querySelector(`.group[data-area="${CSS.escape(mapHover)}"]`);
  group?.classList.add("is-maphover");
  dirEl.querySelector(`.pills li[data-area="${CSS.escape(mapHover)}"] a`)?.classList.add("is-maphover");
});

// List hover / keyboard focus → highlight that area on the map, then restore search results.
let listHover = null;
function hoverArea(slug) {
  if (slug === listHover || !mapIsReady) return;
  listHover = slug;
  if (slug) {
    map.highlight([slug]);
    map.select(slug);
  } else {
    map.highlight(searchHighlight);
    map.select(null);
  }
}
const areaOf = (el) => el?.closest?.("[data-area]")?.dataset.area || null;
dirEl.addEventListener("pointerover", (e) => hoverArea(areaOf(e.target)));
dirEl.addEventListener("pointerleave", () => hoverArea(null));
dirEl.addEventListener("focusin", (e) => hoverArea(areaOf(e.target)));
dirEl.addEventListener("focusout", (e) => { if (!dirEl.contains(e.relatedTarget)) hoverArea(null); });

// ------------------------------------------------------------ initial state from the URL

const params = new URLSearchParams(location.search);
state.q = params.get("q") || "";
state.kind = kit.types.has(params.get("type")) ? params.get("type") : "";
input.value = state.q;
applyFilters({ fromUser: false });
