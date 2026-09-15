# tz-engine

A small Next.js app for looking up historical OHLC (Open/High/Low/Close) data
for global stocks and market indices.

- **Index tab**: pick a major world index (Nifty 50, Sensex, S&P 500, Dow
  Jones, Nasdaq 100, FTSE 100, DAX, CAC 40, Nikkei 225, Hang Seng) and pull
  its own price history directly.
- **Stock tab**: optionally narrow to a market, then search any stock by
  name across global exchanges.
- Pick a start and end date, and a daily/weekly/monthly interval.
- View results in a table and download them as CSV.

Deliberately **not** included: a dropdown of "every stock in every index."
Index constituent lists aren't reliably available from Yahoo's free/
unofficial endpoints and go stale as indices rebalance — shipping a wrong or
outdated list on a financial data tool is worse than not having one. The
curated index list in `lib/indices.ts` only carries well-known, stable index
tickers (e.g. `^NSEI`, `^GSPC`), used both to fetch the index's own history
and as a region hint that narrows stock search to that market.

## How it works

The frontend (`app/page.tsx`) never calls an external API directly. It talks
to two server-side route handlers, which proxy Yahoo Finance's public
(unofficial, undocumented) endpoints — the same ones tools like `yfinance`
use:

- `GET /api/search?q=<text>&region=<2-letter code>` — resolves a search
  string to matching stocks/indices globally, optionally weighted toward a
  market (`lib/yahoo.ts` → `searchSymbols`). `region` is a soft hint, not a
  hard filter — Yahoo's non-US exchange codes aren't reliably documented
  enough to filter on exactly.
- `GET /api/history?symbol=<sym>&start=YYYY-MM-DD&end=YYYY-MM-DD&interval=1d|1wk|1mo`
  — returns OHLC rows for that symbol (stock or index) and range
  (`lib/yahoo.ts` → `fetchHistory`).

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
been exercised end-to-end in every case. Test against a real network before
relying on it in production.

## Production considerations

- Yahoo's endpoints are unofficial and can be rate-limited or blocked for a
  given IP/deployment. For a production website with real traffic, consider
  a proper licensed market-data vendor instead.
- There is no caching layer yet — every search keystroke and every "Fetch
  data" click hits Yahoo directly. Add caching (e.g. a short-TTL in-memory or
  Redis cache) before this sees real traffic.
- The index list in `lib/indices.ts` is intentionally small and hand-picked
  for confidence in the ticker symbols. Adding more indices is safe as long
  as each symbol is verified against Yahoo Finance directly first.
