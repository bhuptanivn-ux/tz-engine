// TAR / TAR ENTRY / BAR1-BAR2 -- the WTF BAR cross-timeframe follow-up
// theory (part of PRIME TREND's "BAR theory" track). NOT the same as
// the TAR/TBAR spec in WTF_RULEBOOK.md -- this is a from-scratch
// derivation, developed and corrected across real-data verification
// against PAYTM.NS (session of 2026-10-22/23). "TBAR" is retired from
// this file's own vocabulary -- it is TAR ENTRY throughout. There is NO
// DTF REAR escalation in this theory at all: a TAR instance that fully
// fails (having reached TAR ENTRY at some point in its life) is simply
// done for the rest of its WTF BAR's own window, regardless of what
// gate it formed under -- only a fresh WTF BAR reopens TAR.
//
// Anchors on the base WTF engine's own top-level "BAR(label)" milestone
// (lib/tzEngineWtf.ts's own RED1->RED2->BAR1 cascade, run on WEEKLY
// candles) -- reuses lib/primeTrend.ts's own `runWtfTrace`.
//
// WINDOW: a WTF BAR's own governing window runs from its formation
// until EITHER (a) that specific top-level BAR gets its own explicit
// "BAR SL(label)" (not "BAR 2 SL(", not "BAR SL2(", not "BAR SL LL(" --
// those are the WTF engine's own NESTED BAR2 tier events, which do NOT
// end this window), or (b) a fresh "BAR(" formation line appears --
// whichever comes first.
//
// DTF starts watching from the day after the WTF BAR's own formation
// date.
//
// THE CONTINUOUS RED1->RED2 TRACKER: one tracked pullback per window.
// The moment RED1 ever forms, DTF TAR-seeking (the RED-gated path --
// see TAR below) unlocks permanently for the rest of the window (RED2
// is NOT required to unlock it) -- but the SAME red object keeps being
// evaluated in parallel with whatever TAR/TAR ENTRY/BAR1-BAR2 is doing,
// independently watching for RED2. The moment it EVER confirms RED2
// (before TAR forms, while TAR ENTRY is active, during BAR1-BAR2, any
// time), `doorOpen` becomes permanently true for the rest of the
// window -- it never closes again. A RED1-RED2 completing at any point
// relative to a later TAR SL (before, during, or after it) is enough;
// a second one is never required once the first has confirmed.
//
// TAR: two ways to form --
//   Path 1: a straight breakout above the WTF BAR's own reference high
//     (`formationHigh`, the WTF candle's own High at the BAR's
//     formation), no RED needed at all. Spent once per window.
//   RED-gated: once `everSawRed1` is true, a plain day-over-day
//     breakout forms TAR. Its own gate (RED1 vs RED1-RED2) is read
//     fresh at THIS formation moment from `doorOpen` -- not a
//     permanent, window-wide value; every fresh TAR instance (however
//     it came to form) gets its own fresh gate reading.
//
// TAR, once formed, is ONE CONTINUOUS structure for the rest of this WTF
// BAR's life: its own reference high/low keep tracking continuously
// (quiet HH/LL ratchet) for as long as TAR survives, completely
// independent of whatever TAR ENTRY does on top of it -- escalating,
// SL'ing, reactivating, repeatedly, any number of times. Confirmed,
// real-data bug found during PAYTM.NS verification: TAR's own reference
// must NOT be reseeded each time TAR ENTRY reactivates -- it is the
// SAME continuous reference from TAR's original formation until TAR
// itself genuinely dies (see "a REAL TAR SL" below).
//
// TAR ENTRY: escalates from TAR by clearing TAR's own reference high
// (checked against YESTERDAY's own reference, not today's
// already-climbed one -- same look-ahead-ordering fix every other
// breakout check in this codebase uses, via a pre-candle snapshot --
// confirmed, real-data bug: without it, TAR ENTRY could never form at
// all, since the unconditional continuous tracker always climbs the
// reference to include today's own High before the escalation check
// could use yesterday's). Its own reference high/low are reseeded
// fresh at this escalation (not inherited from TAR). TAR ENTRY's own
// (alone) SL -- TAR itself survives -- reactivates DIRECTLY back into
// TAR ENTRY, one step, same candle, PURE PRICE: clear the frozen TAR
// ENTRY reference high and close above it. Confirmed: "It just needs
// to go above the previous TAR ENTRY reference high and close above
// the same" -- no RED gate involved in this reactivation at all.
//
// A REAL "TAR SL" only fires when TAR's own CONTINUOUSLY-tracked
// reference low (never TAR ENTRY's own, separate, tighter one) is
// decisively breached -- independent of whether TAR ENTRY is currently
// open, closed, or mid-reactivation at that exact moment. Its
// consequence:
//   - TAR ENTRY was NEVER reached in this TAR's life -> a genuine
//     reform remains possible, directly above the frozen reference
//     high, one step (rule A: "TAR - TAR SL - TAR: ABOVE THE REFERENCE
//     HIGH OF THE EARLIER"). This new TAR instance reads its own gate
//     fresh, same as any formation.
//   - TAR ENTRY WAS reached at some point in this TAR's life -- whether
//     currently open (a genuinely same-candle combined failure) or
//     already closed earlier with TAR dying later while seeking
//     reactivation (confirmed to count exactly the same: "1ST TAR ENTRY
//     SL FOLLOWED BY TAR SL") -- TERMINAL for TAR: no reform at all, for
//     the rest of THIS WTF BAR's own window, WHATEVER gate this TAR
//     formed under (RED1-RED2 included -- there is no REAR escalation
//     in this theory). Only a fresh WTF BAR (a wholly separate
//     `simulateWindow` call) reopens TAR.
//
// BAR1-BAR2: a SEPARATE, INDEPENDENT entry route -- NOT nested inside an
// open TAR ENTRY position; it can occur even when TAR never escalated
// to TAR ENTRY at all. Gated on: a REAL TAR SL has ever happened (see
// above) AND a RED1->RED2 has completed at any point (see the
// continuous tracker above). Once unlocked, runs on its own, parallel
// track for the rest of this WTF BAR's window, completely unaffected by
// whatever TAR/TAR ENTRY itself does afterward -- further reforms,
// further SLs, going DONE -- none of it resets or pauses this route.
// Forms via the plain breakout (BAR1), escalates to BAR2 by clearing
// its own reference, BAR1's own pre-escalation SL reforms unrestricted
// (unlimited generations), BAR2's own (harder) SL reports as "PRIME
// TREND SL" and reforms at BAR1 again, unrestricted, forever.
//
// VERIFIED, in full, against real PAYTM.NS data (session of
// 2026-10-22/23): Path 1 formation, TAR's continuous reference surviving
// multiple TAR ENTRY SL/reactivation cycles untouched, TAR ENTRY's
// direct one-step reactivation, a real TAR SL firing against that
// continuous reference and correctly triggering DONE (this instance's
// own gate was Path-1/"NONE"), and the independent BAR1->BAR2 route
// unlocking off that same TAR SL plus an already-completed RED1->RED2,
// running its own full form/SL/reform/escalate cycle through BAR2. NOT
// yet exercised by real data: rule A's reform path (TAR dying without
// ever having reached TAR ENTRY) -- implemented per the rule as stated,
// did not fire in the PAYTM window verified (TAR ENTRY was reached
// there).

import { THRESH, EPS, type Day } from "./tzEngineWtf";
import { runWtfTrace, postBarSl2Race, reinterpretPostBarSl2Spawn, type OhlcRow, type WtfInstance, type PostBarSl2Checkpoint, type WtfTraceEntry } from "./primeTrend";

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

class RedGate {
  constructor(public refHigh: number, public refLow: number) {}
}
function stepRed(red: RedGate, prev: Day, cur: Day): "confirmed" | "invalid" | "continuing" {
  if (cur.h > red.refHigh && cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) return "invalid";
  if (cur.h > red.refHigh) red.refHigh = cur.h;
  if (cur.l < red.refLow) {
    const red2Holds = cur.h <= prev.h && red.refLow - cur.l >= THRESH - EPS && cur.c <= red.refLow + EPS;
    if (red2Holds) return "confirmed";
    red.refLow = cur.l;
  }
  return "continuing";
}

