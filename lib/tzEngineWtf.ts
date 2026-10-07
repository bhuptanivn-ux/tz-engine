// TZ BUY -- the TZ ENGINE state machine, extended with TZ BUY 2 / BAR 2 /
// REAR 2 / REAR RE-ENTER 2.
//
// Direct, line-for-line TypeScript port of tz_engine_wtf.py (Python dev
// branch claude/epic-darwin-pxs5s3). This is the theory documented in
// WTF_RULEBOOK.md and is the ONLY engine that has been rigorously verified
// against real OHLC data across many real scrips (KALYANKJIL.NS, PAYTM.NS,
// MAXESTATES.NS, BBOX.NS x3, NSEI, EICHERMOT.NS, ADANIENT.NS, ICICIBANK.NS)
// and repeatedly corrected against real, hand-traced events. It replaces
// both of the site's previous engines (lib/tzEngineBar2Variant.ts, ported
// from an earlier ancestor validated only against a single 2020 dataset,
// and lib/tzEngineNewTheory.ts, an entirely separate, abandoned
// experimental theory that was never verified against real data at all).
//
// Ported faithfully, not reinterpreted -- every condition, ordering, and
// mutation matches the Python original exactly, including its exact
// dict-iteration-order semantics (replicated here via Map, which preserves
// insertion order the same way a Python dict does). See WTF_RULEBOOK.md
// for the full rationale behind every rule. Do not "clean up" or
// re-order anything here without re-verifying byte-for-byte against the
// Python engine on the same inputs.

export const THRESH = 0.2;
export const ANY = 0.01;
export const EPS = 1e-9; // float-precision guard for boundary comparisons

export function branchLabel(nIn: number): string {
  // 1 -> A, 2 -> B, ..., 26 -> Z, 27 -> AA, ... (spreadsheet-column style)
  let n = nIn;
  let s = "";
  while (n > 0) {
    n -= 1;
    const r = n % 26;
    n = Math.floor(n / 26);
    s = String.fromCharCode(65 + r) + s;
  }
  return s;
}

export interface Day {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

// ---------------------------------------------------------------------
// State classes -- one per tier, mirroring the Python dataclasses exactly.
// ---------------------------------------------------------------------

export class Red1 {
  active = true;
  constructor(public refHigh: number, public refLow: number) {}
}

/** The "2" confirmation gate, reused identically at every tier: BAR 2,
 * REAR 2, REAR RE-ENTER 2, TZ BUY 2. */
export class Bar2 {
  slActive = false;
  dormant = false; // REAR 2 / REAR RE-ENTER 2 only
  reentryThreshold: number | null = null; // TZ BUY 2 only
  constructor(public refHigh: number, public refLow: number) {}
}

export class BarSL {
  sl2 = false;
  invalidated = false;
  constructor(public refHigh: number, public refLow: number) {}
}

export class BarLineage {
  red1Since = false;
  refHighAtRed1 = 0;
  sl: BarSL | null = null;
  red2Ever = false;
  bar2: Bar2 | null = null;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

export class RearSL {
  entryThreshold = 0;
  constructor(public refLow: number) {}
}

export class Rear {
  red1Since = false;
  refHighAtRed1 = 0;
  sl: RearSL | null = null;
  dormant = false;
  red2Ever = false;
  rear2: Bar2 | null = null;
  constructor(public refHigh: number, public refLow: number) {}
}

export class RearReenterSL {
  entryThreshold = 0;
  constructor(public refLow: number) {}
}

export class RearReenter {
  red1Since = false;
  refHighAtRed1 = 0;
  sl: RearReenterSL | null = null;
  dormant = false;
  red2Ever = false;
  rre2: Bar2 | null = null;
  constructor(public refHigh: number, public refLow: number) {}
}

export class Buy {
  active = true;
  red1Ever = false;
  refHighAtRed1 = 0;
  red1: Red1 | null = null;
  tzBuy2: Bar2 | null = null;
  tzBuy2HhMuted = false;
  barLineages: BarLineage[] = [];
  barSubCounter = 0;
  barDeadLabels = new Set<number>();
  barPending = false;
  rear: Rear | null = null;
  rearReenter: RearReenter | null = null;
  barHighPool = 0;
  reentryThreshold: number | null = null;
  constructor(public refHigh: number, public refLow: number) {}
}

export class ParentCycle {
  active = true;
  dormant = false;
  redEver = false;
  refHighAtRed = 0;
  buy: Buy | null = null;
  // Real-data bug (ICICIBANK.NS hypothetical, confirmed): once this
  // branch's own TZ GREEN HH climb first coincides, on the same candle,
  // with a genuine-BAR-SL2 lineage elsewhere reaching its own INVALID
  // BAR HH, this branch's climb is from then on racing over the exact
  // same ground as that lineage's REAR eligibility -- recording its own
  // HH separately is redundant. Sticky once set: "start it from 14/01"
  // (the first coincidence), not re-checked day by day.
  hhAbsorbedByRear = false;
  constructor(public id: number, public seq: number, public refHigh: number, public refLow: number) {}
}

type Stage = Buy | BarLineage | Rear | RearReenter;

// TZ BUY 2 variant: "TZ BUY 2(" is explicitly its own milestone -- unlike
// BAR 2/REAR 2/REAR RE-ENTER 2 (none of which trigger the leadership contest).
const MILESTONE_KEYS = ["TZ BUY(", "TZ BUY 2(", "BAR(", "REAR(", "REAR RE-ENTER("];

const SL_LL_KEYS = [
  "TZ GREEN SL(", "TZ GREEN LL(",
  "TZ BUY SL(", "TZ BUY LL(",
  "BAR LL(", "BAR SL(", "BAR SL LL(", "BAR SL2(",
  "REAR LL(", "REAR SL(",
  "REAR RE-ENTER LL(", "REAR RE-ENTER SL(",
  // Real-data bug (ETERNAL.NS branch B): REAR 2/REAR RE-ENTER 2's own
  // confirmation and SL are deliberately NOT in MILESTONE_KEYS (escalating
  // within an already-established REAR/REAR RE-ENTER shouldn't re-trigger
  // the cross-branch leadership contest) -- but that same omission also
  // made them invisible whenever this branch is dormant (confirmed:
  // REAR 2(B) SL'd 22/09/25 and re-entered 06/10/25 both went missing
  // from output once another branch's own milestone made B dormant).
  // Visible-while-dormant and contest-triggering are different concerns;
  // this list (already carrying the escalation-like "BAR SL2(" above)
  // is the right one for passthrough-only.
  "REAR 2(", "REAR 2 SL(",
  "REAR RE-ENTER 2(", "REAR RE-ENTER 2 SL(",
];

export function isMilestone(ev: string): boolean {
  return MILESTONE_KEYS.some((key) => ev.startsWith(key));
}

export function isSlOrLl(ev: string): boolean {
  return SL_LL_KEYS.some((key) => ev.startsWith(key));
}

function labelOf(ev: string): string {
  return ev.slice(ev.indexOf("(") + 1, -1);
}

export class TZEngine {
  branches = new Map<number, ParentCycle>();
  private seqCounter = 0;
  private preTodayLiveBuy = new Map<number, boolean>();
  private preTodayTzBuy2Active = new Map<number, boolean>();

  // REVISION, weekly timeframe only: a BAR lineage that never escalated
  // past BAR 1 (bar2 === null) opens REAR eligibility on its own bare BAR
  // SL, instead of the lineage just reforming unrestricted -- see
  // deepFailureReached/evalBarLineagesProgress/newestIsDead below. Scoped
  // to this flag because TZEngine itself is also run directly on daily,
  // monthly, and yearly data (the Trading Zone page's own Interval
  // selector, the Report page's and BAR Theory page's Time frame
  // selectors, each via a fresh TZEngine instance) -- the revision is
  // specifically a weekly-timeframe theory rule, not a change to the
  // engine's general-purpose behavior on other timeframes. Only
  // lib/primeTrend.ts's runWtfTrace (always weekly, per PRIME TREND's
  // fixed WTF=weekly rule) passes `true` here; every other caller keeps
  // the original, timeframe-agnostic behavior by leaving this false.
  constructor(private weeklyBarSlRear: boolean = false) {}

  private nextSeq(): number {
    this.seqCounter += 1;
    return this.seqCounter;
  }

  lowestFreeId(): number {
    let n = 1;
    while (this.branches.has(n)) n += 1;
    return n;
  }

  private deepFailureReached(buy: Buy): boolean {
    if (buy.rear !== null && buy.rear.sl !== null) return true;
    if (buy.rearReenter !== null && buy.rearReenter.sl !== null) return true;
    // Sibling-spawn eligibility (canSpawn/eligibleAnchor, below) stays tied
    // exclusively to true deep failure -- BAR SL2 (a lineage that escalated
    // to BAR 2 and then failed there too). A bare BAR SL (BAR 1 alone,
    // never escalated) does NOT open this -- it's simply a dead end
    // (see evalBarLineagesProgress's bar2===null branch): no REAR, no
    // sibling spawn, just a fresh BAR reform.
    return buy.barLineages.some((lin) => lin.sl !== null && lin.sl.sl2);
  }

  private barLineagesRacing(buy: Buy): boolean {
    return buy.barLineages.some((lin) => lin.sl === null || (lin.bar2 !== null && !lin.sl.sl2));
  }

  /** True only when EVERY current lineage is a genuine permanent dead end
   * (its own SL fired with no BAR 2 ever having formed) -- as opposed to
   * having reached BAR SL2 (deep failure, REAR pending confirmation),
   * which is a deliberately DIFFERENT "not currently live" signal (see
   * buyCurrentlyLive) used to open sibling spawn eligibility the instant
   * SL2 fires, before REAR itself has necessarily confirmed. Conflating
   * the two let a buy whose own BAR family had reached genuine deep
   * failure (SL2) wrongly report itself as "still live" by checking
   * straight through to its own TZ BUY 2/REAR 2/REAR RE-ENTER 2 state --
   * exactly the signal that mechanism exists to produce. */
  private barLineagesPermanentDeadEnd(buy: Buy): boolean {
    return buy.barLineages.every((lin) => lin.sl !== null && lin.bar2 === null);
  }

