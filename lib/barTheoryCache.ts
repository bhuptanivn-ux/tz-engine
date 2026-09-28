// Per-segment/timeframe/day/batch cache for /api/bar-theory's scan result,
// stored in the same Blob store as the other screener caches
// (lib/screenerCache.ts, lib/reportCache.ts) and following the exact same
// reasoning -- scanning a segment means fetching full history for every
// instrument in it and replaying the WTF engine once per instrument,
// expensive and pointless to redo for every visitor asking about the same
// segment/timeframe combination on the same day.
//
// Unlike Report's cache, there's no "year" or "event" dimension here -- BAR
// Theory is a LIVE right-now screener (like Prime Trend's own tabs), always
// reporting current state as of the latest available data for whichever
// timeframe was picked.

import { put } from "@vercel/blob";
import type { ScreenerRow } from "./dtfWtfScreener";

export interface BarTheoryCachePayload {
  scanned: number;
  bar: ScreenerRow[];
  barEntry: ScreenerRow[];
  errors: string[];
  cachedAt: string;
}

function blobUrlFor(pathname: string): string {
  const storeId = process.env.BLOB_STORE_ID;
  if (!storeId) throw new Error("BLOB_STORE_ID is not set in this environment.");
  const hostPrefix = storeId.replace(/^store_/, "").toLowerCase();
  return `https://${hostPrefix}.public.blob.vercel-storage.com/${pathname}`;
}

// Bump whenever scanBarTheory's own computation changes in a way that would
// change a previously-cached result -- see screenerCache.ts's own
// CACHE_VERSION comment for the exact failure mode this guards against.
const CACHE_VERSION = "v1";

function cachePathFor(segment: string, timeframe: string, dateISO: string, batchKey: string): string {
  return `bar-theory-cache/${CACHE_VERSION}/${segment}/${timeframe}/${dateISO}/${batchKey}.json`;
}

export async function readBarTheoryCache(
  segment: string,
  timeframe: string,
  dateISO: string,
  batchKey: string
): Promise<BarTheoryCachePayload | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const res = await fetch(blobUrlFor(cachePathFor(segment, timeframe, dateISO, batchKey)), {
      cache: "no-store",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as BarTheoryCachePayload;
  } catch {
    return null;
  }
}

export async function writeBarTheoryCache(
  segment: string,
  timeframe: string,
  dateISO: string,
  batchKey: string,
  payload: BarTheoryCachePayload
): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  try {
    await put(cachePathFor(segment, timeframe, dateISO, batchKey), JSON.stringify(payload), {
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
