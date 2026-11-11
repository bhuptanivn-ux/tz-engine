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
// PRIME TREND BAR THEORY (DTF PBAR/PBAR ENTRY, and TAR/TAR ENTRY + the
// nested BAR1/BAR2 cascade) -- REMOVED from this module's active
// computation path per the user's own instruction ("Remove the BAR THEORY
// of PRIME TREND including PBAR/PBAR ENTRY and save it elsewhere ... It
// will not be part of our testing. It will not be part of PRIME TREND
// now."). The full state machines (PbarLevelState/stepPbarLevel,
// TarLevelState/stepTarLevel, Bar1LevelState/stepBar1Level) and their own
// "WTF BAR active" windowing (wtfBarWindowsForLetter) have been relocated
// verbatim to lib/primeTrendBarTheory.ts for possible future reinstatement
// -- see that file's own header for the full prior derivation and for why
// the per-candle wiring glue itself was not relocated as live code.
//
// PRIME TREND's only currently active entry point is the BAR/BAR ENTRY
// ladder below: TZ BUY -> RED -> BAR -> BAR ENTRY. A TZ BUY SL reactivates
// above the running reference high above TZ BUY's own occurrence high
// (which keeps climbing even after a BAR ENTRY occurred, via the same
// quiet-climb tracking used everywhere else in this file).

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
// BAR ENTRY SL (entry-only scope -- REAR deferred for now): per the
// user's own correction, a CLEAN BAR ENTRY SL (BAR itself independently
// still valid) follows the exact SAME rule as a combined BAR SL + BAR
// ENTRY SL -- there is no direct, same-step BAR ENTRY reactivation
// anymore. Either way, BAR must reform first -- gated above the BAR
// ENTRY reference high this structure reached (quietly climbing while
// waiting, same as any other frozen-reference reform elsewhere in this
// file) -- then escalates to BAR ENTRY again the ordinary way, on its
// own later breakout.
export class BarRedGate {
  constructor(public refHigh: number, public refLow: number) {}
}
export function stepBarRed(red: BarRedGate, prev: Day, cur: Day): "confirmed" | "invalid" | "continuing" {
  if (cur.h > red.refHigh && cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) return "invalid";
  if (cur.h > red.refHigh) red.refHigh = cur.h;
  if (cur.l < red.refLow) {
    const red2Holds = cur.h <= prev.h && red.refLow - cur.l >= THRESH - EPS && cur.c <= red.refLow + EPS;
    if (red2Holds) return "confirmed";
    red.refLow = cur.l;
  }
  return "continuing";
}
export function isBarRed1Shape(prev: Day, cur: Day): boolean {
  return cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l;
}