export interface TarTbarWindow {
  wtfLabel: string;
  formationDate: string;
  endDate: string | null;
  endReason: "BAR SL" | "new BAR" | "SAR 2 confirmed" | null;
  // The WTF BAR's own reference high AT FORMATION (that week's own
  // known High) -- the seed for TAR's own "Path 1" trigger (a straight
  // breakout above it, no RED required). Only a seed: the caller climbs
  // it quietly on each later DAY's own High directly (same look-ahead
  // trap preS1Ref/wtfBarRefHigh elsewhere in this codebase avoid).
  formationHigh: number;
  // Only ever set for a REINTERPRETED window (see
  // findReinterpretedWindows) -- a real window's own "BAR 2(" already
  // appears as visible WTF text, nothing to derive. A reinterpreted
  // window's own WTF-level BAR2 escalation is hidden under whatever
  // tier the misclassified letter's raw ladder happened to be at that
  // week, so it's derived here directly from the WEEKLY candles, using
  // the identical breakout rule tzEngineWtf.ts's own evalBar2 uses
  // (confirmed real-data, DIXON.NS: A.5's own BAR2 confirms 2022-07-11,
  // A.6's own confirms 2023-05-22 -- both exact). Null if the window
  // ended (or data ran out) before ever confirming.
  bar2Date: string | null;
  // Only ever set for a REINTERPRETED window whose raw-trace spawn has
  // no explicit "TZ GREEN SL("/new formation text of its own (see
  // simulateBarLadderContinuation) -- this window's own BAR1/BAR 2
  // ladder, directly simulated off the weekly candles once the raw
  // engine's REAR takeover is known to be invalid (invalidRearWindows)
  // and so cannot be read off visible trace text either. Extra WTF-side
  // events (RED1/RED2/BAR 2 SL/BAR SL/BAR SL2) this window produces
  // beyond its own formation/BAR 2, in order.
  continuationEvents?: { date: string; label: string }[];
  // The DTF-side SAR cycle(s) this continuation's own RED2 and/or fresh
  // BAR SL2 each arm, tagged by which one anchors them.
  continuationSar?: { anchor: "RED2" | "BAR SL2"; checkpoints: PostBarSl2Checkpoint[] }[];
  // The SAR 2 confirmed by this window's own FRESH BAR SL2 specifically
  // (not any RED2-anchored one) -- see simulateBarLadderContinuation's
  // own barSl2FreezeDate. This is the date that actually resolves the
  // governing lineage's own provisional status (misclassifiedLetters'
  // chain-resolution fix reads this), distinct from `endDate`, which can
  // freeze earlier at a RED2-anchored SAR 2 for BAR-THEORY-tracking
  // purposes only.
  chainResolutionDate?: string | null;
}

export interface TarTbarResult {
  wtfLabel: string;
  wtfFormationDate: string;
  // "BAR ENTRY" rows are the independent BAR1->BAR ENTRY route's own row
  // (confirmed: gets its own visible row, named the same as PRIME
  // TREND's own "BAR ENTRY" -- same underlying escalation shape, just
  // BAR theory's own independent nested instance of it) -- they OVERLAP
  // whatever the enclosing TAR ENTRY row is doing rather than replacing
  // it, since this route runs fully independently (see the module
  // comment above) and its own harder SL ("BAR ENTRY SL") reforms
  // unrestricted, per the confirmed BAR1-BAR2 rules.
  side: "TAR ENTRY" | "BAR ENTRY";
  entryDate: string;
  entryPrice: number;
  exitType: string;
  exitDate: string;
  exitPrice: number | null;
  highestHigh: number | null;
  highestHighDate: string | null;
}

export interface TarTbarLiveStatus {
  wtfLabel: string;
  wtfFormationDate: string;
  side: "TAR" | "TAR ENTRY";
  since: string;
  activationPrice: number;
  // TAR: TAR's own continuously-tracked reference low. TAR ENTRY: its
  // own (tighter) reference low.
  stopLoss: number;
  highestHigh: number | null;
  highestHighDate: string | null;
}

type Mode =
  | "SEEK_TAR" // no TAR alive yet (or never has been)
  | "TAR_ONLY" // TAR is alive and continuously tracked (see tarAlive below); TAR ENTRY not currently open
  | "TAR_ENTRY_ACTIVE" // TAR ENTRY open; TAR's own ref keeps tracking in parallel, unconditionally, below
  | "SEEK_TAR_ENTRY_REACTIVATION" // TAR ENTRY alone SL'd (TAR survived) -- pure price reactivation, no RED gate at all, directly into TAR_ENTRY_ACTIVE
  | "SEEK_TAR_REACTIVATION" // TAR itself died having NEVER reached TAR ENTRY -- reforms directly above the frozen reference high, one step
  | "DONE"; // TAR died for real (having reached TAR ENTRY at some point in its life) -- no reform, for the rest of THIS WTF BAR's own window, whatever gate it formed under (there is no REAR escalation in this theory). Only a fresh WTF BAR reopens TAR. The independent BAR1->BAR2 route (gated on tarSlEverHappened/doorOpen, processed unconditionally every candle) keeps running regardless.

class LevelState {
  mode: Mode;
  doorOpen = false;
  red: RedGate | null = null;
  everSawRed1 = false; // persists even after `red` resolves (confirmed/invalid) -- unlocks TAR-seeking permanently
  // This TAR instance's own formation gate -- set ONCE, when TAR truly
  // forms (Path 1, bare RED1, or RED1-RED2), and NEVER reassigned again
  // for the entire continuous life of this SAME TAR instance (TAR ENTRY
  // escalating/SL'ing/reactivating on top of it does not touch this --
  // confirmed, real-data bug (PAYTM.NS): reassigning this at every TAR
  // ENTRY reactivation wrongly treated each reactivation as a fresh TAR
  // "reform", which is not what happens -- TAR itself was never
  // touched). Decides what a later REAL TAR SL (see tarAlive below)
  // does: done for this WTF BAR's own window (no reform at all), for
  // ANY gate type -- confirmed: "TAR can now ONLY occur after WTF gets
  // a new BAR", stated without a gate-type qualifier, and there is no
  // REAR escalation in this theory at all. Only re-read fresh when TAR
  // genuinely reforms after dying WITHOUT ever having reached TAR ENTRY
  // (rule A) -- that is a genuinely new TAR instance. Null only before
  // any TAR has ever formed yet.
  thisBarGate: "RED1" | "RED1-RED2" | "NONE" | null = null;
  topRef: number;

  // Path 1: a straight breakout above the WTF BAR's own reference high,
  // no RED needed at all -- level 0 only (confirmed: PAYTM.NS 15/04/26
  // TAR forms this way, clearing the WTF BAR's own formationHigh
  // 1133.60 directly, two days after the BAR's own 06/04/26 formation,
  // with no RED1 anywhere in sight yet). Spent once per window, same
  // "never re-clears the WTF BAR high again" rule as PBAR's own Path 1
  // in lib/primeTrend.ts. Climbs quietly on each later day's own High,
  // same look-ahead-avoidance shape as every other seeded reference in
  // this codebase.
  path1RefHigh: number;
  pathOneUsed = false;

  // Whether TAR itself currently exists as a live, continuously-tracked
  // structure -- true from its formation moment until a REAL, decisive
  // breach of its own (continuously-ratcheting) reference low, however
  // long that takes and whatever TAR ENTRY does on top of it in the
  // meantime. Confirmed, real-data bug (PAYTM.NS): TAR's own reference
  // low, set 27/04/26 at 1051.10, must survive untouched through every
  // TAR ENTRY SL/reactivation cycle in between -- it is NOT reseeded
  // each time TAR ENTRY reactivates. The real "TAR SL" only fires when
  // THIS continuously-tracked low is decisively breached (08/06/26 in
  // that case) -- never confused with any of TAR ENTRY's own, separate,
  // tighter SLs.
  tarAlive = false;
  // Whether TAR ENTRY has been reached at ANY point during THIS SAME
  // continuous TAR instance's life (set true the first time it escalates,
  // never reset while tarAlive -- only reset when TAR genuinely reforms
  // fresh under SEEK_TAR_REACTIVATION). Decides what a REAL TAR SL means:
  // true -> this is the terminal "TAR ENTRY SL + TAR SL" case (same
  // candle or sequential, confirmed either counts) -> DONE, whatever
  // gate (thisBarGate) this TAR formed under. False -> TAR ENTRY was
  // never reached at all -> a genuine reform remains possible (rule A).
  everReachedTarEntry = false;
  // TAR ENTRY's own frozen reference high at the moment of its own
  // (alone) SL -- the reactivation target for SEEK_TAR_ENTRY_REACTIVATION.
  frozenTarEntryRefHigh = 0;

  // Set the moment a REAL TAR SL fires (see tarAlive above) -- bare
  // (TAR ENTRY never reached) or the terminal TAR-ENTRY-reached case
  // alike. Together with `doorOpen` (a RED1->RED2 completing at any
  // point, before, during, or after that SL -- confirmed: no second one
  // is needed if one already happened), this is the gate for the
  // independent BAR1->BAR2 entry route below -- confirmed: "TAR SL and
  // RED1-RED2 are required for the BAR1-BAR2" -- NOT nested inside an
  // already-open TAR ENTRY position; BAR1 can occur even when TAR never
  // escalated to TAR ENTRY at all.
  tarSlEverHappened = false;

  tarRefHigh = 0;
  tarRefLow = 0;
  tarActivationPrice: number | null = null; // fixed snapshot at TAR's own formation (matches Stage1's s1ActivationPrice)
  tbarRefHigh = 0;
  tbarRefLow = 0;

  rowEntryDate: string | null = null;
  rowEntryPrice: number | null = null;
  rowHH = 0;
  rowHHDate: string | null = null;

  // The independent BAR1->BAR2 entry route (see tarSlEverHappened above)
  // -- runs in parallel with whatever TAR/TBAR itself is doing
  // afterward, once unlocked; never reset by TAR/TBAR's own later
  // reforms or closures.
  nestedMode: "NONE" | "SEEK_BAR1" | "BAR1_ACTIVE" | "BAR2_ACTIVE" = "NONE";
  nestedRefHigh = 0;
  nestedRefLow = 0;
  nestedEntryDate: string | null = null;
  nestedEntryPrice: number | null = null;
  nestedHH = 0;
  nestedHHDate: string | null = null;

  constructor(formationHigh: number) {
    this.topRef = 0;
    this.mode = "SEEK_TAR";
    this.path1RefHigh = formationHigh;
  }
}

function trackHH(s: LevelState, cur: Day) {
  if (cur.h > s.rowHH) {
    s.rowHH = cur.h;
    s.rowHHDate = cur.date;
  }
}

