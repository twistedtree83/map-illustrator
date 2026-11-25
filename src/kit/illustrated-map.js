// <illustrated-map> — a dependency-free web component that shows a map exported
// from Map Illustrator and turns its areas and places into clickable links.
//
//   <script type="module" src="map-viewer.js"></script>
//   <illustrated-map src="map.json"></illustrated-map>
//
// Attributes
//   src          URL of map.json (map.svg is loaded from the same folder unless `svg` is set)
//   svg          URL of map.svg (optional; required if you set .manifest yourself)
//   hide-frame   hide the title/frame drawn on the paper (use your own page heading)
//   no-labels    hide the area number/name labels
//   scroll="page"  let the page scroll over the map: wheel zooms only with ⌘/Ctrl held,
//                  and one-finger swipes on touch screens scroll the page (two fingers pan/zoom)
//
// Properties
//   ready        Promise resolving to the manifest once the map is drawn
//   manifest     the parsed map.json; assign it yourself to avoid a second fetch
//                (set the `svg` attribute too)
//
// Events (all bubble; read event.detail)
//   map-ready      { map }                      manifest loaded and drawn
//   map-error      { error }                    map.json or map.svg failed to load
//   area-select    { id, slug, name, area }     an area was clicked
//   place-select   { id, slug, name, place }    a place icon was clicked
//   area-hover     { slug | null }              pointer entered/left an area
//
// Methods (safe to call before the map has loaded; they run once it's ready)
//   focus(areaSlug)        zoom to an area; a veil fades the rest
//   focusPlace(placeSlug)  zoom to a place and pulse its icon
//   reset()                whole map, veil removed (keeps highlight/select/showPlaces)
//   clear()                reset() plus clearing highlight, select, hover and showPlaces
//   highlight(slugs[])     outline areas in the accent colour (e.g. search results); [] clears
//   hover(slug | null)     temporary outline, e.g. while hovering a list item
//   select(slug | null)    bold outline for "this one"
//   showPlaces(slugs[] | null)  only show these place icons (null = all)
//   zoomBy(factor)         zoom around the centre
//
// Keyboard: the map itself takes arrows, +/- and Esc. Areas and places are not
// tab stops; give every map action an equivalent link in the page.

const CSS = `
:host { display: block; position: relative; overflow: hidden; background: var(--map-bg, transparent); touch-action: none; user-select: none;
  --ink: var(--map-ink, #2c3a31); --card: var(--map-card, #fffaf0); --accent: var(--map-accent, #f2a33a); --font: var(--map-font, system-ui, sans-serif); }
:host([scroll="page"]) { touch-action: pan-x pan-y; }
:host(:focus-visible) { outline: 3px solid var(--accent); outline-offset: -3px; }
svg.map { width: 100%; height: 100%; display: block; cursor: grab; }
svg.map:active { cursor: grabbing; }
.area { cursor: pointer; }
.place { cursor: pointer; transition: opacity .25s; }
.place.is-hidden { opacity: 0; pointer-events: none; }
.place:hover use { filter: drop-shadow(0 2px 0 rgba(0,0,0,.25)); }
.place.is-pulse use { animation: pulse 1.2s ease-in-out 3; transform-box: fill-box; transform-origin: 50% 90%; }
@keyframes pulse { 50% { transform: scale(1.35); } }
.ov path { fill: none; vector-effect: non-scaling-stroke; stroke-linejoin: round; pointer-events: none; }
.ov .hl { stroke: var(--accent); stroke-width: 3px; fill: var(--accent); fill-opacity: .18; }
.ov .sel { stroke: var(--ink); stroke-width: 3px; }
.ov .hov { stroke: var(--ink); stroke-width: 2px; stroke-dasharray: 5 4; fill: #fff; fill-opacity: .15; }
.veil { pointer-events: none; transition: opacity .4s; }
.hide-frame #frame, .no-labels #district-labels { display: none; }
.tip { position: absolute; z-index: 2; pointer-events: none; background: var(--card); color: var(--ink); border: 1.5px solid var(--ink);
  border-radius: 10px; padding: 5px 10px; font: 700 13px/1.3 var(--font); box-shadow: 2px 3px 0 rgba(0,0,0,.15); white-space: nowrap; }
.tip small { display: block; font-weight: 500; opacity: .7; }
.tip[hidden], .msg[hidden] { display: none; }
.msg { position: absolute; inset: auto 0 12px; margin: auto; width: max-content; max-width: 90%; z-index: 3; pointer-events: none;
  background: rgba(20,24,30,.78); color: #fff; font: 700 12.5px/1.3 var(--font); padding: 7px 12px; border-radius: 999px; text-align: center; }
.err { position: absolute; inset: 0; display: grid; place-items: center; padding: 20px; text-align: center; font: 600 14px/1.4 var(--font); color: var(--ink); }
.ctl { position: absolute; right: 10px; bottom: 10px; display: flex; flex-direction: column; gap: 4px; z-index: 2; }
.ctl button { width: 34px; height: 34px; border-radius: 8px; border: 1.5px solid var(--ink); background: var(--card); color: var(--ink);
  font: 700 18px/1 var(--font); cursor: pointer; }
.ctl button:focus-visible { outline: 3px solid var(--accent); outline-offset: 1px; }
`;