  // Real-data bug (ICICIBANK.NS branch E, 2013): a buy whose TZ BUY 2 was
  // never stopped out AND never even escalated into a BAR (no REAR, no
  // REAR RE-ENTER, no BAR lineage ever attempted) -- i.e. nothing under it
  // is actually racing -- still read as "currently live" forever once the
  // branch went dormant (buried under a more senior sibling), permanently
  // blocking every later branch's own fresh TZ BUY confirmation for years.
  // A buy with real structure underneath (an open REAR/REAR RE-ENTER, or a
  // BAR lineage racing or sitting at genuine deep failure) is deliberately
  // NOT covered by this -- only a buy with literally nothing happening
  // beneath its own un-SL'd TZ BUY 2.
  private buyHasNoRacingStructure(buy: Buy): boolean {
    return buy.rear === null && buy.rearReenter === null && buy.barLineages.length === 0;
  }

  private buyCurrentlyLive(pc: ParentCycle): boolean {
    const buy = pc.buy as Buy;
    if (!buy.active) return false;
    // Real-data bug (ICICIBANK.NS branch F): once a newer sibling has
    // already won the race (racedOutByNewerTzBuy2), this chain's own
    // un-SL'd, not-dormant REAR/REAR RE-ENTER keeps climbing and
    // tracking forever in the backend (see evalRear2's own comment) but
    // must NOT count as "live" for blocking every EVEN NEWER branch's
    // own fresh TZ BUY -- otherwise a raced-out REAR that simply never
    // gets a formal SL (because price keeps climbing with the market)
    // would block every later branch's TZ BUY confirmation
    // indefinitely. Scoped to ONLY that specific "still open, not
    // dormant" claim -- an ALREADY-SL'd REAR/REAR RE-ENTER (checked just
    // below) must keep returning its own correct answer regardless of
    // racedOut, or a dangling un-escalated TZ BUY 2 underneath it would
    // wrongly fall through to the final tzBuy2 check instead.
    const racedOut = this.racedOutByNewerTzBuy2(pc);
    if (buy.rearReenter !== null) {
      if (buy.rearReenter.sl !== null) {
        // Real-data bug (ICICIBANK.NS branch E, 2014): this used to bail
        // out to "not live" the instant REAR RE-ENTER's own SL fired,
        // forever after -- even once a brand new, unrelated BAR cascade
        // had since reformed and was actively racing (confirmed: BAR(E.1)
        // 13/10/2014, BAR 2(E.1) 20/10/2014, weeks after REAR RE-ENTER's
        // own 22/09/2014 SL). That stale "not live" wrongly fed both
        // sibling-spawn eligibility (a new TZ GREEN spawning while E was
        // actually still racing) and the cross-branch TZ BUY gate (a
        // long-dormant branch's own fresh TZ BUY sees no live buy
        // anywhere and wipes E out). Check the CURRENT bar lineage first;
        // only report "not live" once nothing is actually racing there.
        return buy.barLineages.length > 0 && this.barLineagesRacing(buy);
      }
      if (!buy.rearReenter.dormant) {
        if (racedOut) return false;
        if (buy.barLineages.length > 0) {
          if (this.barLineagesRacing(buy)) return true;
          if (!this.barLineagesPermanentDeadEnd(buy)) return false;
        }
        // Real-data bug (MAXESTATES.NS, ICICIBANK.NS): once REAR RE-ENTER
        // 2's own SL fires with no fresh BAR cascade racing beneath it --
        // and no BAR lineage of its own ever reached genuine deep failure
        // (BAR SL2) either -- NOTHING in this buy is actually live any
        // more, but this branch was unconditionally returning true just
        // because REAR RE-ENTER itself hadn't failed, permanently
        // blocking every sibling's own first TZ BUY from ever forming.
        // Symmetric real-data bug (ICICIBANK.NS): a lineage that's SL'd
        // with NO BAR 2 ever formed -- a genuine permanent dead end, not
        // deep failure -- must NOT mask REAR RE-ENTER 2's own live state
        // either.
        return !(buy.rearReenter.rre2 !== null && buy.rearReenter.rre2.slActive);
      }
    } else if (buy.rear !== null) {
      if (buy.rear.sl !== null) {
        // Same fix, one tier up -- see the REAR RE-ENTER comment above.
        return buy.barLineages.length > 0 && this.barLineagesRacing(buy);
      }
      if (!buy.rear.dormant) {
        if (racedOut) return false;
        if (buy.barLineages.length > 0) {
          if (this.barLineagesRacing(buy)) return true;
          if (!this.barLineagesPermanentDeadEnd(buy)) return false;
        }
        // Same fix, one tier up: REAR 2's own SL must also release this
        // gate once nothing is racing beneath it and no lineage reached
        // genuine deep failure.
        return !(buy.rear.rear2 !== null && buy.rear.rear2.slActive);
      }
    }
    if (buy.barLineages.length > 0) {
      if (this.barLineagesRacing(buy)) return true;
      if (!this.barLineagesPermanentDeadEnd(buy)) return false;
    }
    // Real-data bug (ICICIBANK.NS branch D, 2014): TZ BUY 2(D) sat
    // un-SL'd at 289.67 while D's one BAR lineage (a no-BAR-2 dead end)
    // masked that fact, letting REAR RE-ENTER(C) wrongly terminate D
    // outright.
    return !(buy.tzBuy2 !== null && buy.tzBuy2.slActive);
  }

  private milestoneBlocked(pc: ParentCycle): boolean {
    for (const [pid, other] of this.branches) {
      if (pid !== pc.id && other.seq > pc.seq && (this.preTodayLiveBuy.get(pid) ?? false)) {
        return true;
      }
    }
    return false;
  }

  // Real-data bug (ICICIBANK.NS branches F/G, 2022): once a NEWER sibling
  // (spawned off this chain's own BAR SL2) has already WON the race by
  // confirming its own TZ BUY 2 -- not merely progressing toward it, which
  // is why this checks yesterday's already-confirmed state rather than
  // reusing milestoneBlocked's broader "any live buy" signal -- this
  // chain's own REAR must not be allowed to hijack in afterward. REAR's
  // reference keeps climbing quietly (via evalBar2's own INVALID BAR HH
  // tracking) but stops being eligible to actually confirm. Deliberately
  // NOT the same check as milestoneBlocked: ETERNAL.NS branch B's REAR
  // confirmed purely off its own reference while a sibling was
  // independently still progressing toward (not yet confirmed at) its own
  // TZ BUY/TZ BUY 2 -- that must keep working.
  private racedOutByNewerTzBuy2(pc: ParentCycle): boolean {
    for (const [pid, other] of this.branches) {
      if (pid !== pc.id && other.seq > pc.seq && (this.preTodayTzBuy2Active.get(pid) ?? false)) {
        return true;
      }
    }
    return false;
  }

  /** True if this buy's current REAR-family ancestor (REAR RE-ENTER if it
   * exists, else REAR) has ALREADY failed at its own SL. */
  private rearAncestorTerminated(buy: Buy): boolean {
    const target: Rear | RearReenter | null = buy.rearReenter !== null ? buy.rearReenter : buy.rear;
    return target !== null && target.sl !== null;
  }

  /** "Whichever is higher": the MAXIMUM current reference across every
   * tier this buy currently holds state for. */
  private currentTopRef(buy: Buy): number {
    const refs = [buy.refHigh];
    if (buy.tzBuy2 !== null) refs.push(buy.tzBuy2.refHigh);
    for (const lin of buy.barLineages) {
      refs.push(lin.refHigh);
      if (lin.bar2 !== null) refs.push(lin.bar2.refHigh);
    }
    if (buy.rear !== null) {
      refs.push(buy.rear.refHigh);
      if (buy.rear.rear2 !== null) refs.push(buy.rear.rear2.refHigh);
    }
    if (buy.rearReenter !== null) {
      refs.push(buy.rearReenter.refHigh);
      if (buy.rearReenter.rre2 !== null) refs.push(buy.rearReenter.rre2.refHigh);
    }
    return Math.max(...refs);
  }

  /** Reuses the lowest freed dead-end number if one is available, else
   * allocates the next never-used number. */
  private nextBarLabel(buy: Buy, labelId: string): string {
    let n: number;
    if (buy.barDeadLabels.size > 0) {
      n = Math.min(...buy.barDeadLabels);
      buy.barDeadLabels.delete(n);
    } else {
      buy.barSubCounter += 1;
      n = buy.barSubCounter;
    }
    return `${labelId}.${n}`;
  }

  /** The newest lineage for "who's newest" purposes -- NOT necessarily
   * the literal last array element. A lineage that never escalated past
   * BAR 1 and then hit its own bare SL (bar2 === null, sl !== null) is a
   * permanent dead end that can sit at the tail of buy.barLineages for
   * many candles (it's only ever swept by the opportunistic fresh-BAR
   * cleanup). Real-data bug (ETERNAL.NS D.10/D.11): such a dead end must
   * not shadow a still-live lineage sitting right behind it as "not
   * newest" -- confirmed, a bare BAR SL opens the door for that lineage
   * to reform under its own label the moment it recovers, same as if
   * the dead end had already been pruned.
   */
  private newestLiveLineage(lineages: BarLineage[]): BarLineage | null {
    for (let i = lineages.length - 1; i >= 0; i--) {
      const l = lineages[i];
      if (!(l.bar2 === null && l.sl !== null)) return l;
    }
    return null;
  }

