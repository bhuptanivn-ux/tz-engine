# tz-engine

The TZ BUY state-machine trading engine. See `WTF_RULEBOOK.md` for the
full, consolidated rule set; `tz_engine_wtf.py` is the implementation and
`test_wtf_smoke.py` the synthetic-OHLC smoke test suite (`python3
test_wtf_smoke.py`).

## API (Vercel)

`api/run.py` exposes the engine as a stateless JSON API, deployable
directly on Vercel (zero-config Python runtime, no third-party
dependencies).

```
POST /api/run
{ "days": [ { "date": "2024-01-01", "o": 100, "h": 101, "l": 99, "c": 100.5 }, ... ] }
```

Returns `{ "results": [ { "date": "...", "events": [...] }, ... ] }` --
one entry per day after the first (the first row only ever serves as the
initial "prev" reference for the second). Each request runs a fresh
engine over the whole series you send; there's no server-side state kept
between requests.

`GET /api/run` returns a short usage message, useful for confirming the
deployment is live.
