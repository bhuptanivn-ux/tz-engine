// PRIME TREND 1.3 -- an experimental variant of PRIME TREND
// (lib/primeTrend.ts), NOT part of the shipped theory. Purely a DTF-side
// escalation ladder run inside a WTF TZ BUY 2 / REAR 2 / REAR RE-ENTER 2
// window -- unlike PRIME TREND 1.2, there is no separate WTF-side ladder
// here; the WTF anchor only defines the instance's own window.
//
// DTF side, within the anchor's own window:
//   - Mandatory RED1 -> RED2 cascade (identical shape/logic to
//     dtf_bar.py's own pre-TZ-BUY gate, including the quiet-climb/
//     quiet-drop updates to RED1's own reference before RED2 confirms).
//     This gate fires ONCE per window -- no later generation below needs
//     a fresh RED1/RED2.
//   - Once RED2 confirms, BAR1 forms via the plain day-over-day breakout
//     (unrestricted -- not gated on any reference). BAR1 escalates to
//     BAR ENTRY the same way BAR1 escalates to BAR2 everywhere else in
//     this codebase: clear BAR1's own reference high by >=0.20 with the
//     full breakout shape.
//   - Case B (BAR1's own SL, i.e. BAR1 failing BEFORE ever escalating to
//     BAR ENTRY): a fresh BAR(N+1) can reform anywhere via the SAME plain
//     breakout -- deliberately NOT gated on clearing the dead lineage's
//     own reference high (explicitly stated: "it will not use reference
//     high"). Unlimited generations.
//   - Case A (BAR ENTRY's own SL -- the harder failure, since it already
//     escalated past BAR1; reported as "PRIME TREND SL"): opens REAR1,
//     which forms the moment price clears the running top reference
//     (the highest reference any BAR1/BAR ENTRY in this window ever
//     reached) via the same breakout shape. REAR1 then escalates to REAR
//     ENTRY exactly the way BAR1 escalates to BAR ENTRY (clear REAR1's
//     own reference high by the full breakout shape).
//   - REAR ENTRY's own SL falls back to Case B: a fresh BAR(N+1) can
//     reform via the plain, unrestricted breakout (confirmed: the same
//     rule repeats indefinitely, not just once).
//   - A later generation's own BAR ENTRY(N+1) hitting its own (harder)
//     SL repeats Case A again: REAR(N+1)-REAR ENTRY(N+1) forms above the
//     new running top reference (confirmed: this also repeats, not just
//     once).
//
// A stock is reported as "PRIME TREND" (live) whenever ANY tier-2-
// equivalent is currently active -- BAR ENTRY or REAR ENTRY, at any
// generation (confirmed). A tier-1-only state (BAR1 or REAR1, not yet
// escalated) does NOT count as PRIME TREND on its own.
//
// Reuses lib/primeTrend.ts's own WTF-trace/instance machinery (`prepare`)
// to detect each anchor instance's own formation/end -- unchanged from
// the shipped theory, same as PRIME TREND 1.1/1.2. Does NOT modify
// computePrimeTrend, computePrimeTrendLive, or any other shipped
// behavior.
//
// SCOPE OF THIS FIRST PASS (NOT yet verified against real data):
//   - Single ladder per anchor window -- no concurrent/racing lineages.
//   - Anchored on all three WTF families (TZ BUY 2, REAR 2, REAR
//     RE-ENTER 2), same as shipped PRIME TREND and PRIME TREND 1.2
//     (confirmed).
//
// INFERRED (not explicitly specified, flagged for review): REAR1's own
// SL -- i.e. REAR1 failing BEFORE it ever escalates to REAR ENTRY -- is
// treated the same way REAR ENTRY's own SL is treated: it falls back to
// Case B, a fresh BAR(N+1) via the plain, unrestricted breakout. The
// rules as stated only ever named "BAR SL" (pre-escalation) and "BAR
// ENTRY SL" / "DTF BAR SL2" (post-escalation) explicitly, and only
// confirmed the post-REAR-ENTRY-SL fallback; REAR1's own pre-escalation
// SL was never named on its own, so this mirrors BAR1's own pre-
// escalation SL by the closest available symmetry.

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

/** RED1 -> RED2, identical logic to dtf_bar.py/dtfBar.ts's own evalRed
 * (quiet-climb of the reference high, quiet-drop of the reference low,
 * until either RED2 confirms or the pullback is invalidated by a fresh
 * breakout above the reference high). */
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
  | "SEEK_RED1"
  | "SEEK_RED2"
  | "SEEK_BAR1" // searching for the next BAR1 (any generation) -- plain breakout, no reference gate
  | "BAR1_ACTIVE" // tier1 active, watching escalation to BAR ENTRY or its own (Case B) SL
  | "BAR_ENTRY_ACTIVE" // tier2 active, watching its own (harder, Case A) SL
  | "SEEK_REAR1" // searching for REAR1 -- gated on the running top reference
  | "REAR1_ACTIVE"
  | "REAR_ENTRY_ACTIVE";

