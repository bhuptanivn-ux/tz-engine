"""
Vercel serverless function exposing tz_engine_wtf.py's TZ BUY engine as a
JSON API. Deployed automatically by Vercel's zero-config Python runtime --
any .py file under api/ that defines a BaseHTTPRequestHandler subclass
named `handler` becomes an endpoint at the matching path (this file ->
POST/GET /api/run). No third-party dependencies (stdlib http.server only)
-- the engine itself (tz_engine_wtf.py) has none either once xlsx loading
is skipped (see run_series there).

Request:
  POST /api/run
  { "days": [ { "date": "2024-01-01", "o": 100, "h": 101, "l": 99, "c": 100.5 }, ... ] }

  At least 2 rows are required (process() always compares a day against
  the previous one; the first row only ever serves as that initial
  reference and produces no events of its own).

Response (200):
  { "results": [ { "date": "...", "events": ["TZ GREEN(A)", ...] }, ... ] }

Response (400) on bad input (e.g. fewer than 2 rows, missing fields):
  { "error": "<message>" }

GET /api/run returns a short usage message, for a quick sanity check that
the deployment is live.
"""
from http.server import BaseHTTPRequestHandler
import json
import os
import sys

# Repo root (one level up from api/) needs to be on sys.path so
# `tz_engine_wtf` -- a plain sibling module, not a package -- can be
# imported. Vercel's Python builder bundles the whole repo alongside the
# function, but doesn't guarantee the root is already on sys.path.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tz_engine_wtf import run_series  # noqa: E402


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            payload = json.loads(raw or b"{}")
            if not isinstance(payload, dict) or "days" not in payload:
                raise ValueError('Request body must be a JSON object with a "days" array.')
            results = run_series(payload["days"])
            self._send_json(200, {"results": results})
        except (ValueError, KeyError, TypeError) as e:
            self._send_json(400, {"error": str(e)})
        except json.JSONDecodeError:
            self._send_json(400, {"error": "Request body must be valid JSON."})

    def do_GET(self):
        self._send_json(200, {
            "status": "ok",
            "usage": 'POST /api/run with {"days": [{"date": "...", "o": .., "h": .., "l": .., "c": ..}, ...]}',
        })

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def _send_json(self, status: int, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
