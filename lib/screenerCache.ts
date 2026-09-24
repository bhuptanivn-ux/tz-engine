// Per-segment, per-day, per-batch cache for /api/screener's scan result,
// stored in the same Blob store as the OHLC history data
// (lib/blobHistory.ts). Scanning a segment means fetching full history for
// every instrument in it and running the WTF/DTF engine twice per
// instrument -- expensive, and pointless to redo for every visitor on the
// same day, since the underlying data only changes once daily
// (scripts/refresh-daily.mjs, scheduled after market close) plus a weekly
// rollup for the WTF timeframe. The first scan of a given batch on a given
// calendar date computes and caches that batch's result; every later scan
// of that same batch that same day reads the cache instead of re-scanning.
//
// Keyed by calendar date (UTC, matching todayISO() in the API route) --
// not by a precise "data last refreshed" timestamp, since the refresh runs
// once a day and this only needs to avoid redoing the same work twice
// within that day, per the site's own daily-refresh cadence.
//
// `batchKey` distinguishes a full-segment scan ("full") from one bounded
// slice of a large segment (e.g. "0-150") -- see app/api/screener/route.ts
// and the client's batched scan in app/entry-zone/page.tsx. NSE Equity
// (~2,600 instruments) is too large to scan in one serverless invocation
// without risking a platform timeout, so the client requests it in small
// batches instead; each batch is cached independently so a same-day
// re-scan of the whole segment is still all cache hits.

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

function cachePathFor(segment: string, dateISO: string, batchKey: string): string {
  return `screener-cache/${segment}/${dateISO}/${batchKey}.json`;
}

export async function readScreenerCache(
  segment: string,
  dateISO: string,
  batchKey: string
): Promise<ScreenerCachePayload | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const res = await fetch(blobUrlFor(cachePathFor(segment, dateISO, batchKey)), {
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
  batchKey: string,
  payload: ScreenerCachePayload
): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  try {
    await put(cachePathFor(segment, dateISO, batchKey), JSON.stringify(payload), {
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
