// Minimal standalone copy of lib/yahoo.ts's chart-fetching logic, for use
// by scripts that run via plain `node` outside the Next.js/TypeScript
// build (same reason bulk-upload-consolidated.mjs duplicates CHUNK_PLAN
// instead of importing it). Only fetches daily bars -- refresh-daily.mjs
// is the only thing that talks to Yahoo directly; weekly/monthly/yearly
// are always derived from daily (see rollup-period.mjs), so there's no
// need to duplicate Yahoo's own weekly/monthly interval handling here.

const CHART_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch daily OHLCV bars for `symbol` over the last `lookbackDays` calendar
 * days. Returns [] (not a throw) for a symbol Yahoo doesn't recognize (404)
 * so callers can skip a bad ticker mapping without aborting the whole run
 * -- everything else (network error, 429, 5xx) retries with backoff, then
 * throws if still failing, since those are transient rather than "this
 * ticker mapping is wrong."
 */
export async function fetchRecentDaily(symbol, lookbackDays = 10, maxAttempts = 4) {
  const period2 = Math.floor(Date.now() / 1000);
  const period1 = period2 - lookbackDays * 24 * 60 * 60;

  const url = new URL(`${CHART_BASE}/${encodeURIComponent(symbol)}`);
  url.searchParams.set("period1", String(period1));
  url.searchParams.set("period2", String(period2));
  url.searchParams.set("interval", "1d");
  url.searchParams.set("events", "history");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url.toString(), {
        headers: { "User-Agent": "Mozilla/5.0" },
        cache: "no-store",
      });
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      await sleep(2000 * attempt);
      continue;
    }

    if (res.status === 404) return [];
    if (res.status === 429 || res.status >= 500) {
      if (attempt === maxAttempts) {
        throw new Error(`Yahoo chart request failed with status ${res.status} for "${symbol}"`);
      }
      await sleep(3000 * attempt);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Yahoo chart request failed with status ${res.status} for "${symbol}"`);
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    const chartError = data?.chart?.error;
    if (chartError) {
      // Yahoo returns a 200 with an error body for an unknown symbol too.
      return [];
    }
    if (!result) return [];

    const timestamps = result.timestamp || [];
    const quote = result.indicators?.quote?.[0] || {};
    const opens = quote.open || [];
    const highs = quote.high || [];
    const lows = quote.low || [];
    const closes = quote.close || [];
    const volumes = quote.volume || [];

    const rows = [];
    for (let i = 0; i < timestamps.length; i++) {
      const open = opens[i];
      const high = highs[i];
      const low = lows[i];
      const close = closes[i];
      if ([open, high, low, close].some((n) => typeof n !== "number" || Number.isNaN(n))) {
        continue; // Yahoo pads non-trading days in-range with nulls.
      }
      const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
      const volume = typeof volumes[i] === "number" ? volumes[i] : 0;
      rows.push([date, open, high, low, close, volume]);
    }
    return rows;
  }
  return [];
}
