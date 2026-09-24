// Per-segment, per-day cache for /api/screener's scan result, stored in the
// same Blob store as the OHLC history data (lib/blobHistory.ts). Scanning a
// segment means fetching full history for every instrument in it and
// running the WTF/DTF engine twice per instrument -- expensive, and
// pointless to redo for every visitor on the same day, since the
// underlying data only changes once daily (scripts/refresh-daily.mjs,
// scheduled after market close) plus a weekly rollup for the WTF
// timeframe. The first scan of a segment on a given calendar date computes
// and caches the result; every later scan of that same segment that same
// day reads the cache instead of re-scanning.
//
// Keyed by calendar date (UTC, matching todayISO() in the API route) --
// not by a precise "data last refreshed" timestamp, since the refresh runs
// once a day and this only needs to avoid redoing the same work twice
// within that day, per the site's own daily-refresh cadence.

import { put } from "@vercel/blob";
import type { ScreenerRow } from "./dtfWtfScreener";

export interface ScreenerCachePayload {
  scanned: number;
  tzBuy: ScreenerRow[];
  tzBuyEntry: ScreenerRow[];
  errors: string[];
  cachedAt: string;
}

function blobUrlFor(pathname: string): string {
  const storeId = process.env.BLOB_STORE_ID;
  if (!storeId) throw new Error("BLOB_STORE_ID is not set in this environment.");
  const hostPrefix = storeId.replace(/^store_/, "").toLowerCase();
  return `https://${hostPrefix}.public.blob.vercel-storage.com/${pathname}`;
}

function cachePathFor(segment: string, dateISO: string): string {
  return `screener-cache/${segment}/${dateISO}.json`;
}

export async function readScreenerCache(
  segment: string,
  dateISO: string
): Promise<ScreenerCachePayload | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const res = await fetch(blobUrlFor(cachePathFor(segment, dateISO)), {
      cache: "no-store",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as ScreenerCachePayload;
  } catch {
    // Any failure here (network, missing store, malformed JSON) just means
    // "no usable cache" -- the caller falls back to a real scan.
    return null;
  }
}

export async function writeScreenerCache(
  segment: string,
  dateISO: string,
  payload: ScreenerCachePayload
): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  try {
    await put(cachePathFor(segment, dateISO), JSON.stringify(payload), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      token,
    });
  } catch {
    // Best-effort: a failed cache write shouldn't fail the scan request
    // that's already been computed and is about to be returned.
  }
}
