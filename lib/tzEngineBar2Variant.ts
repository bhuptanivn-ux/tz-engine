// TypeScript port of tz_engine_wtf.py -- the TZ BUY engine (TZ ENGINE
// extended with TZ BUY 2 / BAR 2 / REAR 2 / REAR RE-ENTER 2). Ported
// faithfully, method-for-method, from the corrected Python source after an
// exhaustive one-topic-at-a-time rule review -- every condition, ordering,
// and judgment call matches the Python original. See WTF_RULEBOOK.md in
// the tz-engine repo for the full, consolidated rule set this implements.
//
// Every tier falls into one of two families:
//
// FAMILY 1 -- "escalating gate" (TZ BUY, TZ BUY 2, REAR, REAR 2, REAR
// RE-ENTER, REAR RE-ENTER 2): own SL is NEVER a dead end; own SL is
// DECISIVE (wipes everything structurally below it -- its own "2", the
// whole BAR family, RED1 in flight); reactivates/self-recovers above
// "whichever is higher" (`currentTopRef` -- the MAXIMUM current reference
// across every tier this buy holds state for, snapshotted before the
// wipe). This is a genuine max, not "defer to the deepest tier" -- a
// shallower tier's own reference can climb higher than whatever forms
// beneath it (only TZ BUY 2 has an HH-mute rule, and even that only
// suppresses display, never the underlying value), so either side can win
// depending on the actual numbers.
//
// FAMILY 2 -- "one-shot" (BAR, BAR 2): BAR's own SL with NO BAR 2 ever
// formed for that lineage is a genuine permanent dead end for that lineage
// (no INVALID BAR SL, no SL2, ever). BAR 2 itself never needs to "reform"
// -- once frozen at its own SL it just keeps quietly climbing as INVALID
// BAR HH. Regardless of dead-end status, a brand-new BAR(n+1) can always
// start elsewhere the moment the current newest lineage is no longer
// pre-SL.
//
// Real-data fix: a BAR SL with no BAR 2 used to leave bar_pending
// permanently unset-able, silencing the engine indefinitely once the
// newest lineage was a no-BAR-2 dead end. Fixed by letting a qualifying
// breakout ALONE start a fresh BAR whenever the newest lineage is no
// longer pre-SL -- see the fresh-BAR mechanism in evalBarLineagesProgress.
//
// NOT ported: `load_days_xlsx` / the CLI `main` entry point (Python-only
// file I/O; this site feeds it live-fetched OHLC directly) and the
// `extra_reentry_floor` DTF/WTF cross-theory hook (not implemented in the
// Python source this was ported from either -- deferred).

export const THRESH = 0.2;
export const ANY = 0.01;
export const EPS = 1e-9;

export interface Day {
  date: string;
  o: number;
  h: number;
  l: number;
  c: number;
}