/** Advances the window by one candle. Returns `opened`/`closed` for the
 * TAR ENTRY row lifecycle, and `nestedClosed` for the nested
 * BAR1->BAR2 cycle's own row (confirmed: gets its own visible row,
 * overlapping the outer row rather than replacing it, since it reforms
 * unrestricted rather than promoting). */
function stepLevel(
  s: LevelState,
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

  // Snapshot BEFORE the unconditional continuous tracker below updates
  // tarRefHigh -- TAR_ONLY's own escalation check further down needs
  // YESTERDAY's reference, not today's already-climbed one (same
  // look-ahead-ordering fix every other breakout check in this codebase
  // uses, e.g. preS1Ref/wtfBarRefHigh) -- otherwise today's own new high
  // is always already baked into the reference it would be compared
  // against, making the breakout structurally impossible.
  const preTarRefHigh = s.tarRefHigh;

  // --- the one continuous RED1->RED2 tracker, independent of TAR/TAR
  // ENTRY state ---
  if (s.red === null) {
    if (isRed1Shape(prev, cur)) {
      s.red = new RedGate(cur.h, cur.l);
      s.everSawRed1 = true; // unlocks TAR-seeking permanently, regardless of how this red resolves
    }
  } else {
    const result = stepRed(s.red, prev, cur);
    if (result === "confirmed") {
      s.red = null;
      s.doorOpen = true;
    } else if (result === "invalid") {
      s.red = null;
    }
  }

  // --- TAR's own CONTINUOUS reference tracking + the REAL "TAR SL" --
  // runs every candle for as long as TAR is alive (see tarAlive's own
  // comment), completely independent of whatever TAR ENTRY is doing.
  let realTarSlNow = false;
  if (s.tarAlive) {
    const tarSlNow = isSl(cur, s.tarRefLow);
    if (!tarSlNow && cur.h > s.tarRefHigh) s.tarRefHigh = cur.h;
    if (!tarSlNow && cur.l < s.tarRefLow) s.tarRefLow = cur.l;
    if (tarSlNow) {
      realTarSlNow = true;
      s.tarAlive = false;
      s.tarSlEverHappened = true;
    }
  }

  // --- independent BAR1->BAR2 entry route, processed unconditionally
  // every candle regardless of s.mode -- gated on tarSlEverHappened (a
  // REAL TAR SL, not any of TAR ENTRY's own tighter ones) and doorOpen
  // (a RED1->RED2 completed at ANY point, before/during/after that SL --
  // confirmed: "TAR SL and RED1-RED2 are required for the BAR1-BAR2",
  // not nested inside an already-open TAR ENTRY position; BAR1 can
  // occur even when TAR never escalated to TAR ENTRY at all. Runs in
  // parallel with whatever TAR/TAR ENTRY itself does afterward -- never
  // reset by a later TAR reform or a later TAR ENTRY SL/formation. ---
  if (s.tarSlEverHappened && s.doorOpen && s.nestedMode === "NONE") s.nestedMode = "SEEK_BAR1";
  if (s.nestedMode === "SEEK_BAR1") {
    if (bar1Shape(prev, cur)) {
      s.nestedRefHigh = cur.h;
      s.nestedRefLow = cur.l;
      s.nestedMode = "BAR1_ACTIVE";
    }
  } else if (s.nestedMode === "BAR1_ACTIVE") {
    if (breaksRef(prev, cur, s.nestedRefHigh)) {
      // Ladder entry price: the ref as it stood before this candle, + THRESH --
      // not the escalation candle's own actual High (same convention as TAR->TBAR).
      const nestedEntryPrice = s.nestedRefHigh + THRESH;
      s.nestedRefHigh = cur.h;
      s.nestedRefLow = cur.l;
      s.nestedEntryDate = cur.date;
      s.nestedEntryPrice = nestedEntryPrice;
      s.nestedHH = cur.h;
      s.nestedHHDate = cur.date;
      s.nestedMode = "BAR2_ACTIVE";
    } else {
      const nSlNow = isSl(cur, s.nestedRefLow);
      if (!nSlNow && cur.h > s.nestedRefHigh) s.nestedRefHigh = cur.h;
      if (!nSlNow && cur.l < s.nestedRefLow) s.nestedRefLow = cur.l;
      if (nSlNow) s.nestedMode = "SEEK_BAR1";
    }
  } else if (s.nestedMode === "BAR2_ACTIVE") {
    if (cur.h > s.nestedHH) {
      s.nestedHH = cur.h;
      s.nestedHHDate = cur.date;
    }
    const nSlNow = isSl(cur, s.nestedRefLow);
    if (!nSlNow && cur.h > s.nestedRefHigh) s.nestedRefHigh = cur.h;
    if (!nSlNow && cur.l < s.nestedRefLow) s.nestedRefLow = cur.l;
    if (nSlNow) {
      // "BAR ENTRY SL" -- door already open, unrestricted reform at
      // the SAME level (confirmed: does not promote). Gets its own
      // visible row, overlapping whatever the outer TAR ENTRY row is
      // doing.
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

  // --- consequence of a REAL TAR SL, decided once here, before anything
  // mode-specific below runs this same candle (a REAL TAR SL can only
  // happen once per continuous TAR instance -- pre-empting the rest of
  // this candle's dispatch is correct, same ordering every other
  // decisive-SL branch in this codebase uses). A "closed" row is only
  // pushed when TAR ENTRY was actually open at this exact moment
  // (TAR_ENTRY_ACTIVE) -- same-candle combined failure; when TAR ENTRY
  // had already SL'd earlier and TAR itself only dies later while
  // waiting to reactivate (SEEK_TAR_ENTRY_REACTIVATION), there is
  // nothing currently open to report a closing row for, only the
  // internal consequence below applies -- confirmed: "1ST TAR ENTRY SL
  // FOLLOWED BY TAR SL" counts the same as same-candle, just with no
  // second visible row. ---
  if (realTarSlNow) {
    if (s.mode === "TAR_ENTRY_ACTIVE") {
      s.topRef = Math.max(s.topRef, s.tarRefHigh, s.tbarRefHigh);
      closed = { exitType: "TAR ENTRY SL + TAR SL", exitPrice: s.tarRefLow };
    } else {
      s.topRef = Math.max(s.topRef, s.tarRefHigh);
    }
    if (s.everReachedTarEntry) {
      // Terminal for TAR itself, whatever gate it formed under (there is
      // no REAR escalation in this theory -- confirmed, unconditional on
      // gate type: "TAR can now ONLY occur after WTF gets a new BAR").
      s.mode = "DONE";
    } else {
      // TAR ENTRY was never reached at all in this TAR's life -- a
      // genuine reform remains possible, directly above the frozen
      // reference high (confirmed, rule A: "TAR - TAR SL - TAR: ABOVE
      // THE REFERENCE HIGH OF THE EARLIER").
      s.mode = "SEEK_TAR_REACTIVATION";
    }
    return { opened, closed, nestedClosed };
  }

  switch (s.mode) {
    case "SEEK_TAR": {
      // Path 1: straight breakout above the WTF BAR's own reference
      // high, no RED needed at all -- level 0 only, spent once per
      // window (confirmed: PAYTM.NS 15/04/26 TAR forms this way,
      // clearing formationHigh=1133.60 directly, two days after the
      // WTF BAR's own 06/04/26 formation, with no RED1 in sight yet).
      if (!s.pathOneUsed && breaksRef(prev, cur, s.path1RefHigh)) {
        s.tarRefHigh = cur.h;
        s.tarRefLow = cur.l;
        s.tarActivationPrice = cur.h;
        s.thisBarGate = "NONE";
        s.pathOneUsed = true;
        s.tarAlive = true;
        s.everReachedTarEntry = false;
        s.mode = "TAR_ONLY";
        break;
      }
      if (cur.h > s.path1RefHigh) s.path1RefHigh = cur.h; // quiet climb, Path 1's own seed
      if (!s.everSawRed1) break;
      // RED-gated TAR formation checks the SAME continuously-climbing
      // WTF-BAR reference Path 1 uses -- confirmed real-data bug
      // (DIXON.NS, A.2 window): TAR must always occur above the WTF
      // BAR's own reference high; RED1/RED1-RED2 only unlocks the
      // (unrestricted-use) formation path, it does not relocate the
      // reference down to a bare day-over-day breakout against
      // yesterday's own High. "30/08/21: WTF BAR (ref high 4337.20) ...
      // 08/09/21: made ref high for TAR ... NO TAR between 30/08/21-
      // 22/09/21 ... 30/09/21: TAR occurs" -- the breakout that
      // confirms is checked against the climbed reference, not prev.h.
      if (breaksRef(prev, cur, s.path1RefHigh)) {
        s.tarRefHigh = cur.h;
        s.tarRefLow = cur.l;
        s.tarActivationPrice = cur.h; // fixed at formation; tarRefHigh keeps climbing afterward
        // This TAR's own gate, read fresh at its own formation moment --
        // not a permanent window-wide value.
        s.thisBarGate = s.doorOpen ? "RED1-RED2" : "RED1";
        s.tarAlive = true;
        s.everReachedTarEntry = false;
        s.mode = "TAR_ONLY";
      }
      break;
    }
    case "TAR_ONLY": {
      // TAR is alive and continuously tracked by the unconditional block
      // above -- this case only watches for escalation into TAR ENTRY.
      // TAR's own SL is handled entirely by that unconditional block,
      // never here. Checked against preTarRefHigh (yesterday's own
      // reference), NOT s.tarRefHigh -- the unconditional block above
      // has already climbed s.tarRefHigh to include today's own High by
      // the time this runs, which would make the breakout structurally
      // impossible otherwise (confirmed, real-data bug: PAYTM.NS TAR
      // ENTRY never formed at all on 17/04/26 without this fix).
      if (breaksRef(prev, cur, preTarRefHigh)) {
        // Entry price is the ladder threshold itself (ref + THRESH), not
        // the candle's own actual High -- same convention shipped PRIME
        // TREND's own Stage 2 uses (`ref2 + THRESH`), confirmed against
        // real KALYANKJIL.NS numbers: TAR's ref climbed to 523.95 by
        // 15/04/2025 (the day before escalation), so TAR ENTRY's own
        // price is 523.95 + 0.20 = 524.15 -- not 16/04's own High of 529.
        const entryPrice = preTarRefHigh + THRESH;
        s.topRef = Math.max(s.topRef, cur.h);
        s.tbarRefHigh = cur.h;
        s.tbarRefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.everReachedTarEntry = true;
        s.mode = "TAR_ENTRY_ACTIVE";
        opened = { price: entryPrice };
      }
      break;
    }
    case "TAR_ENTRY_ACTIVE": {
      // TAR's own ref is tracked by the unconditional block above; this
      // case only tracks TAR ENTRY's own (tighter) ref and its own SL
      // alone (TAR surviving while TAR ENTRY alone fails -- TAR SL +
      // TBAR SL combined is handled by the unconditional block instead).
      trackHH(s, cur);
      const tbarSlNow = isSl(cur, s.tbarRefLow);
      if (!tbarSlNow && cur.h > s.tbarRefHigh) s.tbarRefHigh = cur.h;
      if (!tbarSlNow && cur.l < s.tbarRefLow) s.tbarRefLow = cur.l;
      if (tbarSlNow) {
        s.topRef = Math.max(s.topRef, s.tbarRefHigh);
        s.frozenTarEntryRefHigh = s.tbarRefHigh;
        closed = { exitType: "TAR ENTRY SL", exitPrice: s.tbarRefLow };
        s.mode = "SEEK_TAR_ENTRY_REACTIVATION";
      }
      break;
    }
    case "SEEK_TAR_ENTRY_REACTIVATION": {
      // Pure price, no RED gate at all -- confirmed: "It just needs to
      // go above the previous TAR ENTRY reference high and close above
      // the same." Reactivates TAR ENTRY directly, one step, same
      // candle (TAR itself is untouched -- still continuously alive,
      // tracked by the unconditional block above this whole time).
      if (breaksRef(prev, cur, s.frozenTarEntryRefHigh)) {
        const entryPrice = s.frozenTarEntryRefHigh + THRESH;
        s.tbarRefHigh = cur.h;
        s.tbarRefLow = cur.l;
        s.rowHH = cur.h;
        s.rowHHDate = cur.date;
        s.mode = "TAR_ENTRY_ACTIVE";
        opened = { price: entryPrice };
      } else if (cur.h > s.frozenTarEntryRefHigh) {
        s.frozenTarEntryRefHigh = cur.h;
      }
      break;
    }
    case "SEEK_TAR_REACTIVATION": {
      // TAR died having NEVER reached TAR ENTRY -- reforms directly, one
      // step, above the frozen reference high (confirmed, rule A). This
      // is a genuinely NEW TAR instance, reading its own gate fresh,
      // same as any other TAR formation.
      if (breaksRef(prev, cur, s.topRef)) {
        s.topRef = Math.max(s.topRef, cur.h);
        s.tarRefHigh = cur.h;
        s.tarRefLow = cur.l;
        s.tarActivationPrice = cur.h;
        s.thisBarGate = s.doorOpen ? "RED1-RED2" : "RED1";
        s.tarAlive = true;
        s.everReachedTarEntry = false;
        s.mode = "TAR_ONLY";
      } else if (cur.h > s.topRef) {
        s.topRef = cur.h;
      }
      break;
    }
    case "DONE": {
      // TAR died for real, having reached TAR ENTRY, under a non-RED1-
      // RED2 gate -- no further TAR/TAR ENTRY activity for the rest of
      // this WTF BAR's own window; only a fresh WTF BAR (a new
      // simulateWindow call entirely) reopens TAR. The independent
      // BAR1->BAR2 route above is unaffected and keeps running on its
      // own, since it's processed unconditionally every candle
      // regardless of this mode.
      break;
    }
  }

  return { opened, closed, nestedClosed };
}

function simulateWindow(
  dtfDays: Day[],
  startIdx: number,
  endIdxExclusive: number,
  wtfLabel: string,
  wtfFormationDate: string,
  formationHigh: number,
  rows: TarTbarResult[]
): TarTbarLiveStatus[] {
  const liveStatuses: TarTbarLiveStatus[] = [];
  const s = new LevelState(formationHigh);

  for (let i = startIdx; i < endIdxExclusive; i++) {
    const prev = dtfDays[i - 1];
    const cur = dtfDays[i];
    const { opened, closed, nestedClosed } = stepLevel(s, prev, cur);
    if (opened) {
      s.rowEntryDate = cur.date;
      s.rowEntryPrice = opened.price;
    }
    if (closed) {
      rows.push({
        wtfLabel,
        wtfFormationDate,
        side: "TAR ENTRY",
        entryDate: s.rowEntryDate as string,
        entryPrice: s.rowEntryPrice as number,
        exitType: closed.exitType,
        exitDate: cur.date,
        exitPrice: closed.exitPrice,
        highestHigh: s.rowHHDate ? s.rowHH : null,
        highestHighDate: s.rowHHDate,
      });
    }
    if (nestedClosed) {
      // Own visible row for the nested BAR1->BAR2 cycle, overlapping
      // the still-open outer row rather than replacing it (confirmed:
      // this reforms unrestricted rather than promoting).
      rows.push({
        wtfLabel,
        wtfFormationDate,
        side: "BAR ENTRY",
        entryDate: nestedClosed.entryDate,
        entryPrice: nestedClosed.entryPrice,
        exitType: "BAR ENTRY SL",
        exitDate: cur.date,
        exitPrice: nestedClosed.exitPrice,
        highestHigh: nestedClosed.hh,
        highestHighDate: nestedClosed.hhDate,
      });
    }
  }

  // Window ended -- report still-open row/live status, if any.
  if (s.mode === "TAR_ENTRY_ACTIVE" && s.rowEntryDate !== null) {
    liveStatuses.push({
      wtfLabel,
      wtfFormationDate,
      side: "TAR ENTRY",
      since: s.rowEntryDate,
      activationPrice: s.rowEntryPrice as number,
      stopLoss: s.tbarRefLow,
      highestHigh: s.rowHHDate ? s.rowHH : null,
      highestHighDate: s.rowHHDate,
    });
  } else if (s.mode === "TAR_ONLY") {
    liveStatuses.push({
      wtfLabel,
      wtfFormationDate,
      side: "TAR",
      since: s.rowEntryDate ?? wtfFormationDate,
      activationPrice: s.tarActivationPrice as number,
      stopLoss: s.tarRefLow,
      highestHigh: null,
      highestHighDate: null,
    });
  }

  return liveStatuses;
}

function findWindows(wtfDays: Day[]): TarTbarWindow[] {
  const trace = runWtfTrace(wtfDays);
  const formations: { date: string; label: string; formationHigh: number }[] = [];
  const sls: { date: string; label: string }[] = [];
  // A BAR-theory window also ends the moment its PARENT WTF family dies
  // back underneath it (`TZ BUY SL(letter)`/`TZ GREEN SL(letter)`), not
  // only on its own label's "BAR SL(" or a fresh "BAR(" reform --
  // confirmed real-data bug (DIXON.NS): A.1's window stayed open (per
  // the text-pattern scan alone) all the way to A.1's own NEXT "BAR("
  // reform (2020-03-02), but the whole family had already collapsed via
  // "TZ BUY SL(A)" on 2019-07-29, so no TAR/TAR ENTRY should have been
  // computed at all in between (the 28/08/19 TAR ENTRY / 17/09/19 TAR
  // ENTRY SL this produced were both spurious).
  const familyDeaths: { date: string; letter: string }[] = [];
  for (const entry of trace) {
    for (const e of entry.events) {
      const formMatch = /^BAR\(([^)]+)\)$/.exec(e);
      if (formMatch) formations.push({ date: entry.day.date, label: formMatch[1], formationHigh: entry.day.h });
      const slMatch = /^BAR SL\(([^)]+)\)$/.exec(e);
      if (slMatch) sls.push({ date: entry.day.date, label: slMatch[1] });
      const familyDeathMatch = /^TZ (?:BUY|GREEN) SL\(([^)]+)\)$/.exec(e);
      if (familyDeathMatch) familyDeaths.push({ date: entry.day.date, letter: familyDeathMatch[1] });
    }
  }

  const windows: TarTbarWindow[] = [];
  for (let i = 0; i < formations.length; i++) {
    const f = formations[i];
    const letter = f.label.split(".")[0];
    const nextFormation = formations[i + 1] ?? null;
    const matchingSl = sls.find((sl) => sl.label === f.label && sl.date > f.date && (nextFormation === null || sl.date < nextFormation.date));
    const familyDeath = familyDeaths.find(
      (fd) =>
        fd.letter === letter &&
        fd.date > f.date &&
        (matchingSl === undefined || fd.date < matchingSl.date) &&
        (nextFormation === null || fd.date < nextFormation.date)
    );
    if (familyDeath) {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: familyDeath.date, endReason: "BAR SL", formationHigh: f.formationHigh, bar2Date: null });
    } else if (matchingSl) {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: matchingSl.date, endReason: "BAR SL", formationHigh: f.formationHigh, bar2Date: null });
    } else if (nextFormation) {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: nextFormation.date, endReason: "new BAR", formationHigh: f.formationHigh, bar2Date: null });
    } else {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: null, endReason: null, formationHigh: f.formationHigh, bar2Date: null });
    }
  }
  return windows;
}

