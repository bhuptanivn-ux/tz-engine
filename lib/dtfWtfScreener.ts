// DTF/WTF "Entry Zone" screener -- Option A only (WTF governed by its own
// TZ BUY 2). Option B (WTF at plain BAR level) is explicitly deferred.
//
// SIMPLIFIED FIRST VERSION: this does NOT port the full WTFStateMachine
// pause/dormancy/race logic from tz_engine_dtf_wtf.py (that file is itself
// still unverified against real data). Instead it reuses the validated,
// already-shipped bar2-variant TZEngine twice:
//
//   1. WTF: the full engine (process()), run on WEEKLY-resampled candles,
//      to find whichever branch is CURRENTLY governed by a live TZ BUY 2
//      (buy.active && tzBuy2 !== null && !tzBuy2.slActive) and read its
//      reference high -- see TZEngine.currentWtfAnchor().
//   2. DTF: a freshly-seeded, synthetic single-branch TZEngine, run on
//      DAILY candles, ANCHORED directly off that WTF reference (rather
//      than via a normal TZ-GREEN breakout) -- see TZEngine.stepBuy() /
//      seedSyntheticBranch(). Once DTF's own TZ BUY originates, it is
//      driven purely by the normal, validated per-tier Buy logic
//      (RED1 / TZ BUY 2 / reactivation) from then on, same as any other
//      branch -- it does not keep re-checking WTF afterward.
//
// Dropdown A-1 "DTF TRADING WITH TZ BUY": DTF's own TZ BUY, originated
// above WTF's governing TZ BUY 2 reference high.
// Dropdown A-2 "DTF - TZ BUY ENTRY ABOVE TZ BUY": DTF's own TZ BUY 2
// (== "TZ BUY ENTRY"), formed above DTF's own TZ BUY reference.
//
// A stock only appears in a list while that tier is CURRENTLY still active
// (buy.active for A-1; buy.active && tzBuy2 live for A-2) -- once its own
// SL fires it drops off, per the "remove once it trades with SL" rule.
//
// "Highest High" is WTF-side, not DTF-side: the running peak of WTF's own
// BAR/BAR 2 family (falling back to WTF's TZ BUY 2 reference until a BAR
// has formed there), live-updating same as Activation Price -- right up
// until that lineage's own BAR SL2 fires, at which point it freezes at
// that pre-SL2 peak and stops tracking further WTF drift.

import { ANY, Buy, Day, EPS, HistoryRowLike, ParentCycle, THRESH, TZEngine } from "./tzEngineBar2Variant";

