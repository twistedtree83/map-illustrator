// Screen-space generalisation helpers. All points are [x, y] in pixels.

// Douglas–Peucker simplification. Keeps the overall shape, drops wiggles
// smaller than `tol` pixels.
export function simplify(points, tol) {
  if (points.length <= 2 || tol <= 0) return points;
  const sq = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDistSq(points[i], points[a], points[b]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > sq) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function segDistSq(p, a, b) {
  let x = a[0], y = a[1];
  let dx = b[0] - x, dy = b[1] - y;
  if (dx || dy) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) { x = b[0]; y = b[1]; }
    else if (t > 0) { x += dx * t; y += dy * t; }
  }
  dx = p[0] - x; dy = p[1] - y;
  return dx * dx + dy * dy;
}

// Chaikin corner cutting: each pass rounds every corner a bit more.
export function chaikin(points, iterations, closed) {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    if (pts.length < 3) return pts;
    const out = closed ? [] : [pts[0]];
    const n = pts.length;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
      out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    if (!closed) out.push(pts[n - 1]);
    pts = out;
  }
  return pts;
}

export function ringArea(points) {
  let a = 0;
  for (let i = 0, n = points.length, j = n - 1; i < n; j = i++) {
    a += (points[j][0] + points[i][0]) * (points[j][1] - points[i][1]);
  }
  return Math.abs(a / 2);
}

// Tiny deterministic noise so hand-drawn wobble is stable between renders.
export function wobble(points, amount, seed = 1) {
  if (!amount) return points;
  return points.map(([x, y], i) => {
    const s = Math.sin((x * 12.9898 + y * 78.233 + seed * 37.719 + i) * 0.05) * 43758.5453;
    const t = Math.sin((x * 39.346 + y * 11.135 + seed * 91.17 + i) * 0.05) * 24634.6345;
    return [x + (s - Math.floor(s) - 0.5) * amount, y + (t - Math.floor(t) - 0.5) * amount];
  });
}

export const toPath = (pts, closed) =>
  pts.length < 2 ? "" : "M" + pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L") + (closed ? "Z" : "");
