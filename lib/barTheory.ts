// BAR Theory -- a live "is this stock currently trading with BAR / BAR
// ENTRY (BAR 2) right now" screener, built directly on tzEngineWtf.ts's own
// TZEngine (the same single-timeframe engine that powers the Trading Zone
// page), NOT the dual-timeframe PRIME TREND wrapper (lib/primeTrend.ts) --
// BAR/BAR 2 here run on whichever single timeframe the caller resampled
// `rows` to (Daily/Weekly/Monthly/Yearly), same as the Report page's other
// three events.
//
// Membership rules (as specified, not documented anywhere else yet):
//   TRADING WITH BAR: a stock whose newest BAR lineage has formed (BAR(...))
//     and hasn't yet left via 1) BAR SL, or 2) BAR 2 forming on it (once BAR
//     2 forms it moves to the BAR ENTRY list instead, not both at once).
//   TRADING WITH BAR ENTRY (= BAR 2): a stock whose newest BAR lineage's own
//     BAR 2 has formed and hasn't yet left via 1) BAR 2 SL, or 2) RED 2.
//
// Reading the engine's own live object graph (TZEngine.branches, public)
// after replaying the full history already gives BAR SL, BAR 2 SL, and a
// silent case the raw engine handles on its own but never names with an
// event (an older, un-SL'd lineage quietly discarded once a newer sibling's
// own BAR 2 forms -- see the `newestLin`/`surviving` collapse in
// tzEngineWtf.ts's evalBuy) for free, since a dead/discarded lineage is
// simply gone from buy.barLineages by the time the loop ends.
//
// RED 2 is the one rule the raw engine does NOT enforce for us: firing RED2
// for a branch does NOT clear that branch's own BAR 2 object internally
// (bar2 stays live in the engine's own model) UNLESS BAR 2 had never formed
// yet (in which case the engine already splices the whole lineage away as a
// dead end -- also free). So RED2-while-BAR-2-was-already-active is tracked
// separately below (`redKilled`) as a product-level rule layered on top of
// the engine's own state, exactly the way lib/primeTrend.ts's own
// buyCurrentlyLive layers extra rules on top of raw engine state.

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

// Per-label (e.g. "A.1") bookkeeping the raw engine objects don't carry
// themselves (BarLineage/Bar2 have no date fields) -- when each tier most
// recently (re)formed, its own one-time Activation Price snapshot (the
// formation candle's own High, same convention as Stage 1/2's own
// activation price elsewhere), and each tier's own running Highest High
// (independent running max of daily High from that (re)formation day
// onward, INCLUDING that day -- the same fixed convention documented in
// PRIME_TREND_RULEBOOK.md's "Highest High" section, not the raw engine's
// own internal ref_high ratchet, which has its own suppression rules meant
// for a different purpose).
interface LabelInfo {
  formedDate: string;
  activationPrice: number;
  hh: number;
  bar2Date: string | null;
  bar2ActivationPrice: number | null;
  hhBar2: number;
}

export function scanBarTheory(symbol: string, name: string, rows: HistoryRowLike[]): BarTheoryScan {
  const days = toDays(rows);
  if (days.length < 2) return { bar: null, barEntry: null };

  const engine = new TZEngine();
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

    // Advance every already-known label's own running Highest High with
    // today's candle BEFORE handling today's formation events, so a label
    // reformed today (BAR(...) or BAR 2(...)) gets its own reset applied
    // afterward and isn't polluted by this step.
    for (const info of labelInfo.values()) {
      if (cur.h > info.hh) info.hh = cur.h;
      if (info.bar2Date !== null && cur.h > info.hhBar2) info.hhBar2 = cur.h;
    }

    const events = engine.process(prev, cur);

    for (const e of events) {
      if (e.startsWith("BAR(")) {
        const label = e.slice(4, -1);
        labelInfo.set(label, {
          formedDate: cur.date,
          activationPrice: cur.h,
          hh: cur.h,
          bar2Date: null,
          bar2ActivationPrice: null,
          hhBar2: 0,
        });
        redKilled.delete(label);
      } else if (e.startsWith("BAR 2(")) {
        const label = e.slice(6, -1);
        const info = labelInfo.get(label);
        if (info) {
          info.bar2Date = cur.date;
          info.bar2ActivationPrice = cur.h;
          info.hhBar2 = cur.h;
          redKilled.delete(label);
        }
      } else if (e.startsWith("RED2(")) {
        const letter = e.slice(5, -1);
        const snap = preSnapshot.get(letter);
        if (snap && snap.hadBar2) redKilled.add(snap.label);
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
      if (!bar) {
        bar = {
          symbol,
          name,
          activeAsOn: info.formedDate,
          activationPrice: info.activationPrice,
          stopLoss: newest.refLow,
          lowestLowPostEntry: lowestLowPostEntry(days, info.formedDate),
          highestHigh: info.hh,
          percentReturn: ((info.hh - info.activationPrice) / info.activationPrice) * 100,
          currentClose,
        };
      }
    } else if (!newest.bar2.slActive && !redKilled.has(newest.label) && info.bar2Date !== null) {
      if (!barEntry) {
        const activationPrice = info.bar2ActivationPrice as number;
        barEntry = {
          symbol,
          name,
          activeAsOn: info.bar2Date,
          activationPrice,
          stopLoss: newest.bar2.refLow,
          lowestLowPostEntry: lowestLowPostEntry(days, info.bar2Date),
          highestHigh: info.hhBar2,
          percentReturn: ((info.hhBar2 - activationPrice) / activationPrice) * 100,
          currentClose,
        };
      }
    }
  }

  return { bar, barEntry };
}
