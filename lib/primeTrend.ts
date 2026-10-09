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

import { ANY, branchLabel, Day, EPS, THRESH, TZEngine, ParentCycle } from "./tzEngineWtf";

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
  side: "BAR ENTRY" | "REAR ENTRY" | "REAR RE-ENTER" | "BAR2" | "PBAR ENTRY" | "TAR ENTRY" | "BAR 1 - BAR 2";
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
        // is BAR's own tracked reference low either way.
        s.topRef = Math.max(s.topRef, s.barRefHigh, s.barEntryRefHigh);
        const exitType = entrySlNow ? "DTF BAR SL + DTF BAR ENTRY SL" : "DTF BAR SL (wipes ENTRY)";
        closed = { exitType, exitPrice: s.barRefLow };
        s.mode = "SEEK_REACTIVATION";
        s.nestedMode = "NONE";
        break;
      }
      if (entrySlNow) {
        // Clean: BAR itself not also breached -- stays alive in the
        // background. Races BAR ENTRY's own direct reactivation against
        // BAR's own (now decisive, if it comes first) SL -- see
        // SEEK_BAR_ENTRY_REACTIVATION below.
        closed = { exitType: "DTF BAR ENTRY SL", exitPrice: s.barEntryRefLow };
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
        const exitType = entrySlNow ? "DTF PBAR SL + DTF PBAR ENTRY SL" : "DTF PBAR SL (wipes ENTRY)";
        closed = { exitType, exitPrice: s.pbarRefLow };
        s.mode = "SEEK_REACTIVATION";
        break;
      }
      if (entrySlNow) {
        // Clean: PBAR itself not also breached -- stays alive in the
        // background. Races PBAR ENTRY's own direct reactivation against
        // PBAR's own (now decisive, if it comes first) SL -- see
        // SEEK_PBAR_ENTRY_REACTIVATION below. No fast lane here, ever.
        closed = { exitType: "DTF PBAR ENTRY SL", exitPrice: s.pbarEntryRefLow };
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
        const exitType = entrySlNow ? "DTF TAR SL + DTF TAR ENTRY SL" : "DTF TAR SL (wipes ENTRY)";
        closed = { exitType, exitPrice: s.tarRefLow };
        s.mode = "SEEK_REACTIVATION";
        break;
      }
      if (entrySlNow) {
        closed = { exitType: "DTF TAR ENTRY SL", exitPrice: s.tarEntryRefLow };
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
      if (breakoutShape(prev, cur, prev.h)) {
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
        // as everywhere else; reforms unrestricted ("Immediately BAR1").
        s.topRef = s.bar1RefHigh;
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
        s.topRef = Math.max(s.bar1RefHigh, s.bar2RefHigh);
        const exitType = entrySlNow ? "DTF BAR 1 SL + DTF BAR 2 SL" : "DTF BAR 1 SL (wipes BAR 2)";
        closed = { exitType, exitPrice: s.bar1RefLow };
        s.mode = "SEEK_REACTIVATION";
        break;
      }
      if (entrySlNow) {
        closed = { exitType: "DTF BAR 2 SL", exitPrice: s.bar2RefLow };
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
        s.topRef = Math.max(s.bar1RefHigh, s.frozenBar2RefHigh);
        s.mode = "SEEK_REACTIVATION";
      }
      break;
    }
    case "SEEK_REACTIVATION": {
      if (breakoutShape(prev, cur, s.topRef)) {
        s.topRef = Math.max(s.topRef, cur.h);
        s.bar1RefHigh = cur.h;
        s.bar1RefLow = cur.l;
        s.bar1ActivationPrice = cur.h;
        s.bar1FormationDate = cur.date;
        s.bar1RefHighDate = cur.date;
        s.mode = "BAR1_ACTIVE";
      } else if (cur.h > s.topRef) {
        s.topRef = cur.h;
      }
      break;
    }
  }

  return { opened, closed };
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
export function runWtfTrace(wtfDays: Day[]): WtfTraceEntry[] {
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
  endPrice: number | null; // BAR SL2 -> that BAR lineage's own SL reference low; own "2" SL / parent-tier SL -> this tier's own ref_low
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
            const linLabel = e2.slice(spec.barPrefix.length, -1);
            endPrice = preBarSl2.get(linLabel) ?? day2.c;
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
  const formPrefix = `BAR(${letter}.`;
  const slPrefix = `BAR SL(${letter}.`;
  const formations: string[] = [];
  const sls: string[] = [];
  for (const { day, events } of wtfTrace) {
    if (day.date <= formationDate || day.date > endDate) continue;
    for (const e of events) {
      if (e.startsWith(formPrefix) && e.endsWith(")")) formations.push(day.date);
      if (e.startsWith(slPrefix) && e.endsWith(")")) sls.push(day.date);
    }
  }
  const windows: WtfBarWindow[] = [];
  for (let i = 0; i < formations.length; i++) {
    const f = formations[i];
    const next = formations[i + 1] ?? null;
    const matchingSl = sls.find((sl) => sl > f && (next === null || sl < next));
    const end = matchingSl ?? next;
    const endReason: WtfBarWindow["endReason"] = matchingSl ? "BAR SL" : next ? "new BAR" : null;
    const formationHigh = wtfTrace.find(({ day }) => day.date === f)?.day.h ?? 0;
    windows.push({ formationDate: f, endDate: end ?? null, endReason, formationHigh });
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
 * event) within the data. */
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
  if (endEvent.startsWith("BAR SL2(")) return "BAR SL 2";
  return null;
}

