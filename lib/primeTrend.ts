// PRIME TREND -- the DTF-with-respect-to-WTF cross-timeframe follow-up
// theory, built on top of TZ BUY (tzEngineWtf.ts). See
// PRIME_TREND_RULEBOOK.md for the full specification. This module does
// NOT modify or extend TZEngine -- it's a separate, dependent consumer: it
// runs TZEngine once over the WTF series to get the WTF event trace
// (alongside a snapshot of each branch's own "2"-tier reference low before
// every candle -- needed to resolve the exact WTF-side exit price), then
// walks the DTF series on its own using that trace as an anchor.
//
// Anchors off THREE WTF-side tiers, not just TZ BUY 2: TZ BUY 2, REAR 2,
// and REAR RE-ENTER 2 all get the identical treatment, since the engine
// itself treats REAR 2 and REAR RE-ENTER 2 as "TZ BUY 2 variant"s
// throughout (same decisive own-SL, same "whichever is higher" self-
// recovery, same BAR-family attachment).
//
// Originally a direct, faithful port of prime_trend.py (Python dev branch
// claude/epic-darwin-pxs5s3), verified against real ADANIENT.NS and
// ICICIBANK.NS WTF+DTF data (see test_prime_trend_smoke.py in the Python
// source tree) -- that was Stage 1 (DTF TZ BUY) escalating directly to
// Stage 2 (a plain-breakout "DTF TZ BUY ENTRY") via no RED gate at all.
//
// REVISED: "DTF TZ BUY ENTRY" is no longer applicable. Stage 1 (DTF TZ
// BUY) is unchanged -- still the mandatory, unconditional breakout above
// WTF's own anchor reference -- but it no longer escalates directly.
// Instead, once Stage 1 is active, it needs its own retracement (RED1,
// or RED1-RED2) before a DTF BAR can form; BAR then escalates to BAR
// ENTRY by clearing its own reference high, and BAR ENTRY (not TZ BUY
// ENTRY) is now what "PRIME TREND confirmed" means. This is structurally
// the same grammar as lib/tarTbar.ts's TAR/TBAR (continuous RED1->RED2
// tracker, parent/child dependency, nested BAR1/BAR2 routine phase), but
// with a corrected, simpler REAR-escalation rule -- see the BAR/BAR
// ENTRY section below, and PRIME_TREND_RULEBOOK.md for the full
// derivation. TZ BUY's own SL still wipes the whole BAR/BAR ENTRY
// structure outright ("active TZ BUY is mandatory"), and TZ BUY's own
// reactivation (above its own earlier reference high, unchanged) starts
// a brand new BAR/BAR ENTRY window from scratch every time.
//
// DTF PBAR / PBAR ENTRY -- a SECOND, independent route to the same
// "PRIME TREND confirmed" goal, alongside the BAR/BAR ENTRY ladder
// above. Structurally the SAME continuous-RED1->RED2-tracker shape as
// BAR/BAR ENTRY (own PbarLevelState/stepPbarLevel below, mirroring
// lib/tarTbar.ts's TAR/TBAR mechanics closely -- see that module's own
// header for the shared derivation) -- but NOT a reuse of that module:
// "TAR"/"TBAR" are reserved for the separate BAR theory
// (lib/tarTbar.ts's own consumer); PRIME TREND's names are "PBAR"
// (tier 1) / "PBAR ENTRY" (tier 2).
//
// Gate for STARTING this ladder at a given qualifying WTF BAR (this
// instance's own branch, same RED1->RED2->BAR1 cascade): DTF BAR ENTRY
// must NOT be currently active at that moment. Nothing else about DTF's
// own TZ BUY/BAR/BAR ENTRY state matters -- occurred or never occurred,
// active or not, confirmed-then-SL'd -- only BAR ENTRY's CURRENT state.
// Checked at each qualifying WTF BAR under this instance's letter, in
// order, until one passes. CRITICALLY, once started, the ladder runs
// CONTINUOUSLY for the rest of this instance's own window -- it does NOT
// restart or get abandoned at a LATER WTF BAR reform under the same
// letter (confirmed via real COCHINSHIP.NS data: the WTF side's own BAR
// SL(label) and BAR(label) reform, a few days apart, did not interrupt
// the DTF-side PBAR ladder's own continuous SEEK_PBAR -> PBAR_ACTIVE ->
// PBAR SL -> PBAR_ACTIVE -> PBAR_ENTRY_ACTIVE progression at all -- it
// just kept running through that WTF-side noise). DTF starts watching
// from the day after the qualifying WTF BAR's own formation date, same
// "day after formation" convention lib/tarTbar.ts uses.
//
// PBAR (tier 1)'s own bare, pre-escalation SL ALWAYS reforms unrestricted
// (plain day-over-day breakout, no reference to clear first) -- same as
// BAR's own bare SL. A clean PBAR ENTRY SL (PBAR itself not also
// breached) reforms PBAR ALONE first -- unlike BAR ENTRY's own clean-SL
// handling, there is no direct PBAR-ENTRY-level reactivation -- gated
// above the running top reference if the door (full RED1-RED2) hasn't
// opened yet, or immediately/unrestricted if it has. A decisive PBAR SL
// (PBAR's own reference also breached, wiping PBAR ENTRY with it)
// reforms gated above the PBAR ENTRY reference high -- the
// full-RED1-RED2-gated escalation past a decisive SL (this module's
// analogue of lib/tarTbar.ts's own REAR) is DEFERRED for now, same
// entry-only-scope precedent as BAR/BAR ENTRY's own deferred REAR.
//
// So in total there are 3 named ways PRIME TREND confirms an entry: BAR
// ENTRY, and PBAR ENTRY (from this ladder) -- with TAR ENTRY reserved as
// a separate BAR-theory concept, not a PRIME TREND one.
//
// WTF BAR itself needs no separate name here -- it's the same WTF-native
// "BAR(label)" milestone in every one of the "3 types of bar theory"
// (Type 2: WTF BAR after a DTF SAR exit -> TAR/TBAR, lib/tarTbar.ts,
// structurally mirrored but NOT reused above; Type 3: WTF RED2 with no
// DTF SAR -> unrestricted nested BAR1/BAR2, not yet implemented) -- what
// differs is only the DTF-side response.

import { ANY, branchLabel, Day, EPS, THRESH, TZEngine, ParentCycle, type HiddenEventLogEntry } from "./tzEngineWtf";

export type PrimeTrendFamily = "TZ BUY 2" | "REAR 2" | "REAR RE-ENTER 2";

export interface PrimeTrendResult {
  family: PrimeTrendFamily;
  letter: string;
  wtfFormationDate: string;
  // level 0 = BAR ENTRY itself, 1 = REAR ENTRY, 2+ = REAR RE-ENTER
  // (collapsed); "side" names which of those this row is, or "BAR2" for
  // the nested BAR1->BAR2 cycle's own row (see the BAR/BAR ENTRY section
  // below) -- a BAR2 row OVERLAPS its enclosing level's own row rather
  // than replacing it. "PBAR ENTRY" is the WTF-BAR-anchored ladder's own
  // tier 2 (see the DTF PBAR / PBAR ENTRY section above) -- level is
  // always 0 for now (its escalation past a decisive SL is deferred, see
  // that section).
  level: number;
  side:
    | "BAR ENTRY"
    | "REAR ENTRY"
    | "REAR RE-ENTER"
    | "BAR2"
    | "PBAR ENTRY"
    | "TAR ENTRY"
    | "BAR 1 - BAR 2"
    | "INVALID SAR ENTRY";
  entryDate: string;
  entryPrice: number;
  exitType: string;
  exitDate: string;
  exitPrice: number | null;
  highestHigh: number | null;
  highestHighDate: string | null;
}

/** A live/right-now snapshot of one currently-open WTF anchor instance's
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
  family: PrimeTrendFamily;
  letter: string;
  stage1Active: boolean;
  stage1Since: string | null;
  stage1ActivationPrice: number | null;
  // The stage's own live SL level -- i.e. Stage.refLow while active. Not a
  // fixed value: it ratchets down to a new, lower reference low as the
  // stage progresses (see the `if (cur.l < s1.refLow) s1.refLow = cur.l`
  // step below), so this is always "the SL price as of right now", not a
  // one-time snapshot the way stage1ActivationPrice is.
  stage1StopLoss: number | null;
  stage1HighestHigh: number | null;
  stage1HighestHighDate: string | null;
  // BAR (tier 1 of the DTF-TZ-BUY-anchored ladder) currently active --
  // i.e. BarLevelState.mode === "BAR_ACTIVE" on the main ("BAR") track.
  // Distinct from stage2Active (BAR ENTRY, tier 2): a stock can be here
  // without ever having reached BAR ENTRY yet.
  barActive: boolean;
  barSince: string | null;
  barActivationPrice: number | null;
  barStopLoss: number | null;
  barHighestHigh: number | null;
  barHighestHighDate: string | null;
  // "Stage 2" = BAR ENTRY (or REAR ENTRY / REAR RE-ENTER, same tier one
  // level up) currently active.
  stage2Active: boolean;
  stage2Since: string | null;
  stage2ActivationPrice: number | null;
  stage2StopLoss: number | null;
  stage2HighestHigh: number | null;
  stage2HighestHighDate: string | null;
  // The WTF-BAR-anchored DTF PBAR/PBAR ENTRY ladder (see the DTF PBAR /
  // PBAR ENTRY section above) -- gated at its own starting WTF BAR on
  // "DTF BAR ENTRY not currently active then", but runs continuously and
  // independently of Stage 1/Stage 2 from that point on, for the rest of
  // this instance's own window.
  // Tier 1 (PBAR itself) currently active -- not yet escalated to PBAR
  // ENTRY.
  pbarTier1Active: boolean;
  pbarTier1Since: string | null;
  pbarTier1ActivationPrice: number | null;
  pbarTier1StopLoss: number | null;
  pbarTier1HighestHigh: number | null;
  pbarTier1HighestHighDate: string | null;
  // Tier 2 -- PBAR ENTRY -- currently active (a confirmed entry is open
  // right now).
  pbarActive: boolean;
  pbarSince: string | null;
  pbarActivationPrice: number | null;
  pbarStopLoss: number | null;
  pbarHighestHigh: number | null;
  pbarHighestHighDate: string | null;
}

// --------------------------------------------------------------------
// Stage 1 / Stage 2 state (mirrors Buy/Bar2's own ref_high/ref_low shape)
// --------------------------------------------------------------------

class Stage {
  active = true;
  frozenRef: number | null = null;
  entryRatchet: number; // tracks the NEXT tier's own escalation ladder (Stage 1 -> Stage 2's ladder, Stage 2 -> Stage 3's, etc.)
  constructor(public refHigh: number, public refLow: number) {
    this.entryRatchet = refHigh;
  }
}

export function breakoutShape(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

export function slShape(cur: Day, refLow: number): boolean {
  return cur.l < refLow && refLow - cur.l >= THRESH - EPS && cur.c <= refLow + EPS;
}

// --------------------------------------------------------------------
// BAR / BAR ENTRY -- DTF TZ BUY's own continuation ladder, replacing the
// old plain-breakout "DTF TZ BUY ENTRY" (Stage 2). Mirrors
// lib/tarTbar.ts's TAR/TBAR mechanics closely (same continuous
// RED1->RED2 tracker, same parent/child dependency, same nested
// BAR1/BAR2 "routine" phase) -- just anchored on DTF TZ BUY itself
// instead of a WTF BAR milestone, and freshly (re)created every time
// Stage 1 (TZ BUY) itself (re)forms: "active TZ BUY is mandatory" -- TZ
// BUY's own SL wipes this whole structure outright, requiring TZ BUY's
// own mandatory reactivation (above its own earlier reference high,
// unchanged Stage 1 behavior) before a brand new BAR/BAR ENTRY window
// can start. See PRIME_TREND_RULEBOOK.md for the full derivation.
//
// PRIME TREND now only confirms once BAR ENTRY (or REAR ENTRY / REAR
// RE-ENTER) is active -- a bare BAR (tier 1, pre-escalation) alone is
// never reported as a PRIME TREND entry, same filter rule as before, now
// applied one tier later.
//
// DECISIVE BAR SL (entry-only scope -- REAR deferred for now): whenever
// BAR's own level fails while BAR ENTRY is (or was) escalated under it
// -- BAR ENTRY cannot outlive BAR, since it's an escalation of BAR;
// "BAR SL" always means BAR ENTRY is gone too, whether both breach the
// same candle (combined) or BAR ENTRY's own (tighter) stop breached
// first and BAR's own (looser) stop gives way later (sequential, via
// SEEK_BAR_ENTRY_REACTIVATION below). Either way, a fresh BAR reforms
// directly -- above the BAR ENTRY reference high this structure
// reached, not unrestricted the way a pre-escalation BAR SL is -- then
// escalates to BAR ENTRY again the ordinary way, on its own later
// breakout. (Clean BAR ENTRY SL -- BAR independently still valid, not
// decisive -- is a separate case below: BAR ENTRY itself reactivates
// directly, racing against BAR's own SL turning decisive instead.)
class BarRedGate {
  constructor(public refHigh: number, public refLow: number) {}
}
function stepBarRed(red: BarRedGate, prev: Day, cur: Day): "confirmed" | "invalid" | "continuing" {
  if (cur.h > red.refHigh && cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) return "invalid";
  if (cur.h > red.refHigh) red.refHigh = cur.h;
  if (cur.l < red.refLow) {
    const red2Holds = cur.h <= prev.h && red.refLow - cur.l >= THRESH - EPS && cur.c <= red.refLow + EPS;
    if (red2Holds) return "confirmed";
    red.refLow = cur.l;
  }
  return "continuing";
}
function isBarRed1Shape(prev: Day, cur: Day): boolean {
  return cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l;
}

type BarMode =
  | "SEEK_LEVEL_ENTRY"
  | "SEEK_BAR"
  | "BAR_ACTIVE"
  | "BAR_ENTRY_ACTIVE"
  | "SEEK_BAR_ENTRY_REACTIVATION"
  | "SEEK_REACTIVATION";

function sideForBarLevel(level: number): "BAR ENTRY" | "REAR ENTRY" | "REAR RE-ENTER" {
  return level === 0 ? "BAR ENTRY" : level === 1 ? "REAR ENTRY" : "REAR RE-ENTER";
}

class BarLevelState {
  mode: BarMode;
  level: number;
  doorOpen = false;
  // Separate from `doorOpen`: whether a FRESH RED1->RED2 has confirmed
  // specifically while THIS BAR ENTRY instance was already active -- the
  // nested BAR1/BAR2 cascade needs its own dedicated post-formation
  // RED1-RED2, not just reliance on `doorOpen` possibly having gone true
  // earlier (even before BAR itself formed). Same shape as the WTF
  // engine's own TZ BUY2 -> RED1-RED2 -> BAR1 cascade. Reset to false
  // every time a fresh BAR ENTRY forms.
  nestedDoorOpen = false;
  red: BarRedGate | null = null;
  everSawRed1 = false; // persists even after `red` resolves -- unlocks BAR-seeking permanently
  topRef: number;

  barRefHigh = 0;
  barRefLow = 0;
  barActivationPrice: number | null = null; // fixed snapshot at BAR's own formation
  // The date BAR (tier 1) most recently (re)formed -- for the live
  // screener's own "BAR"/"PBAR" tab (distinct from rowEntryDate, which is
  // tier 2's own formation date). barRefHighDate tracks when barRefHigh
  // was last set, whether at formation or a later quiet climb -- so it
  // always equals "the date of the running Highest High since formation",
  // same convention as rowHH/rowHHDate for tier 2.
  barFormationDate: string | null = null;
  barRefHighDate: string | null = null;
  barEntryRefHigh = 0;
  barEntryRefLow = 0;

  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;

  nestedMode: "NONE" | "SEEK_BAR1" | "BAR1_ACTIVE" | "BAR2_ACTIVE" = "NONE";
  nestedRefHigh = 0;
  nestedRefLow = 0;
  nestedEntryDate: string | null = null;
  nestedEntryPrice: number | null = null;
  nestedHH = 0;
  nestedHHDate: string | null = null;

  constructor(level: number, topRefFloor: number | null) {
    this.level = level;
    this.topRef = topRefFloor ?? 0;
    this.mode = topRefFloor === null ? "SEEK_BAR" : "SEEK_LEVEL_ENTRY";
  }
}

/** Advances one BAR/BAR ENTRY level by one candle -- see lib/tarTbar.ts's
 * `stepLevel` for the closely-related mechanics this mirrors (that
 * file's own module docstring documents the shared derivation).
 * `opened`/`closed` are this level's own BAR ENTRY row lifecycle;
 * `nestedClosed` is the nested BAR1->BAR2 cycle's own row (gets its own
 * visible row, overlapping this level's own row).
 *
 * REAR is deferred for now (entry-only scope) -- a decisive BAR SL
 * (BAR's own SL, which always wipes BAR ENTRY with it) always reforms
 * directly, never escalates. Confirmed event chains, DTF-side only:
 *   TZ BUY -> TZ BUY SL -> TZ BUY (reactivates above TZ BUY's own
 *     highest reference high -- unchanged Stage 1 behavior).
 *   BAR -> BAR SL (pre-escalation, never reached BAR ENTRY) -> BAR
 *     (unrestricted -- a plain day-over-day breakout, no reference to
 *     clear first; "it can occur immediately").
 *   BAR -> BAR ENTRY -> BAR ENTRY SL (clean -- BAR itself not also
 *     breached) -> BAR ENTRY (direct, single breakout above BAR
 *     ENTRY's own frozen reference high -- see
 *     SEEK_BAR_ENTRY_REACTIVATION below). While waiting, BAR's own
 *     reference stays alive in the background; if BAR's own SL
 *     triggers first instead, that's the decisive case below.
 *   BAR -> BAR ENTRY -> BAR ENTRY SL -> BAR SL (combined same candle,
 *     or BAR ENTRY SL first then BAR SL follows later -- either way,
 *     once BAR itself is also gone) -> BAR (reforms above the
 *     *BAR ENTRY* reference high, not unrestricted like the
 *     pre-escalation case -- see SEEK_REACTIVATION below) -> BAR ENTRY
 *     (ordinary escalation above this new BAR's own reference high).
 * Every "reference high" above is the running highest high reached
 * since that tier's own formation/reactivation, continuously updated by
 * quiet-climb tracking -- never just the literal high on the day it
 * first formed. */
