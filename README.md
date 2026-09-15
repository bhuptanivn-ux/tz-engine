# tz-engine

A small Next.js app for looking up historical OHLC (Open/High/Low/Close) data
for NSE-listed stocks.

- Search any NSE-listed stock by name or symbol.
- Pick a start and end date, and a daily/weekly/monthly interval.
- View results in a table and download them as CSV.

## How it works

The frontend (`app/page.tsx`) never calls an external API directly. It talks
to two server-side route handlers, which proxy Yahoo Finance's public
(unofficial, undocumented) endpoints — the same ones tools like `yfinance`
use:

- `GET /api/search?q=<text>` — resolves a search string to NSE ticker
  symbols (`lib/yahoo.ts` → `searchNseSymbols`).
- `GET /api/history?symbol=<sym>&start=YYYY-MM-DD&end=YYYY-MM-DD&interval=1d|1wk|1mo`
  — returns OHLC rows for that symbol and range (`lib/yahoo.ts` →
  `fetchHistory`).

Proxying server-side avoids browser CORS issues and keeps the Yahoo endpoint
details out of client code. Yahoo has no official partner API for this data,
so these endpoints can change or start rate-limiting without notice — treat
failures from them as expected, not as bugs in this app.

## Development

```bash
npm install
npm run dev   # http://localhost:3000
```

**Note:** the sandboxed environment this was originally built in has no
outbound network access to Yahoo Finance, so the API routes were verified to
build, start, validate input correctly, and fail cleanly (502 with a
readable error) rather than crash — but the actual live data path has not
been exercised end-to-end. Test against a real network before relying on it
in production.

## Production considerations

- Yahoo's endpoints are unofficial and can be rate-limited or blocked for a
  given IP/deployment. For a production website with real traffic, consider
  a proper licensed market-data vendor instead.
- There is no caching layer yet — every search keystroke and every "Fetch
  data" click hits Yahoo directly. Add caching (e.g. a short-TTL in-memory or
  Redis cache) before this sees real traffic.
