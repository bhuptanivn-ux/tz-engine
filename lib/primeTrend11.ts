// PRIME TREND 1.1 -- an experimental DTF-only variant of PRIME TREND
// (lib/primeTrend.ts), NOT part of the shipped theory. Adds a THIRD DTF
// stage, TZ BUY 3, escalating above DTF TZ BUY ENTRY (Stage 2) the exact
// same way Stage 2 escalates above DTF TZ BUY (Stage 1) -- same ratchet
// ladder, same breakout shape, same SL/reactivation/entry-price rules,
// nothing new invented. See PRIME_TREND_RULEBOOK.md for Stage 1/Stage 2's
// own specification; this file changes nothing about it.
//
// Reuses lib/primeTrend.ts's own WTF-trace/instance machinery (`prepare`,
// `wtfCheckpoints`, `containingWeekStart`) and Stage 1/2 primitives
// (`Stage`, `breakoutShape`, `slShape`) verbatim -- does NOT modify or
// duplicate that logic, and does NOT change computePrimeTrend or
// computePrimeTrendLive's own behavior in any way.
//
// Live-status only (mirrors computePrimeTrendLive, not computePrimeTrend's
// historical trade log) -- this variant only backs a live screener page,
// same as lib/dtfWtfScreener.ts does for the shipped theory.
//
// Once TZ BUY 3 is in play, the reporting shift (per explicit instruction)
// is: "DTF trading with TZ BUY" now means Stage 2 (DTF TZ BUY ENTRY)
// active, and "DTF TZ BUY ENTRY" now means Stage 3 (TZ BUY 3) active --
// Stage 1 alone is no longer surfaced in either. See
// lib/dtfWtfScreener11.ts for where that relabeling actually happens;
// this file just exposes stage1/stage2/stage3 status, unlabeled.

import { ANY, Day, THRESH } from "./tzEngineWtf";
import {
  breakoutShape,
  containingWeekStart,
  DTF_SL_EXIT_TYPES,
  OhlcRow,
  PrimeTrendFamily,
  prepare,
  Stage,
  slShape,
  WtfInstance,
  WtfTraceEntry,
  wtfCheckpoints,
  wtfSlLabel,
} from "./primeTrend";

/** One closed (or still-open) Stage 3 (TZ BUY 3) entry/exit cycle -- same
 * shape as PrimeTrendResult, one tier up. See computePrimeTrend11. */
