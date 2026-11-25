// Paper decorations: margin doodles, north arrow and title ribbon.
// Every piece is centred on 0,0 and coloured from the palette.

const line = (c, w = 1.5) => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const SUN = "#f3c35b";

export const DOODLES = {
  hills: (p) => `<path fill="${p.green}" opacity="0.55" d="M-34,10 Q-18,-14 0,10 Q12,-6 30,10Z"/>
    <path ${line(p.decor, 1.2)} d="M-34,10 Q-18,-14 0,10 Q12,-6 30,10 M-22,2 l-4,6 M-16,-1 l-5,9 M-10,2 l-4,6 M14,2 l-3,6 M19,2 l-3,6"/>`,
  cloud: (p) => `<path fill="${p.wall}" opacity="0.9" ${line(p.decor, 1.2).replace('fill="none" ', "")} d="M-24,8 a8,8 0 0 1 3,-15 a11,11 0 0 1 21,-3 a9,9 0 0 1 16,6 a7,7 0 0 1 2,12 Z"/>`,
  birds: (p) => `<path ${line(p.ink, 1.3)} d="M-10,0 q3,-4 6,0 q3,-4 6,0 M5,-9 q2.5,-3 5,0 q2.5,-3 5,0"/>`,
  waves: (p) => `<path ${line(p.accent2, 1.3)} opacity="0.6" d="M-16,0 q4,-3 8,0 t8,0 t8,0 t8,0 M-8,7 q4,-3 8,0 t8,0"/>`,
  sparkle: (p) => `<path fill="${p.accent}" d="M0,-8 L2,-2 L8,0 L2,2 L0,8 L-2,2 L-8,0 L-2,-2Z"/>`,
  balloon: (p) => `<path ${line(p.ink, 1)} d="M-5,-2 L-3,8 M5,-2 L3,8"/>
    <path fill="${p.roof}" stroke="${p.ink}" stroke-width="1.4" d="M0,-34 C-16,-34 -18,-14 -6,-3 L-4,0 H4 L6,-3 C18,-14 16,-34 0,-34Z"/>
    <path fill="${p.wall}" d="M0,-34 C-6,-28 -6,-10 -2.5,-1 H2.5 C6,-10 6,-28 0,-34Z"/>
    <path fill="none" stroke="${p.ink}" stroke-width="1.4" d="M0,-34 C-16,-34 -18,-14 -6,-3 L-4,0 H4 L6,-3 C18,-14 16,-34 0,-34Z"/>
    <rect x="-3.5" y="8" width="7" height="6" rx="1" fill="#9a6b45" stroke="${p.ink}" stroke-width="1.2"/>`,
  kite: (p) => `<path fill="${p.accent2}" stroke="${p.ink}" stroke-width="1.3" stroke-linejoin="round" d="M0,-20 L11,-5 L0,13 L-11,-5Z"/>
    <path ${line(p.ink, 0.9)} d="M0,-20 V13 M-11,-5 H11"/>
    <path ${line(p.ink, 1.1)} d="M0,13 q-6,8 2,14 t-2,16"/>
    <path fill="${p.accent}" d="M-3,20 l3,2 l-3,2Z M1,32 l3,2 l-3,2Z"/>`,
  sun: (p) => `<circle r="9" fill="${SUN}" stroke="${p.ink}" stroke-width="1.2"/>
    ${Array.from({ length: 10 }, (_, i) => { const a = (i * Math.PI) / 5; return `<path ${line(SUN, 2)} d="M${(13 * Math.cos(a)).toFixed(1)},${(13 * Math.sin(a)).toFixed(1)} L${(17 * Math.cos(a)).toFixed(1)},${(17 * Math.sin(a)).toFixed(1)}"/>`; }).join("")}`,
};

// A slim north arrow in a ring, rather than a full compass rose.
export function northArrow(p) {
  return `<circle r="30" fill="${p.wall}" stroke="${p.ink}" stroke-width="1.4"/>
    <circle r="25" fill="none" stroke="${p.decor}" stroke-width="1" stroke-dasharray="1.5 3"/>
    <path d="M0,-21 L8,12 L0,6Z" fill="${p.roof}" stroke="${p.ink}" stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M0,-21 L-8,12 L0,6Z" fill="${p.accent}" stroke="${p.ink}" stroke-width="1.2" stroke-linejoin="round"/>
    <text y="-36" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-size="15" font-weight="700" fill="${p.ink}">N</text>`;
}

// Ribbon banner with folded tails; width adapts to the title.
export function titleRibbon(p, title, subtitle, coords) {
  const w = Math.max(220, title.length * 27 + 70);
  const h = 58;
  const tail = (x, dir) => {
    const d = `M${x},14 h${dir * 26} l${dir * -10},${h / 2 - 2} l${dir * 10},${h / 2 - 2} h${dir * -26}Z`;
    return `<path d="${d}" fill="${p.roof}"/><path d="${d}" fill="${p.ink}" opacity="0.22" stroke="${p.ink}" stroke-width="1.4" stroke-linejoin="round"/>`;
  };
  return `${tail(0, -1)}${tail(w, 1)}
    <rect x="0" y="0" width="${w}" height="${h}" rx="3" fill="${p.roof}" stroke="${p.ink}" stroke-width="1.4"/>
    <path d="M10,7 H${w - 10} M10,${h - 7} H${w - 10}" stroke="${p.wall}" stroke-width="1" stroke-dasharray="3 4" opacity="0.7"/>
    <text x="${w / 2}" y="${h / 2 + 2}" text-anchor="middle" dominant-baseline="middle" font-family="Fraunces, Georgia, serif" font-size="34" font-weight="800" letter-spacing="3" fill="${p.wall}">${esc(title.toUpperCase())}</text>
    ${subtitle ? `<text x="${w / 2}" y="${h + 30}" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-style="italic" font-size="20" fill="${p.ink}">${esc(subtitle)}</text>` : ""}
    <text x="${w / 2}" y="${h + (subtitle ? 52 : 30)}" text-anchor="middle" font-family="Nunito, system-ui, sans-serif" font-size="11" font-weight="800" letter-spacing="2.5" fill="${p.decor}">${coords}</text>`;
}

const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

// Paper speckle as a repeating pattern (exports cleanly, unlike SVG noise filters).
export function grainPattern(p) {
  let seed = 11;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let dots = "";
  for (let i = 0; i < 140; i++) {
    dots += `<circle cx="${(r() * 140).toFixed(1)}" cy="${(r() * 140).toFixed(1)}" r="${(0.4 + r() * 0.9).toFixed(2)}" opacity="${(0.05 + r() * 0.1).toFixed(2)}"/>`;
  }
  return `<pattern id="grain" width="140" height="140" patternUnits="userSpaceOnUse"><g fill="${p.ink}">${dots}</g></pattern>`;
}