  process(prev: Day, cur: Day): string[] {
    const perBranchEvents = new Map<number, string[]>();
    const milestoneAchievers: [ParentCycle, boolean][] = [];
    const greenSlSeqs: number[] = [];

    let anyLiveBuy = false;
    for (const pc of this.branches.values()) {
      if (
        pc.active &&
        pc.buy !== null &&
        this.buyCurrentlyLive(pc) &&
        !(pc.dormant && this.buyHasNoRacingStructure(pc.buy))
      ) {
        anyLiveBuy = true;
        break;
      }
    }

    // Computed into a local map first, and only swapped into
    // this.preTodayTzBuy2Active once the preTodayLiveBuy loop below has
    // finished reading it -- that loop calls buyCurrentlyLive, which
    // itself reads this.preTodayTzBuy2Active (via racedOutByNewerTzBuy2),
    // so overwriting it mid-loop would mix yesterday's and today's values
    // depending on branch iteration order.
    const newTzBuy2Active = new Map<number, boolean>();
    for (const [pid, pc] of this.branches) {
      newTzBuy2Active.set(pid, pc.buy !== null && pc.buy.tzBuy2 !== null && !pc.buy.tzBuy2.slActive);
    }

    this.preTodayLiveBuy = new Map();
    for (const [pid, pc] of this.branches) {
      this.preTodayLiveBuy.set(
        pid,
        pc.buy !== null &&
          this.buyCurrentlyLive(pc) &&
          !(pc.dormant && this.buyHasNoRacingStructure(pc.buy)),
      );
    }
    this.preTodayTzBuy2Active = newTzBuy2Active;

    if (!anyLiveBuy) {
      // Real-data bug (ICICIBANK.NS branch E): this used to wake up EVERY
      // dormant branch the instant nothing anywhere was live, which let a
      // branch with nothing racing underneath it (see
      // buyHasNoRacingStructure) resume its own stale RED1/BAR formation
      // the moment it was correctly excluded above -- overwriting a
      // sibling's own fresh TZ GREEN/TZ BUY output instead of staying
      // buried. A branch with real structure (REAR/REAR RE-ENTER open, or
      // a BAR lineage) still needs this wake-up to resume watching for its
      // own re-entry/progress; only the no-structure dead ends stay buried.
      for (const pc of this.branches.values()) {
        if (pc.buy !== null && pc.dormant && this.buyHasNoRacingStructure(pc.buy)) continue;
        pc.dormant = false;
      }
    }

    for (const pid of Array.from(this.branches.keys())) {
      const pc = this.branches.get(pid) as ParentCycle;
      if (!pc.active) continue;
      const buyWasNone = pc.buy === null;
      const allEvents = this.evalParent(pc, prev, cur, anyLiveBuy);
      perBranchEvents.set(pid, allEvents);

      if (allEvents.some((e) => e.startsWith("TZ GREEN SL("))) {
        greenSlSeqs.push(pc.seq);
      }

      for (const e of allEvents) {
        if (isMilestone(e)) {
          const isFreshBuy = e.startsWith("TZ BUY(") && buyWasNone;
          milestoneAchievers.push([pc, isFreshBuy]);
        }
      }
    }

    // Real-data bug (ICICIBANK.NS hypothetical, confirmed): the first
    // candle a sibling's own TZ GREEN HH coincides with some OTHER
    // branch's genuine-BAR-SL2 lineage reaching INVALID BAR HH, that
    // sibling's climb has merged with that lineage's own REAR-eligible
    // ground -- its own HH is retracted THIS candle (it was already
    // pushed above, before this cross-branch check could run) and the
    // sibling is marked so every FUTURE HH stays suppressed too,
    // regardless of whether the exact numbers coincide again later.
    const anyInvalidBarHhToday = Array.from(perBranchEvents.values()).some((events) =>
      events.some((e) => e.startsWith("INVALID BAR HH("))
    );
    if (anyInvalidBarHhToday) {
      for (const [pid, events] of perBranchEvents) {
        if (events.some((e) => e.startsWith("INVALID BAR HH("))) continue;
        if (events.some((e) => e.startsWith("TZ GREEN HH("))) {
          const pcOwner = this.branches.get(pid) as ParentCycle;
          pcOwner.hhAbsorbedByRear = true;
          perBranchEvents.set(pid, events.filter((e) => !e.startsWith("TZ GREEN HH(")));
        }
      }
    }

    const activeBranches = Array.from(this.branches.values()).filter((pc) => pc.active);
    const tip =
      activeBranches.length > 0 ? activeBranches.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
    const tipDeepFailure =
      tip !== null && tip.buy !== null && this.deepFailureReached(tip.buy) && !this.buyCurrentlyLive(tip);
    const tipTzbuy2Sl =
      tip !== null && tip.buy !== null && tip.buy.tzBuy2 !== null && tip.buy.tzBuy2.slActive;
    const tipRear2Sl =
      tip !== null &&
      tip.buy !== null &&
      tip.buy.rear !== null &&
      tip.buy.rear.rear2 !== null &&
      tip.buy.rear.rear2.slActive;
    const tipRre2Sl =
      tip !== null &&
      tip.buy !== null &&
      tip.buy.rearReenter !== null &&
      tip.buy.rearReenter.rre2 !== null &&
      tip.buy.rearReenter.rre2.slActive;
    const eligibleAnchor =
      tip !== null &&
      !tip.dormant &&
      tip.redEver &&
      (tip.buy === null || !tip.buy.active || tipDeepFailure || tipTzbuy2Sl || tipRear2Sl || tipRre2Sl);
    const canSpawn = eligibleAnchor || tip === null;
    let newBranchId: number | null = null;
    if (canSpawn && cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h) {
      const nid = this.lowestFreeId();
      const newPc = new ParentCycle(nid, this.nextSeq(), cur.h, cur.l);
      this.branches.set(nid, newPc);
      perBranchEvents.set(nid, [`TZ GREEN(${branchLabel(nid)})`]);
      newBranchId = nid;
    }

    for (const seq of greenSlSeqs) {
      for (const other of this.branches.values()) {
        if (other.active && other.seq > seq) other.active = false;
      }
    }

    const collaterallyTerminated = new Set<number>();
    const exemptionBlockedPids = new Set<number>();
    for (const [pc, isFreshBuy] of milestoneAchievers) {
      if (!pc.active) continue;
      let blockedThisAchiever = false;
      for (const [oid, other] of Array.from(this.branches.entries())) {
        if (other === pc || !other.active) continue;
        // Real-data bug (ETERNAL.NS branch B): deepFailureReached (BAR
        // SL2/REAR SL) deliberately makes buyCurrentlyLive report false
        // so it stops BLOCKING a sibling's own TZ BUY/RED1/RED2 progress
        // (see buyCurrentlyLive's own comment) -- but that same "not
        // live" signal was also feeding this exemption check below,
        // which then had nothing to stop it from being fully DESTROYED
        // (not just dormant-ed) the instant any other branch achieved a
        // fresh milestone, even while its own REAR/REAR 2 was actively
        // climbing toward confirmation off its BAR 2 reference high.
        // "Not blocking others" and "safe to delete outright" are
        // different things -- a deep-failure chain survives as dormant,
        // exactly like a lower-seq branch does, never destroyed.
        //
        // Real-data bug (ETERNAL.NS branch B, one tier up): the SAME
        // conflation hits REAR 2's own SL -- buyCurrentlyLive deliberately
        // reports false while REAR 2 sits SL'd-but-recoverable (so it
        // doesn't block a sibling's own progress either), but REAR/REAR
        // RE-ENTER itself (the "2"'s own parent) is still fully alive and
        // watching for its re-entry threshold (confirmed: REAR 2(B) must
        // re-enter on 06/10/25 after its 22/09/25 SL). Protect that the
        // same way: dormant, never destroyed, as long as the REAR/REAR
        // RE-ENTER ladder itself (not necessarily its "2" tier) hasn't
        // failed.
        // Deliberately NOT reusing deepFailureReached -- it also treats
        // any historical REAR's own SL as "deep failure" (true for
        // sibling-spawn eligibility, where that's the intent), which
        // would wrongly protect a branch whose REAR failed long ago and
        // has since moved on to a fresh, unrelated BAR cycle (confirmed
        // real-data case: ICICIBANK.NS branch E, 2014 -- reusing
        // deepFailureReached here kept E alive off its stale 22/09/2014
        // REAR SL, when E should have died normally like the
        // pre-existing code already did). This checks the ONE thing that
        // actually needs protecting: a genuine BAR SL2 on a CURRENT bar
        // lineage.
        const otherDeepFailurePending =
          other.buy !== null && other.buy.barLineages.some((lin) => lin.sl !== null && lin.sl.sl2);
        const otherRearChainAlive =
          other.buy !== null &&
          ((other.buy.rear !== null && other.buy.rear.sl === null) ||
            (other.buy.rearReenter !== null && other.buy.rearReenter.sl === null));
        if (other.seq < pc.seq || otherDeepFailurePending || otherRearChainAlive) {
          other.dormant = true;
        } else {
          if (!isFreshBuy && (this.preTodayLiveBuy.get(oid) ?? false)) {
            blockedThisAchiever = true;
            continue;
          }
          other.active = false;
          collaterallyTerminated.add(oid);
        }
      }
      if (blockedThisAchiever) exemptionBlockedPids.add(pc.id);
    }

    const activePcs = Array.from(this.branches.values()).filter((pc) => pc.active);
    const nonDormant = activePcs.filter((pc) => !pc.dormant);
    if (nonDormant.length === 1) {
      const leader = nonDormant[0];
      const leaderTopRef = leader.buy !== null ? this.currentTopRef(leader.buy) : leader.refHigh;
      for (const pc of activePcs) {
        if (pc !== leader && pc.dormant && leader.refHigh > pc.refHigh) {
          pc.refHigh = leader.refHigh;
        }
        if (
          pc !== leader &&
          pc.dormant &&
          pc.buy !== null &&
          !pc.buy.active &&
          pc.buy.reentryThreshold !== null &&
          leaderTopRef > pc.buy.reentryThreshold
        ) {
          pc.buy.reentryThreshold = leaderTopRef;
        }
      }
    }

    const visible: string[] = [];
    for (const [pid, events] of perBranchEvents) {
      const pcNow = this.branches.get(pid);
      if (collaterallyTerminated.has(pid)) continue;
      // Real-data bug (ICICIBANK.NS G): once a newer sibling has already
      // won the race (racedOutByNewerTzBuy2), this chain's ENTIRE REAR
      // family -- not just REAR 2's own confirmation/re-entry, which is
      // all the earlier fix covered -- is backend bookkeeping only: its
      // reference keeps climbing/tracking internally (so state stays
      // correct if the race ever reopens), but none of REAR/REAR 2/REAR
      // RE-ENTER's own HH/LL/SL/2 text should reach the visible output.
      // Confirmed wrong: REAR SL(G) showing on 02/03/2026, the same day
      // TZ BUY 2 SL(H) finally failed -- "no need to show them if the
      // later cycle has won the race."
      const racedOut = pcNow !== undefined && this.racedOutByNewerTzBuy2(pcNow);
      const eligible = racedOut ? events.filter((e) => !e.includes("REAR")) : events;
      if (pcNow !== undefined && pcNow.dormant && pid !== newBranchId) {
        if (exemptionBlockedPids.has(pid)) continue;
        visible.push(...eligible.filter((e) => isMilestone(e) || isSlOrLl(e)));
        if (eligible.some((e) => isMilestone(e))) pcNow.dormant = false;
      } else {
        visible.push(...eligible);
      }
    }

    for (const [pid, pc] of Array.from(this.branches)) {
      if (!pc.active) this.branches.delete(pid);
    }
    return visible;
  }

