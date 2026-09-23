// PRIME TREND -- the DTF-with-respect-to-WTF cross-timeframe follow-up
// theory, built on top of TZ BUY (tzEngineWtf.ts). See
// PRIME_TREND_RULEBOOK.md for the full specification. This module does
// NOT modify or extend TZEngine -- it's a separate, dependent consumer: it
// runs TZEngine once over the WTF series to get the WTF event trace
// (alongside a snapshot of each branch's own TZ BUY 2 reference low before
// every candle -- needed to resolve the exact WTF-side exit price), then
// walks the DTF series on its own using that trace as an anchor.
//
// Direct, faithful port of prime_trend.py (Python dev branch
// claude/epic-darwin-pxs5s3), verified against real ADANIENT.NS and
// ICICIBANK.NS WTF+DTF data (see test_prime_trend_smoke.py in the Python
// source tree).

import { ANY, branchLabel, Day, EPS, THRESH, TZEngine } from "./tzEngineWtf";

export interface PrimeTrendResult {
  letter: string;
  wtfFormationDate: string;
  entryDate: string;
  entryPrice: number;
  exitType: string;
  exitDate: string;
  exitPrice: number | null;
  highestHigh: number | null;
  highestHighDate: string | null;
}

/** A live/right-now snapshot of one currently-open WTF TZ BUY 2 instance's
 * own Stage 1 / Stage 2 state -- for a screener asking "is this stock
 * sitting in a PRIME TREND zone right now", as opposed to
 * computePrimeTrend's own historical trade log (which only reports a
 * CLOSED or still-open Stage 2 entry, per the Filter rule in
 * PRIME_TREND_RULEBOOK.md -- a stock that's only reached Stage 1 never
 * appears there at all). Both stage1* and stage2* fields are null when
 * that stage isn't currently active; stage2Active implies stage1Active
 * (Stage 2 cannot outlive Stage 1's own SL -- see
 * PRIME_TREND_RULEBOOK.md's "Dependency on Stage 1"). */
export interface PrimeTrendLiveStatus {
  letter: string;
  stage1Active: boolean;
  stage1Since: string | null;
  stage1ActivationPrice: number | null;
  stage1HighestHigh: number | null;
  stage1HighestHighDate: string | null;
  stage2Active: boolean;
  stage2Since: string | null;
  stage2ActivationPrice: number | null;
  stage2HighestHigh: number | null;
  stage2HighestHighDate: string | null;
}

// --------------------------------------------------------------------
// Stage 1 / Stage 2 state (mirrors Buy/Bar2's own ref_high/ref_low shape)
// --------------------------------------------------------------------

class Stage {
  active = true;
  frozenRef: number | null = null;
  entryRatchet: number; // only meaningful on Stage 1; tracks Stage 2's escalation ladder
  constructor(public refHigh: number, public refLow: number) {
    this.entryRatchet = refHigh;
  }
}

