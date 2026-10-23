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
import { runWtfTrace, type OhlcRow } from "./primeTrend";

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
  endReason: "BAR SL" | "new BAR" | null;
  // The WTF BAR's own reference high AT FORMATION (that week's own
  // known High) -- the seed for TAR's own "Path 1" trigger (a straight
  // breakout above it, no RED required). Only a seed: the caller climbs
  // it quietly on each later DAY's own High directly (same look-ahead
  // trap preS1Ref/wtfBarRefHigh elsewhere in this codebase avoid).
  formationHigh: number;
}

export interface TarTbarResult {
  wtfLabel: string;
  wtfFormationDate: string;
  // "BAR2" rows are the independent BAR1->BAR2 route's own row
  // (confirmed: gets its own visible row) -- they OVERLAP whatever the
  // enclosing TAR ENTRY row is doing rather than replacing it, since
  // this route runs fully independently (see the module comment above)
  // and its own harder SL reforms unrestricted, per the confirmed
  // BAR1-BAR2 rules.
  side: "TAR ENTRY" | "BAR2";
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
      // "PRIME TREND SL" -- door already open, unrestricted reform at
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
      if (bar1Shape(prev, cur)) {
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
        side: "BAR2",
        entryDate: nestedClosed.entryDate,
        entryPrice: nestedClosed.entryPrice,
        exitType: "PRIME TREND SL",
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
  for (const entry of trace) {
    for (const e of entry.events) {
      const formMatch = /^BAR\(([^)]+)\)$/.exec(e);
      if (formMatch) formations.push({ date: entry.day.date, label: formMatch[1], formationHigh: entry.day.h });
      const slMatch = /^BAR SL\(([^)]+)\)$/.exec(e);
      if (slMatch) sls.push({ date: entry.day.date, label: slMatch[1] });
    }
  }

  const windows: TarTbarWindow[] = [];
  for (let i = 0; i < formations.length; i++) {
    const f = formations[i];
    const nextFormation = formations[i + 1] ?? null;
    const matchingSl = sls.find((sl) => sl.label === f.label && sl.date > f.date && (nextFormation === null || sl.date < nextFormation.date));
    if (matchingSl) {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: matchingSl.date, endReason: "BAR SL", formationHigh: f.formationHigh });
    } else if (nextFormation) {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: nextFormation.date, endReason: "new BAR", formationHigh: f.formationHigh });
    } else {
      windows.push({ wtfLabel: f.label, formationDate: f.date, endDate: null, endReason: null, formationHigh: f.formationHigh });
    }
  }
  return windows;
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

export function computeTarTbar(wtfRows: OhlcRow[], dtfRows: OhlcRow[]): { windows: TarTbarWindow[]; results: TarTbarResult[]; live: TarTbarLiveStatus[] } {
  const wtfDays: Day[] = wtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const dtfDays: Day[] = dtfRows.map((r) => ({ date: r.date, o: r.o, h: r.h, l: r.l, c: r.c }));
  const windows = findWindows(wtfDays);

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
  return { windows, results, live };
}
