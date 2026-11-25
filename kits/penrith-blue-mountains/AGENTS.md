# Site kit: Penrith & Blue Mountains

This folder is everything needed to build a website around an illustrated map of
**Penrith & Blue Mountains**: 76 clickable areas, 23 clickable places drawn on
the map, and 244 more landmarks for listings. Generated 2026-11-25; the
counts in this file are regenerated with the kit, but the site must read them from
`map.json`, never hard-code them.

Read this file first. Then `map.json` (skim the first area, place and landmark),
`quickstart.html` and the top comment of `map-viewer.js`.

## Files

| File | What it is | Rule |
|---|---|---|
| `map.json` | **Source of truth.** Areas, places, landmarks, types, palette, fonts, attribution. Validates against `schema.json`. | Read everything from here. |
| `map.svg` | The artwork. Each area is a `<path data-area="<slug>">`; each place is a `<g data-place="<slug>">`. | Don't edit by hand; it's regenerated. Don't rasterise it. |
| `map-viewer.js` | `<illustrated-map>` web component: pan/zoom, hover tooltips, click events, outlines. No dependencies. | Use it rather than re-implementing map interaction. |
| `icons/<kind>.svg` | Each illustrated icon on its own (48×48). Every `kind` used in `map.json` has one. | Use for listings, filters and buttons so the site matches the map. |
| `quickstart.html` | Smallest working page. | Copy its wiring. |

## The data model (`map.json`)

- `areas[]`: `slug`, `name`, `localName` (only if genuinely another language), `number` (badge number on the map), `color` (its fill on the map; use it for badges), `description`, `wikipedia`, `neighbours[]`, `places[]` + `placeCount` (icons on the map), `landmarks[]` + `landmarkCount` (listings only), `center` [lon, lat], `bbox` (SVG units).
- `places[]`: drawn on the map as clickable icons. `slug`, `name`, `kind`, `typeLabel`, `icon`, `area`, `coord` [lon, lat], `description`, `wikipedia`, `wikidata`, `source` (`openstreetmap` | `overture` | `custom`), `fields` (extra data the map owner added, e.g. phone/website; may be empty).
- `website` on places and landmarks (null when unknown): the place's own site.
- `address` on every place and landmark: `formatted` (ready to show, local style, e.g. "105 Glossop Rd, Linden NSW 2778"), its parts (`line`, `street`, `suburb`, `postcode`, `state`, `country`) and `approximate`. When `approximate` is true the address was derived from the nearest address or street (or only the suburb is known): show it as "near …" or without implying an exact door. Use `formatted` in listings and the place page, and for "Get directions" links prefer `coord`, not the address text.
- `moreLandmarks[]`: same shape as places but `onMap: false`. **Slugs are unique across places and landmarks**, so one page template serves both; just don't try to show a landmark's icon on the map (use `focus(area)` instead).
- `types[]`: every kind used, with `label`, `icon`, `onMap` and `landmarks` counts, most common first. Kinds here: `worship` (Church), `attraction` (Attraction), `viewpoint` (Viewpoint), `school` (School), `museum` (Museum), `stadium` (Stadium), `bridge` (Bridge), `monument` (Monument), `theatre` (Theatre), `tower` (Tower), `zoo` (Zoo), `hospital` (Hospital).
- `description` is a short Wikidata label written as a sentence, not an article. Treat a missing one as normal and write a fallback from the data (type + area).
- `palette` (`paper`, `card`, `ink`, `text`, `accent`, `land[]`…) and `fonts`: use them for the site's look (paper `#f5f0e4`, ink `#2c3a31`, accent `#f2a33a`). Loading `fonts.googleFonts` is fine; self-host the fonts instead if the site must avoid third-party requests.
- `attribution` (text) and `attributionLinks[]` (text + href): **must be shown** on every page that shows the map or its data. Prefer the links in HTML.

## Using the component

