// "New map" panel: search regions, add neighbours, build via the dev server.

const $ = (id) => document.getElementById(id);
// (overpass.kumi.systems doesn't send CORS headers, so it's server-side only.)
const OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

const picked = new Map(); // relation id -> {id, name, detail, level}
const suggestions = new Map(); // relation id -> {id, name, level, from}
const parents = new Map(); // relation id -> {id, name, qid, from}: larger areas containing a pick
const pending = new Set(); // relation ids whose neighbours are loading
const failed = new Set(); // relation ids whose neighbour lookup failed
let searchTimer = 0;
let searchSeq = 0;

const slug = (s) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "map";

function escHTML(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// ---------------------------------------------------------------- search

const TYPE_LABELS = {
  suburb: "Suburb", quarter: "Quarter", neighbourhood: "Neighbourhood", city_district: "District", borough: "Borough",
  village: "Village", town: "Town", city: "City", municipality: "Council area", county: "County / council area",
  state_district: "District", region: "Region", state: "State", province: "Province", country: "Country",
};

// "Council area · ≈ 410 km²" from the result type and its bounding box.
function describe(h) {
  const [s, n, w, e] = h.boundingbox.map(Number);
  const km2 = Math.abs((e - w) * 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180) * (n - s) * 110.57) * 0.6; // bbox → rough area
  const size = km2 < 10 ? `${km2.toFixed(1)} km²` : km2 < 10000 ? `${Math.round(km2).toLocaleString()} km²` : `${Math.round(km2 / 1000).toLocaleString()}k km²`;
  const type = TYPE_LABELS[h.addresstype] || (/council|shire|city of/i.test(h.name || "") ? "Council area" : "Area");
  return `${type} · ≈ ${size}`;
}

