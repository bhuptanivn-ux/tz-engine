import { NextResponse } from "next/server";
import { fetchHistory } from "@/lib/yahoo";
import { scanStock, ScreenerRow } from "@/lib/dtfWtfScreener";
import { SCREENER_UNIVERSE } from "@/lib/screenerUniverse";

// Scanning the whole universe means one full-history fetch per stock, run
// through two engine passes each -- give it real headroom rather than the
// platform's short default.
export const maxDuration = 60;

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

export async function GET() {
  const end = todayISO();
  const tzBuy: ScreenerRow[] = [];
  const tzBuyEntry: ScreenerRow[] = [];
  const errors: string[] = [];

  await mapWithConcurrency(SCREENER_UNIVERSE, 8, async (entry) => {
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

  return NextResponse.json({
    scanned: SCREENER_UNIVERSE.length,
    tzBuy,
    tzBuyEntry,
    errors,
  });
}