  // -----------------------------------------------------------------
  private evalParent(pc: ParentCycle, prev: Day, cur: Day, anyLiveBuy: boolean): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);

    const isSl = cur.l <= pc.refLow && pc.refLow - cur.l >= THRESH - EPS && cur.c <= pc.refLow + EPS;
    const hasLiveBuy = pc.buy !== null && pc.buy.active;

    let hh = false;
    let ll = false;
    if (!pc.redEver) {
      if (cur.h > pc.refHigh && cur.h - pc.refHigh >= ANY) {
        pc.refHigh = cur.h;
        hh = true;
      }
    } else {
      const diff = cur.h - pc.refHigh;
      if (cur.h > pc.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < pc.refHigh)) {
        pc.refHigh = cur.h;
        hh = true;
      }
    }
    if (cur.l < pc.refLow) {
      const gap = pc.refLow - cur.l;
      if ((gap >= THRESH - EPS && cur.c > pc.refLow + EPS) || gap < THRESH - EPS) {
        pc.refLow = cur.l;
        ll = true;
      }
    }

    if (pc.buy !== null && pc.buy.refHigh > pc.refHigh) {
      pc.refHigh = pc.buy.refHigh;
    }

    if (hh && !hasLiveBuy && !isSl && !pc.hhAbsorbedByRear) ev.push(`TZ GREEN HH(${label})`);
    if (ll && !hasLiveBuy) ev.push(`TZ GREEN LL(${label})`);

    if (isSl) {
      ev.push(`TZ GREEN SL(${label})`);
      pc.active = false;
      return ev;
    }

