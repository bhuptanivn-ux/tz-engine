// Single entry point the app's API routes use to get OHLC history --
// tries Blob storage first (our own bulk-uploaded data, see
// lib/blobHistory.ts), falling back to a live Yahoo Finance fetch
// (lib/yahoo.ts) for any symbol/timeframe we don't have uploaded.
//
// Blob-first was chosen deliberately: it's faster (no live API round trip)
// and doesn't depend on Yahoo's undocumented, unofficial endpoints staying
// reachable -- important now that the screener scans the full NSE universe
// rather than just 50 stocks.

import {
  fetchHistory as fetchHistoryFromYahoo,
  fetchFirstTradeDate as fetchFirstTradeDateFromYahoo,
  type HistoryRow,
  type Interval,
} from "./yahoo";
import { fetchHistoryFromBlob, fetchFirstTradeDateFromBlob } from "./blobHistory";

export type { HistoryRow, Interval };
export { searchSymbols } from "./yahoo";

/**
 * Blob-first, same reasoning as fetchHistoryWithSource below. Required for
 * the non-NSE segments (Commodities, Crypto, Forex, indices, SME) in
 * lib/otherMarkets.ts, whose pseudo-suffixed symbols (e.g. "GOLD.COMM")
 * aren't real Yahoo tickers and would otherwise always 502 from Yahoo.
 */
export async function fetchFirstTradeDate(symbol: string): Promise<string | null> {
  try {
    const blobDate = await fetchFirstTradeDateFromBlob(symbol);
    if (blobDate) return blobDate;
  } catch {
    // Fall through to Yahoo.
  }
  return fetchFirstTradeDateFromYahoo(symbol);
}

export type HistorySource = "blob" | "yahoo";

export interface HistoryResult {
  rows: HistoryRow[];
  source: HistorySource;
  blobError?: string;
}

/**
 * Same as fetchHistory, but also reports which source actually served the
 * data (and why Blob was skipped, if it was) -- surfaced by /api/history
 * as a `source`/`blobDebug` field so this is checkable by just visiting
 * the API URL in a browser, without needing server log access.
 */
export async function fetchHistoryWithSource(
  symbol: string,
  start: string,
  end: string,
  interval: Interval = "1d"
): Promise<HistoryResult> {
  let blobError: string | undefined;
  try {
    const blobRows = await fetchHistoryFromBlob(symbol, start, end, interval);
    if (blobRows && blobRows.length > 0) {
      return { rows: blobRows, source: "blob" };
    }
    blobError = "No data returned from Blob storage for this symbol/timeframe.";
  } catch (err) {
    blobError = err instanceof Error ? err.message : "Blob lookup failed.";
  }

  const rows = await fetchHistoryFromYahoo(symbol, start, end, interval);
  return { rows, source: "yahoo", blobError };
}

export async function fetchHistory(
  symbol: string,
  start: string,
  end: string,
  interval: Interval = "1d"
): Promise<HistoryRow[]> {
  const result = await fetchHistoryWithSource(symbol, start, end, interval);
  return result.rows;
}
