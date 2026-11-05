// PRIME TREND BAR THEORY -- relocated, DORMANT copy of PRIME TREND's own
// internal PBAR/PBAR ENTRY ladder and its TAR/TAR ENTRY + nested BAR1/BAR2
// "BAR THEORY" mirror. Cut out of primeTrend.ts's active computation path
// per the user's own instruction:
//
//   "Remove the BAR THEORY of PRIME TREND including PBAR/PBAR ENTRY and
//    save it elsewhere. you can name it as PRIME TREND BAR THEORY. Just
//    like cut paste. It will not be part of our testing. It will not be
//    part of PRIME TREND now. In future if required I will ask you to
//    bring it back. So only one PRIME TREND ENTRY POINT and that is
//    TZ BUY - BAR - BAR ENTRY."
//
// NOT wired into computePrimeTrend/simulateDtfAll or any other pipeline
// right now -- the state machines below are the exact ones that used to run
// inside simulateDtfAll (lib/primeTrend.ts, up to and including commit
// fba0002 and the uncommitted work on top of it), preserved verbatim so
// they can be reinstated later. The per-candle WIRING GLUE that drove these
// from simulateDtfAll's own loop -- the pbarWindows/pbarWindowIdx/
// wtfBarRefHigh bookkeeping, the window-boundary preservation logic (a
// WTF BAR SL/reform only resets a bare, unescalated seeking structure, never
// a confirmed PBAR ENTRY/TAR ENTRY/BAR1-BAR2 position), the
// `barEntryEverValid` gate, the force-close-on-first-SAR-fire handling, and
// the end-of-instance "still open" handling -- was specific to that loop's
// own local state and was removed along with it, not relocated as live
// code. See git history on lib/primeTrend.ts (the commit that removed this
// section) for exactly how it was wired, if/when this is reinstated.
//
// PRIME TREND's only currently active entry point is the BAR/BAR ENTRY
// ladder that remains in primeTrend.ts itself: TZ BUY -> RED -> BAR ->
// BAR ENTRY. A TZ BUY SL reactivates above the running reference high above
// TZ BUY's own occurrence high (which can keep climbing even after a BAR
// ENTRY occurred, same quiet-climb tracking as everywhere else) -- that
// part was never in question and needed no change.
//
// Per the user's own follow-up instruction, a (differently-gated) BAR
// THEORY is slated to return for the NEXT RED1/RED2 -> BAR cascade after a
// TZ BUY has already validated in DTF -- i.e. BAR THEORY and PRIME TREND's
// own active TZ BUY/BAR/BAR ENTRY ladder must never run concurrently on the
// same WTF BAR; BAR THEORY only becomes eligible for a WTF BAR whose own
// formation occurs while TZ BUY is already active. That reinstatement is
// tracked separately and is not implemented by this file.

import { ANY, Day, THRESH } from "./tzEngineWtf";
import {
  BarRedGate,
  breakoutShape,
  isBarRed1Shape,
  slShape,
  stepBarRed,
  InvalidSarState,
  type WtfTraceEntry,
} from "./primeTrend";

// --------------------------------------------------------------------
// DTF PBAR / PBAR ENTRY -- a SECOND, independent route to the same "PRIME
// TREND confirmed" goal, alongside the BAR/BAR ENTRY ladder in
// primeTrend.ts. Structurally the SAME continuous-RED1->RED2-tracker shape
// as BAR/BAR ENTRY (reuses BarRedGate/stepBarRed/isBarRed1Shape directly --
// same formulas, no need to duplicate), mirroring lib/tarTbar.ts's TAR/TBAR
// mechanics closely -- but NOT a reuse of that module: "TAR"/"TBAR" are
// reserved for the separate BAR theory (lib/tarTbar.ts's own consumer);
// PRIME TREND's names are "PBAR" (tier 1) / "PBAR ENTRY" (tier 2).
//
// Gate for STARTING this ladder at a given qualifying WTF BAR (this
// instance's own branch, same RED1->RED2->BAR1 cascade): DTF BAR ENTRY must
// NOT be currently active at that moment. Nothing else about DTF's own
// TZ BUY/BAR/BAR ENTRY state matters -- occurred or never occurred, active
// or not, confirmed-then-SL'd -- only BAR ENTRY's CURRENT state. Checked at
// each qualifying WTF BAR under this instance's letter, in order, until one
// passes. CRITICALLY, once started, the ladder runs CONTINUOUSLY for the
// rest of this instance's own window -- it does NOT restart or get
// abandoned at a LATER WTF BAR reform under the same letter (confirmed via
// real COCHINSHIP.NS data: the WTF side's own BAR SL(label) and BAR(label)
// reform, a few days apart, did not interrupt the DTF-side PBAR ladder's
// own continuous SEEK_PBAR -> PBAR_ACTIVE -> PBAR SL -> PBAR_ACTIVE ->
// PBAR_ENTRY_ACTIVE progression at all -- it just kept running through that
// WTF-side noise). DTF starts watching from the day after the qualifying
// WTF BAR's own formation date, same "day after formation" convention
// lib/tarTbar.ts uses.
//
// PBAR (tier 1)'s own bare, pre-escalation SL ALWAYS reforms unrestricted
// (plain day-over-day breakout, no reference to clear first) -- same as
// BAR's own bare SL. A clean PBAR ENTRY SL (PBAR itself not also breached)
// reforms PBAR ALONE first -- unlike BAR ENTRY's own clean-SL handling,
// there is no direct PBAR-ENTRY-level reactivation -- gated above the
// running top reference if the door (full RED1-RED2) hasn't opened yet, or
// immediately/unrestricted if it has. A decisive PBAR SL (PBAR's own
// reference also breached, wiping PBAR ENTRY with it) reforms gated above
// the PBAR ENTRY reference high -- the full-RED1-RED2-gated escalation past
// a decisive SL (this module's analogue of lib/tarTbar.ts's own REAR) is
// DEFERRED for now, same entry-only-scope precedent as BAR/BAR ENTRY's own
// deferred REAR.
// --------------------------------------------------------------------

