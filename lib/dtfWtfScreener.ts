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
// Four tabs, each a currently-active snapshot from computePrimeTrendLive:
//   BAR: the main (DTF-TZ-BUY-anchored) ladder's own tier 1 (BAR) active
//     right now -- scrips that had a BAR form after TZ BUY, not yet
//     escalated to BAR ENTRY and not yet SL'd.
//   BAR ENTRY: that same ladder's tier 2 (BAR ENTRY, or REAR ENTRY / REAR
//     RE-ENTER one level up) active right now -- scrips that had BAR
//     ENTRY form after BAR.
//   PBAR: the WTF-BAR-triggered racing track's own tier 1 (PBAR) active
//     right now -- see lib/primeTrend.ts's PBAR section (Type 1 of the
//     "3 types of bar theory"): triggers when this ladder hasn't reached
//     BAR ENTRY yet by the time this instance's own WTF BAR forms.
//   PBAR ENTRY: that track's tier 2 (PBAR ENTRY) active right now.
//
// BAR/BAR ENTRY and PBAR/PBAR ENTRY are independent, parallel tracks (see
// lib/primeTrend.ts's "racing paths" design) -- a scrip can appear on
// BOTH a BAR-track tab and a PBAR-track tab at once, since neither
// cancels the other, and PBAR can stay live even after Stage 1 (DTF TZ
// BUY) itself has SL'd (it's anchored on the WTF side, not on DTF TZ
// BUY).
//
// A stock only appears in a list while that exact tier is CURRENTLY
// still active (per computePrimeTrendLive) -- once its own SL fires, or
// it escalates to the next tier, it drops off that tab (an escalated
// stock moves from BAR to BAR ENTRY, from PBAR to PBAR ENTRY).
//
// Activation Price is a ONE-TIME snapshot: that tier's own formation
// price (see PRIME_TREND_RULEBOOK.md -- a plain breakout High for
// BAR/PBAR, the ladder's own ref+0.20 entry price for BAR ENTRY/PBAR
// ENTRY), captured at the moment that tier most recently (re)formed,
// never re-read afterward.
//
// Highest High is PRIME TREND's own running max daily High since that
// stage's own (re)formation -- see PRIME_TREND_RULEBOOK.md's "Highest
// High" section -- NOT the old screener's WTF-weekly-High tracking.
//
// Stop Loss Price is that stage's own LIVE SL level (Stage.refLow in
// lib/primeTrend.ts) -- NOT a one-time snapshot like Activation Price. It
// ratchets down whenever a new, lower daily Low forms while the stage is
// still active, exactly the way the underlying engine's own SL shape
// check already works (see slShape() in lib/primeTrend.ts) -- this column
// just exposes that same live value rather than computing anything new.
//
// Lowest Low Post Entry is a separate, narrower stat: the lowest daily Low
// made STRICTLY AFTER the stage's own entry day and STRICTLY BEFORE today
// (both endpoints excluded) -- i.e. it deliberately leaves out the entry
// day's own low (already baked into Stop Loss Price's starting value) and
// today's own low (still live/incomplete). If the stage only entered
// yesterday or today, that window is empty and this is `null` (NA) until
// at least one full day has closed after entry.
//
// IMPORTANT: both of these are `number | null`, NOT `number` with NaN
// standing in for "not applicable" -- an earlier version used NaN, which
// crashed the Prime Trend page in production. `NextResponse.json()` runs
// `JSON.stringify` under the hood, and per the JSON spec NaN silently
// serializes to `null` -- so the client never actually received NaN, it
// received `null`, and `null.toFixed()` (fmt() in app/entry-zone/page.tsx
// assumed it was still checking for NaN) threw an uncaught TypeError right
// as the scan's results rendered. That's a legitimate, common case here
// (any stock that entered very recently has no completed day since entry
// yet), not an edge case -- across a 2,500+ stock scan it was reliably
// hit by the time the full result rendered, which is exactly why it
// looked like the scan itself was dying rather than one bad render.
//
// % Return = (Highest High - Activation Price) / Activation Price * 100.

import { computePrimeTrendLive, type OhlcRow } from "./primeTrend";
import type { Day, HistoryRowLike } from "./tzEngineWtf";
import { ANY, EPS, THRESH } from "./tzEngineWtf";

export interface ScreenerRow {
  symbol: string;
  name: string;
  activeAsOn: string;
  activationPrice: number;
  stopLoss: number | null;
  lowestLowPostEntry: number | null;
  highestHigh: number;
  percentReturn: number;
  currentClose: number;
}

/**
 * The lowest daily Low strictly after `entryDate` and strictly before the
 * most recent (last) day in `days` -- both endpoints excluded. Returns
 * `null` if `entryDate` isn't found or that window is empty (entry was
 * yesterday or today, so no full day has closed in between yet).
 */
