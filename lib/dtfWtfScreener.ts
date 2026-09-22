// DTF/WTF "Prime Trend" screener -- Option A only (WTF governed by its own
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
// Activation Price is a ONE-TIME snapshot, not a live value: DTF's own TZ
// BUY reference high (dtfBuy.refHigh), captured at the exact moment the
// relevant milestone (most recently) formed -- TZ BUY itself for the A-1
// list, TZ BUY 2 ("TZ BUY ENTRY") for the A-2 list -- and then frozen from
// then on. It is NOT re-read later even though buy.refHigh itself keeps
// climbing internally forever (see the "permanently suppressed from
// display" comment in evalBuy) -- reading it live at scan-end, as an
// earlier version of this file did, let a DTF position that happened to
// never hit its own SL for years just become "whatever the stock's
// current price is", which is meaningless as an "activation" reference.
// A-1 and A-2 can now show DIFFERENT numbers for the same stock, since
// they snapshot at different moments (TZ BUY 2 forms after TZ BUY, so its
// snapshot can be higher if buy.refHigh climbed in between).
//
// Highest High IS live, WTF-side: the running maximum of WTF's own weekly
// High price for as long as WTF currently has a governing TZ BUY 2 --
// climbing with every new higher weekly high -- but FREEZES the moment
// WTF hits its own RED2 or BAR SL2 (holding at whatever peak was reached
// up to and including that week), and only resumes live tracking once
// price later trades back ABOVE that frozen level -- at which point it
// keeps climbing again until the next RED2/BAR SL2. Resets (restarts from
// scratch) only if WTF's governing anchor disappears entirely and a
// later, different one takes over.
//
// % Return = (Highest High - Activation Price) / Activation Price * 100.

import { ANY, Buy, Day, EPS, HistoryRowLike, ParentCycle, THRESH, TZEngine } from "./tzEngineBar2Variant";

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
  const weeklySignals: { date: string; ref: number | null; weekHigh: number; resetEvent: boolean }[] = [];
  for (let i = 1; i < weekly.length; i++) {
    const weekEvents = wtf.process(weekly[i - 1], weekly[i]);
    const anchor = wtf.currentWtfAnchor();
    weeklySignals.push({
      date: weekly[i].date,
      ref: anchor !== null ? anchor.tzBuy2Ref : null,
      weekHigh: weekly[i].h,
      resetEvent: weekEvents.some((e) => e.startsWith("RED2(") || e.startsWith("BAR SL2(")),
    });
  }

  const dtfEngine = new TZEngine("topref");
  let dtfPc: ParentCycle | null = null;
  let dtfBuy: Buy | null = null;

  let currentWtfRef: number | null = null;
  let wSigIdx = 0;

  // The screener's "Highest High" column: the running max of WTF's own
  // weekly High price for as long as WTF currently has a governing TZ
  // BUY 2 -- (re)starts from that week's own high the moment a governing
  // anchor (re)appears -- but FREEZES the instant WTF hits its own RED2
  // or BAR SL2 (holding the peak reached up to and including that week),
  // resuming live tracking only once a later week's high trades back
  // above that frozen level.
  let wtfHighWatermark = 0;
  let wtfHighActive = false;
  let wtfHighFrozen = false;
  let wtfHighFrozenLevel = 0;

  let a1Since = "";
  let a2Since = "";
  // Activation Price: a ONE-TIME snapshot of dtfBuy.refHigh, taken at the
  // moment each milestone (most recently) formed -- NOT re-read later.
  let a1ActivationPrice = 0;
  let a2ActivationPrice = 0;

  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const cur = days[i];

    // Only use weeks that have already closed on or before today -- a week
    // still in progress hasn't produced its final WTF read yet.
    while (wSigIdx < weeklySignals.length && weeklySignals[wSigIdx].date <= cur.date) {
      const sig = weeklySignals[wSigIdx];
      currentWtfRef = sig.ref;
      if (sig.ref !== null) {
        if (!wtfHighActive) {
          wtfHighWatermark = sig.weekHigh;
          wtfHighActive = true;
          wtfHighFrozen = false;
        } else if (wtfHighFrozen) {
          if (sig.weekHigh > wtfHighFrozenLevel) {
            wtfHighFrozen = false;
            wtfHighWatermark = sig.weekHigh;
          }
          // else: stays frozen at wtfHighFrozenLevel (wtfHighWatermark unchanged)
        } else if (sig.weekHigh > wtfHighWatermark) {
          wtfHighWatermark = sig.weekHigh;
        }

        if (!wtfHighFrozen && sig.resetEvent) {
          wtfHighFrozenLevel = wtfHighWatermark;
          wtfHighFrozen = true;
        }
      } else {
        wtfHighActive = false;
        wtfHighFrozen = false;
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
        a1ActivationPrice = dtfBuy.refHigh;
      }
    } else {
      ev = dtfEngine.stepBuy(dtfPc as ParentCycle, dtfBuy, prev, cur);
      if (ev.some((e) => e.startsWith("TZ BUY("))) {
        a1Since = cur.date;
        a1ActivationPrice = dtfBuy.refHigh;
      }
    }

    if (dtfBuy !== null && ev.some((e) => e.startsWith("TZ BUY 2("))) {
      a2Since = cur.date;
      a2ActivationPrice = dtfBuy.refHigh;
    }
  }

  const currentClose = days[days.length - 1].c;
  const a1Active = dtfBuy !== null && dtfBuy.active;
  const a2Active = a1Active && dtfBuy!.tzBuy2 !== null && !dtfBuy!.tzBuy2.slActive;

  const a1PercentReturn =
    a1ActivationPrice > 0 ? ((wtfHighWatermark - a1ActivationPrice) / a1ActivationPrice) * 100 : 0;
  const a2PercentReturn =
    a2ActivationPrice > 0 ? ((wtfHighWatermark - a2ActivationPrice) / a2ActivationPrice) * 100 : 0;

  return {
    tzBuy: a1Active
      ? {
          symbol,
          name,
          activeAsOn: a1Since,
          activationPrice: a1ActivationPrice,
          highestHigh: wtfHighWatermark,
          percentReturn: a1PercentReturn,
          currentClose,
        }
      : null,
    tzBuyEntry: a2Active
      ? {
          symbol,
          name,
          activeAsOn: a2Since,
          activationPrice: a2ActivationPrice,
          highestHigh: wtfHighWatermark,
          percentReturn: a2PercentReturn,
          currentClose,
        }
      : null,
  };
}

// Re-exported so callers (e.g. the /api/screener route) don't need a
// separate import from the engine module just for these.
export { ANY, EPS, THRESH };