    if (!pc.redEver) {
      if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
        pc.redEver = true;
        pc.refHighAtRed = pc.refHigh;
        ev.push(`RED(${label})`);
      }
    }

    if (pc.redEver && pc.buy === null && !anyLiveBuy) {
      const refHigh = Math.max(pc.refHigh, pc.refHighAtRed);
      if (cur.l >= prev.l && cur.h > refHigh && cur.h - refHigh >= THRESH - EPS && cur.c >= refHigh) {
        pc.buy = new Buy(cur.h, cur.l);
        ev.push(`TZ BUY(${label})`);
      }
    }

    if (pc.buy !== null) {
      ev.push(...this.evalBuy(pc, pc.buy, prev, cur));
    }

    return ev;
  }

  // -----------------------------------------------------------------
  private evalBuy(pc: ParentCycle, buy: Buy, prev: Day, cur: Day): string[] {
    let ev: string[] = [];
    const branchLbl = branchLabel(pc.id);

    const hasDeeperActive =
      buy.barLineages.length > 0 || buy.barPending || buy.rear !== null || buy.rearReenter !== null;
    const noBarYet = !hasDeeperActive;
    const red1PreexistingAtBuyLevel = buy.active && noBarYet && buy.red1 !== null && buy.red1.active;
    const preTodayBuyRef = buy.refHigh;

    let reactivatedToday = false;
    if (buy.active) {
      if (buy.barHighPool > buy.refHigh) buy.refHigh = buy.barHighPool;
      const isSl = cur.l <= buy.refLow && buy.refLow - cur.l >= THRESH - EPS && cur.c <= buy.refLow + EPS;
      let hh = false;
      let ll = false;
      if (noBarYet) {
        const red1ClearsToday = red1PreexistingAtBuyLevel && this.red1InvalidatesToday(buy, cur);
        if (!red1PreexistingAtBuyLevel || red1ClearsToday) {
          if (!buy.red1Ever || red1ClearsToday) {
            if (cur.h > buy.refHigh && cur.h - buy.refHigh >= ANY) {
              buy.refHigh = cur.h;
              hh = true;
            }
          } else {
            const diff = cur.h - buy.refHigh;
            if (cur.h > buy.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < buy.refHigh)) {
              buy.refHigh = cur.h;
              hh = true;
            }
          }
        }
      }
      if (cur.l < buy.refLow) {
        const gap = buy.refLow - cur.l;
        if ((gap >= THRESH - EPS && cur.c > buy.refLow + EPS) || gap < THRESH - EPS) {
          buy.refLow = cur.l;
          ll = true;
        }
      }

      if (hh && buy.tzBuy2 === null) ev.push(`TZ BUY HH(${branchLbl})`);
      if (ll) ev.push(`TZ BUY LL(${branchLbl})`);

      if (isSl) {
        ev.push(`TZ BUY SL(${branchLbl})`);
        buy.reentryThreshold = this.currentTopRef(buy);
        buy.active = false;
        buy.barPending = false;
        buy.red1 = null;
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barDeadLabels = new Set();
        buy.rear = null;
        buy.rearReenter = null;
        buy.tzBuy2 = null;
        buy.tzBuy2HhMuted = false;
      }
    } else {
      const ref = buy.reentryThreshold !== null ? buy.reentryThreshold : preTodayBuyRef;
      if (!this.milestoneBlocked(pc) && cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        buy.active = true;
        buy.refHigh = cur.h;
        buy.refLow = cur.l;
        buy.red1Ever = false;
        buy.red1 = null;
        buy.tzBuy2 = null;
        buy.tzBuy2HhMuted = false;
        buy.reentryThreshold = null;
        ev.push(`TZ BUY(${branchLbl})`);
        reactivatedToday = true;
      } else if (!this.milestoneBlocked(pc) && cur.h > ref && cur.h - ref >= ANY) {
        buy.reentryThreshold = cur.h;
        ev.push(`INVALID TZ BUY HH(${branchLbl})`);
      }
    }

    if (!reactivatedToday) {
      ev.push(...this.evalTzBuy2(pc, buy, prev, cur, preTodayBuyRef));
    }

    const preTodayLinRef = new Map<string, number>();
    const preTodayBar2Ref = new Map<string, number | null>();
    for (const lin of buy.barLineages) {
      preTodayLinRef.set(lin.label, lin.refHigh);
      preTodayBar2Ref.set(lin.label, lin.bar2 !== null ? lin.bar2.refHigh : null);
    }
    const preTodayRearRef = buy.rear !== null ? buy.rear.refHigh : null;
    const preTodayRreRef = buy.rearReenter !== null ? buy.rearReenter.refHigh : null;

    const newestLin = this.newestLiveLineage(buy.barLineages);
    if (newestLin !== null && !this.barHhSuppressedToday(buy, newestLin, prev, cur)) {
      const linHhEv = this.evalBarLineageHh(buy, newestLin, prev, cur);
      if (newestLin.bar2 === null) {
        ev.push(...linHhEv);
      } else {
        ev.push(...linHhEv.filter((e) => e.startsWith("BAR LL(")));
      }
    }

    // Real-data bug (INDNIPPON.NS): an older lineage racing in parallel
    // behind the newest one (still pre-SL, not yet dead) never got its own
    // refLow updated at all, since evalBarLineageHh (where "BAR LL(" is
    // computed) was only ever called for newestLin above. Its own SL check
    // further down still runs for every pre-SL lineage, so that SL kept
    // firing against a stale, un-lowered refLow. HH is deliberately NOT
    // extended to older lineages -- that suppression is the documented,
    // intentional rule one tier up; only the LL side needed this fix.
    for (const lin of buy.barLineages) {
      if (lin === newestLin || lin.sl !== null) continue;
      if (cur.l < lin.refLow) {
        const gap = lin.refLow - cur.l;
        if ((gap >= THRESH - EPS && cur.c > lin.refLow + EPS) || gap < THRESH - EPS) {
          lin.refLow = cur.l;
          ev.push(`BAR LL(${lin.label})`);
        }
      }
    }

    const bar2EvByLabel = new Map<string, string[]>();
    for (const lin of buy.barLineages) {
      bar2EvByLabel.set(lin.label, this.evalBar2(lin, prev, cur, preTodayLinRef.get(lin.label) ?? null));
    }

    if (newestLin !== null && newestLin.bar2 !== null) {
      // Real-data bug (ICICIBANK.NS G.1): a lineage that has already
      // recovered above its own BAR SL reference high (sl.invalidated) has
      // nothing left to track toward -- its own BAR SL 2 is off the table
      // once that recovery happened. Once a newer BAR has reached BAR 2 (a
      // genuine BAR1-BAR2 active elsewhere), such an invalidated lineage is
      // terminated here, same as one that was never SL'd at all; only a
      // still-un-invalidated SL'd lineage keeps its "track toward BAR SL 2"
      // privilege.
      const surviving = buy.barLineages.filter(
        (l) => l === newestLin || (l.sl !== null && !l.sl.invalidated),
      );
      buy.barLineages = surviving;
      for (const linSurvivor of surviving) {
        ev.push(...(bar2EvByLabel.get(linSurvivor.label) ?? []));
      }
    } else {
      for (const linEv of bar2EvByLabel.values()) ev.push(...linEv);
    }

    if (buy.rear !== null) {
      if (buy.rear.sl === null) {
        let rearEv = this.evalRearHhLl(pc, buy, buy.rear, prev, cur);
        if (buy.rear.dormant) rearEv = rearEv.filter((e) => e.includes("LL("));
        if (buy.rear.rear2 !== null) rearEv = rearEv.filter((e) => !e.startsWith("REAR HH("));
        ev.push(...rearEv);
      }
      ev.push(...this.evalRear2(pc, buy, buy.rear, prev, cur, preTodayRearRef));
    }

    if (buy.rearReenter !== null) {
      if (buy.rearReenter.sl === null) {
        let rreEv = this.evalRearReenterHhLl(pc, buy, buy.rearReenter, prev, cur);
        if (buy.rearReenter.dormant) rreEv = rreEv.filter((e) => e.includes("LL("));
        if (buy.rearReenter.rre2 !== null) {
          rreEv = rreEv.filter((e) => !e.startsWith("REAR RE-ENTER HH("));
        }
        ev.push(...rreEv);
      }
      ev.push(...this.evalRre2(pc, buy, buy.rearReenter, prev, cur, preTodayRreRef));
    }

    const barConfirmsToday =
      buy.barPending &&
      buy.active &&
      buy.barLineages.length === 0 &&
      (buy.rear !== null || buy.rearReenter !== null) &&
      this.barEntryShape(prev, cur);

    if (buy.rearReenter !== null && buy.rearReenter.sl !== null) {
      ev.push(...this.evalRearReenterSlProgress(pc, buy, buy.rearReenter, buy.rearReenter.sl, prev, cur));
    } else if (buy.rearReenter === null && buy.rear !== null && buy.rear.sl !== null) {
      ev.push(...this.evalRearSlProgress(pc, buy, buy.rear, buy.rear.sl, prev, cur));
    } else if (barConfirmsToday) {
      ev = ev.filter((e) => !(e.startsWith("REAR HH(") || e.startsWith("REAR RE-ENTER HH(")));
      ev.push(...this.checkBarPending(pc, buy, prev, cur, false));
    } else if (buy.barLineages.length > 0) {
      // Real-data bug (ICICIBANK.NS hypothetical, confirmed): a sibling
      // lineage's own BAR 2 SL event was already pushed into `ev` ABOVE
      // (the bar2EvByLabel push, before this dispatch even runs) using
      // the lineage array as it stood at the START of today -- so when
      // THIS SAME candle's SL-tier processing below both SL's that
      // sibling at the lineage level AND confirms genuine BAR SL2 for a
      // different lineage, the sibling gets correctly dropped from
      // buy.barLineages, but its earlier-pushed BAR 2 SL text was never
      // retracted. Confirmed wrong: "NO NEED TO RECORD BAR SL A.2 since
      // it automatically got terminated." Any lineage present before
      // this call but gone after it is terminated silently -- strip
      // every event already in `ev` for its label, not just the ones
      // evalBarLineagesProgress itself would have pushed.
      const labelsBefore = new Set(buy.barLineages.map((l) => l.label));
      ev.push(...this.evalBarLineagesProgress(pc, buy, prev, cur, preTodayBar2Ref));
      const labelsAfter = new Set(buy.barLineages.map((l) => l.label));
      const droppedLabels = [...labelsBefore].filter((l) => !labelsAfter.has(l));
      if (droppedLabels.length > 0) {
        ev = ev.filter((e) => !droppedLabels.includes(labelOf(e)));
      }
    } else if (buy.rearReenter !== null && !buy.rearReenter.dormant) {
      ev.push(...this.evalRearReenterProgress(pc, buy, buy.rearReenter, prev, cur));
    } else if (buy.rearReenter === null && buy.rear !== null && !buy.rear.dormant) {
      ev.push(...this.evalRearProgress(pc, buy, buy.rear, prev, cur));
    } else if (buy.barPending && buy.active) {
      ev.push(...this.checkBarPending(pc, buy, prev, cur, true));
    } else if (!buy.active) {
      // pass
    } else if (buy.red1 === null || !buy.red1.active) {
      if (
        buy.tzBuy2 !== null &&
        !buy.tzBuy2.slActive &&
        cur.h <= prev.h &&
        cur.l < prev.l &&
        prev.l - cur.l >= THRESH - EPS &&
        cur.c <= prev.l
      ) {
        if (!buy.red1Ever) buy.refHighAtRed1 = buy.refHigh;
        buy.red1Ever = true;
        buy.red1 = new Red1(cur.h, cur.l);
        ev.push(`RED1(${branchLbl})`);
      }
    } else {
      ev.push(...this.evalRed1Generic(pc, buy, buy, prev, cur));
    }

    if (buy.rearReenter !== null && buy.rearReenter.dormant && buy.rearReenter.sl === null) {
      const rre = buy.rearReenter;
      if (cur.l < rre.refLow && rre.refLow - cur.l >= THRESH - EPS && cur.c <= rre.refLow + EPS) {
        ev.push(`REAR RE-ENTER SL(${branchLbl})`);
        const sl = new RearReenterSL(cur.l);
        sl.entryThreshold = this.currentTopRef(buy);
        rre.sl = sl;
        rre.rre2 = null;
        buy.red1 = null;
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barDeadLabels = new Set();
        buy.barPending = false;
      }
    } else if (buy.rear !== null && buy.rear.dormant && buy.rear.sl === null) {
      const rear = buy.rear;
      if (cur.l < rear.refLow && rear.refLow - cur.l >= THRESH - EPS && cur.c <= rear.refLow + EPS) {
        ev.push(`REAR SL(${branchLbl})`);
        const sl = new RearSL(cur.l);
        sl.entryThreshold = this.currentTopRef(buy);
        rear.sl = sl;
        rear.rear2 = null;
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barDeadLabels = new Set();
        buy.red1 = null;
        buy.barPending = false;
      }
    }

    if (buy.tzBuy2 !== null && !buy.tzBuy2HhMuted) {
      const deeperRefs: number[] = [];
      for (const lin of buy.barLineages) deeperRefs.push(lin.refHigh);
      for (const lin of buy.barLineages) if (lin.bar2 !== null) deeperRefs.push(lin.bar2.refHigh);
      if (buy.rear !== null) {
        deeperRefs.push(buy.rear.refHigh);
        if (buy.rear.rear2 !== null) deeperRefs.push(buy.rear.rear2.refHigh);
      }
      if (buy.rearReenter !== null) {
        deeperRefs.push(buy.rearReenter.refHigh);
        if (buy.rearReenter.rre2 !== null) deeperRefs.push(buy.rearReenter.rre2.refHigh);
      }
      if (deeperRefs.length > 0 && Math.max(...deeperRefs) >= buy.tzBuy2.refHigh) {
        buy.tzBuy2HhMuted = true;
      }
    }
    if (buy.tzBuy2HhMuted) {
      ev = ev.filter((e) => !e.startsWith("TZ BUY 2 HH("));
    }

    const slLabels = new Set<string>();
    for (const e of ev) {
      if (
        e.startsWith("BAR SL(") ||
        e.startsWith("REAR SL(") ||
        e.startsWith("REAR RE-ENTER SL(") ||
        e.startsWith("TZ BUY SL(")
      ) {
        slLabels.add(labelOf(e));
      }
    }
    if (slLabels.size > 0) {
      ev = ev.filter((e) => {
        const isSuppressible =
          e.startsWith("BAR HH(") ||
          e.startsWith("BAR 2 SL(") ||
          e.startsWith("BAR 2 LL(") ||
          e.startsWith("REAR 2 SL(") ||
          e.startsWith("REAR 2 LL(") ||
          e.startsWith("REAR RE-ENTER 2 SL(") ||
          e.startsWith("REAR RE-ENTER 2 LL(") ||
          e.startsWith("TZ BUY 2 SL(") ||
          e.startsWith("TZ BUY 2 LL(");
        return !(isSuppressible && slLabels.has(labelOf(e)));
      });
    }

    const twoLabels: Record<string, Set<string>> = {
      "BAR HH(": new Set(),
      "REAR HH(": new Set(),
      "REAR RE-ENTER HH(": new Set(),
      "TZ BUY HH(": new Set(),
    };
    const prefixMap: [string, string][] = [
      ["BAR 2(", "BAR HH("], ["BAR 2 ", "BAR HH("],
      ["REAR RE-ENTER 2(", "REAR RE-ENTER HH("], ["REAR RE-ENTER 2 ", "REAR RE-ENTER HH("],
      ["REAR 2(", "REAR HH("], ["REAR 2 ", "REAR HH("],
      ["TZ BUY 2(", "TZ BUY HH("], ["TZ BUY 2 ", "TZ BUY HH("],
    ];
    for (const e of ev) {
      for (const [prefix, underlying] of prefixMap) {
        if (e.startsWith(prefix)) {
          twoLabels[underlying].add(labelOf(e));
        }
      }
    }
    if (Object.values(twoLabels).some((s) => s.size > 0)) {
      ev = ev.filter(
        (e) =>
          !Object.entries(twoLabels).some(
            ([underlying, labels]) => e.startsWith(underlying) && labels.has(e.slice(underlying.length, -1))
          )
      );
    }

    return ev;
  }

  // -----------------------------------------------------------------
  private evalRed1Generic(pc: ParentCycle, buy: Buy, stageObj: Stage, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);
    const red1 = buy.red1 as Red1;
    if (cur.h >= red1.refHigh && cur.h - red1.refHigh >= THRESH - EPS && cur.c >= red1.refHigh) {
      ev.push(`INVALID RED1(${label})`);
      red1.active = false;
      this.resetRed1Regime(stageObj);
      return ev;
    }

    if (cur.h > red1.refHigh && cur.h - red1.refHigh >= ANY) {
      red1.refHigh = cur.h;
      ev.push(`RED1 HH(${label})`);
    }

    if (cur.l < red1.refLow) {
      const red2Holds = cur.h <= prev.h && red1.refLow - cur.l >= THRESH - EPS && cur.c <= red1.refLow + EPS;
      if (red2Holds) {
        red1.active = false;
        ev.push(`RED2(${label})`);
        if (stageObj instanceof BarLineage || stageObj instanceof Rear || stageObj instanceof RearReenter) {
          stageObj.red2Ever = true;
        }
        if (stageObj instanceof BarLineage && stageObj.bar2 === null) {
          const idx = buy.barLineages.indexOf(stageObj);
          if (idx !== -1) {
            buy.barLineages.splice(idx, 1);
            const n = parseInt(stageObj.label.split(".").pop() as string, 10);
            buy.barDeadLabels.add(n);
          }
        }
        this.clearForNewBarGeneration(buy);
      } else {
        red1.refLow = cur.l;
        ev.push(`RED1 LL(${label})`);
      }
    }

    return ev;
  }

  private attachFreshRed1(pc: ParentCycle, buy: Buy, stageObj: BarLineage | Rear | RearReenter, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
      if (!stageObj.red1Since) stageObj.refHighAtRed1 = stageObj.refHigh;
      stageObj.red1Since = true;
      buy.red1 = new Red1(cur.h, cur.l);
      ev.push(`RED1(${branchLabel(pc.id)})`);
    }
    return ev;
  }

  private resetRed1Regime(stageObj: Stage): void {
    if (stageObj instanceof BarLineage || stageObj instanceof Rear || stageObj instanceof RearReenter) {
      stageObj.red1Since = false;
    } else {
      stageObj.red1Ever = false;
    }
  }

  private red1InvalidatesToday(buy: Buy, cur: Day): boolean {
    const red1 = buy.red1;
    if (red1 === null || !red1.active) return false;
    return cur.h >= red1.refHigh && cur.h - red1.refHigh >= THRESH - EPS && cur.c >= red1.refHigh;
  }

  // -----------------------------------------------------------------
  private barSlInvalidatesToday(lin: BarLineage, cur: Day): boolean {
    const sl = lin.sl;
    if (sl === null || sl.sl2 || sl.invalidated) return false;
    return cur.h >= sl.refHigh && cur.h - sl.refHigh >= THRESH - EPS && cur.c >= sl.refHigh;
  }

  private barEntryShape(prev: Day, cur: Day): boolean {
    return cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h;
  }

  private mechanism1ConfirmsToday(buy: Buy, prev: Day, cur: Day): boolean {
    return buy.barPending && this.barEntryShape(prev, cur);
  }

  private dormantBarLowCheck(buy: Buy, lin: BarLineage, sl: BarSL, cur: Day): string[] {
    const ev: string[] = [];
    if (cur.l < sl.refLow) {
      const gap = sl.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= sl.refLow + EPS) {
        ev.push(`BAR SL(${lin.label})`);
        lin.sl = new BarSL(cur.h, cur.l);
        buy.red1 = null;
      } else {
        sl.refLow = cur.l;
        ev.push(`INVALID BAR LL(${lin.label})`);
      }
    }
    return ev;
  }

  private barHhSuppressedToday(buy: Buy, lin: BarLineage, prev: Day, cur: Day): boolean {
    if (lin.sl !== null && lin.sl.invalidated) return true;
    if (lin.sl !== null && lin.sl.sl2) return true;
    if (this.barSlInvalidatesToday(lin, cur)) return true;
    if (lin.sl === null && this.mechanism1ConfirmsToday(buy, prev, cur)) return true;
    return false;
  }

  private clearForNewBarGeneration(buy: Buy): void {
    buy.barPending = true;
  }

  private supersedeRearForNewBar(buy: Buy): void {
    if (buy.rearReenter && buy.rearReenter.sl === null && !buy.rearReenter.dormant) {
      buy.rearReenter.dormant = true;
      if (buy.rearReenter.rre2 !== null) buy.rearReenter.rre2.dormant = true;
    } else if (buy.rear && buy.rear.sl === null && !buy.rear.dormant) {
      buy.rear.dormant = true;
      if (buy.rear.rear2 !== null) buy.rear.rear2.dormant = true;
    }
  }

  // -----------------------------------------------------------------
  private checkBarPending(pc: ParentCycle, buy: Buy, prev: Day, cur: Day, supersedeRear = true): string[] {
    // A dormant branch has already been superseded by a newer sibling and
    // must not independently spawn a brand-new BAR lineage -- see the
    // matching comment in tz_engine_wtf.py's own checkBarPending for the
    // full real-data trace (INDNIPPON.NS) that exposed this.
    if (pc.dormant) return [];
    if (cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h) {
      const subLabel = this.nextBarLabel(buy, branchLabel(pc.id));
      const newLin = new BarLineage(subLabel, cur.h, cur.l);
      buy.barLineages.push(newLin);
      buy.barPending = false;
      buy.barHighPool = Math.max(buy.barHighPool, cur.h);
      if (supersedeRear) this.supersedeRearForNewBar(buy);
      return [`BAR(${subLabel})`];
    }
    return [];
  }

  // =================== BAR family (multi-lineage) ===================
  private evalBarLineageHh(buy: Buy, lin: BarLineage, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    if (!lin.red1Since || this.red1InvalidatesToday(buy, cur)) {
      if (cur.h > lin.refHigh && cur.h - lin.refHigh >= ANY) {
        lin.refHigh = cur.h;
        buy.barHighPool = Math.max(buy.barHighPool, lin.refHigh);
        ev.push(`BAR HH(${lin.label})`);
      }
    } else {
      const diff = cur.h - lin.refHigh;
      if (cur.h > lin.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < lin.refHigh)) {
        lin.refHigh = cur.h;
        buy.barHighPool = Math.max(buy.barHighPool, lin.refHigh);
        ev.push(`BAR HH(${lin.label})`);
      }
    }
    if (lin.sl === null && cur.l < lin.refLow) {
      const gap = lin.refLow - cur.l;
      if ((gap >= THRESH - EPS && cur.c > lin.refLow + EPS) || gap < THRESH - EPS) {
        lin.refLow = cur.l;
        ev.push(`BAR LL(${lin.label})`);
      }
    }
    return ev;
  }

  // ------------------- TZ BUY 2 / BAR 2 / REAR 2 / REAR RE-ENTER 2 -----
  private evalTzBuy2(pc: ParentCycle, buy: Buy, prev: Day, cur: Day, preTodayBuyRef: number | null): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);
    if (buy.tzBuy2 === null) {
      if (buy.active) {
        const ref = preTodayBuyRef !== null ? preTodayBuyRef : buy.refHigh;
        if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
          buy.tzBuy2 = new Bar2(cur.h, cur.l);
          ev.push(`TZ BUY 2(${label})`);
        }
      }
      return ev;
    }
    if (!buy.active) {
      if (cur.h > buy.tzBuy2.refHigh && cur.h - buy.tzBuy2.refHigh >= ANY) {
        buy.tzBuy2.refHigh = cur.h;
        ev.push(`INVALID TZ BUY 2 HH(${label})`);
      }
      return ev;
    }
    const b2 = buy.tzBuy2;
    if (b2.slActive) {
      const ref = b2.reentryThreshold !== null ? b2.reentryThreshold : b2.refHigh;
      if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        b2.refHigh = cur.h;
        b2.refLow = cur.l;
        b2.slActive = false;
        b2.reentryThreshold = null;
        buy.tzBuy2HhMuted = false;
        ev.push(`TZ BUY 2(${label})`);
      } else if (cur.h > ref && cur.h - ref >= ANY) {
        b2.refHigh = cur.h;
        b2.reentryThreshold = cur.h;
        ev.push(`INVALID TZ BUY 2 HH(${label})`);
      }
      return ev;
    }
    if (cur.l < b2.refLow) {
      const gap = b2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= b2.refLow + EPS) {
        b2.reentryThreshold = this.currentTopRef(buy);
        b2.slActive = true;
        ev.push(`TZ BUY 2 SL(${label})`);
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barDeadLabels = new Set();
        buy.barPending = false;
        buy.rear = null;
        buy.rearReenter = null;
        buy.red1 = null;
        return ev;
      }
      b2.refLow = cur.l;
      ev.push(`TZ BUY 2 LL(${label})`);
    }
    if (cur.h > b2.refHigh && cur.h - b2.refHigh >= ANY) {
      b2.refHigh = cur.h;
      ev.push(`TZ BUY 2 HH(${label})`);
    }
    return ev;
  }

  private evalBar2(lin: BarLineage, prev: Day, cur: Day, preTodayLinRef: number | null): string[] {
    const ev: string[] = [];
    if (lin.bar2 === null) {
      if (lin.sl === null) {
        const ref = preTodayLinRef !== null ? preTodayLinRef : lin.refHigh;
        if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
          lin.bar2 = new Bar2(cur.h, cur.l);
          ev.push(`BAR 2(${lin.label})`);
        }
      }
      return ev;
    }
    if (lin.sl !== null) {
      // Real-data bug (ICICIBANK.NS hypothetical, confirmed): INVALID
      // BAR HH is only a thing for a lineage that has reached genuine
      // BAR SL 2 (deep failure) -- a plain BAR SL (sl.sl2 still false)
      // has no HH concept at all, only INVALID BAR SL (handled by the
      // lineage-level SL-tier check, not here). Confirmed: "There was
      // not BAR SL 2 just a BAR SL. It will be looking for INVALID BAR
      // SL only ... INVALID BAR HH can occur only for the BAR after
      // BAR SL 2."
      if (lin.sl.sl2 && cur.h > lin.bar2.refHigh && cur.h - lin.bar2.refHigh >= ANY) {
        lin.bar2.refHigh = cur.h;
        ev.push(`INVALID BAR HH(${lin.label})`);
      }
      return ev;
    }
    const b2 = lin.bar2;
    if (b2.slActive) {
      if (cur.l >= prev.l && cur.h > b2.refHigh && cur.h - b2.refHigh >= THRESH - EPS && cur.c >= b2.refHigh) {
        b2.refHigh = cur.h;
        b2.refLow = cur.l;
        b2.slActive = false;
        ev.push(`BAR 2(${lin.label})`);
      }
      return ev;
    }
    if (cur.l < b2.refLow) {
      const gap = b2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= b2.refLow + EPS) {
        b2.slActive = true;
        ev.push(`BAR 2 SL(${lin.label})`);
        return ev;
      }
      b2.refLow = cur.l;
      ev.push(`BAR 2 LL(${lin.label})`);
    }
    if (cur.h > b2.refHigh && cur.h - b2.refHigh >= ANY) {
      b2.refHigh = cur.h;
      ev.push(`BAR 2 HH(${lin.label})`);
    }
    return ev;
  }

  private evalRear2(pc: ParentCycle, buy: Buy, rear: Rear, prev: Day, cur: Day, preTodayRearRef: number | null): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);
    if (rear.rear2 === null) {
      if (rear.sl === null) {
        const ref = preTodayRearRef !== null ? preTodayRearRef : rear.refHigh;
        // Real-data bug (ICICIBANK.NS hypothetical, confirmed): once a
        // newer sibling has already won the race, this chain's REAR
        // (and its escalation to REAR 2) must keep confirming and
        // tracking its own reference internally exactly as if nothing
        // had happened -- "RECORDED AT THE BACKEND" -- so that if the
        // race ever reopens (the newer sibling's own TZ BUY 2 later
        // fails), this chain picks up from its own true current
        // reference, not a stale pre-race one. Only the VISIBLE text is
        // suppressed, in process()'s own output filter (see
        // racedOutByNewerTzBuy2's other use there) -- never the
        // confirmation logic itself.
        if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
          rear.rear2 = new Bar2(cur.h, cur.l);
          ev.push(`REAR 2(${label})`);
        }
      }
      return ev;
    }
    if (rear.rear2.dormant) return ev;
    if (rear.sl !== null) {
      if (cur.h > rear.rear2.refHigh && cur.h - rear.rear2.refHigh >= ANY) {
        rear.rear2.refHigh = cur.h;
        ev.push(`INVALID REAR HH(${label})`);
      }
      return ev;
    }
    const r2 = rear.rear2;
    if (r2.slActive) {
      const ref = r2.reentryThreshold !== null ? r2.reentryThreshold : r2.refHigh;
      if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        r2.refHigh = cur.h;
        r2.refLow = cur.l;
        r2.slActive = false;
        r2.reentryThreshold = null;
        ev.push(`REAR 2(${label})`);
      } else if (cur.h > ref && cur.h - ref >= ANY) {
        r2.refHigh = cur.h;
        r2.reentryThreshold = cur.h;
        ev.push(`INVALID REAR 2 HH(${label})`);
      }
      return ev;
    }
    if (cur.l < r2.refLow) {
      const gap = r2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= r2.refLow + EPS) {
        r2.reentryThreshold = this.currentTopRef(buy);
        r2.slActive = true;
        ev.push(`REAR 2 SL(${label})`);
        buy.red1 = null;
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barDeadLabels = new Set();
        buy.barPending = false;
        return ev;
      }
      r2.refLow = cur.l;
      ev.push(`REAR 2 LL(${label})`);
    }
    if (cur.h > r2.refHigh && cur.h - r2.refHigh >= ANY) {
      r2.refHigh = cur.h;
      ev.push(`REAR 2 HH(${label})`);
    }
    return ev;
  }

  private evalRre2(pc: ParentCycle, buy: Buy, rre: RearReenter, prev: Day, cur: Day, preTodayRreRef: number | null): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);
    if (rre.dormant) return ev;
    if (rre.rre2 === null) {
      if (rre.sl === null) {
        const ref = preTodayRreRef !== null ? preTodayRreRef : rre.refHigh;
        if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
          rre.rre2 = new Bar2(cur.h, cur.l);
          ev.push(`REAR RE-ENTER 2(${label})`);
        }
      }
      return ev;
    }
    if (rre.sl !== null) {
      if (cur.h > rre.rre2.refHigh && cur.h - rre.rre2.refHigh >= ANY) {
        rre.rre2.refHigh = cur.h;
        ev.push(`INVALID REAR RE-ENTER HH(${label})`);
      }
      return ev;
    }
    const r2 = rre.rre2;
    if (r2.slActive) {
      const ref = r2.reentryThreshold !== null ? r2.reentryThreshold : r2.refHigh;
      if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        r2.refHigh = cur.h;
        r2.refLow = cur.l;
        r2.slActive = false;
        r2.reentryThreshold = null;
        ev.push(`REAR RE-ENTER 2(${label})`);
      } else if (cur.h > ref && cur.h - ref >= ANY) {
        r2.refHigh = cur.h;
        r2.reentryThreshold = cur.h;
        ev.push(`INVALID REAR RE-ENTER 2 HH(${label})`);
      }
      return ev;
    }
    if (cur.l < r2.refLow) {
      const gap = r2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= r2.refLow + EPS) {
        r2.reentryThreshold = this.currentTopRef(buy);
        r2.slActive = true;
        ev.push(`REAR RE-ENTER 2 SL(${label})`);
        buy.red1 = null;
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barDeadLabels = new Set();
        buy.barPending = false;
        return ev;
      }
      r2.refLow = cur.l;
      ev.push(`REAR RE-ENTER 2 LL(${label})`);
    }
    if (cur.h > r2.refHigh && cur.h - r2.refHigh >= ANY) {
      r2.refHigh = cur.h;
      ev.push(`REAR RE-ENTER 2 HH(${label})`);
    }
    return ev;
  }

  // -----------------------------------------------------------------
  /** Advances every currently-alive BAR lineage's SL/SL2 state. Whichever
   * lineage's SL2 condition fires first wins: a fresh REAR forms off its
   * own reference, and every other lineage terminates immediately. */
  private evalBarLineagesProgress(
    pc: ParentCycle,
    buy: Buy,
    prev: Day,
    cur: Day,
    preTodayBar2Ref: Map<string, number | null>
  ): string[] {
    const labelId = branchLabel(pc.id);
    let rearWinner: [number, number] | null = null;
    let sl2ConfirmedToday = false;
    let reactivatedThisCandle = false;
    const perLineageEv = new Map<string, string[]>();
    const lineageObjs = new Map<string, BarLineage>();
    const preEv: string[] = [];

    const newestForRed1 = this.newestLiveLineage(buy.barLineages);

    if (rearWinner === null) {
      for (const lin of Array.from(buy.barLineages)) {
        lineageObjs.set(lin.label, lin);
        const linEv: string[] = [];
        perLineageEv.set(lin.label, linEv);
        if (lin.sl === null) {
          if (cur.l < lin.refLow && lin.refLow - cur.l >= THRESH - EPS && cur.c <= lin.refLow + EPS) {
            linEv.push(`BAR SL(${lin.label})`);
            lin.sl = new BarSL(cur.h, cur.l);
            buy.red1 = null;
            lin.red1Since = false;
            // Reverted: a fresh RED1 is not needed here -- once a
            // lineage has its own BAR SL, a brand-new BAR is already
            // free to form directly (see the newestIsDead-gated
            // freshBarReady check below), so there is nothing for a
            // same-candle RED1 to unlock. Confirmed: "Since it was BAR
            // SL, I doubt RED 1 was required since NEW BAR will anyways
            // be valid to occur."
            continue;
          }
          if (lin === newestForRed1) {
            const red1Preexisting = buy.red1 !== null && buy.red1.active;
            if (red1Preexisting) {
              linEv.push(...this.evalRed1Generic(pc, buy, lin, prev, cur));
            } else if (!lin.red2Ever) {
              linEv.push(...this.attachFreshRed1(pc, buy, lin, prev, cur));
            }
          }
          continue;
        }

        const sl = lin.sl;

        if (lin.bar2 === null) {
          // A single (never-escalated) BAR's own SL has no "INVALID BAR
          // SL", "BAR SL2", or REAR concept at all -- confirmed: "BAR SL
          // 2 can only occur for the 2 BAR and not single BAR" / "REAR
          // will now only occur above the BAR 2 reference high after
          // the BAR SL2." This lineage is simply a parked dead end from
          // here: only a fresh BAR reform (bottom of this function) is
          // the way forward.
          continue;
        }

        if (sl.invalidated) {
          linEv.push(...this.dormantBarLowCheck(buy, lin, sl, cur));
          continue;
        }

        if (!sl.sl2) {
          // Real-data bug (ICICIBANK.NS G.1): INVALID BAR SL is compulsory
          // to record once price closes back above a lineage's own BAR SL
          // reference high -- it is NOT a privilege of the newest lineage.
          // Confirmed wrong: "BAR SL HH ... There is no use of this. Once
          // closed above the BAR SL reference high, INVALID BAR SL
          // occurs." Gating it behind isNewest (as "VALID BAR should not
          // stop BAR SL 2 from occurring" originally did, confirmed on
          // SUZLON.NS B.6/B.7) only applies to a lineage that NEVER
          // recovers above its own SL reference -- that one legitimately
          // keeps climbing/BAR-SL2-watching forever in the background.
          // Once it DOES recover (this check fires), only the newest
          // lineage gets to literally reform as a fresh BAR under the
          // same label; a non-newest lineage just gets marked invalidated
          // and stops being tracked (see the sl.invalidated short-circuit
          // above, and the survivor filter above this function's own loop).
          const isNewest = lin === this.newestLiveLineage(buy.barLineages);
          if (cur.h >= sl.refHigh && cur.h - sl.refHigh >= THRESH - EPS && cur.c >= sl.refHigh) {
            linEv.push(`INVALID BAR SL(${lin.label})`);
            buy.barHighPool = Math.max(buy.barHighPool, cur.h);
            if (isNewest && this.barEntryShape(prev, cur)) {
              lin.sl = null;
              lin.refHigh = cur.h;
              lin.refLow = cur.l;
              lin.red1Since = false;
              lin.red2Ever = false;
              lin.bar2 = null;
              reactivatedThisCandle = true;
              buy.barPending = false;
              linEv.push(`BAR(${lin.label})`);
            } else {
              sl.invalidated = true;
              linEv.push(...this.dormantBarLowCheck(buy, lin, sl, cur));
            }
            continue;
          }
          if (cur.h > sl.refHigh && cur.h - sl.refHigh >= ANY) {
            sl.refHigh = cur.h;
            buy.barHighPool = Math.max(buy.barHighPool, sl.refHigh);
            linEv.push(`BAR SL HH(${lin.label})`);
          }
          if (cur.l < sl.refLow) {
            const gap = sl.refLow - cur.l;
            if ((gap >= THRESH - EPS && cur.c > sl.refLow + EPS) || gap < THRESH - EPS) {
              sl.refLow = cur.l;
              linEv.push(`BAR SL LL(${lin.label})`);
            }
          }
          if (cur.l < sl.refLow && sl.refLow - cur.l >= THRESH - EPS && cur.c <= sl.refLow + EPS) {
            linEv.push(`BAR SL2(${lin.label})`);
            sl.sl2 = true;
            sl2ConfirmedToday = true;
            buy.barPending = false;
          }
        } else if (!this.rearAncestorTerminated(buy)) {
          // REAR only ever occurs above BAR 2's own reference high, and
          // only once this lineage has confirmed genuine BAR SL2 (sl.sl2
          // true -- the else branch of the !sl.sl2 check above). A bare
          // BAR SL alone never opens REAR eligibility.
          const preRef = preTodayBar2Ref.get(lin.label);
          const rearRef = preRef !== undefined && preRef !== null ? preRef : (lin.bar2 as Bar2).refHigh;
          const isRear = cur.l >= prev.l && cur.h > rearRef && cur.h - rearRef >= THRESH - EPS && cur.c >= rearRef;
          // Deliberately NOT gated by milestoneBlocked, OR by whether a
          // newer sibling has already won the race (racedOutByNewerTzBuy2)
          // -- confirmed real-data case, ETERNAL.NS: branch B's own BAR
          // 2(B.1) chain reaches REAR purely off its own reference high
          // (304.70 -> 314.45), the SAME weeks an unrelated sibling
          // branch is independently making its own TZ BUY/TZ BUY 2
          // progress. REAR above BAR 2's own high is a property of this
          // chain's own lineage, not a cross-branch leadership contest.
          // Confirmed (ICICIBANK.NS hypothetical): even once a sibling
          // HAS already won, REAR must still confirm and keep tracking
          // its own reference internally -- "RECORDED AT THE BACKEND" --
          // so the state is correct if the race ever reopens. Only
          // process()'s own output filter decides whether this shows.
          if (isRear) {
            rearWinner = [cur.h, cur.l];
            break;
          }
        }
      }
    }

    if (sl2ConfirmedToday) {
      for (const [label, linObj] of lineageObjs) {
        if (linObj.sl !== null && !linObj.sl.sl2) {
          perLineageEv.set(label, []);
        }
      }
      buy.barLineages = buy.barLineages.filter((l) => l.sl === null || l.sl.sl2);
    }

    let ev: string[] = [...preEv];
    for (const linEv of perLineageEv.values()) ev.push(...linEv);

    if (rearWinner !== null) {
      const [rh, rl] = rearWinner;
      const rear = new Rear(rh, rl);
      ev = [`REAR(${labelId})`];
      buy.rearReenter = null;
      buy.rear = rear;
      buy.barLineages = [];
      buy.barSubCounter = 0;
      buy.barDeadLabels = new Set();
      buy.barPending = false;
      return ev;
    }

    const newest = this.newestLiveLineage(buy.barLineages);
    // A bare (bar2-null) lineage's own SL is "dead enough to reform"
    // here on every timeframe, weekly included -- confirmed: "every BAR
    // will be considered as the BASE BAR unless there is BAR 1 - BAR 2 -
    // BAR SL - BAR SL 2." REAR already gets first crack at every candle
    // via the chain-wide anchor check above (which returns early when it
    // wins), so this plain reform is a genuinely parallel, lower-
    // priority path -- it only ever fires on a candle where REAR itself
    // did NOT also qualify -- not a shortcut that starves REAR out the
    // way an earlier, narrower version of this flag prevented (back when
    // REAR had no path of its own for a bare lineage at all).
    const newestIsDead = newest === null || (newest.sl !== null && !newest.sl.sl2);
    const freshBarReady = newestIsDead || buy.barPending;
    if (!pc.dormant && !reactivatedThisCandle && buy.active && freshBarReady && this.barEntryShape(prev, cur)) {
      const surviving: BarLineage[] = [];
      const dropped: BarLineage[] = [];
      for (const l of buy.barLineages) {
        if (l.sl === null || (!l.sl.invalidated && l.bar2 !== null)) {
          surviving.push(l);
        } else {
          dropped.push(l);
        }
      }
      for (const l of dropped) {
        if (l.sl !== null && l.bar2 === null) {
          const n = parseInt(l.label.split(".").pop() as string, 10);
          buy.barDeadLabels.add(n);
        }
      }
      buy.barLineages = surviving;
      const subLabel = this.nextBarLabel(buy, labelId);
      buy.barLineages.push(new BarLineage(subLabel, cur.h, cur.l));
      buy.barPending = false;
      buy.barHighPool = Math.max(buy.barHighPool, cur.h);
      ev.push(`BAR(${subLabel})`);
    }

    return ev;
  }

  // =================== REAR family ===================
  private evalRearHhLl(pc: ParentCycle, buy: Buy, rear: Rear, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);
    if (!rear.red1Since || rear.dormant || this.red1InvalidatesToday(buy, cur)) {
      if (cur.h > rear.refHigh && cur.h - rear.refHigh >= ANY) {
        rear.refHigh = cur.h;
        ev.push(`REAR HH(${label})`);
      }
    } else {
      const diff = cur.h - rear.refHigh;
      if (cur.h > rear.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < rear.refHigh)) {
        rear.refHigh = cur.h;
        ev.push(`REAR HH(${label})`);
      }
    }
    if (cur.l < rear.refLow) {
      const gap = rear.refLow - cur.l;
      if ((gap >= THRESH - EPS && cur.c > rear.refLow + EPS) || gap < THRESH - EPS) {
        rear.refLow = cur.l;
        ev.push(`REAR LL(${label})`);
      }
    }
    return ev;
  }

  private evalRearProgress(pc: ParentCycle, buy: Buy, rear: Rear, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);
    if (cur.l < rear.refLow && rear.refLow - cur.l >= THRESH - EPS && cur.c <= rear.refLow + EPS) {
      ev.push(`REAR SL(${label})`);
      const sl = new RearSL(cur.l);
      sl.entryThreshold = this.currentTopRef(buy);
      rear.sl = sl;
      rear.rear2 = null;
      buy.barLineages = [];
      buy.barSubCounter = 0;
      buy.barDeadLabels = new Set();
      buy.red1 = null;
      buy.barPending = false;
      return ev;
    }
    const red1Preexisting = buy.red1 !== null && buy.red1.active;
    // RED1 only attaches after REAR has ALSO escalated to REAR 2 (REAR
    // itself is only a shallow confirmation, per "REAR 2 will come into
    // picture only when BAR faces BAR SL2" -- REAR 2 and this RED1-
    // RED2-to-fresh-BAR cycle are the two independent next steps once
    // REAR 2 exists, same as everywhere else in this engine).
    if (red1Preexisting) {
      ev.push(...this.evalRed1Generic(pc, buy, rear, prev, cur));
    } else if (rear.rear2 !== null && !rear.rear2.slActive && !rear.red2Ever) {
      ev.push(...this.attachFreshRed1(pc, buy, rear, prev, cur));
    }
    return ev;
  }

  private evalRearSlProgress(pc: ParentCycle, buy: Buy, rear: Rear, sl: RearSL, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const labelId = branchLabel(pc.id);
    const ref = sl.entryThreshold;
    const isReenter = cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
    if (isReenter && !this.milestoneBlocked(pc)) {
      buy.rearReenter = new RearReenter(cur.h, cur.l);
      ev.push(`REAR RE-ENTER(${labelId})`);
      rear.dormant = true;
      return ev;
    }
    // Real-data bug (ICICIBANK.NS): this ratchet used to be gated behind
    // !milestoneBlocked(pc) too -- but unlike the reenter-CONFIRMATION
    // check above (which correctly stays blocked), the quiet reference-
    // tracking itself must NEVER stall just because a newer sibling
    // currently leads, exactly like every analogous recovery elsewhere.
    if (cur.h > ref && cur.h - ref >= ANY) {
      sl.entryThreshold = cur.h;
      ev.push(`INVALID REAR SL HH(${labelId})`);
    }
    return ev;
  }

  // =================== REAR RE-ENTER family ===================
  private evalRearReenterHhLl(pc: ParentCycle, buy: Buy, rre: RearReenter, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);
    if (!rre.red1Since || rre.dormant || this.red1InvalidatesToday(buy, cur)) {
      if (cur.h > rre.refHigh && cur.h - rre.refHigh >= ANY) {
        rre.refHigh = cur.h;
        ev.push(`REAR RE-ENTER HH(${label})`);
      }
    } else {
      const diff = cur.h - rre.refHigh;
      if (cur.h > rre.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < rre.refHigh)) {
        rre.refHigh = cur.h;
        ev.push(`REAR RE-ENTER HH(${label})`);
      }
    }
    if (cur.l < rre.refLow) {
      const gap = rre.refLow - cur.l;
      if ((gap >= THRESH - EPS && cur.c > rre.refLow + EPS) || gap < THRESH - EPS) {
        rre.refLow = cur.l;
        ev.push(`REAR RE-ENTER LL(${label})`);
      }
    }
    return ev;
  }

  private evalRearReenterProgress(pc: ParentCycle, buy: Buy, rre: RearReenter, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);
    if (cur.l < rre.refLow && rre.refLow - cur.l >= THRESH - EPS && cur.c <= rre.refLow + EPS) {
      ev.push(`REAR RE-ENTER SL(${label})`);
      const sl = new RearReenterSL(cur.l);
      sl.entryThreshold = this.currentTopRef(buy);
      rre.sl = sl;
      rre.rre2 = null;
      buy.red1 = null;
      buy.barLineages = [];
      buy.barSubCounter = 0;
      buy.barDeadLabels = new Set();
      buy.barPending = false;
      return ev;
    }
    const red1Preexisting = buy.red1 !== null && buy.red1.active;
    if (red1Preexisting) {
      ev.push(...this.evalRed1Generic(pc, buy, rre, prev, cur));
    } else if (rre.rre2 !== null && !rre.rre2.slActive && !rre.red2Ever) {
      ev.push(...this.attachFreshRed1(pc, buy, rre, prev, cur));
    }
    return ev;
  }

  private evalRearReenterSlProgress(
    pc: ParentCycle,
    buy: Buy,
    rre: RearReenter,
    sl: RearReenterSL,
    prev: Day,
    cur: Day
  ): string[] {
    const ev: string[] = [];
    const labelId = branchLabel(pc.id);
    const ref = sl.entryThreshold;
    const isReenterAgain = cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
    if (isReenterAgain && !this.milestoneBlocked(pc)) {
      ev.push(`REAR RE-ENTER(${labelId})`);
      rre.sl = null;
      rre.refHigh = cur.h;
      rre.refLow = cur.l;
      rre.red1Since = false;
      rre.dormant = false;
      rre.red2Ever = false;
      return ev;
    }
    // Real-data bug (ICICIBANK.NS): same fix as REAR's own SL ratchet --
    // the quiet reference-tracking must never stall behind
    // milestoneBlocked, only the confirmation check above stays gated.
    if (cur.h > ref && cur.h - ref >= ANY) {
      sl.entryThreshold = cur.h;
      ev.push(`INVALID REAR RE-ENTER SL HH(${labelId})`);
    }
    return ev;
  }
}

// ---------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------

export interface HistoryRowLike {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

function toDays(rows: HistoryRowLike[]): Day[] {
  return rows
    .filter((r) => r.open !== null && r.high !== null && r.low !== null && r.close !== null)
    .map((r) => ({
      date: r.date,
      o: r.open as number,
      h: r.high as number,
      l: r.low as number,
      c: r.close as number,
    }));
}

/** Runs a fresh TZEngine over a sequence of OHLC rows (ascending by date)
 * and produces a date -> comma-joined-event-string map, matching
 * tz_engine_wtf.py's own run_series(). Rows with any null OHLC field are
 * dropped first. The first row never gets an event (no "prev" to compare
 * against). */
export function computeWtfEvents(rows: HistoryRowLike[], isWeekly: boolean = false): Map<string, string> {
  const days = toDays(rows);
  const engine = new TZEngine(isWeekly);
  const map = new Map<string, string>();
  for (let i = 1; i < days.length; i++) {
    const events = engine.process(days[i - 1], days[i]);
    if (events.length > 0) map.set(days[i].date, events.join(", "));
  }
  return map;
}