// A WTF "BAR SL2(label)" is PROVISIONAL, not a validated terminal event
// on its own -- it only validates once its own anchored DTF SAR-after-
// BAR-SL2 watch decisively confirms "SAR 2" (see primeTrend.ts's
// postBarSl2Race/reinterpretPostBarSl2Spawn). If SAR 2 never confirms
// before the raw engine's own next sibling spawn ("TZ GREEN(newLetter)"
// -- the unconditional, DTF-unaware consequence TZEngine always takes
// once BAR SL2 opens sibling-spawn eligibility), that spawn is a
// misclassification: the real structure is the ORIGINAL letter's own
// BAR lineage simply continuing, not a genuine new family. Confirmed,
// real-data (DIXON.NS): BAR SL2(A.2) on 2022-05-09 never got its own
// SAR 2, so the raw trace's TZ GREEN(B) on 2022-05-30 -- and every
// later TZ GREEN(B)/TZ GREEN SL(B) reform under that same misclassified
// letter -- should instead read as fresh BAR/BAR SL reforms continuing
// family A's own lineage. Verified end-to-end against the user's own
// given flow for that whole stretch (11/07/22 TAR through 04/08/22
// BAR1-BAR2, every date exact) once fed through unchanged as ordinary
// BAR-theory windows.
//
// Scoped to ONE level of reinterpretation per BAR SL2 instance -- a
// reinterpreted window that itself later ends in another genuine BAR
// SL2 is not recursively re-checked here (that would need its own
// fresh postBarSl2Race/reinterpretPostBarSl2Spawn call against ITS OWN
// DTF SAR watch); not yet exercised by real data, flagged rather than
// guessed at.

