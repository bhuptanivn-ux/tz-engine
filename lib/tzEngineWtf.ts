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
    return buy.barLineages.some((lin) => lin.sl !== null && lin.sl.sl2);
  }

  private barLineagesRacing(buy: Buy): boolean {
    return buy.barLineages.some((lin) => lin.sl === null || (lin.bar2 !== null && !lin.sl.sl2));
  }

  private buyCurrentlyLive(buy: Buy): boolean {
    if (!buy.active) return false;
    if (buy.rearReenter !== null) {
      if (buy.rearReenter.sl !== null) return false;
      if (!buy.rearReenter.dormant) {
        if (buy.barLineages.length > 0) return this.barLineagesRacing(buy);
        return !(buy.rearReenter.rre2 !== null && buy.rearReenter.rre2.slActive);
      }
    } else if (buy.rear !== null) {
      if (buy.rear.sl !== null) return false;
      if (!buy.rear.dormant) {
        if (buy.barLineages.length > 0) return this.barLineagesRacing(buy);
        return !(buy.rear.rear2 !== null && buy.rear.rear2.slActive);
      }
    }
    if (buy.barLineages.length > 0) return this.barLineagesRacing(buy);
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

  process(prev: Day, cur: Day): string[] {
    const perBranchEvents = new Map<number, string[]>();
    const milestoneAchievers: [ParentCycle, boolean][] = [];
    const greenSlSeqs: number[] = [];

    let anyLiveBuy = false;
    for (const pc of this.branches.values()) {
      if (pc.active && pc.buy !== null && this.buyCurrentlyLive(pc.buy)) {
        anyLiveBuy = true;
        break;
      }
    }

    this.preTodayLiveBuy = new Map();
    for (const [pid, pc] of this.branches) {
      this.preTodayLiveBuy.set(pid, pc.buy !== null && this.buyCurrentlyLive(pc.buy));
    }

    if (!anyLiveBuy) {
      for (const pc of this.branches.values()) pc.dormant = false;
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

    const activeBranches = Array.from(this.branches.values()).filter((pc) => pc.active);
    const tip =
      activeBranches.length > 0 ? activeBranches.reduce((a, b) => (b.seq > a.seq ? b : a)) : null;
    const tipDeepFailure =
      tip !== null && tip.buy !== null && this.deepFailureReached(tip.buy) && !this.buyCurrentlyLive(tip.buy);
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
      if (pcNow !== undefined && pcNow.dormant && pid !== newBranchId) {
        if (exemptionBlockedPids.has(pid)) continue;
        visible.push(...events.filter((e) => isMilestone(e) || isSlOrLl(e)));
        if (events.some((e) => isMilestone(e))) pcNow.dormant = false;
      } else {
        visible.push(...events);
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

    if (hh && !hasLiveBuy && !isSl) ev.push(`TZ GREEN HH(${label})`);
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

    const newestLin = buy.barLineages.length > 0 ? buy.barLineages[buy.barLineages.length - 1] : null;
    if (newestLin !== null && !this.barHhSuppressedToday(buy, newestLin, prev, cur)) {
      const linHhEv = this.evalBarLineageHh(buy, newestLin, prev, cur);
      if (newestLin.bar2 === null) {
        ev.push(...linHhEv);
      } else {
        ev.push(...linHhEv.filter((e) => e.startsWith("BAR LL(")));
      }
    }

    const bar2EvByLabel = new Map<string, string[]>();
    for (const lin of buy.barLineages) {
      bar2EvByLabel.set(lin.label, this.evalBar2(lin, prev, cur, preTodayLinRef.get(lin.label) ?? null));
    }

    if (newestLin !== null && newestLin.bar2 !== null) {
      const surviving = buy.barLineages.filter((l) => l === newestLin || l.sl !== null);
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
        if (buy.rearReenter.rre2 !== null) rreEv = rreEv.filter((e) => !e.startsWith("REAR RE-ENTER HH("));
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
      ev.push(...this.evalBarLineagesProgress(pc, buy, prev, cur, preTodayBar2Ref));
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
    if (cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h) {
      const subLabel = this.nextBarLabel(buy, branchLabel(pc.id));
      buy.barLineages.push(new BarLineage(subLabel, cur.h, cur.l));
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

  private evalRear2(pc: ParentCycle, buy: Buy, rear: Rear, prev: Day, cur: Day, preTodayRearRef: number | null): string[] {
    const ev: string[] = [];
    const label = branchLabel(pc.id);
    if (rear.rear2 === null) {
      if (rear.sl === null) {
        const ref = preTodayRearRef !== null ? preTodayRearRef : rear.refHigh;
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
    let rearWinner: [BarLineage, number, number] | null = null;
    let sl2ConfirmedToday = false;
    let reactivatedThisCandle = false;
    const perLineageEv = new Map<string, string[]>();
    const lineageObjs = new Map<string, BarLineage>();

    const newestForRed1 = buy.barLineages.length > 0 ? buy.barLineages[buy.barLineages.length - 1] : null;

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
          const isNewest = lin === buy.barLineages[buy.barLineages.length - 1];
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
          } else if (isNewest) {
            sl.invalidated = true;
            linEv.push(...this.dormantBarLowCheck(buy, lin, sl, cur));
          } else {
            const idx = buy.barLineages.indexOf(lin);
            if (idx !== -1) buy.barLineages.splice(idx, 1);
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
        const preRef = preTodayBar2Ref.get(lin.label);
        const rearRef = preRef !== undefined && preRef !== null ? preRef : (lin.bar2 as Bar2).refHigh;
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
    for (const linEv of perLineageEv.values()) ev.push(...linEv);

    if (rearWinner !== null) {
      const [, rh, rl] = rearWinner;
      ev.push(`REAR(${labelId})`);
      buy.rearReenter = null;
      buy.rear = new Rear(rh, rl);
      buy.barLineages = [];
      buy.barSubCounter = 0;
      buy.barDeadLabels = new Set();
      return ev;
    }

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
    const label = branchLabel(pc.id);
    if (!rear.red1Since || rear.dormant || this.red1InvalidatesToday(buy, cur)) {
      if (cur.h > rear.refHigh && cur.h - rear.refHigh >= ANY) {
        rear.refHigh = cur.h;
        ev.push(`REAR HH(${label})`);
      }
    } else {
      const diff = cur.h - rear.refHigh;
      if (cur.h > rear.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < rear.refHighAtRed1)) {
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
    if (!this.milestoneBlocked(pc) && cur.h > ref && cur.h - ref >= ANY) {
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
      if (cur.h > rre.refHigh && (diff < THRESH - EPS || cur.l < prev.l || cur.c < rre.refHighAtRed1)) {
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
    if (!this.milestoneBlocked(pc) && cur.h > ref && cur.h - ref >= ANY) {
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
export function computeWtfEvents(rows: HistoryRowLike[]): Map<string, string> {
  const days = toDays(rows);
  const engine = new TZEngine();
  const map = new Map<string, string>();
  for (let i = 1; i < days.length; i++) {
    const events = engine.process(days[i - 1], days[i]);
    if (events.length > 0) map.set(days[i].date, events.join(", "));
  }
  return map;
}