```html
<script type="module" src="map-viewer.js"></script>
<illustrated-map id="map" src="map.json" hide-frame style="height: 70vh"></illustrated-map>
<script type="module">
  const map = document.getElementById("map");
  const data = await map.ready;                       // resolves to map.json once drawn
  map.addEventListener("area-select", (e) => (location.href = `area.html?slug=${e.detail.slug}`));
  map.addEventListener("place-select", (e) => (location.href = `place.html?slug=${e.detail.slug}`));
  map.addEventListener("map-error", () => { /* show your own message if you like */ });
</script>
```

- **Data once:** use `await map.ready` (or the `map-ready` event's `detail.map`) instead of fetching `map.json` again. If your page already has the data, set `map.manifest = data` with the `svg="map.svg"` attribute and no `src`.
- **Methods** (safe to call before the map loads; they're queued): `focus(areaSlug)` zooms to an area and veils the rest; `focusPlace(placeSlug)` zooms to an icon and pulses it; `highlight([areaSlugs])` accent outlines (search results); `hover(slug|null)` temporary dashed outline (list hover); `select(slug|null)` bold outline ("this page"); `showPlaces([placeSlugs]|null)`; `zoomBy(f)`; `reset()` whole map (keeps outlines/filters); `clear()` resets everything.
- **Attributes:** `hide-frame` (hide the title drawn on the paper; use a page heading), `no-labels`, and `scroll="page"`, which you should **use on any page where the map sits in a scrolling page**. Then the wheel scrolls the page unless ⌘/Ctrl is held, and one finger scrolls on phones while two fingers pan/zoom.
- **Theming:** the tooltip and zoom buttons pick up `palette.ink`, `palette.card`, `palette.accent` and `fonts.body` automatically; override with CSS custom properties `--map-ink`, `--map-card`, `--map-accent`, `--map-font`, or style `::part(tooltip)` / `::part(controls)`.
- Give the element a height; it fills its box.

## What to build (directory site)

**Routes.** With a static site generator (Astro, Eleventy, Next.js…), generate
`/areas/<slug>/` and `/places/<slug>/` (places and landmarks share the place
template). Without a build step, use `area.html?slug=<slug>` and `place.html?slug=<slug>`.
Pick one scheme and build every link with it.

1. **Home**: the map (large, `scroll="page"`), a search box, type filters (one chip per `types[]` entry with its icon), and a directory of places and landmarks grouped by area. Clicking a map area or icon opens its page. Search calls `highlight()` with matching areas and `showPlaces()` with matching on-map places. A type filter calls `showPlaces()`. Hovering a list item calls `hover(area)`; `area-hover` events can highlight the matching list entry.
2. **Area page**: name, number badge in `color`, description, Wikipedia link, the map with `select(slug)` + `focus(slug)`, its places then its landmarks, neighbour links (hover → `hover(neighbour)`).
3. **Place/landmark page**: name, type with icon, description, area link, any `fields`, coordinates with an external map link (`https://www.openstreetmap.org/?mlat=<lat>&mlon=<lon>#map=17/<lat>/<lon>`), and the map with `select(area)` + `focusPlace(slug)` for on-map places or `focus(area)` for landmarks.
4. **Footer on every page**: `attributionLinks`.

Example: area `oxley-park`, place `du-faurs-rocks-lookout`.

## Rules

- **Linking a place:** when it has a `website`, its name in lists links straight there (new tab, `rel="noopener"`, with a small ↗ so people know they're leaving). Without one, link to its place page. Never make "open in a map" the primary link; coordinates/directions are a secondary action on the place page.

- Keep the visual language: paper background, palette colours, `fonts.display` for headings, the icons from `icons/`.
- **The list is the accessible way in.** Areas and places inside the map are not keyboard tab stops; every map action must also be possible from real `<a href>` links in the page.
- Don't fetch other map data or tiles; everything needed is in this folder.
- Serve over HTTP (e.g. `npx serve .`); `fetch()` of `map.json` fails from `file://`.
- If `map.json` changes (the map was rebuilt), the site should pick it up without code changes.