type BarMode = "SEEK_LEVEL_ENTRY" | "SEEK_BAR" | "BAR_ACTIVE" | "BAR_ENTRY_ACTIVE" | "SEEK_REACTIVATION" | "SEEK_BAR_ENTRY_REACTIVATION";

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
  // How the CURRENTLY living BAR was itself most recently formed/
  // reactivated -- RED1 (gated on a bare RED1 alone, doorOpen not yet
  // open at that moment) or RED1_RED2 (a completed RED1->RED2 was
  // already open at that moment). Set at every point BAR itself forms
  // (SEEK_BAR -> BAR_ACTIVE), consuming `doorOpen` if it was open. Drives
  // the one-time fast-lane bonus in SEEK_REACTIVATION below: a RED1-born
  // BAR that later suffers a combined BAR SL + BAR ENTRY SL gets ONE
  // unrestricted "next green" reactivation if a RED1->RED2 has completed
  // by then (whenever that happened relative to the SL) -- the gate just
  // leveled up from RED1 to RED1->RED2. Already RED1_RED2-born (or the
  // bonus already spent once): no further shortcut, ever -- reactivates
  // only above the BAR ENTRY highest high.
  birthTier: "RED1" | "RED1_RED2" = "RED1";
  // Set true the first time a COMBINED BAR ENTRY SL (BAR's own SL also
  // breached, same candle or sequential) establishes `topRef` as a real
  // reactivation gate, never reset while this BarLevelState lives. A
  // CLEAN BAR ENTRY SL (BAR itself still active) never sets this -- per
  // the user's latest correction, that case reforms unrestricted via
  // SEEK_BAR instead (see stepBarLevel's own comments). From the moment
  // this IS set, topRef is a PERMANENT, monotonically non-decreasing
  // floor for the rest of this TZ BUY episode -- it must keep climbing on
  // every later High reached, in ANY mode, including while a bare,
  // pre-escalation BAR is itself seeking or re-seeking after its OWN SL
  // (same ratchet shape lib/primeTrendBarTheory.ts's own Bar1LevelState
  // already uses for its analogous gate). Without this flag, the bare-SL
  // branch below wrongly treated every post-gate bare BAR exactly like a
  // virgin, never-gated one.
  gateEstablished = false;
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
 *   BAR -> BAR ENTRY -> BAR ENTRY SL, BAR itself still active (clean,
 *     BAR's own SL not also breached) -> BAR (unrestricted, same shape
 *     as the pre-escalation case above -- reforms immediately on the
 *     1st qualifying breakout candle, no reference to clear first) ->
 *     BAR ENTRY (ordinary escalation above *this new* BAR's own
 *     reference high, on a later candle). Per the user's latest
 *     correction -- reverses an earlier rule that gated this specific
 *     reform above the old BAR ENTRY reference high via
 *     SEEK_REACTIVATION.
 *   BAR -> BAR ENTRY -> BAR SL (combined: BAR's own SL also breached,
 *     always wipes BAR ENTRY with it) -> BAR (reforms above the *BAR
 *     ENTRY* reference high, gated via SEEK_REACTIVATION below, never
 *     unrestricted) -> BAR ENTRY (ordinary escalation above this new
 *     BAR's own reference high, on a later candle).
 * Every "reference high" above is the running highest high reached
 * since that tier's own formation/reactivation, continuously updated by
 * quiet-climb tracking -- never just the literal high on the day it
 * first formed. */
function stepBarLevel(
  s: BarLevelState,
  prev: Day,
  cur: Day,
  barTheoryOpenNow: boolean
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
        s.birthTier = s.doorOpen ? "RED1_RED2" : "RED1";
        if (s.doorOpen) s.doorOpen = false;
        s.mode = "BAR_ACTIVE";
      }
      break;
    }
    case "BAR_ACTIVE": {
      if (breakoutShape(prev, cur, s.barRefHigh)) {
        // Per the user's own rule: "If BAR THEORY entry is in progress
        // and has occurred before the PRIME TREND BAR ENTRY then PRIME
        // TREND entry cannot overlap the BAR ENTRY." Hold the escalation
        // back -- quiet climb only, same as any other new high -- for as
        // long as BAR THEORY already holds an older, still-open position
        // for this same letter. Confirmed real-data (ICICIBANK.NS,
        // letter C): TAR ENTRY (BAR THEORY) opens 2004-09-21 and stays
        // open; PRIME TREND's own BAR would otherwise escalate
        // 2004-12-24 and again 2005-03-02/03 -- both must stay
        // suppressed until that BAR THEORY position itself closes.
        if (barTheoryOpenNow) {
          s.barRefHigh = cur.h;
          s.barRefHighDate = cur.date;
          break;
        }
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
        // Pre-escalation SL: unrestricted ONLY while no reactivation gate
        // has ever been established yet (a virgin ladder's own first bare
        // cycle). Once a BAR ENTRY SL has established topRef as a real
        // gate, EVERY later reform -- bare or not -- stays gated above it
        // (see gateEstablished's own comment).
        s.mode = s.gateEstablished ? "SEEK_REACTIVATION" : "SEEK_BAR";
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
        // Decisive (combined): BAR's own SL always means BAR ENTRY is
        // gone too -- BAR ENTRY is an escalation of BAR, it cannot
        // outlive it. Per the user's own rule: "NEXT GREEN WILL BE BAR
        // FOLLOWED BY BAR ENTRY WHICH WILL BE ABOVE THE BAR reference
        // high... irrespective of whether RED1-RED2 has completed" --
        // BAR itself died too, so it reforms unrestricted (the 1st
        // qualifying breakout candle, same shape as a virgin SEEK_BAR
        // formation, no reference to clear first), then BAR ENTRY
        // escalates ordinarily above *this new* BAR's own reference
        // high, via the unchanged BAR_ACTIVE escalation path below.
        // `topRef` still accumulates (read by the outer TZ BUY-level
        // reactivation threshold) even though it no longer gates THIS
        // reform. Exit price is ALWAYS BAR ENTRY's own (tighter)
        // reference, same as the clean case below, not BAR's own wider
        // one -- whether both breach the same candle or not, the
        // trade's own exit is defined by its own entry-level stop; the
        // "BAR SL" half of a combined event is a structural signal for
        // how reformation proceeds, not a different exit price.
        // Modeled at the exact qualifying threshold distance below that
        // reference (same "ref +/- THRESH" convention entry price
        // already uses), not the literal Low of the SL day. Confirmed
        // exact match via KALYANKJIL (ref 117.70 -> exit 117.50) and
        // COCHINSHIP (ref 266.50 -> exit 266.30).
        // Per the user's own rule: BAR reactivates ABOVE THE HIGHEST
        // HIGH reached at any point between the original BAR ENTRY and
        // this BAR SL -- including every intermediate BAR ENTRY SL/
        // reactivation cycle in between, even one whose own high was
        // LOWER than an earlier cycle's (the earlier, higher one still
        // governs). `topRef` is exactly this accumulated max -- gated
        // reform via SEEK_REACTIVATION, never unrestricted.
        s.topRef = Math.max(s.topRef, s.barRefHigh, s.barEntryRefHigh);
        s.gateEstablished = true;
        const exitType = entrySlNow ? "DTF BAR SL + DTF BAR ENTRY SL" : "DTF BAR SL (wipes ENTRY)";
        closed = { exitType, exitPrice: s.barEntryRefLow - THRESH };
        s.mode = "SEEK_REACTIVATION";
        s.nestedMode = "NONE";
        break;
      }
      if (entrySlNow) {
        // Clean (BAR itself not also breached, still active): per the
        // user's own rule, BAR ENTRY reactivates directly, one step, on
        // the very next "green" (plain day-over-day breakout) candle --
        // no reference level to clear at all. BAR itself was never
        // touched, so no new "BAR" instance forms in this path --
        // irrespective of whether RED2 has confirmed, before or after
        // this SL: as long as BAR itself is intact, next green is BAR
        // ENTRY. `topRef` still accumulates this instance's own peak
        // (Math.max, never shrinks) so that IF a later BAR SL ever does
        // follow -- this cycle or a later reactivation's -- the correct,
        // highest-ever reference is still on record for that reform.
        s.topRef = Math.max(s.topRef, s.barRefHigh, s.barEntryRefHigh);
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
    case "SEEK_REACTIVATION": {
      // One-time fast lane: this BAR was born on a bare RED1 alone
      // (birthTier "RED1"), and a RED1->RED2 has SINCE completed (may
      // have happened before, during, or after the SL that brought us
      // here -- `doorOpen` just needs to be open right now) -- the gate
      // leveled up, so BAR gets one unrestricted "next green"
      // reactivation instead of waiting to clear the BAR ENTRY highest
      // high. Already RED1_RED2-born (bonus already spent, or born that
      // way to begin with): never eligible, always the gated path below.
      if (s.birthTier === "RED1" && s.doorOpen && breakoutShape(prev, cur, prev.h)) {
        s.doorOpen = false;
        // Fresh start for this bonus-born cycle -- its own later history
        // governs any future combined-failure reactivation, not
        // whatever topRef had accumulated before the bonus fired.
        s.topRef = cur.h;
        s.barRefHigh = cur.h;
        s.barRefLow = cur.l;
        s.barActivationPrice = cur.h;
        s.barFormationDate = cur.date;
        s.barRefHighDate = cur.date;
        s.birthTier = "RED1_RED2"; // bonus consumed; no further shortcut
        s.mode = "BAR_ACTIVE";
        break;
      }
      // Ordinary gated path -- reforms BAR alone (BAR and BAR ENTRY can
      // never form on the same candle; BAR ENTRY only escalates later,
      // on a later candle, via BAR_ACTIVE's own already-correct
      // escalation path above). `birthTier` is deliberately left
      // untouched here: reaching this branch at all means the fast lane
      // above did not fire, so either birthTier was already "RED1_RED2"
      // (stays spent) or it is still "RED1" with `doorOpen` genuinely
      // still false (the RED1-only gate stays unresolved, still eligible
      // for a future bonus once a RED1->RED2 does complete).
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
    case "SEEK_BAR_ENTRY_REACTIVATION": {
      // BAR itself is still alive while waiting here -- its own SL can
      // still happen before BAR ENTRY ever reactivates. If it does, BAR
      // has now died too (a sequential combined failure, same as if
      // both had failed on the same candle) -- fall back to SEEK_BAR
      // (fresh, unrestricted BAR reform) instead of reactivating BAR
      // ENTRY directly. Confirmed real-data (ICICIBANK.NS): BAR ENTRY SL
      // 2015-02-02 (BAR itself still alive, barRefLow 315.86) -> BAR
      // itself SL's 2015-02-03 (Low 313.73, closes 315.09 below 315.86)
      // -- BAR ENTRY cannot simply reactivate after that; a fresh BAR
      // must reform first.
      const barSlNow = slShape(cur, s.barRefLow);
      if (!barSlNow && cur.h > s.barRefHigh && cur.h - s.barRefHigh >= ANY) s.barRefHigh = cur.h;
      if (!barSlNow && cur.l < s.barRefLow) s.barRefLow = cur.l;
      if (barSlNow) {
        // BAR reactivates above the accumulated highest-ever high
        // (topRef), gated via SEEK_REACTIVATION -- same rule as the
        // same-candle combined case above, not unrestricted.
        s.topRef = Math.max(s.topRef, s.barRefHigh);
        s.gateEstablished = true;
        s.mode = "SEEK_REACTIVATION";
        break;
      }
      // "Next green" -- plain day-over-day breakout, no reference level
      // to clear at all (same unrestricted shape a virgin BAR formation
      // uses, NOT TAR ENTRY's own frozen-reference reactivation -- that
      // was the wrong model to copy here). Confirmed real-data
      // (ICICIBANK.NS): BAR ENTRY SL 2003-11-19 (ratcheted high 48.78) ->
      // 2003-11-24 (High 44.55, clears 2003-11-21's own High 42.73 by
      // threshold, closes above it) reactivates BAR ENTRY directly, even
      // though 44.55 never comes close to the old 48.78.
      if (breakoutShape(prev, cur, prev.h)) {
        const entryPrice = prev.h + THRESH;
        s.barEntryRefHigh = cur.h;
        s.barEntryRefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "BAR_ENTRY_ACTIVE";
        s.nestedDoorOpen = false;
        s.nestedMode = "NONE";
        opened = { price: entryPrice };
      }
      break;
    }
  }

  return { opened, closed, nestedClosed };
}

// Per the user's own display rule (briefly narrowed to only "SAR 2"/
// "INVALID SAR ENTRY REACTIVATED", then EXPLICITLY REVERTED back to this
// original, full-ladder convention: "INVALID SAR - INVALID SAR ENTRY, SAR
// REACTIVATION, SAR 2 AFTER REACTIVATION, INVALID SAR SL AND IF ANY OTHER
// EVENTS WHICH WERE DEFINED EARLIER WILL be brought back"): the entire
// SAR/INVALID SAR/INVALID SAR ENTRY ladder's own occurrence/SL/reactivation
// mechanics are UNCHANGED either way -- this governs display only, never
// what gets computed. Every real step of the ladder -- "SAR", "SAR SL",
// "INVALID SAR", "INVALID SAR SL", "INVALID SAR ENTRY",
// "INVALID SAR ENTRY SL", "INVALID SAR ENTRY REACTIVATED", "SAR 2" -- is
// shown; only the internal "... HH"/"... LL" reference-tracking labels
// (never real events, just bookkeeping for the next SAR/INVALID SAR
// breach's own reference high/low) stay backend-only.
export function isSarLadderLabelDisplayed(label: string): boolean {
  return !label.endsWith(" HH") && !label.endsWith(" LL");
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

export class InvalidSarState {
  mode: InvalidSarMode = "SEEK_INVALID";
  refHigh: number;
  refLow: number;
  frozenEntryRefHigh = 0;
  // Seeded at the bare "INVALID SAR SL" day's own Low when entering
  // SEEK_REFORM -- see that case's own comment for why.
  reformFloor = 0;
  // True from a bare "SAR SL" (SEEK_INVALID's own near-miss) until the
  // next real SAR fire -- while true, a decisive breach of refLow is
  // just a FRESH "SAR" (the stopped-out watch restarting), not "SAR 2".
  // Confirmed real-data (DIXON.NS, the hidden RED2(B.3) 2025-05-26 SAR
  // cycle): 2025-06-04 SAR SL -> 2025-06-13's decisive breach of the
  // SAR-SL-ratcheted refLow (14381) is the user's own given "SAR", NOT
  // "SAR 2" -- SAR 2 only confirms later (2025-06-19) off THIS fresh
  // SAR's own fresh refLow (14127, itself climbed via the ordinary
  // 2025-06-16 "SAR LL"). Without this flag the mechanism wrongly
  // treats the SAR-SL-ratcheted low as if it were an un-stopped-out
  // SAR's own reference, ending the whole cycle 6 days early.
  sarSlSinceLastSar = false;

  // The lowest Low ever seen since this SAR first fired -- persists,
  // monotonically non-increasing, across EVERY later INVALID
  // SAR/reform/SL cycle, no matter how much the price rallies back up
  // in between. All the LOCAL, tactical ref/reformFloor reseeds in this
  // state machine stay exactly as they were (a fresh INVALID SAR/reform
  // still reseeds to that day's own Low, same as always) -- this value
  // is used only to GATE SEEK_REFORM's own terminal "fresh SAR" check:
  // a decisive breach of the LOCAL reformFloor is not yet a real "SAR"
  // unless it ALSO breaches this persisting historical floor. Per the
  // user's own rule: "if SAR SL or INVALID SAR occurs, the next SAR
  // occurs BELOW THE EARLIER SAR's OWN reference low" -- the ORIGINAL
  // one, not whatever a later, higher-seated local reform happened to
  // reseed reformFloor to. Confirmed real-data (DIXON.NS, RED2(A)
  // 2022-01-24): the original SAR ratchets refLow down to 3936.95 by
  // 2022-02-22; the INVALID SAR/reform/SL chain that follows (through
  // 2022-04-12's own INVALID SAR SL, reformFloor reseeded locally to
  // that day's own higher Low, 4315.55) never comes back down near
  // 3936.95 on its own -- so the OLD code treated 4315.55 as the
  // decisive floor, firing a (wrong) "SAR" the moment it was merely
  // LOCALLY breached, on 2022-04-18. The real floor is still 3936.95 --
  // not breached until 2022-05-04 (Low 3780.00), the user's own given
  // "SAR" there, with "SAR LL" on 2022-05-06 and the real "SAR 2" only
  // on 2022-05-10.
  historicalFloor: number;

  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;

  // INVALID SAR's own reference low, frozen at the moment INVALID SAR
  // escalates into INVALID SAR ENTRY (ENTRY_ACTIVE overwrites `refLow`
  // with the entry day's own low for its own SL/HH mechanics -- this
  // keeps INVALID SAR's own, separate reference alive underneath).
  // User's own rule: "INVALID SAR SL will occur below INVALID SAR
  // REFERENCE LOW and INVALID SAR ENTRY SL will occur below the INVALID
  // SAR ENTRY REFERENCE LOW... INVALID SAR SL CAN ONLY OCCUR BELOW
  // INVALID SAR REFERENCE LOW." Confirmed real-data (ICICIBANK.NS):
  // INVALID SAR 2005-11-14 seeds refLow 94.16 -> INVALID SAR ENTRY
  // 2005-11-16 overwrites refLow to 95.45 (its own entry-day low) ->
  // INVALID SAR ENTRY SL 2005-11-21 (exit 95.45) -> SEEK_REACTIVATION.
  // 2005-11-22's Close (94.54) sits BELOW 95.45 but ABOVE 94.16 -- not a
  // real "INVALID SAR SL" since it never breaches INVALID SAR's own
  // 94.16 reference; the old code wrongly fired SL here by comparing
  // against the ENTRY's frozen 95.45 instead.
  invalidSarOwnRefLow: number;

  // True from the moment this cycle FIRST reaches an open INVALID SAR
  // ENTRY position, forever after (through its own SL, reactivation,
  // anything) -- distinguishes an already-committed, live cycle from a
  // merely-armed/never-yet-opened watch. Used solely to protect an
  // already-open (or already-opened-at-least-once) cycle from the
  // fresh-BAR-2 kill-switch below, which is meant for a watch that never
  // got this far, not one already mid-position -- see that switch's own
  // comment. Confirmed real-data (ICICIBANK.NS): without this, BAR
  // 2(C.3) forming 2005-11-14 wipes out the INVALID SAR ENTRY that opened
  // 2005-11-16, erasing its own already-confirmed 2005-11-21 SL and
  // subsequent reactivation outright.
  everOpened = false;

  constructor(refHigh: number, refLow: number) {
    this.refHigh = refHigh;
    this.refLow = refLow;
    this.historicalFloor = refLow;
    this.invalidSarOwnRefLow = refLow;
  }
}

function stepInvalidSar(
  s: InvalidSarState,
  prev: Day,
  cur: Day
): {
  invalidSarNow: boolean;
  sarSlNow: boolean;
  sar2Now: boolean;
  // A decisive refLow breach that is just a FRESH "SAR" re-arm, not
  // terminal "SAR 2" -- fires only when a "SAR SL" happened since the
  // last real SAR (see InvalidSarState.sarSlSinceLastSar's own comment).
  freshSarNow: boolean;
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
  let freshSarNow = false;
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
        s.sarSlSinceLastSar = true;
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
        //
        // UNLESS a "SAR SL" happened since the last real SAR fired --
        // then this watch was already stopped out once, and a decisive
        // breach of its SL-ratcheted reference is just a FRESH "SAR"
        // (the mechanism restarting), not "SAR 2". Confirmed via DIXON
        // (hidden RED2(B.3), 2025-05-26): 2025-06-04 SAR SL ratchets
        // refLow to 14381 -> 2025-06-13 decisively breaches 14381, but
        // this is the user's own given "SAR" (fresh re-arm, refLow then
        // reseeded at 2025-06-13's own Low 14203) -- real "SAR 2" only
        // confirms 2025-06-19, off that fresh SAR's own further-ratcheted
        // refLow (14127, via 2025-06-16's ordinary "SAR LL").
        if (s.sarSlSinceLastSar) {
          freshSarNow = true;
          s.refHigh = cur.h;
          s.refLow = cur.l;
          s.sarSlSinceLastSar = false;
          break;
        }
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
        s.invalidSarOwnRefLow = s.refLow;
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
      // A decisive breach of the bare SL day's own (LOCAL) Low is a
      // FRESH "SAR" reactivation -- NOT "SAR 2" directly -- but ONLY
      // once it ALSO breaches the historical floor (the lowest Low ever
      // seen since this SAR first fired, persisting across every
      // reform in between). A local reformFloor reseeded by an
      // intervening INVALID SAR SL can sit well ABOVE that historical
      // floor after a big rally-then-pullback; breaching merely that
      // local value is not yet a real "SAR" -- it's still just this
      // same reform-floor's own quiet climb downward, same "SAR LL"
      // ratchet as any other non-decisive day. Confirmed real-data
      // (DIXON.NS, RED2(A) 2022-01-24): 2022-04-12's own INVALID SAR SL
      // reseeds reformFloor to that day's Low (4315.55); 2022-04-18
      // locally breaches it, but the user's own given rule -- "SAR 2
      // cannot occur below the previous RED2['s SAR reference] ... new
      // SAR will occur BELOW the earlier SAR ref low" -- means nothing
      // real happens there: the historical floor (3936.95, set
      // 2022-02-22) isn't breached until 2022-05-04 (Low 3780.00),
      // which is the real "SAR"; "SAR LL" on 2022-05-06, "SAR 2" on
      // 2022-05-10. Per the user's own rule: post SAR, once INVALID SAR
      // or SAR SL has triggered, SAR must reactivate (below the
      // breached reference low) before SAR 2 can occur at all; SAR 2 is
      // reserved for a decisive breach of THAT reactivated watch's own
      // reference, not this one.
      //
      // The historical-floor breach needs its OWN close confirmation
      // (cur.c <= historicalFloor + EPS), not just the Low -- confirmed
      // real-data (BSE.NS, RED2(A) 2022-04-18/25-anchored cycle):
      // 2022-05-06's Low (268.52) clears the local reformFloor (276.83)
      // AND the historical floor (270.67, set 2022-04-25) alike, but its
      // Close (274.45) does NOT confirm below 270.67 -- so this is NOT
      // yet a real "SAR" either, just reformFloor's own further climb
      // down to 268.52. The real reactivation is 2022-05-09 (Low 257.03,
      // Close 259.25, both clearing 270.67), with "SAR 2" on 2022-05-10.
      if (slShape(cur, s.reformFloor)) {
        if (cur.l <= s.historicalFloor && cur.c <= s.historicalFloor + EPS) {
          freshSarNow = true;
          s.refHigh = cur.h;
          s.refLow = s.historicalFloor;
          s.mode = "SEEK_INVALID";
          s.sarSlSinceLastSar = false;
          break;
        }
        // Locally decisive, but not yet below the historical floor --
        // just the reform-floor's own quiet climb down, no event.
        s.reformFloor = cur.l;
        if (cur.h > s.refHigh) s.refHigh = cur.h;
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
      // "Next green" -- plain day-over-day breakout, no reference level
      // to clear at all: same shape BarLevelState's own
      // SEEK_BAR_ENTRY_REACTIVATION uses (that case's own comment
      // explicitly warns against copying a frozen-reference model here
      // instead -- this case had made exactly that mistake). Per the
      // user's own rule: "PLAIN INVALID SAR ENTRY SL occurs and INVALID
      // SAR is still active, then INVALID SAR ENTRY can reactivate in
      // next green" -- the same Stage-1/Stage-2 shape used everywhere
      // else in this codebase (Stage 1 alive, next green reactivates
      // Stage 2), not a climb back to the old frozen high. Confirmed
      // real-data (ICICIBANK.NS): INVALID SAR ENTRY SL 2005-11-21
      // (frozenEntryRefHigh had ratcheted to 100.18) -> 2005-11-24
      // reactivates (High 98.85 clears 2005-11-23's own High 96.15 by
      // threshold, Close 97.97 confirms above it) -- nowhere near 100.18.
      if (breakoutShape(prev, cur, prev.h)) {
        const entryPrice = prev.h + THRESH;
        s.refHigh = cur.h;
        s.refLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "ENTRY_ACTIVE";
        opened = { price: entryPrice };
        break;
      }
      // Symmetric downside watch, same shape BarLevelState's own
      // SEEK_BAR_ENTRY_REACTIVATION uses (BAR's own wider reference kept
      // alive in the background while waiting for ENTRY to reactivate):
      // a decisive breach of INVALID SAR's OWN reference low (frozen in
      // `s.invalidSarOwnRefLow` at the moment ENTRY first escalated --
      // NOT the ENTRY's own frozen low, `s.refLow`), before reactivation
      // ever happens, is "INVALID SAR SL" (reusing the existing label),
      // dropping down into SEEK_REFORM exactly like INVALID_SAR_ACTIVE's
      // own bare SL does. Per the user's own rule: "INVALID SAR SL will
      // occur below INVALID SAR REFERENCE LOW and INVALID SAR ENTRY SL
      // will occur below the INVALID SAR ENTRY REFERENCE LOW" -- these
      // are two independent references, and INVALID SAR SL must never be
      // measured against INVALID SAR ENTRY's own reference. Confirmed
      // real-data (ICICIBANK.NS): INVALID SAR 2005-11-14 (refLow 94.16)
      // -> INVALID SAR ENTRY 2005-11-16 (refLow reset to 95.45) -> INVALID
      // SAR ENTRY SL 2005-11-21 (exit 95.45) -> 2005-11-22's Close (94.54)
      // sits below 95.45 but ABOVE 94.16 -- not a real breach of INVALID
      // SAR's own 94.16 reference, so no "INVALID SAR SL" here; the old
      // code wrongly fired it by comparing against 95.45 instead.
      const slNow = slShape(cur, s.invalidSarOwnRefLow);
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
      if (!slNow && cur.h > s.frozenEntryRefHigh && cur.h - s.frozenEntryRefHigh >= ANY) {
        s.frozenEntryRefHigh = cur.h;
      }
      if (slNow) {
        s.reformFloor = cur.l;
        s.mode = "SEEK_REFORM";
        invalidSarSlNow = true;
      }
      break;
    }
  }

  // Unconditional, mode-independent, and -- critically -- AFTER the
  // SEEK_REFORM case above has already used historicalFloor's own PRIOR
  // value: updating it first would make that case's own breach check
  // self-referential (today's own new low trivially satisfies "cur.l <=
  // historicalFloor" against itself) and silently defeat the Close
  // confirmation it's paired with on whichever day happens to set a
  // fresh all-time low. Confirmed real-data (BSE.NS, RED2(A) 2022-04-18):
  // 2022-05-09 (Low 257.03, a fresh all-time low for this race) must
  // compare against 268.52 -- the floor as it stood going INTO today,
  // set 2022-05-06 -- not against itself; Close 259.25 confirms below
  // 268.52 (the user's own given "SAR" reactivation) but would wrongly
  // fail to confirm below its own same-day 257.03. See
  // InvalidSarState.historicalFloor's own comment.
  if (cur.l < s.historicalFloor) s.historicalFloor = cur.l;

  return { invalidSarNow, sarSlNow, sar2Now, freshSarNow, invalidSarSlNow, opened, closed };
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
 * are its state and return value AFTER. Returns [] when the step was a
 * pure no-op (no real transition, no ratchet). Returns an array, not a
 * single nullable checkpoint, because a single wide-range day can
 * ratchet refHigh up AND refLow down at once -- both are real,
 * independent events (confirmed real-data, DIXON.NS, hidden RED2(B.3)
 * 2025-06-16: High 14435 clears the live refHigh 14389 while Low 14127
 * simultaneously undercuts refLow 14203 -- the user's own given trace
 * has BOTH "SAR HH" and "SAR LL" that same day; returning only the
 * first would silently drop one of them). */
function checkpointForInvalidSarStep(
  modeBefore: InvalidSarMode,
  refHighBefore: number,
  refLowBefore: number,
  frozenBefore: number,
  s: InvalidSarState,
  result: ReturnType<typeof stepInvalidSar>,
  cur: Day
): PostBarSl2Checkpoint[] {
  if (result.sar2Now) return [{ date: cur.date, label: "SAR 2", price: cur.l }];
  if (result.invalidSarNow) return [{ date: cur.date, label: "INVALID SAR", price: cur.h }];
  if (result.invalidSarSlNow) return [{ date: cur.date, label: "INVALID SAR SL", price: cur.l }];
  if (result.sarSlNow) return [{ date: cur.date, label: "SAR SL", price: cur.h }];
  if (result.freshSarNow) return [{ date: cur.date, label: "SAR", price: cur.l }];
  if (result.opened) {
    const label = modeBefore === "SEEK_REACTIVATION" ? "INVALID SAR ENTRY REACTIVATED" : "INVALID SAR ENTRY";
    return [{ date: cur.date, label, price: result.opened.price }];
  }
  if (result.closed) return [{ date: cur.date, label: "INVALID SAR ENTRY SL", price: result.closed.exitPrice }];
  const out: PostBarSl2Checkpoint[] = [];
  if (modeBefore === "SEEK_INVALID") {
    if (s.refHigh > refHighBefore) out.push({ date: cur.date, label: "SAR HH", price: s.refHigh });
    if (s.refLow < refLowBefore) out.push({ date: cur.date, label: "SAR LL", price: s.refLow });
  } else if (modeBefore === "INVALID_SAR_ACTIVE") {
    if (s.refHigh > refHighBefore) out.push({ date: cur.date, label: "INVALID SAR HH", price: s.refHigh });
    if (s.refLow < refLowBefore) out.push({ date: cur.date, label: "INVALID SAR LL", price: s.refLow });
  } else if (modeBefore === "SEEK_REFORM") {
    // The reform itself (SEEK_REFORM -> INVALID_SAR_ACTIVE) sets neither
    // invalidSarNow nor any other flag -- detected here by the mode
    // change itself, labeled the same as any other INVALID SAR
    // (re-)confirmation. Otherwise, the frozen reform reference's own
    // quiet climb is "SAR HH" (same label the code's own comment at
    // stepInvalidSar's SEEK_REFORM case already uses).
    if (s.mode === "INVALID_SAR_ACTIVE") return [{ date: cur.date, label: "INVALID SAR", price: s.refHigh }];
    if (s.refHigh > refHighBefore) out.push({ date: cur.date, label: "SAR HH", price: s.refHigh });
  } else if (modeBefore === "ENTRY_ACTIVE") {
    if (cur.h === s.rowHH && s.rowHH > refHighBefore) out.push({ date: cur.date, label: "INVALID SAR ENTRY HH", price: s.rowHH });
    if (s.refLow < refLowBefore) out.push({ date: cur.date, label: "INVALID SAR ENTRY LL", price: s.refLow });
  } else if (modeBefore === "SEEK_REACTIVATION") {
    if (s.frozenEntryRefHigh > frozenBefore) out.push({ date: cur.date, label: "INVALID SAR ENTRY HH", price: s.frozenEntryRefHigh });
  }
  return out;
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
  hiddenEventLogOut?: HiddenEventLogEntry[],
  // DTF days, PASSED ONLY by computePrimeTrend's own call path -- when
  // given, runs the two-pass DTF-aware race (see the user's own rule:
  // "unless DTF BAR ENTRY is achieved, a new WTF cycle can spawn any
  // time the original cycle is trying to reach it, given a fresh
  // RED1"). Pass 1 runs the plain, DTF-unaware engine to derive each
  // letter's own BAR-ENTRY-active intervals; pass 2 re-runs with that
  // as an input, so the new spawn trigger (and whichever branch wins
  // the race, via the engine's own EXISTING leadership-contest
  // mechanism -- nothing new there) can use it. Every other caller
  // (lib/tarTbar.ts's own findWindows/misclassified-letter detection,
  // raceFreshLineage's own re-slicing) omits this and keeps getting the
  // exact same single-pass trace as before -- this feature is scoped to
  // PRIME TREND's own computation only, not BAR THEORY's.
  dtfDays?: Day[]
): WtfTraceEntry[] {
  if (dtfDays !== undefined) {
    const pass1Trace = runWtfTraceCore(wtfDays, new TZEngine(true));
    const wtfRowsForGate: OhlcRow[] = wtfDays.map((d) => ({ date: d.date, o: d.o, h: d.h, l: d.l, c: d.c }));
    const dtfRowsForGate: OhlcRow[] = dtfDays.map((d) => ({ date: d.date, o: d.o, h: d.h, l: d.l, c: d.c }));
    const intervals = barEntryActiveIntervals(wtfRowsForGate, dtfRowsForGate, pass1Trace);
    const barEntryActiveAt = (letter: string, date: string): boolean => {
      const ivs = intervals.get(letter) ?? [];
      return ivs.some((iv) => date >= iv.sinceDate && (iv.untilDate === null || date < iv.untilDate));
    };
    return runWtfTraceCore(wtfDays, new TZEngine(true, barEntryActiveAt), barSl2LogOut, hiddenEventLogOut);
  }
  // `true`: this always runs on WEEKLY candles (PRIME TREND's fixed
  // WTF=weekly rule; lib/tarTbar.ts's own findWindows, this function's
  // other caller, is weekly-only too) -- enables the weekly-only bare-
  // BAR-SL-opens-REAR revision (see TZEngine's own constructor comment).
  return runWtfTraceCore(wtfDays, new TZEngine(true), barSl2LogOut, hiddenEventLogOut);
}

function runWtfTraceCore(
  wtfDays: Day[],
  engine: TZEngine,
  barSl2LogOut?: { label: string; date: string; low: number }[],
  hiddenEventLogOut?: HiddenEventLogEntry[]
): WtfTraceEntry[] {
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

/** Per the user's own correction: the raw WTF engine's own sibling-spawn
 * rule (`canSpawn`/`eligibleAnchor` in tzEngineWtf.ts) only lets a fresh
 * "TZ GREEN" spawn once the senior branch's own TZ BUY 2 has genuinely
 * failed -- never while it is still alive. But Prime Trend's own DTF-side
 * concern is different: if TZ BUY 2 is alive yet its own DTF TZ BUY
 * (Stage 1) has NOT YET confirmed, and in that gap a wholly independent
 * fresh WTF cycle (TZ GREEN -> RED -> TZ BUY -> TZ BUY 2) would reach ITS
 * OWN DTF TZ BUY first, THAT lineage is the one Prime Trend tracks from
 * there on -- the original is not terminated, just left dormant (simply
 * excluded from Prime Trend's own instance list from here on; nothing
 * else in this module distinguishes "dormant" from "never tracked").
 *
 * Deliberately NOT a change to tzEngineWtf.ts itself -- that engine has
 * no notion of DTF state at all, and is the single most heavily
 * real-data-validated piece of this codebase. Instead this reruns the
 * SAME already-validated engine on an independent, freshly-seeded slice
 * of the SAME weekly candles (starting right at the original's own
 * formation date, so that fresh engine's own `tip === null` lets a brand
 * new branch spawn immediately on the next qualifying breakout) -- the
 * engine's own existing TZ GREEN/RED/TZ BUY/TZ BUY 2 cascade does the
 * actual work, completely unchanged.
 *
 * Scoped to the "TZ BUY 2" family only, per the user's own worked
 * example -- REAR 2 / REAR RE-ENTER 2 are not addressed by this yet. */
function raceFreshLineage(
  wtfDays: Day[],
  dtfDays: Day[],
  wtfTrace: WtfTraceEntry[],
  wtfDates: string[],
  inst: WtfInstance
): WtfInstance {
  if (inst.family !== "TZ BUY 2") return inst;
  // Only an instance that is GENUINELY STILL OPEN (never explicitly
  // failed in the real trace) is eligible to be raced at all -- per this
  // feature's own documented scope, "an existing WTF TZ BUY 2 instance is
  // alive but its own DTF TZ BUY hasn't confirmed." An instance the real
  // trace already shows ending via a real "TZ BUY 2 SL(letter)" (or any
  // other explicit end event) is a closed, historical fact -- re-slicing
  // from ITS OWN formation date and comparing against some unrelated
  // fresh candidate's own Stage 1 speed answers a question that was never
  // asked, and when that original instance's own Stage 1 happened to
  // never confirm within its own short lifespan (origStage1Date stays
  // null below), the `candidateStage1Date >= origStage1Date` guard is
  // skipped entirely, UNCONDITIONALLY handing the slot to whatever
  // candidate the re-sliced simulation invents. Confirmed real-data bug
  // (MAZDOCK.NS): letter "A" is reused three times (2021-06-07 and
  // 2021-11-01, both real, already SL'd via "TZ BUY 2 SL(A)" in the
  // actual trace; 2022-08-29, genuinely still open) -- without this
  // guard, the two already-dead 2021 instances were each wrongly
  // overwritten by the SAME fictitious candidate (re-sliced from their
  // own formation dates, missing all prior context the real engine had),
  // producing an invented years-long "TZ BUY 2" that escalates all the
  // way to a "BAR SL2(A.5)" on 2026-01-19 -- an event that never actually
  // happens anywhere in the real WTF trace at all.
  if (inst.endEvent !== null) return inst;

  // Original's own Stage 1 (DTF TZ BUY) confirm date, if any, within its
  // own lifespan -- the race's own finish line for the original side.
  const [, , , origStage1] = simulateDtfAll(dtfDays, wtfTrace, wtfDates, inst);
  const origStage1Date = origStage1.find((c) => c.label === "TZ BUY")?.date ?? null;

  const sliceStart = wtfDays.findIndex((d) => d.date === inst.formationDate);
  if (sliceStart === -1) return inst;
  const freshWtfDays = wtfDays.slice(sliceStart);
  const freshWtfDates = freshWtfDays.map((d) => d.date);
  const lastDtfDate = dtfDays.length > 0 ? dtfDays[dtfDays.length - 1].date : null;
  const freshTrace = runWtfTrace(freshWtfDays);
  const candidates = wtfInstancesForFamily(freshTrace, "TZ BUY 2", lastDtfDate);
  if (candidates.length === 0) return inst;
  const candidate = candidates[0];
  if (candidate.formationDate <= inst.formationDate) return inst; // defensive; should never happen structurally

  const [, , , candidateStage1] = simulateDtfAll(dtfDays, freshTrace, freshWtfDates, candidate);
  const candidateStage1Date = candidateStage1.find((c) => c.label === "TZ BUY")?.date ?? null;
  if (candidateStage1Date === null) return inst;
  if (origStage1Date !== null && candidateStage1Date >= origStage1Date) return inst;

  // The fresh lineage reaches its own DTF TZ BUY first (or the original
  // never reaches it at all within its own lifespan) -- it wins.
  return candidate;
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
  "SAR ENTRY SL",
]);

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
  | "SAR 2"
  | "TZ BUY"
  | "TZ BUY SL";

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

/** Only applicable when `inst` ended via a WTF BAR SL2, OR is seeded off
 * a WTF RED2's own confirming-candle Low (the identical "watch for SAR
 * off a reference low" primitive, just a different anchor event) --
 * null otherwise (a TZ BUY 2/REAR 2 SL ending, or an instance still
 * open, has no reference low to seed this watch from). `dtfDays` is the
 * full DTF series; only days strictly after `inst.endDate` are watched.
 * `wtfTrace` is only used to detect a fresh same-letter WTF BAR
 * reforming (the second addition above) -- it does not affect the SAR
 * watch itself. Generalized to RED2 anchors (confirmed real-data,
 * DIXON.NS: the hidden RED2(B.3) 2025-05-26, with no visible WtfInstance
 * of its own for `computePrimeTrendCheckpoints` to anchor against, needs
 * this exact same mechanism to expose its own 2025-06-03..2025-06-19 SAR
 * cycle at all). */
export function postBarSl2Race(
  dtfDays: Day[],
  wtfTrace: WtfTraceEntry[],
  inst: WtfInstance,
  stage1ActiveAt?: (date: string) => boolean
): PostBarSl2Result | null {
  if (inst.endEvent === null || inst.endPrice === null) return null;
  if (!inst.endEvent.startsWith("BAR SL2(") && !inst.endEvent.startsWith("RED2(")) return null;

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
  // True once this episode's own ORIGIN "SAR" checkpoint was itself
  // suppressed (TZ BUY inactive at that exact moment) -- per the user's
  // own rule, "if TZ BUY is not active no BAR THEORY can occur, including
  // SAR and other events related to it": TZ BUY merely reactivating LATER
  // does not retroactively validate an episode that was never eligible to
  // begin with, so every later checkpoint belonging to THIS SAME episode
  // (its own INVALID SAR/INVALID SAR ENTRY/SAR 2 progression) stays
  // suppressed too, even once TZ BUY is active again -- never just the
  // origin alone. Confirmed real-data (ICICIBANK.NS, RED2(F) 2019-07-15):
  // without this, SAR itself fires while TZ BUY sits inactive (suppressed,
  // no checkpoint), but TZ BUY happens to reactivate by the exact date
  // this same episode's INVALID SAR confirms (2019-09-23) -- showing
  // "INVALID SAR" with no "SAR" ever having appeared, an orphaned,
  // self-contradicting checkpoint (caught by validate_dtf.ts's own
  // ordering check). A FRESH SAR re-arm gets its own independent episode
  // and its own independent eligibility check -- but see `finish()`'s own
  // single-episode-per-call shape: this function returns the moment SAR 2
  // confirms, so there is only ever one episode to track per call.
  let originSuppressed = false;

  for (let i = startIdx; i < dtfDays.length; i++) {
    const prev = dtfDays[i - 1];
    const cur = dtfDays[i];

    // Per the user's own rule: "if TZ BUY is not active no BAR THEORY
    // can occur, including SAR and other events related to it." This
    // suppresses this mechanism's own DISPLAY (no checkpoint recorded)
    // while DTF TZ BUY (Stage 1) is inactive for this anchor's own
    // governing letter -- but deliberately does NOT freeze the
    // underlying race mechanics themselves: `outcome`/`raceTriggeredDate`
    // are read downstream by findReinterpretedWindows for a completely
    // different, unrelated question (is a later same-letter spawn a
    // genuine new lineage or noise), which must stay independent of
    // Prime Trend's own Stage-1 status. Confirmed real-data regression
    // (IRCTC.NS): freezing the mechanics outright delayed this RED2's
    // own SAR 2 confirmation, which wrongly flipped a genuine later "TZ
    // GREEN(E)" spawn (2025-12-22 onward) into a misclassified
    // continuation of this earlier lineage instead.
    const activeNow = stage1ActiveAt === undefined || stage1ActiveAt(cur.date);

    if (invalidSarState === null) {
      // Seeking the first SAR fire off the BAR SL2 reference low --
      // same decisive-breach/quiet-ratchet-down shape as the ordinary
      // RED2-anchored SAR watch above, no "something open" gate.
      if (slShape(cur, sarRefLow)) {
        if (activeNow) result.checkpoints.push({ date: cur.date, label: "SAR", price: cur.l });
        else originSuppressed = true;
        invalidSarState = new InvalidSarState(cur.h, cur.l);
      } else if (cur.l < sarRefLow) {
        sarRefLow = cur.l;
        if (activeNow) result.checkpoints.push({ date: cur.date, label: "SAR LL", price: cur.l });
      } else if (cur.h > sarRefLow) {
        if (activeNow) result.checkpoints.push({ date: cur.date, label: "SAR HH", price: cur.h });
      }
      continue;
    }

    const modeBefore = invalidSarState.mode;
    const refHighBefore = invalidSarState.refHigh;
    const refLowBefore = invalidSarState.refLow;
    const frozenBefore = invalidSarState.frozenEntryRefHigh;

    const stepResult = stepInvalidSar(invalidSarState, prev, cur);
    const stepCheckpoints = checkpointForInvalidSarStep(modeBefore, refHighBefore, refLowBefore, frozenBefore, invalidSarState, stepResult, cur);
    if (activeNow && !originSuppressed) result.checkpoints.push(...stepCheckpoints);

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
  inst: WtfInstance,
  barTheoryOpenAt?: (date: string) => boolean
): [PrimeTrendResult[], PrimeTrendLiveStatus | null, PostBarSl2Checkpoint[], PostBarSl2Checkpoint[]] {
  const checkpoints = wtfCheckpoints(wtfTrace, inst.family, inst.letter, inst.formationDate, inst.endDate);

  let startIdx: number | null = null;
  for (let i = 0; i < dtfDays.length; i++) {
    if (dtfDays[i].date > inst.formationDate) {
      startIdx = i;
      break;
    }
  }
  if (startIdx === null) return [[], null, [], []];

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
  // Stage 1 (DTF TZ BUY) is purely an internal gate for the BAR/BAR
  // ENTRY and PBAR ladders -- it never produces a `rows` entry of its
  // own (no "TZ BUY" PrimeTrendResult["side"] exists at all), so a bare
  // TZ BUY -> TZ BUY SL cycle with nothing escalating underneath it was
  // never visible anywhere, even when computePrimeTrend's own
  // Stage-2-confirmed filter doesn't apply. Confirmed real-data (BSE):
  // 2017-06-05 TZ BUY -> 2017-06-06 TZ BUY SL, under the 29/05/17 TZ BUY
  // 2 instance, never shown. Every activation/SL is recorded here
  // regardless of what else happens, same backend-truth-exposure
  // posture as hiddenEventLog/barSl2Log at the WTF level.
  const stage1Checkpoints: PostBarSl2Checkpoint[] = [];

  // DTF SAR -- a recurring kill-switch on BAR ENTRY, independent of the
  // WTF anchor's own life (inst.endEvent/BAR SL2 below is a separate,
  // WTF-side exit). Each fresh WTF RED1->RED2 (red2EventsForLetter)
  // re-arms sarRefLow at that RED2's own confirming Low, which then
  // ratchets further down on later DTF days' own new lows ("RED2 LL")
  // until a decisive breach (gap>=THRESH, close<=ref) fires SAR -- closing
  // whatever is open and permanently freezing BAR tracking for the rest of
  // this instance: per spec, reactivation past a SAR exit is only through
  // BAR theory, which is currently dormant (see this module's header) --
  // so this instance simply goes dormant from here.
  const red2Events = red2EventsForLetter(wtfTrace, inst.letter, inst.formationDate, inst.endDate);
  let red2EventIdx = 0;
  let sarRefLow: number | null = null;
  let sarFired = false;
  // The RED2 date currently anchoring sarRefLow/invalidSarState -- used
  // by the kill-switch below. Null whenever nothing has armed yet.
  let sarArmedFromRed2Date: string | null = null;
  // Every "BAR 2(<letter>...)" formation for this lineage, in order --
  // the kill-switch below fires on BAR 2 (tier 2, the escalation), NOT
  // bare BAR (tier 1) alone. Confirmed real-data (DIXON.NS): RED2(A)
  // 2022-01-24's BAR(A) formed 2022-03-14 but NEVER escalated to BAR 2
  // before SL'ing (2022-05-02) -- that lineage's SAR watch (through its
  // own SAR 2 on 2022-04-19) was never killed at all; a bare BAR alone
  // does not retire the earlier RED2's SAR eligibility, only a genuine
  // BAR 2 does.
  const bar2FormationDates: string[] = [];
  {
    const bar2Re = new RegExp(`^BAR 2\\(${inst.letter}(?:\\.\\d+)?\\)$`);
    for (const { day, events } of wtfTrace) {
      if (events.some((e) => bar2Re.test(e))) bar2FormationDates.push(day.date);
    }
  }
  let sarKillBarIdx = 0;

  // INVALID SAR / INVALID SAR ENTRY -- see the module section comment
  // above stepInvalidSar. invalidSarState is non-null from the moment
  // SAR fires until SAR 2 ends it. anyInvalidationSinceLastSar decides,
  // the next time SAR fires again, whether that firing is just a fresh
  // SAR (an invalidation happened since the last one) or SAR 2 (none
  // did).
  //
  // SAR 2 is NOT a terminal exit for the whole instance -- confirmed:
  // "SAR 2 is kind of PAUSE which can get reactivated if BAR - TAR - TAR
  // ENTRY (or BAR 1 - BAR 2) stays active until new SAR occurs... it
  // terminates the idea of INVALID SAR ENTRY for THAT BAR" only. It just
  // sets invalidSarState back to null, and the NEXT genuine SAR fire (a
  // fresh RED2 re-arming and decisively breaching again) gets its own fresh, independent
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
      // PBAR is saved/stored but deliberately NOT executed right now
      // (per the user's own instruction) -- its internal state must
      // never again reach into Stage 1's own reactivation, which this
      // gate used to do. Confirmed real-data bug (IRCTC.NS, letter D):
      // a WTF BAR formed 2021-04-26 left PBAR's own internal state
      // active, silently blocking TZ BUY's otherwise-decisive
      // reactivation on 2021-06-07 (High 422.77 clears the frozen
      // reference 414.6 by far more than THRESH, Close 418.96 confirms
      // above it) -- cascading into every later BAR THEORY/SAR event
      // this letter should have shown from there on.
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
    const isS1Active = s1 !== null && s1.active;

    // Backend-true Stage 1 (DTF TZ BUY) activation/SL ladder -- recorded
    // regardless of whether anything ever escalates underneath it (see
    // stage1Checkpoints' own comment above).
    if (!wasS1Active && isS1Active) {
      stage1Checkpoints.push({ date: cur.date, label: "TZ BUY", price: (s1 as Stage).refHigh });
    }
    if (wasS1Active && !isS1Active) {
      stage1Checkpoints.push({ date: cur.date, label: "TZ BUY SL", price: (s1 as Stage).refLow });
    }

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
      const { opened, closed, nestedClosed } = stepBarLevel(barState, prev, cur, barTheoryOpenAt !== undefined && barTheoryOpenAt(cur.date));
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
        invalidSarState.everOpened = true;
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
      const sarStepCheckpoints = checkpointForInvalidSarStep(
        checkpointModeBefore,
        checkpointRefHighBefore,
        checkpointRefLowBefore,
        checkpointFrozenBefore,
        invalidSarState,
        invalidSarResult,
        cur
      );
      sarCheckpoints.push(...sarStepCheckpoints);
      // "SAR 2" via a decisive breach within SEEK_INVALID itself (no
      // fresh RED2 needed) -- ends THIS cycle (back to plain BAR
      // THEORY, unsuppressed), not the mechanism permanently -- the
      // next fresh SAR fire still gets its own independent
      // classification. Per the user's own later reversion, PRIME
      // TREND's own exit is back to the FIRST SAR (not SAR 2) -- that
      // exit already happens on the recurring SAR block below, the
      // moment the first real SAR fires, so `barState` is already null
      // by the time this inner cycle could ever end; this block is
      // purely about the INVALID SAR progression's own cycle boundary.
      if (invalidSarResult.sar2Now) {
        invalidSarState = null;
      }
    }

    // --- DTF SAR -- recurring kill-switch, independent of BAR state ---
    // Re-arm on every fresh WTF RED2, superseding any earlier, never-fired
    // watch. RED2's own refLow is that WHOLE WTF week's own Low -- not
    // knowable in full until the week closes -- so arming must wait until
    // we're into the NEXT WTF week, not merely the day after RED2's own
    // week-start date (which would seed the real, eventual low days before
    // it actually happened, a look-ahead bug of the same shape preS1Ref's
    // own seeding is built to avoid).
    while (
      red2EventIdx < red2Events.length &&
      cur.date > red2Events[red2EventIdx].date &&
      containingWeekStart(wtfDates, cur.date) !== red2Events[red2EventIdx].date
    ) {
      sarRefLow = red2Events[red2EventIdx].refLow;
      sarArmedFromRed2Date = red2Events[red2EventIdx].date;
      red2EventIdx += 1;
    }
    // KILL-SWITCH: once a fresh BAR 2 forms for this lineage strictly
    // after the RED2 currently anchoring the SAR watch, that RED2's own
    // SAR mechanism is DEAD -- not dormant, not merely paused --
    // regardless of what state it's in (even mid-INVALID-SAR-ENTRY or
    // waiting to reactivate). Only a FRESH RED1->RED2 (the ordinary
    // re-arm above) can open SAR eligibility again; a bare BAR (tier 1,
    // never escalating) is NOT enough on its own -- confirmed real-data
    // (DIXON.NS): RED2(A) 2022-01-24's own BAR(A) formed 2022-03-14 but
    // never escalated to BAR 2 before SL'ing (2022-05-02) -- that SAR
    // watch's own later SAR (2022-05-04) is genuine, nothing kills it.
    // Strictly BEFORE cur.date (not <=): the BAR 2's own formation date
    // is the first day of its WTF week, and that same day's own daily
    // breakout can simultaneously confirm a real SAR-mechanism event
    // (e.g. an INVALID SAR ENTRY escalation) -- killing before THIS
    // day's own stepInvalidSar call ever runs would erase that same-day
    // event. Confirmed real-data (DIXON.NS, hidden RED2(B) 2024-01-15,
    // tarTbar.ts's own hiddenRed2SarCheckpoints): BAR 2(B.2) is dated
    // 2024-02-19, the SAME day INVALID SAR ENTRY decisively confirms.
    while (sarKillBarIdx < bar2FormationDates.length && bar2FormationDates[sarKillBarIdx] < cur.date) {
      // Once this cycle has ever reached an open INVALID SAR ENTRY
      // position, the kill-switch leaves it alone entirely -- it is a
      // live, committed structure by then, same "already-open stays
      // untouched" protection every other supersession rule in this
      // codebase gives an open position; only a watch that never got
      // that far is fair game. See InvalidSarState.everOpened's own
      // comment -- confirmed real-data (ICICIBANK.NS): without this
      // guard, BAR 2(C.3) forming 2005-11-14 wiped out the INVALID SAR
      // ENTRY that opened 2005-11-16 before it could ever reach its own
      // already-confirmed 2005-11-21 SL.
      const committed = invalidSarState !== null && invalidSarState.everOpened;
      if (sarArmedFromRed2Date !== null && bar2FormationDates[sarKillBarIdx] > sarArmedFromRed2Date && !committed) {
        sarRefLow = null;
        invalidSarState = null;
        sarArmedFromRed2Date = null;
      }
      sarKillBarIdx += 1;
    }
    // SAR itself is recurring: it must keep re-arming and firing on EVERY
    // qualifying RED2, not just the first ever -- `sarFired` below is a
    // SEPARATE, permanent flag (gates the ordinary BAR/PBAR ladder from
    // ever resuming once SAR has fired at all, per "reactivation past a
    // SAR exit is only through BAR theory"); it must never also gate
    // whether SAR itself can fire again.
    //
    // SAR is purely an EXIT -- confirmed: "If and only if BAR ENTRY for
    // PRIME TREND is active, SAR is considered." This gate applies ONLY
    // to the very first SAR this instance ever fires -- before that, SAR
    // is just an exit for BAR ENTRY, and a decisive breach while BAR
    // ENTRY isn't active is not evaluated as a SAR event at all (does
    // not fire, does not spend the watch -- the reference low still
    // ratchets quietly in the background on the new low either way, same
    // as any ordinary non-breach lower low, so the watch stays live
    // until a breach coincides with BAR ENTRY being open). Per the user's
    // own current scoping, PBAR ENTRY no longer licenses this at all --
    // only BAR ENTRY (the TZ-BUY-continuation ladder) does. Confirmed via
    // COCHINSHIP: the 2023-01-10 breach of sarRefLow=245.90 (armed off
    // RED2(B) 2022-12-19) landed with BAR ENTRY already SL'd
    // (2022-12-23) -- nothing open -- so it must NOT fire.
    //
    // Once SAR has fired for real at least once, this gate no longer
    // applies -- from there on SAR is the already-confirmed recurring
    // kill-switch, independent of BAR/TAR/BAR-theory state (it drives the
    // INVALID SAR / SAR 2 progression on every qualifying RED2 or BAR SL2
    // regardless of whether anything is currently open to close) -- per
    // the user's own worked example: "SAR can occur for all the RED 2 and
    // BAR SL 2 as long as the cycle is active." Confirmed via COCHINSHIP:
    // 2024-12-23's SAR fires with BAR 1 - BAR 2 only at SEEK_BAR1 (nothing
    // open) -- still a real SAR, opening the gate to INVALID SAR/INVALID
    // SAR ENTRY.
    const firstSarHasEntryToExit = barState !== null && barState.mode === "BAR_ENTRY_ACTIVE";
    const shouldEvaluateSarFire = sarFired || firstSarHasEntryToExit;
    if (sarRefLow !== null) {
      if (shouldEvaluateSarFire && slShape(cur, sarRefLow)) {
        sarCheckpoints.push({ date: cur.date, label: "SAR", price: cur.l });
        // Captured BEFORE sarFired is overwritten below -- distinguishes
        // the very first SAR ever (never "SAR 2") from a later one.
        const sarFiredAlready = sarFired;
        sarFired = true;

        // Per the user's own later reversion back to the original rule:
        // "EXIT FOR PRIME TREND ENTRY AND BAR THEORY ENTRY AT SAR AND
        // NOT SAR 2" -- PRIME TREND's own open BAR ENTRY force-closes on
        // ANY real SAR fire (first or recurring), unconditionally, same
        // as BAR THEORY's own SAR-exit mechanism in tarTbar.ts. SAR 2's
        // own classification (below) still governs the INVALID SAR
        // progression's own cycle boundary and display label, just no
        // longer gates this force-close.
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
        const isSar2 = sarFiredAlready && hasLiveCycleWithoutInvalidation;

        // INVALID SAR ENTRY itself -- close any open row. Its own
        // occurrence/SL/reactivation mechanics are unchanged -- it
        // always closes on any SAR fire, same as before.
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
        if (isSar2) {
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

  // Merge the last outer (non-nested) row's exit type with the instance's
  // own later WTF-side failure, when that cycle closed on a DTF-side SL
  // and the WTF anchor itself independently failed afterward with no
  // further DTF reactivation in between. (With BAR theory currently
  // dormant -- see this module's header -- BAR ENTRY/REAR ENTRY/REAR
  // RE-ENTER and INVALID SAR ENTRY are the only tracks that can produce a
  // row here; this used to also need to check PBAR ENTRY/TAR ENTRY/BAR 1
  // - BAR 2 independently, since they could alternate or run in parallel
  // with each other -- see lib/primeTrendBarTheory.ts if that returns.)
  const wtfLabel = wtfSlLabel(inst.endEvent);
  mergeTrailingWtfSl(rows, ["BAR ENTRY", "REAR ENTRY", "REAR RE-ENTER", "INVALID SAR ENTRY"], wtfLabel);

  const stage1Active = s1 !== null && s1.active;
  // BAR (tier 1) currently active -- the main ladder's own pre-escalation
  // state, distinct from stage2Active below.
  const barActive = barState !== null && barState.mode === "BAR_ACTIVE";
  // "Stage 2" now means "BAR ENTRY (or REAR ENTRY / REAR RE-ENTER) is
  // currently active" -- a bare BAR alone (pre-escalation) is never
  // surfaced here, same filter rule as the historical trade log.
  const stage2Active = barState !== null && barState.mode === "BAR_ENTRY_ACTIVE";
  // PBAR is currently dormant (relocated to lib/primeTrendBarTheory.ts,
  // not part of active computation) -- always false/null below.
  const pbarTier1Active = false;
  const pbarActive = false;
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
    pbarTier1Since: null,
    pbarTier1ActivationPrice: null,
    pbarTier1StopLoss: null,
    pbarTier1HighestHigh: null,
    pbarTier1HighestHighDate: null,
    pbarActive,
    pbarSince: null,
    pbarActivationPrice: null,
    pbarStopLoss: null,
    pbarHighestHigh: null,
    pbarHighestHighDate: null,
  };

  return [rows, live, sarCheckpoints, stage1Checkpoints];
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

export function prepare(wtfRows: OhlcRow[], dtfRows: OhlcRow[], wtfTraceOverride?: WtfTraceEntry[]) {
  const wtfDays: Day[] = wtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const dtfDays: Day[] = dtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const wtfDates = wtfDays.map((d) => d.date);
  // `wtfTraceOverride`: supplied ONLY by runWtfTrace's own pass-1-derived
  // call back into computePrimeTrend (via barEntryActiveIntervals), to
  // avoid infinite recursion -- runWtfTrace(..., dtfDays) below would
  // otherwise call back into this exact function again. Every ordinary
  // external caller omits it, getting the full two-pass, DTF-aware trace.
  const wtfTrace = wtfTraceOverride ?? runWtfTrace(wtfDays, undefined, undefined, dtfDays);
  const lastDtfDate = dtfDays.length > 0 ? dtfDays[dtfDays.length - 1].date : null;
  const rawInstances = allInstances(wtfTrace, lastDtfDate);
  // See raceFreshLineage's own comment -- a fresh, independent lineage
  // starting while an existing TZ BUY 2 is alive but its own DTF TZ BUY
  // hasn't confirmed yet can win the race to DTF TZ BUY and take over
  // Prime Trend's own tracking for that slot; the original is left
  // dormant (simply not returned here), never terminated.
  const racedInstances = rawInstances.map((inst) => raceFreshLineage(wtfDays, dtfDays, wtfTrace, wtfDates, inst));
  // Two different originals that each lost to the SAME underlying fresh
  // lineage (e.g. sequential same-letter reforms both beaten by one
  // later competing cycle) would otherwise double-count that one real
  // trade -- dedupe by the instance's own real identity (family +
  // formation + end), not by letter, which is only ever a fresh engine
  // run's own cosmetic bookkeeping.
  const seen = new Set<string>();
  const dedupedInstances = racedInstances.filter((inst) => {
    const key = `${inst.family}|${inst.formationDate}|${inst.endDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Per the user's own rule: "No 2 lineage from here on will be running
  // simultaneously... Once the TZ BUY 2 confirms the SAR 2 for any BAR
  // SL 2 will end the lineage. Only after that NEW LINEAGE CAN START."
  // This is a GLOBAL constraint, not a per-letter one -- confirmed by
  // the user's own direct correction: a BRAND NEW letter's first-ever
  // "TZ BUY 2" (DIXON.NS, letter B, 2023-05-29) is STILL illegitimate
  // while an EARLIER lineage under a DIFFERENT letter (A) is itself
  // still unresolved (A's own first BAR SL2 was 2022-05-09, but SAR 2
  // off it never confirms until 2025-12-30) -- "Why are you showing TZ
  // BUY in 2023. Is there any BAR SL2-SAR2 in between?" There was not,
  // so letter B's entire lineage must produce ZERO output until
  // 2025-12-30, regardless of it being a fresh letter. Once ANY "TZ BUY
  // 2" family instance has EVER confirmed (escalated past Stage 1 at
  // all), the WHOLE mechanism is OWNED by that one continuing lineage
  // until ITS OWN BAR SL2's own SAR mechanism confirms a real "SAR 2"
  // -- an ordinary non-escalating failure (plain "TZ BUY
  // SL(letter)"/"TZ BUY 2 SL(letter)", no BAR SL2 at all) does NOT
  // trigger this gate at all -- Stage 1's own ordinary reactivation
  // above its own highest reference high, unchanged, confirmed
  // elsewhere. PRIME TREND's own RED2-anchored exit (SAR 2 closing an
  // escalated BAR ENTRY) does NOT end the lineage either -- only a
  // genuine BAR SL2 does; BAR THEORY and that same lineage's own letter
  // persist through that exit. REAR/REAR 2/REAR RE-ENTER 2 instances
  // are this SAME lineage's own post-BAR-SL2 continuation (reform
  // above the BAR 2's own reference high), never a new one -- they
  // neither trigger nor are blocked by this gate. Processed in strict
  // formation-date order across EVERY letter (not the array's own
  // per-family-per-letter construction order) so a global ordering
  // violation can never slip through. Everything blocked here produces
  // ZERO output for its own entire life, same "continue" shape as every
  // other eligibility gate in this codebase (zero output, not even
  // backend).
  // A top-level instance's own `endEvent` only names the FIRST "BAR
  // SL2(letter.N)" that happened to end wtfInstancesForFamily's own
  // tracking -- the SAME continuing lineage can go through several
  // MORE internal BAR 1/BAR 2/BAR SL2 sub-reforms afterward (A.3, A.4,
  // A.5, ...), each potentially superseding the previous one's own SAR
  // watch (the fresh-BAR-2 kill-switch, same mechanism postBarSl2Race
  // itself already models) before ANY of them finally confirms a real
  // SAR 2. Confirmed real-data (DIXON.NS, letter A): the race anchored
  // on the FIRST BAR SL2 (A.2, 2022-05-09) alone never confirms (killed
  // by later fresh BARs) -- the real, lineage-ending SAR 2 only arrives
  // 2025-12-30, off a LATER sub-lineage's own BAR SL2 (2025-12-08). The
  // earliest confirmed SAR 2 across EVERY "BAR SL2(letter.N)" this
  // letter's own wtfTrace text ever produces is what actually ends it.
  function firstBarSl2Sar2DateForLetter(letter: string, formationDate: string): string | null {
    const pattern = new RegExp(`^BAR SL2\\(${letter}\\.(\\d+)\\)$`);
    let earliest: string | null = null;
    for (const { day, events } of wtfTrace) {
      for (const e of events) {
        if (!pattern.test(e)) continue;
        const synthetic: WtfInstance = { family: "TZ BUY 2", letter, formationDate, endDate: day.date, endEvent: e, endPrice: day.l };
        const race = postBarSl2Race(dtfDays, wtfTrace, synthetic);
        if (race !== null && race.outcome === "RACE_TRIGGERED" && race.raceTriggeredDate !== null) {
          if (earliest === null || race.raceTriggeredDate < earliest) earliest = race.raceTriggeredDate;
        }
      }
    }
    return earliest;
  }
  let globalLineageBlockedUntil: string | null | undefined = undefined;
  const blockedInstanceKeys = new Set<string>();
  const tzBuy2Instances = dedupedInstances
    .filter((inst) => inst.family === "TZ BUY 2")
    .sort((a, b) => (a.formationDate < b.formationDate ? -1 : a.formationDate > b.formationDate ? 1 : 0));
  for (const inst of tzBuy2Instances) {
    if (
      globalLineageBlockedUntil !== undefined &&
      (globalLineageBlockedUntil === null || inst.formationDate < globalLineageBlockedUntil)
    ) {
      blockedInstanceKeys.add(`${inst.family}|${inst.letter}|${inst.formationDate}|${inst.endDate}`);
      continue;
    }
    if (inst.endEvent !== null && inst.endEvent.startsWith("BAR SL2(")) {
      globalLineageBlockedUntil = firstBarSl2Sar2DateForLetter(inst.letter, inst.formationDate);
    } else {
      globalLineageBlockedUntil = undefined;
    }
  }
  const instances = dedupedInstances.filter(
    (inst) => !blockedInstanceKeys.has(`${inst.family}|${inst.letter}|${inst.formationDate}|${inst.endDate}`)
  );
  return { dtfDays, wtfTrace, wtfDates, instances };
}

/** Returns a list of PrimeTrendResult, one per closed (or still-open)
 * entry/exit cycle across every WTF TZ BUY 2 / REAR 2 / REAR RE-ENTER 2
 * instance that produced at least one confirmed Stage 2 (DTF TZ BUY
 * ENTRY) before its own failure -- every closed cycle within a window is
 * its own permanent row, not just the last one. Instances with no
 * confirmed entry at all are silently excluded, per the PRIME TREND
 * filter rule (see PRIME_TREND_RULEBOOK.md). */
export function computePrimeTrend(
  wtfRows: OhlcRow[],
  dtfRows: OhlcRow[],
  barTheoryOpenAt?: (letter: string) => (date: string) => boolean,
  wtfTraceOverride?: WtfTraceEntry[]
): PrimeTrendResult[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows, wtfTraceOverride);

  const results: PrimeTrendResult[] = [];
  for (const inst of instances) {
    const [rows] = simulateDtfAll(dtfDays, wtfTrace, wtfDates, inst, barTheoryOpenAt ? barTheoryOpenAt(inst.letter) : undefined);
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

/** Stage 1 (DTF TZ BUY)'s own full activation/SL ladder, per instance --
 * same shape and same reasoning as computePrimeTrendCheckpoints, just
 * returning simulateDtfAll's 4th element instead of its 3rd. Stage 1
 * never produces a `computePrimeTrend` row of its own (no "TZ BUY"
 * PrimeTrendResult["side"] exists -- it is purely an internal gate for
 * BAR/BAR ENTRY and PBAR), so a bare TZ BUY -> TZ BUY SL cycle with
 * nothing escalating underneath it was invisible everywhere until this.
 * Confirmed real-data (BSE.NS): 2017-06-05 TZ BUY -> 2017-06-06 TZ BUY
 * SL, under the 2017-05-29 TZ BUY 2 instance, never shown anywhere. */
export function computeStage1Checkpoints(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): { letter: string; checkpoints: PostBarSl2Checkpoint[] }[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows);

  const results: { letter: string; checkpoints: PostBarSl2Checkpoint[] }[] = [];
  for (const inst of instances) {
    const [, , , checkpoints] = simulateDtfAll(dtfDays, wtfTrace, wtfDates, inst);
    if (checkpoints.length > 0) results.push({ letter: inst.letter, checkpoints });
  }
  return results;
}

/** Per the user's own rule: "if TZ BUY is not active no BAR THEORY can
 * occur, including SAR and other events related to it" -- BAR THEORY
 * (TAR/TAR ENTRY, the nested BAR/BAR ENTRY cascade) AND the RED2/BAR-SL2
 * anchored SAR mechanism (SAR/INVALID SAR/INVALID SAR ENTRY/SAR 2) both
 * require DTF TZ BUY (Stage 1) to be currently active for their own
 * governing letter -- not just "ever confirmed," continuously. Derived
 * straight from computeStage1Checkpoints' own per-letter "TZ BUY"/"TZ
 * BUY SL" ladder, pairing each activation with its next SL (open-ended
 * if none follows). `untilDate` is EXCLUSIVE -- the SL day itself is
 * already inactive, same convention as barTheoryActiveWindows. */
export function stage1ActiveIntervals(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): Map<string, { sinceDate: string; untilDate: string | null }[]> {
  // `computeStage1Checkpoints` returns ONE entry per WTF instance, and a
  // letter can carry SEVERAL over its life (every "TZ BUY 2" generation,
  // plus any REAR/REAR RE-ENTER 2 instance) -- `result.set(letter, ...)`
  // below must ACCUMULATE across all of them, never overwrite, or every
  // earlier instance's own active interval for that letter silently
  // vanishes the moment a later one is processed. Confirmed real-data
  // bug (DIXON.NS, letter A): the real 2019-09-23 TZ BUY 2 instance's own
  // Stage 1 interval (active continuously from 2019-11-14 onward, never
  // SL'd again) was being replaced outright by a much later, unrelated
  // REAR 2 instance's own narrow 2025-09-18..2025-09-22 window -- the
  // very next entry for the SAME letter in the array -- leaving
  // `stage1ActiveAtFor("A")` wrongly reporting INACTIVE for the whole of
  // 2022, which froze postBarSl2Race's own RED2-anchored SAR simulation
  // into producing nothing at all for RED2(A) 2022-12-05, even though it
  // demonstrably confirms a real SAR 2 on 2022-12-22 once Stage 1 is
  // correctly seen as active.
  const perLetter = computeStage1Checkpoints(wtfRows, dtfRows);
  const result = new Map<string, { sinceDate: string; untilDate: string | null }[]>();
  for (const { letter, checkpoints } of perLetter) {
    const intervals: { sinceDate: string; untilDate: string | null }[] = [];
    let since: string | null = null;
    for (const c of checkpoints) {
      if (c.label === "TZ BUY") since = c.date;
      else if (c.label === "TZ BUY SL" && since !== null) {
        intervals.push({ sinceDate: since, untilDate: c.date });
        since = null;
      }
    }
    if (since !== null) intervals.push({ sinceDate: since, untilDate: null });
    if (intervals.length > 0) {
      const existing = result.get(letter);
      if (existing) existing.push(...intervals);
      else result.set(letter, intervals);
    }
  }
  return result;
}

/** Per the user's own rule: BAR THEORY -- TAR/TAR ENTRY/BAR/BAR ENTRY and
 * the RED2/BAR-SL2-anchored SAR mechanism (SAR/INVALID SAR/INVALID SAR
 * ENTRY/SAR 2) alike -- can only occur while DTF BAR ENTRY (PRIME TREND)
 * is itself ACTIVE, not merely DTF TZ BUY (Stage 1). Narrower than
 * stage1ActiveIntervals above: "active" is exactly the window from a
 * BAR ENTRY/REAR ENTRY/REAR RE-ENTER cycle's own entryDate up to
 * (excluding) its own exitDate, open-ended while still open -- derived
 * straight from computePrimeTrend's own trade log, same accumulate-
 * never-overwrite shape as stage1ActiveIntervals (a letter can carry
 * several such cycles over its life). */
export function barEntryActiveIntervals(wtfRows: OhlcRow[], dtfRows: OhlcRow[], wtfTraceOverride?: WtfTraceEntry[]): Map<string, { sinceDate: string; untilDate: string | null }[]> {
  const results = computePrimeTrend(wtfRows, dtfRows, undefined, wtfTraceOverride);
  const result = new Map<string, { sinceDate: string; untilDate: string | null }[]>();
  for (const r of results) {
    if (r.side !== "BAR ENTRY" && r.side !== "REAR ENTRY" && r.side !== "REAR RE-ENTER") continue;
    // A SAR exit ("DTF SAR") does NOT close this gate -- per the user's
    // own already-confirmed rule, "re-entry after SAR is only through
    // BAR THEORY," so BAR THEORY must stay eligible precisely in the
    // stretch following a SAR exit (that is its whole purpose); only an
    // ordinary SL-type exit closes it, since BAR ENTRY's own ladder
    // (BarLevelState) already handles getting back in after those.
    // Confirmed real-data (ICICIBANK.NS, letter C): without this, BAR
    // ENTRY (PRIME TREND)'s own 2005-10-17 DTF SAR exit permanently
    // closed this gate forever after, making BAR THEORY (TAR/TAR ENTRY)
    // unreachable for the rest of this anchor's life -- including the
    // already-confirmed 2006-07-31 TAR / 2006-08-08 TAR ENTRY that
    // follow BAR(C.4)'s 2006-07-24 formation.
    const untilDate = r.exitType === "still open" || r.exitType === "DTF SAR" ? null : r.exitDate;
    const interval = { sinceDate: r.entryDate, untilDate };
    const existing = result.get(r.letter);
    if (existing) existing.push(interval);
    else result.set(r.letter, [interval]);
  }
  return result;
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
 * DTF side but the WTF anchor itself hasn't failed yet) is omitted.
 *
 * `misclassifiedLetters` (from computeTarTbar -- not imported here to
 * avoid a circular dependency, so the caller must pass it through) is
 * an OPTIONAL exclusion list: a letter the raw WTF engine spawned as a
 * new top-level sibling but that's actually noise (the SAME continuing
 * earlier lineage, misclassified -- see tarTbar.ts's own comment) has no
 * business being reported live. Confirmed real-data bug (DIXON.NS):
 * without this, a stale TZ BUY 2(B) spawned 2023-05-29 -- noise, per the
 * already-confirmed "B has never got activated" finding -- was wrongly
 * reported as the live instance, crowding out whatever the GENUINE
 * current lineage (TZ BUY 2(C), 2026-07-06) is actually doing. */
export function computePrimeTrendLive(
  wtfRows: OhlcRow[],
  dtfRows: OhlcRow[],
  misclassifiedLetters: { letter: string; sinceDate: string; untilDate: string | null }[] = []
): PrimeTrendLiveStatus[] {
  const { dtfDays, wtfTrace, wtfDates, instances } = prepare(wtfRows, dtfRows);

  const liveStatuses: PrimeTrendLiveStatus[] = [];
  for (const inst of instances) {
    if (inst.endEvent !== null) continue; // this instance already failed on the WTF side -- not "right now"
    if (
      misclassifiedLetters.some(
        (m) => m.letter === inst.letter && inst.formationDate >= m.sinceDate && (m.untilDate === null || inst.formationDate <= m.untilDate)
      )
    ) continue;
    const [, live] = simulateDtfAll(dtfDays, wtfTrace, wtfDates, inst);
    if (live !== null && (live.stage1Active || live.stage2Active || live.pbarTier1Active || live.pbarActive)) {
      liveStatuses.push(live);
    }
  }
  return liveStatuses;
}
