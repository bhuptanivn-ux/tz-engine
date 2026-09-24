// DTF/WTF "PRIME TREND" screener -- Entry Zone's live "is this stock in a
// TZ BUY zone right now" scan.
//
// Redesigned to use the actual, verified PRIME TREND theory
// (PRIME_TREND_RULEBOOK.md / lib/primeTrend.ts) instead of an earlier,
// separate, hand-built approximation written before PRIME TREND existed.
// That approximation ran on the older lib/tzEngineBar2Variant.ts engine
// with its own simplified WTF-anchor/DTF-seeding logic; this version reuses
// lib/primeTrend.ts's own computePrimeTrendLive, so the numbers here are
// governed by the exact same rules -- and the exact same real-data
// verification -- as everything else PRIME TREND touches.
//
// Dropdown A-1 "DTF TRADING WITH TZ BUY": PRIME TREND's own Stage 1 (DTF TZ
// BUY), currently active.
// Dropdown A-2 "DTF - TZ BUY ENTRY ABOVE TZ BUY": PRIME TREND's own Stage 2
// (DTF TZ BUY ENTRY), currently active.
//
// A stock only appears in a list while that stage is CURRENTLY still
// active (per computePrimeTrendLive) -- once its own SL fires it drops
// off, same "remove once it trades with SL" rule as before.
//
// Activation Price is a ONE-TIME snapshot: PRIME TREND's own Stage 1/Stage
// 2 formation price (see PRIME_TREND_RULEBOOK.md -- Stage 1's own
// breakout High for A-1, Stage 2's own ladder+0.20 entry price for A-2),
// captured at the moment that stage most recently (re)formed, never
// re-read afterward.
//
// Highest High is PRIME TREND's own running max daily High since that
// stage's own (re)formation -- see PRIME_TREND_RULEBOOK.md's "Highest
// High" section -- NOT the old screener's WTF-weekly-High tracking.
//
// % Return = (Highest High - Activation Price) / Activation Price * 100.
//
// DIAGNOSTIC NOTE: Stop Loss Price / Lowest Low Post Entry columns (and
// their stage1StopLoss/stage2StopLoss fields on PrimeTrendLiveStatus in
// lib/primeTrend.ts) were pulled out here temporarily to test whether they
// were responsible for NSE Equity's full-universe scan consistently dying
// on its last batch. If a scan completes cleanly without them, that
// confirms it and they get reinstated with a fix; if it still fails
// identically, the cause is elsewhere and these come back as they were.

import { computePrimeTrendLive, type OhlcRow } from "./primeTrend";
import type { Day, HistoryRowLike } from "./tzEngineWtf";
import { ANY, EPS, THRESH } from "./tzEngineWtf";

export interface ScreenerRow {
  symbol: string;
  name: string;
  activeAsOn: string;
  activationPrice: number;
  highestHigh: number;
  percentReturn: number;
  currentClose: number;
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

// Mon-Sun weeks, matching the Python resample_weekly convention: Open =
// week's first trading day's open, High = week's max, Low = week's min,
// Close = week's last trading day's close, labeled with the week's LAST
// trading day's date (not the Monday).
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const backToMonday = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + backToMonday);
  return d.toISOString().slice(0, 10);
}

export function resampleWeekly(days: Day[]): Day[] {
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
        date: group[group.length - 1].date,
        o: group[0].o,
        h: Math.max(...group.map((g) => g.h)),
        l: Math.min(...group.map((g) => g.l)),
        c: group[group.length - 1].c,
      };
    });
}

export interface ScanResult {
  tzBuy: ScreenerRow | null;
  tzBuyEntry: ScreenerRow | null;
}

function toOhlcRow(d: Day): OhlcRow {
  return { date: d.date, o: d.o, h: d.h, l: d.l, c: d.c };
}

/**
 * Scan one stock's daily history for its current PRIME TREND Stage 1 /
 * Stage 2 state. `rows` must be ascending by date and should cover the
 * stock's full history (PRIME TREND's own WTF trace is stateful/
 * sequential and needs full history to be correct). The WTF (weekly) side
 * is derived from these same daily rows via resampleWeekly, exactly as
 * before.
 */
export function scanStock(symbol: string, name: string, rows: HistoryRowLike[]): ScanResult {
  const days = toDays(rows);
  if (days.length < 2) return { tzBuy: null, tzBuyEntry: null };

  const weekly = resampleWeekly(days);
  const wtfRows = weekly.map(toOhlcRow);
  const dtfRows = days.map(toOhlcRow);

  const currentClose = days[days.length - 1].c;
  const liveStatuses = computePrimeTrendLive(wtfRows, dtfRows);

  // In practice at most one WTF TZ BUY 2 instance is ever open for a given
  // stock at once; if more than one somehow is (a rare multi-branch edge
  // case), the first one found governs each list.
  let tzBuy: ScreenerRow | null = null;
  let tzBuyEntry: ScreenerRow | null = null;
  for (const live of liveStatuses) {
    if (!tzBuy && live.stage1Active && live.stage1Since !== null && live.stage1ActivationPrice !== null) {
      const highestHigh = live.stage1HighestHigh ?? live.stage1ActivationPrice;
      tzBuy = {
        symbol,
        name,
        activeAsOn: live.stage1Since,
        activationPrice: live.stage1ActivationPrice,
        highestHigh,
        percentReturn: ((highestHigh - live.stage1ActivationPrice) / live.stage1ActivationPrice) * 100,
        currentClose,
      };
    }
    if (!tzBuyEntry && live.stage2Active && live.stage2Since !== null && live.stage2ActivationPrice !== null) {
      const highestHigh = live.stage2HighestHigh ?? live.stage2ActivationPrice;
      tzBuyEntry = {
        symbol,
        name,
        activeAsOn: live.stage2Since,
        activationPrice: live.stage2ActivationPrice,
        highestHigh,
        percentReturn: ((highestHigh - live.stage2ActivationPrice) / live.stage2ActivationPrice) * 100,
        currentClose,
      };
    }
  }

  return { tzBuy, tzBuyEntry };
}

// Re-exported so callers (e.g. the /api/screener route) don't need a
// separate import from the engine module just for these.
export { ANY, EPS, THRESH };