/** A reinterpreted window's own WTF-level "BAR 2" escalation, derived
 * directly from the WEEKLY candles using the identical breakout rule
 * tzEngineWtf.ts's own evalBar2 uses for a real lineage (clear the
 * continuously-climbing reference by the required margin/shape) --
 * confirmed real-data (DIXON.NS): A.5 (formed 2022-06-27) confirms
 * 2022-07-11 exact; A.6 (formed 2023-02-27) confirms 2023-05-22 exact.
 * A simplification against evalBar2's own full nuance: this climbs the
 * reference on every plain new high (same as Path 1's own quiet climb
 * elsewhere in this file), not evalBar2's own RED1-dependent near-miss
 * distinction -- not yet verified whether that simplification ever
 * matters in practice. Returns null if the window ends (or data runs
 * out) before ever confirming. */
function deriveReinterpretedBar2Date(wtfDays: Day[], formationDate: string, formationHigh: number, endDate: string | null): string | null {
  const startIdx = wtfDays.findIndex((d) => d.date === formationDate);
  if (startIdx === -1) return null;
  let ref = formationHigh;
  for (let i = startIdx + 1; i < wtfDays.length; i++) {
    const prev = wtfDays[i - 1];
    const cur = wtfDays[i];
    if (endDate !== null && cur.date >= endDate) return null;
    if (breaksRef(prev, cur, ref)) return cur.date;
    if (cur.h > ref) ref = cur.h;
  }
  return null;
}
interface BarLadderContinuation {
  // RED1/RED2/BAR 2 SL/BAR SL/BAR SL2, in order -- HH/LL omitted (not
  // displayed anywhere else in this codebase either). "BAR 2" itself is
  // NOT included -- the window's own bar2Date already carries it.
  wtfEvents: { date: string; label: string }[];
  sarCycles: { anchor: "RED2" | "BAR SL2"; checkpoints: PostBarSl2Checkpoint[] }[];
  // The earliest SAR 2 confirmed by either cycle above, or null if
  // neither ever confirms within the data. BAR THEORY tracking for this
  // window must freeze here (see the rule below) -- confirmed real-data
  // (DIXON.NS): "BAR ENTRY was only possible for a WTF BAR which is
  // either ACTIVE or RED2-SAR-SAR2 has not yet occurred" / "BAR SL2-SAR-
  // SAR2 halts the lineage... BAR theory will start for either new
  // lineage or after REAR once it confirms" -- i.e. this window's own
  // BAR THEORY tracking does not resume on its own past this date.
  freezeDate: string | null;
  // The SAR 2 confirmed specifically by this window's OWN fresh BAR SL2
  // (not the RED2-anchored one) -- the one that actually governs
  // whether a NEW top-level lineage is legitimate yet (see
  // misclassifiedLetters' own chain-resolution use of this), which is a
  // narrower question than "BAR THEORY tracking has frozen" above. Null
  // if this window never reaches its own fresh BAR SL2, or reaches it
  // but SAR 2 never confirms.
  barSl2FreezeDate: string | null;
}

/** What a reinterpreted window's own BAR1->BAR 2 structure keeps doing
 * after its formation/BAR 2 escalation, directly simulated off the
 * weekly candles using the SAME rules tzEngineWtf.ts's own BAR-lineage
 * tracking uses (own BAR1-tier refLow -> "BAR SL"/deep SL2 watch; own
 * BAR 2-tier refLow -> recoverable "BAR 2 SL"; a fully independent,
 * parallel top-level RED1->RED2 pullback) -- NOT read off the raw
 * engine's own trace text, because for a reinterpreted window that text
 * does not exist: the raw engine's own letter this window is hiding
 * under has usually already diverted into something else entirely (an
 * ancestor BAR SL2's own REAR takeover, now correctly voided by
 * invalidRearWindows) that locks its own lineage object out of ever
 * tracking this price action again (confirmed by direct backend
 * inspection, DIXON.NS: zero RED1/RED2 fires under any letter for the
 * whole 2025-09/2025-12 stretch). Confirmed real-data (DIXON.NS, window
 * formed 2025-06-30, BAR 2 2025-07-07): RED1 2025-09-29, RED2
 * 2025-10-20, its own RED2-anchored SAR 2 2025-11-06, BAR 2's own
 * decisive SL 2025-11-03, the BAR1-tier's own SL 2025-12-01, SL2
 * 2025-12-08, and ITS OWN fresh SAR 2 2025-12-30 -- every one of these
 * dates falls out of this exact simulation, run against nothing but the
 * real weekly OHLC.
 *
 * Scope: stops the moment a fresh BAR SL2 is reached (reporting the
 * freeze date if its own SAR 2, or the earlier RED2-anchored one,
 * confirms) -- there is no verified real-data case yet for what the WTF
 * ladder itself does past that point (a further reform, a genuine REAR
 * this time, etc.), so none is fabricated here. */