class LadderState {
  mode: Mode = "SEEK_RED1";
  red: RedGate | null = null;
  gen = 0; // current BAR generation number
  topRef = 0; // running highest reference any BAR1/BAR ENTRY in this window ever reached
  refHigh = 0;
  refLow = 0;
  since: string | null = null;
  entryPrice: number | null = null;
  hh = 0;
  hhDate: string | null = null;
}

export interface PrimeTrend13LiveStatus {
  family: PrimeTrendFamily;
  letter: string;
  primeTrendActive: boolean;
  side: "BAR ENTRY" | "REAR ENTRY" | null;
  generation: number | null;
  since: string | null;
  activationPrice: number | null;
  stopLoss: number | null;
  highestHigh: number | null;
  highestHighDate: string | null;
}

export interface PrimeTrend13Result {
  family: PrimeTrendFamily;
  letter: string;
  side: "BAR ENTRY" | "REAR ENTRY";
  generation: number;
  wtfFormationDate: string;
  entryDate: string;
  entryPrice: number;
  exitType: string;
  exitDate: string;
  exitPrice: number | null;
  highestHigh: number | null;
  highestHighDate: string | null;
}

/** Advances the ladder by one candle. Emits `opened` when a tier-2-
 * equivalent (BAR ENTRY or REAR ENTRY) first forms, and `closed` when
 * the currently-active tier-2-equivalent hits its own SL -- tier-1-only
 * transitions (BAR1/REAR1 forming, escalating, or their own pre-
 * escalation SL) are silent, since they aren't "PRIME TREND active" on
 * their own (per the confirmed live-flag scope). */
function stepLadder(
  state: LadderState,
  prev: Day,
  cur: Day
): { opened: { side: "BAR ENTRY" | "REAR ENTRY"; generation: number; price: number } | null; closed: { exitType: string; exitPrice: number } | null } {
  let opened: { side: "BAR ENTRY" | "REAR ENTRY"; generation: number; price: number } | null = null;
  let closed: { exitType: string; exitPrice: number } | null = null;

  switch (state.mode) {
    case "SEEK_RED1": {
      if (isRed1Shape(prev, cur)) {
        state.red = new RedGate(cur.h, cur.l);
        state.mode = "SEEK_RED2";
      }
      break;
    }

    case "SEEK_RED2": {
      const result = stepRed(state.red as RedGate, prev, cur);
      if (result === "confirmed") {
        state.red = null;
        state.mode = "SEEK_BAR1";
      } else if (result === "invalid") {
        // Same reset as dtf_bar.py's own INVALID RED1 fix: a cancelled
        // RED1 must not be mistaken for a confirmed RED2 -- go back to
        // watching for a genuinely fresh RED1.
        state.red = null;
        state.mode = "SEEK_RED1";
      }
      break;
    }

    case "SEEK_BAR1": {
      if (bar1Shape(prev, cur)) {
        state.gen += 1;
        state.refHigh = cur.h;
        state.refLow = cur.l;
        state.since = cur.date;
        state.entryPrice = cur.h;
        state.hh = cur.h;
        state.hhDate = cur.date;
        state.mode = "BAR1_ACTIVE";
      }
      break;
    }

    case "BAR1_ACTIVE": {
      if (cur.h > state.hh) {
        state.hh = cur.h;
        state.hhDate = cur.date;
      }
      // Escalation checked before quiet climb (same ordering fix used
      // throughout this codebase's BAR1->BAR2-style escalations).
      if (breaksRef(prev, cur, state.refHigh)) {
        state.topRef = Math.max(state.topRef, cur.h);
        state.refHigh = cur.h;
        state.refLow = cur.l;
        state.since = cur.date;
        state.entryPrice = cur.h;
        state.hh = cur.h;
        state.hhDate = cur.date;
        state.mode = "BAR_ENTRY_ACTIVE";
        opened = { side: "BAR ENTRY", generation: state.gen, price: cur.h };
        break;
      }
      const slNow = isSl(cur, state.refLow);
      if (!slNow && cur.h > state.refHigh) state.refHigh = cur.h;
      if (!slNow && cur.l < state.refLow) state.refLow = cur.l;
      if (slNow) {
        // Case B: BAR1's own SL, before ever escalating. A fresh BAR(N+1)
        // can reform anywhere via the plain breakout -- no reference gate.
        state.mode = "SEEK_BAR1";
      }
      break;
    }

    case "BAR_ENTRY_ACTIVE": {
      if (cur.h > state.hh) {
        state.hh = cur.h;
        state.hhDate = cur.date;
      }
      const slNow = isSl(cur, state.refLow);
      if (!slNow && cur.h > state.refHigh) state.refHigh = cur.h;
      if (!slNow && cur.l < state.refLow) state.refLow = cur.l;
      if (slNow) {
        // Case A: BAR ENTRY's own (harder) SL -- reported as PRIME TREND
        // SL. Opens REAR1 above the running top reference.
        state.topRef = Math.max(state.topRef, state.refHigh);
        closed = { exitType: "PRIME TREND SL", exitPrice: cur.l };
        state.mode = "SEEK_REAR1";
      }
      break;
    }

    case "SEEK_REAR1": {
      if (breaksRef(prev, cur, state.topRef)) {
        state.refHigh = cur.h;
        state.refLow = cur.l;
        state.since = cur.date;
        state.entryPrice = cur.h;
        state.hh = cur.h;
        state.hhDate = cur.date;
        state.mode = "REAR1_ACTIVE";
      }
      break;
    }

    case "REAR1_ACTIVE": {
      if (cur.h > state.hh) {
        state.hh = cur.h;
        state.hhDate = cur.date;
      }
      if (breaksRef(prev, cur, state.refHigh)) {
        state.topRef = Math.max(state.topRef, cur.h);
        state.refHigh = cur.h;
        state.refLow = cur.l;
        state.since = cur.date;
        state.entryPrice = cur.h;
        state.hh = cur.h;
        state.hhDate = cur.date;
        state.mode = "REAR_ENTRY_ACTIVE";
        opened = { side: "REAR ENTRY", generation: state.gen, price: cur.h };
        break;
      }
      const slNow = isSl(cur, state.refLow);
      if (!slNow && cur.h > state.refHigh) state.refHigh = cur.h;
      if (!slNow && cur.l < state.refLow) state.refLow = cur.l;
      if (slNow) {
        // INFERRED (see module docstring): REAR1's own pre-escalation SL
        // mirrors BAR1's own -- falls back to Case B, a fresh BAR(N+1).
        state.mode = "SEEK_BAR1";
      }
      break;
    }

    case "REAR_ENTRY_ACTIVE": {
      if (cur.h > state.hh) {
        state.hh = cur.h;
        state.hhDate = cur.date;
      }
      const slNow = isSl(cur, state.refLow);
      if (!slNow && cur.h > state.refHigh) state.refHigh = cur.h;
      if (!slNow && cur.l < state.refLow) state.refLow = cur.l;
      if (slNow) {
        // Confirmed: falls back to Case B again -- a fresh BAR(N+1) via
        // the plain, unrestricted breakout.
        closed = { exitType: "REAR ENTRY SL", exitPrice: cur.l };
        state.mode = "SEEK_BAR1";
      }
      break;
    }
  }

  return { opened, closed };
}

