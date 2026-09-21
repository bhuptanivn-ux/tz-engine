// Reads OHLC history for symbols bulk-uploaded to Vercel Blob storage in
// CONSOLIDATED form: instead of one blob per instrument (which exceeded
// the plan's object-count limit and got the store blocked at 12,776
// objects), instruments are grouped into a small, fixed number of "chunk"
// files per segment+timeframe -- see CHUNK_PLAN below, which MUST match
// scripts/bulk-upload-consolidated.mjs exactly (duplicated rather than
// shared, since that script runs standalone via `node`, outside the
// Next.js/TypeScript build).
//
// Checked first by lib/marketData.ts for symbols we have -- it's faster
// than a live Yahoo Finance fetch and doesn't depend on Yahoo's
// undocumented endpoints staying reachable.

import type { HistoryRow, Interval } from "./yahoo";

const CHUNK_PLAN: Record<string, Record<string, number>> = {
  nse: { daily: 20, weekly: 4, monthly: 1, yearly: 1 },
  sme: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  commodity: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  crypto: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  forex: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  indexes: { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
  "international-indexes": { daily: 1, weekly: 1, monthly: 1, yearly: 1 },
};

// NSE stocks use their real Yahoo Finance suffix (".NS"), so they can also
// fall back to a live Yahoo fetch if ever missing from Blob. The other
// segments (Commodities, Crypto, Forex, Indian/International indices,
// SME) aren't standard Yahoo tickers at all -- their pseudo-suffixes below
// exist purely to route a lookup to the right Blob segment, matching the
// symbols generated in lib/otherMarkets.ts. There's no live-fetch fallback
// for these; Blob storage is the only source.
const SEGMENT_FOR_SUFFIX: Record<string, string> = {
  NS: "nse",
  COMM: "commodity",
  CRYPTO: "crypto",
  FX: "forex",
  IDX: "indexes",
  INTLIDX: "international-indexes",
  SME: "sme",
};

const TIMEFRAME_SLUG: Record<Interval, string> = {
  "1d": "daily",
  "1wk": "weekly",
  "1mo": "monthly",
};

// Deterministic ticker -> chunk index, identical to the copy in
// scripts/bulk-upload-consolidated.mjs. Hash-based rather than
// alphabetical so it doesn't depend on knowing the full ticker list.
function chunkIndexFor(ticker: string, chunkCount: number): number {
  if (chunkCount <= 1) return 0;
  let h = 0;
  for (let i = 0; i < ticker.length; i++) {
    h = (h * 31 + ticker.charCodeAt(i)) >>> 0;
  }
  return h % chunkCount;
}

export function blobLocationForSymbol(
  symbol: string
): { segment: string; ticker: string } | null {
  const idx = symbol.lastIndexOf(".");
  if (idx === -1) return null;
  const suffix = symbol.slice(idx + 1).toUpperCase();
  const segment = SEGMENT_FOR_SUFFIX[suffix];
  if (!segment) return null;
  const ticker = symbol.slice(0, idx).toUpperCase();
  if (!ticker) return null;
  return { segment, ticker };
}

// Vercel Blob URLs are deterministic: <storeId-without-"store_"-prefix,
// lowercased>.public.blob.vercel-storage.com/<pathname> -- since uploads
// use addRandomSuffix: false, the exact pathname is always known ahead of
// time. Constructing it directly avoids list(), which is billed as an
// "Advanced Operation" with a much lower monthly allowance than plain
// reads -- calling it on every history lookup is what burned through a
// 2,000/month quota in a single afternoon of testing.
function blobUrlFor(pathname: string): string {
  const storeId = process.env.BLOB_STORE_ID;
  if (!storeId) {
    throw new Error("BLOB_STORE_ID is not set in this environment.");
  }
  const hostPrefix = storeId.replace(/^store_/, "").toLowerCase();
  return `https://${hostPrefix}.public.blob.vercel-storage.com/${pathname}`;
}

type ChunkBundle = Record<string, [string, number, number, number, number, number][]>;

// Promise-memoized per warm serverless instance: the screener scans 2,578
// NSE stocks concurrently, and without this every one of them would
// independently re-fetch the same ~14MB chunk file before any single
// fetch completed (a thundering herd). Caching the in-flight promise
// itself (not just the resolved value) means concurrent callers share one
// fetch. Failures are NOT cached, so a transient error doesn't poison the
// cache for the rest of the instance's lifetime.
const bundleCache = new Map<string, Promise<ChunkBundle>>();

async function loadChunkBundle(segment: string, timeframe: string, chunkIndex: number): Promise<ChunkBundle> {
  const key = `${segment}/${timeframe}/${chunkIndex}`;
  const cached = bundleCache.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const pathname = `data/${segment}/${timeframe}/chunk-${chunkIndex}.json`;
    const url = blobUrlFor(pathname);

    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const res = await fetch(url, {
      cache: "no-store",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Blob chunk fetch failed with status ${res.status} for "${pathname}". Body: ${body.slice(0, 300)}`
      );
    }
    return (await res.json()) as ChunkBundle;
  })();

  bundleCache.set(key, promise);
  promise.catch(() => bundleCache.delete(key));
  return promise;
}

/**
 * Returns history for `symbol` from Blob storage if we have it there, or
 * `null` only for the one expected non-error case: the symbol's suffix
 * isn't mapped to a Blob segment (e.g. not ".NS"). Every other failure
 * (missing token, chunk not found, ticker not in its chunk) throws with a
 * specific message so the caller (lib/marketData.ts) can surface exactly
 * why Blob was skipped.
 */
export async function fetchHistoryFromBlob(
  symbol: string,
  start: string,
  end: string,
  interval: Interval
): Promise<HistoryRow[] | null> {
  const location = blobLocationForSymbol(symbol);
  if (!location) return null;

  const timeframe = TIMEFRAME_SLUG[interval];
  const chunkCount = CHUNK_PLAN[location.segment]?.[timeframe] ?? 1;
  const chunkIndex = chunkIndexFor(location.ticker, chunkCount);

  const bundle = await loadChunkBundle(location.segment, timeframe, chunkIndex);
  const tuples = bundle[location.ticker];
  if (!tuples) {
    throw new Error(
      `Ticker "${location.ticker}" not found in chunk ${chunkIndex} of ${location.segment}/${timeframe} (${Object.keys(bundle).length} tickers in that chunk).`
    );
  }

  const rows: HistoryRow[] = tuples.map(([date, open, high, low, close]) => ({
    date,
    open,
    high,
    low,
    close,
  }));

  return rows.filter((r) => r.date >= start && r.date <= end);
}

/**
 * Earliest date we have for `symbol` in Blob storage, or `null` if the
 * symbol isn't Blob-backed or has no rows. Tuples within a chunk are
 * uploaded pre-sorted ascending by date (see bulk-upload-consolidated.mjs),
 * so the first tuple is the earliest without needing to scan the array.
 */
export async function fetchFirstTradeDateFromBlob(symbol: string): Promise<string | null> {
  const location = blobLocationForSymbol(symbol);
  if (!location) return null;

  const timeframe = TIMEFRAME_SLUG["1d"];
  const chunkCount = CHUNK_PLAN[location.segment]?.[timeframe] ?? 1;
  const chunkIndex = chunkIndexFor(location.ticker, chunkCount);

  const bundle = await loadChunkBundle(location.segment, timeframe, chunkIndex);
  const tuples = bundle[location.ticker];
  return tuples && tuples.length > 0 ? tuples[0][0] : null;
}