export interface ScreenerRow {
  symbol: string;
  name: string;
  activeAsOn: string;
  activationPrice: number;
  highestHigh: number;
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

/**
 * Scan one stock's daily history for its current DTF/WTF Option-A state.
 * `rows` must be ascending by date and should cover the stock's full
 * history (like the main engine, this is stateful/sequential).
 */
export function scanStock(symbol: string, name: string, rows: HistoryRowLike[]): ScanResult {
  const days = toDays(rows);
  if (days.length < 2) return { tzBuy: null, tzBuyEntry: null };

  const weekly = resampleWeekly(days);
  const wtf = new TZEngine("topref");
  const weeklySignals: {
    date: string;
    ref: number | null;
    barPeak: number | null;
    barSl2Fired: boolean;
  }[] = [];
  for (let i = 1; i < weekly.length; i++) {
    wtf.process(weekly[i - 1], weekly[i]);
    const anchor = wtf.currentWtfAnchor();
    weeklySignals.push({
      date: weekly[i].date,
      ref: anchor !== null ? anchor.tzBuy2Ref : null,
      barPeak: anchor !== null ? anchor.barPeak : null,
      barSl2Fired: anchor !== null && anchor.barSl2Fired,
    });
  }

  const dtfEngine = new TZEngine("topref");
  let dtfPc: ParentCycle | null = null;
  let dtfBuy: Buy | null = null;

  let currentWtfRef: number | null = null;
  let wSigIdx = 0;

  // The screener's "Highest High" column: WTF's own BAR/BAR 2 peak, live
  // until that lineage's BAR SL2 fires, then frozen at the pre-SL2 value
  // -- but NOT a one-way latch: currentWtfAnchor() only ever reports on
  // the CURRENT (newest) BAR lineage, so barSl2Fired goes back to false
  // (and tracking resumes live) the moment a fresh BAR lineage supersedes
  // an old, already-dead one. Without this, the first BAR SL2 a stock
  // EVER had -- even years earlier, on a long-superseded lineage -- would
  // freeze this value forever and produce a huge, stale gap against the
  // stock's real current price.
  let wtfHighWatermark = 0;
  let wtfHighFrozen = false;

  let a1Since = "";
  let a2Since = "";

  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const cur = days[i];

    // Only use weeks that have already closed on or before today -- a week
    // still in progress hasn't produced its final WTF read yet.
    while (wSigIdx < weeklySignals.length && weeklySignals[wSigIdx].date <= cur.date) {
      const sig = weeklySignals[wSigIdx];
      currentWtfRef = sig.ref;
      if (sig.barPeak !== null) {
        if (sig.barSl2Fired) {
          // Snapshot only on the transition INTO frozen (the pre-SL2
          // peak) -- once already frozen for this same lineage, hold that
          // value rather than following its post-SL2 "INVALID BAR HH"
          // drift (see currentWtfAnchor's own doc comment).
          if (!wtfHighFrozen) wtfHighWatermark = sig.barPeak;
          wtfHighFrozen = true;
        } else {
          // No SL2 on the current lineage -- either it's still live, or a
          // fresh lineage has superseded an old frozen one. Either way,
          // resume live tracking.
          wtfHighWatermark = sig.barPeak;
          wtfHighFrozen = false;
        }
      }
      wSigIdx += 1;
    }

    let ev: string[] = [];
    if (dtfBuy === null) {
      const ref = currentWtfRef;
      const originates =
        ref !== null &&
        cur.l >= prev.l &&
        cur.h > ref &&
        cur.h - ref >= THRESH - EPS &&
        cur.c >= ref;
      if (originates) {
        dtfPc = new ParentCycle(1, 1, cur.h, cur.l);
        dtfBuy = new Buy(cur.h, cur.l);
        dtfPc.buy = dtfBuy;
        dtfPc.redEver = true;
        dtfEngine.seedSyntheticBranch(dtfPc);
        a1Since = cur.date;
        ev = dtfEngine.stepBuy(dtfPc, dtfBuy, prev, cur);
      }
    } else {
      ev = dtfEngine.stepBuy(dtfPc as ParentCycle, dtfBuy, prev, cur);
      if (ev.some((e) => e.startsWith("TZ BUY("))) {
        a1Since = cur.date;
      }
    }

    if (dtfBuy !== null && ev.some((e) => e.startsWith("TZ BUY 2("))) {
      a2Since = cur.date;
    }
  }

  const currentClose = days[days.length - 1].c;
  const a1Active = dtfBuy !== null && dtfBuy.active;
  const a2Active = a1Active && dtfBuy!.tzBuy2 !== null && !dtfBuy!.tzBuy2.slActive;

  return {
    tzBuy: a1Active
      ? {
          symbol,
          name,
          activeAsOn: a1Since,
          activationPrice: dtfBuy!.refHigh,
          highestHigh: wtfHighWatermark,
          currentClose,
        }
      : null,
    tzBuyEntry: a2Active
      ? {
          symbol,
          name,
          activeAsOn: a2Since,
          activationPrice: dtfBuy!.tzBuy2!.refHigh,
          highestHigh: wtfHighWatermark,
          currentClose,
        }
      : null,
  };
}

// Re-exported so callers (e.g. the /api/screener route) don't need a
// separate import from the engine module just for these.
export { ANY, EPS, THRESH };