function simulateBarLadderContinuation(
  wtfDays: Day[],
  dtfDays: Day[],
  wtfTrace: WtfTraceEntry[],
  formationDate: string,
  formationHigh: number,
  formationLow: number
): BarLadderContinuation {
  const wtfEvents: BarLadderContinuation["wtfEvents"] = [];
  const sarCycles: BarLadderContinuation["sarCycles"] = [];
  let freezeDate: string | null = null;
  let barSl2FreezeDate: string | null = null;

  const armSarCycle = (anchor: "RED2" | "BAR SL2", anchorDate: string, anchorLow: number) => {
    // Reuses postBarSl2Race verbatim -- its own daily SAR/INVALID SAR/
    // SAR 2 stepper only needs a reference low and a start date, nothing
    // about the label has to exist in the real trace (same technique
    // already verified for the BAR-SL2-anchored checkpoint lists
    // elsewhere in this table).
    const inst: WtfInstance = {
      family: "TZ BUY 2",
      letter: "_shadow",
      formationDate: wtfDays[0].date,
      endDate: anchorDate,
      endEvent: "BAR SL2(_shadow)",
      endPrice: anchorLow,
    };
    const result = postBarSl2Race(dtfDays, wtfTrace, inst);
    if (result === null) return;
    sarCycles.push({ anchor, checkpoints: result.checkpoints });
    if (result.outcome === "RACE_TRIGGERED" && result.raceTriggeredDate !== null) {
      if (freezeDate === null || result.raceTriggeredDate < freezeDate) freezeDate = result.raceTriggeredDate;
      if (anchor === "BAR SL2") barSl2FreezeDate = result.raceTriggeredDate;
    }
  };

  let refHigh = formationHigh;
  let refLow = formationLow;
  let bar2: { refHigh: number; refLow: number; slActive: boolean } | null = null;
  let sl: { refHigh: number; refLow: number; sl2: boolean } | null = null;
  let red: RedGate | null = null;
  // Mirrors buy.awaitingBar2SinceRed2: once a RED2 confirms, no FURTHER
  // RED1 can attach until a fresh BAR 2 escalation resets it -- which,
  // for this SAME lineage, never happens again once BAR 2 has already
  // formed once (bar2 is set once and never re-escalates here). So this
  // flips permanently true the first time RED2 confirms, same as the
  // real engine's own lineage can only ever complete ONE RED1->RED2
  // cycle for its one, already-escalated BAR 2. Confirmed real-data
  // (DIXON.NS): only 2025-09-29/2025-10-20's cycle exists -- no second
  // RED1 ever attaches after that RED2 confirms, all the way through
  // this window's own fresh BAR SL/BAR SL2.
  let red2Done = false;

  const startIdx = wtfDays.findIndex((d) => d.date === formationDate);
  if (startIdx === -1) return { wtfEvents, sarCycles, freezeDate, barSl2FreezeDate };

  for (let i = startIdx + 1; i < wtfDays.length; i++) {
    const prev = wtfDays[i - 1];
    const cur = wtfDays[i];

    // BAR 2-tier (unconditional, mirrors evalBar2 running every candle
    // regardless of the BAR1-tier sl state below -- but only while sl
    // itself is still null, same as evalBar2's own early return once
    // lin.sl exists).
    if (sl === null) {
      if (bar2 !== null) {
        if (bar2.slActive) {
          if (cur.l >= prev.l && cur.h > bar2.refHigh && cur.h - bar2.refHigh >= THRESH - EPS && cur.c >= bar2.refHigh) {
            bar2.refHigh = cur.h;
            bar2.refLow = cur.l;
            bar2.slActive = false;
          }
        } else if (cur.l < bar2.refLow) {
          if (isSl(cur, bar2.refLow)) {
            wtfEvents.push({ date: cur.date, label: "BAR 2 SL" });
            bar2.slActive = true;
          } else {
            bar2.refLow = cur.l;
          }
        }
        if (!bar2.slActive && cur.h > bar2.refHigh) bar2.refHigh = cur.h;
      } else if (breaksRef(prev, cur, refHigh)) {
        // This window's own first BAR 2 escalation already has its own
        // date (the caller's bar2Date, from deriveReinterpretedBar2Date)
        // -- not pushed again here.
        bar2 = { refHigh: cur.h, refLow: cur.l, slActive: false };
      }
    }

    // BAR1-tier: once sl exists, EVERYTHING below (bar2's own further
    // tracking above included, via the `sl===null` guard) stops except
    // sl's own HH/LL/SL2 watch -- same as the real engine's permanent
    // branch split on lin.sl.
    if (sl !== null) {
      if (!sl.sl2) {
        if (cur.h > sl.refHigh) sl.refHigh = cur.h;
        if (isSl(cur, sl.refLow)) {
          wtfEvents.push({ date: cur.date, label: "BAR SL2" });
          sl.sl2 = true;
          armSarCycle("BAR SL2", cur.date, cur.l);
          break; // see this function's own scope note above
        } else if (cur.l < sl.refLow) {
          sl.refLow = cur.l;
        }
      }
      continue;
    }
    if (isSl(cur, refLow)) {
      wtfEvents.push({ date: cur.date, label: "BAR SL" });
      sl = { refHigh: cur.h, refLow: cur.l, sl2: false };
      // Same as the real engine's own `continue` the instant lin.sl is
      // created this candle -- no RED1 check below for this same week.
      continue;
    }
    if (cur.l < refLow) refLow = cur.l;

    // Top-level RED1/RED2 -- only reached on a candle that did NOT just
    // create sl above (see the continue), only before red2Done, and
    // only once this lineage has escalated to BAR 2. Confirmed real-data
    // (DIXON.NS, A.6 window): "ONLY BAR had formed before this RED1 --
    // RED1-RED2 is only possible once BAR-BAR 2 ('BAR ENTRY' is BAR 2's
    // own DTF-side name) has confirmed", already coded for the real
    // engine's own lineages (tzEngineWtf.ts: "RED1-RED2 will not be
    // required to be tracked if only BAR 1 has formed and SL'd. RED1-RED2
    // will form once BAR 1-BAR 2 is completed") -- a bare, never-escalated
    // BAR has no RED1-RED2 concept of its own at all.
    if (bar2 !== null && !red2Done) {
      if (red === null) {
        if (isRed1Shape(prev, cur)) {
          red = new RedGate(cur.h, cur.l);
          wtfEvents.push({ date: cur.date, label: "RED1" });
        }
      } else {
        const outcome = stepRed(red, prev, cur);
        if (outcome === "invalid") {
          red = null;
          wtfEvents.push({ date: cur.date, label: "INVALID RED1" });
        } else if (outcome === "confirmed") {
          wtfEvents.push({ date: cur.date, label: "RED2" });
          red = null;
          red2Done = true;
          armSarCycle("RED2", cur.date, cur.l);
        }
      }
    }
  }

  return { wtfEvents, sarCycles, freezeDate, barSl2FreezeDate };
}

