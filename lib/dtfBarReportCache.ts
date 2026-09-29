// Per-segment/year/event/day/batch cache for /api/dtf-bar-report's scan
// result -- same reasoning and same Blob store as lib/reportCache.ts. No
// "timeframe" dimension: DTF BAR is defined ONLY for Daily Time Frame data
// (it's in the theory's own name -- see DTF_THEORIES_RULEBOOK.md), so
// there's nothing to select.

import { put } from "@vercel/blob";

export interface DtfBarReportMatch {
  symbol: string;
  name: string;
  date: string;
}

export interface DtfBarReportCachePayload {
  scanned: number;
  matches: DtfBarReportMatch[];
  errors: string[];
  cachedAt: string;
}

function blobUrlFor(pathname: string): string {
  const storeId = process.env.BLOB_STORE_ID;
  if (!storeId) throw new Error("BLOB_STORE_ID is not set in this environment.");
  const hostPrefix = storeId.replace(/^store_/, "").toLowerCase();
  return `https://${hostPrefix}.public.blob.vercel-storage.com/${pathname}`;
}

const CACHE_VERSION = "v1";

function cachePathFor(segment: string, year: string, event: string, dateISO: string, batchKey: string): string {
  return `dtf-bar-report-cache/${CACHE_VERSION}/${segment}/${year}/${event}/${dateISO}/${batchKey}.json`;
}

export async function readDtfBarReportCache(
  segment: string,
  year: string,
  event: string,
  dateISO: string,
  batchKey: string
): Promise<DtfBarReportCachePayload | null> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const res = await fetch(blobUrlFor(cachePathFor(segment, year, event, dateISO, batchKey)), {
      cache: "no-store",
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) return null;
    return (await res.json()) as DtfBarReportCachePayload;
  } catch {
    return null;
  }
}

export async function writeDtfBarReportCache(
  segment: string,
  year: string,
  event: string,
  dateISO: string,
  batchKey: string,
  payload: DtfBarReportCachePayload
): Promise<void> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return;
  try {
    await put(cachePathFor(segment, year, event, dateISO, batchKey), JSON.stringify(payload), {
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
