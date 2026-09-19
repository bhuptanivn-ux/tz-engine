// Single entry point the app's API routes use to get OHLC history --
// tries Blob storage first (our own bulk-uploaded data, see
// lib/blobHistory.ts), falling back to a live Yahoo Finance fetch
// (lib/yahoo.ts) for any symbol/timeframe we don't have uploaded.
//
// Blob-first was chosen deliberately: it's faster (no live API round trip)
// and doesn't depend on Yahoo's undocumented, unofficial endpoints staying
// reachable -- important now that the screener scans the full NSE universe
// rather than just 50 stocks.

import { fetchHistory as fetchHistoryFromYahoo, type HistoryRow, type Interval } from "./yahoo";
import { fetchHistoryFromBlob } from "./blobHistory";

export type { HistoryRow, Interval };
export { searchSymbols, fetchFirstTradeDate } from "./yahoo";

export async function fetchHistory(
  symbol: string,
  start: string,
  end: string,
  interval: Interval = "1d"
): Promise<HistoryRow[]> {
  try {
    const blobRows = await fetchHistoryFromBlob(symbol, start, end, interval);
    if (blobRows && blobRows.length > 0) {
      return blobRows;
    }
  } catch {
    // Blob storage is best-effort here -- any failure (missing token,
    // network issue, malformed file) falls through to the Yahoo fetch
    // below rather than failing the request.
  }

  return fetchHistoryFromYahoo(symbol, start, end, interval);
}
