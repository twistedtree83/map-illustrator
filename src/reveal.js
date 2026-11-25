// Intro "reveal" choreography, driven by the Web Animations API.
// Nothing here changes SVG attributes permanently, so exports are unaffected.

const POP = "cubic-bezier(.34,1.56,.64,1)"; // slight overshoot
const SMOOTH = "cubic-bezier(.22,1,.36,1)";

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function anim(el, keyframes, delay, duration, easing = SMOOTH) {
  if (!el) return null;
  return el.animate(keyframes, { delay, duration, easing, fill: "backwards" });
}

const fade = (el, delay, duration = 500) => anim(el, [{ opacity: 0 }, { opacity: getComputedStyle(el).opacity || 1 }], delay, duration);

function pop(el, delay, duration = 520, origin = "50% 100%") {
  if (!el) return;
  el.style.transformBox = "fill-box";
  el.style.transformOrigin = origin;
  anim(el, [{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }], delay, duration, POP);
}

// Draw a stroke along its length. Temporarily normalises the path length.
function draw(el, delay, duration) {
  if (!el) return;
  const ve = el.getAttribute("vector-effect");
  el.removeAttribute("vector-effect");
  el.setAttribute("pathLength", "1");
  el.style.strokeDasharray = "1 1";
  const a = el.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { delay, duration, easing: "cubic-bezier(.45,0,.25,1)", fill: "both" });
  a.finished.then(() => {
    a.cancel();
    el.removeAttribute("pathLength");
    el.style.strokeDasharray = "";
    if (ve) el.setAttribute("vector-effect", ve);
  }, () => {});
}

// Full-map intro. `center` is the city's centre in SVG units.
export function playReveal(root, center, speed = 1) {
  if (reducedMotion()) return;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];
  const t = (ms) => ms / speed;
  root.getAnimations({ subtree: true }).forEach((a) => a.effect?.getTiming().fill === "backwards" && a.cancel());

  // Paper & frame
  fade($("#paper-grain"), t(0), t(600));
  $$("#frame > rect").forEach((r, i) => fade(r, t(100 + i * 120), t(700)));

  // City silhouette: the slab rises, outline draws itself, ripples spread out
  anim($("#city-slab"), [{ opacity: 0, transform: "translateY(-14px)" }, { opacity: 1, transform: "translateY(0)" }], t(250), t(900));
  draw($("#city-outline"), t(150), t(1500));
  $$("#ripples > g").forEach((ring) => {
    const i = +ring.dataset.ring;
    ring.style.transformBox = "fill-box";
    ring.style.transformOrigin = "center";
    anim(ring, [{ opacity: 0, transform: "scale(.94)" }, { opacity: 1, transform: "scale(1)" }], t(900 + i * 160), t(900));
  });
  fade($("#city-base"), t(500), t(500));

  // Districts ripple outward from the centre
  const districts = $$(".district");
  const dist = districts.map((d) => {
    const b = d.getBBox();
    return Math.hypot(b.x + b.width / 2 - center[0], b.y + b.height / 2 - center[1]);
  });
  const maxD = Math.max(1, ...dist);
  districts.forEach((d, i) => {
    d.style.transformBox = "fill-box";
    d.style.transformOrigin = "center";
    anim(d, [{ opacity: 0, transform: "scale(.55)" }, { opacity: 1, transform: "scale(1)" }], t(600 + (dist[i] / maxD) * 1000), t(650), POP);
  });
  fade($("#district-borders"), t(1500), t(500));

  // Land cover, water, roads
  fade($("#green"), t(1600), t(800));
  const water = $$("#water > path");
  fade(water[0], t(1800), t(700));
  draw(water[1], t(1800), t(1400));
  draw(water[2], t(2000), t(1200));
  fade($("#river-flow"), t(3000), t(600));
  fade($("#roads"), t(2100), t(800));

  // Icons pop in top-to-bottom, labels follow
  $$("#landmark-icons-overview use").forEach((u, i) => pop(u, t(2400 + i * 45)));
  $$("#district-labels .fx").forEach((fx, i) => [...fx.children].forEach((c) => pop(c, t(2600 + i * 18), t(420), "50% 50%")));
  $$("#legend .entry").forEach((e, i) => [...e.children].forEach((c) => anim(c, [{ opacity: 0, transform: "translateX(-10px)" }, { opacity: 1, transform: "translateX(0)" }], t(2300 + i * 22), t(450))));
  $$("#legend > rect, #legend > text, #legend > path").forEach((e) => fade(e, t(2000), t(600)));
  $$("#pois .fx > *").forEach((p, i) => {
    p.style.transformBox = "fill-box";
    anim(p, [{ transform: "translateY(-40px)", opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], t(3100 + Math.floor(i / 4) * 90), t(600), POP);
  });

  // Paper doodles drift in; title unfurls; north arrow spins into place
  $$("#decor .r-in").forEach((d, i) => anim(d, [{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "translateY(0)" }], t(1300 + i * 90), t(800)));
  [...($("#title .r-in")?.children || [])].forEach((c, i) =>
    anim(c, [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "translateY(0)" }], t(300 + i * 110), t(700)));
  const arrow = $("#north-arrow .r-in");
  if (arrow) anim(arrow, [{ transform: "rotate(-200deg) scale(.4)", opacity: 0 }, { transform: "rotate(0) scale(1)", opacity: 1 }], t(2200), t(1100), POP);
}

// Pop zoom-view sprites outward from the district centre.
export function popSprites(nodes, center, speed = 1) {
  if (reducedMotion()) return;
  const items = nodes.map((n) => [n, Math.hypot(+n.dataset.x - center[0], +n.dataset.y - center[1])]);
  const maxD = Math.max(1e-6, ...items.map((x) => x[1]));
  for (const [n, d] of items) pop(n.firstElementChild, (60 + (d / maxD) * 700) / speed, 480 / speed);
}

export function fadeIn(el, duration = 450) {
  if (!reducedMotion()) fade(el, 0, duration);
}
