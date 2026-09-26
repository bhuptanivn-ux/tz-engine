// Per-segment/year/event/timeframe/day/batch cache for /api/report's scan
// result, stored in the same Blob store as the screener cache
// (lib/screenerCache.ts) and following the exact same reasoning: scanning a
// segment means fetching full history for every instrument in it and
// running the WTF engine once per instrument -- expensive, and pointless to
// redo for every visitor asking about the same segment/year/event/timeframe
// combination on the same day, since the underlying data only changes once
// daily (scripts/refresh-daily.mjs).
//
// Keyed by calendar date (UTC) the same way the screener cache is -- see
// its own comment for why a precise "data last refreshed" timestamp isn't
// needed.

import { put } from "@vercel/blob";

export interface ReportMatch {
  symbol: string;
  name: string;
  date: string;
}

export interface ReportCachePayload {
  scanned: number;
  matches: ReportMatch[];
  errors: string[];
  cachedAt: string;
}

function blobUrlFor(pathname: string): string {
  const storeId = process.env.BLOB_STORE_ID;
  if (!storeId) throw new Error("BLOB_STORE_ID is not set in this environment.");
  const hostPrefix = storeId.replace(/^store_/, "").toLowerCase();
  return `https://${hostPrefix}.public.blob.vercel-storage.com/${pathname}`;
}

// Bump whenever the report scan's own computation changes in a way that
// would change a previously-cached result -- see screenerCache.ts's
// CACHE_VERSION comment for the exact failure mode this guards against.
const CACHE_VERSION = "v1";

function cachePathFor(
  segment: string,
  year: string,
  event: string,
  timeframe: string,
  dateISO: string,
  batchKey: string
): string {
  return `report-cache/${CACHE_VERSION}/${segment}/${year}/${event}/${timeframe}/${dateISO}/${batchKey}.json`;
}

export async function readReportCache(
  segment: string,
  year: string,
  event: string,
  timeframe: string,
  dateISO: string,
  batchKey: string
): Promise<ReportCachePayload | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const res = await fetch(blobUrlFor(cachePathFor(segment, year, event, timeframe, dateISO, batchKey)), {
      cache: "no-store",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as ReportCachePayload;
  } catch {
    return null;
  }
}

export async function writeReportCache(
  segment: string,
  year: string,
  event: string,
  timeframe: string,
  dateISO: string,
  batchKey: string,
  payload: ReportCachePayload
): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  try {
    await put(cachePathFor(segment, year, event, timeframe, dateISO, batchKey), JSON.stringify(payload), {
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