function findReinterpretedWindows(
  wtfDays: Day[],
  dtfDays: Day[]
): {
  windows: TarTbarWindow[];
  misclassifiedLetters: { letter: string; sinceDate: string; untilDate: string | null }[];
  invalidRearWindows: { letter: string; sinceDate: string; untilDate: string | null }[];
} {
  const barSl2BackendLog: { label: string; date: string; low: number }[] = [];
  const wtfTrace = runWtfTrace(wtfDays, barSl2BackendLog);
  const windows: TarTbarWindow[] = [];
  // The misclassified sibling letter's ENTIRE downstream existence is
  // noise, not just its own "TZ GREEN(" tier -- confirmed real-data
  // (DIXON.NS): the raw engine keeps running its own unmodified ladder
  // on top of the misclassified letter regardless (RED(B), TZ BUY(B),
  // TZ BUY SL(B), TZ BUY 2(B), and eventually a genuine-looking
  // "BAR(B.1)" of its own), but since BAR SL2(A.2)'s own SAR cycle
  // still has never received a real SAR 2 confirmation (only a fresh
  // SAR re-arming "for BAR SL2 09/05/22", not a decisive SAR 2), every
  // bit of that downstream ladder -- B.1's own later "BAR(" included --
  // stays noise too, fully subsumed by the reinterpreted window already
  // continuing (A.6 here). Reported so `computeTarTbar` can drop any
  // raw-trace window for this letter from the spawn date onward, so it
  // is never ALSO counted as a second, genuine, parallel family.
  const misclassifiedLetters: { letter: string; sinceDate: string; untilDate: string | null }[] = [];

  // REAR is gated EXACTLY the same way a brand-new top-level "TZ GREEN"
  // is: forming above a BAR 2's own reference high requires not just that
  // BAR SL2 to have fired, but for its own SAR-SAR2 cycle to have
  // DECISIVELY CONFIRMED SAR 2 -- the raw WTF engine's own rule ("REAR
  // only occurs once this lineage has confirmed genuine BAR SL2") is a
  // necessary but not sufficient condition on its own. Confirmed
  // real-data (DIXON.NS): REAR(B)/REAR 2(B)/REAR 2 SL(B)/REAR SL(B)
  // (2025-09-01 through 2025-09-29) all fire off BAR SL2(B.3)'s own
  // 2025-06-16 reference high, but that SAME BAR SL2's SAR 2 does not
  // confirm until 2025-12-26 -- so none of that REAR vocabulary was ever
  // real; it is nothing but the SAME still-open BAR 2 making a new high
  // (BAR 2 HH), same as price breaking out before a validated BAR SL2
  // never licenses a fresh top-level lineage either. Reported the same
  // {letter, sinceDate, untilDate} shape as `misclassifiedLetters` so a
  // caller can drop any REAR-family text for this letter in this range.
  const invalidRearWindows: { letter: string; sinceDate: string; untilDate: string | null }[] = [];

  // Backend-true confirmations (barSl2BackendLog), NOT a regex over the
  // visible trace text -- a BAR SL2 that fires for a sub-lineage born
  // while its own branch is dormant never reaches visible output at all
  // (confirmed real-data, DIXON.NS branch B's own silent B.3: SL2 fired
  // 2025-06-16 with nothing shown), yet it is exactly the event this
  // misclassification detection has to see.
  const barSl2Events: { letter: string; label: string; date: string; low: number }[] = barSl2BackendLog.map(
    (e) => ({ letter: e.label.split(".")[0], label: e.label, date: e.date, low: e.low })
  );

  for (const sl2 of barSl2Events) {
    const inst: WtfInstance = {
      family: "TZ BUY 2",
      letter: sl2.letter,
      formationDate: wtfDays[0].date,
      endDate: sl2.date,
      endEvent: `BAR SL2(${sl2.label})`,
      endPrice: sl2.low,
    };
    const sarResult = postBarSl2Race(dtfDays, wtfTrace, inst);
    if (sarResult === null) continue;

    // NOT just the first sibling spawn -- for as long as THIS SAME BAR
    // SL2's own SAR cycle has never decisively confirmed SAR 2 (never,
    // for DIXON.NS's own BAR SL2(A.2)), EVERY subsequent "TZ GREEN(
    // newLetter)" is an equally fresh misclassification, not only the
    // very first one. Confirmed real-data (DIXON.NS): the raw trace
    // spawns letter B on 2022-05-30 (the one `reinterpretPostBarSl2Spawn`
    // itself checks), but then ALSO spawns an orphaned, one-week-only
    // letter C on 2023-05-15 while letter B's own (equally misclassified)
    // structure is still alive -- both are noise, both get folded into
    // the same continuing `sl2.letter` lineage.
    const sar2Date = sarResult.outcome === "RACE_TRIGGERED" ? sarResult.raceTriggeredDate : null;

    // REAR-gating check (see invalidRearWindows' own comment above) --
    // deliberately independent of `reinterp`/`shouldBeBar` below, which
    // only governs whether a NEW sibling letter's spawn is noise. REAR
    // forms directly under THIS SAME `sl2.letter`, no new letter
    // involved, so it needs its own, simpler check: any REAR-family text
    // for `sl2.letter` strictly after this BAR SL2 and before its own
    // SAR 2 (or forever, if SAR 2 never confirms) is invalid.
    const rearPattern = new RegExp(`^REAR(?: RE-ENTER)?(?: 2)?(?: SL)?\\(${sl2.letter}\\)$`);
    let firstInvalidRear: string | null = null;
    for (const entry of wtfTrace) {
      if (entry.day.date <= sl2.date) continue;
      if (sar2Date !== null && entry.day.date >= sar2Date) break;
      if (firstInvalidRear === null && entry.events.some((e) => rearPattern.test(e))) {
        firstInvalidRear = entry.day.date;
      }
    }
    if (firstInvalidRear !== null) {
      invalidRearWindows.push({ letter: sl2.letter, sinceDate: firstInvalidRear, untilDate: sar2Date ?? null });
    }

    const reinterp = reinterpretPostBarSl2Spawn(wtfTrace, inst, sarResult);
    if (reinterp === null || !reinterp.shouldBeBar) continue;

    const allSpawns: { date: string; letter: string }[] = [];
    for (let ti = 0; ti < wtfTrace.length; ti++) {
      const entry = wtfTrace[ti];
      if (entry.day.date <= sl2.date) continue;
      for (const e of entry.events) {
        const m = /^TZ GREEN\(([A-Z]+)\)$/.exec(e);
        if (m === null || m[1] === sl2.letter || !(sar2Date === null || entry.day.date < sar2Date)) continue;
        // The orphan check (nothing at all under this same letter the very
        // next week) only matters when sar2Date is null -- an UNBOUNDED
        // scan (this BAR SL2's own SAR cycle never confirms SAR 2 at all,
        // e.g. DIXON.NS's BAR SL2(A.2)) would otherwise sweep in every
        // future reuse of every letter for the rest of time, so only a
        // true one-off orphan counts as noise there; a letter that keeps
        // showing further events (HH, its own reform, an escalation) is a
        // genuinely separate, sustained structure in THAT case.
        // Once sar2Date is a real, finite date (this BAR SL2's own SAR
        // cycle DOES eventually confirm SAR 2, just later), the window
        // [sl2.date, sar2Date) is already the correct, bounded answer on
        // its own -- the rule is unconditional ("until SAR 2 confirms, no
        // new top-level lineage is ever legitimate"), so a spawn landing
        // inside that window is misclassified regardless of how much
        // sustained activity it goes on to show. Confirmed real-data bug
        // (DIXON.NS): BAR SL2(B.3) on 2025-06-16 doesn't get its own SAR 2
        // until 2025-12-26 -- the orphan check was wrongly waving through
        // TZ GREEN(C) on 2025-06-30 just because C goes on to show its own
        // real-looking RED(C)/etc. afterward, even though C's own BIRTH
        // still landed squarely inside the unvalidated window.
        if (sar2Date === null) {
          const nextEntry = wtfTrace[ti + 1];
          const letterContinues = nextEntry !== undefined && nextEntry.events.some((ev) => ev.includes(`(${m[1]})`) || ev.includes(`(${m[1]}.`));
          if (letterContinues) continue;
        }
        allSpawns.push({ date: entry.day.date, letter: m[1] });
      }
    }

    let maxSub = 0;
    for (const entry of wtfTrace) {
      for (const e of entry.events) {
        const bm = /^BAR\(([^)]+)\)$/.exec(e);
        if (bm && bm[1].split(".")[0] === sl2.letter) {
          const n = parseInt(bm[1].split(".")[1] ?? "0", 10);
          if (n > maxSub) maxSub = n;
        }
      }
    }

    // Tracks whether the lineage currently has an open reinterpreted
    // window as each spawn is processed in chronological order -- a
    // spawn landing while the PRIOR reinterpreted window is still alive
    // is not a fresh formation at all (there is no room for one; the
    // existing window just keeps continuing through it), only noise to
    // suppress. Confirmed real-data (DIXON.NS): the orphaned, one-week
    // "TZ GREEN(C)" on 2023-05-15 lands while A.6 (formed 2023-02-27) is
    // still alive -- it produces no window of its own at all, not even
    // an open-ended one; A.6 keeps running uninterrupted (its own BAR 2
    // then confirms a week later, 2023-05-22, per deriveReinterpretedBar2Date).
    let openWindowEndDate: string | null | undefined = undefined; // undefined = no window yet

    for (const spawn of allSpawns) {
      const priorWindowStillOpen = openWindowEndDate === null || (openWindowEndDate !== undefined && spawn.date <= openWindowEndDate);
      // An orphaned spawn with no window of its own (priorWindowStillOpen)
      // bounds its own suppression to just this one date -- confirmed
      // real-data bug (DIXON.NS): without this bound, the raw engine's
      // UNRELATED, much-later reuse of the same letter (TZ GREEN(C) in
      // 2025 and 2026, completely disconnected from this 2023 episode)
      // was wrongly suppressed forever by an open-ended rule meant only
      // for a letter that genuinely keeps continuing the misclassified
      // structure (like letter B here, which never resolves at all).
      //
      // Otherwise, the bound is `sar2Date` when it is a real, finite date
      // (not null): once THIS BAR SL2's own SAR cycle decisively confirms
      // SAR 2, the misclassification regime it governs is OVER -- any
      // LATER reuse of this exact same letter (which letter-recycling
      // makes inevitable over a long enough dataset) belongs to whatever
      // the raw engine legitimately does next, not to this chain.
      // Confirmed real-data bug (DIXON.NS): BAR SL2(B.3)'s own SAR 2
      // confirms 2025-12-26, so an open-ended suppression of every future
      // "letter C" wrongly also swallowed an unrelated branch's own
      // genuine reuse of letter C starting 2026-02-02.
      misclassifiedLetters.push({ letter: spawn.letter, sinceDate: spawn.date, untilDate: priorWindowStillOpen ? spawn.date : sar2Date });
      if (priorWindowStillOpen) {
        continue; // prior window still open (or not yet ended) at this spawn's date -- noise only
      }

      // Every "TZ GREEN(spawn.letter)"/"TZ GREEN SL(spawn.letter)" from
      // this spawn onward is a reinterpreted BAR/BAR SL reform
      // continuing `sl2.letter`'s own lineage -- same two-tier window
      // logic as findWindows above, just reading a different pair of
      // event-name patterns. Each explicit "TZ GREEN SL(" already ends one
      // leg and the very next "TZ GREEN(" of the same letter is read as
      // the next leg, regardless of whether the raw engine's own pid
      // churned underneath (an SL frees that id, and the very next
      // candle's reform can get the SAME id straight back) -- confirmed
      // real-data (DIXON.NS letter B itself): 2022-05-30/06-13, 06-27/
      // 2023-01-23, 02-27 is read as ONE continuing reinterpreted chain,
      // exactly as already verified against real price action, even
      // though the raw engine's own id bookkeeping underneath may not be
      // one continuous pid end to end.
      //
      // What DOES need bounding is `sar2Date`: once THIS SAME BAR SL2's
      // own SAR cycle has decisively confirmed SAR 2, the reinterpretation
      // regime it governs is OVER -- any letter-reuse at or after that
      // point (even of `spawn.letter` itself) belongs to whatever the raw
      // engine legitimately does next, not to this chain. Confirmed
      // real-data bug (DIXON.NS): without this bound, the 2025-06-30
      // TZ GREEN(C) window kept scanning straight through SAR 2's own
      // 2025-12-26 confirmation and wrongly swallowed an unrelated LATER
      // branch's own reuse of letter "C" on 2026-02-02 as if it were the
      // same window still continuing.
      const spawnFormMatch = new RegExp(`^TZ GREEN\\(${spawn.letter}\\)$`);
      const spawnSlMatch = new RegExp(`^TZ GREEN SL\\(${spawn.letter}\\)$`);
      const spawnFormations: { date: string; formationHigh: number; formationLow: number }[] = [];
      const spawnSls: { date: string }[] = [];
      for (const entry of wtfTrace) {
        if (entry.day.date < spawn.date) continue;
        if (sar2Date !== null && entry.day.date >= sar2Date) break;
        for (const e of entry.events) {
          if (spawnFormMatch.test(e)) spawnFormations.push({ date: entry.day.date, formationHigh: entry.day.h, formationLow: entry.day.l });
          if (spawnSlMatch.test(e)) spawnSls.push({ date: entry.day.date });
        }
      }

      for (let i = 0; i < spawnFormations.length; i++) {
        const f = spawnFormations[i];
        const nextFormation = spawnFormations[i + 1] ?? null;
        const matchingSl = spawnSls.find((sl) => sl.date > f.date && (nextFormation === null || sl.date < nextFormation.date));
        const subLabel = `${sl2.letter}.${maxSub + 1}`;
        maxSub += 1;
        const windowEndDate = matchingSl?.date ?? nextFormation?.date ?? null;
        const bar2Date = deriveReinterpretedBar2Date(wtfDays, f.date, f.formationHigh, windowEndDate);
        if (matchingSl) {
          windows.push({ wtfLabel: subLabel, formationDate: f.date, endDate: matchingSl.date, endReason: "BAR SL", formationHigh: f.formationHigh, bar2Date });
          openWindowEndDate = matchingSl.date;
        } else if (nextFormation) {
          windows.push({ wtfLabel: subLabel, formationDate: f.date, endDate: nextFormation.date, endReason: "new BAR", formationHigh: f.formationHigh, bar2Date });
          openWindowEndDate = nextFormation.date;
        } else {
          // No explicit SL/reform TEXT ends this window -- but that does
          // NOT mean nothing happens to it. The raw engine's own REAR
          // takeover (now correctly voided, see invalidRearWindows) was
          // standing in for this window's OWN BAR 2 continuing to climb;
          // once REAR is out of the picture, this window's BAR1/BAR 2
          // ladder is still live underneath and keeps running on the
          // same weekly candles, same rules, same as every other BAR
          // lineage -- it is simulated directly here rather than left
          // open. See simulateBarLadderContinuation's own comment.
          const continuation = simulateBarLadderContinuation(wtfDays, dtfDays, wtfTrace, f.date, f.formationHigh, f.formationLow);
          if (continuation.freezeDate !== null) {
            windows.push({
              wtfLabel: subLabel,
              formationDate: f.date,
              endDate: continuation.freezeDate,
              endReason: "SAR 2 confirmed",
              formationHigh: f.formationHigh,
              bar2Date,
              continuationEvents: continuation.wtfEvents,
              continuationSar: continuation.sarCycles,
              chainResolutionDate: continuation.barSl2FreezeDate,
            });
            openWindowEndDate = continuation.freezeDate;
          } else {
            // Genuinely unresolved within the available data -- continuation
            // events (if any) are still reported, just with no freeze date.
            windows.push({
              wtfLabel: subLabel,
              formationDate: f.date,
              endDate: null,
              endReason: null,
              formationHigh: f.formationHigh,
              bar2Date,
              continuationEvents: continuation.wtfEvents,
              continuationSar: continuation.sarCycles,
              chainResolutionDate: continuation.barSl2FreezeDate,
            });
            openWindowEndDate = null;
          }
        }
      }
    }
  }

  // Chain-resolution fix: a misclassifiedLetters entry whose OWN
  // originating BAR SL2 never confirms SAR 2 in isolation (untilDate:
  // null) is NOT necessarily open forever -- the SAME continuing
  // lineage can re-arm a FRESH BAR SL2 further downstream (either a
  // later real one, already its own barSl2Events entry and thus its
  // own later misclassifiedLetters/window, or a synthetic one found by
  // this SAME window's own simulateBarLadderContinuation), and THAT one
  // confirming SAR 2 is what actually ends the whole chain's provisional
  // status -- not the original 2022 reference price, frozen forever.
  // Confirmed real-data (DIXON.NS): BAR SL2(A.2) 2022-05-09 on its own
  // never confirms SAR 2 (reaches INVALID SAR ENTRY 2023-05-23 and stays
  // there) -- by that reading alone, letter B's own exclusion would
  // never end. But the SAME chain re-arms twice more downstream: BAR
  // SL2(B.3) 2025-06-16 (SAR 2 2025-12-26), then a further fresh BAR SL2
  // 2025-12-08 found only by this window's own continuation simulation
  // (SAR 2 2025-12-30). The chain's TRUE resolution is the LATEST of
  // these -- 2025-12-30 -- not null. Confirmed: "B has never got
  // activated. TZ GREEN B was activated for the 1st time as on 02/02/26"
  // -- which this already produces either way (nothing spawns between
  // 2025-12-30 and 2026-02-02 in the real data), but leaving B's own
  // entry open-ended forever is a latent bug: on different price data,
  // where the SAME letter got reused immediately after the chain's own
  // true resolution, an open-ended untilDate would wrongly keep
  // suppressing it forever.
  for (const entry of misclassifiedLetters) {
    if (entry.untilDate !== null) continue;
    let latest: string | null = null;
    for (const w of windows) {
      // Only a window's own chainResolutionDate (a FRESH BAR SL2's own
      // SAR 2) resolves the chain -- a window's plain `endDate` from a
      // "BAR SL"/"new BAR" text match just marks where THAT window's
      // own text ended, unrelated to whether the lineage's exit is
      // validated.
      const resolution = w.chainResolutionDate;
      if (resolution === null || resolution === undefined) continue;
      if (w.formationDate < entry.sinceDate) continue;
      if (latest === null || resolution > latest) latest = resolution;
    }
    if (latest !== null) entry.untilDate = latest;
  }

  return { windows, misclassifiedLetters, invalidRearWindows };
}

