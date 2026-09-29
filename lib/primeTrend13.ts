// PRIME TREND 1.3 -- an experimental variant of PRIME TREND
// (lib/primeTrend.ts), NOT part of the shipped theory. Purely a DTF-side
// escalation ladder run inside a WTF TZ BUY 2 / REAR 2 / REAR RE-ENTER 2
// window -- the WTF anchor only defines the instance's own window; "WTF
// TZ BUY 2 is as good as DTF TZ BUY" (all analysis shifts to DTF once the
// anchor forms).
//
// REVISION NOTE: this replaces an earlier draft of PRIME TREND 1.3 (a
// simpler two-case A/B ladder). This version was confirmed correct after
// a clarifying round -- see the "confirmed" mechanics below.
//
// One repeating "level" structure (level 0 = the outer ladder; level 1 =
// REAR; level 2+ = REAR RE-ENTER, reactivating in place -- INFERRED, see
// note below), each with the SAME two-phase shape:
//
//   Phase 1 -- this level's own first (and only) escalation:
//     - Level 0 starts immediately (no entry condition). Level >=1 first
//       requires clearing the running top reference (the highest
//       reference ANY level or nested lineage so far has ever reached --
//       "whichever is higher" between the earlier BAR ENTRY's own
//       reference and any nested BAR's own reference, confirmed).
//     - Once entered, a flexible gate applies: EITHER a single RED1 OR a
//       full RED1->RED2 cascade unlocks watching for this level's own
//       BAR1 (confirmed: "either RED1 or RED1-RED2"). RED2, if it
//       happens, is incidental -- not a separate requirement.
//     - BAR1 forms via the plain, unrestricted day-over-day breakout,
//       then escalates to this level's own tier-2 (named "BAR ENTRY" for
//       level 0, "REAR ENTRY" for level 1, "REAR RE-ENTER" for level 2+)
//       by clearing BAR1's own reference high. This escalation happens
//       only once per level ("BAR1-BAR ENTRY is only for the first
//       time").
//     - If this own BAR1 hits its own SL BEFORE ever escalating: no row
//       has opened yet -- go back to watching for a fresh RED1 (the same
//       flexible gate, not yet "opened" for unlimited reform).
//
//   Phase 2 -- nested BAR1/BAR2 sub-lineages, once this level's own
//   tier-2 has formed (a result row opens here and stays open through
//   the whole of Phase 2):
//     - A FRESH, MANDATORY RED1->RED2 cascade (post-tier-2 pullback,
//       identical shape/logic to dtf_bar.py's own RED gate) must confirm
//       ONCE to open the door to nested reformation ("AFTER BAR ENTRY
//       ANOTHER BAR1-BAR2 CAN OCCUR ONLY AFTER RED1-RED2").
//     - Once open, nested BAR1 forms via the plain breakout and can
//       regenerate an UNLIMITED number of times on its own SL --
//       confirmed explicitly: no further RED gate and no reference-high
//       gate are needed for these reforms ("a normal BAR1 will occur
//       when any further-date BAR1 satisfies with respect to previous
//       day high" -- the mandatory RED1-RED2 only ever needs to fire
//       once to open this level's own door).
//     - Nested BAR1 escalates to nested BAR2 the same way BAR1 escalates
//       to BAR ENTRY. When nested BAR2 hits its OWN (harder) SL --
//       reported as "PRIME TREND SL" -- the row closes and the ladder
//       PROMOTES to the next level, above the running top reference.
//
// A stock is reported as "PRIME TREND" (live) from the moment ANY
// level's own tier-2 (BAR ENTRY / REAR ENTRY / REAR RE-ENTER) forms,
// continuously through the whole of that level's Phase 2 (nested BAR1
// being tier-1-only doesn't end it -- this level's own tier-2 never
// fails on its own; only a nested BAR2's harder SL ends this level's
// row, promoting straight into the next level's own Phase 1).
//
// Reuses lib/primeTrend.ts's own WTF-trace/instance machinery (`prepare`)
// unchanged, same as every other PRIME TREND variant. Does NOT modify
// computePrimeTrend, computePrimeTrendLive, or any other shipped
// behavior.
//
// SCOPE OF THIS PASS (NOT yet verified against real data):
//   - Single ladder per anchor window -- no concurrent/racing lineages.
//   - Anchored on all three WTF families (TZ BUY 2, REAR 2, REAR
//     RE-ENTER 2), same as shipped PRIME TREND (unchanged from the
//     earlier draft, not re-confirmed this round but no indication it
//     should change).
//
// INFERRED (not explicitly specified, flagged for review): once REAR
// RE-ENTER (level 2) is reached, a further promotion (its own nested
// BAR2 later hitting its own harder SL) is modeled as REAR RE-ENTER
// reactivating IN PLACE above the new running top reference -- not a
// "REAR RE-ENTER 2", "3", etc. This mirrors dtf_bar.py's own explicit,
// already-confirmed precedent ("REAR RE-ENTER, once formed, reactivates
// in place... after each subsequent SL"), and matches "further same as
// REAR" read as an indefinitely-repeating pattern rather than a
// one-time-only extension.

