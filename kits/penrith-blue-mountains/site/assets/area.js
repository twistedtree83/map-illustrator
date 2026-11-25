import { loadKit, mapReady, esc, sentence, plural, param, areaHref, placeHref, osmHref, iconImg, areaBadge, setTitle, showNotFound , listingRow } from "./common.js";

const map = document.getElementById("map");
const ready = mapReady(map);

const kit = await loadKit();
const slug = param("slug");
const area = kit.areas.get(slug);

if (!area) {
  setTitle(kit, "Area not found");
  showNotFound("Area", slug);
} else {
  render(area);
}

function render(area) {
  setTitle(kit, area.name);
  document.getElementById("crumb").textContent = area.name;

  const places = kit.placesIn(area.slug);
  const more = kit.landmarksIn(area.slug);
  const neighbours = area.neighbours.map((s) => kit.areas.get(s)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));

  const desc = sentence(area.description);
  const fallback = `${area.number != null ? `Area ${area.number}` : "An area"} on the ${kit.data.title} map${area.region ? `, in ${area.region}` : ""}.`;

  document.getElementById("head").innerHTML = `
    <p class="eyebrow">${areaBadge(kit, area)}${area.region ? `<span>${esc(area.region)}</span>` : "<span>Area</span>"}</p>
    <h1>${esc(area.name)}</h1>
    ${area.localName && area.localName !== area.name ? `<p class="lede quiet">Also known as ${esc(area.localName)}</p>` : ""}
    <p class="lede${desc ? "" : " quiet"}">${esc(desc || fallback)}</p>
    ${area.wikipedia ? `<p class="actions"><a class="button ext" href="${esc(area.wikipedia)}" rel="noopener">Read about ${esc(area.name)} on Wikipedia</a></p>` : ""}`;

  const placeRows = places
    .map((p) => `<li>${listingRow(kit, p)}</li>`)
    .join("");
  const landmarkRows = more
    .map(
      (l) =>
        `<li>${listingRow(kit, l, 22)}</li>`
    )
    .join("");

  document.getElementById("body").innerHTML = `
    <section class="panel" aria-labelledby="places-title">
      <h2 id="places-title">Places <small>${places.length || more.length ? [places.length ? `${places.length} on the map` : "", more.length ? plural(more.length, "more landmark") : ""].filter(Boolean).join(" · ") : ""}</small></h2>
      ${places.length ? `<p class="sub">On the map</p><ul class="rows">${placeRows}</ul>` : ""}
      ${more.length ? `<p class="sub">More landmarks <span class="visually-hidden">(not drawn on the map)</span></p><ul class="rows small">${landmarkRows}</ul>` : ""}
      ${!places.length && !more.length ? `<p class="quiet">Nothing is listed in ${esc(area.name)} yet.</p>` : ""}
    </section>
    ${
      neighbours.length
        ? `<section class="panel neighbours" aria-labelledby="nb-title">
            <h2 id="nb-title">Neighbouring areas</h2>
            <ul class="pills">${neighbours.map((n) => `<li data-area="${esc(n.slug)}"><a href="${areaHref(n.slug)}">${areaBadge(kit, n)}${esc(n.name)}</a></li>`).join("")}</ul>
          </section>`
        : ""
    }`;

  ready.then(() => {
    map.select(area.slug);
    map.focus(area.slug);
  });

  // Hovering a neighbour link lights it up on the map.
  const nb = document.querySelector(".neighbours");
  if (nb) {
    const lit = (s) => ready.then(() => map.highlight(s ? [s] : []));
    nb.addEventListener("pointerover", (e) => lit(e.target.closest("[data-area]")?.dataset.area));
    nb.addEventListener("pointerleave", () => lit(null));
    nb.addEventListener("focusin", (e) => lit(e.target.closest("[data-area]")?.dataset.area));
    nb.addEventListener("focusout", (e) => { if (!nb.contains(e.relatedTarget)) lit(null); });
  }

  map.addEventListener("area-select", (e) => {
    if (e.detail.slug === area.slug) map.focus(area.slug);
    else location.href = areaHref(e.detail.slug);
  });
  map.addEventListener("place-select", (e) => (location.href = placeHref(e.detail.slug)));
}