function stepBarLevel(
  s: BarLevelState,
  prev: Day,
  cur: Day
): {
  opened: { price: number } | null;
  closed: { exitType: string; exitPrice: number } | null;
  nestedClosed: { entryDate: string; entryPrice: number; exitPrice: number; hh: number; hhDate: string } | null;
} {
  let opened: { price: number } | null = null;
  let closed: { exitType: string; exitPrice: number } | null = null;
  let nestedClosed: { entryDate: string; entryPrice: number; exitPrice: number; hh: number; hhDate: string } | null = null;

  if (s.mode === "SEEK_LEVEL_ENTRY") {
    if (breakoutShape(prev, cur, s.topRef)) {
      s.topRef = Math.max(s.topRef, cur.h);
      s.mode = "SEEK_BAR";
    }
    return { opened, closed, nestedClosed };
  }

  // --- the one continuous RED1->RED2 tracker, independent of BAR/BAR ENTRY state ---
  if (s.red === null) {
    if (isBarRed1Shape(prev, cur)) {
      s.red = new BarRedGate(cur.h, cur.l);
      s.everSawRed1 = true;
    }
  } else {
    const result = stepBarRed(s.red, prev, cur);
    if (result === "confirmed") {
      s.red = null;
      s.doorOpen = true;
      if (s.mode === "BAR_ENTRY_ACTIVE") s.nestedDoorOpen = true;
    } else if (result === "invalid") {
      s.red = null;
    }
  }

  switch (s.mode) {
    case "SEEK_BAR": {
      if (!s.everSawRed1) break;
      if (breakoutShape(prev, cur, prev.h)) {
        s.barRefHigh = cur.h;
        s.barRefLow = cur.l;
        s.barActivationPrice = cur.h;
        s.barFormationDate = cur.date;
        s.barRefHighDate = cur.date;
        s.mode = "BAR_ACTIVE";
      }
      break;
    }
    case "BAR_ACTIVE": {
      if (breakoutShape(prev, cur, s.barRefHigh)) {
        // Ladder entry price: barRefHigh as it stood before this candle, +
        // THRESH -- same convention as every other tier1->tier2 formation.
        const entryPrice = s.barRefHigh + THRESH;
        s.topRef = Math.max(s.topRef, cur.h);
        s.barEntryRefHigh = cur.h;
        s.barEntryRefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "BAR_ENTRY_ACTIVE";
        // Fresh BAR ENTRY instance -- the nested cascade needs its own
        // dedicated post-formation RED1-RED2, not a stale doorOpen from
        // possibly before BAR itself even formed.
        s.nestedDoorOpen = false;
        s.nestedMode = "NONE";
        opened = { price: entryPrice };
        break;
      }
      const slNow = slShape(cur, s.barRefLow);
      if (!slNow && cur.h > s.barRefHigh && cur.h - s.barRefHigh >= ANY) {
        s.barRefHigh = cur.h;
        s.barRefHighDate = cur.date;
      }
      if (!slNow && cur.l < s.barRefLow) s.barRefLow = cur.l;
      if (slNow) {
        s.topRef = Math.max(s.topRef, s.barRefHigh);
        s.mode = "SEEK_BAR"; // pre-escalation SL: always unrestricted, no gate needed again
      }
      break;
    }
    case "BAR_ENTRY_ACTIVE": {
      if (cur.h > s.rowHH) {
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
      }
      const barSlNow = slShape(cur, s.barRefLow);
      const entrySlNow = slShape(cur, s.barEntryRefLow);
      if (!barSlNow && cur.h > s.barRefHigh && cur.h - s.barRefHigh >= ANY) {
        s.barRefHigh = cur.h;
        s.barRefHighDate = cur.date;
      }
      if (!barSlNow && cur.l < s.barRefLow) s.barRefLow = cur.l;
      if (!entrySlNow && cur.h > s.barEntryRefHigh && cur.h - s.barEntryRefHigh >= ANY) s.barEntryRefHigh = cur.h;
      if (!entrySlNow && cur.l < s.barEntryRefLow) s.barEntryRefLow = cur.l;

      if (barSlNow) {
        // Decisive: BAR's own SL always means BAR ENTRY is gone too --
        // BAR ENTRY is an escalation of BAR, it cannot outlive it --
        // whether both breach the same candle (combined) or BAR ENTRY's
        // own tighter stop already breached first and BAR's own looser
        // stop gives way later (sequential, via SEEK_BAR_ENTRY_
        // REACTIVATION below). Reforms via SEEK_REACTIVATION -- above
        // the BAR ENTRY reference high, not unrestricted (REAR is
        // deferred for now: entry-only scope, no promotion). Exit price
        // is ALWAYS BAR ENTRY's own (tighter) reference, same as the
        // clean case below, not BAR's own wider one -- whether both
        // breach the same candle or not, the trade's own exit is defined
        // by its own entry-level stop; the "BAR SL" half of a combined
        // event is a structural signal for how reformation proceeds, not
        // a different exit price. Modeled at the exact qualifying
        // threshold distance below that reference (same "ref +/- THRESH"
        // convention entry price already uses), not the literal Low of
        // the SL day. Confirmed exact match via KALYANKJIL (ref 117.70 ->
        // exit 117.50) and COCHINSHIP (ref 266.50 -> exit 266.30).
        s.topRef = Math.max(s.topRef, s.barRefHigh, s.barEntryRefHigh);
        const exitType = entrySlNow ? "DTF BAR SL + DTF BAR ENTRY SL" : "DTF BAR SL (wipes ENTRY)";
        closed = { exitType, exitPrice: s.barEntryRefLow - THRESH };
        s.mode = "SEEK_REACTIVATION";
        s.nestedMode = "NONE";
        break;
      }
      if (entrySlNow) {
        // Clean: BAR itself not also breached -- stays alive in the
        // background. Races BAR ENTRY's own direct reactivation against
        // BAR's own (now decisive, if it comes first) SL -- see
        // SEEK_BAR_ENTRY_REACTIVATION below.
        closed = { exitType: "DTF BAR ENTRY SL", exitPrice: s.barEntryRefLow - THRESH };
        s.mode = "SEEK_BAR_ENTRY_REACTIVATION";
        s.nestedMode = "NONE";
        break;
      }

      // --- nested BAR1/BAR2 "routine" phase, once THIS BAR ENTRY's own
      // fresh post-formation RED1-RED2 has confirmed (not just doorOpen,
      // which may have gone true earlier, even before BAR formed) ---
      if (s.nestedDoorOpen && s.nestedMode === "NONE") s.nestedMode = "SEEK_BAR1";
      if (s.nestedMode === "SEEK_BAR1") {
        if (breakoutShape(prev, cur, prev.h)) {
          s.nestedRefHigh = cur.h;
          s.nestedRefLow = cur.l;
          s.nestedMode = "BAR1_ACTIVE";
        }
      } else if (s.nestedMode === "BAR1_ACTIVE") {
        if (breakoutShape(prev, cur, s.nestedRefHigh)) {
          const nestedEntryPrice = s.nestedRefHigh + THRESH;
          s.nestedRefHigh = cur.h;
          s.nestedRefLow = cur.l;
          s.nestedEntryDate = cur.date;
          s.nestedEntryPrice = nestedEntryPrice;
          s.nestedHH = cur.h;
          s.nestedHHDate = cur.date;
          s.nestedMode = "BAR2_ACTIVE";
        } else {
          const nSlNow = slShape(cur, s.nestedRefLow);
          if (!nSlNow && cur.h > s.nestedRefHigh && cur.h - s.nestedRefHigh >= ANY) s.nestedRefHigh = cur.h;
          if (!nSlNow && cur.l < s.nestedRefLow) s.nestedRefLow = cur.l;
          if (nSlNow) s.nestedMode = "SEEK_BAR1";
        }
      } else if (s.nestedMode === "BAR2_ACTIVE") {
        if (cur.h > s.nestedHH) {
          s.nestedHH = cur.h;
          s.nestedHHDate = cur.date;
        }
        const nSlNow = slShape(cur, s.nestedRefLow);
        if (!nSlNow && cur.h > s.nestedRefHigh && cur.h - s.nestedRefHigh >= ANY) s.nestedRefHigh = cur.h;
        if (!nSlNow && cur.l < s.nestedRefLow) s.nestedRefLow = cur.l;
        if (nSlNow) {
          // Door already open, unrestricted reform at the SAME level
          // (does not promote). Gets its own visible row, overlapping the
          // still-open outer BAR ENTRY/REAR ENTRY row.
          nestedClosed = {
            entryDate: s.nestedEntryDate as string,
            entryPrice: s.nestedEntryPrice as number,
            exitPrice: s.nestedRefLow,
            hh: s.nestedHH,
            hhDate: s.nestedHHDate as string,
          };
          s.nestedMode = "SEEK_BAR1";
        }
      }
      break;
    }
    case "SEEK_BAR_ENTRY_REACTIVATION": {
      // Clean BAR ENTRY SL's own aftermath -- a race between two
      // outcomes, whichever breaks first:
      //   (a) price reclaims BAR ENTRY's own frozen reference high (as
      //       it stood at the moment of that SL -- not updated further
      //       while waiting here, same as any other closed tier) ->
      //       BAR ENTRY reactivates DIRECTLY, a single breakout, no
      //       intermediate BAR reform step.
      //   (b) BAR's own reference low (kept alive/tracked in the
      //       background, exactly as if nothing had happened to it)
      //       breaks first instead -> NOW decisive, same as a combined
      //       BAR SL + BAR ENTRY SL -- falls through to the ordinary
      //       SEEK_REACTIVATION path (reforms above the BAR ENTRY
      //       reference high, not unrestricted).
      if (breakoutShape(prev, cur, s.barEntryRefHigh)) {
        const entryPrice = s.barEntryRefHigh + THRESH;
        s.barEntryRefHigh = cur.h;
        s.barEntryRefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "BAR_ENTRY_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      const barSlNow = slShape(cur, s.barRefLow);
      if (!barSlNow && cur.h > s.barRefHigh && cur.h - s.barRefHigh >= ANY) {
        s.barRefHigh = cur.h;
        s.barRefHighDate = cur.date;
      }
      if (!barSlNow && cur.l < s.barRefLow) s.barRefLow = cur.l;
      if (barSlNow) {
        s.topRef = Math.max(s.topRef, s.barRefHigh, s.barEntryRefHigh);
        s.mode = "SEEK_REACTIVATION";
      }
      break;
    }
    case "SEEK_REACTIVATION": {
      // Reactivation reforms BAR alone -- BAR and BAR ENTRY can never
      // form on the same candle (only an SL/exit can be a combined
      // event). This just clears the running top reference and drops
      // back into the ordinary BAR_ACTIVE state; BAR ENTRY only
      // escalates later, on a later candle, via BAR_ACTIVE's own
      // already-correct escalation path above.
      if (breakoutShape(prev, cur, s.topRef)) {
        s.topRef = Math.max(s.topRef, cur.h);
        s.barRefHigh = cur.h;
        s.barRefLow = cur.l;
        s.barActivationPrice = cur.h;
        s.barFormationDate = cur.date;
        s.barRefHighDate = cur.date;
        s.mode = "BAR_ACTIVE";
      } else if (cur.h > s.topRef) {
        s.topRef = cur.h;
      }
      break;
    }
  }

  return { opened, closed, nestedClosed };
}

// --------------------------------------------------------------------
// DTF PBAR / PBAR ENTRY -- see this module's own header comment for the
// full derivation. Structurally mirrors BAR/BAR ENTRY's own continuous
// RED1->RED2 tracker (reuses BarRedGate/stepBarRed/isBarRed1Shape
// directly -- same formulas, no need to duplicate), but simpler: no
// leveling/promotion (REAR-equivalent escalation deferred), no nested
// BAR1/BAR2 routine phase (also deferred), and a clean PBAR ENTRY SL
// reforms PBAR (tier 1) alone rather than reactivating PBAR ENTRY
// directly -- unlike BAR ENTRY's own clean-SL handling.
// --------------------------------------------------------------------

type PbarMode =
  | "SEEK_PBAR"
  | "PBAR_ACTIVE"
  | "PBAR_ENTRY_ACTIVE"
  | "SEEK_PBAR_ENTRY_REACTIVATION"
  | "SEEK_REACTIVATION";

// How the CURRENTLY living PBAR (tier 1, or tier 1+2) was itself most
// recently formed -- NONE (Path 1: straight breakout above the WTF BAR's
// own reference high, no RED at all), RED1 (Path 2: a single RED), or
// RED1_RED2 (Path 3: the fast lane itself, a completed RED1->RED2).
// Confirmed: a combined PBAR SL's own fast-lane eligibility depends on
// this -- birthed on RED1_RED2 already means the strongest trigger is
// already spent, no further shortcut available; birthed on RED1 needs a
// FRESH RED1->RED2 (stronger than what birthed it) to fast-lane again;
// birthed on NONE is the weakest, so either a fresh RED1 or RED1->RED2
// fast-lanes it. Resets to NONE on every gated (non-fast-lane) reform, so
// the next instance's own fast-lane eligibility starts fresh.
type PbarBirthTier = "NONE" | "RED1" | "RED1_RED2";

class PbarLevelState {
  mode: PbarMode = "SEEK_PBAR";
  // Path 1 is spent once per window -- confirmed: once used to form
  // PBAR, every later reform falls onto the ordinary RED-gated/ladder-
  // position rules below, never back to re-clearing the WTF BAR high
  // again.
  pathOneUsed = false;
  everSawRed1 = false;
  red: BarRedGate | null = null;
  // Set when a full RED1->RED2 confirms; CONSUMED (reset to false) the
  // moment it's actually used to justify a fast-lane formation or
  // reactivation -- the fast lane is one-time-per-use, not a standing
  // privilege, so a stale completed cycle from long ago must not keep
  // re-granting it forever.
  doorOpen = false;
  birthTier: PbarBirthTier = "NONE";
  topRef = 0;
  // Which reactivation this SEEK_REACTIVATION cycle is for -- decides the
  // fast-lane eligibility rule (BARE has no birth-tier restriction at
  // all: any RED1/RED1->RED2 around the SL fast-lanes it; COMBINED
  // applies the birthTier rule above).
  reactivationKind: "BARE" | "COMBINED" | null = null;

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
  // (still-tracked-in-background) SL turning decisive instead. No fast
  // lane here, ever: PBAR ENTRY can only validate above its own
  // reference high.
  frozenEntryRefHigh = 0;

  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;
}

/** Advances the PBAR/PBAR ENTRY ladder by one candle. Three independent
 * ways in (all just "PBAR", never a separate name):
 *   Path 1: straight breakout above the WTF BAR's own reference high
 *     (`wtfBarRefHigh`), no RED needed -- spent once per window.
 *   Path 2: one RED (or a completed RED1->RED2) -> plain breakout above
 *     yesterday's high.
 *   Path 3 (the fast lane): a prior PBAR/PBAR ENTRY SL, then a fresh
 *     RED1 (or RED1->RED2) around that SL -> plain breakout, bypassing
 *     the gated reference-high reform below.
 * PBAR ENTRY always escalates above PBAR's own reference high, on a
 * later candle -- never the same candle as PBAR, whichever path formed
 * it.
 *
 * Reactivation:
 *   Clean PBAR ENTRY SL (PBAR survives): ONE rule, no race, no fast lane
 *     -- PBAR ENTRY reactivates directly above its own frozen reference
 *     high (SEEK_PBAR_ENTRY_REACTIVATION), racing only against PBAR's
 *     own still-tracked-in-background SL turning this into a combined
 *     failure instead.
 *   Bare PBAR SL (never reached PBAR ENTRY): gated above PBAR's own
 *     reference high, UNLESS a RED1/RED1->RED2 is in play around the SL,
 *     which fast-lanes it to the plain previous-day breakout instead.
 *   Combined SL (PBAR + PBAR ENTRY both wiped): gated above PBAR ENTRY's
 *     reference high by default. Fast lane depends on how THIS instance
 *     was itself born (see PbarBirthTier) -- already spent (RED1_RED2
 *     birth) means no shortcut; RED1 birth needs a fresh RED1->RED2;
 *     NONE (Path 1) birth takes either. */
function stepPbarLevel(
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
    if (result === "confirmed") {
      s.red = null;
      s.doorOpen = true;
    } else if (result === "invalid") {
      s.red = null;
    }
  }

  const formPbar = (tier: PbarBirthTier) => {
    s.pbarRefHigh = cur.h;
    s.pbarRefLow = cur.l;
    s.pbarActivationPrice = cur.h;
    s.pbarFormationDate = cur.date;
    s.pbarRefHighDate = cur.date;
    s.birthTier = tier;
    s.mode = "PBAR_ACTIVE";
  };

  switch (s.mode) {
    case "SEEK_PBAR": {
      // Path 1.
      if (!s.pathOneUsed && breakoutShape(prev, cur, wtfBarRefHigh)) {
        formPbar("NONE");
        s.pathOneUsed = true;
        break;
      }
      // Path 2.
      if (!s.everSawRed1) break;
      if (breakoutShape(prev, cur, prev.h)) {
        const tier: PbarBirthTier = s.doorOpen ? "RED1_RED2" : "RED1";
        if (s.doorOpen) s.doorOpen = false;
        formPbar(tier);
      }
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
        s.reactivationKind = "BARE";
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
        s.reactivationKind = "COMBINED";
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
        // Decisive now, same as a combined PBAR SL + PBAR ENTRY SL --
        // falls through to the ordinary gated reactivation path, no new
        // row (the clean ENTRY SL's own row was already pushed above).
        s.topRef = Math.max(s.pbarRefHigh, s.frozenEntryRefHigh);
        s.reactivationKind = "COMBINED";
        s.mode = "SEEK_REACTIVATION";
      }
      break;
    }
    case "SEEK_REACTIVATION": {
      // Fast lane: a RED1 still open, or a completed RED1->RED2, around
      // this SL can unlock the plain previous-day breakout instead of
      // waiting to clear the gated reference high -- eligibility depends
      // on what's being reactivated (BARE: no restriction) and, for a
      // COMBINED failure, on this instance's own birthTier.
      const red1Open = s.red !== null;
      let fastLaneUnlocked: boolean;
      if (s.reactivationKind === "BARE") {
        fastLaneUnlocked = red1Open || s.doorOpen;
      } else if (s.birthTier === "RED1_RED2") {
        fastLaneUnlocked = false; // strongest trigger already spent
      } else if (s.birthTier === "RED1") {
        fastLaneUnlocked = s.doorOpen; // needs a FRESH, stronger RED1->RED2
      } else {
        fastLaneUnlocked = red1Open || s.doorOpen; // NONE (Path 1) birth: either suffices
      }

      if (fastLaneUnlocked && breakoutShape(prev, cur, prev.h)) {
        const tier: PbarBirthTier = s.doorOpen ? "RED1_RED2" : "RED1";
        if (s.doorOpen) s.doorOpen = false;
        formPbar(tier);
        break;
      }
      if (breakoutShape(prev, cur, s.topRef)) {
        s.topRef = Math.max(s.topRef, cur.h);
        formPbar("NONE");
        break;
      }
      if (cur.h > s.topRef) s.topRef = cur.h;
      break;
    }
  }

  return { opened, closed };
}