async function search(q) {
  const seq = ++searchSeq;
  const ul = $("b-results");
  if (q.trim().length < 2) { ul.replaceChildren(); return; }
  ul.innerHTML = `<li class="muted">Searching…</li>`;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=10&addressdetails=0&extratags=1&q=${encodeURIComponent(q)}`;
    const all = await (await fetch(url, { headers: { "Accept-Language": "en" } })).json();
    const hits = all.filter((h) => h.osm_type === "relation" && h.category === "boundary" || h.osm_type === "relation" && h.addresstype !== "island");
    // Landmarks/points ("Echo Point", "Three Sisters"): offer the area they're in.
    const spots = all.filter((h) => !hits.includes(h)).slice(0, 3);
    if (seq !== searchSeq) return;
    ul.replaceChildren();
    if (spots.length) suggestContaining(spots, ul, seq);
    if (!hits.length && !spots.length) { ul.innerHTML = `<li class="muted">Nothing found. Try adding the state or country.</li>`; return; }
    for (const h of hits.slice(0, 6)) {
      const li = document.createElement("li");
      const [first, ...rest] = h.display_name.split(", ");
      li.innerHTML = `<button type="button"><strong>${escHTML(first)}</strong><span class="badge">${escHTML(describe(h))}</span><small>${escHTML(rest.slice(0, 3).join(", "))}</small></button>`;
      li.querySelector("button").onclick = () => {
        add({ id: h.osm_id, name: first, detail: rest.slice(0, 2).join(", "), qid: h.extratags?.wikidata });
        ul.replaceChildren();
        $("b-search").value = "";
      };
      ul.append(li);
    }
  } catch {
    ul.innerHTML = `<li class="muted">Search failed — check your connection.</li>`;
  }
}

// For a landmark/point result, find the suburb or town that contains it
// (reverse geocode at suburb level, then town level) and offer that area.
async function suggestContaining(spots, ul, seq) {
  const seen = new Set();
  for (const h of spots) {
    const li = document.createElement("li");
    li.className = "spot";
    const [first, ...rest] = h.display_name.split(", ");
    li.innerHTML = `<div class="spot-name"><strong>${escHTML(first)}</strong> <span class="badge">${escHTML(TYPE_LABELS[h.addresstype] || h.addresstype || h.type)}</span><small>${escHTML(rest.slice(0, 3).join(", "))}</small></div><div class="spot-in muted">Finding the area it's in…</div>`;
    ul.append(li);
    let area = null;
    for (const zoom of [14, 12, 10]) {
      await new Promise((ok) => setTimeout(ok, 1100)); // Nominatim: max 1 request/second
      if (seq !== searchSeq) return;
      try {
        const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=${zoom}&extratags=1&accept-language=en&lat=${h.lat}&lon=${h.lon}`)).json();
        if (r.osm_type === "relation") { area = r; break; }
      } catch {}
    }
    const slot = li.querySelector(".spot-in");
    if (!area || seen.has(area.osm_id)) { slot.textContent = area ? "" : "No area boundary found around it."; if (area) li.remove(); continue; }
    seen.add(area.osm_id);
    const name = area.name || area.display_name.split(", ")[0];
    slot.classList.remove("muted");
    slot.innerHTML = `In <b>${escHTML(name)}</b> <span class="badge">${escHTML(describe(area))}</span> <button type="button" class="suggest">+ Add ${escHTML(name)}</button>`;
    slot.querySelector("button").onclick = () => {
      add({ id: area.osm_id, name, detail: "", qid: area.extratags?.wikidata });
      ul.replaceChildren();
      $("b-search").value = "";
    };
  }
}

// ---------------------------------------------------------------- picked regions

function add(r, { lookup = true } = {}) {
  if (picked.has(r.id)) return;
  picked.set(r.id, r);
  suggestions.delete(r.id);
  if (!$("b-title").dataset.touched) $("b-title").value = autoTitle();
  renderChips();
  if (lookup) findNeighbours(r);
}

function remove(id) {
  picked.delete(id);
  failed.delete(id);
  for (const [k, s] of suggestions) if (s.from === id) suggestions.delete(k);
  for (const [k, s] of parents) if (s.from === id) parents.delete(k);
  if (!$("b-title").dataset.touched) $("b-title").value = autoTitle();
  renderChips();
}

function autoTitle() {
  const names = [...picked.values()].map((r) => r.name);
  if (names.length > 4) return `${names.slice(0, 3).join(", ")} & ${names.length - 3} more`;
  return names.length <= 2 ? names.join(" & ") : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

function renderChips() {
  const box = $("b-chips");
  box.replaceChildren();
  for (const r of picked.values()) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `${escHTML(r.name)}<button type="button" class="sub" title="Pick suburbs inside ${escHTML(r.name)}">suburbs ▾</button><button type="button" class="x" aria-label="Remove ${escHTML(r.name)}">×</button>`;
    chip.querySelector(".x").onclick = () => remove(r.id);
    chip.querySelector(".sub").onclick = () => openChildren(r);
    box.append(chip);
  }
  $("b-empty").hidden = picked.size > 0;
  $("b-build").disabled = picked.size === 0;

  const sg = $("b-neighbours");
  sg.replaceChildren();
  const status = (text, retryId) => {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = text;
    if (retryId) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "suggest";
      b.textContent = "Retry";
      b.onclick = () => { failed.delete(retryId); findNeighbours(picked.get(retryId)); };
      p.append(" ", b);
    }
    sg.append(p);
  };
  if (pending.size) status("Finding neighbouring regions…");

  // Larger areas: swap a pick for the area that contains it.
  const ups = [...parents.values()].filter((u) => !picked.has(u.id) && picked.has(u.from));
  if (ups.length) {
    const h = document.createElement("p");
    h.className = "hint";
    h.textContent = "Use a larger area instead:";
    sg.append(h);
    for (const u of ups) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "suggest up";
      b.textContent = `↗ ${u.name}`;
      b.title = `Replace ${picked.get(u.from)?.name} with ${u.name}`;
      b.onclick = () => {
        // Drop every pick this area contains, then add it.
        for (const [k, p] of parents) if (k === u.id && picked.has(p.from)) remove(p.from);
        remove(u.from);
        add({ id: u.id, name: u.name, detail: "", qid: u.qid });
      };
      sg.append(b);
    }
  }
  for (const id of failed) if (picked.has(id)) status(`Couldn't load neighbours of ${picked.get(id).name} (map server busy).`, id);
  const list = [...suggestions.values()].filter((s) => !picked.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (list.length) {
    const h = document.createElement("p");
    h.className = "hint";
    h.textContent = "Neighbouring regions — click to add:";
    sg.append(h);
    for (const s of list.slice(0, 24)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "suggest";
      b.textContent = `+ ${s.name}`;
      b.onclick = () => add({ id: s.id, name: s.name, detail: "", qid: s.qid });
      sg.append(b);
    }
  }
}

// Wikidata records "shares border with" (P47) and each place's OSM relation
// (P402). Fast and reliable, so it's tried first.
const WD = "https://www.wikidata.org/w/api.php?format=json&origin=*&action=wbgetentities";
// Returns bordering places (P47) and the larger areas containing it (P131),
// keeping only those that have an OSM boundary relation (P402).
async function wikidataNeighbours(qid) {
  const self = (await (await fetch(`${WD}&props=claims&ids=${qid}`, { signal: AbortSignal.timeout(12000) })).json()).entities?.[qid];
  const ids = (p) => (self?.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
  const near = ids("P47").slice(0, 45), up = ids("P131").slice(0, 5);
  if (!near.length && !up.length) return { neighbours: [], parents: [] };
  const ents = (await (await fetch(`${WD}&props=claims|labels&languages=en&ids=${[...near, ...up].join("|")}`, { signal: AbortSignal.timeout(12000) })).json()).entities || {};
  const pick = (list) => list.map((q) => ents[q]).filter(Boolean)
    .map((e) => ({ id: Number(e.claims?.P402?.[0]?.mainsnak?.datavalue?.value), name: e.labels?.en?.value, qid: e.id }))
    .filter((n) => n.id && n.name);
  return { neighbours: pick(near), parents: pick(up) };
}

// Regions that share a border with this one: Wikidata first, then Overpass.
async function findNeighbours(r) {
  pending.add(r.id);
  renderChips();
  if (r.qid) {
    try {
      const { neighbours: list, parents: ups } = await wikidataNeighbours(r.qid);
      for (const u of ups) if (!picked.has(u.id)) parents.set(u.id, { ...u, from: r.id });
      if (list.length) {
        for (const n of list) if (!picked.has(n.id)) suggestions.set(n.id, { ...n, from: r.id });
        pending.delete(r.id);
        renderChips();
        return;
      }
    } catch {}
  }
  const q = `[out:json][timeout:25];rel(${r.id})->.r;.r out tags;way(r.r)->.w;rel(bw.w)["boundary"="administrative"];out tags;`;
  // Public servers are often busy: try each mirror, back off, try again.
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    if (attempt >= OVERPASS.length) await new Promise((ok) => setTimeout(ok, 1500 * attempt));
    if (!picked.has(r.id)) break;
    try {
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(15000), // some mirrors hang instead of refusing
      });
      if (!res.ok) continue;
      const els = (await res.json()).elements || [];
      const self = els.find((e) => e.id === r.id);
      const level = self?.tags?.admin_level;
      if (!picked.has(r.id)) return;
      picked.get(r.id).level = level;
      for (const e of els) {
        if (e.id === r.id || e.tags?.admin_level !== level || picked.has(e.id)) continue;
        suggestions.set(e.id, { id: e.id, name: e.tags["name:en"] || e.tags.name || `#${e.id}`, level, qid: e.tags.wikidata, from: r.id });
      }
      pending.delete(r.id);
      renderChips();
      return;
    } catch {}
  }
  pending.delete(r.id);
  failed.add(r.id);
  renderChips();
}

// ---------------------------------------------------------------- suburbs inside an area

// Lists the suburbs/districts inside a picked area so you can keep only some.
async function openChildren(r) {
  const box = $("b-children");
  box.hidden = false;
  box.innerHTML = `<p class="hint">Finding suburbs inside <b>${escHTML(r.name)}</b>… (can take up to a minute when map servers are busy)</p>`;
  let data;
  try {
    data = await (await fetch(`api/children?rel=${r.id}`)).json();
  } catch {
    data = { error: "Lookup failed. Is the dev server running?" };
  }
  if (!picked.has(r.id)) { box.hidden = true; return; }
  if (data.error || !data.levels?.length) {
    box.innerHTML = `<p class="hint">${escHTML(data.error || `No suburbs found inside ${r.name}.`)}</p><button type="button" class="ghost" id="bc-close">Close</button>`;
    $("bc-close").onclick = () => (box.hidden = true);
    return;
  }
  let lv = data.levels[0];
  const draw = () => {
    const levelPick = data.levels.length > 1
      ? `<select id="bc-level">${data.levels.map((l, i) => `<option value="${i}" ${l === lv ? "selected" : ""}>${l.count} areas (admin level ${l.level})</option>`).join("")}</select>` : "";
    box.innerHTML = `
      <div class="bc-head"><strong>${escHTML(data.region.name)}</strong><small>≈ ${data.region.km2.toLocaleString()} km² · ${lv.count} suburbs</small>${levelPick}</div>
      <div class="bc-tools"><button type="button" class="suggest" id="bc-all">All</button><button type="button" class="suggest" id="bc-none">None</button><input type="search" id="bc-filter" placeholder="Filter…" /></div>
      <ul class="bc-list">${lv.children.map((c) => `<li><label><input type="checkbox" value="${c.id}" checked /> ${escHTML(c.name)} <small>${c.km2} km²</small></label></li>`).join("")}</ul>
      <div class="bc-foot"><span id="bc-sum"></span><button type="button" id="bc-use">Use these</button><button type="button" class="ghost" id="bc-cancel">Cancel</button></div>`;
    const boxes = () => [...box.querySelectorAll(".bc-list input")];
    const sum = () => {
      const on = boxes().filter((b) => b.checked).map((b) => lv.children.find((c) => c.id === Number(b.value)));
      $("bc-sum").textContent = `${on.length} selected · ≈ ${Math.round(on.reduce((s, c) => s + c.km2, 0)).toLocaleString()} km²`;
      $("bc-use").disabled = !on.length;
    };
    box.querySelector(".bc-list").onchange = sum;
    $("bc-all").onclick = () => { boxes().forEach((b) => (b.checked = !b.closest("li").hidden)); sum(); };
    $("bc-none").onclick = () => { boxes().forEach((b) => (b.checked = false)); sum(); };
    $("bc-filter").oninput = (e) => {
      const f = e.target.value.toLowerCase();
      box.querySelectorAll(".bc-list li").forEach((li) => (li.hidden = f && !li.textContent.toLowerCase().includes(f)));
    };
    $("bc-cancel").onclick = () => (box.hidden = true);
    $("bc-use").onclick = () => {
      const keep = boxes().filter((b) => b.checked).map((b) => lv.children.find((c) => c.id === Number(b.value)));
      remove(r.id);
      for (const c of keep) add({ id: c.id, name: c.name, detail: r.name, qid: c.qid }, { lookup: false });
      box.hidden = true;
    };
    if ($("bc-level")) $("bc-level").onchange = (e) => { lv = data.levels[Number(e.target.value)]; draw(); };
    sum();
  };
  draw();
}

// ---------------------------------------------------------------- build

async function build(onBuilt) {
  const title = $("b-title").value.trim() || autoTitle();
  const name = slug(title);
  const log = $("b-log");
  log.hidden = false;
  log.textContent = `Building “${title}” from ${picked.size} region${picked.size > 1 ? "s" : ""}…\nThis usually takes 1–3 minutes (public map servers can be busy).\n\n`;
  $("b-build").disabled = true;
  try {
    const res = await fetch("api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, title, relations: [...picked.keys()] }),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let all = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = dec.decode(value, { stream: true });
      all += text;
      log.textContent += text;
      log.scrollTop = log.scrollHeight;
    }
    if (all.includes(`DONE ${name}`)) {
      log.textContent += "\n✓ Map ready.";
      await onBuilt(name);
    } else {
      log.textContent += "\n✗ Build did not finish — see the messages above.";
    }
  } catch (e) {
    log.textContent += `\n✗ ${e.message}. Is the dev server running (npm run serve)?`;
  } finally {
    $("b-build").disabled = picked.size === 0;
  }
}

export function initBuilder({ onBuilt }) {
  $("b-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => search(e.target.value), 650); // stay well under Nominatim's 1 req/s
  });
  $("b-title").addEventListener("input", (e) => (e.target.dataset.touched = e.target.value ? "1" : ""));
  $("b-build").onclick = () => build(onBuilt);
  renderChips();
}
