import { loadKit, mapReady, esc, sentence, param, areaHref, placeHref, osmHref, iconImg, areaBadge, setTitle, showNotFound , listingRow } from "./common.js";

const map = document.getElementById("map");
const ready = mapReady(map);

const kit = await loadKit();
const slug = param("slug");
const place = kit.listings.get(slug);

if (!place) {
  setTitle(kit, "Place not found");
  showNotFound("Place", slug);
} else {
  render(place);
}

function render(place) {
  const area = place.area ? kit.areas.get(place.area) : null;
  const type = kit.typeLabel(place);
  setTitle(kit, place.name);

  document.getElementById("crumbs").innerHTML =
    `<li><a href="index.html">Directory</a></li>` +
    (area ? `<li><a href="${areaHref(area.slug)}">${esc(area.name)}</a></li>` : "") +
    `<li aria-current="page">${esc(place.name)}</li>`;

  const [lon, lat] = place.coord;
  const desc = sentence(place.description);
  const article = /^[aeiou]/i.test(type) ? "An" : "A";
  const fallback = `${article} ${type.toLowerCase()}${area ? ` in ${area.name}` : ""}.`;

  document.getElementById("head").innerHTML = `
    <p class="eyebrow"><span class="kind">${iconImg(kit, place, 44)}${esc(type)}</span></p>
    <h1>${esc(place.name)}</h1>
    ${place.localName && place.localName !== place.name ? `<p class="lede quiet">Also known as ${esc(place.localName)}</p>` : ""}
    <p class="lede${desc ? "" : " quiet"}">${esc(desc || fallback)}</p>
    ${place.address?.formatted ? `<p class="lede">${place.address.approximate ? "Near " : ""}${esc(place.address.formatted)}</p>` : ""}
    <p class="actions">
      ${place.website ? `<a class="button primary ext" href="${esc(place.website)}" target="_blank" rel="noopener">Visit website</a>` : ""}
      <a class="button ext" href="${osmHref(place.coord)}" rel="noopener">Directions / map</a>
      ${place.wikipedia ? `<a class="button ext" href="${esc(place.wikipedia)}" rel="noopener">Wikipedia</a>` : ""}
    </p>`;

  // Owner-supplied extra fields (phone, website, …). Only http(s) values become links.
  const fieldRows = Object.entries(place.fields || {})
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => {
      const label = k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
      const val = String(v);
      const body = /^https?:\/\//i.test(val) ? `<a class="ext" href="${esc(val)}" rel="noopener">${esc(val.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, ""))}</a>` : esc(val);
      return `<dt>${esc(label)}</dt><dd>${body}</dd>`;
    })
    .join("");

  const siblings = area ? kit.placesIn(area.slug).filter((p) => p.slug !== place.slug) : [];
  const nearby = area ? kit.landmarksIn(area.slug) : [];

  document.getElementById("body").innerHTML = `
    <section class="panel" aria-labelledby="facts-title">
      <h2 id="facts-title">Details</h2>
      <dl class="facts">
        <dt>Type</dt><dd>${esc(type)}</dd>
        ${area ? `<dt>Area</dt><dd><a href="${areaHref(area.slug)}">${esc(area.name)}</a> ${areaBadge(kit, area)}</dd>` : ""}
        <dt>Coordinates</dt><dd class="mono">${lat.toFixed(5)}, ${lon.toFixed(5)} · <a class="ext" href="${osmHref(place.coord)}" rel="noopener">map</a></dd>
        ${place.wikidata ? `<dt>Wikidata</dt><dd><a class="ext" href="https://www.wikidata.org/wiki/${esc(place.wikidata)}" rel="noopener">${esc(place.wikidata)}</a></dd>` : ""}
        ${fieldRows}
      </dl>
    </section>
    ${
      area && (siblings.length || nearby.length)
        ? `<section class="panel" aria-labelledby="also-title">
            <h2 id="also-title">Also in ${esc(area.name)}</h2>
            ${siblings.length ? `<ul class="rows">${siblings.map((p) => `<li>${listingRow(kit, p)}</li>`).join("")}</ul>` : ""}
            ${
              nearby.length
                ? `<p class="sub">More landmarks</p><ul class="rows small">${nearby
                    .map((l) => `<li>${listingRow(kit, l, 22)}</li>`)
                    .join("")}</ul>`
                : ""
            }
            <p class="actions"><a class="button" href="${areaHref(area.slug)}">All of ${esc(area.name)}</a></p>
          </section>`
        : area
          ? `<section class="panel"><h2>${esc(area.name)}</h2><p class="quiet">This is the only listing in ${esc(area.name)} so far.</p><p class="actions"><a class="button" href="${areaHref(area.slug)}">About ${esc(area.name)}</a></p></section>`
          : ""
    }`;

  ready.then(() => {
    if (area) {
      map.select(area.slug);
      map.focus(area.slug);
      map.showPlaces(area.places);
    } else {
      map.showPlaces([place.slug]);
    }
  });

  map.addEventListener("area-select", (e) => (location.href = areaHref(e.detail.slug)));
  map.addEventListener("place-select", (e) => {
    if (e.detail.slug !== place.slug) location.href = placeHref(e.detail.slug);
  });
}
