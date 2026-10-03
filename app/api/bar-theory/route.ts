import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/marketData";
import { SCREENER_UNIVERSE } from "@/lib/screenerUniverse";
import { OTHER_MARKETS } from "@/lib/otherMarkets";
import { type Day, type HistoryRowLike } from "@/lib/tzEngineWtf";
import { scanBarTheory } from "@/lib/barTheory";
import type { ScreenerRow } from "@/lib/dtfWtfScreener";
import { readBarTheoryCache, writeBarTheoryCache } from "@/lib/barTheoryCache";

// Same reasoning as /api/screener and /api/report: a full-segment scan
// (NSE Equity is ~2,600 stocks) can't complete inside a short serverless
// timeout, so this asks the platform for real headroom and lets the client
// scan in bounded, independently cacheable batches (see BATCH_SIZE in
// app/bar-theory/page.tsx).
export const maxDuration = 300;

const ENGINE_HISTORY_FLOOR = "1900-01-01";

const TIMEFRAMES = new Set(["daily", "weekly", "monthly", "yearly"]);

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

function toDays(rows: HistoryRowLike[]): Day[] {
  return rows
    .filter((r) => r.open !== null && r.high !== null && r.low !== null && r.close !== null)
    .map((r) => ({
      date: r.date,
      o: r.open as number,
      h: r.high as number,
      l: r.low as number,
      c: r.close as number,
    }));
}

// Groups daily/monthly candles into calendar-year candles -- same
// definition (and same reasoning: Yahoo has no native yearly interval) as
// app/api/report/route.ts's own resampleYearly.
function resampleYearly(days: Day[]): Day[] {
  const years = new Map<string, Day[]>();
  for (const d of days) {
    const key = d.date.slice(0, 4);
    const group = years.get(key);
    if (group) group.push(d);
    else years.set(key, [d]);
  }
  return Array.from(years.keys())
    .sort()
    .map((key) => {
      const group = years.get(key) as Day[];
      return {
        date: group[0].date,
        o: group[0].o,
        h: Math.max(...group.map((g) => g.h)),
        l: Math.min(...group.map((g) => g.l)),
        c: group[group.length - 1].c,
      };
    });
}

function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay();
  const backToMonday = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + backToMonday);
  return d.toISOString().slice(0, 10);
}

function resampleWeekly(days: Day[]): Day[] {
  const weeks = new Map<string, Day[]>();
  for (const d of days) {
    const key = mondayOf(d.date);
    const group = weeks.get(key);
    if (group) group.push(d);
    else weeks.set(key, [d]);
  }
  return Array.from(weeks.keys())
    .sort()
    .map((key) => {
      const group = weeks.get(key) as Day[];
      return {
        date: group[0].date,
        o: group[0].o,
        h: Math.max(...group.map((g) => g.h)),
        l: Math.min(...group.map((g) => g.l)),
        c: group[group.length - 1].c,
      };
    });
}

async function seriesForTimeframe(symbol: string, timeframe: string, end: string): Promise<Day[]> {
  if (timeframe === "daily") {
    const rows = await fetchHistory(symbol, ENGINE_HISTORY_FLOOR, end, "1d");
    return toDays(rows);
  }
  if (timeframe === "weekly") {
    const rows = await fetchHistory(symbol, ENGINE_HISTORY_FLOOR, end, "1d");
    return resampleWeekly(toDays(rows));
  }
  const rows = await fetchHistory(symbol, ENGINE_HISTORY_FLOOR, end, "1mo");
  const monthly = toDays(rows);
  return timeframe === "monthly" ? monthly : resampleYearly(monthly);
}

export async function GET(req: NextRequest) {
  const segment = req.nextUrl.searchParams.get("segment") || "";
  const timeframe = req.nextUrl.searchParams.get("timeframe") || "";

  const instruments = resolveSegmentInstruments(segment);
  if (!instruments) {
    return NextResponse.json({ error: "Missing or unrecognized segment" }, { status: 400 });
  }
  if (!TIMEFRAMES.has(timeframe)) {
    return NextResponse.json({ error: "Missing or unrecognized time frame" }, { status: 400 });
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

  const cached = await readBarTheoryCache(segment, timeframe, end, batchKey);
  if (cached) {
    return NextResponse.json({ ...cached, total, offset, limit, cached: true });
  }

  const bar: ScreenerRow[] = [];
  const barEntry: ScreenerRow[] = [];
  const errors: string[] = [];

  await mapWithConcurrency(batchInstruments, 24, async (entry) => {
    try {
      const days = await seriesForTimeframe(entry.symbol, timeframe, end);
      if (days.length < 2) return;
      const rows: HistoryRowLike[] = days.map((d) => ({
        date: d.date,
        open: d.o,
        high: d.h,
        low: d.l,
        close: d.c,
      }));
      const result = scanBarTheory(entry.symbol, entry.name, rows, timeframe === "weekly");
      if (result.bar) bar.push(result.bar);
      if (result.barEntry) barEntry.push(result.barEntry);
    } catch (err) {
      errors.push(`${entry.symbol}: ${err instanceof Error ? err.message : "scan failed"}`);
    }
  });

  // Latest on top, per the spec -- newest "Active as on" first.
  bar.sort((a, b) => b.activeAsOn.localeCompare(a.activeAsOn));
  barEntry.sort((a, b) => b.activeAsOn.localeCompare(a.activeAsOn));

  const payload = {
    scanned: batchInstruments.length,
    bar,
    barEntry,
    errors,
    cachedAt: new Date().toISOString(),
  };
  await writeBarTheoryCache(segment, timeframe, end, batchKey, payload);

  return NextResponse.json({ ...payload, total, offset, limit, cached: false });
}
