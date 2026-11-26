#!/usr/bin/env python3
"""Local dev server for the map editor.

- Serves the project folder with caching disabled (edits show on reload).
- POST /api/build {"name": "...", "relations": [ids], "title": "..."} runs
  scripts/fetch-osm.mjs and streams its output back line by line.
"""
import glob, http.server, json, os, re, subprocess, sys, threading, unicodedata
from urllib.parse import parse_qs, urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        # GET /api/search?q=<text> -> matching area outlines from the downloaded data
        if self.path.startswith("/api/search"):
            q = (parse_qs(urlparse(self.path).query).get("q") or [""])[0][:100]
            items = _load_index()
            states = [it["bbox"] for it in items if it.get("level") == 4] or [it["bbox"] for it in items]
            bounds = [min(b[0] for b in states), min(b[1] for b in states), max(b[2] for b in states), max(b[3] for b in states)] if states else None
            out = json.dumps({"local": bool(items), "bounds": bounds, "results": search_areas(q) if items else []}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(out)
            return
        # GET /api/children?rel=<id> -> suburbs/districts inside that boundary
        if self.path.startswith("/api/children"):
            m = re.search(r"[?&]rel=(\d{1,12})\b", self.path)
            if not m:
                self.send_error(400, "rel=<relation id> required")
                return
            try:
                run = subprocess.run(["node", os.path.join(ROOT, "scripts", "children.mjs"), m.group(1)],
                                     cwd=ROOT, capture_output=True, timeout=600)
            except subprocess.TimeoutExpired:
                self.send_error(504, "map servers too busy, try again")
                return
            body = run.stdout.strip() or json.dumps({"error": "lookup failed"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/kit":
            return self.write_kit()
        if self.path != "/api/build":
            self.send_error(404)
            return
        try:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            name = str(body.get("name", ""))
            relations = [int(r) for r in body.get("relations", [])]
            title = str(body.get("title", "")).strip()[:80]
        except (ValueError, TypeError):
            self.send_error(400, "bad request")
            return
        if not NAME_RE.match(name) or not relations or len(relations) > 150:
            self.send_error(400, "name must be lowercase letters/numbers/dashes; 1-150 regions")
            return

        # Arguments are passed as a list (no shell), so nothing is interpreted.
        cmd = ["node", os.path.join(ROOT, "scripts", "fetch-osm.mjs"), name,
               "--relation", ",".join(str(r) for r in relations)]
        if title:
            cmd += ["--title", title]

        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=0)
        try:
            for chunk in iter(lambda: proc.stdout.read(256), b""):
                self.wfile.write(chunk)
                self.wfile.flush()
            proc.wait()
            if proc.returncode != 0:
                self.wfile.write(f"\nFAILED (exit {proc.returncode})\n".encode())
        except (BrokenPipeError, ConnectionResetError):
            proc.kill()


# ------------------------------------------------------------ local area search
# Index of every named area outline in data-src/*.osm.pbf, built by
# scripts/area-index.mjs (a few seconds, cached next to the .pbf).
_index = {"items": None, "lock": threading.Lock()}
GENERIC = {"council", "city", "shire", "municipality", "municipal", "region", "regional", "of", "the",
           "local", "government", "area", "lga", "district"}
KIND_RANK = {"State": 0, "Territory": 0, "Region": 1, "Council area": 2, "City": 3, "Municipality": 3,
             "Town": 4, "District": 4, "Suburb": 5, "Quarter": 5, "Village": 6, "Locality": 7,
             "Neighbourhood": 7, "Hamlet": 8}


def _norm(t):
    t = unicodedata.normalize("NFD", t.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def _core(words):
    core = [w for w in words if w not in GENERIC]
    return core or words


def _load_index():
    with _index["lock"]:
        if _index["items"] is None:
            if not glob.glob(os.path.join(ROOT, "data-src", "*.osm.pbf")):
                _index["items"] = []
            else:
                subprocess.run(["node", os.path.join(ROOT, "scripts", "area-index.mjs")], cwd=ROOT,
                               capture_output=True, timeout=900)
                items = []
                for f in glob.glob(os.path.join(ROOT, "data-src", "*.areas.json")):
                    with open(f, encoding="utf-8") as fh:
                        items += json.load(fh)
                for it in items:
                    it["_names"] = [_norm(n).split() for n in [it["name"], *it.get("alt", [])] if n]
                _index["items"] = items
        return _index["items"]


def search_areas(q, limit=8):
    words = _norm(q).split()
    if not words:
        return []
    core = _core(words)
    scored = []
    for it in _load_index():
        best = 0
        for name in it["_names"]:
            ncore = _core(name)
            if name == words or ncore == core:
                s = 100
            elif ncore[:len(core)] == core:
                s = 80  # "Penrith" -> "Penrith Lakes"
            elif all(w in name for w in core):
                s = 65  # whole words anywhere: "Hunter" -> "Upper Hunter Shire Council"
            elif " ".join(ncore).startswith(" ".join(core)):
                s = 55  # still typing: "Katoo" -> "Katoomba"
            elif all(any(n.startswith(w) for n in name) for w in core):
                s = 40
            else:
                continue
            best = max(best, s)
        if best:
            scored.append((-best, KIND_RANK.get(it["kind"], 9), -it.get("km2", 0), it))
    scored.sort(key=lambda x: x[:3])
    return [{k: v for k, v in it.items() if not k.startswith("_")} | {"score": -s}
            for s, _, _, it in scored[:limit]]


def _write_kit(self):
    """POST /api/kit {"name": "...", "files": {"relative/path": "text"}} -> kits/<name>/"""
    try:
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        name = str(body.get("name", ""))
        files = body.get("files") or {}
    except (ValueError, TypeError):
        self.send_error(400, "bad request")
        return
    if not NAME_RE.match(name) or not isinstance(files, dict) or not files or len(files) > 200:
        self.send_error(400, "bad kit")
        return
    base = os.path.join(ROOT, "kits", name)
    for rel, text in files.items():
        # Only plain relative paths inside the kit folder.
        if not re.match(r"^[a-zA-Z0-9_][a-zA-Z0-9_./-]{0,120}$", rel) or ".." in rel or not isinstance(text, str):
            self.send_error(400, f"bad file path: {rel}")
            return
    for rel, text in files.items():
        dest = os.path.join(base, rel)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            f.write(text)
    out = json.dumps({"path": f"kits/{name}/", "files": len(files)}).encode()
    self.send_response(200)
    self.send_header("Content-Type", "application/json")
    self.end_headers()
    self.wfile.write(out)


Handler.write_kit = _write_kit

threading.Thread(target=_load_index, daemon=True).start()  # warm the index
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
print(f"Serving {ROOT} on http://localhost:{port}")
class Server(http.server.ThreadingHTTPServer):
    # The default backlog (5) resets connections when the browser loads many
    # modules at once, so scripts like builder.js randomly failed to load.
    request_queue_size = 128
    daemon_threads = True


Server(("", port), Handler).serve_forever()