import { THRESH, EPS, type Day } from "./tzEngineWtf";
import { prepare, type OhlcRow, type PrimeTrendFamily, type WtfInstance } from "./primeTrend";

function bar1Shape(prev: Day, cur: Day): boolean {
  return cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h;
}

function breaksRef(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

function isSl(cur: Day, refLow: number): boolean {
  return cur.l <= refLow && refLow - cur.l >= THRESH - EPS && cur.c <= refLow + EPS;
}

function isRed1Shape(prev: Day, cur: Day): boolean {
  return cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l;
}

/** The mandatory, once-per-level nested RED1->RED2 gate -- identical
 * logic to dtf_bar.py/dtfBar.ts's own evalRed (quiet-climb of the
 * reference high, quiet-drop of the reference low, until either RED2
 * confirms or the pullback is invalidated by a fresh breakout above the
 * reference high). */
class RedGate {
  active = true;
  constructor(public refHigh: number, public refLow: number) {}
}

function stepRed(red: RedGate, prev: Day, cur: Day): "confirmed" | "invalid" | "continuing" {
  if (cur.h > red.refHigh && cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) {
    red.active = false;
    return "invalid";
  }
  if (cur.h > red.refHigh) red.refHigh = cur.h;
  if (cur.l < red.refLow) {
    const red2Holds = cur.h <= prev.h && red.refLow - cur.l >= THRESH - EPS && cur.c <= red.refLow + EPS;
    if (red2Holds) {
      red.active = false;
      return "confirmed";
    }
    red.refLow = cur.l;
  }
  return "continuing";
}

type Mode =
  | "LEVEL_SEEK_ENTRY" // level >=1 only: watching for this level's own entry (breaksRef against the running top reference)
  | "OWN_SEEK_RED" // watching for RED1 (flexible gate: RED1 alone suffices) to unlock this level's own BAR1
  | "OWN_SEEK_BAR1" // RED1 seen; watching for this level's own BAR1 (plain breakout)
  | "OWN_BAR1_ACTIVE" // own BAR1 (tier1) active; escalation opens this level's own tier2 (row opens); own SL -> back to OWN_SEEK_RED (fresh gate)
  | "NESTED_SEEK_RED1" // this level's own tier2 has formed; watching for the mandatory nested RED1
  | "NESTED_SEEK_RED2" // nested RED1 seen; watching for RED2 to confirm (mandatory cascade, once per level)
  | "NESTED_SEEK_BAR1" // nested gate opened; watching for nested BAR1 (plain breakout -- unlimited reforms from here, no gate, no reference)
  | "NESTED_BAR1_ACTIVE" // nested BAR1 (tier1) active; escalation -> NESTED_BAR2_ACTIVE; own SL -> back to NESTED_SEEK_BAR1 (no gate)
  | "NESTED_BAR2_ACTIVE"; // nested BAR2 (tier2) active; its own harder SL -> row closes ("PRIME TREND SL"), promote to next level

function sideForLevel(level: number): "BAR ENTRY" | "REAR ENTRY" | "REAR RE-ENTER" {
  if (level === 0) return "BAR ENTRY";
  if (level === 1) return "REAR ENTRY";
  return "REAR RE-ENTER";
}

class LevelState {
  level = 0;
  mode: Mode = "OWN_SEEK_RED";
  topRef = 0;
  nestedRed: RedGate | null = null;
  ownRefHigh = 0;
  ownRefLow = 0;
  nestedRefHigh = 0;
  nestedRefLow = 0;
  rowOpen = false;
  rowSide: "BAR ENTRY" | "REAR ENTRY" | "REAR RE-ENTER" = "BAR ENTRY";
  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;
}

function trackHH(state: LevelState, cur: Day): void {
  if (cur.h > state.rowHH) {
    state.rowHH = cur.h;
    state.rowHHDate = cur.date;
  }
}

export interface PrimeTrend13LiveStatus {
  family: PrimeTrendFamily;
  letter: string;
  primeTrendActive: boolean;
  side: "BAR ENTRY" | "REAR ENTRY" | "REAR RE-ENTER" | null;
  level: number | null;
  since: string | null;
  activationPrice: number | null;
  highestHigh: number | null;
  highestHighDate: string | null;
}

export interface PrimeTrend13Result {
  family: PrimeTrendFamily;
  letter: string;
  side: "BAR ENTRY" | "REAR ENTRY" | "REAR RE-ENTER";
  level: number;
  wtfFormationDate: string;
  entryDate: string;
  entryPrice: number;
  exitType: string;
  exitDate: string;
  exitPrice: number | null;
  highestHigh: number | null;
  highestHighDate: string | null;
}

/** Advances the ladder by one candle. Emits `opened` when a level's own
 * tier2 (BAR ENTRY / REAR ENTRY / REAR RE-ENTER) first forms -- opening
 * a result row -- and `closed` when a nested BAR2 within that level's
 * scope hits its own harder SL, closing the row and promoting to the
 * next level. */
function stepLevel(
  state: LevelState,
  prev: Day,
  cur: Day
): { opened: { side: "BAR ENTRY" | "REAR ENTRY" | "REAR RE-ENTER"; price: number } | null; closed: { exitType: string; exitPrice: number } | null } {
  let opened: { side: "BAR ENTRY" | "REAR ENTRY" | "REAR RE-ENTER"; price: number } | null = null;
  let closed: { exitType: string; exitPrice: number } | null = null;

  switch (state.mode) {
    case "LEVEL_SEEK_ENTRY": {
      if (breaksRef(prev, cur, state.topRef)) {
        state.topRef = Math.max(state.topRef, cur.h);
        state.mode = "OWN_SEEK_RED";
      }
      break;
    }

    case "OWN_SEEK_RED": {
      if (isRed1Shape(prev, cur)) {
        state.mode = "OWN_SEEK_BAR1";
      }
      break;
    }

    case "OWN_SEEK_BAR1": {
      if (bar1Shape(prev, cur)) {
        state.ownRefHigh = cur.h;
        state.ownRefLow = cur.l;
        state.rowHH = cur.h;
        state.rowHHDate = cur.date;
        state.mode = "OWN_BAR1_ACTIVE";
      }
      break;
    }

    case "OWN_BAR1_ACTIVE": {
      trackHH(state, cur);
      // Escalation checked before quiet climb (same ordering fix used
      // throughout this codebase's tier1->tier2 escalations).
      if (breaksRef(prev, cur, state.ownRefHigh)) {
        state.topRef = Math.max(state.topRef, cur.h);
        state.rowOpen = true;
        state.rowSide = sideForLevel(state.level);
        state.rowEntryDate = cur.date;
        state.rowEntryPrice = cur.h;
        opened = { side: state.rowSide, price: cur.h };
        state.mode = "NESTED_SEEK_RED1";
        break;
      }
      const slNow = isSl(cur, state.ownRefLow);
      if (!slNow && cur.h > state.ownRefHigh) state.ownRefHigh = cur.h;
      if (!slNow && cur.l < state.ownRefLow) state.ownRefLow = cur.l;
      if (slNow) {
        // No row ever opened -- back to the flexible first gate.
        state.mode = "OWN_SEEK_RED";
      }
      break;
    }

    case "NESTED_SEEK_RED1": {
      trackHH(state, cur);
      if (isRed1Shape(prev, cur)) {
        state.nestedRed = new RedGate(cur.h, cur.l);
        state.mode = "NESTED_SEEK_RED2";
      }
      break;
    }

    case "NESTED_SEEK_RED2": {
      trackHH(state, cur);
      const result = stepRed(state.nestedRed as RedGate, prev, cur);
      if (result === "confirmed") {
        state.nestedRed = null;
        state.mode = "NESTED_SEEK_BAR1";
      } else if (result === "invalid") {
        // Same reset as dtf_bar.py's own INVALID RED1 fix.
        state.nestedRed = null;
        state.mode = "NESTED_SEEK_RED1";
      }
      break;
    }

    case "NESTED_SEEK_BAR1": {
      trackHH(state, cur);
      if (bar1Shape(prev, cur)) {
        state.nestedRefHigh = cur.h;
        state.nestedRefLow = cur.l;
        state.mode = "NESTED_BAR1_ACTIVE";
      }
      break;
    }

    case "NESTED_BAR1_ACTIVE": {
      trackHH(state, cur);
      if (breaksRef(prev, cur, state.nestedRefHigh)) {
        state.topRef = Math.max(state.topRef, cur.h);
        state.nestedRefHigh = cur.h;
        state.nestedRefLow = cur.l;
        state.mode = "NESTED_BAR2_ACTIVE";
        break;
      }
      const slNow = isSl(cur, state.nestedRefLow);
      if (!slNow && cur.h > state.nestedRefHigh) state.nestedRefHigh = cur.h;
      if (!slNow && cur.l < state.nestedRefLow) state.nestedRefLow = cur.l;
      if (slNow) {
        // Confirmed: unlimited reform, no gate, no reference-high needed.
        state.mode = "NESTED_SEEK_BAR1";
      }
      break;
    }

    case "NESTED_BAR2_ACTIVE": {
      trackHH(state, cur);
      const slNow = isSl(cur, state.nestedRefLow);
      if (!slNow && cur.h > state.nestedRefHigh) state.nestedRefHigh = cur.h;
      if (!slNow && cur.l < state.nestedRefLow) state.nestedRefLow = cur.l;
      if (slNow) {
        state.topRef = Math.max(state.topRef, state.nestedRefHigh);
        state.rowOpen = false;
        closed = { exitType: "PRIME TREND SL", exitPrice: cur.l };
        state.level += 1;
        state.nestedRed = null;
        state.mode = "LEVEL_SEEK_ENTRY";
      }
      break;
    }
  }

  return { opened, closed };
}

function simulateWindow(dtfDays: Day[], inst: WtfInstance): { rows: PrimeTrend13Result[]; live: PrimeTrend13LiveStatus | null } {
  const rows: PrimeTrend13Result[] = [];
  const state = new LevelState();

  let startIdx: number | null = null;
  for (let i = 0; i < dtfDays.length; i++) {
    if (dtfDays[i].date > inst.formationDate) {
      startIdx = i;
      break;
    }
  }

  if (startIdx !== null) {
    for (let i = startIdx; i < dtfDays.length && dtfDays[i].date <= inst.endDate; i++) {
      const prev = dtfDays[i - 1];
      const cur = dtfDays[i];
      const { closed } = stepLevel(state, prev, cur);
      if (closed) {
        rows.push({
          family: inst.family,
          letter: inst.letter,
          side: state.rowSide,
          level: state.level - 1, // stepLevel already incremented on close
          wtfFormationDate: inst.formationDate,
          entryDate: state.rowEntryDate as string,
          entryPrice: state.rowEntryPrice as number,
          exitType: closed.exitType,
          exitDate: cur.date,
          exitPrice: closed.exitPrice,
          highestHigh: state.rowHHDate ? state.rowHH : null,
          highestHighDate: state.rowHHDate,
        });
      }
    }
  }

  if (state.rowOpen) {
    rows.push({
      family: inst.family,
      letter: inst.letter,
      side: state.rowSide,
      level: state.level,
      wtfFormationDate: inst.formationDate,
      entryDate: state.rowEntryDate as string,
      entryPrice: state.rowEntryPrice as number,
      exitType: inst.endEvent !== null ? inst.endEvent : "still open",
      exitDate: inst.endDate,
      exitPrice: inst.endPrice,
      highestHigh: state.rowHHDate ? state.rowHH : null,
      highestHighDate: state.rowHHDate,
    });
  }

  if (inst.endEvent !== null) return { rows, live: null };

  const live: PrimeTrend13LiveStatus = {
    family: inst.family,
    letter: inst.letter,
    primeTrendActive: state.rowOpen,
    side: state.rowOpen ? state.rowSide : null,
    level: state.rowOpen ? state.level : null,
    since: state.rowOpen ? state.rowEntryDate : null,
    activationPrice: state.rowOpen ? state.rowEntryPrice : null,
    highestHigh: state.rowOpen ? (state.rowHHDate ? state.rowHH : null) : null,
    highestHighDate: state.rowOpen ? state.rowHHDate : null,
  };
  return { rows, live };
}

export function computePrimeTrend13(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrend13Result[] {
  const { dtfDays, instances } = prepare(wtfRows, dtfRows);
  const results: PrimeTrend13Result[] = [];
  for (const inst of instances) {
    const { rows } = simulateWindow(dtfDays, inst);
    results.push(...rows);
  }
  return results;
}

export function computePrimeTrendLive13(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrend13LiveStatus[] {
  const { dtfDays, instances } = prepare(wtfRows, dtfRows);
  const liveStatuses: PrimeTrend13LiveStatus[] = [];
  for (const inst of instances) {
    if (inst.endEvent !== null) continue;
    const { live } = simulateWindow(dtfDays, inst);
    if (live !== null && live.primeTrendActive) {
      liveStatuses.push(live);
    }
  }
  return liveStatuses;
}