function branchLabel(nIn: number): string {
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

class Red1 {
  active = true;
  constructor(public refHigh: number, public refLow: number) {}
}

// The "2" confirmation gate, reused identically at every tier: BAR 2
// (lineage.bar2), REAR 2 (rear.rear2), REAR RE-ENTER 2 (rre.rre2), TZ
// BUY 2 (buy.tzBuy2).
export class Bar2 {
  slActive = false;
  dormant = false; // REAR 2 / REAR RE-ENTER 2 only, and ONLY ever set when
  // the PARENT (Rear/RearReenter) is permanently retired (REAR's own SL
  // leading to REAR RE-ENTER) -- never when this tier's own dual-role BAR
  // cascade forms (that used to be a real bug -- see supersedeRearForNewBar).
  reentryThreshold: number | null = null; // "whichever is higher" across
  // every tier, snapshotted at the moment THIS tier's own SL fires (before
  // everything below it gets wiped) -- its own SL/recovery cycle climbs
  // back above THIS, not just its own frozen refHigh. Unused by BAR 2,
  // which never needs to reform once frozen at its own SL.
  constructor(public refHigh: number, public refLow: number) {}
}

class BarSL {
  sl2 = false;
  invalidated = false;
  constructor(public refHigh: number, public refLow: number) {}
}

class BarLineage {
  red1Since = false;
  refHighAtRed1 = 0;
  sl: BarSL | null = null;
  red2Ever = false;
  bar2: Bar2 | null = null;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

class RearSL {
  // "Whichever is higher" at the moment REAR's own SL fired -- REAR
  // RE-ENTER always forms above this (REAR's own SL is never a dead end,
  // regardless of whether REAR 2 ever formed).
  constructor(public refLow: number, public entryThreshold: number) {}
}

class Rear {
  red1Since = false;
  refHighAtRed1 = 0;
  sl: RearSL | null = null;
  dormant = false; // True once REAR's own SL leads to REAR RE-ENTER --
  // permanently retired from that point on. NOT set merely because REAR
  // 2's own dual-role BAR cascade formed (fixed bug -- see
  // supersedeRearForNewBar).
  red2Ever = false;
  rear2: Bar2 | null = null;
  constructor(public refHigh: number, public refLow: number) {}
}

class RearReenterSL {
  constructor(public refLow: number, public entryThreshold: number) {}
}

class RearReenter {
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
  tzBuy2: Bar2 | null = null; // one tier above BAR 2 -- same shape, same
  // independent SL/recovery, gates RED1/RED2 attaching to TZ BUY itself.
  // Does NOT persist through TZ BUY's own reactivation.
  tzBuy2HhMuted = false; // TZ BUY 2's own HH keeps showing only until some
  // deeper tier's own reference actually reaches or exceeds it -- a live
  // comparison, not a mere existence check (TZ BUY 2 isn't guaranteed
  // lower than what forms below it). Permanent and one-directional once
  // tripped; TZ BUY 2 itself keeps tracking internally regardless.
  barLineages: BarLineage[] = []; // ordered oldest-first
  barSubCounter = 0; // for allocating "A.1", "A.2", ... sub-labels
  barDeadLabels = new Set<number>(); // sub-numbers freed for reuse -- ONLY
  // by a generation that was a complete dead end (its own SL fired with no
  // BAR 2 ever having formed for it). A generation that DID get its own
  // BAR 2 keeps its number retired forever, even if later superseded.
  barPending = false; // RED2 fired; awaiting BAR's own entry-shape confirmation
  rear: Rear | null = null; // single persistent slot -- a fresh REAR/REAR
  rearReenter: RearReenter | null = null; // RE-ENTER formation always
  // wipes whichever older dormant one currently exists.
  barHighPool = 0;
  reentryThreshold: number | null = null; // "whichever is higher",
  // snapshotted the moment TZ BUY's own SL fires (before everything below
  // it gets wiped) -- TZ BUY reactivates above THIS, never just its own
  // frozen peak once something deeper had formed.
  constructor(public refHigh: number, public refLow: number) {}
}

export class ParentCycle {
  active = true;
  dormant = false;
  redEver = false;
  refHighAtRed = 0;
  buy: Buy | null = null;
  constructor(public id: number, public seq: number, public refHigh: number, public refLow: number) {}
}

// "TZ BUY 2(" is explicitly its own milestone -- unlike BAR 2/REAR 2/REAR
// RE-ENTER 2 (none of which trigger the leadership contest).
const MILESTONE_KEYS = ["TZ BUY(", "TZ BUY 2(", "BAR(", "REAR(", "REAR RE-ENTER("];

const SL_LL_KEYS = [
  "TZ GREEN SL(",
  "TZ GREEN LL(",
  "TZ BUY SL(",
  "TZ BUY LL(",
  "BAR LL(",
  "BAR SL(",
  "BAR SL LL(",
  "BAR SL2(",
  "REAR LL(",
  "REAR SL(",
  "REAR RE-ENTER LL(",
  "REAR RE-ENTER SL(",
];

function isMilestone(ev: string): boolean {
  return MILESTONE_KEYS.some((key) => ev.startsWith(key));
}

function isSlOrLl(ev: string): boolean {
  return SL_LL_KEYS.some((key) => ev.startsWith(key));
}

// Union of the four object kinds that can hold a "red1 regime"
// (red1Since/refHighAtRed1, or Buy's red1Ever/refHighAtRed1), used
// generically by evalRed1Generic / attachFreshRed1 / resetRed1Regime
// exactly like Python's duck-typed `stage_obj`.
type RedRegimeHolder = Buy | BarLineage | Rear | RearReenter;

function hasRed1Since(obj: RedRegimeHolder): obj is BarLineage | Rear | RearReenter {
  return "red1Since" in obj;
}

function hasRed2Ever(obj: RedRegimeHolder): obj is BarLineage | Rear | RearReenter {
  return "red2Ever" in obj;
}

export type TzBuyReentryRule = "topref" | "simple";

export class TZEngine {
  private branches = new Map<number, ParentCycle>();
  private seqCounter = 0;
  private preTodayLiveBuy = new Map<number, boolean>();

  // Which formula governs the reference TZ BUY must clear to reactivate
  // above once ITS OWN top-level SL fires:
  // - "topref" (default, matches the live site elsewhere): the maximum
  //   reference across every tier this buy currently holds state for
  //   (TZ BUY 2, the whole BAR family, REAR, REAR 2, REAR RE-ENTER...) --
  //   see currentTopRef.
  // - "simple": only TZ BUY's own frozen reference vs TZ BUY 2's, exactly
  //   the older `extra_reentry_floor`-era formula from
  //   tz_engine_bar2_variant.py's own _eval_buy (pre_today_buy_ref /
  //   pre_today_tzbuy2_ref) -- ignores BAR/REAR references entirely, even
  //   if one of them is numerically higher.
  // Every OTHER tier's own SL (TZ BUY 2, REAR, REAR 2, REAR RE-ENTER, REAR
  // RE-ENTER 2) always uses "topref" regardless of this setting -- the
  // older Python file's extra_reentry_floor hook only ever touched TZ
  // BUY's own reactivation, never any deeper tier's.
  constructor(private reentryRule: TzBuyReentryRule = "topref") {}

  // --- DTF/WTF screener support -------------------------------------
  // The DTF/WTF dual-timeframe layer (see lib/dtfWtfScreener.ts) anchors a
  // DAILY buy sequence directly off a WEEKLY engine's currently-governing
  // TZ BUY 2 reference, rather than via a normal TZ-GREEN-style breakout.
  // These three members exist only to support that: they don't change
  // anything about the single-timeframe engine used elsewhere on the site.

  /**
   * Reads this engine instance's (intended to be run on WEEKLY-resampled
   * data) currently-governing TZ BUY 2 reference -- the WTF anchor a DTF
   * sequence should clear to originate -- or null when no active branch
   * currently has a live, non-SL'd TZ BUY 2. When more than one branch
   * qualifies, the most recently spawned one (highest seq) wins -- the
   * same "tip" notion `process()` uses elsewhere.
   *
   * The screener's "Highest High" column does NOT read anything BAR-tier
   * specific from here -- it's simply the running max of WTF's own weekly
   * High price for as long as this returns non-null (see
   * lib/dtfWtfScreener.ts), so this only needs to report whether/what is
   * currently governing, not any deeper BAR-family state.
   */
  currentWtfAnchor(): { tzBuy2Ref: number } | null {
    let best: ParentCycle | null = null;
    for (const pc of this.branches.values()) {
      if (
        pc.active &&
        pc.buy !== null &&
        pc.buy.active &&
        pc.buy.tzBuy2 !== null &&
        !pc.buy.tzBuy2.slActive
      ) {
        if (best === null || pc.seq > best.seq) best = pc;
      }
    }
    if (best === null) return null;
    const buy = best.buy as Buy;
    return { tzBuy2Ref: buy.tzBuy2!.refHigh };
  }

  /**
   * Registers `pc` as this engine instance's ONLY branch, so the internal
   * cross-branch checks (milestoneBlocked, the "sole leader" pull-up in
   * process()) see just this one lineage. Used to drive a freshly-anchored
   * DTF buy sequence with the same validated per-tier logic (RED1/TZ BUY
   * 2/BAR/REAR/reactivation) as a normal TZ-GREEN-originated branch,
   * without going through process()'s own TZ-GREEN origination path.
   */
  seedSyntheticBranch(pc: ParentCycle): void {
    this.branches = new Map([[pc.id, pc]]);
  }

  /** Public wrapper so external callers can step a synthetic branch's buy day by day. */
  stepBuy(pc: ParentCycle, buy: Buy, prev: Day, cur: Day): string[] {
    return this.evalBuy(pc, buy, prev, cur);
  }

  private nextSeq(): number {
    this.seqCounter += 1;
    return this.seqCounter;
  }

  private lowestFreeId(): number {
    let n = 1;
    while (this.branches.has(n)) n += 1;
    return n;
  }

  private deepFailureReached(buy: Buy): boolean {
    if (buy.rear !== null && buy.rear.sl !== null) return true;
    if (buy.rearReenter !== null && buy.rearReenter.sl !== null) return true;
    for (const lin of buy.barLineages) {
      if (lin.sl !== null && lin.sl.sl2) return true;
    }
    return false;
  }

  private barLineagesRacing(buy: Buy): boolean {
    // A lineage whose own SL fired with no BAR 2 ever having formed is a
    // permanent dead end -- sl.sl2 can never become true for it, so
    // without this it would count as "still racing toward SL2" forever.
    return buy.barLineages.some((lin) => lin.sl === null || (lin.bar2 !== null && !lin.sl.sl2));
  }

  private buyCurrentlyLive(buy: Buy): boolean {
    if (!buy.active) return false;
    if (buy.rearReenter !== null) {
      if (buy.rearReenter.sl !== null) return false;
      if (!buy.rearReenter.dormant) {
        if (buy.barLineages.length > 0) return this.barLineagesRacing(buy);
        // Real-data bug (MAXESTATES.NS): once REAR RE-ENTER 2's own SL
        // fires with no fresh BAR cascade racing beneath it, nothing in
        // this buy is actually live any more -- but this branch was
        // unconditionally returning true just because REAR RE-ENTER
        // itself hadn't failed, permanently blocking every sibling's own
        // first TZ BUY from ever forming. REAR RE-ENTER 2's own SL
        // already opens spawn eligibility (tipRre2Sl) -- it must release
        // this gate too.
        return !(buy.rearReenter.rre2 !== null && buy.rearReenter.rre2.slActive);
      }
    } else if (buy.rear !== null) {
      if (buy.rear.sl !== null) return false;
      if (!buy.rear.dormant) {
        if (buy.barLineages.length > 0) return this.barLineagesRacing(buy);
        // Same fix, one tier up: REAR 2's own SL (tipRear2Sl) must also
        // release this gate once nothing is racing beneath it.
        return !(buy.rear.rear2 !== null && buy.rear.rear2.slActive);
      }
    }
    if (buy.barLineages.length > 0) {
      return this.barLineagesRacing(buy);
    }
    // Real-data bug (MAXESTATES.NS): a plain buy whose own TZ BUY 2 has
    // SL'd, with no BAR family or REAR ever having formed, was falling
    // through to an unconditional true -- this buy has fully collapsed
    // (TZ BUY 2's own SL already opens spawn eligibility, tipTzbuy2Sl,
    // exactly like TZ BUY's own SL) but kept reporting itself as
    // "currently live" forever, permanently blocking every OTHER branch's
    // own redEver from ever escalating into its first TZ BUY -- confirmed
    // real trace: branch B's RED(B) fired cleanly but TZ BUY(B) never got
    // a chance to form for months, because a long-dead branch A's own TZ
    // BUY 2 SL (with nothing else ever having formed for it) was silently
    // holding this gate shut the entire time.
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

  private rearAncestorTerminated(buy: Buy): boolean {
    const target = buy.rearReenter !== null ? buy.rearReenter : buy.rear;
    return target !== null && target.sl !== null;
  }

  // "Whichever is higher": the MAXIMUM current reference across every tier
  // this buy currently holds state for. Used whenever a tier's own SL
  // wipes everything below it and needs a reactivation threshold that
  // isn't just its own frozen peak (TZ BUY's own SL, TZ BUY 2's own SL,
  // REAR's own SL -> REAR RE-ENTER, REAR 2's own SL, REAR RE-ENTER's own
  // self-recovery, REAR RE-ENTER 2's own SL).
  //
  // NOT simply "defer to the deepest/most-recent tier" -- a shallower
  // tier's own reference can keep climbing independently of whatever forms
  // beneath it (only TZ BUY 2 has an explicit HH-mute rule, and even that
  // only suppresses DISPLAY, never the underlying value tracking), so it
  // can end up numerically HIGHER than a deeper tier's reference despite
  // being structurally earlier.
  private currentTopRef(buy: Buy): number {
    const refs: number[] = [buy.refHigh];
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

  // Reuses the lowest freed dead-end number if one is available, else
  // allocates the next never-used number.
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

  process(prev: Day, cur: Day): string[] {
    const perBranchEvents = new Map<number, string[]>();
    const milestoneAchievers: [ParentCycle, boolean][] = [];
    const greenSlSeqs: number[] = [];

    const anyLiveBuy = Array.from(this.branches.values()).some(
      (pc) => pc.active && pc.buy !== null && this.buyCurrentlyLive(pc.buy)
    );

    this.preTodayLiveBuy = new Map(
      Array.from(this.branches.entries()).map(([pid, pc]) => [
        pid,
        pc.buy !== null && this.buyCurrentlyLive(pc.buy),
      ])
    );

    if (!anyLiveBuy) {
      for (const pc of this.branches.values()) {
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
          // "TZ BUY(" reactivating in place uses the SAME event text as
          // first formation (no "NEW TZ BUY" distinction) -- but for the
          // purposes of THIS termination-vs-exemption check, a
          // reactivation must be treated as a *continuation* milestone,
          // not a fresh one, or it would unconditionally terminate a
          // newer sibling's currently-live, ongoing buy outright instead
          // of merely dormanting it. `buyWasNone` (captured BEFORE this
          // candle's own evalParent/evalBuy call) distinguishes a genuine
          // first-ever formation (buy didn't exist a moment ago) from an
          // in-place reactivation (buy object already existed, just
          // inactive) -- only the former is "fresh" enough to
          // unconditionally terminate. "TZ BUY 2(" never matches this
          // prefix at all (space before the digit), so it was already
          // exempt regardless.
          const isFreshBuy = e.startsWith("TZ BUY(") && buyWasNone;
          milestoneAchievers.push([pc, isFreshBuy]);
        }
      }
    }

    const activeBranches = Array.from(this.branches.values()).filter((pc) => pc.active);
    const tip =
      activeBranches.length > 0
        ? activeBranches.reduce((a, b) => (b.seq > a.seq ? b : a))
        : null;
    const tipDeepFailure =
      tip !== null && tip.buy !== null && this.deepFailureReached(tip.buy) && !this.buyCurrentlyLive(tip.buy);
    // TZ BUY 2's own SL ALSO opens spawn eligibility, same as TZ BUY's own
    // SL. Lifts the moment TZ BUY 2 recovers (slActive back to false),
    // same live-check style as `!tip.buy.active` above, not a historical
    // flag.
    const tipTzBuy2Sl =
      tip !== null && tip.buy !== null && tip.buy.tzBuy2 !== null && tip.buy.tzBuy2.slActive;
    // REAR 2's own SL and REAR RE-ENTER 2's own SL ALSO open spawn
    // eligibility, same principle one/two tiers down.
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
      (tip.buy === null || !tip.buy.active || tipDeepFailure || tipTzBuy2Sl || tipRear2Sl || tipRre2Sl);
    const canSpawn = eligibleAnchor || tip === null;
    let newBranchId: number | null = null;
    if (
      canSpawn &&
      cur.l >= prev.l &&
      cur.h > prev.h &&
      cur.h - prev.h >= THRESH - EPS &&
      cur.c >= prev.h
    ) {
      const nid = this.lowestFreeId();
      const newPc = new ParentCycle(nid, this.nextSeq(), cur.h, cur.l);
      this.branches.set(nid, newPc);
      perBranchEvents.set(nid, [`TZ GREEN(${branchLabel(nid)})`]);
      newBranchId = nid;
    }

    for (const seq of greenSlSeqs) {
      for (const [, other] of this.branches) {
        if (other.active && other.seq > seq) {
          other.active = false;
        }
      }
    }

    const collaterallyTerminated = new Set<number>();
    const exemptionBlockedPids = new Set<number>();
    for (const [pc, isFreshBuy] of milestoneAchievers) {
      if (!pc.active) continue;
      let blockedThisAchiever = false;
      for (const [oid, other] of Array.from(this.branches.entries())) {
        if (other === pc || !other.active) continue;
        if (other.seq < pc.seq) {
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
      if (blockedThisAchiever) {
        exemptionBlockedPids.add(pc.id);
      }
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
        // A dormant sibling's OWN frozen top-level reactivation threshold
        // (buy.reentryThreshold, set once when ITS OWN TZ BUY SL fired)
        // must keep getting pulled up to at least match the sole leader's
        // own current top reference, for as long as it stays dormant --
        // otherwise a comparatively small bounce could clear this
        // sibling's OLD, much lower frozen threshold and reactivate it
        // even while the leader is still very much alive and racing far
        // above that level. Only ever raises the threshold (never lowers
        // it) and only while this sibling's own buy is genuinely inactive
        // (sitting on that frozen value) -- a still-active dormant buy
        // already tracks every candle's real price action on its own.
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
      const pcNow = this.branches.get(pid) ?? null;
      if (collaterallyTerminated.has(pid)) continue;
      if (pcNow !== null && pcNow.dormant && pid !== newBranchId) {
        if (exemptionBlockedPids.has(pid)) continue;
        visible.push(...events.filter((e) => isMilestone(e) || isSlOrLl(e)));
        if (events.some((e) => isMilestone(e))) {
          pcNow.dormant = false;
        }
      } else {
        visible.push(...events);
      }
    }

    this.branches = new Map(Array.from(this.branches.entries()).filter(([, pc]) => pc.active));
    return visible;
  }

  private evalParent(pc: ParentCycle, prev: Day, cur: Day, anyLiveBuy: boolean): string[] {
    const ev: string[] = [];

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
      if (cur.h > pc.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < pc.refHighAtRed)) {
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

    // Both TZ GREEN's own HH and LL are only shown while no buy is
    // currently live for this branch.
    if (hh && !hasLiveBuy && !isSl) {
      ev.push(`TZ GREEN HH(${branchLabel(pc.id)})`);
    }
    if (ll && !hasLiveBuy) {
      ev.push(`TZ GREEN LL(${branchLabel(pc.id)})`);
    }

    if (isSl) {
      ev.push(`TZ GREEN SL(${branchLabel(pc.id)})`);
      pc.active = false;
      return ev;
    }

    if (!pc.redEver) {
      if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
        pc.redEver = true;
        pc.refHighAtRed = pc.refHigh;
        ev.push(`RED(${branchLabel(pc.id)})`);
      }
    }

    // This only ever handles the very FIRST TZ BUY this branch ever forms.
    // Once pc.buy exists, every subsequent reactivation (after TZ BUY's
    // own SL) happens IN PLACE inside evalBuy -- there is no "create a
    // brand-new Buy object" path and no "NEW TZ BUY" label.
    if (pc.redEver && pc.buy === null && !anyLiveBuy) {
      const refHigh = Math.max(pc.refHigh, pc.refHighAtRed);
      if (cur.l >= prev.l && cur.h > refHigh && cur.h - refHigh >= THRESH - EPS && cur.c >= refHigh) {
        pc.buy = new Buy(cur.h, cur.l);
        ev.push(`TZ BUY(${branchLabel(pc.id)})`);
      }
    }

    if (pc.buy !== null) {
      ev.push(...this.evalBuy(pc, pc.buy, prev, cur));
    }

    return ev;
  }

  private evalBuy(pc: ParentCycle, buy: Buy, prev: Day, cur: Day): string[] {
    let ev: string[] = [];
    const label = "TZ BUY";
    const slLabel = "TZ BUY SL";

    const hasDeeperActive =
      buy.barLineages.length > 0 || buy.barPending || buy.rear !== null || buy.rearReenter !== null;
    const noBarYet = !hasDeeperActive;
    const red1PreexistingAtBuyLevel = buy.active && noBarYet && buy.red1 !== null && buy.red1.active;
    // Snapshotted BEFORE today's own tracking below (or evalTzbuy2's own
    // forever-climbing branch, called later this same candle) can mutate
    // it.
    const preTodayBuyRef = buy.refHigh;
    const preTodayTzBuy2Ref = buy.tzBuy2 !== null ? buy.tzBuy2.refHigh : null;

    let reactivatedToday = false;
    if (buy.active) {
      if (buy.barHighPool > buy.refHigh) {
        buy.refHigh = buy.barHighPool;
      }
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
            if (cur.h > buy.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < buy.refHighAtRed1)) {
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

      // TZ BUY's own HH permanently suppressed from display once TZ BUY 2
      // exists -- value keeps updating internally regardless. LL is never
      // suppressed.
      if (hh && buy.tzBuy2 === null) {
        ev.push(`${label} HH(${branchLabel(pc.id)})`);
      }
      if (ll) {
        ev.push(`${label} LL(${branchLabel(pc.id)})`);
      }

      if (isSl) {
        ev.push(`${slLabel}(${branchLabel(pc.id)})`);
        // TZ BUY's own SL is DECISIVE -- it wipes out everything below it
        // (TZ BUY 2, the whole BAR family, REAR/REAR RE-ENTER, if any of
        // that had formed), regardless of any RED1/RED2 already in flight
        // down there. Snapshot the reactivation reference BEFORE wiping --
        // that's what TZ BUY reactivates above, not just its own frozen
        // peak once something deeper had formed.
        buy.reentryThreshold =
          this.reentryRule === "topref"
            ? this.currentTopRef(buy)
            : Math.max(preTodayBuyRef, preTodayTzBuy2Ref ?? -Infinity);
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
      // TZ BUY's own SL has no escalation and never leads to REAR by
      // itself (REAR stays reachable exclusively via BAR SL2) -- it just
      // reactivates directly, always under the SAME "TZ BUY" label,
      // retrying above "whichever is higher" as it stood at the moment the
      // SL fired (buy.reentryThreshold).
      //
      // Real-data bug (BBOX.NS): a long-dead branch's own reentry
      // threshold gets pulled up every week to match the sole live
      // leader's climbing top ref, which means it clears "cur.h > ref"
      // the INSTANT the leader makes any new high at all -- reactivating
      // this branch's buy in place (active=true, refLow reset to
      // whatever THIS week's low happens to be) while it's still supposed
      // to stay fully hidden behind that live leader. That stray,
      // arbitrary refLow then let this hidden branch's own SL condition
      // fire later completely disconnected from anything happening in the
      // actually-live cycle (confirmed bug: "TZ BUY SL(A)" surfacing out
      // of nowhere while sibling C's cycle was still fully alive). Blocked
      // here exactly like a milestone event -- milestoneBlocked already
      // answers "is some higher-seq sibling currently live," using the
      // same pre-today snapshot -- so a hidden branch's own TZ BUY stays
      // inert (no active flip, no refLow reset) the whole time it's
      // hidden; only its reference HIGH keeps climbing via the existing
      // propagation block. Real reactivation becomes possible again only
      // once the leader's own cycle actually fails.
      const ref = buy.reentryThreshold !== null ? buy.reentryThreshold : preTodayBuyRef;
      if (!this.milestoneBlocked(pc) && cur.l >= prev.l && cur.h > ref &&
          cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        buy.active = true;
        buy.refHigh = cur.h;
        buy.refLow = cur.l;
        buy.red1Ever = false;
        buy.red1 = null;
        // TZ BUY 2 does NOT persist through TZ BUY's own reactivation -- a
        // fresh one has to form from scratch.
        buy.tzBuy2 = null;
        buy.tzBuy2HhMuted = false;
        buy.reentryThreshold = null;
        ev.push(`${label}(${branchLabel(pc.id)})`);
        reactivatedToday = true;
      }
    }

    // Forms off TZ BUY's own reference, tracks/recovers independently for
    // as long as buy.active stays true. Skipped on the exact day TZ BUY
    // itself just reactivated -- preTodayBuyRef is stale and a fresh TZ
    // BUY 2 needs tomorrow's candle at the earliest.
    if (!reactivatedToday) {
      ev.push(...this.evalTzbuy2(pc, buy, prev, cur, preTodayBuyRef));
    }

    // Pre-today snapshots, taken BEFORE any of today's own tracking below
    // can mutate the values they need to compare against.
    const preTodayLinRef = new Map(buy.barLineages.map((lin) => [lin.label, lin.refHigh]));
    const preTodayBar2Ref = new Map(
      buy.barLineages.map((lin) => [lin.label, lin.bar2 !== null ? lin.bar2.refHigh : null])
    );
    const preTodayRearRef = buy.rear !== null ? buy.rear.refHigh : null;
    const preTodayRreRef = buy.rearReenter !== null ? buy.rearReenter.refHigh : null;

    // BAR's own HH keeps tracking/showing for as long as it's the NEWEST
    // lineage in the chain. LL only tracks/shows while a lineage is still
    // pre-SL.
    const newestLin = buy.barLineages.length > 0 ? buy.barLineages[buy.barLineages.length - 1] : null;
    if (newestLin !== null && !this.barHhSuppressedToday(buy, newestLin, prev, cur)) {
      const linHhEv = this.evalBarLineageHh(pc, buy, newestLin, prev, cur);
      // BAR's own HH is permanently suppressed from display once this
      // lineage has its own BAR 2. BAR's own LL is NEVER suppressed.
      if (newestLin.bar2 === null) {
        ev.push(...linHhEv);
      } else {
        ev.push(...linHhEv.filter((e) => e.startsWith("BAR LL(")));
      }
    }

    // Formation check + forever-ungoverned HH/LL/SL tracking for EVERY
    // lineage currently in buy.barLineages -- not scoped to newestLin,
    // since an older lineage keeps racing in parallel until the newest
    // one's own BAR 2 confirms (see below), and BAR 2 keeps tracking even
    // after its own lineage's BAR SL2 has fired.
    const bar2EvByLabel = new Map<string, string[]>();
    for (const lin of buy.barLineages) {
      bar2EvByLabel.set(lin.label, this.evalBar2(pc, buy, lin, prev, cur, preTodayLinRef.get(lin.label) ?? null));
    }

    // Once a new BAR 2 is confirmed, the earlier BAR becomes irrelevant --
    // REAR's eventual reference is now governed by the newest lineage's
    // own BAR 2 regardless of what its own SL/SL2 does later. This only
    // cuts short an OLDER lineage still sitting pre-SL and merely racing
    // in parallel while the newer generation's own BAR 2 had not yet
    // confirmed -- it does NOT apply once that older lineage has ALREADY
    // reached its own BAR SL2 (a lineage that's post-SL2 races toward REAR
    // independently via its own INVALID BAR HH tracking).
    if (newestLin !== null && newestLin.bar2 !== null) {
      const surviving = buy.barLineages.filter((l) => l === newestLin || l.sl !== null);
      buy.barLineages = surviving;
      for (const linSurvivor of surviving) {
        ev.push(...(bar2EvByLabel.get(linSurvivor.label) ?? []));
      }
    } else {
      for (const linEv of bar2EvByLabel.values()) {
        ev.push(...linEv);
      }
    }

    // REAR's own HH/LL only track/show while REAR hasn't hit its own SL
    // yet. Dormancy only silences ADVANCEMENT tracking (HH), not LL.
    if (buy.rear !== null) {
      if (buy.rear.sl === null) {
        let rearEv = this.evalRearHhLl(pc, buy, buy.rear, prev, cur);
        if (buy.rear.dormant) {
          rearEv = rearEv.filter((e) => e.includes("LL("));
        }
        // REAR's own HH permanently suppressed once REAR 2 exists.
        if (buy.rear.rear2 !== null) {
          rearEv = rearEv.filter((e) => !e.startsWith("REAR HH("));
        }
        ev.push(...rearEv);
      }
      ev.push(...this.evalRear2(pc, buy, buy.rear, prev, cur, preTodayRearRef));
    }

    // Same rule for REAR RE-ENTER.
    if (buy.rearReenter !== null) {
      if (buy.rearReenter.sl === null) {
        let rreEv = this.evalRearReenterHhLl(pc, buy, buy.rearReenter, prev, cur);
        if (buy.rearReenter.dormant) {
          rreEv = rreEv.filter((e) => e.includes("LL("));
        }
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
      // REAR RE-ENTER's own SL is NEVER a dead end (unlike BAR) -- it
      // always self-recovers above "whichever is higher" as snapshotted
      // when the SL fired (sl.entryThreshold), regardless of whether REAR
      // RE-ENTER 2 ever formed.
      ev.push(...this.evalRearReenterSlProgress(pc, buy, buy.rearReenter, buy.rearReenter.sl, prev, cur));
    } else if (buy.rearReenter === null && buy.rear !== null && buy.rear.sl !== null) {
      // REAR's own SL is NEVER a dead end either -- always leads to REAR
      // RE-ENTER above "whichever is higher" (sl.entryThreshold),
      // regardless of whether REAR 2 ever formed. Follows TZ BUY's own
      // "never a dead end" pattern, not BAR's.
      ev.push(...this.evalRearSlProgress(pc, buy, buy.rear, buy.rear.sl, prev, cur));
    } else if (barConfirmsToday) {
      ev = ev.filter((e) => !(e.startsWith("REAR HH(") || e.startsWith("REAR RE-ENTER HH(")));
      ev.push(...this.checkBarPending(pc, buy, prev, cur, false));
    } else if (buy.rearReenter !== null && !buy.rearReenter.dormant) {
      ev.push(...this.evalRearReenterProgress(pc, buy, buy.rearReenter, prev, cur));
    } else if (buy.rearReenter === null && buy.rear !== null && !buy.rear.dormant) {
      ev.push(...this.evalRearProgress(pc, buy, buy.rear, prev, cur));
    } else if (buy.barLineages.length > 0) {
      ev.push(...this.evalBarLineagesProgress(pc, buy, prev, cur, preTodayBar2Ref));
    } else if (buy.barPending && buy.active) {
      ev.push(...this.checkBarPending(pc, buy, prev, cur, true));
    } else if (!buy.active) {
      // no-op
    } else if (!(buy.red1 !== null && buy.red1.active)) {
      // Rechecked fresh here rather than reusing red1PreexistingAtBuyLevel
      // (an entry-time snapshot) -- TZ BUY 2's own SL can fire earlier in
      // THIS SAME call (inside evalTzbuy2, called above) and null out
      // buy.red1 without touching buy.active, which the stale snapshot
      // would miss entirely, reaching the branch below with a red1 object
      // that no longer exists and crashing.
      //
      // TZ BUY 2 gate: mirrors BAR 2 gating RED1 on a BAR lineage -- a
      // fresh RED1 cannot attach to TZ BUY unless TZ BUY 2 is currently
      // ACTIVE, not merely "has existed once" -- TZ BUY 2's own SL closes
      // this gate again, requiring TZ BUY 2 to reform before RED1/RED2 can
      // reattach.
      if (
        buy.tzBuy2 !== null &&
        !buy.tzBuy2.slActive &&
        cur.h <= prev.h &&
        cur.l < prev.l &&
        prev.l - cur.l >= THRESH - EPS &&
        cur.c <= prev.l
      ) {
        if (!buy.red1Ever) {
          buy.refHighAtRed1 = buy.refHigh;
        }
        buy.red1Ever = true;
        buy.red1 = new Red1(cur.h, cur.l);
        ev.push(`RED1(${branchLabel(pc.id)})`);
      }
    } else {
      ev.push(...this.evalRed1Generic(pc, buy, buy, prev, cur));
    }

    // REAR's (and REAR RE-ENTER's) own SL must still be checked and take
    // effect even while dormant -- same decisive treatment as the main
    // path (wipes everything below, snapshots "whichever is higher" first).
    if (buy.rearReenter !== null && buy.rearReenter.dormant && buy.rearReenter.sl === null) {
      const rre = buy.rearReenter;
      if (cur.l < rre.refLow && rre.refLow - cur.l >= THRESH - EPS && cur.c <= rre.refLow + EPS) {
        ev.push(`REAR RE-ENTER SL(${branchLabel(pc.id)})`);
        rre.sl = new RearReenterSL(cur.l, this.currentTopRef(buy));
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
        ev.push(`REAR SL(${branchLabel(pc.id)})`);
        rear.sl = new RearSL(cur.l, this.currentTopRef(buy));
        rear.rear2 = null;
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barDeadLabels = new Set();
        buy.red1 = null;
        buy.barPending = false;
      }
    }

    // TZ BUY 2's own HH keeps showing only until some deeper tier's own
    // reference actually reaches or exceeds it -- unlike BAR's HH being
    // suppressed by BAR 2's mere existence (guaranteed ordered by
    // construction), TZ BUY 2 isn't guaranteed lower than BAR 2/REAR/REAR
    // 2 since it may have been climbing long before any of those ever
    // formed. Checked here using CURRENT (post-today) values, so the
    // cutover is retroactive same-day. Permanent once tripped.
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

    // Retroactive same-day suppression pass -- both parts confirmed
    // necessary because HH/LL/SL-tier functions above run BEFORE the
    // checks that would otherwise need to suppress them:
    //
    // (1) An underlying SL beats its own "2" tier's SL/LL the same day.
    const slLabels = new Set<string>();
    for (const e of ev) {
      if (
        e.startsWith("TZ BUY SL(") ||
        e.startsWith("BAR SL(") ||
        e.startsWith("REAR SL(") ||
        e.startsWith("REAR RE-ENTER SL(")
      ) {
        slLabels.add(e.slice(e.indexOf("(") + 1, -1));
      }
    }
    if (slLabels.size > 0) {
      // Port bug (found via real data, PAYTM.NS): this list wrongly
      // included "TZ BUY HH(" -- Python's own equivalent list never has
      // it, only "BAR HH(" one tier down. That extra entry silently
      // dropped a legitimate "TZ BUY HH(A) + TZ BUY SL(A)" same-candle
      // pair down to just the SL, diverging from Python's own output.
      ev = ev.filter((e) => {
        const matchesSuppressible =
          e.startsWith("TZ BUY 2 SL(") ||
          e.startsWith("TZ BUY 2 LL(") ||
          e.startsWith("BAR HH(") ||
          e.startsWith("BAR 2 SL(") ||
          e.startsWith("BAR 2 LL(") ||
          e.startsWith("REAR 2 SL(") ||
          e.startsWith("REAR 2 LL(") ||
          e.startsWith("REAR RE-ENTER 2 SL(") ||
          e.startsWith("REAR RE-ENTER 2 LL(");
        return !(matchesSuppressible && slLabels.has(e.slice(e.indexOf("(") + 1, -1)));
      });
    }

    // (2) Once a "2" produces ANY event (formation included) on a given
    // label, that SAME label's own underlying HH is suppressed THAT SAME
    // DAY too, not just from the following day.
    const twoLabels: Record<string, Set<string>> = {
      "TZ BUY HH(": new Set(),
      "BAR HH(": new Set(),
      "REAR HH(": new Set(),
      "REAR RE-ENTER HH(": new Set(),
    };
    const prefixMap: [string, string][] = [
      ["TZ BUY 2(", "TZ BUY HH("],
      ["TZ BUY 2 ", "TZ BUY HH("],
      ["BAR 2(", "BAR HH("],
      ["BAR 2 ", "BAR HH("],
      ["REAR RE-ENTER 2(", "REAR RE-ENTER HH("],
      ["REAR RE-ENTER 2 ", "REAR RE-ENTER HH("],
      ["REAR 2(", "REAR HH("],
      ["REAR 2 ", "REAR HH("],
    ];
    for (const e of ev) {
      for (const [prefix, underlying] of prefixMap) {
        if (e.startsWith(prefix)) {
          const lbl = e.slice(e.indexOf("(") + 1, -1);
          twoLabels[underlying].add(lbl);
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

  private evalRed1Generic(pc: ParentCycle, buy: Buy, stageObj: RedRegimeHolder, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    const red1 = buy.red1 as Red1;
    if (cur.h >= red1.refHigh && cur.h - red1.refHigh >= THRESH - EPS && cur.c >= red1.refHigh) {
      ev.push(`INVALID RED1(${branchLabel(pc.id)})`);
      red1.active = false;
      this.resetRed1Regime(stageObj);
      return ev;
    }

    if (cur.h > red1.refHigh && cur.h - red1.refHigh >= ANY) {
      red1.refHigh = cur.h;
      ev.push(`RED1 HH(${branchLabel(pc.id)})`);
    }

    if (cur.l < red1.refLow) {
      const red2Holds = cur.h <= prev.h && red1.refLow - cur.l >= THRESH - EPS && cur.c <= red1.refLow + EPS;
      if (red2Holds) {
        red1.active = false;
        ev.push(`RED2(${branchLabel(pc.id)})`);
        if (hasRed2Ever(stageObj)) {
          stageObj.red2Ever = true;
        }
        this.clearForNewBarGeneration(buy);
      } else {
        red1.refLow = cur.l;
        ev.push(`RED1 LL(${branchLabel(pc.id)})`);
      }
    }

    return ev;
  }

  private attachFreshRed1(
    pc: ParentCycle,
    buy: Buy,
    stageObj: BarLineage | Rear | RearReenter,
    prev: Day,
    cur: Day
  ): string[] {
    const ev: string[] = [];
    if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
      if (!stageObj.red1Since) {
        stageObj.refHighAtRed1 = stageObj.refHigh;
      }
      stageObj.red1Since = true;
      buy.red1 = new Red1(cur.h, cur.l);
      ev.push(`RED1(${branchLabel(pc.id)})`);
    }
    return ev;
  }

  private resetRed1Regime(stageObj: RedRegimeHolder): void {
    if (hasRed1Since(stageObj)) {
      stageObj.red1Since = false;
    } else {
      (stageObj as Buy).red1Ever = false;
    }
  }

  private red1InvalidatesToday(buy: Buy, cur: Day): boolean {
    const red1 = buy.red1;
    if (red1 === null || !red1.active) return false;
    return cur.h >= red1.refHigh && cur.h - red1.refHigh >= THRESH - EPS && cur.c >= red1.refHigh;
  }

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
    if (buy.rearReenter !== null && buy.rearReenter.sl === null && !buy.rearReenter.dormant) {
      buy.rearReenter.dormant = true;
      if (buy.rearReenter.rre2 !== null) {
        buy.rearReenter.rre2.dormant = true;
      }
    } else if (buy.rear !== null && buy.rear.sl === null && !buy.rear.dormant) {
      buy.rear.dormant = true;
      if (buy.rear.rear2 !== null) {
        buy.rear.rear2.dormant = true;
      }
    }
  }

  private checkBarPending(pc: ParentCycle, buy: Buy, prev: Day, cur: Day, supersedeRear: boolean): string[] {
    if (cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h) {
      const subLabel = this.nextBarLabel(buy, branchLabel(pc.id));
      buy.barLineages.push(new BarLineage(subLabel, cur.h, cur.l));
      buy.barPending = false;
      buy.barHighPool = Math.max(buy.barHighPool, cur.h);
      // Only supersede (mark dormant) a genuinely OLD, leftover REAR/REAR
      // RE-ENTER ancestor -- NEVER the current REAR/REAR RE-ENTER whose
      // own "2" just spawned THIS bar as its own dual-role cascade
      // (supersedeRear=false from that call site). Marking the CURRENT
      // one dormant was a real bug: once dormant, evalRear2/evalRre2
      // return immediately and its own SL could never be checked again,
      // even though it must stay reachable (a single candle can trigger
      // BAR 2 SL + REAR 2 SL together after this exact cascade).
      if (supersedeRear) {
        this.supersedeRearForNewBar(buy);
      }
      return [`BAR(${subLabel})`];
    }
    return [];
  }

  // =================== BAR family (multi-lineage) ===================
  private evalBarLineageHh(pc: ParentCycle, buy: Buy, lin: BarLineage, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    if (!lin.red1Since || this.red1InvalidatesToday(buy, cur)) {
      if (cur.h > lin.refHigh && cur.h - lin.refHigh >= ANY) {
        lin.refHigh = cur.h;
        buy.barHighPool = Math.max(buy.barHighPool, lin.refHigh);
        ev.push(`BAR HH(${lin.label})`);
      }
    } else {
      const diff = cur.h - lin.refHigh;
      if (cur.h > lin.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < lin.refHighAtRed1)) {
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

  // ------------------- TZ BUY 2 / BAR 2 / REAR 2 / REAR RE-ENTER 2 --------
  // Mirrors evalBar2 one tier up: forms off TZ BUY's own reference high,
  // only while TZ BUY itself is pre-SL. Gates RED1/RED2 on TZ BUY. Has its
  // own independent SL/recovery cycle -- no escalation. UNLIKE BAR 2, TZ
  // BUY's own top-level SL is never a dead end regardless of TZ BUY 2.
  private evalTzbuy2(pc: ParentCycle, buy: Buy, prev: Day, cur: Day, preTodayBuyRef: number | null): string[] {
    const ev: string[] = [];
    const labelId = branchLabel(pc.id);
    if (buy.tzBuy2 === null) {
      if (buy.active) {
        const ref = preTodayBuyRef !== null ? preTodayBuyRef : buy.refHigh;
        if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
          buy.tzBuy2 = new Bar2(cur.h, cur.l);
          ev.push(`TZ BUY 2(${labelId})`);
        }
      }
      return ev;
    }
    if (!buy.active) {
      if (cur.h > buy.tzBuy2.refHigh && cur.h - buy.tzBuy2.refHigh >= ANY) {
        buy.tzBuy2.refHigh = cur.h;
        ev.push(`INVALID TZ BUY 2 HH(${labelId})`);
      }
      return ev;
    }
    const b2 = buy.tzBuy2;
    if (b2.slActive) {
      // Recovers above "whichever is higher" as it stood at the moment
      // THIS SL fired (b2.reentryThreshold), not just its own frozen
      // refHigh -- everything below it was already wiped when the SL
      // fired, so this is the only place that reference is still
      // remembered.
      const ref = b2.reentryThreshold !== null ? b2.reentryThreshold : b2.refHigh;
      if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        b2.refHigh = cur.h;
        b2.refLow = cur.l;
        b2.slActive = false;
        b2.reentryThreshold = null;
        ev.push(`TZ BUY 2(${labelId})`);
      } else if (cur.h > ref && cur.h - ref >= ANY) {
        // Real-data bug (PAYTM.NS): a new high that doesn't (yet) fully
        // confirm recovery -- clears the old level but closes back below
        // it -- was simply ignored, leaving the STALE pre-SL peak as the
        // recovery bar forever. That let a LATER, lower high wrongly
        // confirm "recovered" against a level price had already cleared
        // and abandoned weeks earlier. Matches INVALID BAR HH exactly:
        // any new high while SL'd quietly becomes the new bar TZ BUY 2
        // must clear, same ANY threshold, no recovery event yet. Raises
        // refHigh too (not just reentryThreshold) so currentTopRef sees
        // this climbed level live if TZ BUY's own SL fires later and
        // needs "whichever is higher" across every tier.
        b2.refHigh = cur.h;
        b2.reentryThreshold = cur.h;
        ev.push(`INVALID TZ BUY 2 HH(${labelId})`);
      }
      return ev;
    }
    if (cur.l < b2.refLow) {
      const gap = b2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= b2.refLow + EPS) {
        // TZ BUY 2's own SL is ALSO decisive -- wipes out everything below
        // it (the whole BAR family, REAR/REAR RE-ENTER), same as TZ BUY's
        // own SL does one tier up. Snapshot "whichever is higher" BEFORE
        // wiping.
        b2.reentryThreshold = this.currentTopRef(buy);
        b2.slActive = true;
        ev.push(`TZ BUY 2 SL(${labelId})`);
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
      ev.push(`TZ BUY 2 LL(${labelId})`);
    }
    if (cur.h > b2.refHigh && cur.h - b2.refHigh >= ANY) {
      b2.refHigh = cur.h;
      ev.push(`TZ BUY 2 HH(${labelId})`);
    }
    return ev;
  }

  // Forms off lin's own reference high, only while lin itself is pre-SL.
  // Gates RED1/RED2 on lin, and gates BAR SL2 being reachable at all. Has
  // its own independent SL/recovery cycle -- no escalation. Frozen (no
  // independent recovery) once lin's own SL fires, but keeps quietly
  // climbing as INVALID BAR HH.
  private evalBar2(
    pc: ParentCycle,
    buy: Buy,
    lin: BarLineage,
    prev: Day,
    cur: Day,
    preTodayLinRef: number | null
  ): string[] {
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
      if (cur.h > lin.bar2.refHigh && cur.h - lin.bar2.refHigh >= ANY) {
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

  // Mirrors evalBar2 one level up. rear.rear2.dormant is ONLY ever set
  // when REAR itself is permanently retired (REAR's own SL leading to
  // REAR RE-ENTER) -- NOT when REAR 2's own dual-role BAR cascade forms.
  // So by the time rear.rear2.dormant is true here, rear.sl is already
  // set too, and this method's own SL branch below is naturally moot.
  private evalRear2(
    pc: ParentCycle,
    buy: Buy,
    rear: Rear,
    prev: Day,
    cur: Day,
    preTodayRearRef: number | null
  ): string[] {
    const ev: string[] = [];
    if (rear.rear2 === null) {
      if (rear.sl === null) {
        const ref = preTodayRearRef !== null ? preTodayRearRef : rear.refHigh;
        if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
          rear.rear2 = new Bar2(cur.h, cur.l);
          ev.push(`REAR 2(${branchLabel(pc.id)})`);
        }
      }
      return ev;
    }
    if (rear.rear2.dormant) return ev;
    if (rear.sl !== null) {
      if (cur.h > rear.rear2.refHigh && cur.h - rear.rear2.refHigh >= ANY) {
        rear.rear2.refHigh = cur.h;
        ev.push(`INVALID REAR HH(${branchLabel(pc.id)})`);
      }
      return ev;
    }
    const r2 = rear.rear2;
    if (r2.slActive) {
      // Recovers above "whichever is higher" as it stood at the moment
      // THIS SL fired (r2.reentryThreshold), not just its own frozen
      // refHigh -- mirrors TZ BUY 2's own recovery exactly. In practice
      // REAR 2's own ref rarely if ever trails BAR 2's (REAR 2 tracks
      // every candle unconditionally, with a weaker threshold than BAR 2
      // needs to even form), but the explicit snapshot keeps this tier
      // consistent with the rest of the Family-1 pattern rather than
      // relying on that as an unstated assumption.
      const ref = r2.reentryThreshold !== null ? r2.reentryThreshold : r2.refHigh;
      if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        r2.refHigh = cur.h;
        r2.refLow = cur.l;
        r2.slActive = false;
        r2.reentryThreshold = null;
        ev.push(`REAR 2(${branchLabel(pc.id)})`);
      } else if (cur.h > ref && cur.h - ref >= ANY) {
        // Same fix as TZ BUY 2's own SL/recovery (real-data bug,
        // PAYTM.NS): a new high that clears the old level but closes
        // back below it must still raise the recovery bar, not be
        // silently ignored -- otherwise a LATER, actually lower high
        // could wrongly confirm "recovered" against a stale level price
        // had already cleared and abandoned.
        r2.refHigh = cur.h;
        r2.reentryThreshold = cur.h;
        ev.push(`INVALID REAR 2 HH(${branchLabel(pc.id)})`);
      }
      return ev;
    }
    if (cur.l < r2.refLow) {
      const gap = r2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= r2.refLow + EPS) {
        // REAR 2's own SL is decisive too, unlike BAR 2 -- it wipes out
        // whatever it had unlocked (RED1/RED2 in flight against REAR, any
        // fresh BAR cascade opened under REAR 2) and needs to reform
        // (same label, above its own ref) before RED1/RED2 can attach to
        // REAR again. Snapshot "whichever is higher" BEFORE wiping.
        r2.reentryThreshold = this.currentTopRef(buy);
        r2.slActive = true;
        ev.push(`REAR 2 SL(${branchLabel(pc.id)})`);
        buy.red1 = null;
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barDeadLabels = new Set();
        buy.barPending = false;
        return ev;
      }
      r2.refLow = cur.l;
      ev.push(`REAR 2 LL(${branchLabel(pc.id)})`);
    }
    if (cur.h > r2.refHigh && cur.h - r2.refHigh >= ANY) {
      r2.refHigh = cur.h;
      ev.push(`REAR 2 HH(${branchLabel(pc.id)})`);
    }
    return ev;
  }

  // Mirrors evalRear2 one level deeper. rre.dormant guard placed at the
  // VERY TOP -- rre.dormant CAN become true before rre.rre2 ever forms (a
  // fresh BAR generation superseding REAR RE-ENTER before its own "2" ever
  // confirmed), unlike rear.dormant one tier up.
  private evalRre2(
    pc: ParentCycle,
    buy: Buy,
    rre: RearReenter,
    prev: Day,
    cur: Day,
    preTodayRreRef: number | null
  ): string[] {
    const ev: string[] = [];
    if (rre.dormant) return ev;
    if (rre.rre2 === null) {
      if (rre.sl === null) {
        const ref = preTodayRreRef !== null ? preTodayRreRef : rre.refHigh;
        if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
          rre.rre2 = new Bar2(cur.h, cur.l);
          ev.push(`REAR RE-ENTER 2(${branchLabel(pc.id)})`);
        }
      }
      return ev;
    }
    if (rre.sl !== null) {
      if (cur.h > rre.rre2.refHigh && cur.h - rre.rre2.refHigh >= ANY) {
        rre.rre2.refHigh = cur.h;
        ev.push(`INVALID REAR RE-ENTER HH(${branchLabel(pc.id)})`);
      }
      return ev;
    }
    const r2 = rre.rre2;
    if (r2.slActive) {
      // Same "whichever is higher" recovery treatment as REAR 2's own SL,
      // one level deeper.
      const ref = r2.reentryThreshold !== null ? r2.reentryThreshold : r2.refHigh;
      if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        r2.refHigh = cur.h;
        r2.refLow = cur.l;
        r2.slActive = false;
        r2.reentryThreshold = null;
        ev.push(`REAR RE-ENTER 2(${branchLabel(pc.id)})`);
      } else if (cur.h > ref && cur.h - ref >= ANY) {
        // Same fix as TZ BUY 2's own SL/recovery (real-data bug,
        // PAYTM.NS): a new high that clears the old level but closes
        // back below it must still raise the recovery bar, not be
        // silently ignored -- otherwise a LATER, actually lower high
        // could wrongly confirm "recovered" against a stale level price
        // had already cleared and abandoned.
        r2.refHigh = cur.h;
        r2.reentryThreshold = cur.h;
        ev.push(`INVALID REAR RE-ENTER 2 HH(${branchLabel(pc.id)})`);
      }
      return ev;
    }
    if (cur.l < r2.refLow) {
      const gap = r2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= r2.refLow + EPS) {
        // Same treatment as REAR 2's own SL, one level deeper -- decisive,
        // wipes what it unlocked, needs to reform before RED1/RED2 can
        // attach to REAR RE-ENTER. Snapshot "whichever is higher" BEFORE
        // wiping.
        r2.reentryThreshold = this.currentTopRef(buy);
        r2.slActive = true;
        ev.push(`REAR RE-ENTER 2 SL(${branchLabel(pc.id)})`);
        buy.red1 = null;
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barDeadLabels = new Set();
        buy.barPending = false;
        return ev;
      }
      r2.refLow = cur.l;
      ev.push(`REAR RE-ENTER 2 LL(${branchLabel(pc.id)})`);
    }
    if (cur.h > r2.refHigh && cur.h - r2.refHigh >= ANY) {
      r2.refHigh = cur.h;
      ev.push(`REAR RE-ENTER 2 HH(${branchLabel(pc.id)})`);
    }
    return ev;
  }

  // Advances every currently-alive BAR lineage's SL/SL2 state (HH/LL/
  // BAR-2 already handled earlier this same candle). Whichever lineage's
  // SL2 condition fires first wins: a fresh REAR forms off its own
  // reference, and every other lineage terminates immediately. Also
  // checks whether a fresh BAR can start on its own (no RED1/RED2 needed)
  // once the newest lineage is no longer pre-SL, and attaches RED1/RED2 to
  // whichever lineage is currently the genuinely active (pre-SL) one --
  // only the NEWEST lineage ever participates in RED1/RED2 (single shared
  // buy.red1 object).
  private evalBarLineagesProgress(
    pc: ParentCycle,
    buy: Buy,
    prev: Day,
    cur: Day,
    preTodayBar2Ref: Map<string, number | null>
  ): string[] {
    const labelId = branchLabel(pc.id);
    let rearWinner: [BarLineage, number, number] | null = null;
    let sl2ConfirmedToday = false;
    let reactivatedThisCandle = false;
    const perLineageEv = new Map<string, string[]>();
    const lineageObjs = new Map<string, BarLineage>();

    // RED1/RED2 is a SINGLE shared object per buy (buy.red1). Frozen once,
    // before the loop, so an older lineage racing in parallel behind the
    // newest one never also gets routed through it.
    const newestForRed1 = buy.barLineages.length > 0 ? buy.barLineages[buy.barLineages.length - 1] : null;

    for (const lin of [...buy.barLineages]) {
      lineageObjs.set(lin.label, lin);
      const linEv: string[] = [];
      perLineageEv.set(lin.label, linEv);

      if (lin.sl === null) {
        if (cur.l < lin.refLow && lin.refLow - cur.l >= THRESH - EPS && cur.c <= lin.refLow + EPS) {
          linEv.push(`BAR SL(${lin.label})`);
          lin.sl = new BarSL(cur.h, cur.l);
          buy.red1 = null;
          lin.red1Since = false;
          continue;
        }
        if (lin === newestForRed1) {
          const red1Preexisting = buy.red1 !== null && buy.red1.active;
          if (red1Preexisting) {
            linEv.push(...this.evalRed1Generic(pc, buy, lin, prev, cur));
          } else if (lin.bar2 !== null && !lin.red2Ever) {
            // A fresh RED1 cannot attach to this lineage until its own
            // BAR 2 has formed.
            linEv.push(...this.attachFreshRed1(pc, buy, lin, prev, cur));
          }
        }
        continue;
      }

      const sl = lin.sl;

      if (lin.bar2 === null) {
        // This lineage's SL fired without a BAR 2 ever having formed for
        // it -- a permanent dead end. No INVALID BAR SL, no BAR SL HH/LL,
        // no BAR SL2. The only ways out are a fresh BAR(n+1) forming
        // elsewhere (below, which removes this dead lineage) or the
        // top-level TZ BUY SL eventually firing.
        continue;
      }

      if (sl.invalidated) {
        linEv.push(...this.dormantBarLowCheck(buy, lin, sl, cur));
        continue;
      }

      if (!sl.sl2) {
        if (cur.h >= sl.refHigh && cur.h - sl.refHigh >= THRESH - EPS && cur.c >= sl.refHigh) {
          linEv.push(`INVALID BAR SL(${lin.label})`);
          buy.barHighPool = Math.max(buy.barHighPool, cur.h);
          const newestLineage = buy.barLineages[buy.barLineages.length - 1];
          if (lin === newestLineage && this.barEntryShape(prev, cur)) {
            lin.sl = null;
            lin.refHigh = cur.h;
            lin.refLow = cur.l;
            lin.red1Since = false;
            lin.red2Ever = false;
            // BAR 2 does NOT persist through a BAR-level reactivation --
            // every fresh BAR generation needs its own new BAR 2 from
            // scratch.
            lin.bar2 = null;
            reactivatedThisCandle = true;
            buy.barPending = false;
            linEv.push(`BAR(${lin.label})`);
          } else if (lin === newestLineage) {
            sl.invalidated = true;
            linEv.push(...this.dormantBarLowCheck(buy, lin, sl, cur));
          } else {
            buy.barLineages = buy.barLineages.filter((l) => l !== lin);
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
        // A BAR's own SL2 ALWAYS produces a fresh REAR, never a
        // reactivation of whatever dormant ancestor (REAR or REAR
        // RE-ENTER) happens to already exist -- regardless of whether that
        // ancestor's own frozen/quietly-climbing reference happens to
        // clear the same day. Blocked entirely once the ancestor has
        // already failed at its own SL.
        const preRef = preTodayBar2Ref.get(lin.label) ?? null;
        const rearRef = preRef !== null ? preRef : (lin.bar2 as Bar2).refHigh;
        const isRear = cur.l >= prev.l && cur.h > rearRef && cur.h - rearRef >= THRESH - EPS && cur.c >= rearRef;
        if (isRear && !this.milestoneBlocked(pc)) {
          rearWinner = [lin, cur.h, cur.l];
          break;
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

    let ev: string[] = [];
    for (const linEv of perLineageEv.values()) {
      ev.push(...linEv);
    }

    if (rearWinner !== null) {
      const [, rh, rl] = rearWinner;
      ev.push(`REAR(${labelId})`);
      buy.rearReenter = null; // single-slot: newest REAR-family formation wipes any older dormant one
      buy.rear = new Rear(rh, rl);
      buy.barLineages = []; // every lineage -- ancestor or descendant -- terminates
      buy.barSubCounter = 0;
      buy.barDeadLabels = new Set();
      return ev;
    }

    // A fresh, independent BAR can start on ANY qualifying breakout the
    // instant the current newest lineage is no longer pre-SL BUT HAS NOT
    // YET REACHED ITS OWN SL2 -- no RED1/RED2 needed for this. Added
    // alongside the original RED2/barPending-gated path (kept unchanged
    // below, for a still-pre-SL newest lineage whose own RED2 already
    // fired), not a replacement for it: the RED2-gated path alone made
    // fresh BAR formation permanently impossible once the newest lineage
    // was a no-BAR-2 dead end (real-data-motivated fix). A lineage that's
    // post-SL, already has its own BAR 2, and hasn't shown INVALID BAR SL
    // yet is NOT terminated by this -- it keeps racing in parallel. Only
    // a lineage that's a genuine dead end (no BAR 2) or already gave up
    // (invalidated) gets dropped when a fresh one forms -- and ONLY a
    // dead-end drop frees its number for reuse; one that had BAR 2 stays
    // retired.
    //
    // EXCLUDES a lineage that has ALREADY reached its own SL2
    // (`newest.sl.sl2`) -- a second real-data bug (BBOX.NS): once BAR SL2
    // fires, the only three valid next events are TZ BUY's own SL, REAR
    // (this same lineage's own breakout above its BAR 2's reference,
    // handled separately above), or a fresh sibling TZ GREEN(n+1). A
    // merely generic breakout must not let an unrelated BAR(n+1) jump in
    // ahead of REAR.
    const newest = buy.barLineages.length > 0 ? buy.barLineages[buy.barLineages.length - 1] : null;
    const newestIsDead = newest === null || (newest.sl !== null && !newest.sl.sl2);
    const freshBarReady = newestIsDead || buy.barPending;
    if (!reactivatedThisCandle && buy.active && freshBarReady && this.barEntryShape(prev, cur)) {
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
    if (!rear.red1Since || rear.dormant || this.red1InvalidatesToday(buy, cur)) {
      if (cur.h > rear.refHigh && cur.h - rear.refHigh >= ANY) {
        rear.refHigh = cur.h;
        ev.push(`REAR HH(${branchLabel(pc.id)})`);
      }
    } else {
      const diff = cur.h - rear.refHigh;
      if (cur.h > rear.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < rear.refHighAtRed1)) {
        rear.refHigh = cur.h;
        ev.push(`REAR HH(${branchLabel(pc.id)})`);
      }
    }
    if (cur.l < rear.refLow) {
      const gap = rear.refLow - cur.l;
      if ((gap >= THRESH - EPS && cur.c > rear.refLow + EPS) || gap < THRESH - EPS) {
        rear.refLow = cur.l;
        ev.push(`REAR LL(${branchLabel(pc.id)})`);
      }
    }
    return ev;
  }

  private evalRearProgress(pc: ParentCycle, buy: Buy, rear: Rear, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    if (cur.l < rear.refLow && rear.refLow - cur.l >= THRESH - EPS && cur.c <= rear.refLow + EPS) {
      ev.push(`REAR SL(${branchLabel(pc.id)})`);
      // REAR's own SL is decisive -- wipes out everything below it (REAR
      // 2, any fresh BAR cascade opened under REAR 2), regardless of any
      // RED1/RED2 already in flight. Snapshot "whichever is higher"
      // BEFORE wiping -- REAR RE-ENTER always forms above THIS (never a
      // dead end, unlike BAR).
      rear.sl = new RearSL(cur.l, this.currentTopRef(buy));
      rear.rear2 = null;
      buy.barLineages = [];
      buy.barSubCounter = 0;
      buy.barDeadLabels = new Set();
      buy.red1 = null;
      buy.barPending = false;
      return ev;
    }
    const red1Preexisting = buy.red1 !== null && buy.red1.active;
    if (red1Preexisting) {
      ev.push(...this.evalRed1Generic(pc, buy, rear, prev, cur));
    } else if (rear.rear2 !== null && !rear.rear2.slActive && !rear.red2Ever) {
      // A fresh RED1 cannot attach to REAR unless REAR 2 is currently
      // ACTIVE (not merely "has existed once") -- REAR 2's own SL wipes
      // this out too, requiring REAR 2 to reform before RED1/RED2 can
      // attach again.
      ev.push(...this.attachFreshRed1(pc, buy, rear, prev, cur));
    }
    return ev;
  }

  private evalRearSlProgress(pc: ParentCycle, buy: Buy, rear: Rear, sl: RearSL, prev: Day, cur: Day): string[] {
    // REAR's own SL always leads to REAR RE-ENTER -- never a dead end,
    // regardless of whether REAR 2 ever formed. Threshold is "whichever is
    // higher" as snapshotted at the moment this SL fired (sl.
    // entryThreshold) -- REAR 2/bar lineages were already wiped at that
    // point, so this is the only place that reference is still remembered.
    const ev: string[] = [];
    const labelId = branchLabel(pc.id);
    const ref = sl.entryThreshold;
    const isReenter = cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
    if (isReenter && !this.milestoneBlocked(pc)) {
      buy.rearReenter = new RearReenter(cur.h, cur.l);
      ev.push(`REAR RE-ENTER(${labelId})`);
      rear.dormant = true; // this REAR is now permanently retired for this lineage
      return ev;
    }
    return ev;
  }

  // =================== REAR RE-ENTER family ===================
  private evalRearReenterHhLl(pc: ParentCycle, buy: Buy, rre: RearReenter, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    if (!rre.red1Since || rre.dormant || this.red1InvalidatesToday(buy, cur)) {
      if (cur.h > rre.refHigh && cur.h - rre.refHigh >= ANY) {
        rre.refHigh = cur.h;
        ev.push(`REAR RE-ENTER HH(${branchLabel(pc.id)})`);
      }
    } else {
      const diff = cur.h - rre.refHigh;
      if (cur.h > rre.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < rre.refHighAtRed1)) {
        rre.refHigh = cur.h;
        ev.push(`REAR RE-ENTER HH(${branchLabel(pc.id)})`);
      }
    }
    if (cur.l < rre.refLow) {
      const gap = rre.refLow - cur.l;
      if ((gap >= THRESH - EPS && cur.c > rre.refLow + EPS) || gap < THRESH - EPS) {
        rre.refLow = cur.l;
        ev.push(`REAR RE-ENTER LL(${branchLabel(pc.id)})`);
      }
    }
    return ev;
  }

  private evalRearReenterProgress(pc: ParentCycle, buy: Buy, rre: RearReenter, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    if (cur.l < rre.refLow && rre.refLow - cur.l >= THRESH - EPS && cur.c <= rre.refLow + EPS) {
      ev.push(`REAR RE-ENTER SL(${branchLabel(pc.id)})`);
      // Same decisive treatment as REAR's own SL, one level deeper --
      // wipes REAR RE-ENTER 2 and any fresh BAR cascade opened under it,
      // snapshotting "whichever is higher" first (self-recovers above
      // THIS, never a dead end).
      rre.sl = new RearReenterSL(cur.l, this.currentTopRef(buy));
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
      // Mirrors REAR 2's gate one level deeper -- REAR RE-ENTER 2 must be
      // currently ACTIVE, not merely have existed once.
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
    // REAR RE-ENTER's own SL always self-recovers -- never a dead end,
    // regardless of whether REAR RE-ENTER 2 ever formed. Threshold is
    // "whichever is higher" as snapshotted at the moment this SL fired
    // (sl.entryThreshold).
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
      // REAR RE-ENTER 2 was already wiped (rre.rre2 = null) the moment
      // this SL fired -- a fresh REAR RE-ENTER 2 has to form from scratch
      // before RED1/RED2 can attach again.
      return ev;
    }
    return ev;
  }

  reset(): void {
    this.branches = new Map();
    this.seqCounter = 0;
    this.preTodayLiveBuy = new Map();
  }
}

export interface HistoryRowLike {
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

/**
 * Run the engine over a sequence of OHLC rows (ascending by date, the same
 * shape /api/history returns) and produce a date -> event-string map,
 * joining a day's multiple events with " + " (matching this engine's own
 * CLI output convention). Rows with any null OHLC field are dropped first.
 * The first row never gets an event -- the engine compares each day
 * against the one before it.
 */
export function computeBar2VariantEvents(
  rows: HistoryRowLike[],
  reentryRule: TzBuyReentryRule = "topref"
): Map<string, string> {
  const days: Day[] = rows
    .filter((r) => r.open !== null && r.high !== null && r.low !== null && r.close !== null)
    .map((r) => ({
      date: r.date,
      o: r.open as number,
      h: r.high as number,
      l: r.low as number,
      c: r.close as number,
    }));

  const engine = new TZEngine(reentryRule);
  const map = new Map<string, string>();
  for (let i = 1; i < days.length; i++) {
    const prev = days[i - 1];
    const cur = days[i];
    const events = engine.process(prev, cur);
    if (events.length > 0) {
      map.set(cur.date, events.join(" + "));
    }
  }
  return map;
}
