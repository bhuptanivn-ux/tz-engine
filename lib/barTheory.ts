// BAR Theory -- a live "is this stock currently trading with BAR / BAR
// ENTRY (BAR 2) right now" screener, built directly on tzEngineWtf.ts's own
// TZEngine (the same single-timeframe engine that powers the Trading Zone
// page), NOT the dual-timeframe PRIME TREND wrapper (lib/primeTrend.ts) --
// BAR/BAR 2 here run on whichever single timeframe the caller resampled
// `rows` to (Daily/Weekly/Monthly/Yearly), same as the Report page's other
// three events.
//
// Full chain, per the explicit spec this module implements:
//   TZ BUY 2 / REAR 2 / REAR RE-ENTER 2 -> RED 1 -> RED 2 -> BAR ("BAR") ->
//   BAR 2 ("BAR ENTRY") -> RED 1 -> RED 2 -> BAR -> BAR 2 -> ...
//
// TRADING WITH BAR: a stock whose newest BAR lineage has formed and hasn't
//   left via 1) its own BAR SL, or 2) BAR 2 forming on it (moves to BAR
//   ENTRY instead) -- UNLESS the same scrip goes on to trade with ANOTHER
//   BAR (a fresh BAR(...) formation, whether a genuinely new lineage or the
//   same lineage reactivating), in which case it never really left: the
//   engine's own object graph already reflects whichever BAR is CURRENTLY
//   live (see the `newest` lookup below), and Activation Price simply
//   shifts to that new BAR's own reference high.
//
// TRADING WITH BAR ENTRY (= BAR 2): a stock whose BAR 2 has formed and
//   hasn't left via 1) BAR 2 SL, or 2) RED 2.
//   - BAR 2 SL does NOT kill the underlying BAR lineage (lin.sl stays null
//     throughout BAR 2's own SL/recovery cycle -- see evalBar2 in
//     tzEngineWtf.ts). Per the explicit product rule, this means the stock
//     goes BACK to the TRADING WITH BAR list rather than disappearing,
//     with Activation Price shifting to the BAR lineage's own current
//     reference high (see the "own live reference" comment below -- it
//     keeps climbing even while BAR 2 was active; only the "BAR HH" EVENT
//     text is hidden from the trace once BAR 2 exists, not the underlying
//     value). BAR 2 itself can also self-recover (reform above its own SL
//     reference) without ever needing this fallback.
//   - RED 2, by contrast, is the SAME "clear the current tier, wait for a
//     genuinely fresh BAR to form" mechanism the chain uses right after
//     TZ BUY 2 too -- it does not hand the stock back to either list
//     immediately.
//
// Reading the engine's own live object graph (TZEngine.branches, public)
// after replaying the full history already gives BAR SL and a silent case
// the raw engine handles on its own but never names with an event (an
// older, un-SL'd lineage quietly discarded once a newer sibling's own BAR
// 2 forms -- see the `newestLin`/`surviving` collapse in tzEngineWtf.ts's
// evalBuy) for free, since a dead/discarded lineage is simply gone from
// buy.barLineages by the time the loop ends.
//
// RED 2 is the one rule the raw engine does NOT enforce for us: firing RED2
// for a branch does NOT clear that branch's own BAR 2 object internally
// (bar2 stays live in the engine's own model) UNLESS BAR 2 had never formed
// yet (in which case the engine already splices the whole lineage away as a
// dead end -- also free). So RED2-while-BAR-2-was-already-active is tracked
// separately below (`redKilled`) as a product-level rule layered on top of
// the engine's own state, exactly the way lib/primeTrend.ts's own
// buyCurrentlyLive layers extra rules on top of raw engine state. This
// changes nothing about tzEngineWtf.ts itself -- it only decides what this
// screener DISPLAYS on top of the engine's unmodified behavior.

import { TZEngine, branchLabel, type Day, type HistoryRowLike } from "./tzEngineWtf";
import type { ScreenerRow } from "./dtfWtfScreener";