// --------------------------------------------------------------------
// BAR THEORY -- TAR / TAR ENTRY and the nested BAR1 / BAR2 cascade.
// Anchored on a WTF BAR that forms AFTER a DTF SAR exit (see simulateDtfAll's
// own `sarFired`/pbarWindows reuse below) -- this is PRIME TREND's own
// reactivation path past a SAR exit, confirmed as the ONLY way back in
// (an ordinary fresh BAR/PBAR cycle does not reactivate a SAR-exited
// instance). Scoped to "WTF BAR active" windows exactly like PBAR's own
// (reuses the identical wtfBarWindowsForLetter/pbarWindows, wiped at the
// same window boundaries, same continuous-WTF-BAR-active precondition).
//
// TAR / TAR ENTRY -- structurally the Path-1-only shape of PBAR (straight
// breakout above the WTF BAR's own reference high, no RED needed -- same
// `wtfBarRefHigh` anchor PBAR's own Path 1 uses), but with ONE confirmed
// difference: TAR's own bare (pre-escalation) SL reforms GATED above
// TAR's own reference high, never unrestricted.
//   TAR -> TAR SL (bare) -> TAR (gated, above TAR's own reference high).
//   TAR -> TAR ENTRY -> TAR ENTRY SL (clean) -> TAR ENTRY (direct, above
//     its own frozen reference high -- races TAR's own background SL
//     turning it decisive instead, same SEEK_*_ENTRY_REACTIVATION shape
//     as everywhere else in this file).
//   TAR -> TAR ENTRY -> TAR SL (combined) -> TAR (gated, above the TAR
//     ENTRY reference high).
//
// BAR1 / BAR2 -- a SEPARATE nested cascade, gated on BOTH of (confirmed):
// TAR SL having occurred at least once in this window (bare or combined
// -- TAR ENTRY SL alone does not count, TAR itself must have failed), AND
// a RED1->RED2 cycle having completed at least once in this window
// (before, after, or alongside that TAR SL -- order doesn't matter, only
// that both have happened). Neither condition alone unlocks it ("without
// TAR SL, no BAR1-BAR2" -- confirmed). Once unlocked it runs for the rest
// of the window, in PARALLEL with TAR's own ladder (TAR keeps reforming
// per its own rules above; this is a second, independent track, same
// parallel-tracks shape as BAR/BAR-ENTRY and PBAR/PBAR-ENTRY elsewhere in
// this file). Once unlocked, BAR1 forms via a plain breakout (same shape
// as PBAR's own RED-gated Path 2 entry) -- the one confirmed difference
// from TAR: BAR1's own bare SL reforms UNRESTRICTED ("Immediately BAR1"),
// not gated.
//   BAR1 -> BAR1 SL (bare) -> BAR1 (unrestricted, plain breakout).
//   BAR1 -> BAR2 -> BAR2 SL (clean) -> BAR2 (direct, above its own frozen
//     reference high).
//   BAR1 -> BAR2 -> BAR1 SL (combined) -> BAR1 (gated, above the BAR2
//     reference high).

type TarMode = "SEEK_TAR" | "TAR_ACTIVE" | "TAR_ENTRY_ACTIVE" | "SEEK_TAR_ENTRY_REACTIVATION" | "SEEK_REACTIVATION";

