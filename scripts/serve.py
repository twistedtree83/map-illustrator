#!/usr/bin/env python3
"""Local dev server for the map editor.

- Serves the project folder with caching disabled (edits show on reload).
- POST /api/build {"name": "...", "relations": [ids], "title": "..."} runs
  scripts/fetch-osm.mjs and streams its output back line by line.
"""
import http.server, json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
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

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8137
print(f"Serving {ROOT} on http://localhost:{port}")
http.server.ThreadingHTTPServer(("", port), Handler).serve_forever()