export type PbarMode =
  | "SEEK_PBAR"
  | "PBAR_ACTIVE"
  | "PBAR_ENTRY_ACTIVE"
  | "SEEK_PBAR_ENTRY_REACTIVATION"
  | "SEEK_REACTIVATION";

export class PbarLevelState {
  mode: PbarMode = "SEEK_PBAR";
  // Path 1 is spent once per window -- confirmed: once used to form PBAR,
  // every later reform falls onto the ordinary RED-gated/ladder-position
  // rules below, never back to re-clearing the WTF BAR high again.
  pathOneUsed = false;
  everSawRed1 = false;
  red: BarRedGate | null = null;
  topRef = 0;

  pbarRefHigh = 0;
  pbarRefLow = 0;
  pbarActivationPrice: number | null = null;
  pbarFormationDate: string | null = null;
  pbarRefHighDate: string | null = null;
  pbarEntryRefHigh = 0;
  pbarEntryRefLow = 0;
  // PBAR ENTRY's own frozen reference high at the moment of a CLEAN PBAR
  // ENTRY SL (PBAR itself not also breached) -- the direct-reclaim target
  // while SEEK_PBAR_ENTRY_REACTIVATION races it against PBAR's own
  // (still-tracked-in-background) SL turning decisive instead. No fast lane
  // here, ever: PBAR ENTRY can only validate above its own reference high.
  frozenEntryRefHigh = 0;

  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;
}

/** Advances the PBAR/PBAR ENTRY ladder by one candle. Two independent ways
 * in (all just "PBAR", never a separate name):
 *   Path 1: straight breakout above the WTF BAR's own reference high
 *     (`wtfBarRefHigh`), no RED needed -- spent once per window.
 *   Path 2: one RED (or a completed RED1->RED2) -> plain breakout above
 *     yesterday's high.
 * PBAR ENTRY always escalates above PBAR's own reference high, on a later
 * candle -- never the same candle as PBAR, whichever path formed it.
 *
 * Reactivation (no fast lane, ever -- confirmed, removed):
 *   Clean PBAR ENTRY SL (PBAR survives): PBAR ENTRY reactivates directly
 *     above its own frozen reference high (SEEK_PBAR_ENTRY_REACTIVATION),
 *     racing only against PBAR's own still-tracked-in-background SL turning
 *     this into a combined failure instead.
 *   Bare PBAR SL (never reached PBAR ENTRY), or combined SL (PBAR + PBAR
 *     ENTRY both wiped): gated above the running top reference (PBAR's own
 *     high for a bare SL, PBAR ENTRY's own high for a combined one) -- same
 *     plain breakout shape as Path 2's own formation, just against that
 *     frozen reference instead of yesterday's High. */
