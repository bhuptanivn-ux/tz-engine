import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/marketData";
import { ScreenerRow } from "@/lib/dtfWtfScreener";
import { scanStock11 } from "@/lib/dtfWtfScreener11";
import { SCREENER_UNIVERSE } from "@/lib/screenerUniverse";
import { OTHER_MARKETS } from "@/lib/otherMarkets";
import { readScreenerCache, writeScreenerCache } from "@/lib/screenerCache";

// Experimental "PRIME TREND 1.1" scan (adds a third DTF stage, TZ BUY 3 --
// see lib/primeTrend11.ts and lib/dtfWtfScreener11.ts). Mirrors
// app/api/screener/route.ts exactly; the only difference is which scan
// function runs and a distinct cache namespace ("11-<segment>") so this
// never reads or overwrites the shipped screener's own cached results.
export const maxDuration = 300;

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
  const cacheSegment = `11-${segment}`;

  const end = todayISO();

  const cached = await readScreenerCache(cacheSegment, end, batchKey);
  if (cached) {
    return NextResponse.json({ ...cached, total, offset, limit, cached: true });
  }

  const tzBuy: ScreenerRow[] = [];
  const tzBuyEntry: ScreenerRow[] = [];
  const errors: string[] = [];

  await mapWithConcurrency(batchInstruments, 24, async (entry) => {
    try {
      const rows = await fetchHistory(entry.symbol, ENGINE_HISTORY_FLOOR, end, "1d");
      const result = scanStock11(entry.symbol, entry.name, rows);
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
  await writeScreenerCache(cacheSegment, end, batchKey, payload);

  return NextResponse.json({ ...payload, total, offset, limit, cached: false });
}