export interface PrimeTrendResult11 {
  family: PrimeTrendFamily;
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

const DTF_SL_EXIT_TYPES_11 = new Set([
  "TZ BUY 3 SL",
  "DTF TZ BUY ENTRY SL (wipes TZ BUY 3)",
  "DTF TZ BUY SL (wipes ENTRY AND TZ BUY 3)",
]);

export interface PrimeTrendLiveStatus11 {
  family: PrimeTrendFamily;
  letter: string;
  stage1Active: boolean;
  stage1Since: string | null;
  stage1ActivationPrice: number | null;
  stage1StopLoss: number | null;
  stage1HighestHigh: number | null;
  stage1HighestHighDate: string | null;
  stage2Active: boolean;
  stage2Since: string | null;
  stage2ActivationPrice: number | null;
  stage2StopLoss: number | null;
  stage2HighestHigh: number | null;
  stage2HighestHighDate: string | null;
  stage3Active: boolean;
  stage3Since: string | null;
  stage3ActivationPrice: number | null;
  stage3StopLoss: number | null;
  stage3HighestHigh: number | null;
  stage3HighestHighDate: string | null;
}

function simulateDtfAll11(
  dtfDays: Day[],
  wtfTrace: WtfTraceEntry[],
  wtfDates: string[],
  inst: WtfInstance
): [PrimeTrendResult11[], PrimeTrendLiveStatus11 | null] {
  const checkpoints = wtfCheckpoints(wtfTrace, inst.family, inst.letter, inst.formationDate, inst.endDate);

  let startIdx: number | null = null;
  for (let i = 0; i < dtfDays.length; i++) {
    if (dtfDays[i].date > inst.formationDate) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === null) return [[], null];

  let s1: Stage | null = null;
  let s2: Stage | null = null;
  let s3: Stage | null = null;

  let s1Since: string | null = null;
  let s1ActivationPrice: number | null = null;
  let hh1 = 0;
  let hh1Date: string | null = null;

  let s2Since: string | null = null;
  let s2ActivationPrice: number | null = null;
  let hh2 = 0;
  let hh2Date: string | null = null;

  // Stage 3's own entry/exit cycle bookkeeping -- mirrors curEntry/hh/
  // hhDate in lib/primeTrend.ts's simulateDtfAll, one tier up. Every
  // closed cycle becomes its own permanent row (see closePair3 below), not
  // just the last one.
  let curEntry3: [string, number] | null = null;
  let hh3 = 0;
  let hh3Date: string | null = null;
  const rows: PrimeTrendResult11[] = [];

  const closePair3 = (exitType: string, exitDate: string, exitPrice: number) => {
    if (curEntry3 !== null) {
      rows.push({
        family: inst.family,
        letter: inst.letter,
        wtfFormationDate: inst.formationDate,
        entryDate: curEntry3[0],
        entryPrice: curEntry3[1],
        exitType,
        exitDate,
        exitPrice,
        highestHigh: hh3Date ? hh3 : null,
        highestHighDate: hh3Date,
      });
    }
    curEntry3 = null;
    hh3 = 0;
    hh3Date = null;
  };

  // Same live-anchor seeding as Stage 1 in lib/primeTrend.ts -- the anchor
  // Stage 1 breaks out against, before it first forms, seeded from the WTF
  // instance's own formation-week High and climbing quietly on any later
  // day's own High once the formation week is over.
  let preS1Ref: number | null = checkpoints.length > 0 ? checkpoints[0][1] : null;

  let i = startIdx;
  while (i < dtfDays.length && dtfDays[i].date <= inst.endDate) {
    const prev = dtfDays[i - 1];
    const cur = dtfDays[i];

    if (s1 !== null && s1.active && cur.h > hh1) {
      hh1 = cur.h;
      hh1Date = cur.date;
    }
    if (s2 !== null && s2.active && cur.h > hh2) {
      hh2 = cur.h;
      hh2Date = cur.date;
    }
    if (curEntry3 !== null && cur.h > hh3) {
      hh3 = cur.h;
      hh3Date = cur.date;
    }

    // --- Stage 1: DTF TZ BUY (identical to lib/primeTrend.ts) ---
    if (s1 === null) {
      if (preS1Ref !== null && containingWeekStart(wtfDates, cur.date) !== inst.formationDate) {
        if (breakoutShape(prev, cur, preS1Ref)) {
          s1 = new Stage(cur.h, cur.l);
          s1Since = cur.date;
          s1ActivationPrice = cur.h;
          hh1 = cur.h;
          hh1Date = cur.date;
        } else if (cur.h > preS1Ref && cur.h - preS1Ref >= ANY) {
          preS1Ref = cur.h;
        }
      }
    } else if (s1.active) {
      if (slShape(cur, s1.refLow)) {
        s1.frozenRef = s1.refHigh;
        s1.active = false;
        if (curEntry3 !== null) {
          closePair3("DTF TZ BUY SL (wipes ENTRY AND TZ BUY 3)", cur.date, s1.refLow);
        }
        s2 = null;
        s3 = null;
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
        hh1 = cur.h;
        hh1Date = cur.date;
      } else if (cur.h > frozenRef && cur.h - frozenRef >= ANY) {
        s1.frozenRef = cur.h;
      }
    }

    // --- Stage 2: DTF TZ BUY ENTRY (identical to lib/primeTrend.ts) ---
    if (s1 !== null && s1.active) {
      if (s2 === null) {
        const ref2 = s1.entryRatchet;
        if (breakoutShape(prev, cur, ref2)) {
          s2 = new Stage(cur.h, cur.l);
          s2Since = cur.date;
          s2ActivationPrice = ref2 + THRESH;
          hh2 = cur.h;
          hh2Date = cur.date;
        } else if (cur.h > ref2 && cur.h - ref2 >= ANY) {
          s1.entryRatchet = cur.h;
        }
      } else if (s2.active) {
        if (slShape(cur, s2.refLow)) {
          s2.frozenRef = s2.refHigh;
          s2.active = false;
          if (curEntry3 !== null) {
            closePair3("DTF TZ BUY ENTRY SL (wipes TZ BUY 3)", cur.date, s2.refLow);
          }
          s3 = null;
        } else {
          if (cur.l < s2.refLow) s2.refLow = cur.l;
          if (cur.h > s2.refHigh && cur.h - s2.refHigh >= ANY) s2.refHigh = cur.h;
        }
      } else {
        const frozenRef2 = s2.frozenRef as number;
        if (breakoutShape(prev, cur, frozenRef2)) {
          s2 = new Stage(cur.h, cur.l);
          s2Since = cur.date;
          s2ActivationPrice = frozenRef2 + THRESH;
          hh2 = cur.h;
          hh2Date = cur.date;
        } else if (cur.h > frozenRef2 && cur.h - frozenRef2 >= ANY) {
          s2.frozenRef = cur.h;
        }
      }
    }

    // --- Stage 3: TZ BUY 3 (NEW -- escalates above Stage 2 the exact same
    // way Stage 2 escalates above Stage 1) ---
    if (s2 !== null && s2.active) {
      if (s3 === null) {
        const ref3 = s2.entryRatchet;
        if (breakoutShape(prev, cur, ref3)) {
          const entryPrice = ref3 + THRESH;
          s3 = new Stage(cur.h, cur.l);
          curEntry3 = [cur.date, entryPrice];
          hh3 = cur.h;
          hh3Date = cur.date;
        } else if (cur.h > ref3 && cur.h - ref3 >= ANY) {
          s2.entryRatchet = cur.h;
        }
      } else if (s3.active) {
        if (slShape(cur, s3.refLow)) {
          s3.frozenRef = s3.refHigh;
          s3.active = false;
          closePair3("TZ BUY 3 SL", cur.date, s3.refLow);
        } else {
          if (cur.l < s3.refLow) s3.refLow = cur.l;
          if (cur.h > s3.refHigh && cur.h - s3.refHigh >= ANY) s3.refHigh = cur.h;
        }
      } else {
        const frozenRef3 = s3.frozenRef as number;
        if (breakoutShape(prev, cur, frozenRef3)) {
          const entryPrice = frozenRef3 + THRESH;
          s3 = new Stage(cur.h, cur.l);
          curEntry3 = [cur.date, entryPrice];
          hh3 = cur.h;
          hh3Date = cur.date;
        } else if (cur.h > frozenRef3 && cur.h - frozenRef3 >= ANY) {
          s3.frozenRef = cur.h;
        }
      }
    }

    i += 1;
  }

  if (curEntry3 !== null) {
    // Stage 3 was still open when the window ended -- the exit is
    // whatever ended this WTF instance (already resolved on inst), same
    // as lib/primeTrend.ts's own still-open handling one tier down.
    const exitType = inst.endEvent !== null ? inst.endEvent : "still open";
    const entry = curEntry3 as [string, number];
    rows.push({
      family: inst.family,
      letter: inst.letter,
      wtfFormationDate: inst.formationDate,
      entryDate: entry[0],
      entryPrice: entry[1],
      exitType,
      exitDate: inst.endDate,
      exitPrice: inst.endPrice,
      highestHigh: hh3Date ? hh3 : null,
      highestHighDate: hh3Date,
    });
  }

  // Same merge as lib/primeTrend.ts: when the final Stage 3 cycle closed
  // on a DTF-side SL and the WTF anchor itself later independently failed
  // with no further DTF reactivation in between, fold that WTF failure
  // into the final row's exit type instead of leaving it looking
  // unresolved.
  if (rows.length > 0 && DTF_SL_EXIT_TYPES_11.has(rows[rows.length - 1].exitType)) {
    const label = wtfSlLabel(inst.endEvent);
    if (label !== null) {
      const last = rows[rows.length - 1];
      rows[rows.length - 1] = { ...last, exitType: `DTF SL - ${label}` };
    }
  }

  const stage1Active = s1 !== null && s1.active;
  const stage2Active = s2 !== null && s2.active;
  const stage3Active = s3 !== null && s3.active;
  return [
    rows,
    {
      family: inst.family,
      letter: inst.letter,
      stage1Active,
      stage1Since: stage1Active ? s1Since : null,
      stage1ActivationPrice: stage1Active ? s1ActivationPrice : null,
      stage1StopLoss: stage1Active && s1 ? s1.refLow : null,
      stage1HighestHigh: stage1Active ? (hh1Date ? hh1 : null) : null,
      stage1HighestHighDate: stage1Active ? hh1Date : null,
      stage2Active,
      stage2Since: stage2Active ? s2Since : null,
      stage2ActivationPrice: stage2Active ? s2ActivationPrice : null,
      stage2StopLoss: stage2Active && s2 ? s2.refLow : null,
      stage2HighestHigh: stage2Active ? (hh2Date ? hh2 : null) : null,
      stage2HighestHighDate: stage2Active ? hh2Date : null,
      stage3Active,
      stage3Since: stage3Active && curEntry3 ? (curEntry3 as [string, number])[0] : null,
      stage3ActivationPrice: stage3Active && curEntry3 ? (curEntry3 as [string, number])[1] : null,
      stage3StopLoss: stage3Active && s3 ? s3.refLow : null,
      stage3HighestHigh: stage3Active ? (hh3Date ? hh3 : null) : null,
      stage3HighestHighDate: stage3Active ? hh3Date : null,
    },
  ];
}

// --------------------------------------------------------------------
// Public entry points
// --------------------------------------------------------------------

/** Returns one PrimeTrendResult11 per closed (or still-open) Stage 3 (TZ
 * BUY 3) entry/exit cycle -- the Stage-3 analogue of computePrimeTrend's
 * own Stage 2 (DTF TZ BUY ENTRY) historical trade log. An instance that
 * never confirms Stage 3 at all produces no rows here, same Filter rule
 * as the shipped theory one tier down. */
export function computePrimeTrend11(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrendResult11[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows);

  const results: PrimeTrendResult11[] = [];
  for (const inst of instances) {
    const [rows] = simulateDtfAll11(dtfDays, wtfTrace, wtfDates, inst);
    results.push(...rows);
  }
  return results;
}

/** Same shape as computePrimeTrendLive, extended with a third stage. See
 * the module header for the reporting shift this backs. */
export function computePrimeTrendLive11(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrendLiveStatus11[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows);

  const liveStatuses: PrimeTrendLiveStatus11[] = [];
  for (const inst of instances) {
    if (inst.endEvent !== null) continue;
    const [, live] = simulateDtfAll11(dtfDays, wtfTrace, wtfDates, inst);
    if (live !== null && (live.stage1Active || live.stage2Active || live.stage3Active)) {
      liveStatuses.push(live);
    }
  }
  return liveStatuses;
}
