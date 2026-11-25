// Original illustrated icon set: flat colour fills + a single ink outline,
// drawn on a 48×48 grid standing on a ground line at y≈44. Colours come from
// the active palette, so every icon re-tints with the map. Each icon is plain
// SVG shapes, which keeps them editable/animatable after export.

const STONE = "#b9c0c8";
const BARK = "#8a6448";
const RED = "#e05a4f";
const GOLD = "#f3c35b";

function ink(c, w = 1.6) {
  return `stroke="${c.ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
}
const shadow = (c, rx = 16) => `<ellipse cx="24" cy="44.6" rx="${rx}" ry="2.6" fill="${c.ink}" opacity="0.16"/>`;
const archDoor = (c, x, w, h, fill = c.ink) => `<path fill="${fill}" d="M${x} 44v-${h - w / 2}a${w / 2} ${w / 2} 0 0 1 ${w} 0v${h - w / 2}z"/>`;

const DRAW = {
  castle: (c) => `${shadow(c, 18)}
    <rect x="8" y="18" width="9" height="26" fill="${c.wall}" ${ink(c)}/>
    <rect x="31" y="18" width="9" height="26" fill="${c.wall}" ${ink(c)}/>
    <path d="M16 44V24h0v-3h3v3h2.5v-3h3v3h2.5v-3h3v3h0v20z" fill="${c.wall}" ${ink(c)}/>
    <path d="M6.5 18L12.5 6l6 12z" fill="${c.roof}" ${ink(c)}/>
    <path d="M29.5 18l6-12 6 12z" fill="${c.roof}" ${ink(c)}/>
    <path d="M35.5 6V1.5" ${ink(c)}/><path d="M35.5 1.5l5.5 1.8-5.5 1.8z" fill="${c.accent}" ${ink(c, 1.2)}/>
    ${archDoor(c, 21, 6, 8)}
    <rect x="11" y="24" width="3" height="4.5" rx="1.5" fill="${c.accent2}"/>
    <rect x="34" y="24" width="3" height="4.5" rx="1.5" fill="${c.accent2}"/>
    <rect x="11" y="32" width="3" height="4.5" rx="1.5" fill="${c.accent2}"/>
    <rect x="34" y="32" width="3" height="4.5" rx="1.5" fill="${c.accent2}"/>`,

  worship: (c) => `${shadow(c, 18)}
    <rect x="6" y="26" width="22" height="18" fill="${c.wall}" ${ink(c)}/>
    <path d="M4 27l13-10 13 10z" fill="${c.roof}" ${ink(c)}/>
    <rect x="28" y="16" width="12" height="28" fill="${c.wall}" ${ink(c)}/>
    <path d="M27 16l7-11 7 11z" fill="${c.accent2}" ${ink(c)}/>
    <path d="M34 5V0.8M32.2 2.6h3.6" ${ink(c, 1.3)}/>
    <circle cx="34" cy="22.5" r="2.6" fill="${c.accent}" ${ink(c, 1.2)}/>
    ${archDoor(c, 31.5, 5, 7)}
    ${[10, 15.5, 21].map((x) => `<path d="M${x} 38v-4.5a1.5 1.5 0 0 1 3 0V38z" fill="${c.accent2}"/>`).join("")}`,

  museum: (c) => `${shadow(c, 19)}
    <rect x="5" y="40" width="38" height="4" fill="${c.wall}" ${ink(c)}/>
    <rect x="7" y="37" width="34" height="3" fill="${c.wall}" ${ink(c)}/>
    ${[10, 17.5, 25.5, 33].map((x) => `<rect x="${x}" y="20" width="5" height="17" fill="${c.wall}" ${ink(c, 1.3)}/>`).join("")}
    <rect x="7" y="17" width="34" height="3" fill="${c.wall}" ${ink(c)}/>
    <path d="M5.5 17L24 6l18.5 11z" fill="${c.roof}" ${ink(c)}/>
    <circle cx="24" cy="13" r="1.8" fill="${c.wall}" ${ink(c, 1.1)}/>`,

  palace: (c) => `${shadow(c, 21)}
    <rect x="4" y="22" width="40" height="22" fill="${c.wall}" ${ink(c)}/>
    <rect x="3" y="19" width="42" height="3" fill="${c.roof}" ${ink(c)}/>
    <rect x="18" y="13" width="12" height="6" fill="${c.wall}" ${ink(c)}/>
    <path d="M17 13a7 7 0 0 1 14 0z" fill="${c.accent2}" ${ink(c)}/>
    <path d="M24 6V2.5" ${ink(c, 1.3)}/><circle cx="24" cy="2.3" r="1.2" fill="${GOLD}"/>
    ${[7, 12, 33, 38].flatMap((x) => [25, 33].map((y) => `<rect x="${x}" y="${y}" width="3" height="5" rx="1.5" fill="${c.accent2}"/>`)).join("")}
    ${archDoor(c, 21, 6, 9)}`,

  bridge: (c) => `
    <path d="M1 45.5q3.5-2 7 0t7 0 7 0 7 0 7 0 7 0" fill="none" stroke="${c.accent2}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M2 26H46V41H42A6 6 0 0 0 30 41H28A4 4 0 0 0 20 41H18A6 6 0 0 0 6 41H2Z" fill="${c.wall}" ${ink(c)}/>
    <rect x="2" y="23" width="44" height="3" fill="${c.roof}" ${ink(c)}/>
    <rect x="3" y="12" width="8" height="11" fill="${c.wall}" ${ink(c)}/><path d="M2 12l5-6 5 6z" fill="${c.accent2}" ${ink(c)}/>
    <rect x="37" y="12" width="8" height="11" fill="${c.wall}" ${ink(c)}/><path d="M36 12l5-6 5 6z" fill="${c.accent2}" ${ink(c)}/>
    <path d="M5.5 23v-4a1.5 1.5 0 0 1 3 0v4M39.5 23v-4a1.5 1.5 0 0 1 3 0v4" fill="${c.ink}"/>
    ${[16, 24, 32].map((x) => `<path d="M${x} 23v-5" ${ink(c, 1.2)}/><circle cx="${x}" cy="17" r="1.4" fill="${GOLD}" ${ink(c, 0.9)}/>`).join("")}`,

  tower: (c) => `${shadow(c, 10)}
    <path d="M18.5 44L21 16h6l2.5 28z" fill="${c.wall}" ${ink(c)}/>
    <rect x="17" y="13" width="14" height="3" fill="${c.roof}" ${ink(c)}/>
    <rect x="19.5" y="8" width="9" height="5" fill="${c.wall}" ${ink(c)}/>
    <path d="M18.5 8L24 0.8 29.5 8z" fill="${c.accent2}" ${ink(c)}/>
    <circle cx="24" cy="22" r="3.2" fill="#ffffff" ${ink(c, 1.2)}/><path d="M24 20.2V22l1.4 1" ${ink(c, 1)}/>
    <rect x="23" y="29" width="2" height="5" rx="1" fill="${c.ink}"/>
    ${archDoor(c, 21.5, 5, 6)}`,

  stadium: (c) => `
    <ellipse cx="24" cy="34" rx="21" ry="10.5" fill="${c.ink}" opacity="0.14"/>
    <ellipse cx="24" cy="31" rx="21" ry="10.5" fill="${c.roof}" ${ink(c)}/>
    <ellipse cx="24" cy="30.5" rx="16.5" ry="7.8" fill="${c.wall}" ${ink(c, 1.2)}/>
    <ellipse cx="24" cy="30.5" rx="11" ry="4.8" fill="${c.green}" ${ink(c, 1.1)}/>
    <path d="M24 25.8v9.4" stroke="#ffffff" stroke-width="1"/><circle cx="24" cy="30.5" r="1.8" fill="none" stroke="#ffffff" stroke-width="1"/>
    <path d="M5 24V10M43 24V10" ${ink(c)}/>
    <rect x="2.5" y="7.5" width="5" height="3.5" rx="1" fill="${GOLD}" ${ink(c, 1.1)}/>
    <rect x="40.5" y="7.5" width="5" height="3.5" rx="1" fill="${GOLD}" ${ink(c, 1.1)}/>`,

  theatre: (c) => `${shadow(c, 19)}
    <rect x="6" y="20" width="36" height="24" fill="${c.wall}" ${ink(c)}/>
    <path d="M5 20.5Q24 5 43 20.5z" fill="${c.roof}" ${ink(c)}/>
    <path d="M24 10V4" ${ink(c, 1.3)}/><path d="M24 4l5 1.6-5 1.6z" fill="${c.accent}" ${ink(c, 1.1)}/>
    ${[11, 21, 31].map((x) => `<path d="M${x} 33v-6a3 3 0 0 1 6 0v6z" fill="${c.accent2}" ${ink(c, 1.1)}/>`).join("")}
    <rect x="6" y="36" width="36" height="2" fill="${c.roof}"/>
    <path d="M20 44v-4h8v4" fill="${c.ink}"/>`,

  school: (c) => `${shadow(c, 18)}
    <rect x="20" y="7" width="8" height="8" fill="${c.wall}" ${ink(c)}/>
    <path d="M19 7l5-5 5 5z" fill="${c.accent2}" ${ink(c)}/>
    <circle cx="24" cy="11" r="1.7" fill="${GOLD}" ${ink(c, 1)}/>
    <rect x="8" y="22" width="32" height="22" fill="${c.wall}" ${ink(c)}/>
    <path d="M5.5 23L24 13l18.5 10z" fill="${c.roof}" ${ink(c)}/>
    ${[11, 16.5, 28, 33.5].map((x) => `<rect x="${x}" y="26" width="3.5" height="5" rx="0.6" fill="${c.accent2}"/>`).join("")}
    <rect x="21" y="34" width="6" height="10" fill="${c.ink}"/>
    <path d="M9 40h9M30 40h9" stroke="${c.accent}" stroke-width="2" stroke-linecap="round"/>`,

  hospital: (c) => `${shadow(c, 18)}
    <rect x="6" y="16" width="36" height="28" fill="${c.wall}" ${ink(c)}/>
    <rect x="5" y="13" width="38" height="3" fill="${c.accent2}" ${ink(c)}/>
    <circle cx="24" cy="23" r="6" fill="#ffffff" ${ink(c, 1.2)}/>
    <path d="M24 19.4v7.2M20.4 23h7.2" stroke="${RED}" stroke-width="2.6" stroke-linecap="round"/>
    ${[9, 13.5, 31, 35.5].flatMap((x) => [20, 29].map((y) => `<rect x="${x}" y="${y}" width="3.5" height="4" rx="0.6" fill="${c.accent2}"/>`)).join("")}
    <rect x="20" y="35" width="8" height="9" fill="${c.accent2}" ${ink(c, 1.2)}/>`,

  zoo: (c) => `${shadow(c, 16)}
    <ellipse cx="28" cy="31" rx="13" ry="9" fill="${STONE}" ${ink(c)}/>
    <path d="M20 38v6h4v-4M33 38v6h4v-6" fill="${STONE}" ${ink(c)}/>
    <circle cx="15" cy="26" r="8" fill="${STONE}" ${ink(c)}/>
    <path d="M9 29q-4 6 0 11 2 1 2-1-2-4 1-7" fill="${STONE}" ${ink(c)}/>
    <path d="M16 20q8-2 8 7-5 2-8-2z" fill="#d3d8de" ${ink(c, 1.2)}/>
    <circle cx="12.5" cy="24.5" r="1.2" fill="${c.ink}"/>
    <path d="M41 29q4 1 3 5" fill="none" ${ink(c, 1.2)}/>`,

  viewpoint: (c) => `
    <path d="M1 45Q14 27 28 34T47 45z" fill="${c.green}" ${ink(c)}/>
    <path d="M18 35L21.5 12M30 35L26.5 12M19.5 26h9M20.5 19h7M19.5 26l7-7M28.5 26l-7-7" fill="none" ${ink(c, 1.3)}/>
    <rect x="19" y="9" width="10" height="3" fill="${c.wall}" ${ink(c)}/>
    <path d="M18 9l6-6.5L30 9z" fill="${c.roof}" ${ink(c)}/>`,

  monument: (c) => `${shadow(c, 12)}
    <rect x="14" y="32" width="20" height="12" fill="${c.wall}" ${ink(c)}/>
    <rect x="12" y="29.5" width="24" height="3" fill="${c.wall}" ${ink(c)}/>
    <path d="M20 29.5l1.2-11q2.8-3 5.6 0l1.2 11z" fill="${c.accent2}" ${ink(c)}/>
    <path d="M26.6 19.5l5-7" ${ink(c, 2)}/>
    <circle cx="24" cy="13.5" r="3" fill="${c.accent2}" ${ink(c)}/>
    <path d="M18 37h12" stroke="${c.accent}" stroke-width="1.6" stroke-linecap="round"/>`,

  attraction: (c) => `
    <path d="M14 44l10-22 10 22" fill="none" ${ink(c, 2)}/>
    <circle cx="24" cy="22" r="16" fill="none" ${ink(c, 1.6)}/>
    ${Array.from({ length: 8 }, (_, i) => {
      const a = (i * Math.PI) / 4, x = 24 + 16 * Math.cos(a), y = 22 + 16 * Math.sin(a);
      const fill = [c.accent, c.roof, c.accent2][i % 3];
      return `<path d="M24 22L${x.toFixed(1)} ${y.toFixed(1)}" ${ink(c, 0.9)}/><rect x="${(x - 2.6).toFixed(1)}" y="${(y - 1.5).toFixed(1)}" width="5.2" height="4.4" rx="1.4" fill="${fill}" ${ink(c, 1)}/>`;
    }).join("")}
    <circle cx="24" cy="22" r="3" fill="${GOLD}" ${ink(c, 1.2)}/>`,

  star: (c) => `
    <path d="M24 4l5.6 11.6 12.6 1.6-9.2 8.8 2.4 12.6L24 32.6 12.6 38.6l2.4-12.6-9.2-8.8 12.6-1.6z" fill="${c.accent}" ${ink(c)}/>
    <path d="M24 12l2.4 5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" opacity="0.8"/>`,

  food: (c) => `${shadow(c, 14)}
    <path d="M10 26h24v6a10 10 0 0 1-10 10h-4a10 10 0 0 1-10-10z" fill="${c.wall}" ${ink(c)}/>
    <path d="M34 28h3a4 4 0 0 1 0 8h-4" fill="none" ${ink(c)}/>
    <ellipse cx="22" cy="26.5" rx="11" ry="2" fill="${BARK}" ${ink(c, 1.1)}/>
    <path d="M17 21q-2-3 0-6t0-6M23 21q-2-3 0-6t0-6" fill="none" stroke="${c.ink}" stroke-width="1.3" stroke-linecap="round" opacity="0.6"/>
    <path d="M14 30h16" stroke="${c.accent}" stroke-width="2" stroke-linecap="round"/>`,

  home: (c) => `${shadow(c, 14)}
    <rect x="29" y="12" width="4" height="8" fill="${c.wall}" ${ink(c)}/>
    <rect x="12" y="24" width="24" height="20" fill="${c.wall}" ${ink(c)}/>
    <path d="M9 25L24 12l15 13z" fill="${c.roof}" ${ink(c)}/>
    <rect x="15.5" y="28" width="6" height="6" rx="0.8" fill="${c.accent2}" ${ink(c, 1.1)}/>
    <rect x="26" y="33" width="6" height="11" fill="${c.ink}"/>`,

  tree: (c) => `<ellipse cx="24" cy="44.6" rx="9" ry="2.2" fill="${c.ink}" opacity="0.16"/>
    <path d="M24 44V30" ${ink(c, 2.2)}/>
    <circle cx="24" cy="21" r="12" fill="${c.forest}" ${ink(c)}/>
    <circle cx="19.5" cy="17" r="4.5" fill="${c.green}"/>
    <circle cx="28" cy="25" r="2" fill="${c.green}"/>`,

  pine: (c) => `<ellipse cx="24" cy="44.6" rx="8" ry="2.2" fill="${c.ink}" opacity="0.16"/>
    <path d="M24 44v-6" ${ink(c, 2.2)}/>
    <path d="M24 3l9 13h-4.5L35 27h-5.5L36 38H12l6.5-11H13l6.5-11H15z" fill="${c.forest}" ${ink(c)}/>
    <path d="M24 8l-4 6" stroke="${c.green}" stroke-width="2" stroke-linecap="round"/>`,

  houses: (c) => `<ellipse cx="24" cy="44.6" rx="18" ry="2.4" fill="${c.ink}" opacity="0.14"/>
    <rect x="22" y="22" width="18" height="22" fill="${c.wall}" ${ink(c)}/>
    <path d="M20 23l11-10 11 10z" fill="${c.accent2}" ${ink(c)}/>
    <rect x="27" y="28" width="5" height="5" rx="0.6" fill="${c.accent}"/>
    <rect x="8" y="28" width="16" height="16" fill="${c.wall}" ${ink(c)}/>
    <path d="M6 29l10-9 10 9z" fill="${c.roof}" ${ink(c)}/>
    <rect x="13.5" y="36" width="5" height="8" fill="${c.ink}"/>`,
};

export const ICON_KINDS = ["castle", "worship", "museum", "palace", "bridge", "tower", "stadium", "theatre", "school", "hospital", "zoo", "viewpoint", "monument", "attraction", "star", "food", "home"];

export const KIND_LABELS = {
  castle: "Castle", worship: "Church", museum: "Museum", palace: "Palace", bridge: "Bridge", tower: "Tower",
  stadium: "Stadium", theatre: "Theatre", school: "School", hospital: "Hospital", zoo: "Zoo", viewpoint: "Viewpoint",
  monument: "Monument", attraction: "Attraction", star: "Star", food: "Food", home: "Home",
};

// Which landmark wins when space is tight.
// Sights people travel for come first; churches and civic buildings after.
export const RANK = { castle: 0, attraction: 1, viewpoint: 1, museum: 2, zoo: 2, bridge: 3, palace: 3, tower: 4, stadium: 5, theatre: 5, worship: 6, monument: 7, school: 9, hospital: 10 };

export const iconId = (kind) => `icon-${DRAW[kind] ? kind : "star"}`;

export function iconDefs(pal) {
  return Object.entries(DRAW)
    .map(([k, f]) => `<symbol id="icon-${k}" viewBox="0 0 48 48" overflow="visible">${f(pal)}</symbol>`)
    .join("");
}

// A single icon as a standalone SVG file (for site listings, buttons, favicons).
export function iconSVG(kind, pal) {
  const draw = DRAW[kind] || DRAW.star;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">${draw(pal)}</svg>\n`;
}
