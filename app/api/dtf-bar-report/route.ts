import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/marketData";
import { SCREENER_UNIVERSE } from "@/lib/screenerUniverse";
import { OTHER_MARKETS } from "@/lib/otherMarkets";
import { computeDtfBarEvents } from "@/lib/dtfBar";
import {
  readDtfBarReportCache,
  writeDtfBarReportCache,
  type DtfBarReportMatch,
} from "@/lib/dtfBarReportCache";

// Same reasoning as /api/report: a full-segment scan (NSE Equity is
// ~2,600 stocks) can't complete inside a short serverless timeout, so this
// asks the platform for real headroom and lets the client scan in bounded,
// independently cacheable batches (see BATCH_SIZE in
// app/dtf-bar-report/page.tsx).
export const maxDuration = 300;

const ENGINE_HISTORY_FLOOR = "1900-01-01";

// DTF BAR's own milestone-type events (lib/dtfBar.ts) -- HH/LL/SL noise
// left out, matching the original Report page's own event set (TZ BUY 2 /
// BAR / BAR 2, not TZ BUY 2 HH etc). "TZ GREEN" and the mandatory RED1/RED2
// gate are also left out as too frequent/noisy to be useful report filters,
// same reasoning the original Report page used for skipping plain "TZ BUY"/
// "RED". BAR1/BAR2 carry a parenthetical generation label ("BAR1(1)"); the
// other three don't (DTF BAR is single-lineage, no branch letters).
const EVENT_MATCHERS: Record<string, (e: string) => boolean> = {
  "TZ BUY": (e) => e === "TZ BUY",
  BAR1: (e) => e.startsWith("BAR1("),
  BAR2: (e) => e.startsWith("BAR2("),
  REAR: (e) => e === "REAR",
  "REAR RE-ENTER": (e) => e === "REAR RE-ENTER",
};

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
  const year = req.nextUrl.searchParams.get("year") || "";
  const event = req.nextUrl.searchParams.get("event") || "";

  const instruments = resolveSegmentInstruments(segment);
  if (!instruments) {
    return NextResponse.json({ error: "Missing or unrecognized segment" }, { status: 400 });
  }
  const matcher = EVENT_MATCHERS[event];
  if (!matcher) {
    return NextResponse.json({ error: "Missing or unrecognized event" }, { status: 400 });
  }
  if (!/^\d{4}$/.test(year)) {
    return NextResponse.json({ error: "Missing or invalid year" }, { status: 400 });
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

  const cached = await readDtfBarReportCache(segment, year, event, end, batchKey);
  if (cached) {
    return NextResponse.json({ ...cached, total, offset, limit, cached: true });
  }

  const matches: DtfBarReportMatch[] = [];
  const errors: string[] = [];

  await mapWithConcurrency(batchInstruments, 24, async (entry) => {
    try {
      // DTF BAR is defined only for Daily Time Frame data -- always daily,
      // no timeframe selector (see the theory's own name / DTF_THEORIES_
      // RULEBOOK.md).
      const rows = await fetchHistory(entry.symbol, ENGINE_HISTORY_FLOOR, end, "1d");
      const eventsByDate = computeDtfBarEvents(rows);
      for (const [date, eventsStr] of eventsByDate) {
        if (!date.startsWith(year)) continue;
        const fired = eventsStr.split(", ").some((e) => matcher(e));
        if (fired) matches.push({ symbol: entry.symbol, name: entry.name, date });
      }
    } catch (err) {
      errors.push(`${entry.symbol}: ${err instanceof Error ? err.message : "scan failed"}`);
    }
  });

  matches.sort((a, b) => a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol));

  const payload = {
    scanned: batchInstruments.length,
    matches,
    errors,
    cachedAt: new Date().toISOString(),
  };
  await writeDtfBarReportCache(segment, year, event, end, batchKey, payload);

  return NextResponse.json({ ...payload, total, offset, limit, cached: false });
}