class TarLevelState {
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
function stepTarLevel(
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
        // Bare, pre-escalation SL -- no row (nothing was ever reported
        // as open), same Filter-rule convention as BAR/PBAR's own bare
        // tier-1 SL. tarSlNow still fires: it's half of BAR1/BAR2's own
        // unlock gate regardless of whether TAR ever escalated.
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
        // Exit price is ALWAYS TAR ENTRY's own (tighter) reference, same
        // as the clean case below, not TAR's own wider one -- see the
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

type Bar1Mode = "SEEK_BAR1" | "BAR1_ACTIVE" | "BAR2_ACTIVE" | "SEEK_BAR2_REACTIVATION" | "SEEK_REACTIVATION";

class Bar1LevelState {
  mode: Bar1Mode = "SEEK_BAR1";
  topRef = 0;
  // Set true the first time a combined SL establishes "the original
  // gate" (topRef). From then on topRef ratchets with every high
  // reached in ANY mode, and even BAR1's own unrestricted ("Immediately
  // BAR1") bare-SL reform must clear it -- not just the prior day's
  // high -- so a reform can never fire below a high this window already
  // proved it could reach.
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

/** Advances the nested BAR1/BAR2 cascade by one candle -- only ever
 * called once this window's own gate (TAR SL ever + RED1->RED2 ever,
 * tracked by the caller) has unlocked. See the module section comment
 * above for the confirmed formation/reactivation rules -- same shape as
 * stepTarLevel except BAR1's own bare SL is unrestricted, not gated. */
function stepBar1Level(
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
        // Bare, pre-escalation SL -- no row, same Filter-rule convention
        // as everywhere else; reforms immediately, but (once the
        // original gate is established) never below the running topRef
        // -- see the end-of-function ratchet.
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
        // Exit price is ALWAYS BAR 2's own (tighter) reference, same as
        // the clean case below, not BAR 1's own wider one -- see the
        // identical note on stepBarLevel's own BAR/BAR ENTRY pair above.
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

  // Once the original gate is established, topRef ratchets with every
  // high reached since, in ANY mode -- it's checked against using the
  // value as of the START of this candle (above), then updated here for
  // the next one.
  if (s.gateEstablished && cur.h > s.topRef) s.topRef = cur.h;

  return { opened, closed };
}

// --------------------------------------------------------------------
// INVALID SAR / INVALID SAR ENTRY -- a modification to BAR THEORY's own
// DTF SAR, confirmed against real data (PAYTM) rather than derived from
// spec text. Once SAR fires, it is no longer necessarily a dead end:
//
//   SAR -> (SAR LL, quiet ratchet down) -> INVALID SAR -> (quiet climb) ->
//   INVALID SAR ENTRY
//
// INVALID SAR: same shape as INVALID RED1 -- a candle that clears SAR's
// own reference high (seeded at the SAR-firing candle's own High) by
// >=0.20 pts with Close confirming at/above it. SAR's own reference LOW
// ratchets down quietly in the meantime (SAR LL) on any new, non-decisive
// lower low -- confirmed, no decisive-breach/"fresh SAR" path has been
// exercised against real data yet, so none is implemented here.
//
// Once invalidated, a NEW reference starts at the invalidating candle's
// own High (same "tier-1 initializes at cur.h" shape as BAR1/TAR) and
// climbs quietly until a full breakoutShape confirms: that confirmation
// is INVALID SAR ENTRY, a real reportable entry (price = ref + THRESH).
//
// Confirmed, VERIFIED exactly against PAYTM (two full cycles):
//   SAR 2025-03-10 -> INVALID SAR 2025-03-11 (ref 694.95, the SAR day's
//   own High) -> INVALID SAR ENTRY 2025-03-18 @720.50 (ref climbed
//   718.95 -> 720.30, breakout 03-18).
//   SAR 2025-09-29 -> SAR LL 2025-09-30 @1097.40 -> INVALID SAR
//   2025-10-01 (ref 1145.00) -> INVALID SAR ENTRY 2025-10-03 @1152.10.
//
// Confirmed rules NOT yet exercised against real data (implemented here
// as literally as stated, flagged for correction once a worked example
// exercises them):
//   - While INVALID SAR ENTRY is active (or seeking invalidation/entry --
//     i.e. from the moment SAR fires), ordinary BAR THEORY (TAR ENTRY,
//     BAR 1 - BAR 2) produces NO reported rows at all -- their own state
//     machines keep running internally ("recording in the backend", for
//     continuity into any future RED1->RED2->BAR cascade) but nothing is
//     shown. Confirmed via PAYTM: the TAR ENTRY/BAR 1 - BAR 2 rows the
//     unmodified engine computes inside either INVALID SAR ENTRY window
//     are explicitly suppressed.
//   - INVALID SAR ENTRY's own SL ("SAR ENTRY SL") -- confirmed exact
//     match 2026-01-23 @1142.00 (the reference low, never ratcheted
//     since entry since no pullback ever undercut it until that candle).
//   - Reactivation after SAR ENTRY SL races three ways: above INVALID SAR
//     ENTRY's own frozen reference high, or TAR forming, or BAR 2 (the
//     nested cascade's own escalation) forming -- whichever occurs first.
//     TAR THEORY's own suppression lifts during this race (that's the
//     whole point of the race), and resumes if INVALID SAR ENTRY itself
//     wins it.
//   - SAR exits two ways: (1) INVALID SAR ENTRY's own SL, or (2) a fresh
//     WTF RED2 re-arming and firing the ordinary recurring SAR again.
//     Path (2), firing again, is "SAR 2" ONLY if NO invalidation occurred
//     since the previous SAR fired; if one did, it's just a fresh SAR,
//     and the whole INVALID-SAR cycle restarts from scratch. SAR 2 is
//     PRIME TREND's own terminal exit -- confirmed: "NO SAR 2" for the
//     2025-09-29 SAR specifically because 2025-03-11's INVALID SAR
//     already happened in between. Post SAR 2, it is plain BAR THEORY
//     for the rest of this instance -- no more of this layer.
type InvalidSarMode = "SEEK_INVALID" | "INVALID_SAR_ACTIVE" | "SEEK_REFORM" | "ENTRY_ACTIVE" | "SEEK_REACTIVATION";

class InvalidSarState {
  mode: InvalidSarMode = "SEEK_INVALID";
  refHigh: number;
  refLow: number;
  frozenEntryRefHigh = 0;
  // Seeded at the bare "INVALID SAR SL" day's own Low when entering
  // SEEK_REFORM -- see that case's own comment for why.
  reformFloor = 0;

  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;

  constructor(refHigh: number, refLow: number) {
    this.refHigh = refHigh;
    this.refLow = refLow;
  }
}

/** True while ordinary BAR THEORY (TAR ENTRY, BAR 1 - BAR 2) must be
 * suppressed from the report -- every mode except the post-SL
 * reactivation race, where TAR/BAR2 are explicitly allowed to race
 * against INVALID SAR ENTRY's own reactivation. */
function invalidSarSuppressesBarTheory(s: InvalidSarState | null): boolean {
  return s !== null && s.mode !== "SEEK_REACTIVATION";
}

function stepInvalidSar(
  s: InvalidSarState,
  prev: Day,
  cur: Day
): {
  invalidSarNow: boolean;
  sarSlNow: boolean;
  sar2Now: boolean;
  // The bare, pre-escalation "INVALID SAR SL" (INVALID_SAR_ACTIVE's own
  // decisive SL, reforming unrestricted via SEEK_REFORM) -- a real,
  // named event (see this case's own comment below), but one that
  // changes neither refHigh nor refLow, so a caller detecting
  // checkpoints purely by comparing before/after ref values (as
  // postBarSl2Race and simulateDtfAll's own sarCheckpoints both do)
  // would otherwise silently miss it entirely. Confirmed real-data
  // (DIXON.NS): this is exactly the transition between the already-
  // confirmed 24/02/22 and 07/03/22 "INVALID SAR SL" checkpoints.
  invalidSarSlNow: boolean;
  opened: { price: number } | null;
  closed: { exitType: string; exitPrice: number } | null;
} {
  let invalidSarNow = false;
  let sarSlNow = false;
  let sar2Now = false;
  let invalidSarSlNow = false;
  let opened: { price: number } | null = null;
  let closed: { exitType: string; exitPrice: number } | null = null;

  switch (s.mode) {
    case "SEEK_INVALID": {
      // Must be the real breakoutShape (including cur.l >= prev.l), same
      // as every other breakout check in this file -- confirmed via
      // COCHINSHIP: 2024-12-27 (High 1539.05 clears the 1520 ref by far
      // more than THRESH, Close confirms at the high) looked like a
      // qualifying invalidation, but its Low (1445) undercut 2024-12-26's
      // own Low (1450) -- failing cur.l >= prev.l -- so it must NOT
      // count. The real first invalidation is 2024-12-30 (Low 1473.50 >=
      // 2024-12-27's Low 1445).
      if (breakoutShape(prev, cur, s.refHigh)) {
        invalidSarNow = true;
        s.refHigh = cur.h;
        s.refLow = cur.l;
        s.mode = "INVALID_SAR_ACTIVE";
        break;
      }
      // "SAR SL" -- confirmed: the upside shape alone (High clears the
      // ref by >=THRESH, Close confirms at/above it) is satisfied, but
      // the Low undercuts the previous day's own Low, failing
      // breakoutShape's guard, so it must NOT be called "INVALID SAR".
      // Still a real, named event (not silently absorbed into the
      // ordinary quiet ratchet): it becomes the new reference high for
      // INVALID SAR, and the reference low becomes whichever is lower,
      // the earlier SAR low or this day's own lower low -- exactly the
      // same ratchet the ordinary path below performs, just under its
      // own label since the day's shape is otherwise a near-miss
      // invalidation, not an ordinary quiet day.
      if (cur.h > s.refHigh && cur.h - s.refHigh >= THRESH - EPS && cur.c >= s.refHigh) {
        sarSlNow = true;
        s.refHigh = cur.h;
        if (cur.l < s.refLow) s.refLow = cur.l;
        break;
      }
      if (slShape(cur, s.refLow)) {
        // A DECISIVE breach of SAR's own reference low, before any
        // invalidation (upside clearance) ever happened -- "SAR 2": the
        // downtrend re-confirms itself outright, terminating the whole
        // INVALID SAR mechanism for good, same terminal event the
        // recurring DTF SAR's own fresh-RED2 refiring produces (just a
        // different trigger). Confirmed via DIXON: 23/08/21 SAR seeds
        // refLow 3900.00 (that day's own Low) -> 24/08/21 decisively
        // breaks it (Low 3760.00, gap 140 >= THRESH, Close 3818.75
        // confirming below) -- SAR 2, straight back to plain BAR THEORY.
        // A merely non-decisive lower low (no close confirmation, or too
        // small a gap) stays the ordinary quiet "SAR LL" ratchet below.
        sar2Now = true;
        break;
      }
      if (cur.h > s.refHigh) s.refHigh = cur.h;
      if (cur.l < s.refLow) s.refLow = cur.l; // "SAR LL"
      break;
    }
    case "INVALID_SAR_ACTIVE": {
      // Same shape as BAR1_ACTIVE: escalation checked first, then a
      // decisive SL against the running reference low -- a bare,
      // pre-escalation SL ("INVALID SAR SL") produces no row (Filter
      // rule, nothing ever escalated) and reforms UNRESTRICTED, directly
      // back into this same tier via SEEK_REFORM, never back to
      // SEEK_INVALID. Confirmed via DIXON: 23/02/22 INVALID SAR ->
      // 24/02/22 INVALID SAR SL -> 25/02/22 INVALID SAR (reform) ->
      // 07/03/22 INVALID SAR SL.
      if (breakoutShape(prev, cur, s.refHigh)) {
        const entryPrice = s.refHigh + THRESH;
        s.refHigh = cur.h;
        s.refLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "ENTRY_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      const slNow = slShape(cur, s.refLow);
      if (!slNow && cur.h > s.refHigh && cur.h - s.refHigh >= ANY) s.refHigh = cur.h;
      if (!slNow && cur.l < s.refLow) s.refLow = cur.l;
      if (slNow) {
        s.reformFloor = cur.l;
        s.mode = "SEEK_REFORM";
        invalidSarSlNow = true;
      }
      break;
    }
    case "SEEK_REFORM": {
      // Gated reform, above the FROZEN reference high from this cycle's
      // own most recent INVALID SAR life (`s.refHigh`, carried over
      // unchanged from INVALID_SAR_ACTIVE's own last value when the bare
      // SL fired) -- NOT an unrestricted breakout against yesterday's
      // own High. Confirmed real-data bug (DIXON.NS): with the
      // unrestricted check, a breakout on 2022-03-14 (which clears only
      // prev.h, not the still-live 4454.55 reference) wrongly reformed
      // INVALID SAR right there -- the correct read is that 14/03, 16/03
      // and 17/03/22 are just this same reference's own quiet climb
      // ("SAR HH"), with the real reform only confirming on 2022-04-05
      // once price finally clears it (by which point it has climbed to
      // 4690). Getting this ordering wrong is what let 2022-04-05's real
      // reform be misread as an ENTRY escalation instead (the erroneous
      // 14/03 reform had already put the state in INVALID_SAR_ACTIVE,
      // so 05/04's breakout landed as an escalation of an
      // already-active cycle rather than the reform itself).
      if (breakoutShape(prev, cur, s.refHigh)) {
        s.refHigh = cur.h;
        s.refLow = cur.l;
        s.mode = "INVALID_SAR_ACTIVE";
        break;
      }
      // Symmetric to SEEK_INVALID's own sar2Now check above: a decisive
      // breach of the bare SL day's own Low, before any reform ever
      // happens, is SAR 2 -- terminates the INVALID SAR mechanism for
      // THIS BAR outright ("no INVALID SAR ENTRY possible for this
      // BAR"), same shape and same reasoning as the original. Confirmed
      // via COCHINSHIP: 2025-01-10's bare SL (Low 1415.00) -> 2025-01-13
      // decisively breaks it (Low 1359.55, gap 55.45, Close 1359.55
      // confirming) -- SAR 2, before the reform that otherwise happens
      // on 2025-01-16 ever gets a chance.
      if (slShape(cur, s.reformFloor)) {
        sar2Now = true;
        break;
      }
      if (cur.l < s.reformFloor) s.reformFloor = cur.l; // quiet ratchet, same as SEEK_INVALID's own "SAR LL"
      if (cur.h > s.refHigh) s.refHigh = cur.h; // quiet climb of the frozen reform reference ("SAR HH")
      break;
    }
    case "ENTRY_ACTIVE": {
      if (cur.h > s.rowHH) {
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
      }
      const slNow = slShape(cur, s.refLow);
      if (!slNow && cur.h > s.refHigh && cur.h - s.refHigh >= ANY) s.refHigh = cur.h;
      if (!slNow && cur.l < s.refLow) s.refLow = cur.l;
      if (slNow) {
        closed = { exitType: "SAR ENTRY SL", exitPrice: s.refLow };
        s.frozenEntryRefHigh = s.refHigh;
        s.mode = "SEEK_REACTIVATION";
      }
      break;
    }
    case "SEEK_REACTIVATION": {
      if (breakoutShape(prev, cur, s.frozenEntryRefHigh)) {
        const entryPrice = s.frozenEntryRefHigh + THRESH;
        s.refHigh = cur.h;
        s.refLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "ENTRY_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      // Real-data bug (PAYTM.NS, post-BAR-SL2 DTF SAR, 2026): a High that
      // clears frozenEntryRefHigh without the Close confirming back above
      // it (02/07/26 High 1227.70 Close 1213.40; 03/07/26 High 1231.90
      // Close 1221.40, against frozenEntryRefHigh=1223.00) was silently
      // dropped instead of raising the reactivation reference -- every
      // other mode in this state machine ratchets its own refHigh the
      // same way on a plain ANY-threshold new high (SEEK_INVALID,
      // INVALID_SAR_ACTIVE, ENTRY_ACTIVE); SEEK_REACTIVATION was the one
      // mode with no such ratchet at all. Confirmed: the real
      // reactivation two days later (07/07/26, High 1251.00 Close
      // 1246.00) must breakout above the ratcheted 1231.90, not the
      // stale pre-SL 1223.00.
      if (cur.h > s.frozenEntryRefHigh && cur.h - s.frozenEntryRefHigh >= ANY) {
        s.frozenEntryRefHigh = cur.h;
      }
      break;
    }
  }

  return { invalidSarNow, sarSlNow, sar2Now, invalidSarSlNow, opened, closed };
}

/** The single, shared checkpoint-recording rule for one stepInvalidSar
 * call -- used identically by postBarSl2Race (its own standalone
 * re-simulation) and simulateDtfAll (the live, already-correct state),
 * so the two can never again drift apart on which transitions are
 * checkpoint-worthy (confirmed real-data, DIXON.NS: both independently
 * missed the bare "INVALID SAR SL" and the "reform" transitions before
 * this was unified -- each caught by comparing refHigh/refLow, which
 * neither of those two transitions actually changes/signals on its own).
 * `modeBefore`/`refHighBefore`/`refLowBefore`/`frozenBefore` must be
 * snapshotted from `s` BEFORE calling stepInvalidSar; `s` and `result`
 * are its state and return value AFTER. Returns null when the step was
 * a pure no-op (no real transition, no ratchet). */
function checkpointForInvalidSarStep(
  modeBefore: InvalidSarMode,
  refHighBefore: number,
  refLowBefore: number,
  frozenBefore: number,
  s: InvalidSarState,
  result: ReturnType<typeof stepInvalidSar>,
  cur: Day
): PostBarSl2Checkpoint | null {
  if (result.sar2Now) return { date: cur.date, label: "SAR 2", price: cur.l };
  if (result.invalidSarNow) return { date: cur.date, label: "INVALID SAR", price: cur.h };
  if (result.invalidSarSlNow) return { date: cur.date, label: "INVALID SAR SL", price: cur.l };
  if (result.sarSlNow) return { date: cur.date, label: "SAR SL", price: cur.h };
  if (result.opened) {
    const label = modeBefore === "SEEK_REACTIVATION" ? "INVALID SAR ENTRY REACTIVATED" : "INVALID SAR ENTRY";
    return { date: cur.date, label, price: result.opened.price };
  }
  if (result.closed) return { date: cur.date, label: "INVALID SAR ENTRY SL", price: result.closed.exitPrice };
  if (modeBefore === "SEEK_INVALID") {
    if (s.refHigh > refHighBefore) return { date: cur.date, label: "SAR HH", price: s.refHigh };
    if (s.refLow < refLowBefore) return { date: cur.date, label: "SAR LL", price: s.refLow };
  } else if (modeBefore === "INVALID_SAR_ACTIVE") {
    if (s.refHigh > refHighBefore) return { date: cur.date, label: "INVALID SAR HH", price: s.refHigh };
    if (s.refLow < refLowBefore) return { date: cur.date, label: "INVALID SAR LL", price: s.refLow };
  } else if (modeBefore === "SEEK_REFORM") {
    // The reform itself (SEEK_REFORM -> INVALID_SAR_ACTIVE) sets neither
    // invalidSarNow nor any other flag -- detected here by the mode
    // change itself, labeled the same as any other INVALID SAR
    // (re-)confirmation. Otherwise, the frozen reform reference's own
    // quiet climb is "SAR HH" (same label the code's own comment at
    // stepInvalidSar's SEEK_REFORM case already uses).
    if (s.mode === "INVALID_SAR_ACTIVE") return { date: cur.date, label: "INVALID SAR", price: s.refHigh };
    if (s.refHigh > refHighBefore) return { date: cur.date, label: "SAR HH", price: s.refHigh };
  } else if (modeBefore === "ENTRY_ACTIVE") {
    if (cur.h === s.rowHH && s.rowHH > refHighBefore) return { date: cur.date, label: "INVALID SAR ENTRY HH", price: s.rowHH };
    if (s.refLow < refLowBefore) return { date: cur.date, label: "INVALID SAR ENTRY LL", price: s.refLow };
  } else if (modeBefore === "SEEK_REACTIVATION") {
    if (s.frozenEntryRefHigh > frozenBefore) return { date: cur.date, label: "INVALID SAR ENTRY HH", price: s.frozenEntryRefHigh };
  }
  return null;
}

// --------------------------------------------------------------------
// Step 1: run TZEngine once over the WTF series. Alongside the ordinary
// event trace, snapshot every branch's own "2"-tier ref_low BEFORE each
// candle is processed, for EACH of the three anchor families, plus which
// pid currently holds that tier -- used both to resolve a formation event
// to its pid and to detect when an instance's own tier has vanished with
// no explicit exit event (collateral termination).
// --------------------------------------------------------------------

interface FamilySpec {
  form: string;
  hh: string;
  exits: string[];
  barPrefix: string;
}

const FAMILIES: Record<PrimeTrendFamily, FamilySpec> = {
  "TZ BUY 2": { form: "TZ BUY 2(", hh: "TZ BUY 2 HH(", exits: ["TZ BUY 2 SL(", "TZ BUY SL("], barPrefix: "BAR SL2(" },
  "REAR 2": { form: "REAR 2(", hh: "REAR 2 HH(", exits: ["REAR 2 SL(", "REAR SL("], barPrefix: "BAR SL2(" },
  "REAR RE-ENTER 2": {
    form: "REAR RE-ENTER 2(",
    hh: "REAR RE-ENTER 2 HH(",
    exits: ["REAR RE-ENTER 2 SL(", "REAR RE-ENTER SL("],
    barPrefix: "BAR SL2(",
  },
};

const FAMILY_NAMES: PrimeTrendFamily[] = ["TZ BUY 2", "REAR 2", "REAR RE-ENTER 2"];

/** The live Bar2-shaped object for this family on this branch's buy right
 * now, or null if that tier doesn't currently exist for it. */
function tierObject(pc: ParentCycle, family: PrimeTrendFamily): { refLow: number } | null {
  if (pc.buy === null) return null;
  if (family === "TZ BUY 2") return pc.buy.tzBuy2;
  if (family === "REAR 2") return pc.buy.rear !== null ? pc.buy.rear.rear2 : null;
  return pc.buy.rearReenter !== null ? pc.buy.rearReenter.rre2 : null;
}

export interface WtfTraceEntry {
  day: Day;
  events: string[];
  preRefLow: Record<PrimeTrendFamily, Map<number, number>>;
  preBarSlRefLow: Map<string, number>;
  aliveAfter: Map<number, string>;
  hasTierAfter: Record<PrimeTrendFamily, Set<number>>;
}

/** Branch LETTERS get recycled -- once a branch dies (whether via an
 * explicit SL or via collateral termination from the multi-branch
 * leadership rules, which emits no SL-type event at all), its id frees up
 * and a later, wholly unrelated branch can reuse the same letter. So every
 * snapshot here is keyed by pid (stable for one branch's whole life),
 * never by letter alone -- letter is only resolved from pid at the point
 * of use. */
export function runWtfTrace(
  wtfDays: Day[],
  barSl2LogOut?: { label: string; date: string; low: number }[],
  hiddenEventLogOut?: HiddenEventLogEntry[]
): WtfTraceEntry[] {
  // `true`: this always runs on WEEKLY candles (PRIME TREND's fixed
  // WTF=weekly rule; lib/tarTbar.ts's own findWindows, this function's
  // other caller, is weekly-only too) -- enables the weekly-only bare-
  // BAR-SL-opens-REAR revision (see TZEngine's own constructor comment).
  const engine = new TZEngine(true);
  const trace: WtfTraceEntry[] = [];
  for (let i = 1; i < wtfDays.length; i++) {
    const prev = wtfDays[i - 1];
    const cur = wtfDays[i];
    const preRefLow: Record<PrimeTrendFamily, Map<number, number>> = {
      "TZ BUY 2": new Map(),
      "REAR 2": new Map(),
      "REAR RE-ENTER 2": new Map(),
    };
    // BAR SL2's own exit price needs that SPECIFIC BAR lineage's own SL
    // reference low, as it stood before this candle -- not any of the
    // three per-family snapshots above (which only ever track the single
    // top-level "2" tier), since a branch can hold several BAR lineages
    // racing in parallel at once, each with its own separate SL object.
    // Keyed by the lineage's own full label ("B.2"), which is already
    // unique per pid for that pid's whole life (see the branch-letter-
    // recycling note above -- the numeric suffix is never reused within
    // one buy's own bar_sub_counter).
    const preBarSlRefLow = new Map<string, number>();
    for (const [, pc] of engine.branches) {
      if (pc.buy === null) continue;
      for (const lin of pc.buy.barLineages) {
        if (lin.sl !== null) preBarSlRefLow.set(lin.label, lin.sl.refLow);
      }
    }
    for (const [pid, pc] of engine.branches) {
      for (const family of FAMILY_NAMES) {
        const tier = tierObject(pc, family);
        if (tier !== null) preRefLow[family].set(pid, tier.refLow);
      }
    }
    const events = engine.process(prev, cur);
    const aliveAfter = new Map<number, string>();
    const hasTierAfter: Record<PrimeTrendFamily, Set<number>> = {
      "TZ BUY 2": new Set(),
      "REAR 2": new Set(),
      "REAR RE-ENTER 2": new Set(),
    };
    for (const [pid, pc] of engine.branches) {
      aliveAfter.set(pid, branchLabel(pid));
      for (const family of FAMILY_NAMES) {
        if (tierObject(pc, family) !== null) hasTierAfter[family].add(pid);
      }
    }
    trace.push({ day: cur, events, preRefLow, preBarSlRefLow, aliveAfter, hasTierAfter });
  }
  if (barSl2LogOut) barSl2LogOut.push(...engine.barSl2Log);
  if (hiddenEventLogOut) hiddenEventLogOut.push(...engine.hiddenEventLog);
  return trace;
}

// --------------------------------------------------------------------
// Step 2: every anchor instance and its own window (formation -> that
// instance's own failure), with the exact WTF-side exit price resolved.
// Tracked by pid, not by letter.
// --------------------------------------------------------------------

export interface WtfInstance {
  family: PrimeTrendFamily;
  letter: string;
  formationDate: string;
  endDate: string; // this instance's own failure date, or the last WTF date if it never fails
  endEvent: string | null; // null if it never fails (or fails with no explicit SL-type event) within the data
  endPrice: number | null; // BAR SL2 -> the actual Low of the WTF candle that confirmed BAR SL2 (NOT the pre-break SL reference it broke through -- confirmed PAYTM.NS 09/03/26: BAR SL2's own candle Low 966.70, not the 1023.00 reference it decisively broke); own "2" SL / parent-tier SL -> this tier's own ref_low
}

// Safety valve, not a real-world expectation: a normal stock's history
// produces at most a few dozen formations per family even over decades.
// This exists purely to turn a pathological case (a stock whose price
// data makes this O(trace^2) search -- or the O(dtfDays) DTF simulation
// computePrimeTrendLive later runs per open instance -- blow up) into a
// fast, clean, per-stock failure instead of a serverless invocation that
// hangs long enough to take the whole request down with it. A caught
// exception here is a scanned-stock failure (see the try/catch around
// scanStock() in app/api/screener/route.ts), not a broken feature.
const MAX_INSTANCES_PER_FAMILY = 300;

function wtfInstancesForFamily(
  wtfTrace: WtfTraceEntry[],
  family: PrimeTrendFamily,
  lastDtfDate: string | null
): WtfInstance[] {
  const spec = FAMILIES[family];
  const instances: WtfInstance[] = [];
  // A still-open instance's window must extend through the actual last
  // available DTF trading day, NOT the last WTF trace entry's own date.
  // The WTF trace has one row per week labeled by that week's FIRST
  // trading day (see resampleWeekly's own fix note) -- so once >=2 trading
  // days have elapsed in the current, still-forming week, the WTF trace's
  // last date is EARLIER than today. Falling back to it here used to
  // silently cut the DTF simulation off right at that label, discarding
  // every later real trading day for any currently-open instance: Highest
  // High froze at the entry candle's own high (or, if formation happened
  // on that same label day, never got captured at all and fell back to
  // showing Activation Price), and any Stage 1/2 formation or SL that
  // would only trigger on day 2-5 of the current week was never even
  // evaluated. (Confirmed live, ACMESOLAR.NS/INDORAMA.NS, 2026-09-24.)
  const lastDate = lastDtfDate ?? (wtfTrace.length > 0 ? wtfTrace[wtfTrace.length - 1].day.date : null);
  for (let i = 0; i < wtfTrace.length; i++) {
    const { day, events, aliveAfter } = wtfTrace[i];
    for (const e of events) {
      if (!e.startsWith(spec.form)) continue;
      if (instances.length >= MAX_INSTANCES_PER_FAMILY) {
        throw new Error(
          `PRIME TREND: ${family} formation count exceeded safety cap (${MAX_INSTANCES_PER_FAMILY}) -- likely pathological price data`
        );
      }
      const letter = e.slice(spec.form.length, -1);
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
        const {
          day: day2,
          events: evs2,
          preRefLow: pre2,
          preBarSlRefLow: preBarSl2,
          aliveAfter: alive2,
          hasTierAfter: has2,
        } = wtfTrace[j];
        let hit: string | null = null;
        for (const e2 of evs2) {
          for (const exitPrefix of spec.exits) {
            if (e2 === `${exitPrefix}${letter})`) {
              hit = e2;
              endPrice = pre2[family].get(pid) ?? null;
              break;
            }
          }
          if (hit !== null) break;
          if (e2.startsWith(`${spec.barPrefix}${letter}.`)) {
            hit = e2;
            // Real-data bug (PAYTM.NS 09/03/26): this used to report the
            // pre-break SL reference (preBarSl2, 1023.00) that BAR SL2
            // decisively broke THROUGH, not the actual confirming
            // candle's own Low (966.70) -- confirmed by the user against
            // real data ("Reference low is WTF BAR SL2 low 966.70").
            endPrice = day2.l;
            break;
          }
        }
        if (hit !== null) {
          endDate = day2.date;
          endEvent = hit;
          break;
        }
        // Ceiling: this specific pid's own tier has genuinely ended (wiped
        // to None, or the whole branch died) with no explicit SL-type
        // event ever firing -- never search past this.
        if (!alive2.has(pid) || !has2[family].has(pid)) {
          endDate = day2.date;
          endEvent = "collaterally terminated (no explicit SL event)";
          break;
        }
      }
      instances.push({ family, letter, formationDate: day.date, endDate, endEvent, endPrice });
    }
  }
  return instances;
}

function allInstances(wtfTrace: WtfTraceEntry[], lastDtfDate: string | null): WtfInstance[] {
  const instances: WtfInstance[] = [];
  for (const family of FAMILY_NAMES) {
    instances.push(...wtfInstancesForFamily(wtfTrace, family, lastDtfDate));
  }
  instances.sort((a, b) => (a.formationDate < b.formationDate ? -1 : a.formationDate > b.formationDate ? 1 : 0));
  return instances;
}

// --------------------------------------------------------------------
// Step 3: live (week-lagged) WTF reference lookup for a given instance
// --------------------------------------------------------------------

export function wtfCheckpoints(
  wtfTrace: WtfTraceEntry[],
  family: PrimeTrendFamily,
  letter: string,
  startDate: string,
  endDate: string
): [string, number][] {
  const spec = FAMILIES[family];
  const checkpoints: [string, number][] = [];
  for (const { day, events } of wtfTrace) {
    if (day.date < startDate || day.date > endDate) continue;
    for (const e of events) {
      if (e === `${spec.form}${letter})` || e === `${spec.hh}${letter})`) {
        checkpoints.push([day.date, day.h]);
      }
    }
  }
  return checkpoints;
}

/** Largest wtf_date <= d -- the WTF week that contains this DTF day. */
export function containingWeekStart(wtfDates: string[], d: string): string | null {
  let start: string | null = null;
  for (const wd of wtfDates) {
    if (wd <= d) start = wd;
    else break;
  }
  return start;
}

// --------------------------------------------------------------------
// Step 4: the Stage 1 / Stage 2 DTF simulation within one WTF instance's
// window. Returns EVERY closed entry/exit cycle as its own row -- not
// just the last one -- plus a still-open final entry (if any) as one
// more row.
// --------------------------------------------------------------------

export const DTF_SL_EXIT_TYPES = new Set([
  "DTF TZ BUY SL (wipes ENTRY)",
  "DTF BAR ENTRY SL",
  "DTF BAR SL (wipes ENTRY)",
  "DTF BAR SL + DTF BAR ENTRY SL",
  "DTF PBAR ENTRY SL",
  "DTF PBAR SL (wipes ENTRY)",
  "DTF PBAR SL + DTF PBAR ENTRY SL",
  "DTF TAR ENTRY SL",
  "DTF TAR SL (wipes ENTRY)",
  "DTF TAR SL + DTF TAR ENTRY SL",
  "DTF BAR 2 SL",
  "DTF BAR 1 SL (wipes BAR 2)",
  "DTF BAR 1 SL + DTF BAR 2 SL",
  "SAR ENTRY SL",
]);

interface WtfBarWindow {
  formationDate: string;
  endDate: string | null;
  endReason: "BAR SL" | "new BAR" | null;
  // The WTF BAR's own reference high AT FORMATION (that week's own known
  // High) -- the seed for DTF PBAR's own "Path 1" trigger (a straight
  // breakout above the WTF BAR's reference high, no RED required). Only
  // a seed, not the whole running value: a weekly-bar lookup climbs in
  // WEEKLY jumps and, worse, every day's own High is itself one of the
  // inputs to ITS OWN week's high, so "today's High > this week's own
  // running high" is structurally near-impossible intra-week -- same
  // look-ahead trap preS1Ref above was built to avoid. The caller
  // (simulateDtfAll) instead climbs this seed quietly on each later
  // DAY'S own High directly, exactly like preS1Ref, never waiting for a
  // further WTF week to close first.
  formationHigh: number;
}

/** The WTF engine's own native "BAR(" milestone (lib/tzEngineWtf.ts's
 * RED1->RED2->BAR1 cascade, run on WEEKLY candles) formed by THIS
 * instance's own branch (matched by the WTF engine's own label
 * convention, `${letter}.${n}` -- lib/tzEngineWtf.ts's `nextBarLabel`),
 * within this instance's own window. This is the "WTF BAR" trigger for
 * the DTF PBAR/PBAR ENTRY ladder below. Each formation (first, or a
 * later reform) governs its own window, ending at EITHER that specific
 * label's own CONFIRMED "BAR SL(label)" (the WTF engine's own
 * `^BAR SL\(` anchor excludes a later "INVALID BAR SL(label)" --
 * confirmed: a provisional WTF BAR SL that the engine itself later
 * retracts still counts as a real failure for PBAR purposes, requiring
 * a brand new DTF RED1 once the label reforms -- verified against real
 * COCHINSHIP.NS data, where WTF BAR(B.1) SL'd 22/05/23, got marked
 * "INVALID" and reformed 29/05/23, and DTF only resumed seeking via a
 * fresh RED1 on 07/06/23, not immediately off the already-unlocked
 * pre-22/05 door) OR a fresh "BAR(" formation line, whichever comes
 * first -- same shape as lib/tarTbar.ts's own `findWindows`, just
 * scoped to this one instance's own letter and date bounds rather than
 * scanned globally. "WTF BAR active" (the continuous precondition for
 * PBAR/PBAR ENTRY, alongside WTF TZ BUY 2 and "DTF BAR ENTRY inactive")
 * means "within one of these windows, before its own endDate". */
function wtfBarWindowsForLetter(
  wtfTrace: WtfTraceEntry[],
  letter: string,
  formationDate: string,
  endDate: string
): WtfBarWindow[] {
  // A "BAR(letter.N)" label only counts as a REAL formation -- one that
  // supersedes whatever was governing before and reseeds the reference
  // -- if it is actually backed by one of the three causal paths
  // confirmed: (a)/(b) a genuine RED2(letter) confirmed since the last
  // real formation (whatever it resolves to afterward, INVALID SAR/
  // INVALID SAR ENTRY or SAR 2, doesn't matter here -- RED2 having
  // fired at all is what matters), or (c) a reform of that SAME number
  // after its OWN prior "BAR SL(letter.N)". A "BAR(" label that is
  // neither -- the WTF engine's own RED1 getting invalidated (RED1 HH)
  // before ever reaching RED2, which still throws off a "BAR(" label --
  // is not a real formation and must be ignored outright, not treated
  // as super ceding anything. Confirmed via COCHINSHIP: BAR(B.3) on
  // 2025-04-15 is preceded by RED1(B) 04-01 -> RED1 LL(B) 04-07 ->
  // RED1 HH(B) [invalidated, no RED2 ever confirmed] + BAR(B.3) same
  // day -- not real. Ignoring it, BAR(B.2) (formed 2025-03-17, backed
  // by its own prior BAR SL(B.2) reform) stays the sole governing
  // window straight through to TAR's real 2025-04-29 formation,
  // exactly as walked through by hand -- no gap. Confirmed via DIXON:
  // BAR(A.2) on 2021-08-30 IS real (RED1(A) 07-26 -> RED1 LL(A) 08-09
  // -> RED2(A) 08-16, genuinely confirmed) -- it legitimately
  // supersedes BAR(A.1) (open since 2020-03-02, never itself SL'd),
  // reseeding the reference down to A.2's own (lower) formation high,
  // exactly as needed for the confirmed 2021-10-01 TAR ENTRY.
  const formRe = new RegExp(`^BAR\\(${letter}\\.(\\d+)\\)$`);
  const slRe = new RegExp(`^BAR SL\\(${letter}\\.(\\d+)\\)$`);
  const red2Label = `RED2(${letter})`;

  const windows: WtfBarWindow[] = [];
  let currentN: number | null = null;
  let currentFormationDate: string | null = null;
  let currentFormationHigh = 0;
  let sawRed2SinceLastRealFormation = false;
  // The WTF engine REUSES number labels across unrelated instances (not
  // a stable per-lineage identity) -- so "reform of its own prior SL"
  // only counts if THIS is the very next "BAR(" event after that exact
  // SL, with nothing else forming in between. A single most-recent
  // value, not a historical set: confirmed via COCHINSHIP, where
  // "BAR(B.3)" closed 2025-01-06 and the label "3" is reused again on
  // 2025-04-15 for a wholly unrelated, non-real formation -- treating
  // that as "reforming" the January one (a persistent per-number set
  // would) is exactly the bug that let it wrongly supersede BAR(B.2).
  let lastClosedN: number | null = null;
  // Whether the MOST RECENT "BAR(letter.N)" occurrence for each number
  // was itself validated real -- an SL for N only sets lastClosedN if
  // N's latest formation was real. Without this, a SL on a number whose
  // latest formation was spurious (e.g. the ignored 2025-04-15 one)
  // would still look like a legitimate close, letting label reuse
  // validate a LATER spurious reform of the same number (confirmed via
  // COCHINSHIP: "BAR(B.3)" reappears 2025-05-12, again with no RED2
  // backing it, and must be rejected again, not treated as reforming
  // either the real December B.3 or the already-rejected April one).
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

interface Red2Event {
  date: string;
  refLow: number;
}

/** Every WTF-native "RED2(letter)" confirmation for this instance's own
 * letter -- the recurring SAR anchor. Each fresh RED2 re-arms a brand
 * new SAR watch, seeded at that confirming candle's own Low, superseding
 * any earlier watch that never fired (confirmed: SAR is recurring, not
 * one-time -- re-armed by every fresh WTF RED1->RED2 cycle). */
function red2EventsForLetter(wtfTrace: WtfTraceEntry[], letter: string, formationDate: string, endDate: string): Red2Event[] {
  const label = `RED2(${letter})`;
  const events: Red2Event[] = [];
  for (const { day, events: evs } of wtfTrace) {
    if (day.date <= formationDate || day.date > endDate) continue;
    if (evs.includes(label)) events.push({ date: day.date, refLow: day.l });
  }
  return events;
}

/** Merges the WTF anchor's own terminal failure label onto the last
 * (non-nested) row among the given `sides` -- the BAR/BAR ENTRY ladder's
 * rows and the PBAR/PBAR ENTRY ladder's rows are interleaved in `rows`
 * in whatever order they actually closed, so each track's own trailing
 * row must be found and merged independently rather than assuming the
 * array's last entry overall belongs to the track that deserves the
 * merge. */
function mergeTrailingWtfSl(rows: PrimeTrendResult[], sides: PrimeTrendResult["side"][], label: string | null) {
  if (label === null) return;
  for (let r = rows.length - 1; r >= 0; r--) {
    if (!sides.includes(rows[r].side)) continue;
    if (DTF_SL_EXIT_TYPES.has(rows[r].exitType)) {
      rows[r] = { ...rows[r], exitType: `DTF SL - ${label}` };
    }
    break;
  }
}

/** Short label for an instance's own terminal WTF-side event, for the
 * merged "DTF SL - <WTF SL>" exit-type annotation -- null if the instance
 * never explicitly fails (still open, or collaterally terminated with no
 * event) within the data. Deliberately excludes "BAR SL2(" -- that WTF-side
 * instance-ending event ("BAR SL 2") is a different thing from the DTF-side
 * nested cascade's own "BAR 2 SL" (or combined "BAR 1 SL + BAR 2 SL"), a
 * big logic difference confirmed via DIXON: the BAR 1 - BAR 2 cycle's own
 * exit on 2022-05-02 is a real, independently-dated, independently-priced
 * DTF BAR 2 SL, a full week before the WTF anchor's own BAR SL 2 on
 * 2022-05-09 -- merging the two into one label conflates them. */
export function wtfSlLabel(endEvent: string | null): string | null {
  if (endEvent === null) return null;
  if (
    endEvent.startsWith("TZ BUY 2 SL(") ||
    endEvent.startsWith("REAR 2 SL(") ||
    endEvent.startsWith("REAR RE-ENTER 2 SL(") ||
    endEvent.startsWith("TZ BUY SL(") ||
    endEvent.startsWith("REAR SL(") ||
    endEvent.startsWith("REAR RE-ENTER SL(")
  ) {
    return endEvent.split("(")[0];
  }
  return null;
}

// --------------------------------------------------------------------
// POST-BAR-SL2 SAR -- user's own extension (session of 2026-10-21), NOT
// yet verified against any real data (no real BAR SL2 -> SAR2/INVALID
// SAR ENTRY instance has been traced yet; this is the rule as stated,
// typechecked, nothing more). Does NOT modify TZEngine
// (lib/tzEngineWtf.ts) or any existing Prime Trend output above -- the
// WTF engine's own REAR/TZ BUY display, and every already-verified
// instance/row this file already produces, are untouched. Purely an
// additive, independent cross-timeframe computation layered on top of
// an existing BAR-SL2-ended instance.
//
// THE RULE, as given: until now, the WTF-side TZ BUY-vs-REAR leadership
// race (the engine's own existing contest-loop hierarchy, already fully
// coded and verified in tzEngineWtf.ts -- TZ BUY 2 outranks REAR, etc.)
// started being relevant immediately at WTF BAR SL2. That is no longer
// the trigger. Instead, BAR SL2 arms a FRESH DTF SAR watch, seeded at
// that BAR lineage's own SL reference low (`inst.endPrice`) -- same
// decisive-breach/quiet-ratchet shape as the ordinary RED2-anchored SAR
// above, just a different seed and no "something must be open" gate
// (nothing is left open once the instance has already ended). Once that
// SAR actually fires, it hands off to the SAME, unmodified
// InvalidSarState/stepInvalidSar machinery used everywhere else in this
// file:
//   - If that ladder reaches INVALID SAR ENTRY (the user's own name for
//     this, in this specific context: "INVALID SAR 2") -- report it as
//     this instance's own continuation entry. The TZ BUY-vs-REAR race
//     never triggers in this branch.
//   - If that ladder instead ends in a decisive SAR 2 (no invalidation
//     ever happened) -- the TZ BUY-vs-REAR race finally starts, dated
//     to that SAR 2 candle, not to the original BAR SL2 candle. Which
//     side actually wins is decided by the engine's own existing,
//     already-verified hierarchy -- this function only reports WHEN
//     that race became live, not who wins it (read the WTF trace from
//     `raceTriggeredDate` onward for the already-correct outcome).
//   - Otherwise (SAR itself never fires within the available data, or
//     fires and is still mid-ladder) -- reported as "still watching",
//     same honest "nothing more to report yet" posture used everywhere
//     else in this file for an in-progress structure.
//
// SECOND ADDITION, same session: while this watch is pending (SAR 2 has
// NOT yet occurred -- whether SAR hasn't fired at all yet, or has fired
// and is mid-INVALID-SAR-ladder), if a FRESH WTF "BAR(" reforms for this
// SAME top-level lineage (a new sub-lineage generation under the same
// letter, e.g. "A.5" after "A.4" SL2'd), that fresh BAR's own future
// path is governed by BAR THEORY (TAR/TBAR, lib/tarTbar.ts) only.
//
// IMPORTANT, user-flagged distinction -- these are TWO DIFFERENT rules
// for two different contexts, not one rule reused:
//   (a) Ordinary BAR THEORY (the RED2-anchored SAR, elsewhere in this
//       file): AFTER its own SAR 2 fires, a fresh BAR can still occur --
//       it just goes through TAR/TBAR instead of ordinary BAR/PBAR.
//   (b) THIS BAR-SL2-anchored context: once SAR 2 fires HERE, BAR CANNOT
//       OCCUR ANY MORE at all for this lineage -- not even via TAR/TBAR.
//       A fresh BAR only follows BAR Theory if it forms BEFORE this SAR
//       2; one formed on or after this SAR 2 is not flagged at all (see
//       `finish()` below -- the date comparison against
//       `raceTriggeredDate` is exactly this (b) boundary, not (a)'s).
// This function does NOT duplicate tarTbar.ts's own state machine
// (`computeTarTbar` already processes every WTF "BAR(" occurrence
// completely independently, with no awareness of Prime Trend/SAR state
// at all) -- it only DETECTS that case (b)'s pre-SAR-2 window applies
// and reports which WTF BAR label to look up in that module's own
// output; it does not compute the TAR/TBAR structure itself.
// WIDENED (same session): the first version of this function stopped
// reporting at the FIRST checkpoint (either INVALID SAR ENTRY forming
// once, or a decisive SAR 2) -- confirmed, against real PAYTM.NS data,
// that the ladder keeps going well past that: INVALID SAR ENTRY can SL
// and reactivate (same SEEK_REACTIVATION cycle already used by the
// ordinary RED2-anchored mechanism elsewhere in this file), each step
// with its own HH/LL/SL text. This now runs the full InvalidSarState
// lifecycle across the whole available window and reports every
// checkpoint, not just the first.
export type PostBarSl2CheckpointLabel =
  | "SAR"
  | "SAR HH"
  | "SAR LL"
  | "SAR SL"
  | "INVALID SAR"
  | "INVALID SAR HH"
  | "INVALID SAR LL"
  | "INVALID SAR SL"
  | "INVALID SAR ENTRY"
  | "INVALID SAR ENTRY REACTIVATED"
  | "INVALID SAR ENTRY HH"
  | "INVALID SAR ENTRY LL"
  | "INVALID SAR ENTRY SL"
  | "SAR 2";

export interface PostBarSl2Checkpoint {
  date: string;
  label: PostBarSl2CheckpointLabel;
  price: number;
}

export interface PostBarSl2Result {
  letter: string;
  barSl2Date: string;
  barSl2RefLow: number;
  // The full dated ladder, in order -- SAR/SAR HH/SAR LL/SAR SL, then
  // (once SAR fires) INVALID SAR's own HH/LL/SL, then (once it opens)
  // INVALID SAR ENTRY's own HH/LL/SL/reactivation cycle, or SAR 2 if a
  // decisive breach happens before any invalidation ever occurred.
  checkpoints: PostBarSl2Checkpoint[];
  // "RACE_TRIGGERED": a decisive SAR 2 fired -- the TZ BUY-vs-REAR race
  // starts at raceTriggeredDate (who wins is the engine's own existing,
  // unmodified hierarchy -- read the WTF trace from there). "OPEN": an
  // INVALID SAR ENTRY is currently active at the end of the window.
  // "CLOSED_SEEKING_REACTIVATION": INVALID SAR ENTRY SL'd and is
  // watching for reactivation. "STILL_WATCHING": SAR itself hasn't
  // fired yet (still ratcheting toward the BAR SL2 reference low).
  // "NONE": no DTF data exists after the BAR SL2 date at all.
  outcome: "RACE_TRIGGERED" | "OPEN" | "CLOSED_SEEKING_REACTIVATION" | "STILL_WATCHING" | "NONE";
  raceTriggeredDate: string | null;
  raceTriggeredPrice: number | null;
  // Set when a fresh WTF BAR reformed for this same lineage before SAR 2
  // occurred (regardless of whether SAR 2 eventually occurs later) --
  // look up `freshBarLabel` in computeTarTbar's own `windows`/`results`
  // for the actual TAR/TBAR structure; this field only flags that it
  // applies and names which WTF BAR window to use.
  freshBarDate: string | null;
  freshBarLabel: string | null;
}

/** Only applicable when `inst` ended via a WTF BAR SL2 -- null otherwise
 * (a TZ BUY 2/REAR 2 SL ending, or an instance still open, has no BAR
 * lineage SL reference low to seed this watch from). `dtfDays` is the
 * full DTF series; only days strictly after `inst.endDate` are watched.
 * `wtfTrace` is only used to detect a fresh same-letter WTF BAR
 * reforming (the second addition above) -- it does not affect the SAR
 * watch itself. */
export function postBarSl2Race(dtfDays: Day[], wtfTrace: WtfTraceEntry[], inst: WtfInstance): PostBarSl2Result | null {
  if (inst.endEvent === null || !inst.endEvent.startsWith("BAR SL2(") || inst.endPrice === null) {
    return null;
  }

  const result: PostBarSl2Result = {
    letter: inst.letter,
    barSl2Date: inst.endDate,
    barSl2RefLow: inst.endPrice,
    checkpoints: [],
    outcome: "STILL_WATCHING",
    raceTriggeredDate: null,
    raceTriggeredPrice: null,
    freshBarDate: null,
    freshBarLabel: null,
  };

  // Earliest fresh "BAR(<letter>.N)" reform for this same top-level
  // lineage, strictly after the BAR SL2 that ended this instance.
  const freshBarPattern = new RegExp(`^BAR\\(${inst.letter}\\.\\d+\\)$`);
  let freshBarEvent: { date: string; label: string } | null = null;
  for (const { day, events } of wtfTrace) {
    if (day.date <= inst.endDate) continue;
    const hit = events.find((e) => freshBarPattern.test(e));
    if (hit) {
      freshBarEvent = { date: day.date, label: hit.slice(4, -1) };
      break;
    }
  }

  let startIdx: number | null = null;
  for (let i = 0; i < dtfDays.length; i++) {
    if (dtfDays[i].date > inst.endDate) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === null || startIdx === 0) {
    result.outcome = "NONE";
    if (freshBarEvent !== null) {
      result.freshBarDate = freshBarEvent.date;
      result.freshBarLabel = freshBarEvent.label;
    }
    return result;
  }

  const finish = () => {
    // "SAR 2 has not occurred" -- true unless the race was triggered
    // (a real SAR 2) strictly before this fresh BAR formed.
    if (freshBarEvent !== null && (result.outcome !== "RACE_TRIGGERED" || freshBarEvent.date < (result.raceTriggeredDate as string))) {
      result.freshBarDate = freshBarEvent.date;
      result.freshBarLabel = freshBarEvent.label;
    }
    return result;
  };

  let sarRefLow = inst.endPrice;
  let invalidSarState: InvalidSarState | null = null;

  for (let i = startIdx; i < dtfDays.length; i++) {
    const prev = dtfDays[i - 1];
    const cur = dtfDays[i];

    if (invalidSarState === null) {
      // Seeking the first SAR fire off the BAR SL2 reference low --
      // same decisive-breach/quiet-ratchet-down shape as the ordinary
      // RED2-anchored SAR watch above, no "something open" gate.
      if (slShape(cur, sarRefLow)) {
        result.checkpoints.push({ date: cur.date, label: "SAR", price: cur.l });
        invalidSarState = new InvalidSarState(cur.h, cur.l);
      } else if (cur.l < sarRefLow) {
        sarRefLow = cur.l;
        result.checkpoints.push({ date: cur.date, label: "SAR LL", price: cur.l });
      } else if (cur.h > sarRefLow) {
        result.checkpoints.push({ date: cur.date, label: "SAR HH", price: cur.h });
      }
      continue;
    }

    const modeBefore = invalidSarState.mode;
    const refHighBefore = invalidSarState.refHigh;
    const refLowBefore = invalidSarState.refLow;
    const frozenBefore = invalidSarState.frozenEntryRefHigh;

    const stepResult = stepInvalidSar(invalidSarState, prev, cur);
    const checkpoint = checkpointForInvalidSarStep(modeBefore, refHighBefore, refLowBefore, frozenBefore, invalidSarState, stepResult, cur);
    if (checkpoint !== null) result.checkpoints.push(checkpoint);

    if (stepResult.sar2Now) {
      result.outcome = "RACE_TRIGGERED";
      result.raceTriggeredDate = cur.date;
      result.raceTriggeredPrice = cur.l;
      return finish();
    }
  }

  if (invalidSarState !== null && invalidSarState.mode === "ENTRY_ACTIVE") {
    result.outcome = "OPEN";
  } else if (invalidSarState !== null && invalidSarState.mode === "SEEK_REACTIVATION") {
    result.outcome = "CLOSED_SEEKING_REACTIVATION";
  } else {
    // null (SAR never fired), or still SEEK_INVALID/INVALID_SAR_ACTIVE/
    // SEEK_REFORM -- nothing has opened yet in any of these.
    result.outcome = "STILL_WATCHING";
  }
  return finish();
}

// --------------------------------------------------------------------
// POST-BAR-SL2 NEW-LINEAGE REINTERPRETATION -- user's own extension
// (session of 2026-10-22), NOT yet verified beyond PAYTM.NS, and NOT
// wired into anything live. Purely read-only: never touches TZEngine
// or its output. The raw WTF trace still literally prints a fresh
// "TZ GREEN(<newLetter>)" sibling the instant BAR SL2 opens sibling-
// spawn eligibility (TZEngine has no DTF awareness and never will --
// this is deliberately a separate layer, not a live-engine change, per
// the user's own instruction).
//
// THE RULE, as given: that unconditional spawn is only CORRECT if the
// DTF SAR watch armed off this same BAR SL2 has already decisively
// confirmed SAR 2 by that point. If it has not -- whether SAR itself
// hasn't fired yet, or has fired and gone SAR -> INVALID SAR -> INVALID
// SAR ENTRY instead -- AND the parent-tier RED1->RED2 cycle has
// completed (either before this BAR SL2, like PAYTM's own 19/01/26, OR
// a fresh RED1->RED2 completing AFTER BAR SL2 -- either counts), then
// the raw trace's "TZ GREEN(<newLetter>)" is a MISCLASSIFICATION: it
// should have been read as a fresh BAR continuing the SAME lineage,
// not a new sibling. This function only DETECTS and reports that --
// same "flag, don't duplicate the state machine" posture as
// freshBarLabel above -- it does not re-simulate the alternate BAR/
// BAR 2/BAR SL cascade that would have followed (that's a materially
// different, much larger computation: every subsequent week the raw
// trace attributes to the new sibling branch would need its own
// re-derivation under the BAR/BAR 2/BAR SL ladder instead).
//
// Scoped to the FIRST such sibling spawn after this instance's own BAR
// SL2 only -- that one is unambiguously attributable to THIS BAR SL2
// (nothing else could have opened sibling-spawn eligibility before it).
// A LATER sibling spawn (e.g. off that first sibling's own later deep
// failure) is a separate instance of the same general rule and needs
// its own analysis against ITS OWN DTF SAR watch, not this one.
export interface ReinterpretedPostBarSl2Spawn {
  letter: string; // the lineage that hit BAR SL2, e.g. "A"
  barSl2Date: string;
  spawnedAsLetter: string; // the sibling letter the raw WTF trace actually used, e.g. "B"
  spawnedAsDate: string; // that TZ GREEN(<spawnedAsLetter>) formation date
  red2CompletedDate: string; // the RED2(<letter>) date satisfying "RED1-RED2 has completed"
  sar2: { date: string; price: number } | null; // null if SAR 2 had not confirmed by spawnedAsDate
  // true: this spawn is a misclassification -- per the rule, it should
  // have been a fresh BAR on `letter`'s own lineage, not a new sibling.
  shouldBeBar: boolean;
}

/** Only applicable when `inst` ended via a WTF BAR SL2 -- null if it
 * didn't, or if no new sibling "TZ GREEN(" ever spawned after it in the
 * trace at all (nothing to reinterpret). `sarResult` must be the SAME
 * instance's own `postBarSl2Race` result -- this function does not
 * recompute the DTF SAR watch itself. */
export function reinterpretPostBarSl2Spawn(
  wtfTrace: WtfTraceEntry[],
  inst: WtfInstance,
  sarResult: PostBarSl2Result
): ReinterpretedPostBarSl2Spawn | null {
  if (inst.endEvent === null || !inst.endEvent.startsWith("BAR SL2(")) {
    return null;
  }

  // First new-sibling "TZ GREEN(<newLetter>)" formation strictly after
  // this BAR SL2 -- the raw trace's own unconditional spawn.
  let spawn: { date: string; letter: string } | null = null;
  for (const { day, events } of wtfTrace) {
    if (day.date <= inst.endDate) continue;
    for (const e of events) {
      const m = /^TZ GREEN\(([A-Z]+)\)$/.exec(e);
      if (m && m[1] !== inst.letter) {
        spawn = { date: day.date, letter: m[1] };
        break;
      }
    }
    if (spawn !== null) break;
  }
  if (spawn === null) return null;

  // RED2(<letter>) at or before the spawn date, anywhere in the trace --
  // before BAR SL2 (PAYTM's own 19/01/26) or a fresh one completing
  // AFTER it both satisfy "RED1-RED2 has completed" per the rule as
  // given.
  let red2Date: string | null = null;
  const red2Pattern = new RegExp(`^RED2\\(${inst.letter}\\)$`);
  for (const { day, events } of wtfTrace) {
    if (day.date > spawn.date) break;
    if (events.some((e) => red2Pattern.test(e))) red2Date = day.date;
  }
  if (red2Date === null) return null; // RED1-RED2 never completed -- the ordinary spawn stands as-is.

  const sar2 =
    sarResult.outcome === "RACE_TRIGGERED" && sarResult.raceTriggeredDate !== null
      ? { date: sarResult.raceTriggeredDate, price: sarResult.raceTriggeredPrice as number }
      : null;

  return {
    letter: inst.letter,
    barSl2Date: inst.endDate,
    spawnedAsLetter: spawn.letter,
    spawnedAsDate: spawn.date,
    red2CompletedDate: red2Date,
    sar2,
    // SAR 2 never confirmed at all, or confirmed only AFTER this spawn --
    // either way, this spawn preceded a real SAR 2, so it should have
    // been BAR, not a new sibling.
    shouldBeBar: sar2 === null || sar2.date > spawn.date,
  };
}

function simulateDtfAll(
  dtfDays: Day[],
  wtfTrace: WtfTraceEntry[],
  wtfDates: string[],
  inst: WtfInstance
): [PrimeTrendResult[], PrimeTrendLiveStatus | null, PostBarSl2Checkpoint[]] {
  const checkpoints = wtfCheckpoints(wtfTrace, inst.family, inst.letter, inst.formationDate, inst.endDate);

  let startIdx: number | null = null;
  for (let i = 0; i < dtfDays.length; i++) {
    if (dtfDays[i].date > inst.formationDate) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === null) return [[], null, []];

  let s1: Stage | null = null;
  // The BAR/BAR ENTRY ladder running under the current Stage 1 (TZ BUY)
  // episode -- null whenever Stage 1 isn't active. Freshly recreated
  // every time Stage 1 (re)forms (see "active TZ BUY is mandatory"
  // above), discarded outright on Stage 1's own SL.
  let barState: BarLevelState | null = null;
  const rows: PrimeTrendResult[] = [];
  // Full dated SAR/INVALID SAR/SAR 2 checkpoint ladder for the RECURRING,
  // RED2-anchored SAR mechanism below -- same shape and same labels as
  // postBarSl2Race's own checkpoint list, just recorded alongside this
  // function's own already-correct state instead of a second, separately
  // re-derived simulation (avoids any risk of the two diverging). Purely
  // additive: every push below happens at a point this function's
  // existing control flow already decided on its own, nothing here
  // changes when or whether anything fires. Confirmed real-data
  // (DIXON.NS): this is what makes 2021-08-24's "SAR 2" visible at all --
  // it fires with nothing open (the BAR ENTRY position already closed
  // the day before, via 2021-08-23's own SAR), so `rows` alone never
  // carries it.
  const sarCheckpoints: PostBarSl2Checkpoint[] = [];

  // --- DTF PBAR / PBAR ENTRY -- own ladder (see this module's header
  // for the full derivation). Requires THREE conditions simultaneously,
  // continuously, not just once at the start: WTF BAR (this specific
  // label) active, WTF TZ BUY 2 active (already guaranteed -- this
  // whole function only runs within this instance's own window), and
  // DTF BAR ENTRY inactive. The moment WTF BAR's own governing window
  // ends (its own confirmed SL, or a fresh reform superseding it -- see
  // wtfBarWindowsForLetter), the ladder is wiped outright (any open
  // PBAR ENTRY force-closed) and can only restart fresh at the NEXT
  // qualifying window -- it does NOT carry over accumulated RED-gate
  // state across that boundary (confirmed via real COCHINSHIP.NS data:
  // WTF BAR(B.1) SL'd then reformed a week later, and DTF needed a
  // brand new RED1 afterward, not an immediate reform off the
  // already-unlocked pre-SL door).
  const pbarWindows = wtfBarWindowsForLetter(wtfTrace, inst.letter, inst.formationDate, inst.endDate);
  let pbarWindowIdx = 0;
  let pbarState: PbarLevelState | null = null;
  // DTF PBAR's own "Path 1" anchor -- the WTF BAR's reference high,
  // seeded at this window's own formationHigh and then climbing quietly
  // on each later DAY's own High directly (see WtfBarWindow's own
  // comment for why: same look-ahead trap preS1Ref avoids). Reseeded
  // every time pbarWindowIdx moves to a new window.
  let wtfBarRefHigh = 0;
  let wtfBarRefHighWindowIdx = -1;

  // DTF SAR -- a recurring kill-switch on the whole PRIME TREND (BAR
  // ENTRY and PBAR ENTRY alike), independent of the WTF anchor's own
  // life (inst.endEvent/BAR SL2 below is a separate, WTF-side exit).
  // Each fresh WTF RED1->RED2 (red2EventsForLetter) re-arms sarRefLow at
  // that RED2's own confirming Low, which then ratchets further down on
  // later DTF days' own new lows ("RED2 LL") until a decisive breach
  // (gap>=THRESH, close<=ref) fires SAR -- closing whatever is open and
  // permanently freezing BAR/PBAR tracking for the rest of this
  // instance: per spec, reactivation past a SAR exit is only through
  // BAR theory (TAR/BAR1-BAR2), not a fresh ordinary BAR/PBAR cycle --
  // BAR theory itself is not yet implemented, so this instance simply
  // goes dormant from here, same honest "nothing more to report" as any
  // other not-yet-modeled reactivation path.
  const red2Events = red2EventsForLetter(wtfTrace, inst.letter, inst.formationDate, inst.endDate);
  let red2EventIdx = 0;
  let sarRefLow: number | null = null;
  let sarFired = false;

  // BAR THEORY -- TAR/TAR ENTRY and the nested BAR1/BAR2 cascade (see the
  // module section comment above). Reuses pbarWindows/pbarWindowIdx/
  // wtfBarRefHigh verbatim (identical "WTF BAR active" windowing as
  // PBAR), but only ever runs once sarFired -- before that, PBAR owns
  // this same window set. Wiped at the same window boundaries PBAR's own
  // ladder is (below), including the gate-tracking fields.
  let tarState: TarLevelState | null = null;
  let bar1State: Bar1LevelState | null = null;
  let tarSlEverHappened = false;
  let bar12Red: BarRedGate | null = null;
  let bar12RedEverConfirmed = false;
  // Once a TAR ENTRY SL has ever fired (clean or combined -- any closure
  // of TAR_ENTRY_ACTIVE), TAR is permanently dormant for the rest of this
  // window: no new TAR ENTRY can ever occur again, whatever price does
  // later -- confirmed via KALYANKJIL: 2025-04-25's TAR ENTRY SL rules
  // out the reactivation that would otherwise show on 2025-05-13.
  // Likewise, once BAR 1 - BAR 2's own BAR2_ACTIVE has been reached and
  // closed (clean "DTF BAR 2 SL" or combined "DTF BAR 1 SL + DTF BAR 2
  // SL"), BAR 2 can never reactivate above its reference high again
  // either -- same symmetric rule, one level up.
  let tarEntrySlEverHappened = false;
  let bar2EverClosed = false;

  // INVALID SAR / INVALID SAR ENTRY -- see the module section comment
  // above stepInvalidSar. invalidSarState is non-null from the moment
  // SAR fires until SAR 2 ends it; while it is non-null and not in the
  // post-SL reactivation race, ordinary BAR THEORY (TAR ENTRY, BAR 1 -
  // BAR 2) is suppressed from the report (invalidSarSuppressesBarTheory).
  // anyInvalidationSinceLastSar decides, the next time SAR fires again,
  // whether that firing is just a fresh SAR (an invalidation happened
  // since the last one) or SAR 2 (none did).
  //
  // SAR 2 is NOT a terminal exit for the whole instance -- confirmed:
  // "SAR 2 is kind of PAUSE which can get reactivated if BAR - TAR - TAR
  // ENTRY (or BAR 1 - BAR 2) stays active until new SAR occurs... it
  // terminates the idea of INVALID SAR ENTRY for THAT BAR" only. It just
  // sets invalidSarState back to null -- BAR THEORY keeps running
  // unsuppressed from there (same as always, once invalidSarState is
  // null), and the NEXT genuine SAR fire (a fresh RED2 re-arming and
  // decisively breaching again) gets its own fresh, independent
  // fresh-SAR-vs-SAR-2 classification, same as any other SAR fire --
  // there is no permanent flag blocking that. The real terminal exit
  // from PRIME TREND is the WTF-level BAR SL2 event, which is already
  // handled separately (it's this instance's own endDate/endEvent, see
  // runWtfTrace/instances) -- "unless REAR 2 occurs" is likewise already
  // handled as its own separate WTF instance, not by anything here.
  let invalidSarState: InvalidSarState | null = null;
  let anyInvalidationSinceLastSar = false;

  // Stage 1's own "since it last (re)formed" tracking, purely for
  // PrimeTrendLiveStatus (computePrimeTrend's own historical trade log
  // has no use for this, per the Filter rule: a Stage-1-only window is
  // never a reported trade).
  let s1Since: string | null = null;
  let s1ActivationPrice: number | null = null;
  let hh1 = 0;
  let hh1Date: string | null = null;

  // The anchor Stage 1 breaks out against, BEFORE Stage 1 first forms.
  // Seeded from the WTF instance's own formation-week High (checkpoints[0]
  // is always that formation event), then climbs quietly on any later DAY's
  // own High once the formation week is over -- it does NOT wait for a
  // whole further WTF week to close first. WTF is only a derived resample
  // of these same daily bars, so a week's cumulative high is real,
  // already-known information the moment the day that set it has closed,
  // not a look-ahead risk to any later day in that same still-forming
  // week. (Confirmed live, INDORAMA.NS 2026-09-24: 15/09 printed a High of
  // 96.50 with a weak Close, quietly raising the anchor from 90.00 that
  // same week -- the old week-boundary-only lookup kept using the stale
  // 90.00 through 18/09, wrongly confirming Stage 1 there instead of the
  // genuine breakout on 21/09.)
  let preS1Ref: number | null = checkpoints.length > 0 ? checkpoints[0][1] : null;

  const pushRow = (
    level: number,
    side: PrimeTrendResult["side"],
    entryDate: string,
    entryPrice: number,
    exitType: string,
    exitDate: string,
    exitPrice: number,
    hh: number,
    hhDate: string | null
  ) => {
    rows.push({
      family: inst.family,
      letter: inst.letter,
      wtfFormationDate: inst.formationDate,
      level,
      side,
      entryDate,
      entryPrice,
      exitType,
      exitDate,
      exitPrice,
      highestHigh: hhDate ? hh : null,
      highestHighDate: hhDate,
    });
  };

  let i = startIdx;
  while (i < dtfDays.length && dtfDays[i].date <= inst.endDate) {
    const prev = dtfDays[i - 1];
    const cur = dtfDays[i];

    if (s1 !== null && s1.active && cur.h > hh1) {
      hh1 = cur.h;
      hh1Date = cur.date;
    }

    // --- Stage 1: DTF TZ BUY (unchanged) ---
    const wasS1Active = s1 !== null && s1.active;
    if (s1 === null) {
      if (preS1Ref !== null && containingWeekStart(wtfDates, cur.date) !== inst.formationDate) {
        if (breakoutShape(prev, cur, preS1Ref)) {
          s1 = new Stage(cur.h, cur.l);
          s1Since = cur.date;
          s1ActivationPrice = cur.h;
          // Highest High includes the entry candle's own High, not just
          // days after it -- see the Highest High comment on
          // PrimeTrendLiveStatus above.
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
      } else {
        if (cur.l < s1.refLow) s1.refLow = cur.l;
        if (cur.h > s1.refHigh && cur.h - s1.refHigh >= ANY) s1.refHigh = cur.h;
      }
    } else {
      const frozenRef = s1.frozenRef as number;
      // While PBAR/PBAR ENTRY is in an active tier, TZ BUY cannot
      // reactivate -- that race is already decided in PBAR's favor. The
      // reference high still climbs quietly underneath so that if PBAR
      // later drops back out of an active tier, TZ BUY's reactivation
      // watch resumes from an accurate reference rather than a stale
      // pre-PBAR one.
      const pbarCurrentlyActive =
        pbarState !== null &&
        (pbarState.mode === "PBAR_ACTIVE" ||
          pbarState.mode === "PBAR_ENTRY_ACTIVE" ||
          pbarState.mode === "SEEK_PBAR_ENTRY_REACTIVATION");
      if (!pbarCurrentlyActive && breakoutShape(prev, cur, frozenRef)) {
        s1 = new Stage(cur.h, cur.l);
        s1Since = cur.date;
        s1ActivationPrice = cur.h;
        hh1 = cur.h;
        hh1Date = cur.date;
      } else if (cur.h > frozenRef && cur.h - frozenRef >= ANY) {
        s1.frozenRef = cur.h;
      }
    }
    const isS1Active = s1 !== null && s1.active;

    // --- TZ BUY's own SL wipes the whole BAR/BAR ENTRY structure outright ---
    if (wasS1Active && !isS1Active) {
      if (barState !== null && barState.mode === "BAR_ENTRY_ACTIVE" && barState.rowEntryDate !== null) {
        pushRow(
          barState.level,
          sideForBarLevel(barState.level),
          barState.rowEntryDate,
          barState.rowEntryPrice as number,
          "DTF TZ BUY SL (wipes ENTRY)",
          cur.date,
          (s1 as Stage).refLow,
          barState.rowHH,
          barState.rowHHDate
        );
      }
      barState = null;
    }
    // --- TZ BUY's own (re)formation starts a brand new BAR/BAR ENTRY window ---
    if (!wasS1Active && isS1Active && !sarFired) {
      barState = new BarLevelState(0, null);
    }

    // --- BAR / BAR ENTRY ladder, only while TZ BUY is active ---
    if (isS1Active && barState !== null && !sarFired) {
      const { opened, closed, nestedClosed } = stepBarLevel(barState, prev, cur);
      if (opened) {
        barState.rowEntryDate = cur.date;
        barState.rowEntryPrice = opened.price;
      }
      if (closed) {
        pushRow(
          barState.level,
          sideForBarLevel(barState.level),
          barState.rowEntryDate as string,
          barState.rowEntryPrice as number,
          closed.exitType,
          cur.date,
          closed.exitPrice,
          barState.rowHH,
          barState.rowHHDate
        );
      }
      // Nested daily BAR1->BAR2 (inside an already-active BAR ENTRY) is
      // kept running internally but deliberately not surfaced as its own
      // row right now -- confirmed: suppress it everywhere it could
      // occur (BAR ENTRY today; TAR ENTRY, BAR 1 - BAR 2, PBAR ENTRY if
      // any of them ever gain the same nested mechanism later), not just
      // here.
      void nestedClosed;
    }

    // --- DTF PBAR / PBAR ENTRY --------------------------------------
    const barEntryActiveNow = barState !== null && barState.mode === "BAR_ENTRY_ACTIVE";

    // "DTF BAR ENTRY inactive" is also a continuous precondition -- if
    // BAR ENTRY becomes active while PBAR is only seeking (not yet in
    // an active tier; once PBAR is in an active tier the exclusivity
    // rule above already prevents BAR ENTRY from ever forming), wipe
    // the seeking structure outright. Nothing to close -- no entry was
    // ever open in these modes.
    if (pbarState !== null && barEntryActiveNow && (pbarState.mode === "SEEK_PBAR" || pbarState.mode === "SEEK_REACTIVATION")) {
      pbarState = null;
    }

    // WTF BAR's own governing window ending (its own confirmed SL, or a
    // fresh reform superseding it) wipes the ladder outright too -- any
    // open PBAR ENTRY is force-closed, and a fresh structure can only
    // start at the NEXT qualifying window.
    while (pbarWindowIdx < pbarWindows.length && pbarWindows[pbarWindowIdx].endDate !== null && cur.date > (pbarWindows[pbarWindowIdx].endDate as string)) {
      if (pbarState !== null && pbarState.mode === "PBAR_ENTRY_ACTIVE" && pbarState.rowEntryDate !== null) {
        const windowExitType =
          pbarWindows[pbarWindowIdx].endReason === "BAR SL" ? "WTF BAR SL (wipes ENTRY)" : "WTF BAR reform (wipes ENTRY)";
        pushRow(
          0,
          "PBAR ENTRY",
          pbarState.rowEntryDate,
          pbarState.rowEntryPrice as number,
          windowExitType,
          pbarWindows[pbarWindowIdx].endDate as string,
          pbarState.pbarEntryRefLow,
          pbarState.rowHH,
          pbarState.rowHHDate
        );
      }
      pbarState = null;
      // BAR theory's own structures and gate-tracking are wiped at the
      // exact same WTF-BAR-window boundary -- same "does not carry over
      // accumulated gate state across the boundary" rule PBAR's own
      // ladder already confirmed.
      if (tarState !== null && tarState.mode === "TAR_ENTRY_ACTIVE" && tarState.rowEntryDate !== null) {
        const windowExitType =
          pbarWindows[pbarWindowIdx].endReason === "BAR SL" ? "WTF BAR SL (wipes ENTRY)" : "WTF BAR reform (wipes ENTRY)";
        pushRow(
          0,
          "TAR ENTRY",
          tarState.rowEntryDate,
          tarState.rowEntryPrice as number,
          windowExitType,
          pbarWindows[pbarWindowIdx].endDate as string,
          tarState.tarEntryRefLow,
          tarState.rowHH,
          tarState.rowHHDate
        );
      }
      if (bar1State !== null && bar1State.mode === "BAR2_ACTIVE" && bar1State.rowEntryDate !== null) {
        const windowExitType =
          pbarWindows[pbarWindowIdx].endReason === "BAR SL" ? "WTF BAR SL (wipes ENTRY)" : "WTF BAR reform (wipes ENTRY)";
        pushRow(
          0,
          "BAR 1 - BAR 2",
          bar1State.rowEntryDate,
          bar1State.rowEntryPrice as number,
          windowExitType,
          pbarWindows[pbarWindowIdx].endDate as string,
          bar1State.bar2RefLow,
          bar1State.rowHH,
          bar1State.rowHHDate
        );
      }
      tarState = null;
      bar1State = null;
      tarSlEverHappened = false;
      tarEntrySlEverHappened = false;
      bar12Red = null;
      bar12RedEverConfirmed = false;
      bar2EverClosed = false;
      pbarWindowIdx += 1;
    }

    // Start a fresh structure once we're inside a qualifying window,
    // nothing is currently running, and DTF BAR ENTRY is inactive.
    if (pbarState === null && pbarWindowIdx < pbarWindows.length && !sarFired) {
      const w = pbarWindows[pbarWindowIdx];
      if (cur.date > w.formationDate && (w.endDate === null || cur.date <= w.endDate) && !barEntryActiveNow) {
        pbarState = new PbarLevelState();
      }
    }

    // wtfBarRefHigh's own reseed on every window change -- gated on the
    // same "day after formation" start as pbarState itself, otherwise
    // the seed would pick up price action from long before this window
    // (and its own WTF BAR) even existed.
    const inPbarWindow = pbarWindowIdx < pbarWindows.length && cur.date > pbarWindows[pbarWindowIdx].formationDate;
    if (inPbarWindow && wtfBarRefHighWindowIdx !== pbarWindowIdx) {
      wtfBarRefHigh = pbarWindows[pbarWindowIdx].formationHigh;
      wtfBarRefHighWindowIdx = pbarWindowIdx;
    }

    if (pbarState !== null) {
      const { opened, closed } = stepPbarLevel(pbarState, prev, cur, wtfBarRefHigh);
      if (opened) {
        pbarState.rowEntryDate = cur.date;
        pbarState.rowEntryPrice = opened.price;
      }
      if (closed) {
        pushRow(
          0,
          "PBAR ENTRY",
          pbarState.rowEntryDate as string,
          pbarState.rowEntryPrice as number,
          closed.exitType,
          cur.date,
          closed.exitPrice,
          pbarState.rowHH,
          pbarState.rowHHDate
        );
      }
    }

    // --- BAR THEORY: TAR/TAR ENTRY and the nested BAR 1 - BAR 2 cascade ----
    // Only runs once sarFired -- reuses the same pbarWindows/pbarWindowIdx/
    // wtfBarRefHigh as PBAR above (identical "WTF BAR active" windowing;
    // wiped at the same window boundaries, see the while-loop above).
    if (sarFired && pbarWindowIdx < pbarWindows.length) {
      const w = pbarWindows[pbarWindowIdx];
      if (cur.date > w.formationDate && (w.endDate === null || cur.date <= w.endDate)) {
        // TAR keeps seeking new formations until EITHER of two things ends
        // it for good, permanently, for the rest of this window -- no new
        // TAR formation or reactivation ever starts again after, whatever
        // price does later:
        //   (1) a TAR ENTRY SL ever fires (clean or combined -- any
        //       closure of TAR_ENTRY_ACTIVE) -- confirmed via KALYANKJIL:
        //       2025-04-25's TAR ENTRY SL rules out the reactivation that
        //       would otherwise show on 2025-05-13.
        //   (2) BAR 1 - BAR 2 is currently ACTIVE (BAR2_ACTIVE) -- TAR
        //       cannot jump in while it's running, confirmed via
        //       KALYANKJIL: once BAR 1 - BAR 2 entered 2025-06-25, TAR
        //       cannot reactivate above it (the 2025-07-02 row this would
        //       otherwise produce is impossible).
        // (BAR 1 - BAR 2's own unlock gate -- TAR SL ever + RED1->RED2
        // ever -- is unaffected: a bare, pre-escalation TAR SL still
        // counts toward it even once TAR itself has gone permanently
        // dormant.)
        const bar12CurrentlyActive = bar1State !== null && bar1State.mode === "BAR2_ACTIVE";
        if (!tarEntrySlEverHappened && !bar12CurrentlyActive) {
          // Eligibility to form is governed ENTIRELY by "WTF BAR active"
          // (the pbarWindowIdx/formationDate/endDate check above) -- the
          // same WTF-anchor-active precondition every DTF entry (BAR
          // ENTRY, PBAR ENTRY, TAR ENTRY alike) requires: unless the
          // governing WTF-level tier (TZ BUY 2 / BAR / REAR 2 / REAR
          // ENTRY 2) is currently active, DTF cannot generate any entry
          // at all. sarRefLow merely being ARMED (a RED2 confirmed, SAR
          // not yet fired from it) is a completely different, DTF-level
          // concern and must never additionally block formation -- that
          // would decide today based on what MIGHT happen later.
          // Confirmed via COCHINSHIP: TAR forms 2024-12-02 and TAR ENTRY
          // 2024-12-03 purely on the OHLC's own terms, because BAR(B.2)
          // (formed 2024-11-25, after the SAR exit) is still the active
          // WTF anchor -- irrespective of RED2(B) 2024-11-18 having
          // already armed (and never firing) sarRefLow in the
          // background. Equally confirmed via DIXON: BAR 1 - BAR 2 forms
          // 2022-02-10 under BAR(A.2) (formed 2021-08-30, still active --
          // it has no "BAR SL(A.2)" of its own until 2022-05-02), with
          // TAR SL already having happened and the DTF RED1->RED2
          // tracker already confirmed -- same gate, same result.
          if (tarState === null) tarState = new TarLevelState();

          const tarResult = stepTarLevel(tarState, prev, cur, wtfBarRefHigh);
          if (tarResult.opened) {
            tarState.rowEntryDate = cur.date;
            tarState.rowEntryPrice = tarResult.opened.price;
          }
          if (tarResult.closed) {
            if (!invalidSarSuppressesBarTheory(invalidSarState)) {
              pushRow(
                0,
                "TAR ENTRY",
                tarState.rowEntryDate as string,
                tarState.rowEntryPrice as number,
                tarResult.closed.exitType,
                cur.date,
                tarResult.closed.exitPrice,
                tarState.rowHH,
                tarState.rowHHDate
              );
            }
            tarEntrySlEverHappened = true;
            tarState = null;
          }
          if (tarResult.tarSlNow) tarSlEverHappened = true;
        }

        // The nested cascade's own continuous RED1->RED2 tracker --
        // independent of TAR's own state, same shape as everywhere else
        // in this file -- half of BAR 1 - BAR 2's unlock gate.
        if (bar12Red === null) {
          if (isBarRed1Shape(prev, cur)) bar12Red = new BarRedGate(cur.h, cur.l);
        } else {
          const result = stepBarRed(bar12Red, prev, cur);
          if (result === "confirmed") {
            bar12Red = null;
            bar12RedEverConfirmed = true;
          } else if (result === "invalid") {
            bar12Red = null;
          }
        }

        // Same symmetric rule one level up: once BAR 2 has been reached
        // and closed (clean "DTF BAR 2 SL" or combined "DTF BAR 1 SL +
        // DTF BAR 2 SL"), BAR 2 can never reactivate above its reference
        // high again either -- permanently dormant for the rest of this
        // window. Same "WTF BAR active" governs eligibility note as TAR
        // above -- sarRefLow merely being armed (not yet fired) is a
        // different, DTF-level concern and must never additionally block
        // a new BAR 1 cycle from starting.
        if (tarSlEverHappened && bar12RedEverConfirmed && !bar2EverClosed) {
          if (bar1State === null) bar1State = new Bar1LevelState();

          const { opened, closed } = stepBar1Level(bar1State, prev, cur);
          if (opened) {
            bar1State.rowEntryDate = cur.date;
            bar1State.rowEntryPrice = opened.price;
          }
          if (closed) {
            if (!invalidSarSuppressesBarTheory(invalidSarState)) {
              pushRow(
                0,
                "BAR 1 - BAR 2",
                bar1State.rowEntryDate as string,
                bar1State.rowEntryPrice as number,
                closed.exitType,
                cur.date,
                closed.exitPrice,
                bar1State.rowHH,
                bar1State.rowHHDate
              );
            }
            bar2EverClosed = true;
            bar1State = null;
          }
        }
      }
    }

    // --- INVALID SAR / INVALID SAR ENTRY -- see stepInvalidSar's own
    // comment above. Only steps once SAR has fired and a cycle is
    // currently live (invalidSarState non-null) -- SAR 2 ends the
    // CURRENT cycle (sets it to null) but not the mechanism itself; see
    // the module-level comment above for why there's no permanent gate.
    if (invalidSarState !== null) {
      const checkpointModeBefore = invalidSarState.mode;
      const checkpointRefHighBefore = invalidSarState.refHigh;
      const checkpointRefLowBefore = invalidSarState.refLow;
      const checkpointFrozenBefore = invalidSarState.frozenEntryRefHigh;
      const invalidSarResult = stepInvalidSar(invalidSarState, prev, cur);
      if (invalidSarResult.invalidSarNow) anyInvalidationSinceLastSar = true;
      if (invalidSarResult.opened) {
        invalidSarState.rowEntryDate = cur.date;
        invalidSarState.rowEntryPrice = invalidSarResult.opened.price;
      }
      if (invalidSarResult.closed) {
        pushRow(
          0,
          "INVALID SAR ENTRY",
          invalidSarState.rowEntryDate as string,
          invalidSarState.rowEntryPrice as number,
          invalidSarResult.closed.exitType,
          cur.date,
          invalidSarResult.closed.exitPrice,
          invalidSarState.rowHH,
          invalidSarState.rowHHDate
        );
      }
      // Same checkpoint rule postBarSl2Race's own standalone simulation
      // of this identical state machine uses -- see checkpointForInvalidSarStep's
      // own comment above.
      const sarCheckpoint = checkpointForInvalidSarStep(
        checkpointModeBefore,
        checkpointRefHighBefore,
        checkpointRefLowBefore,
        checkpointFrozenBefore,
        invalidSarState,
        invalidSarResult,
        cur
      );
      if (sarCheckpoint !== null) sarCheckpoints.push(sarCheckpoint);
      // "SAR 2" via a decisive breach within SEEK_INVALID itself (no
      // fresh RED2 needed) -- same effect as the recurring DTF SAR's own
      // SAR 2 path below: ends THIS cycle (back to plain BAR THEORY,
      // unsuppressed), not the mechanism permanently -- the next fresh
      // SAR fire still gets its own independent classification.
      if (invalidSarResult.sar2Now) {
        invalidSarState = null;
      }
    }

    // --- DTF SAR -- recurring kill-switch, independent of BAR/PBAR state ---
    // Re-arm on every fresh WTF RED2, superseding any earlier, never-fired
    // watch. RED2's own refLow is that WHOLE WTF week's own Low -- not
    // knowable in full until the week closes -- so arming must wait until
    // we're into the NEXT WTF week, not merely the day after RED2's own
    // week-start date (which would seed the real, eventual low days before
    // it actually happened, a look-ahead bug of the same shape Path 1's
    // wtfBarRefHigh had before).
    while (
      red2EventIdx < red2Events.length &&
      cur.date > red2Events[red2EventIdx].date &&
      containingWeekStart(wtfDates, cur.date) !== red2Events[red2EventIdx].date
    ) {
      sarRefLow = red2Events[red2EventIdx].refLow;
      red2EventIdx += 1;
    }
    // SAR itself is recurring: it must keep re-arming and firing on EVERY
    // qualifying RED2, not just the first ever -- `sarFired` below is a
    // SEPARATE, permanent flag (gates the ordinary BAR/PBAR ladder from
    // ever resuming once SAR has fired at all, per "reactivation past a
    // SAR exit is only through BAR theory"); it must never also gate
    // whether SAR itself can fire again.
    //
    // SAR is purely an EXIT -- confirmed: "SAR is not important unless
    // BAR ENTRY/PBAR ENTRY is active... as long as we do not have any
    // entry what is point of looking for SAR." This gate applies ONLY to
    // the very first SAR this instance ever fires -- before that, SAR
    // is just an exit for the pre-SAR ladder (BAR ENTRY/PBAR ENTRY), and
    // a decisive breach with neither active is not evaluated as a SAR
    // event at all (does not fire, does not spend the watch -- the
    // reference low still ratchets quietly in the background on the new
    // low either way, same as any ordinary non-breach lower low, so the
    // watch stays live until a breach coincides with one of them being
    // open). Confirmed via COCHINSHIP: the 2023-01-10 breach of
    // sarRefLow=245.90 (armed off RED2(B) 2022-12-19) landed with BAR
    // ENTRY already SL'd (2022-12-23) and PBAR not yet even seeking --
    // nothing open -- so it must NOT fire; 2023-05-03/2023-07-11 are
    // PBAR ENTRY, not TAR ENTRY.
    //
    // Once SAR has fired for real at least once, this gate no longer
    // applies -- from there on SAR is the already-confirmed recurring
    // kill-switch, independent of BAR/PBAR/TAR/BAR-theory state (it
    // drives the INVALID SAR / SAR 2 progression on every qualifying
    // RED2 regardless of whether anything is currently open to close).
    // Confirmed via COCHINSHIP: 2024-12-23's SAR fires with BAR 1 - BAR 2
    // only at SEEK_BAR1 (nothing open) -- still a real SAR, opening the
    // gate to INVALID SAR/INVALID SAR ENTRY.
    const firstSarHasEntryToExit =
      (barState !== null && barState.mode === "BAR_ENTRY_ACTIVE") ||
      (pbarState !== null && pbarState.mode === "PBAR_ENTRY_ACTIVE");
    const shouldEvaluateSarFire = sarFired || firstSarHasEntryToExit;
    if (sarRefLow !== null) {
      if (shouldEvaluateSarFire && slShape(cur, sarRefLow)) {
        sarCheckpoints.push({ date: cur.date, label: "SAR", price: cur.l });
        // Captured BEFORE sarFired is overwritten below -- distinguishes
        // the very first SAR ever (never "SAR 2") from a later one.
        const sarFiredAlready = sarFired;
        const barTheorySuppressed = invalidSarSuppressesBarTheory(invalidSarState);
        sarFired = true;
        if (barState !== null && barState.mode === "BAR_ENTRY_ACTIVE" && barState.rowEntryDate !== null) {
          pushRow(
            barState.level,
            sideForBarLevel(barState.level),
            barState.rowEntryDate,
            barState.rowEntryPrice as number,
            "DTF SAR",
            cur.date,
            sarRefLow,
            barState.rowHH,
            barState.rowHHDate
          );
        }
        barState = null;
        if (pbarState !== null && pbarState.mode === "PBAR_ENTRY_ACTIVE" && pbarState.rowEntryDate !== null) {
          pushRow(
            0,
            "PBAR ENTRY",
            pbarState.rowEntryDate,
            pbarState.rowEntryPrice as number,
            "DTF SAR",
            cur.date,
            sarRefLow,
            pbarState.rowHH,
            pbarState.rowHHDate
          );
        }
        pbarState = null;
        // A later SAR can equally well land on an open BAR-theory position
        // (TAR ENTRY or BAR 1 - BAR 2) instead of the ordinary ladder --
        // close whichever is open, then reset BAR theory's own within-
        // window gate-tracking outright: a fresh SAR re-arms everything,
        // same as a brand new post-SAR WTF BAR window would.
        if (
          !barTheorySuppressed &&
          tarState !== null &&
          tarState.mode === "TAR_ENTRY_ACTIVE" &&
          tarState.rowEntryDate !== null
        ) {
          pushRow(
            0,
            "TAR ENTRY",
            tarState.rowEntryDate,
            tarState.rowEntryPrice as number,
            "DTF SAR",
            cur.date,
            sarRefLow,
            tarState.rowHH,
            tarState.rowHHDate
          );
        }
        if (
          !barTheorySuppressed &&
          bar1State !== null &&
          bar1State.mode === "BAR2_ACTIVE" &&
          bar1State.rowEntryDate !== null
        ) {
          pushRow(
            0,
            "BAR 1 - BAR 2",
            bar1State.rowEntryDate,
            bar1State.rowEntryPrice as number,
            "DTF SAR",
            cur.date,
            sarRefLow,
            bar1State.rowHH,
            bar1State.rowHHDate
          );
        }
        tarState = null;
        bar1State = null;
        tarSlEverHappened = false;
        tarEntrySlEverHappened = false;
        bar12Red = null;
        bar12RedEverConfirmed = false;
        bar2EverClosed = false;

        // INVALID SAR ENTRY itself -- close any open row, then decide
        // whether THIS SAR firing is "SAR 2" (no invalidation happened
        // since the last SAR -- ends only THIS cycle, see module-level
        // comment above) or just a fresh SAR (one did) that opens a new
        // cycle. Either way this always runs -- there is no permanent
        // gate once SAR has fired once.
        //
        // "SAR 2" only applies when there's a currently LIVE cycle that
        // never invalidated -- if the mechanism is currently dormant
        // (invalidSarState already null, e.g. a previous SAR 2 already
        // paused it, or this is the very first SAR ever), THIS fire is
        // always just a fresh SAR that opens a brand new cycle, never a
        // repeat SAR 2 -- anyInvalidationSinceLastSar is stale leftover
        // bookkeeping from a dead cycle, not a reason to stay paused.
        // Confirmed via COCHINSHIP: 2024-08-06's SAR 2 (immediate
        // breach the day after the first-ever SAR) must not keep
        // re-firing as SAR 2 forever after -- 2024-12-23's fresh RED2-
        // armed SAR must open a real INVALID SAR cycle.
        const hasLiveCycleWithoutInvalidation = invalidSarState !== null && !anyInvalidationSinceLastSar;
        if (invalidSarState !== null && invalidSarState.mode === "ENTRY_ACTIVE" && invalidSarState.rowEntryDate !== null) {
          pushRow(
            0,
            "INVALID SAR ENTRY",
            invalidSarState.rowEntryDate,
            invalidSarState.rowEntryPrice as number,
            "DTF SAR",
            cur.date,
            sarRefLow,
            invalidSarState.rowHH,
            invalidSarState.rowHHDate
          );
        }
        // Every fresh SAR fire opens a new INVALID SAR cycle, whatever
        // BAR THEORY's own state is (even fully dormant, nothing open or
        // seeking) -- confirmed via DIXON: the 2022-02-18 recurring SAR
        // refire, with TAR and BAR 1 - BAR 2 both fully dormant (TAR SL
        // 2022-01-27, BAR 2 SL 2022-02-11, no WTF BAR reform yet), opens
        // exactly the INVALID SAR cycle already independently confirmed
        // by this file's own header comment above (23/02/22 INVALID SAR
        // -> 24/02/22 INVALID SAR SL -> 25/02/22 INVALID SAR (reform) ->
        // 07/03/22 INVALID SAR SL), which continues on to the real
        // 2022-04-05 INVALID SAR ENTRY. An earlier attempt to gate this
        // on BAR THEORY being "alive" broke that already-confirmed
        // chain -- removed.
        if (sarFiredAlready && hasLiveCycleWithoutInvalidation) {
          // SAR 2 -- ends THIS cycle only (invalidSarState back to
          // null, BAR THEORY unsuppressed from here); the next fresh
          // SAR fire gets its own independent classification.
          sarCheckpoints.push({ date: cur.date, label: "SAR 2", price: cur.l });
          invalidSarState = null;
        } else {
          invalidSarState = new InvalidSarState(cur.h, cur.l);
          anyInvalidationSinceLastSar = false;
        }
        // Spent -- must re-arm from a FRESH RED2 before firing again.
        sarRefLow = null;
      } else if (cur.l < sarRefLow) {
        sarRefLow = cur.l;
        sarCheckpoints.push({ date: cur.date, label: "SAR LL", price: cur.l });
      }
    }

    // Only climb wtfBarRefHigh AFTER today's own Path 1 breakout check has
    // already run against the STALE (pre-today) value -- same ordering
    // preS1Ref uses, otherwise today's own High would always already be
    // baked into the reference it's being compared against, making the
    // breakout structurally impossible.
    if (inPbarWindow && cur.h > wtfBarRefHigh) wtfBarRefHigh = cur.h;

    i += 1;
  }

  // Window ended with an open BAR-ENTRY-level row -- the exit is whatever
  // ended this WTF instance (already resolved on inst), same as the old
  // Stage 2 "still open" handling.
  if (barState !== null && barState.mode === "BAR_ENTRY_ACTIVE" && barState.rowEntryDate !== null) {
    const exitType = inst.endEvent !== null ? inst.endEvent : "still open";
    pushRow(
      barState.level,
      sideForBarLevel(barState.level),
      barState.rowEntryDate,
      barState.rowEntryPrice as number,
      exitType,
      inst.endDate,
      inst.endPrice as number,
      barState.rowHH,
      barState.rowHHDate
    );
  }
  // Same "still open" handling for the PBAR track, independently -- it
  // may well still be open even when the BAR track above has already
  // closed out (or vice versa), since neither track depends on the other.
  if (pbarState !== null && pbarState.mode === "PBAR_ENTRY_ACTIVE" && pbarState.rowEntryDate !== null) {
    const exitType = inst.endEvent !== null ? inst.endEvent : "still open";
    pushRow(
      0,
      "PBAR ENTRY",
      pbarState.rowEntryDate,
      pbarState.rowEntryPrice as number,
      exitType,
      inst.endDate,
      inst.endPrice as number,
      pbarState.rowHH,
      pbarState.rowHHDate
    );
  }
  // Same "still open" handling for BAR theory's own two tracks (TAR,
  // BAR1/BAR2) -- only ever non-null once sarFired, same independence
  // between tracks as above. Still suppressed from the report if
  // INVALID SAR ENTRY was active (and never resolved) when the instance
  // itself ended.
  const barTheorySuppressedAtEnd = invalidSarSuppressesBarTheory(invalidSarState);
  if (!barTheorySuppressedAtEnd && tarState !== null && tarState.mode === "TAR_ENTRY_ACTIVE" && tarState.rowEntryDate !== null) {
    const exitType = inst.endEvent !== null ? inst.endEvent : "still open";
    pushRow(
      0,
      "TAR ENTRY",
      tarState.rowEntryDate,
      tarState.rowEntryPrice as number,
      exitType,
      inst.endDate,
      inst.endPrice as number,
      tarState.rowHH,
      tarState.rowHHDate
    );
  }
  if (!barTheorySuppressedAtEnd && bar1State !== null && bar1State.mode === "BAR2_ACTIVE" && bar1State.rowEntryDate !== null) {
    const exitType = inst.endEvent !== null ? inst.endEvent : "still open";
    pushRow(
      0,
      "BAR 1 - BAR 2",
      bar1State.rowEntryDate,
      bar1State.rowEntryPrice as number,
      exitType,
      inst.endDate,
      inst.endPrice as number,
      bar1State.rowHH,
      bar1State.rowHHDate
    );
  }
  // Same "still open" handling for INVALID SAR ENTRY itself.
  if (invalidSarState !== null && invalidSarState.mode === "ENTRY_ACTIVE" && invalidSarState.rowEntryDate !== null) {
    const exitType = inst.endEvent !== null ? inst.endEvent : "still open";
    pushRow(
      0,
      "INVALID SAR ENTRY",
      invalidSarState.rowEntryDate,
      invalidSarState.rowEntryPrice as number,
      exitType,
      inst.endDate,
      inst.endPrice as number,
      invalidSarState.rowHH,
      invalidSarState.rowHHDate
    );
  }

  // Merge the GLOBAL last outer (non-nested) row's exit type -- across
  // every track combined, not per track -- with the instance's own later
  // WTF-side failure, when that cycle closed on a DTF-side SL and the
  // WTF anchor itself independently failed afterward with no further
  // DTF reactivation in between, on ANY track. All four tracks' rows
  // must be checked together here: BAR/PBAR are mutually exclusive but
  // can still alternate over an instance's life, and TAR/BAR 1 - BAR 2
  // run in parallel once BAR theory starts -- merging per track
  // independently would wrongly stamp an earlier track's own last row
  // even when a LATER row on a different track shows real reactivation
  // happened afterward (confirmed real-data bug: DIXON's B instance had
  // a TAR ENTRY SL on 08/05/25 wrongly merged with the instance's
  // eventual BAR SL2, when a BAR 1 - BAR 2 cycle on 16/05/25 -- a
  // different track -- was the actual last word). Nested BAR2 rows are
  // skipped -- they never end their outer row, so they're never the
  // merge target.
  const wtfLabel = wtfSlLabel(inst.endEvent);
  mergeTrailingWtfSl(
    rows,
    ["BAR ENTRY", "REAR ENTRY", "REAR RE-ENTER", "PBAR ENTRY", "TAR ENTRY", "BAR 1 - BAR 2", "INVALID SAR ENTRY"],
    wtfLabel
  );

  const stage1Active = s1 !== null && s1.active;
  // BAR (tier 1) currently active -- the main ladder's own pre-escalation
  // state, distinct from stage2Active below.
  const barActive = barState !== null && barState.mode === "BAR_ACTIVE";
  // "Stage 2" now means "BAR ENTRY (or REAR ENTRY / REAR RE-ENTER) is
  // currently active" -- a bare BAR alone (pre-escalation) is never
  // surfaced here, same filter rule as the historical trade log.
  const stage2Active = barState !== null && barState.mode === "BAR_ENTRY_ACTIVE";
  // PBAR's own tier-1 equivalent of barActive.
  const pbarTier1Active = pbarState !== null && pbarState.mode === "PBAR_ACTIVE";
  // PBAR's own equivalent of stage2Active -- "PBAR ENTRY is currently
  // active". Independent of stage1Active/stage2Active -- this track
  // doesn't depend on Stage 1 from the point it starts.
  const pbarActive = pbarState !== null && pbarState.mode === "PBAR_ENTRY_ACTIVE";
  const live: PrimeTrendLiveStatus = {
    family: inst.family,
    letter: inst.letter,
    stage1Active,
    stage1Since: stage1Active ? s1Since : null,
    stage1ActivationPrice: stage1Active ? s1ActivationPrice : null,
    stage1StopLoss: stage1Active && s1 ? s1.refLow : null,
    stage1HighestHigh: stage1Active ? (hh1Date ? hh1 : null) : null,
    stage1HighestHighDate: stage1Active ? hh1Date : null,
    barActive,
    barSince: barActive ? (barState as BarLevelState).barFormationDate : null,
    barActivationPrice: barActive ? (barState as BarLevelState).barActivationPrice : null,
    barStopLoss: barActive ? (barState as BarLevelState).barRefLow : null,
    barHighestHigh: barActive ? (barState as BarLevelState).barRefHigh : null,
    barHighestHighDate: barActive ? (barState as BarLevelState).barRefHighDate : null,
    stage2Active,
    stage2Since: stage2Active ? (barState as BarLevelState).rowEntryDate : null,
    stage2ActivationPrice: stage2Active ? (barState as BarLevelState).rowEntryPrice : null,
    stage2StopLoss: stage2Active ? (barState as BarLevelState).barEntryRefLow : null,
    stage2HighestHigh: stage2Active ? ((barState as BarLevelState).rowHHDate ? (barState as BarLevelState).rowHH : null) : null,
    stage2HighestHighDate: stage2Active ? (barState as BarLevelState).rowHHDate : null,
    pbarTier1Active,
    pbarTier1Since: pbarTier1Active ? (pbarState as PbarLevelState).pbarFormationDate : null,
    pbarTier1ActivationPrice: pbarTier1Active ? (pbarState as PbarLevelState).pbarActivationPrice : null,
    pbarTier1StopLoss: pbarTier1Active ? (pbarState as PbarLevelState).pbarRefLow : null,
    pbarTier1HighestHigh: pbarTier1Active ? (pbarState as PbarLevelState).pbarRefHigh : null,
    pbarTier1HighestHighDate: pbarTier1Active ? (pbarState as PbarLevelState).pbarRefHighDate : null,
    pbarActive,
    pbarSince: pbarActive ? (pbarState as PbarLevelState).rowEntryDate : null,
    pbarActivationPrice: pbarActive ? (pbarState as PbarLevelState).rowEntryPrice : null,
    pbarStopLoss: pbarActive ? (pbarState as PbarLevelState).pbarEntryRefLow : null,
    pbarHighestHigh: pbarActive ? ((pbarState as PbarLevelState).rowHHDate ? (pbarState as PbarLevelState).rowHH : null) : null,
    pbarHighestHighDate: pbarActive ? (pbarState as PbarLevelState).rowHHDate : null,
  };

  return [rows, live, sarCheckpoints];
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

export function prepare(wtfRows: OhlcRow[], dtfRows: OhlcRow[]) {
  const wtfDays: Day[] = wtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const dtfDays: Day[] = dtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const wtfDates = wtfDays.map((d) => d.date);
  const wtfTrace = runWtfTrace(wtfDays);
  const lastDtfDate = dtfDays.length > 0 ? dtfDays[dtfDays.length - 1].date : null;
  const instances = allInstances(wtfTrace, lastDtfDate);
  return { dtfDays, wtfTrace, wtfDates, instances };
}

/** Returns a list of PrimeTrendResult, one per closed (or still-open)
 * entry/exit cycle across every WTF TZ BUY 2 / REAR 2 / REAR RE-ENTER 2
 * instance that produced at least one confirmed Stage 2 (DTF TZ BUY
 * ENTRY) before its own failure -- every closed cycle within a window is
 * its own permanent row, not just the last one. Instances with no
 * confirmed entry at all are silently excluded, per the PRIME TREND
 * filter rule (see PRIME_TREND_RULEBOOK.md). */
export function computePrimeTrend(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrendResult[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows);

  const results: PrimeTrendResult[] = [];
  for (const inst of instances) {
    const [rows] = simulateDtfAll(dtfDays, wtfTrace, wtfDates, inst);
    results.push(...rows);
  }
  return results;
}

/** The RED2-anchored recurring SAR mechanism's own full dated checkpoint
 * ladder (SAR/SAR LL/INVALID SAR/.../SAR 2), per instance, mirroring
 * postBarSl2Race's own checkpoint exposure for the BAR-SL2-anchored
 * variant -- built the same way computePrimeTrend itself is, just
 * returning simulateDtfAll's 3rd element instead of its 1st. Confirmed
 * real-data (DIXON.NS): this is what makes the otherwise-invisible
 * 2021-08-24 "SAR 2" (nothing open at that exact moment, so it never
 * appears in computePrimeTrend's own row-based output) show up at all. */
export function computePrimeTrendCheckpoints(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): { letter: string; checkpoints: PostBarSl2Checkpoint[] }[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows);

  const results: { letter: string; checkpoints: PostBarSl2Checkpoint[] }[] = [];
  for (const inst of instances) {
    const [, , checkpoints] = simulateDtfAll(dtfDays, wtfTrace, wtfDates, inst);
    if (checkpoints.length > 0) results.push({ letter: inst.letter, checkpoints });
  }
  return results;
}

/** Same inputs as computePrimeTrend, but answers a different question:
 * "is this stock sitting in a PRIME TREND zone RIGHT NOW" (for a live
 * screener), not "what trades has it produced historically".
 *
 * Returns one PrimeTrendLiveStatus per anchor instance (across all three
 * families) that is STILL OPEN as of the last available WTF candle (i.e.
 * hasn't failed at its own SL / BAR SL2 within the supplied data) --
 * there is normally at most one such instance per family for a given
 * stock, but every currently-open one is returned rather than assuming
 * exactly one. Unlike computePrimeTrend, a Stage-1-only window (never
 * escalated to Stage 2) is NOT excluded here -- a live screener needs to
 * show "this stock just cleared its WTF anchor" just as much as "this
 * stock has a confirmed entry", since both are actionable right now. An
 * instance with neither stage currently active (already failed on the
 * DTF side but the WTF anchor itself hasn't failed yet) is omitted. */
export function computePrimeTrendLive(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): PrimeTrendLiveStatus[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows);

  const liveStatuses: PrimeTrendLiveStatus[] = [];
  for (const inst of instances) {
    if (inst.endEvent !== null) continue; // this instance already failed on the WTF side -- not "right now"
    const [, live] = simulateDtfAll(dtfDays, wtfTrace, wtfDates, inst);
    if (live !== null && (live.stage1Active || live.stage2Active || live.pbarTier1Active || live.pbarActive)) {
      liveStatuses.push(live);
    }
  }
  return liveStatuses;
}