const NS = "http://www.w3.org/2000/svg";
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

class IllustratedMap extends HTMLElement {
  static observedAttributes = ["src", "svg", "hide-frame", "no-labels"];

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${CSS}</style><div class="tip" part="tooltip" hidden></div><p class="msg" hidden></p>
      <div class="ctl" part="controls"><button data-z="in" aria-label="Zoom in">+</button><button data-z="out" aria-label="Zoom out">−</button><button data-z="reset" aria-label="Show whole map">⤢</button></div>`;
    this.t = { k: 1, x: 0, y: 0 };
    this.tip = this.root.querySelector(".tip");
    this.msg = this.root.querySelector(".msg");
    this.state = { highlight: [], select: null, hover: null };
    this.ready = new Promise((resolve, reject) => { this._resolve = resolve; this._reject = reject; });
    this.ready.catch(() => {}); // failures are reported via map-error
    this.root.querySelector(".ctl").addEventListener("click", (e) => {
      const z = e.target.dataset?.z;
      if (z === "in") this.zoomBy(1.6);
      else if (z === "out") this.zoomBy(1 / 1.6);
      else if (z === "reset") this.reset();
    });
  }

  get manifest() { return this.data; }
  set manifest(data) { this._given = data; this.load(); }

  attributeChangedCallback(name) {
    if (name === "src" || name === "svg") this.load();
    else this.applyFlags();
  }

  connectedCallback() { if (!this.svg && (this.getAttribute("src") || this._given)) this.load(); }

  // Run now if drawn, otherwise once ready.
  whenReady(fn) { if (this.svg) fn(); else this.ready.then(fn, () => {}); }

  async load() {
    const src = this.getAttribute("src");
    const key = this._given ? "given" : src;
    if (!key || this.loading === key) return;
    this.loading = key;
    try {
      const base = new URL(src || this.getAttribute("svg") || ".", document.baseURI);
      this.data = this._given || (await (await this.fetchOk(base)).json());
      const svgUrl = new URL(this.getAttribute("svg") || this.data.files?.svg || "map.svg", base);
      const text = await (await this.fetchOk(svgUrl)).text();
      this.draw(text);
      this._resolve(this.data);
      this.dispatch("map-ready", { map: this.data });
    } catch (error) {
      this.root.querySelector(".err")?.remove();
      const p = document.createElement("p");
      p.className = "err";
      p.textContent = location.protocol === "file:" ? "Open this page through a web server (not file://) to load the map." : "The map couldn't be loaded.";
      this.root.append(p);
      this._reject(error);
      this.dispatch("map-error", { error });
    }
  }

  async fetchOk(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} loading ${url}`);
    return res;
  }

  draw(text) {
    this.root.querySelector("svg.map")?.remove();
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    this.svg = document.importNode(doc.documentElement, true);
    this.svg.classList.add("map");
    this.svg.removeAttribute("width");
    this.svg.removeAttribute("height");
    this.svg.setAttribute("role", "img");
    this.svg.setAttribute("aria-label", this.data.title || "Map");
    this.root.prepend(this.svg);
    this.vb = this.svg.viewBox.baseVal;
    this.viewport = this.svg.querySelector("#viewport");
    this.areaEls = new Map([...this.svg.querySelectorAll("[data-area]")].map((el) => [el.dataset.area, el]));
    this.placeEls = new Map([...this.svg.querySelectorAll("[data-place]")].map((el) => [el.dataset.place, el]));
    this.areas = new Map(this.data.areas.map((a) => [a.slug, a]));
    this.places = new Map(this.data.places.map((p) => [p.slug, p]));
    this.areaEls.forEach((el) => el.classList.add("area"));
    this.placeEls.forEach((el) => el.classList.add("place"));
    // Overlay for outlines, above the map content but below place icons.
    this.ov = document.createElementNS(NS, "g");
    this.ov.setAttribute("class", "ov");
    this.veil = document.createElementNS(NS, "path");
    this.veil.setAttribute("class", "veil");
    this.veil.setAttribute("fill-rule", "evenodd");
    this.veil.setAttribute("fill", this.data.palette?.paper || "#f5f0e4");
    this.veil.setAttribute("opacity", "0");
    const city = this.svg.querySelector("#city");
    (city || this.viewport.firstChild).after(this.veil, this.ov);
    // Theme the tooltip/buttons from the map's palette and fonts.
    const pal = this.data.palette || {};
    if (pal.ink) this.style.setProperty("--map-ink", pal.ink);
    if (pal.card || pal.paper) this.style.setProperty("--map-card", pal.card || "#fffaf0");
    if (pal.accent) this.style.setProperty("--map-accent", pal.accent);
    if (this.data.fonts?.body) this.style.setProperty("--map-font", `'${this.data.fonts.body}', system-ui, sans-serif`);
    this.applyFlags();
    if (!this.wired) this.wire();
    this.wired = true;
    this.apply();
    this.paint();
  }

  applyFlags() {
    if (!this.svg) return;
    this.svg.classList.toggle("hide-frame", this.hasAttribute("hide-frame"));
    this.svg.classList.toggle("no-labels", this.hasAttribute("no-labels"));
  }

  dispatch(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true })); }

  // ------------------------------------------------------------ outlines

  paint() {
    if (!this.ov) return;
    this.ov.replaceChildren();
    const add = (slug, cls) => {
      const el = this.areaEls.get(slug);
      if (!el) return;
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", el.getAttribute("d"));
      p.setAttribute("class", cls);
      this.ov.append(p);
    };
    this.state.highlight.forEach((s) => add(s, "hl"));
    if (this.state.hover && this.state.hover !== this.state.select) add(this.state.hover, "hov");
    if (this.state.select) add(this.state.select, "sel");
  }

  // ------------------------------------------------------------ pan & zoom

  toSvg(clientX, clientY) {
    const r = this.svg.getBoundingClientRect();
    const s = Math.max(this.vb.width / r.width, this.vb.height / r.height); // preserveAspectRatio meet
    const ox = (r.width * s - this.vb.width) / 2, oy = (r.height * s - this.vb.height) / 2;
    return [(clientX - r.left) * s - ox, (clientY - r.top) * s - oy, s];
  }

  apply() {
    const { k, x, y } = this.t;
    this.viewport.setAttribute("transform", `translate(${x},${y}) scale(${k})`);
    const inv = (1 / k).toFixed(4);
    for (const g of this.svg.querySelectorAll(".fx")) g.setAttribute("transform", `translate(${g.dataset.x},${g.dataset.y}) scale(${inv})`);
    const frame = this.svg.querySelector("#frame");
    if (frame) frame.style.opacity = k > 1.4 ? 0 : 1;
    // River names are set along the water and scale with it; hide when close in.
    const rivers = this.svg.querySelector("#river-labels");
    if (rivers) rivers.style.opacity = k > 1.8 ? 0 : 1;
  }

  clamp() {
    const { width: W, height: H } = this.vb;
    this.t.k = Math.min(14, Math.max(0.6, this.t.k));
    const k = this.t.k;
    this.t.x = Math.min(W * 0.6 * k, Math.max(W - W * 1.6 * k, this.t.x));
    this.t.y = Math.min(H * 0.6 * k, Math.max(H - H * 1.6 * k, this.t.y));
  }

  zoomAround(px, py, factor) {
    const k = Math.min(14, Math.max(0.6, this.t.k * factor));
    const f = k / this.t.k;
    this.t = { k, x: px - (px - this.t.x) * f, y: py - (py - this.t.y) * f };
    this.clamp();
    this.apply();
  }

  zoomBy(factor) {
    this.whenReady(() => {
      const cx = this.vb.width / 2, cy = this.vb.height / 2;
      const k = Math.min(14, Math.max(0.6, this.t.k * factor)), f = k / this.t.k;
      this.animateTo({ k, x: cx - (cx - this.t.x) * f, y: cy - (cy - this.t.y) * f });
    });
  }

  animateTo(target, ms = 650) {
    cancelAnimationFrame(this.anim);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) ms = 0;
    const from = { ...this.t }, t0 = performance.now();
    const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
    const step = (now) => {
      const u = ms ? Math.min(1, (now - t0) / ms) : 1, e = ease(u);
      // Interpolate in log-scale so zooms feel even.
      const k = Math.exp(Math.log(from.k) + (Math.log(target.k) - Math.log(from.k)) * e);
      this.t = { k, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      this.apply();
      if (u < 1) this.anim = requestAnimationFrame(step);
    };
    this.anim = requestAnimationFrame(step);
  }

  note(text) {
    this.msg.textContent = text;
    this.msg.hidden = false;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.msg.hidden = true), 1400);
  }

  wire() {
    // Listeners go on the host element, so redrawing the SVG keeps them.
    const pointers = new Map();
    let drag = null, pinch = null;
    const cooperative = () => this.getAttribute("scroll") === "page";

    this.addEventListener("pointerdown", (e) => {
      if (!this.svg || e.button > 2 || e.target.closest?.(".ctl")) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (e.pointerType === "touch" && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], start: { ...this.t } };
        drag = null;
        return;
      }
      if (e.pointerType === "touch" && cooperative()) return; // one finger scrolls the page
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, start: { ...this.t }, button: e.button };
    });
    this.addEventListener("pointermove", (e) => {
      if (!this.svg) return;
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const [mx, my, s] = this.toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
        const [sx, sy] = this.toSvg(...pinch.mid);
        const k = Math.min(14, Math.max(0.6, pinch.start.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d)));
        const f = k / pinch.start.k;
        this.t = { k, x: mx - (sx - pinch.start.x) * f, y: my - (sy - pinch.start.y) * f };
        this.clamp();
        this.apply();
        return;
      }
      if (drag && drag.id === e.pointerId) {
        const [, , s] = this.toSvg(e.clientX, e.clientY);
        const dx = (e.clientX - drag.x) * s, dy = (e.clientY - drag.y) * s;
        if (!drag.moved && Math.hypot(dx, dy) > 4 * s) { drag.moved = true; this.setPointerCapture(e.pointerId); this.hideTip(); }
        if (drag.moved) { this.t = { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy }; this.clamp(); this.apply(); }
        return;
      }
      this.hoverAt(e);
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag || drag.id !== e.pointerId) return;
      const { moved, button } = drag;
      drag = null;
      if (moved || button !== 0) return;
      const path = e.composedPath();
      const placeEl = path.find((n) => n.dataset?.place);
      const areaEl = path.find((n) => n.dataset?.area);
      if (placeEl) {
        const p = this.places.get(placeEl.dataset.place);
        if (p) this.dispatch("place-select", { id: p.id, slug: p.slug, name: p.name, place: p });
      } else if (areaEl) {
        const a = this.areas.get(areaEl.dataset.area);
        if (a) this.dispatch("area-select", { id: a.id, slug: a.slug, name: a.name, area: a });
      }
    };
    this.addEventListener("pointerup", end);
    this.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); drag = null; pinch = null; });
    this.addEventListener("pointerleave", () => { this.hideTip(); this.setHover(null, true); });
    this.addEventListener("contextmenu", (e) => { if (e.composedPath().includes(this.svg)) e.preventDefault(); });

    // Notched mouse wheel zooms; trackpad / Magic Mouse swipe pans; pinch zooms.
    // With scroll="page", only ⌘/Ctrl+wheel (and trackpad pinch) zoom; otherwise the page scrolls.
    this.addEventListener("wheel", (e) => {
      if (!this.svg) return;
      const pinchGesture = e.ctrlKey || e.metaKey;
      if (cooperative() && !pinchGesture) {
        this.note(navigator.platform.includes("Mac") ? "Use ⌘ + scroll to zoom the map" : "Use Ctrl + scroll to zoom the map");
        return;
      }
      e.preventDefault();
      const [px, py, s] = this.toSvg(e.clientX, e.clientY);
      const notched = e.deltaMode === 1 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 40);
      if (pinchGesture || notched || cooperative()) {
        const unit = e.deltaMode === 1 ? 0.05 : pinchGesture && !notched ? 0.012 : 0.002;
        this.zoomAround(px, py, Math.pow(2, -e.deltaY * unit));
      } else {
        this.t.x -= e.deltaX * s;
        this.t.y -= e.deltaY * s;
        this.clamp();
        this.apply();
      }
    }, { passive: false });

    // Keyboard: arrows pan, +/- zoom, Esc resets (when the map has focus).
    this.tabIndex = 0;
    this.setAttribute("aria-label", "Map: arrow keys move, plus and minus zoom, Escape resets");
    this.addEventListener("keydown", (e) => {
      if (!this.svg) return;
      const step = 90;
      const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (moves[e.key]) { e.preventDefault(); this.t.x += moves[e.key][0]; this.t.y += moves[e.key][1]; this.clamp(); this.apply(); }
      else if (e.key === "+" || e.key === "=") this.zoomBy(1.4);
      else if (e.key === "-") this.zoomBy(1 / 1.4);
      else if (e.key === "Escape") this.reset();
    });
  }

  setHover(slug, fromPointer = false) {
    if (slug === this.state.hover) return;
    this.state.hover = slug;
    this.paint();
    if (fromPointer) this.dispatch("area-hover", { slug });
  }

  hoverAt(e) {
    const path = e.composedPath();
    const placeEl = path.find((n) => n.dataset?.place);
    const areaEl = placeEl ? null : path.find((n) => n.dataset?.area);
    this.setHover(areaEl?.dataset.area || null, true);
    let html = "";
    if (placeEl) {
      const p = this.places.get(placeEl.dataset.place);
      if (p) html = `${esc(p.name)}<small>${esc(p.typeLabel || p.kind)}${p.area ? " · " + esc(this.areas.get(p.area)?.name || "") : ""}</small>`;
    } else if (areaEl) {
      const a = this.areas.get(areaEl.dataset.area);
      if (a) {
        const n = (a.placeCount || 0) + (a.landmarkCount || 0);
        html = `${esc(a.name)}<small>${n ? `${n} place${n === 1 ? "" : "s"}` : "Explore"}</small>`;
      }
    }
    if (!html) return this.hideTip();
    const r = this.getBoundingClientRect();
    this.tip.innerHTML = html;
    this.tip.hidden = false;
    this.tip.style.left = `${Math.max(6, Math.min(e.clientX - r.left + 12, r.width - this.tip.offsetWidth - 6))}px`;
    this.tip.style.top = `${e.clientY - r.top + 14}px`;
  }

  hideTip() { this.tip.hidden = true; }

  // ------------------------------------------------------------ public API

  focus(slug) {
    this.whenReady(() => {
      const a = this.areas.get(slug);
      const el = this.areaEls.get(slug);
      if (!a) return;
      const { width: W, height: H } = this.vb;
      const [x, y, w, h] = a.bbox;
      const k = Math.min(10, 0.75 / Math.max(w / W, h / H));
      if (el) {
        this.veil.setAttribute("d", `M-20000,-20000H20000V20000H-20000Z${el.getAttribute("d")}`);
        this.veil.setAttribute("opacity", "0.6");
      }
      this.animateTo({ k, x: W / 2 - (x + w / 2) * k, y: H / 2 - (y + h / 2) * k });
    });
  }

  focusPlace(slug, zoom = 6) {
    this.whenReady(() => {
      const p = this.places.get(slug);
      if (!p) return;
      const { width: W, height: H } = this.vb;
      this.veil.setAttribute("opacity", "0");
      this.animateTo({ k: zoom, x: W / 2 - p.svg[0] * zoom, y: H / 2 - p.svg[1] * zoom });
      const el = this.placeEls.get(slug);
      if (el) { el.classList.remove("is-pulse"); void el.getBBox(); el.classList.add("is-pulse"); }
    });
  }

  reset() {
    this.whenReady(() => {
      this.veil.setAttribute("opacity", "0");
      this.animateTo({ k: 1, x: 0, y: 0 });
    });
  }

  clear() {
    this.whenReady(() => {
      this.state = { highlight: [], select: null, hover: null };
      this.showPlaces(null);
      this.paint();
      this.reset();
    });
  }

  highlight(slugs = []) { this.whenReady(() => { this.state.highlight = [...slugs]; this.paint(); }); }
  hover(slug) { this.whenReady(() => this.setHover(slug || null)); }
  select(slug) { this.whenReady(() => { this.state.select = slug || null; this.paint(); }); }

  showPlaces(slugs = null) {
    this.whenReady(() => {
      const set = slugs ? new Set(slugs) : null;
      this.placeEls.forEach((el, s) => el.classList.toggle("is-hidden", !!set && !set.has(s)));
    });
  }
}

if (!customElements.get("illustrated-map")) customElements.define("illustrated-map", IllustratedMap);
export default IllustratedMap;
