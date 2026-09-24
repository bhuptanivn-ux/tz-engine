import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/marketData";
import { scanStock, ScreenerRow } from "@/lib/dtfWtfScreener";
import { SCREENER_UNIVERSE } from "@/lib/screenerUniverse";
import { OTHER_MARKETS } from "@/lib/otherMarkets";
import { readScreenerCache, writeScreenerCache } from "@/lib/screenerCache";

// Scanning the whole universe means one full-history fetch per stock, run
// through two engine passes each -- give it real headroom rather than the
// platform's short default. The universe grew from 50 stocks to the full
// NSE list (2,578) now that fetchHistory checks Blob storage first (faster,
// no live-API round trip) -- but this is still untested at that scale in
// production. 300s is the ceiling this code asks for; Vercel's Hobby plan
// hard-caps functions at 60s regardless (Pro/Fluid Compute allow more). If
// this route times out or the plan doesn't allow the higher duration,
// options are: raise concurrency further, cache scan results and refresh
// on a schedule instead of per-request, or split the universe into
// multiple parallel requests from the client.
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

  const end = todayISO();

  // The underlying Blob data for this segment only changes once a day
  // (the scheduled refresh) -- so once someone has scanned it today,
  // everyone else gets that same result back instantly instead of paying
  // for a full re-scan.
  const cached = await readScreenerCache(segment, end);
  if (cached) {
    return NextResponse.json({ ...cached, cached: true });
  }

  const tzBuy: ScreenerRow[] = [];
  const tzBuyEntry: ScreenerRow[] = [];
  const errors: string[] = [];

  await mapWithConcurrency(instruments, 24, async (entry) => {
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
    scanned: instruments.length,
    tzBuy,
    tzBuyEntry,
    errors,
    cachedAt: new Date().toISOString(),
  };
  await writeScreenerCache(segment, end, payload);

  return NextResponse.json({ ...payload, cached: false });
}