export function lowestLowPostEntry(days: Day[], entryDate: string | null): number | null {
  if (entryDate === null) return null;
  const entryIdx = days.findIndex((d) => d.date === entryDate);
  if (entryIdx === -1) return null;

  const start = entryIdx + 1;
  const end = days.length - 2; // inclusive; excludes the last (current) day
  if (start > end) return null;

  let min = days[start].l;
  for (let i = start + 1; i <= end; i++) {
    if (days[i].l < min) min = days[i].l;
  }
  return min;
}

export function toDays(rows: HistoryRowLike[]): Day[] {
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

// Mon-Sun weeks: Open = week's first trading day's open, High = week's
// max, Low = week's min, Close = week's last trading day's close, labeled
// with the week's FIRST trading day's date.
//
// Bug fix (real-data, CORDSCABLE.NS): this used to label each week with
// its own LAST trading day's date instead. That's incompatible with how
// primeTrend.ts's containingWeekStart/liveRefAsof identify "the WTF week
// containing DTF day d" -- they look for the largest WTF date <= d, which
// only works if a week's label is <= every day inside it (i.e. its FIRST
// trading day). With last-day labeling, any day before that week's own
// label (Monday through Thursday of a still-unfinished week) wrongly fell
// back to the PREVIOUS week's label, making PRIME TREND's own live anchor
// a full extra week more stale than intended for 4 of every 5 trading
// days. Confirmed real trace: this fabricated a phantom DTF TZ BUY ENTRY
// activation (22/09/2026 @ 381.60) that doesn't exist under the correct,
// Monday-labeled WTF series (where Stage 2 never activates at all for
// that window).
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
        date: group[0].date,
        o: group[0].o,
        h: Math.max(...group.map((g) => g.h)),
        l: Math.min(...group.map((g) => g.l)),
        c: group[group.length - 1].c,
      };
    });
}

export interface ScanResult {
  bar: ScreenerRow | null;
  barEntry: ScreenerRow | null;
  pbar: ScreenerRow | null;
  pbarEntry: ScreenerRow | null;
}

export function toOhlcRow(d: Day): OhlcRow {
  return { date: d.date, o: d.o, h: d.h, l: d.l, c: d.c };
}

/**
 * Scan one stock's daily history for its current PRIME TREND BAR / BAR
 * ENTRY / PBAR / PBAR ENTRY state. `rows` must be ascending by date and
 * should cover the stock's full history (PRIME TREND's own WTF trace is
 * stateful/sequential and needs full history to be correct). The WTF
 * (weekly) side is derived from these same daily rows via resampleWeekly,
 * exactly as before.
 */
export function scanStock(symbol: string, name: string, rows: HistoryRowLike[]): ScanResult {
  const days = toDays(rows);
  if (days.length < 2) return { bar: null, barEntry: null, pbar: null, pbarEntry: null };

  const weekly = resampleWeekly(days);
  const wtfRows = weekly.map(toOhlcRow);
  const dtfRows = days.map(toOhlcRow);

  const currentClose = days[days.length - 1].c;
  const liveStatuses = computePrimeTrendLive(wtfRows, dtfRows);

  function buildRow(since: string | null, activationPrice: number | null, stopLoss: number | null, hh: number | null): ScreenerRow | null {
    if (since === null || activationPrice === null) return null;
    const highestHigh = hh ?? activationPrice;
    return {
      symbol,
      name,
      activeAsOn: since,
      activationPrice,
      stopLoss,
      lowestLowPostEntry: lowestLowPostEntry(days, since),
      highestHigh,
      percentReturn: ((highestHigh - activationPrice) / activationPrice) * 100,
      currentClose,
    };
  }

  // In practice at most one WTF TZ BUY 2 instance is ever open for a given
  // stock at once; if more than one somehow is (a rare multi-branch edge
  // case), the first one found governs each list.
  let bar: ScreenerRow | null = null;
  let barEntry: ScreenerRow | null = null;
  let pbar: ScreenerRow | null = null;
  let pbarEntry: ScreenerRow | null = null;
  for (const live of liveStatuses) {
    if (!bar && live.barActive) {
      bar = buildRow(live.barSince, live.barActivationPrice, live.barStopLoss, live.barHighestHigh);
    }
    if (!barEntry && live.stage2Active) {
      barEntry = buildRow(live.stage2Since, live.stage2ActivationPrice, live.stage2StopLoss, live.stage2HighestHigh);
    }
    if (!pbar && live.pbarTier1Active) {
      pbar = buildRow(live.pbarTier1Since, live.pbarTier1ActivationPrice, live.pbarTier1StopLoss, live.pbarTier1HighestHigh);
    }
    if (!pbarEntry && live.pbarActive) {
      pbarEntry = buildRow(live.pbarSince, live.pbarActivationPrice, live.pbarStopLoss, live.pbarHighestHigh);
    }
  }

  return { bar, barEntry, pbar, pbarEntry };
}

// Re-exported so callers (e.g. the /api/screener route) don't need a
// separate import from the engine module just for these.
export { ANY, EPS, THRESH };