export interface BarTheoryScan {
  bar: ScreenerRow | null;
  barEntry: ScreenerRow | null;
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

/** The lowest daily Low strictly after `entryDate` and strictly before the
 * most recent (last) day in `days` -- both endpoints excluded. Same
 * definition as lib/dtfWtfScreener.ts's own helper (duplicated locally,
 * matching this codebase's established pattern for this small function). */
function lowestLowPostEntry(days: Day[], entryDate: string | null): number | null {
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

/** Running max daily High from `fromDate` onward, INCLUDING that day --
 * the same fixed "Highest High" convention documented in
 * PRIME_TREND_RULEBOOK.md, computed as a true unconditional max over
 * `days` rather than reusing the raw engine's own ref_high ratchet (which
 * has its own threshold/suppression rules meant for triggering the NEXT
 * milestone, not for a display "highest price reached" stat -- see the
 * module comment above for the specific gap this creates). */
function highestHighSince(days: Day[], fromDate: string): number {
  let hh = -Infinity;
  for (const d of days) {
    if (d.date >= fromDate && d.h > hh) hh = d.h;
  }
  return hh;
}

// Per-label (e.g. "A.1") bookkeeping the raw engine objects don't carry
// themselves (BarLineage/Bar2 have no date fields).
interface LabelInfo {
  formedDate: string;
  activationPrice: number; // cur.h when BAR(label) most recently (re)formed
  bar2Date: string | null;
  bar2ActivationPrice: number | null; // cur.h when BAR 2(label) most recently (re)formed
  // The BAR lineage's own live reference high, and the date it was last
  // seen to increase -- tracked by directly reading `lin.refHigh` every
  // day (see the day-loop below), NOT via the "BAR HH(label)" event text,
  // because that event is deliberately hidden from the trace once BAR 2
  // has formed (evalBuy filters it out for display) even though the
  // engine still mutates lin.refHigh underneath on those same days. Only
  // reading the live object catches every real increase regardless of
  // that display-only suppression.
  lastRefHigh: number;
  lastRefHighDate: string;
}

export function scanBarTheory(
  symbol: string,
  name: string,
  rows: HistoryRowLike[],
  isWeekly: boolean = false
): BarTheoryScan {
  const days = toDays(rows);
  if (days.length < 2) return { bar: null, barEntry: null };

  const engine = new TZEngine(isWeekly);
  const labelInfo = new Map<string, LabelInfo>();
  const redKilled = new Set<string>();

  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const cur = days[i];

    // Pre-day snapshot: for each currently-live branch, its newest BAR
    // lineage's label and whether BAR 2 had already formed on it -- needed
    // to resolve a RED2(<letter>) event (emitted with the branch's letter,
    // not a lineage sub-label) back to the exact lineage it pertains to.
    // Only lineages with sl === null are eligible (RED1/RED2 attachment
    // only ever runs pre-SL -- see tzEngineWtf.ts's evalBarLineagesProgress).
    const preSnapshot = new Map<string, { label: string; hadBar2: boolean }>();
    for (const [pid, pc] of engine.branches) {
      if (pc.buy === null || pc.buy.barLineages.length === 0) continue;
      const newest = pc.buy.barLineages[pc.buy.barLineages.length - 1];
      if (newest.sl !== null) continue;
      preSnapshot.set(branchLabel(pid), { label: newest.label, hadBar2: newest.bar2 !== null });
    }

    const events = engine.process(prev, cur);

    for (const e of events) {
      if (e.startsWith("BAR(")) {
        const label = e.slice(4, -1);
        labelInfo.set(label, {
          formedDate: cur.date,
          activationPrice: cur.h,
          bar2Date: null,
          bar2ActivationPrice: null,
          lastRefHigh: cur.h,
          lastRefHighDate: cur.date,
        });
        redKilled.delete(label);
      } else if (e.startsWith("BAR 2(")) {
        const label = e.slice(6, -1);
        const info = labelInfo.get(label);
        if (info) {
          info.bar2Date = cur.date;
          info.bar2ActivationPrice = cur.h;
          redKilled.delete(label);
        }
      } else if (e.startsWith("RED2(")) {
        const letter = e.slice(5, -1);
        const snap = preSnapshot.get(letter);
        if (snap && snap.hadBar2) redKilled.add(snap.label);
      }
    }

    // Observe the newest lineage's own live reference high directly, every
    // day, regardless of whether today's "BAR HH" event was suppressed
    // from `events` above -- see the LabelInfo field comment.
    for (const [, pc] of engine.branches) {
      if (pc.buy === null || pc.buy.barLineages.length === 0) continue;
      const newest = pc.buy.barLineages[pc.buy.barLineages.length - 1];
      const info = labelInfo.get(newest.label);
      if (info && newest.refHigh > info.lastRefHigh) {
        info.lastRefHigh = newest.refHigh;
        info.lastRefHighDate = cur.date;
      }
    }
  }

  const currentClose = days[days.length - 1].c;

  let bar: ScreenerRow | null = null;
  let barEntry: ScreenerRow | null = null;

  for (const [, pc] of engine.branches) {
    if (pc.buy === null || pc.buy.barLineages.length === 0) continue;
    const newest = pc.buy.barLineages[pc.buy.barLineages.length - 1];
    if (newest.sl !== null) continue; // BAR SL -- gone from both lists

    const info = labelInfo.get(newest.label);
    if (!info) continue; // shouldn't happen, but don't fabricate a row if it does

    if (newest.bar2 === null) {
      // Plain BAR, BAR 2 never formed (or this is a fresh BAR that
      // superseded an earlier one -- either way `info` already reflects
      // whichever BAR is CURRENTLY live, since labelInfo is fully reset on
      // every "BAR(label)" event).
      if (!bar) {
        const hh = highestHighSince(days, info.formedDate);
        bar = {
          symbol,
          name,
          activeAsOn: info.formedDate,
          activationPrice: info.activationPrice,
          stopLoss: newest.refLow,
          lowestLowPostEntry: lowestLowPostEntry(days, info.formedDate),
          highestHigh: hh,
          percentReturn: ((hh - info.activationPrice) / info.activationPrice) * 100,
          currentClose,
        };
      }
    } else if (newest.bar2.slActive) {
      // BAR 2 SL -- falls BACK to the BAR list (the underlying lineage
      // never died), Activation Price shifting to the lineage's own
      // current reference high.
      if (!bar) {
        const hh = highestHighSince(days, info.lastRefHighDate);
        bar = {
          symbol,
          name,
          activeAsOn: info.lastRefHighDate,
          activationPrice: info.lastRefHigh,
          stopLoss: newest.refLow,
          lowestLowPostEntry: lowestLowPostEntry(days, info.lastRefHighDate),
          highestHigh: hh,
          percentReturn: ((hh - info.lastRefHigh) / info.lastRefHigh) * 100,
          currentClose,
        };
      }
    } else if (!redKilled.has(newest.label) && info.bar2Date !== null) {
      if (!barEntry) {
        const activationPrice = info.bar2ActivationPrice as number;
        const hh = highestHighSince(days, info.bar2Date);
        barEntry = {
          symbol,
          name,
          activeAsOn: info.bar2Date,
          activationPrice,
          stopLoss: newest.bar2.refLow,
          lowestLowPostEntry: lowestLowPostEntry(days, info.bar2Date),
          highestHigh: hh,
          percentReturn: ((hh - activationPrice) / activationPrice) * 100,
          currentClose,
        };
      }
    }
  }

  return { bar, barEntry };
}
