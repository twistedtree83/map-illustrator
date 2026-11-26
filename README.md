# Map Illustrator (prototype)

Turns OpenStreetMap data into an illustrated, cut-out city map for motion design
and area-picking. The overview shows the city's real districts tiled inside its
outline on a paper background. Clicking a district zooms into it and shows its
streets, trees and landmark icons.

## Run it

```bash
npm install
npm run serve        # http://localhost:8137
```

## Make a map

**In the editor:** open **New map** in the sidebar, search for a city, suburb or
region, and add it. Regions that border it are suggested underneath; click any to
add them. Give the map a title and press **Build map**. Progress streams into the
panel, and the new map opens when it's done (usually 1–3 minutes).

**From the command line:**

```bash
node scripts/fetch-osm.mjs <name> "<place>"[; "<place>" …] [--title "…"]
node scripts/fetch-osm.mjs prague "Prague, Czechia"
node scripts/fetch-osm.mjs inner-north "Fitzroy, Victoria; Collingwood, Victoria; Carlton, Victoria" --title "Inner North"
node scripts/fetch-osm.mjs prague --relation 435514          # exact OSM relation id(s), comma-separated
node scripts/fetch-osm.mjs prague "Prague" --no-overture     # OpenStreetMap only
node scripts/fetch-osm.mjs big "…" --large                   # allow areas over ~20,000 km²
```

**Narrowing a large area:** every picked area has a **suburbs ▾** button. It lists the suburbs inside that area with their sizes. Untick the ones you don't want and press **Use these** to replace the area with just those suburbs (lookup runs through the dev server: `GET /api/children?rel=<id>`).

**Labels in English:** each area, river and landmark keeps its local name, its English name and where the English came from. The English comes from OSM `name:en` first, then Wikidata's English label, then OSM's international name, then the local name (flagged). The **Labels** panel lists every name with its source (EN / INT / LOCAL / EDITED). It shows the ones that may not be English first and lets you correct any of them; your corrections apply everywhere, including exports. A Language switch shows local names instead. Maps built before this change show their names as "?" until rebuilt.

**Larger areas:** search results show each match's type and rough size (e.g. "Suburb · ≈ 13 km²" or "Council area · ≈ 392 km²"). After adding a suburb, **↗ larger area** buttons offer the council or region that contains it. Builds stop early above ~20,000 km² (roughly a few councils), since street-level detail for a whole state is too heavy for the public servers.

How the selectable areas are chosen (pick between them in the **Districts** menu):

- **OSM admin levels:** each region contributes its own sub-districts at that level. A region with none becomes a single area.
- **Overture neighbourhoods:** neighbourhood and micro-neighbourhood outlines from Overture Maps, often richer than OSM's official levels.
- **Regions as entered:** one area per region you added. This is offered whenever you add more than one.

## Addresses

Every landmark gets a street address at build time (`scripts/addresses.mjs`). In order:
its own OSM `addr:*` tags or Overture address (exact), the nearest OSM address point within
80 m, the nearest named street within 400 m, or failing that suburb + postcode only. The last
three are marked `approximate`. Suburb comes from the containing district; state/country from
one reverse-geocode of the map centre. Formatting follows local convention
("105 Glossop Rd, Linden NSW 2778" / "Karlova 12, 110 00 Praha").

Custom pins are reverse-geocoded (Nominatim) when dropped or moved. Every pin has an address
box in the sidebar; typing in it overrides the lookup. Addresses are exported in the site kit.

## Websites

Landmarks get a `website` at build time: OSM `website` / `contact:website` / `url` tags,
then Overture's website list, then Wikidata's official website (P856). Reference pages
(Wikipedia, OSM, Wikidata) are not counted as websites. Custom pins have a website box in
the sidebar. The site kit's brief says a place's name links to its website when it has
one, otherwise to its own page, and never primarily to a map.

## Local map data (recommended)

Builds read OpenStreetMap from a downloaded file in `data-src/` whenever it contains
the regions you picked. That's seconds instead of minutes, with no busy public
servers. Anything outside the downloaded files still uses Overpass automatically.

```bash
brew install osmium-tool
```
```bash
mkdir -p data-src
```
```bash
curl -L --fail -o data-src/nsw-latest.osm.pbf https://download.openstreetmap.fr/extracts/oceania/australia/new_south_wales-latest.osm.pbf
```

That's New South Wales (≈ 300 MB). Other states and countries: browse
<https://download.openstreetmap.fr/extracts/> or <https://download.geofabrik.de/> and
save any `.osm.pbf` into `data-src/`. Every file there is checked. Re-run the `curl`
to refresh the data (monthly is plenty). `data-src/` is git-ignored.
`--no-local` forces the public servers.

Search in **New map** also uses these files: `scripts/area-index.mjs` lists every named
area outline in them (councils, suburbs, localities, regions) into
`data-src/<file>.areas.json` (about a minute, redone automatically when the file changes).
Results from it are instant. The public OpenStreetMap search is only asked when nothing local
matches well. Informal regions with no outline in OpenStreetMap (e.g. "Western Sydney",
"Hunter Region") can't be picked as one area; add their councils instead.