// Additive helper (session of 2026-10-22), NOT yet verified beyond
// PAYTM.NS. For a WTF "BAR(" that a REINTERPRETATION layer (see
// lib/primeTrend.ts's reinterpretPostBarSl2Spawn) determined SHOULD
// have formed but doesn't actually appear as text in the real WTF
// trace (the live engine spawned a new sibling lineage instead, per
// its own unmodified rules -- this never changes). Reuses
// `simulateWindow` verbatim -- same TAR/BAR1-BAR2 simulation as
// `computeTarTbar`'s own per-window loop, just skipping `findWindows`'s
// text-pattern scan and taking the window's formationDate/label
// directly from the caller instead. Always an OPEN window (no known
// endDate) -- a hypothetical reinterpreted BAR has no real "BAR SL("
// text to bound it either.
export function computeTarTbarForWindow(
  dtfRows: OhlcRow[],
  wtfLabel: string,
  formationDate: string,
  formationHigh: number
): { results: TarTbarResult[]; live: TarTbarLiveStatus[] } {
  const dtfDays: Day[] = dtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const startIdx = dtfDays.findIndex((d) => d.date > formationDate);
  if (startIdx <= 0) return { results: [], live: [] };
  const results: TarTbarResult[] = [];
  const live = simulateWindow(dtfDays, startIdx, dtfDays.length, wtfLabel, formationDate, formationHigh, results);
  return { results, live };
}

export function computeTarTbar(
  wtfRows: OhlcRow[],
  dtfRows: OhlcRow[]
): {
  windows: TarTbarWindow[];
  results: TarTbarResult[];
  live: TarTbarLiveStatus[];
  // Every raw-trace letter confirmed to be a misclassified continuation
  // of an earlier lineage (see findReinterpretedWindows), with the date
  // its own noise starts from -- callers building a WTF event ledger
  // from the raw trace need this to suppress that letter's entire
  // downstream existence too, not just the windows this function itself
  // already drops.
  misclassifiedLetters: { letter: string; sinceDate: string; untilDate: string | null }[];
  // REAR-family text ("REAR(", "REAR 2(", "REAR SL(", "REAR 2 SL(", and
  // the REAR RE-ENTER variants) for this letter in this date range is
  // ALSO invalid, for the same underlying reason -- see
  // findReinterpretedWindows's own comment. Independent of
  // misclassifiedLetters: it can apply to a letter that is not itself
  // misclassified, since REAR's own gating is a property of the BAR SL2
  // it forms off, not of whether a new sibling letter spawned.
  invalidRearWindows: { letter: string; sinceDate: string; untilDate: string | null }[];
} {
  const wtfDays: Day[] = wtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const dtfDays: Day[] = dtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const { windows: reinterpretedWindows, misclassifiedLetters, invalidRearWindows } = findReinterpretedWindows(wtfDays, dtfDays);
  // Drop any raw-trace window for a misclassified letter, from its own
  // spawn date onward -- its ENTIRE downstream existence (not just the
  // "TZ GREEN(" tier reinterpretedWindows already covers) is noise,
  // fully subsumed by the reinterpreted window already continuing; see
  // findReinterpretedWindows's own comment. Confirmed real-data
  // (DIXON.NS): without this, the raw engine's own later "BAR(B.1)"
  // (formed off letter B's unmodified TZ BUY 2->RED1->RED2 escalation)
  // would otherwise be double-counted as a second, genuine, parallel
  // family alongside the reinterpreted window already covering that
  // same stretch.
  const rawWindows = findWindows(wtfDays).filter(
    (w) =>
      !misclassifiedLetters.some(
        (m) => w.wtfLabel.split(".")[0] === m.letter && w.formationDate >= m.sinceDate && (m.untilDate === null || w.formationDate <= m.untilDate)
      )
  );
  const windows = [...rawWindows, ...reinterpretedWindows].sort((a, b) =>
    a.formationDate < b.formationDate ? -1 : a.formationDate > b.formationDate ? 1 : 0
  );

  const results: TarTbarResult[] = [];
  const live: TarTbarLiveStatus[] = [];
  for (const w of windows) {
    let startIdx = dtfDays.findIndex((d) => d.date > w.formationDate);
    if (startIdx <= 0) continue;
    let endIdx = w.endDate === null ? dtfDays.length : dtfDays.findIndex((d) => d.date >= (w.endDate as string));
    if (endIdx === -1) endIdx = dtfDays.length;
    if (endIdx <= startIdx) continue;
    const windowLive = simulateWindow(dtfDays, startIdx, endIdx, w.wtfLabel, w.formationDate, w.formationHigh, results);
    // Live status only ever comes from a window that's still genuinely
    // open (the WTF BAR itself hasn't SL'd and no fresh BAR has reformed
    // yet) -- a window that already ended freezes, same principle as
    // "once WTF TZ BUY 2 fails, DTF tracking freezes" everywhere else.
    if (w.endDate === null) live.push(...windowLive);
  }
  return { windows, results, live, misclassifiedLetters, invalidRearWindows };
}