function simulateDtfAll(
  dtfDays: Day[],
  wtfTrace: WtfTraceEntry[],
  wtfDates: string[],
  inst: WtfInstance
): [PrimeTrendResult[], PrimeTrendLiveStatus | null] {
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
  // The BAR/BAR ENTRY ladder running under the current Stage 1 (TZ BUY)
  // episode -- null whenever Stage 1 isn't active. Freshly recreated
  // every time Stage 1 (re)forms (see "active TZ BUY is mandatory"
  // above), discarded outright on Stage 1's own SL.
  let barState: BarLevelState | null = null;
  const rows: PrimeTrendResult[] = [];

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
      if (nestedClosed) {
        pushRow(
          barState.level,
          "BAR2",
          nestedClosed.entryDate,
          nestedClosed.entryPrice,
          "DTF BAR 2 SL",
          cur.date,
          nestedClosed.exitPrice,
          nestedClosed.hh,
          nestedClosed.hhDate
        );
      }
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
      bar12Red = null;
      bar12RedEverConfirmed = false;
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
        // TAR keeps seeking new formations only UNTIL BAR 1 - BAR 2's own
        // gate unlocks -- but confirmed: unlocking does NOT force-close
        // an already-open TAR ENTRY (or a clean-SL reclaim race already
        // in progress) -- "after TAR ENTRY, only TAR ENTRY SL can wipe
        // out its entry [or later a fresh SAR]." So once unlocked, TAR
        // only keeps running if it was already in one of those two LIVE
        // modes at that exact moment; the instant it drops out of both
        // (closes for good, or was never live to begin with), it goes
        // permanently dormant for the rest of this window -- no new TAR
        // formation or reactivation ever starts again, regardless of
        // later price action (confirmed: price recrossing TAR's own
        // reference high afterward does NOT reactivate it or interrupt
        // BAR 1 - BAR 2).
        const bar12AlreadyUnlocked = tarSlEverHappened && bar12RedEverConfirmed;
        const tarIsLive =
          tarState !== null && (tarState.mode === "TAR_ENTRY_ACTIVE" || tarState.mode === "SEEK_TAR_ENTRY_REACTIVATION");
        if (!bar12AlreadyUnlocked || tarIsLive) {
          if (tarState === null) tarState = new TarLevelState();

          const tarResult = stepTarLevel(tarState, prev, cur, wtfBarRefHigh);
          if (tarResult.opened) {
            tarState.rowEntryDate = cur.date;
            tarState.rowEntryPrice = tarResult.opened.price;
          }
          if (tarResult.closed) {
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
          if (tarResult.tarSlNow) tarSlEverHappened = true;

          // The gate may have just unlocked (or already was) -- once so,
          // discard tarState the moment it's no longer in a live mode,
          // so it can never seek or reactivate again.
          if (tarSlEverHappened && bar12RedEverConfirmed) {
            const stillLive = tarState.mode === "TAR_ENTRY_ACTIVE" || tarState.mode === "SEEK_TAR_ENTRY_REACTIVATION";
            if (!stillLive) tarState = null;
          }
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

        if (tarSlEverHappened && bar12RedEverConfirmed) {
          if (bar1State === null) bar1State = new Bar1LevelState();
          const { opened, closed } = stepBar1Level(bar1State, prev, cur);
          if (opened) {
            bar1State.rowEntryDate = cur.date;
            bar1State.rowEntryPrice = opened.price;
          }
          if (closed) {
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
        }
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
    if (sarRefLow !== null) {
      if (slShape(cur, sarRefLow)) {
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
        if (tarState !== null && tarState.mode === "TAR_ENTRY_ACTIVE" && tarState.rowEntryDate !== null) {
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
        if (bar1State !== null && bar1State.mode === "BAR2_ACTIVE" && bar1State.rowEntryDate !== null) {
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
        bar12Red = null;
        bar12RedEverConfirmed = false;
        // Spent -- must re-arm from a FRESH RED2 before firing again.
        sarRefLow = null;
      } else if (cur.l < sarRefLow) {
        sarRefLow = cur.l;
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
  // between tracks as above.
  if (tarState !== null && tarState.mode === "TAR_ENTRY_ACTIVE" && tarState.rowEntryDate !== null) {
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
  if (bar1State !== null && bar1State.mode === "BAR2_ACTIVE" && bar1State.rowEntryDate !== null) {
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
  mergeTrailingWtfSl(rows, ["BAR ENTRY", "REAR ENTRY", "REAR RE-ENTER", "PBAR ENTRY", "TAR ENTRY", "BAR 1 - BAR 2"], wtfLabel);

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

  return [rows, live];
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