## Site kit (build a website around a map)

**Export → Site kit** writes `kits/<map-name>/`:

| File | Purpose |
|---|---|
| `map.json` | Source of truth: areas (slug, name, legend number, description, Wikipedia link, neighbours, places), places on the map (slug, type, icon, area, coordinates, description, custom fields), other landmarks, palette, fonts, attribution. Schema in `schema.json`. |
| `map.svg` | The artwork. Areas are `data-area="<slug>"`, places `data-place="<slug>"`. |
| `map-viewer.js` | `<illustrated-map src="map.json">` web component (no dependencies): pan/zoom with every input method, hover tooltips, `area-select` / `place-select` events, `focus()`, `highlight()`, `showPlaces()`, `select()`, `reset()`. |
| `icons/*.svg` | Each illustrated icon on its own, for listings. |
| `AGENTS.md` | The brief: give the folder to a coding agent and ask it to build the site. |
| `quickstart.html` | Minimal working page. |

Slugs are stable, so rebuilding or restyling the map and re-exporting keeps the website's links working.
Places on the map are your pins plus each area's headline landmark; add pins in the editor to grow the directory.
The component's source lives in `src/kit/`.

## Data sources

| Source | Used for | Needs |
|---|---|---|
| OpenStreetMap (Overpass + Nominatim) | Region outlines, admin districts, water, parks, streets, landmarks with Wikidata ids, place search | Nothing. Public servers are often busy; the scripts retry across mirrors. |
| Overture Maps | Neighbourhood outlines; extra landmarks (museums, theatres, historic sites…) with confidence ≥ 0.75, skipping near-duplicates of OSM ones | `uv` (runs DuckDB without a global install). Reads only the bounding box from Overture's public S3 bucket. Skipped automatically if `uv` is missing. |
| Wikidata | "Shares a border with" suggestions in the New map panel | Nothing |

Exports credit "© OpenStreetMap contributors · Overture Maps Foundation" when Overture data is included.

## How it works

| Step | Where | What |
| --- | --- | --- |
| Fetch | `scripts/fetch-osm.mjs` | City boundary plus district boundaries, converted to a **TopoJSON topology** so neighbouring districts share their border lines. Also fetches water, rivers, parks/forest, streets down to residential, and landmarks with a Wikidata id. |
| Generalise | `src/geometry.js`, `buildArcs()` in `src/app.js` | Each shared border is simplified and smoothed once, so districts stay seamless (no gaps or overlaps). |
| Overview | `render()` | A guide-map layout: the city as a raised slab (stacked, hatched edge) with contour ripples spreading across the paper; patchwork district tiles (neighbours never share a colour); parks, stippled woods, wave-textured water and main roads clipped to the outline; one headline landmark icon per district. Districts carry numbered badges that match a clickable legend panel (or switch to names on the map). Grotesque header band with district count and coordinates, north arrow, printed paper grain. Margin doodles are optional (`src/decor.js`). |
| Focus | `focusDistrict()` / `drawDetail()` | Animated zoom to the district, a veil over the rest, then streets plus illustrated landmarks, house clusters along residential streets and trees in parks, placed without overlapping. Icons keep their on-screen size while zooming. |
| Icons | `src/icons.js` | Original illustrated set (castle, church, museum, palace, bridge, tower, stadium, theatre, school, hospital, zoo, viewpoint, monument, Ferris wheel, café, homes, trees). Pure SVG shapes tinted by the palette. |
| Intro | `src/reveal.js` | Plays on load and from **▶ Play intro**: the outline draws itself, districts ripple out from the centre, parks and water fade in, rivers draw then flow, icons pop, the title ribbon unrolls and the north arrow spins in. Zooming into a district pops its contents outward. Speed slider and autoplay toggle are in the sidebar; reduced-motion settings are respected. Uses the Web Animations API, so it never alters the exported SVG. |
| Rivers | `river-flow` layer | OSM draws waterways downstream, so the animated dashes move with the current. |
| Edit | sidebar | Title/subtitle, palette, style sliders, select and rename areas (shift-click), tick real landmarks, add or drag custom pins. Saved to localStorage; Save/Load project for a file. |
| Export | **Layered SVG** | Named groups (`decor`, `districts`, `green`, `water`, `river-flow`, `roads`, `district-borders`, `city-outline`, `district-labels`, `pois`, `frame`) become layers in Illustrator/Inkscape, ready for After Effects. |

## Known limits / next steps

- If a district is missing from OSM at the chosen level, it shows as plain land and can't be clicked.
- OSM's landmark tags are noisy (many palaces are tagged as castles); the editor reclassifies by name and caps icons per kind.
- The focus view (streets, trees, icons) isn't part of the SVG export yet; export is the overview.
- The intro is browser-only; to use it in a video, screen-record it for now. Ideas: export the timeline to Lottie/After Effects, elevation shading.

Map data © OpenStreetMap contributors, ODbL.
