import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/marketData";
import { scanStock, ScreenerRow } from "@/lib/dtfWtfScreener";
import { SCREENER_UNIVERSE } from "@/lib/screenerUniverse";
import { OTHER_MARKETS } from "@/lib/otherMarkets";
import { readScreenerCache, writeScreenerCache } from "@/lib/screenerCache";

// Scanning a stock means one full-history fetch, run through two engine
// passes -- give it real headroom rather than the platform's short
// default. 300s is the ceiling this code asks for; Vercel's Hobby plan
// hard-caps functions at 60s regardless (Pro/Fluid Compute allow more).
//
// The NSE Equity universe (2,578 stocks) is too large to scan in a single
// invocation without risking that platform timeout -- doing so previously
// caused the whole request's connection to be killed mid-scan, which
// browsers surface as a raw "page couldn't load" network error rather
// than a clean HTTP error. `offset`/`limit` let the caller request a
// bounded slice of the segment instead of the whole thing; the Prime
// Trend page (app/entry-zone/page.tsx) now always scans in small batches
// client-side, so a segment small enough to fit in one batch (every
// segment except NSE Equity) behaves exactly as a single request always
// did, while NSE Equity is split into several bounded, independently
// cacheable requests.
export const maxDuration = 300;

// Same reasoning as the main page's ENGINE_HISTORY_FLOOR: request from far
// enough back that Yahoo returns everything it has, since both the WTF and
// DTF engines are stateful/sequential and need full history to be correct.
const ENGINE_HISTORY_FLOOR = "1900-01-01";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Resolves a segment key (from the client-safe lib/screenerSegments.ts
// list) to its actual instrument list. "nse-equity" is the only segment
// not covered by OTHER_MARKETS -- its full ~2,600-entry list lives in
// lib/screenerUniverse.ts and is intentionally never imported by any
// client component, only here.
function resolveSegmentInstruments(
  segment: string
): { symbol: string; name: string }[] | null {
  if (segment === "nse-equity") return SCREENER_UNIVERSE;
  const market = OTHER_MARKETS.find((m) => m.key === segment);
  return market ? market.instruments : null;
}

export async function GET(req: NextRequest) {
  const segment = req.nextUrl.searchParams.get("segment") || "";
  const instruments = resolveSegmentInstruments(segment);
  if (!instruments) {
    return NextResponse.json(
      { error: "Missing or unrecognized segment" },
      { status: 400 }
    );
  }

  const total = instruments.length;
  const offsetParam = req.nextUrl.searchParams.get("offset");
  const limitParam = req.nextUrl.searchParams.get("limit");
  const offset = offsetParam !== null ? Math.max(0, parseInt(offsetParam, 10) || 0) : 0;
  const limit = limitParam !== null ? Math.max(1, parseInt(limitParam, 10) || total) : total;
  const batchInstruments = instruments.slice(offset, offset + limit);
  const isFullSegment = offset === 0 && batchInstruments.length === total;
  const batchKey = isFullSegment ? "full" : `${offset}-${limit}`;

  const end = todayISO();

  // The underlying Blob data for this segment only changes once a day
  // (the scheduled refresh) -- so once someone has scanned this batch
  // today, everyone else gets that same result back instantly instead of
  // paying for a full re-scan.
  const cached = await readScreenerCache(segment, end, batchKey);
  if (cached) {
    return NextResponse.json({ ...cached, total, offset, limit, cached: true });
  }

  const tzBuy: ScreenerRow[] = [];
  const tzBuyEntry: ScreenerRow[] = [];
  const errors: string[] = [];

  await mapWithConcurrency(batchInstruments, 24, async (entry) => {
    try {
      const rows = await fetchHistory(entry.symbol, ENGINE_HISTORY_FLOOR, end, "1d");
      const result = scanStock(entry.symbol, entry.name, rows);
      if (result.tzBuy) tzBuy.push(result.tzBuy);
      if (result.tzBuyEntry) tzBuyEntry.push(result.tzBuyEntry);
    } catch (err) {
      errors.push(`${entry.symbol}: ${err instanceof Error ? err.message : "scan failed"}`);
    }
  });

  tzBuy.sort((a, b) => a.symbol.localeCompare(b.symbol));
  tzBuyEntry.sort((a, b) => a.symbol.localeCompare(b.symbol));

  const payload = {
    scanned: batchInstruments.length,
    tzBuy,
    tzBuyEntry,
    errors,
    cachedAt: new Date().toISOString(),
  };
  await writeScreenerCache(segment, end, batchKey, payload);

  return NextResponse.json({ ...payload, total, offset, limit, cached: false });
}