function simulateWindow(dtfDays: Day[], inst: WtfInstance): { rows: PrimeTrend13Result[]; live: PrimeTrend13LiveStatus | null } {
  const rows: PrimeTrend13Result[] = [];
  const state = new LadderState();

  let startIdx: number | null = null;
  for (let i = 0; i < dtfDays.length; i++) {
    if (dtfDays[i].date > inst.formationDate) {
      startIdx = i;
      break;
    }
  }

  let curEntry: { side: "BAR ENTRY" | "REAR ENTRY"; generation: number; date: string; price: number } | null = null;
  if (startIdx !== null) {
    for (let i = startIdx; i < dtfDays.length && dtfDays[i].date <= inst.endDate; i++) {
      const prev = dtfDays[i - 1];
      const cur = dtfDays[i];
      const { opened, closed } = stepLadder(state, prev, cur);
      if (opened) {
        curEntry = { side: opened.side, generation: opened.generation, date: cur.date, price: opened.price };
      }
      if (closed && curEntry !== null) {
        rows.push({
          family: inst.family,
          letter: inst.letter,
          side: curEntry.side,
          generation: curEntry.generation,
          wtfFormationDate: inst.formationDate,
          entryDate: curEntry.date,
          entryPrice: curEntry.price,
          exitType: closed.exitType,
          exitDate: cur.date,
          exitPrice: closed.exitPrice,
          highestHigh: state.hhDate ? state.hh : null,
          highestHighDate: state.hhDate,
        });
        curEntry = null;
      }
    }
  }

  if (curEntry !== null) {
    rows.push({
      family: inst.family,
      letter: inst.letter,
      side: curEntry.side,
      generation: curEntry.generation,
      wtfFormationDate: inst.formationDate,
      entryDate: curEntry.date,
      entryPrice: curEntry.price,
      exitType: inst.endEvent !== null ? inst.endEvent : "still open",
      exitDate: inst.endDate,
      exitPrice: inst.endPrice,
      highestHigh: state.hhDate ? state.hh : null,
      highestHighDate: state.hhDate,
    });
  }

  if (inst.endEvent !== null) return { rows, live: null };

  const primeTrendActive = state.mode === "BAR_ENTRY_ACTIVE" || state.mode === "REAR_ENTRY_ACTIVE";
  const live: PrimeTrend13LiveStatus = {
    family: inst.family,
    letter: inst.letter,
    primeTrendActive,
    side: primeTrendActive ? (state.mode === "BAR_ENTRY_ACTIVE" ? "BAR ENTRY" : "REAR ENTRY") : null,
    generation: primeTrendActive ? state.gen : null,
    since: primeTrendActive ? state.since : null,
    activationPrice: primeTrendActive ? state.entryPrice : null,
    stopLoss: primeTrendActive ? state.refLow : null,
    highestHigh: primeTrendActive ? (state.hhDate ? state.hh : null) : null,
    highestHighDate: primeTrendActive ? state.hhDate : null,
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