function breakoutShape(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

function slShape(cur: Day, refLow: number): boolean {
  return cur.l < refLow && refLow - cur.l >= THRESH - EPS && cur.c <= refLow + EPS;
}

// --------------------------------------------------------------------
// Step 1: run TZEngine once over the WTF series, snapshotting every
// branch's own TZ BUY 2 ref_low BEFORE each candle is processed.
// --------------------------------------------------------------------

interface WtfTraceEntry {
  day: Day;
  events: string[];
  preRefLow: Map<number, number>;
  aliveAfter: Map<number, string>;
  hasTzBuy2After: Set<number>;
}

/** Branch LETTERS get recycled -- once a branch dies (whether via an
 * explicit SL or via collateral termination from the multi-branch
 * leadership rules, which emits no SL-type event at all), its id frees up
 * and a later, wholly unrelated branch can reuse the same letter. So every
 * snapshot here is keyed by pid (stable for one branch's whole life),
 * never by letter alone -- letter is only resolved from pid at the point
 * of use. */
function runWtfTrace(wtfDays: Day[]): WtfTraceEntry[] {
  const engine = new TZEngine();
  const trace: WtfTraceEntry[] = [];
  for (let i = 1; i < wtfDays.length; i++) {
    const prev = wtfDays[i - 1];
    const cur = wtfDays[i];
    const preRefLow = new Map<number, number>();
    for (const [pid, pc] of engine.branches) {
      if (pc.buy !== null && pc.buy.tzBuy2 !== null) {
        preRefLow.set(pid, pc.buy.tzBuy2.refLow);
      }
    }
    const events = engine.process(prev, cur);
    const aliveAfter = new Map<number, string>();
    const hasTzBuy2After = new Set<number>();
    for (const [pid, pc] of engine.branches) {
      aliveAfter.set(pid, branchLabel(pid));
      if (pc.buy !== null && pc.buy.tzBuy2 !== null) hasTzBuy2After.add(pid);
    }
    trace.push({ day: cur, events, preRefLow, aliveAfter, hasTzBuy2After });
  }
  return trace;
}

// --------------------------------------------------------------------
// Step 2: every WTF TZ BUY 2 instance and its own window (formation ->
// that instance's own failure), with the exact WTF-side exit price
// resolved. Tracked by pid, not by letter.
// --------------------------------------------------------------------

interface WtfInstance {
  letter: string;
  formationDate: string;
  endDate: string; // this instance's own failure date, or the last WTF date if it never fails
  endEvent: string | null; // null if it never fails (or fails with no explicit SL-type event) within the data
  endPrice: number | null; // BAR SL2 -> that week's close; TZ BUY 2 SL / TZ BUY SL -> TZ BUY 2's own ref_low
}

function wtfTzbuy2Instances(wtfTrace: WtfTraceEntry[]): WtfInstance[] {
  const instances: WtfInstance[] = [];
  const lastDate = wtfTrace.length > 0 ? wtfTrace[wtfTrace.length - 1].day.date : null;
  for (let i = 0; i < wtfTrace.length; i++) {
    const { day, events, aliveAfter } = wtfTrace[i];
    for (const e of events) {
      if (!e.startsWith("TZ BUY 2(")) continue;
      const letter = e.slice("TZ BUY 2(".length, -1);
      // Which pid does this formation belong to? Whichever pid holds this
      // exact letter right after this candle -- unambiguous.
      let pid: number | null = null;
      for (const [p, l] of aliveAfter) {
        if (l === letter) {
          pid = p;
          break;
        }
      }
      if (pid === null) continue; // shouldn't happen, but don't fabricate an instance if it does

      let endDate = lastDate as string;
      let endEvent: string | null = null;
      let endPrice: number | null = null;

      for (let j = i + 1; j < wtfTrace.length; j++) {
        const { day: day2, events: evs2, preRefLow: pre2, aliveAfter: alive2, hasTzBuy2After: has2 } = wtfTrace[j];
        let hit: string | null = null;
        for (const e2 of evs2) {
          if (e2 === `TZ BUY 2 SL(${letter})` || e2 === `TZ BUY SL(${letter})`) {
            hit = e2;
            endPrice = pre2.get(pid) ?? null;
            break;
          }
          if (e2.startsWith(`BAR SL2(${letter}.`)) {
            hit = e2;
            endPrice = day2.c;
            break;
          }
        }
        if (hit !== null) {
          endDate = day2.date;
          endEvent = hit;
          break;
        }
        // Ceiling: this specific pid's own tz_buy2 has genuinely ended
        // (wiped to None, or the whole branch died) with no explicit
        // SL-type event ever firing -- never search past this.
        if (!alive2.has(pid) || !has2.has(pid)) {
          endDate = day2.date;
          endEvent = "collaterally terminated (no explicit SL event)";
          break;
        }
      }
      instances.push({ letter, formationDate: day.date, endDate, endEvent, endPrice });
    }
  }
  return instances;
}

// --------------------------------------------------------------------
// Step 3: live (week-lagged) WTF reference lookup for a given letter/window
// --------------------------------------------------------------------

function wtfCheckpoints(wtfTrace: WtfTraceEntry[], letter: string, startDate: string, endDate: string): [string, number][] {
  const checkpoints: [string, number][] = [];
  for (const { day, events } of wtfTrace) {
    if (day.date < startDate || day.date > endDate) continue;
    for (const e of events) {
      if (e === `TZ BUY 2(${letter})` || e === `TZ BUY 2 HH(${letter})`) {
        checkpoints.push([day.date, day.h]);
      }
    }
  }
  return checkpoints;
}

/** Largest wtf_date <= d -- the WTF week that contains this DTF day. */
function containingWeekStart(wtfDates: string[], d: string): string | null {
  let start: string | null = null;
  for (const wd of wtfDates) {
    if (wd <= d) start = wd;
    else break;
  }
  return start;
}

/** The WTF reference high as it stood at the end of the most recently
 * FULLY COMPLETED WTF week strictly before the week containing `d` --
 * never the current, still-forming week's own value (look-ahead guard). */
function liveRefAsof(checkpoints: [string, number][], wtfDates: string[], d: string): number | null {
  const weekStart = containingWeekStart(wtfDates, d);
  if (weekStart === null) return null;
  let ref: number | null = null;
  for (const [cdate, cref] of checkpoints) {
    if (cdate < weekStart) ref = cref;
    else break;
  }
  return ref;
}

// --------------------------------------------------------------------
// Step 4: the Stage 1 / Stage 2 DTF simulation within one WTF instance's window
// --------------------------------------------------------------------

function simulateDtf(
  dtfDays: Day[],
  wtfTrace: WtfTraceEntry[],
  wtfDates: string[],
  inst: WtfInstance
): [PrimeTrendResult | null, PrimeTrendLiveStatus | null] {
  const checkpoints = wtfCheckpoints(wtfTrace, inst.letter, inst.formationDate, inst.endDate);

  let startIdx: number | null = null;
  for (let i = 0; i < dtfDays.length; i++) {
    if (dtfDays[i].date > inst.formationDate) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === null) return [null, null];

  let s1: Stage | null = null;
  let s2: Stage | null = null;
  let curEntry: [string, number] | null = null;
  let hh = 0;
  let hhDate: string | null = null;
  let final: PrimeTrendResult | null = null;

  // Stage 1's own "since it last (re)formed" tracking -- mirrors
  // curEntry/hh/hhDate one tier up, purely for PrimeTrendLiveStatus
  // (computePrimeTrend's own historical trade log has no use for this,
  // per the Filter rule: a Stage-1-only window is never a reported trade).
  let s1Since: string | null = null;
  let s1ActivationPrice: number | null = null;
  let hh1 = 0;
  let hh1Date: string | null = null;

  const closePair = (exitType: string, exitDate: string, exitPrice: number) => {
    if (curEntry !== null) {
      final = {
        letter: inst.letter,
        wtfFormationDate: inst.formationDate,
        entryDate: curEntry[0],
        entryPrice: curEntry[1],
        exitType,
        exitDate,
        exitPrice,
        highestHigh: hhDate ? hh : null,
        highestHighDate: hhDate,
      };
    }
    curEntry = null;
    hh = 0;
    hhDate = null;
  };

  let i = startIdx;
  while (i < dtfDays.length && dtfDays[i].date <= inst.endDate) {
    const prev = dtfDays[i - 1];
    const cur = dtfDays[i];

    if (curEntry !== null && cur.h > hh) {
      hh = cur.h;
      hhDate = cur.date;
    }
    if (s1 !== null && s1.active && cur.h > hh1) {
      hh1 = cur.h;
      hh1Date = cur.date;
    }

    // --- Stage 1: DTF TZ BUY ---
    if (s1 === null) {
      const live = liveRefAsof(checkpoints, wtfDates, cur.date);
      if (live !== null && breakoutShape(prev, cur, live)) {
        s1 = new Stage(cur.h, cur.l);
        s1Since = cur.date;
        s1ActivationPrice = cur.h;
        hh1 = 0;
        hh1Date = null;
      }
    } else if (s1.active) {
      if (slShape(cur, s1.refLow)) {
        s1.frozenRef = s1.refHigh;
        s1.active = false;
        if (s2 !== null) {
          closePair("DTF TZ BUY SL (wipes ENTRY)", cur.date, s1.refLow);
          s2 = null;
        }
      } else {
        if (cur.l < s1.refLow) s1.refLow = cur.l;
        if (cur.h > s1.refHigh && cur.h - s1.refHigh >= ANY) s1.refHigh = cur.h;
      }
    } else {
      const frozenRef = s1.frozenRef as number;
      if (breakoutShape(prev, cur, frozenRef)) {
        s1 = new Stage(cur.h, cur.l);
        s1Since = cur.date;
        s1ActivationPrice = cur.h;
        hh1 = 0;
        hh1Date = null;
      } else if (cur.h > frozenRef) {
        s1.frozenRef = cur.h;
      }
    }

    // --- Stage 2: DTF TZ BUY ENTRY (only while Stage 1 is active) ---
    if (s1 !== null && s1.active) {
      if (s2 === null) {
        const ref2 = s1.entryRatchet;
        if (breakoutShape(prev, cur, ref2)) {
          const entryPrice = ref2 + THRESH;
          s2 = new Stage(cur.h, cur.l);
          curEntry = [cur.date, entryPrice];
          hh = 0;
          hhDate = null;
        } else if (cur.h > ref2) {
          s1.entryRatchet = cur.h;
        }
      } else if (s2.active) {
        if (slShape(cur, s2.refLow)) {
          s2.frozenRef = s2.refHigh;
          s2.active = false;
          closePair("DTF TZ BUY ENTRY SL", cur.date, s2.refLow);
        } else {
          if (cur.l < s2.refLow) s2.refLow = cur.l;
          if (cur.h > s2.refHigh && cur.h - s2.refHigh >= ANY) s2.refHigh = cur.h;
        }
      } else {
        const frozenRef2 = s2.frozenRef as number;
        if (breakoutShape(prev, cur, frozenRef2)) {
          const entryPrice = frozenRef2 + THRESH;
          s2 = new Stage(cur.h, cur.l);
          curEntry = [cur.date, entryPrice];
          hh = 0;
          hhDate = null;
        } else if (cur.h > frozenRef2) {
          s2.frozenRef = cur.h;
        }
      }
    }
    i += 1;
  }

  if (curEntry !== null) {
    // Stage 2 was still open when the window ended -- the exit is
    // whatever ended this WTF instance (already resolved on inst).
    const exitType = inst.endEvent !== null ? inst.endEvent : "still open";
    const entry = curEntry as [string, number];
    final = {
      letter: inst.letter,
      wtfFormationDate: inst.formationDate,
      entryDate: entry[0],
      entryPrice: entry[1],
      exitType,
      exitDate: inst.endDate,
      exitPrice: inst.endPrice,
      highestHigh: hhDate ? hh : null,
      highestHighDate: hhDate,
    };
  }

  const stage1Active = s1 !== null && s1.active;
  const stage2Active = s2 !== null && s2.active;
  const live: PrimeTrendLiveStatus = {
    letter: inst.letter,
    stage1Active,
    stage1Since: stage1Active ? s1Since : null,
    stage1ActivationPrice: stage1Active ? s1ActivationPrice : null,
    stage1HighestHigh: stage1Active ? (hh1Date ? hh1 : null) : null,
    stage1HighestHighDate: stage1Active ? hh1Date : null,
    stage2Active,
    stage2Since: stage2Active && curEntry ? (curEntry as [string, number])[0] : null,
    stage2ActivationPrice: stage2Active && curEntry ? (curEntry as [string, number])[1] : null,
    stage2HighestHigh: stage2Active ? (hhDate ? hh : null) : null,
    stage2HighestHighDate: stage2Active ? hhDate : null,
  };

  return [final, live];
}

// --------------------------------------------------------------------
// Public entry point
// --------------------------------------------------------------------

export interface OhlcRow {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

function prepare(wtfRows: OhlcRow[], dtfRows: OhlcRow[]) {
  const wtfDays: Day[] = wtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const dtfDays: Day[] = dtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const wtfDates = wtfDays.map((d) => d.date);
  const wtfTrace = runWtfTrace(wtfDays);
  const instances = wtfTzbuy2Instances(wtfTrace);
  return { dtfDays, wtfTrace, wtfDates, instances };
}

/** Returns a list of PrimeTrendResult, one per WTF TZ BUY 2 instance that
 * produced a confirmed Stage 2 (DTF TZ BUY ENTRY) before its own failure.
 * Instances with no confirmed entry are silently excluded, per the PRIME
 * TREND filter rule (see PRIME_TREND_RULEBOOK.md). */
export function computePrimeTrend(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrendResult[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows);

  const results: PrimeTrendResult[] = [];
  for (const inst of instances) {
    const [res] = simulateDtf(dtfDays, wtfTrace, wtfDates, inst);
    if (res !== null) results.push(res);
  }
  return results;
}

/** Same inputs as computePrimeTrend, but answers a different question:
 * "is this stock sitting in a PRIME TREND zone RIGHT NOW" (for a live
 * screener), not "what trades has it produced historically".
 *
 * Returns one PrimeTrendLiveStatus per WTF TZ BUY 2 instance that is
 * STILL OPEN as of the last available WTF candle (i.e. hasn't failed at
 * its own SL / BAR SL2 within the supplied data) -- there is normally at
 * most one such instance for a given stock, but every currently-open one
 * is returned rather than assuming exactly one. Unlike computePrimeTrend,
 * a Stage-1-only window (never escalated to Stage 2) is NOT excluded here
 * -- a live screener needs to show "this stock just cleared its WTF
 * anchor" just as much as "this stock has a confirmed entry", since both
 * are actionable right now. An instance with neither stage currently
 * active (already failed on the DTF side but the WTF anchor itself
 * hasn't failed yet) is omitted. */
export function computePrimeTrendLive(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrendLiveStatus[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows);

  const liveStatuses: PrimeTrendLiveStatus[] = [];
  for (const inst of instances) {
    if (inst.endEvent !== null) continue; // this instance already failed on the WTF side -- not "right now"
    const [, live] = simulateDtf(dtfDays, wtfTrace, wtfDates, inst);
    if (live !== null && (live.stage1Active || live.stage2Active)) {
      liveStatuses.push(live);
    }
  }
  return liveStatuses;
}