export function stepPbarLevel(
  s: PbarLevelState,
  prev: Day,
  cur: Day,
  wtfBarRefHigh: number
): {
  opened: { price: number } | null;
  closed: { exitType: string; exitPrice: number } | null;
} {
  let opened: { price: number } | null = null;
  let closed: { exitType: string; exitPrice: number } | null = null;

  // --- the one continuous RED1->RED2 tracker, independent of PBAR state ---
  if (s.red === null) {
    if (isBarRed1Shape(prev, cur)) {
      s.red = new BarRedGate(cur.h, cur.l);
      s.everSawRed1 = true;
    }
  } else {
    const result = stepBarRed(s.red, prev, cur);
    if (result === "confirmed" || result === "invalid") s.red = null;
  }

  const formPbar = () => {
    s.pbarRefHigh = cur.h;
    s.pbarRefLow = cur.l;
    s.pbarActivationPrice = cur.h;
    s.pbarFormationDate = cur.date;
    s.pbarRefHighDate = cur.date;
    s.mode = "PBAR_ACTIVE";
  };

  switch (s.mode) {
    case "SEEK_PBAR": {
      // Path 1.
      if (!s.pathOneUsed && breakoutShape(prev, cur, wtfBarRefHigh)) {
        formPbar();
        s.pathOneUsed = true;
        break;
      }
      // Path 2.
      if (!s.everSawRed1) break;
      if (breakoutShape(prev, cur, prev.h)) formPbar();
      break;
    }
    case "PBAR_ACTIVE": {
      if (breakoutShape(prev, cur, s.pbarRefHigh)) {
        const entryPrice = s.pbarRefHigh + THRESH;
        s.pbarEntryRefHigh = cur.h;
        s.pbarEntryRefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "PBAR_ENTRY_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      const slNow = slShape(cur, s.pbarRefLow);
      if (!slNow && cur.h > s.pbarRefHigh && cur.h - s.pbarRefHigh >= ANY) {
        s.pbarRefHigh = cur.h;
        s.pbarRefHighDate = cur.date;
      }
      if (!slNow && cur.l < s.pbarRefLow) s.pbarRefLow = cur.l;
      if (slNow) {
        s.topRef = s.pbarRefHigh;
        s.mode = "SEEK_REACTIVATION";
      }
      break;
    }
    case "PBAR_ENTRY_ACTIVE": {
      if (cur.h > s.rowHH) {
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
      }
      const pbarSlNow = slShape(cur, s.pbarRefLow);
      const entrySlNow = slShape(cur, s.pbarEntryRefLow);
      if (!pbarSlNow && cur.h > s.pbarRefHigh && cur.h - s.pbarRefHigh >= ANY) {
        s.pbarRefHigh = cur.h;
        s.pbarRefHighDate = cur.date;
      }
      if (!pbarSlNow && cur.l < s.pbarRefLow) s.pbarRefLow = cur.l;
      if (!entrySlNow && cur.h > s.pbarEntryRefHigh && cur.h - s.pbarEntryRefHigh >= ANY) s.pbarEntryRefHigh = cur.h;
      if (!entrySlNow && cur.l < s.pbarEntryRefLow) s.pbarEntryRefLow = cur.l;

      if (pbarSlNow) {
        s.topRef = Math.max(s.pbarRefHigh, s.pbarEntryRefHigh);
        // Exit price is ALWAYS PBAR ENTRY's own (tighter) reference, same
        // as the clean case below, not PBAR's own wider one -- see the
        // identical note on stepBarLevel's own BAR/BAR ENTRY pair.
        const exitType = entrySlNow ? "DTF PBAR SL + DTF PBAR ENTRY SL" : "DTF PBAR SL (wipes ENTRY)";
        closed = { exitType, exitPrice: s.pbarEntryRefLow - THRESH };
        s.mode = "SEEK_REACTIVATION";
        break;
      }
      if (entrySlNow) {
        // Clean: PBAR itself not also breached -- stays alive in the
        // background. Races PBAR ENTRY's own direct reactivation against
        // PBAR's own (now decisive, if it comes first) SL -- see
        // SEEK_PBAR_ENTRY_REACTIVATION below. No fast lane here, ever.
        closed = { exitType: "DTF PBAR ENTRY SL", exitPrice: s.pbarEntryRefLow - THRESH };
        s.frozenEntryRefHigh = s.pbarEntryRefHigh;
        s.mode = "SEEK_PBAR_ENTRY_REACTIVATION";
        break;
      }
      break;
    }
    case "SEEK_PBAR_ENTRY_REACTIVATION": {
      if (breakoutShape(prev, cur, s.frozenEntryRefHigh)) {
        const entryPrice = s.frozenEntryRefHigh + THRESH;
        s.pbarEntryRefHigh = cur.h;
        s.pbarEntryRefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "PBAR_ENTRY_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      const barSlNow = slShape(cur, s.pbarRefLow);
      if (!barSlNow && cur.h > s.pbarRefHigh && cur.h - s.pbarRefHigh >= ANY) {
        s.pbarRefHigh = cur.h;
        s.pbarRefHighDate = cur.date;
      }
      if (!barSlNow && cur.l < s.pbarRefLow) s.pbarRefLow = cur.l;
      if (barSlNow) {
        // Decisive now, same as a combined PBAR SL + PBAR ENTRY SL -- falls
        // through to the ordinary gated reactivation path, no new row (the
        // clean ENTRY SL's own row was already pushed above).
        s.topRef = Math.max(s.pbarRefHigh, s.frozenEntryRefHigh);
        s.mode = "SEEK_REACTIVATION";
      }
      break;
    }
    case "SEEK_REACTIVATION": {
      // Gated reform, above the running top reference -- no fast lane
      // (removed, confirmed: there is no such shortcut).
      if (breakoutShape(prev, cur, s.topRef)) {
        s.topRef = Math.max(s.topRef, cur.h);
        formPbar();
        break;
      }
      if (cur.h > s.topRef) s.topRef = cur.h;
      break;
    }
  }

  return { opened, closed };
}

// --------------------------------------------------------------------
// BAR THEORY -- TAR / TAR ENTRY and the nested BAR1 / BAR2 cascade. Per the
// user's own correction (at the time this ran live), this was gated on
// `barEntryEverValid` (BAR ENTRY -- the TZ-BUY-continuation ladder --
// having confirmed at least once), NOT on `sarFired`: "Hereon BAR THEORY if
// BAR ENTRY IS VALID." Anchored on a fresh WTF RED1->RED2->BAR cascade from
// that point on, independent of whether SAR has ever engaged. Scoped to
// "WTF BAR active" windows exactly like PBAR's own (reused the identical
// wtfBarWindowsForLetter/pbarWindows, wiped at the same window boundaries,
// same continuous-WTF-BAR-active precondition).
//
// TAR / TAR ENTRY -- structurally the Path-1-only shape of PBAR (straight
// breakout above the WTF BAR's own reference high, no RED needed -- same
// `wtfBarRefHigh` anchor PBAR's own Path 1 uses), but with ONE confirmed
// difference: TAR's own bare (pre-escalation) SL reforms GATED above TAR's
// own reference high, never unrestricted.
//   TAR -> TAR SL (bare) -> TAR (gated, above TAR's own reference high).
//   TAR -> TAR ENTRY -> TAR ENTRY SL (clean) -> TAR ENTRY (direct, above its
//     own frozen reference high -- races TAR's own background SL turning it
//     decisive instead, same SEEK_*_ENTRY_REACTIVATION shape as everywhere
//     else in this file).
//   TAR -> TAR ENTRY -> TAR SL (combined) -> TAR (gated, above the TAR ENTRY
//     reference high).
//
// BAR1 / BAR2 -- a SEPARATE nested cascade, gated on BOTH of (confirmed):
// TAR SL having occurred at least once in this window (bare or combined --
// TAR ENTRY SL alone does not count, TAR itself must have failed), AND a
// RED1->RED2 cycle having completed at least once in this window (before,
// after, or alongside that TAR SL -- order doesn't matter, only that both
// have happened). Neither condition alone unlocks it ("without TAR SL, no
// BAR1-BAR2" -- confirmed). Once unlocked it runs for the rest of the
// window, in PARALLEL with TAR's own ladder (TAR keeps reforming per its
// own rules above; this is a second, independent track, same
// parallel-tracks shape as BAR/BAR-ENTRY and PBAR/PBAR-ENTRY elsewhere in
// this file). Once unlocked, BAR1 forms via a plain breakout (same shape as
// PBAR's own RED-gated Path 2 entry) -- the one confirmed difference from
// TAR: BAR1's own bare SL reforms UNRESTRICTED ("Immediately BAR1"), not
// gated.
//   BAR1 -> BAR1 SL (bare) -> BAR1 (unrestricted, plain breakout).
//   BAR1 -> BAR2 -> BAR2 SL (clean) -> BAR2 (direct, above its own frozen
//     reference high).
//   BAR1 -> BAR2 -> BAR1 SL (combined) -> BAR1 (gated, above the BAR2
//     reference high).
//
// NOTE on the RED1->RED2 tracker that gates BAR1/BAR2's own unlock: in the
// original simulateDtfAll wiring this was NOT inside TarLevelState/
// Bar1LevelState at all -- it was a separate, loop-local tracker (a bare
// `BarRedGate | null` variable plus a `bar12RedEverConfirmed` flag) stepped
// via isBarRed1Shape/stepBarRed directly, feeding `bar12RedEverConfirmed`,
// which combined with TarLevelState's own `tarSlNow` output
// (`tarSlEverHappened`) to decide when to first construct a Bar1LevelState
// and start calling stepBar1Level. That loop-local glue was removed along
// with the rest of simulateDtfAll's wiring (see this file's own header) --
// reconstructing it is part of reinstating this mechanism, not reproduced
// here as dead code.
// --------------------------------------------------------------------

export type TarMode = "SEEK_TAR" | "TAR_ACTIVE" | "TAR_ENTRY_ACTIVE" | "SEEK_TAR_ENTRY_REACTIVATION" | "SEEK_REACTIVATION";

export class TarLevelState {
  mode: TarMode = "SEEK_TAR";
  topRef = 0;

  tarRefHigh = 0;
  tarRefLow = 0;
  tarActivationPrice: number | null = null;
  tarFormationDate: string | null = null;
  tarRefHighDate: string | null = null;
  tarEntryRefHigh = 0;
  tarEntryRefLow = 0;
  frozenEntryRefHigh = 0;

  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;
}

/** Advances TAR/TAR ENTRY by one candle. See the module section comment
 * above for the confirmed formation/reactivation rules. */
export function stepTarLevel(
  s: TarLevelState,
  prev: Day,
  cur: Day,
  wtfBarRefHigh: number
): {
  opened: { price: number } | null;
  closed: { exitType: string; exitPrice: number } | null;
  tarSlNow: boolean;
} {
  let opened: { price: number } | null = null;
  let closed: { exitType: string; exitPrice: number } | null = null;
  let tarSlNow = false;

  switch (s.mode) {
    case "SEEK_TAR": {
      if (breakoutShape(prev, cur, wtfBarRefHigh)) {
        s.tarRefHigh = cur.h;
        s.tarRefLow = cur.l;
        s.tarActivationPrice = cur.h;
        s.tarFormationDate = cur.date;
        s.tarRefHighDate = cur.date;
        s.mode = "TAR_ACTIVE";
      }
      break;
    }
    case "TAR_ACTIVE": {
      if (breakoutShape(prev, cur, s.tarRefHigh)) {
        const entryPrice = s.tarRefHigh + THRESH;
        s.tarEntryRefHigh = cur.h;
        s.tarEntryRefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "TAR_ENTRY_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      const slNow = slShape(cur, s.tarRefLow);
      if (!slNow && cur.h > s.tarRefHigh && cur.h - s.tarRefHigh >= ANY) {
        s.tarRefHigh = cur.h;
        s.tarRefHighDate = cur.date;
      }
      if (!slNow && cur.l < s.tarRefLow) s.tarRefLow = cur.l;
      if (slNow) {
        // Bare, pre-escalation SL -- no row (nothing was ever reported as
        // open), same Filter-rule convention as BAR/PBAR's own bare tier-1
        // SL. tarSlNow still fires: it's half of BAR1/BAR2's own unlock
        // gate regardless of whether TAR ever escalated.
        tarSlNow = true;
        s.topRef = s.tarRefHigh;
        s.mode = "SEEK_REACTIVATION"; // gated, never unrestricted for TAR
      }
      break;
    }
    case "TAR_ENTRY_ACTIVE": {
      if (cur.h > s.rowHH) {
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
      }
      const tarSlDecisive = slShape(cur, s.tarRefLow);
      const entrySlNow = slShape(cur, s.tarEntryRefLow);
      if (!tarSlDecisive && cur.h > s.tarRefHigh && cur.h - s.tarRefHigh >= ANY) {
        s.tarRefHigh = cur.h;
        s.tarRefHighDate = cur.date;
      }
      if (!tarSlDecisive && cur.l < s.tarRefLow) s.tarRefLow = cur.l;
      if (!entrySlNow && cur.h > s.tarEntryRefHigh && cur.h - s.tarEntryRefHigh >= ANY) s.tarEntryRefHigh = cur.h;
      if (!entrySlNow && cur.l < s.tarEntryRefLow) s.tarEntryRefLow = cur.l;

      if (tarSlDecisive) {
        tarSlNow = true;
        s.topRef = Math.max(s.tarRefHigh, s.tarEntryRefHigh);
        // Exit price is ALWAYS TAR ENTRY's own (tighter) reference, same as
        // the clean case below, not TAR's own wider one -- see the
        // identical note on stepBarLevel's own BAR/BAR ENTRY pair above.
        const exitType = entrySlNow ? "DTF TAR SL + DTF TAR ENTRY SL" : "DTF TAR SL (wipes ENTRY)";
        closed = { exitType, exitPrice: s.tarEntryRefLow - THRESH };
        s.mode = "SEEK_REACTIVATION";
        break;
      }
      if (entrySlNow) {
        // A clean TAR ENTRY SL (TAR itself survives) also counts toward
        // BAR 1 - BAR 2's "TAR SL" gate requirement, same as a decisive
        // (bare or combined) TAR SL above.
        tarSlNow = true;
        closed = { exitType: "DTF TAR ENTRY SL", exitPrice: s.tarEntryRefLow - THRESH };
        s.frozenEntryRefHigh = s.tarEntryRefHigh;
        s.mode = "SEEK_TAR_ENTRY_REACTIVATION";
        break;
      }
      break;
    }
    case "SEEK_TAR_ENTRY_REACTIVATION": {
      if (breakoutShape(prev, cur, s.frozenEntryRefHigh)) {
        const entryPrice = s.frozenEntryRefHigh + THRESH;
        s.tarEntryRefHigh = cur.h;
        s.tarEntryRefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "TAR_ENTRY_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      const bgSlNow = slShape(cur, s.tarRefLow);
      if (!bgSlNow && cur.h > s.tarRefHigh && cur.h - s.tarRefHigh >= ANY) {
        s.tarRefHigh = cur.h;
        s.tarRefHighDate = cur.date;
      }
      if (!bgSlNow && cur.l < s.tarRefLow) s.tarRefLow = cur.l;
      if (bgSlNow) {
        tarSlNow = true;
        s.topRef = Math.max(s.tarRefHigh, s.frozenEntryRefHigh);
        s.mode = "SEEK_REACTIVATION";
      }
      break;
    }
    case "SEEK_REACTIVATION": {
      if (breakoutShape(prev, cur, s.topRef)) {
        s.topRef = Math.max(s.topRef, cur.h);
        s.tarRefHigh = cur.h;
        s.tarRefLow = cur.l;
        s.tarActivationPrice = cur.h;
        s.tarFormationDate = cur.date;
        s.tarRefHighDate = cur.date;
        s.mode = "TAR_ACTIVE";
      } else if (cur.h > s.topRef) {
        s.topRef = cur.h;
      }
      break;
    }
  }

  return { opened, closed, tarSlNow };
}

export type Bar1Mode = "SEEK_BAR1" | "BAR1_ACTIVE" | "BAR2_ACTIVE" | "SEEK_BAR2_REACTIVATION" | "SEEK_REACTIVATION";

export class Bar1LevelState {
  mode: Bar1Mode = "SEEK_BAR1";
  topRef = 0;
  // Set true the first time a combined SL establishes "the original gate"
  // (topRef). From then on topRef ratchets with every high reached in ANY
  // mode, and even BAR1's own unrestricted ("Immediately BAR1") bare-SL
  // reform must clear it -- not just the prior day's high -- so a reform
  // can never fire below a high this window already proved it could reach.
  gateEstablished = false;

  bar1RefHigh = 0;
  bar1RefLow = 0;
  bar1ActivationPrice: number | null = null;
  bar1FormationDate: string | null = null;
  bar1RefHighDate: string | null = null;
  bar2RefHigh = 0;
  bar2RefLow = 0;
  frozenBar2RefHigh = 0;

  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;
}

/** Advances the nested BAR1/BAR2 cascade by one candle -- only ever called
 * once this window's own gate (TAR SL ever + RED1->RED2 ever, tracked by
 * the caller) has unlocked. See the module section comment above for the
 * confirmed formation/reactivation rules -- same shape as stepTarLevel
 * except BAR1's own bare SL is unrestricted, not gated. */
export function stepBar1Level(
  s: Bar1LevelState,
  prev: Day,
  cur: Day
): {
  opened: { price: number } | null;
  closed: { exitType: string; exitPrice: number } | null;
} {
  let opened: { price: number } | null = null;
  let closed: { exitType: string; exitPrice: number } | null = null;

  switch (s.mode) {
    case "SEEK_BAR1": {
      const floor = s.gateEstablished ? Math.max(prev.h, s.topRef) : prev.h;
      if (breakoutShape(prev, cur, floor)) {
        s.bar1RefHigh = cur.h;
        s.bar1RefLow = cur.l;
        s.bar1ActivationPrice = cur.h;
        s.bar1FormationDate = cur.date;
        s.bar1RefHighDate = cur.date;
        s.mode = "BAR1_ACTIVE";
      }
      break;
    }
    case "BAR1_ACTIVE": {
      if (breakoutShape(prev, cur, s.bar1RefHigh)) {
        const entryPrice = s.bar1RefHigh + THRESH;
        s.bar2RefHigh = cur.h;
        s.bar2RefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "BAR2_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      const slNow = slShape(cur, s.bar1RefLow);
      if (!slNow && cur.h > s.bar1RefHigh && cur.h - s.bar1RefHigh >= ANY) {
        s.bar1RefHigh = cur.h;
        s.bar1RefHighDate = cur.date;
      }
      if (!slNow && cur.l < s.bar1RefLow) s.bar1RefLow = cur.l;
      if (slNow) {
        // Bare, pre-escalation SL -- no row, same Filter-rule convention as
        // everywhere else; reforms immediately, but (once the original
        // gate is established) never below the running topRef -- see the
        // end-of-function ratchet.
        s.mode = "SEEK_BAR1";
      }
      break;
    }
    case "BAR2_ACTIVE": {
      if (cur.h > s.rowHH) {
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
      }
      const bar1SlNow = slShape(cur, s.bar1RefLow);
      const entrySlNow = slShape(cur, s.bar2RefLow);
      if (!bar1SlNow && cur.h > s.bar1RefHigh && cur.h - s.bar1RefHigh >= ANY) {
        s.bar1RefHigh = cur.h;
        s.bar1RefHighDate = cur.date;
      }
      if (!bar1SlNow && cur.l < s.bar1RefLow) s.bar1RefLow = cur.l;
      if (!entrySlNow && cur.h > s.bar2RefHigh && cur.h - s.bar2RefHigh >= ANY) s.bar2RefHigh = cur.h;
      if (!entrySlNow && cur.l < s.bar2RefLow) s.bar2RefLow = cur.l;

      if (bar1SlNow) {
        s.topRef = Math.max(s.topRef, s.bar1RefHigh, s.bar2RefHigh);
        s.gateEstablished = true;
        // Exit price is ALWAYS BAR 2's own (tighter) reference, same as the
        // clean case below, not BAR 1's own wider one -- see the identical
        // note on stepBarLevel's own BAR/BAR ENTRY pair above.
        const exitType = entrySlNow ? "DTF BAR 1 SL + DTF BAR 2 SL" : "DTF BAR 1 SL (wipes BAR 2)";
        closed = { exitType, exitPrice: s.bar2RefLow - THRESH };
        s.mode = "SEEK_REACTIVATION";
        break;
      }
      if (entrySlNow) {
        closed = { exitType: "DTF BAR 2 SL", exitPrice: s.bar2RefLow - THRESH };
        s.frozenBar2RefHigh = s.bar2RefHigh;
        s.mode = "SEEK_BAR2_REACTIVATION";
        break;
      }
      break;
    }
    case "SEEK_BAR2_REACTIVATION": {
      if (breakoutShape(prev, cur, s.frozenBar2RefHigh)) {
        const entryPrice = s.frozenBar2RefHigh + THRESH;
        s.bar2RefHigh = cur.h;
        s.bar2RefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "BAR2_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      const bgSlNow = slShape(cur, s.bar1RefLow);
      if (!bgSlNow && cur.h > s.bar1RefHigh && cur.h - s.bar1RefHigh >= ANY) {
        s.bar1RefHigh = cur.h;
        s.bar1RefHighDate = cur.date;
      }
      if (!bgSlNow && cur.l < s.bar1RefLow) s.bar1RefLow = cur.l;
      if (bgSlNow) {
        s.topRef = Math.max(s.topRef, s.bar1RefHigh, s.frozenBar2RefHigh);
        s.gateEstablished = true;
        s.mode = "SEEK_REACTIVATION";
      }
      break;
    }
    case "SEEK_REACTIVATION": {
      if (breakoutShape(prev, cur, s.topRef)) {
        s.bar1RefHigh = cur.h;
        s.bar1RefLow = cur.l;
        s.bar1ActivationPrice = cur.h;
        s.bar1FormationDate = cur.date;
        s.bar1RefHighDate = cur.date;
        s.mode = "BAR1_ACTIVE";
      }
      break;
    }
  }

  // Once the original gate is established, topRef ratchets with every high
  // reached since, in ANY mode -- it's checked against using the value as
  // of the START of this candle (above), then updated here for the next
  // one.
  if (s.gateEstablished && cur.h > s.topRef) s.topRef = cur.h;

  return { opened, closed };
}

/** True while ordinary BAR THEORY (TAR ENTRY, BAR 1 - BAR 2) must be
 * suppressed from the report -- every mode except the post-SL reactivation
 * race, where TAR/BAR2 are explicitly allowed to race against INVALID SAR
 * ENTRY's own reactivation. Moved here with the rest of BAR THEORY since it
 * only ever gated BAR THEORY's own rows -- primeTrend.ts's own INVALID
 * SAR/INVALID SAR ENTRY mechanism (which this takes as input) stays active
 * and unrelated to this gate. */
export function invalidSarSuppressesBarTheory(s: InvalidSarState | null): boolean {
  return s !== null && s.mode !== "SEEK_REACTIVATION";
}

// --------------------------------------------------------------------
// WTF BAR windowing -- the "WTF BAR active" precondition PBAR/PBAR ENTRY
// and TAR/TAR ENTRY/BAR1-BAR2 both ran under.
// --------------------------------------------------------------------

export interface WtfBarWindow {
  formationDate: string;
  endDate: string | null;
  endReason: "BAR SL" | "new BAR" | null;
  // The WTF BAR's own reference high AT FORMATION (that week's own known
  // High) -- the seed for DTF PBAR's own "Path 1" trigger (a straight
  // breakout above the WTF BAR's reference high, no RED required). Only a
  // seed, not the whole running value: a weekly-bar lookup climbs in WEEKLY
  // jumps and, worse, every day's own High is itself one of the inputs to
  // ITS OWN week's high, so "today's High > this week's own running high"
  // is structurally near-impossible intra-week -- same look-ahead trap
  // primeTrend.ts's preS1Ref was built to avoid. The caller (formerly
  // simulateDtfAll) climbed this seed quietly on each later DAY'S own High
  // directly, exactly like preS1Ref, never waiting for a further WTF week
  // to close first.
  formationHigh: number;
}

/** The WTF engine's own native "BAR(" milestone (lib/tzEngineWtf.ts's
 * RED1->RED2->BAR1 cascade, run on WEEKLY candles) formed by THIS
 * instance's own branch (matched by the WTF engine's own label convention,
 * `${letter}.${n}` -- lib/tzEngineWtf.ts's `nextBarLabel`), within this
 * instance's own window. This is the "WTF BAR" trigger for the DTF
 * PBAR/PBAR ENTRY ladder above. Each formation (first, or a later reform)
 * governs its own window, ending at EITHER that specific label's own
 * CONFIRMED "BAR SL(label)" (the WTF engine's own `^BAR SL\(` anchor
 * excludes a later "INVALID BAR SL(label)" -- confirmed: a provisional WTF
 * BAR SL that the engine itself later retracts still counts as a real
 * failure for PBAR purposes, requiring a brand new DTF RED1 once the label
 * reforms -- verified against real COCHINSHIP.NS data, where WTF BAR(B.1)
 * SL'd 22/05/23, got marked "INVALID" and reformed 29/05/23, and DTF only
 * resumed seeking via a fresh RED1 on 07/06/23, not immediately off the
 * already-unlocked pre-22/05 door) OR a fresh "BAR(" formation line,
 * whichever comes first -- same shape as lib/tarTbar.ts's own
 * `findWindows`, just scoped to this one instance's own letter and date
 * bounds rather than scanned globally. "WTF BAR active" (the continuous
 * precondition for PBAR/PBAR ENTRY, alongside WTF TZ BUY 2 and "DTF BAR
 * ENTRY inactive") means "within one of these windows, before its own
 * endDate". */
export function wtfBarWindowsForLetter(
  wtfTrace: WtfTraceEntry[],
  letter: string,
  formationDate: string,
  endDate: string
): WtfBarWindow[] {
  // A "BAR(letter.N)" label only counts as a REAL formation -- one that
  // supersedes whatever was governing before and reseeds the reference --
  // if it is actually backed by one of the three causal paths confirmed:
  // (a)/(b) a genuine RED2(letter) confirmed since the last real formation
  // (whatever it resolves to afterward, INVALID SAR/ INVALID SAR ENTRY or
  // SAR 2, doesn't matter here -- RED2 having fired at all is what
  // matters), or (c) a reform of that SAME number after its OWN prior "BAR
  // SL(letter.N)". A "BAR(" label that is neither -- the WTF engine's own
  // RED1 getting invalidated (RED1 HH) before ever reaching RED2, which
  // still throws off a "BAR(" label -- is not a real formation and must be
  // ignored outright, not treated as super ceding anything. Confirmed via
  // COCHINSHIP: BAR(B.3) on 2025-04-15 is preceded by RED1(B) 04-01 ->
  // RED1 LL(B) 04-07 -> RED1 HH(B) [invalidated, no RED2 ever confirmed] +
  // BAR(B.3) same day -- not real. Ignoring it, BAR(B.2) (formed
  // 2025-03-17, backed by its own prior BAR SL(B.2) reform) stays the sole
  // governing window straight through to TAR's real 2025-04-29 formation,
  // exactly as walked through by hand -- no gap. Confirmed via DIXON:
  // BAR(A.2) on 2021-08-30 IS real (RED1(A) 07-26 -> RED1 LL(A) 08-09 ->
  // RED2(A) 08-16, genuinely confirmed) -- it legitimately supersedes
  // BAR(A.1) (open since 2020-03-02, never itself SL'd), reseeding the
  // reference down to A.2's own (lower) formation high, exactly as needed
  // for the confirmed 2021-10-01 TAR ENTRY.
  const formRe = new RegExp(`^BAR\\(${letter}\\.(\\d+)\\)$`);
  const slRe = new RegExp(`^BAR SL\\(${letter}\\.(\\d+)\\)$`);
  const red2Label = `RED2(${letter})`;

  const windows: WtfBarWindow[] = [];
  let currentN: number | null = null;
  let currentFormationDate: string | null = null;
  let currentFormationHigh = 0;
  let sawRed2SinceLastRealFormation = false;
  // The WTF engine REUSES number labels across unrelated instances (not a
  // stable per-lineage identity) -- so "reform of its own prior SL" only
  // counts if THIS is the very next "BAR(" event after that exact SL, with
  // nothing else forming in between. A single most-recent value, not a
  // historical set: confirmed via COCHINSHIP, where "BAR(B.3)" closed
  // 2025-01-06 and the label "3" is reused again on 2025-04-15 for a wholly
  // unrelated, non-real formation -- treating that as "reforming" the
  // January one (a persistent per-number set would) is exactly the bug that
  // let it wrongly supersede BAR(B.2).
  let lastClosedN: number | null = null;
  // Whether the MOST RECENT "BAR(letter.N)" occurrence for each number was
  // itself validated real -- an SL for N only sets lastClosedN if N's
  // latest formation was real. Without this, a SL on a number whose latest
  // formation was spurious (e.g. the ignored 2025-04-15 one) would still
  // look like a legitimate close, letting label reuse validate a LATER
  // spurious reform of the same number (confirmed via COCHINSHIP:
  // "BAR(B.3)" reappears 2025-05-12, again with no RED2 backing it, and
  // must be rejected again, not treated as reforming either the real
  // December B.3 or the already-rejected April one).
  const lastFormationWasReal = new Map<number, boolean>();

  for (const { day, events } of wtfTrace) {
    if (day.date <= formationDate || day.date > endDate) continue;
    for (const e of events) {
      if (e === red2Label) {
        sawRed2SinceLastRealFormation = true;
        continue;
      }
      const fm = e.match(formRe);
      if (fm) {
        const n = Number(fm[1]);
        const isReal = n === lastClosedN || sawRed2SinceLastRealFormation;
        lastClosedN = null; // any "BAR(" event, real or not, consumes reform eligibility
        lastFormationWasReal.set(n, isReal);
        if (!isReal) continue; // spurious "BAR(" label -- ignore outright
        if (currentN !== n && currentFormationDate !== null) {
          windows.push({ formationDate: currentFormationDate, endDate: day.date, endReason: "new BAR", formationHigh: currentFormationHigh });
        }
        currentN = n;
        currentFormationDate = day.date;
        currentFormationHigh = day.h;
        sawRed2SinceLastRealFormation = false;
        continue;
      }
      const sm = e.match(slRe);
      if (sm) {
        const n = Number(sm[1]);
        if (lastFormationWasReal.get(n)) lastClosedN = n;
        if (currentN === n) {
          windows.push({ formationDate: currentFormationDate as string, endDate: day.date, endReason: "BAR SL", formationHigh: currentFormationHigh });
          currentN = null;
          currentFormationDate = null;
        }
        continue;
      }
    }
  }
  if (currentFormationDate !== null) {
    windows.push({ formationDate: currentFormationDate, endDate: null, endReason: null, formationHigh: currentFormationHigh });
  }
  return windows;
}
