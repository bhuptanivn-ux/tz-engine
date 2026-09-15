// Direct TypeScript port of tz_engine_bar2_variant.py, as it exists on
// `main`. Ported faithfully line-for-line, not reinterpreted — every
// condition, ordering, and judgment call matches the Python original
// exactly. This is the validated engine: BAR 2 / REAR 2 / REAR RE-ENTER 2
// were verified end-to-end against a real 01-01-2020 through 08-08-2020
// OHLC dataset (see data/tz_2020_verification_dataset.csv and
// verify_bar2_variant_2020.py). This port was cross-checked against that
// same dataset by running both the Python original and this TS port over
// it and diffing every line of output — byte-identical.
//
// NOT ported: the `extra_reentry_floor` parameter on `_eval_buy` and the
// `load_days_xlsx` / `main` CLI entry point. `extra_reentry_floor` is a
// hook for the separate DTF/WTF layer (tz_engine_dtf_wtf.py) that this
// site doesn't use; the CLI entry point is Python-only I/O with no
// equivalent needed here (this site feeds it live-fetched OHLC directly).

const THRESH = 0.2;
const ANY = 0.01;
const EPS = 1e-9;

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

class Bar2 {
  slActive = false;
  dormant = false;
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
  constructor(public refLow: number) {}
}

class Rear {
  red1Since = false;
  refHighAtRed1 = 0;
  sl: RearSL | null = null;
  dormant = false;
  red2Ever = false;
  rear2: Bar2 | null = null;
  constructor(public refHigh: number, public refLow: number) {}
}

class RearReenterSL {
  constructor(public refLow: number) {}
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

class Buy {
  active = true;
  red1Ever = false;
  refHighAtRed1 = 0;
  red1: Red1 | null = null;
  barLineages: BarLineage[] = [];
  barSubCounter = 0;
  barPending = false;
  rear: Rear | null = null;
  rearReenter: RearReenter | null = null;
  barHighPool = 0;
  tzBuy2: Bar2 | null = null;
  tzBuy2HhMuted = false;
  constructor(public refHigh: number, public refLow: number) {}
}

class ParentCycle {
  active = true;
  dormant = false;
  redEver = false;
  refHighAtRed = 0;
  buy: Buy | null = null;
  constructor(public id: number, public seq: number, public refHigh: number, public refLow: number) {}
}

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
// generically by _eval_red1_generic / _attach_fresh_red1 / _reset_red1_regime
// exactly like Python's duck-typed `stage_obj`.
type RedRegimeHolder = Buy | BarLineage | Rear | RearReenter;

function hasRed1Since(obj: RedRegimeHolder): obj is BarLineage | Rear | RearReenter {
  return "red1Since" in obj;
}

function hasRed2Ever(obj: RedRegimeHolder): obj is BarLineage | Rear | RearReenter {
  return "red2Ever" in obj;
}

export class TZEngine {
  private branches = new Map<number, ParentCycle>();
  private seqCounter = 0;
  private preTodayLiveBuy = new Map<number, boolean>();

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

  private buyCurrentlyLive(buy: Buy): boolean {
    if (!buy.active) return false;
    if (buy.rearReenter !== null) {
      if (buy.rearReenter.sl !== null) return false;
      if (!buy.rearReenter.dormant) return true;
    } else if (buy.rear !== null) {
      if (buy.rear.sl !== null) return false;
      if (!buy.rear.dormant) return true;
    }
    if (buy.barLineages.length > 0) {
      return buy.barLineages.some((lin) => lin.sl === null || (lin.bar2 !== null && !lin.sl.sl2));
    }
    return true;
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
      const allEvents = this.evalParent(pc, prev, cur, anyLiveBuy);
      perBranchEvents.set(pid, allEvents);

      if (allEvents.some((e) => e.startsWith("TZ GREEN SL("))) {
        greenSlSeqs.push(pc.seq);
      }

      for (const e of allEvents) {
        if (isMilestone(e)) {
          const isFreshBuy = e.startsWith("TZ BUY(");
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
    const tipTzBuy2SlActive =
      tip !== null && tip.buy !== null && tip.buy.tzBuy2 !== null && tip.buy.tzBuy2.slActive;
    const eligibleAnchor =
      tip !== null &&
      !tip.dormant &&
      tip.redEver &&
      (tip.buy === null || !tip.buy.active || tipDeepFailure || tipTzBuy2SlActive);
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
      for (const pc of activePcs) {
        if (pc !== leader && pc.dormant && leader.refHigh > pc.refHigh) {
          pc.refHigh = leader.refHigh;
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

    if (hh && !hasLiveBuy && !isSl) {
      ev.push(`TZ GREEN HH(${branchLabel(pc.id)})`);
    }
    if (ll) {
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

  private evalBuy(pc: ParentCycle, buy: Buy, prev: Day, cur: Day, extraReentryFloor: number | null = null): string[] {
    let ev: string[] = [];
    const label = "TZ BUY";
    const slLabel = "TZ BUY SL";

    const hasDeeperActive = buy.barLineages.length > 0 || buy.barPending || buy.rear !== null || buy.rearReenter !== null;
    const noBarYet = !hasDeeperActive;
    const red1PreexistingAtBuyLevel = buy.active && noBarYet && buy.red1 !== null && buy.red1.active;

    const preTodayBuyRef = buy.refHigh;
    const preTodayTzbuy2Ref = buy.tzBuy2 !== null ? buy.tzBuy2.refHigh : null;

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

      if (hh && buy.tzBuy2 === null) {
        ev.push(`${label} HH(${branchLabel(pc.id)})`);
      }
      if (ll) {
        ev.push(`${label} LL(${branchLabel(pc.id)})`);
      }

      if (isSl) {
        ev.push(`${slLabel}(${branchLabel(pc.id)})`);
        buy.active = false;
        buy.barPending = false;
        buy.red1 = null;
      }
    } else {
      let ref = preTodayBuyRef;
      if (preTodayTzbuy2Ref !== null) {
        ref = Math.max(ref, preTodayTzbuy2Ref);
      }
      if (extraReentryFloor !== null) {
        ref = Math.max(ref, extraReentryFloor);
      }
      if (cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref) {
        buy.active = true;
        buy.refHigh = cur.h;
        buy.refLow = cur.l;
        buy.red1Ever = false;
        buy.red1 = null;
        buy.tzBuy2 = null;
        ev.push(`${label}(${branchLabel(pc.id)})`);
        reactivatedToday = true;
      }
    }

    if (!reactivatedToday) {
      ev.push(...this.evalTzbuy2(pc, buy, prev, cur, preTodayBuyRef));
    }

    const preTodayLinRef = new Map(buy.barLineages.map((lin) => [lin.label, lin.refHigh]));
    const preTodayBar2Ref = new Map(
      buy.barLineages.map((lin) => [lin.label, lin.bar2 !== null ? lin.bar2.refHigh : null])
    );
    const preTodayRearRef = buy.rear !== null ? buy.rear.refHigh : null;
    const preTodayRear2Ref = buy.rear !== null && buy.rear.rear2 !== null ? buy.rear.rear2.refHigh : null;
    const preTodayRreRef = buy.rearReenter !== null ? buy.rearReenter.refHigh : null;
    const preTodayRre2Ref =
      buy.rearReenter !== null && buy.rearReenter.rre2 !== null ? buy.rearReenter.rre2.refHigh : null;

    const newestLin = buy.barLineages.length > 0 ? buy.barLineages[buy.barLineages.length - 1] : null;
    if (newestLin !== null && !this.barHhSuppressedToday(buy, newestLin, prev, cur)) {
      const linHhEv = this.evalBarLineageHh(pc, buy, newestLin, prev, cur);
      if (newestLin.bar2 === null) {
        ev.push(...linHhEv);
      } else {
        ev.push(...linHhEv.filter((e) => e.startsWith("BAR LL(")));
      }
    }

    const bar2EvByLabel = new Map<string, string[]>();
    for (const lin of buy.barLineages) {
      bar2EvByLabel.set(lin.label, this.evalBar2(pc, buy, lin, prev, cur, preTodayLinRef.get(lin.label) ?? null));
    }

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

    if (buy.rear !== null) {
      if (buy.rear.sl === null) {
        let rearEv = this.evalRearHhLl(pc, buy, buy.rear, prev, cur);
        if (buy.rear.dormant) {
          rearEv = rearEv.filter((e) => e.includes("LL("));
        }
        if (buy.rear.rear2 !== null) {
          rearEv = rearEv.filter((e) => !e.startsWith("REAR HH("));
        }
        ev.push(...rearEv);
      }
      ev.push(...this.evalRear2(pc, buy, buy.rear, prev, cur, preTodayRearRef, preTodayRear2Ref));
    }

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
      ev.push(...this.evalRre2(pc, buy, buy.rearReenter, prev, cur, preTodayRreRef, preTodayRre2Ref));
    }

    const barConfirmsToday =
      buy.barPending &&
      buy.active &&
      buy.barLineages.length === 0 &&
      (buy.rear !== null || buy.rearReenter !== null) &&
      this.barEntryShape(prev, cur);

    if (buy.rearReenter !== null && buy.rearReenter.sl !== null) {
      if (buy.rearReenter.rre2 !== null) {
        ev.push(
          ...this.evalRearReenterSlProgress(pc, buy, buy.rearReenter, buy.rearReenter.sl, prev, cur, preTodayRre2Ref)
        );
      }
    } else if (buy.rearReenter === null && buy.rear !== null && buy.rear.sl !== null) {
      if (buy.rear.rear2 !== null) {
        ev.push(...this.evalRearSlProgress(pc, buy, buy.rear, buy.rear.sl, prev, cur, preTodayRear2Ref));
      }
    } else if (barConfirmsToday) {
      ev = ev.filter((e) => !(e.startsWith("REAR HH(") || e.startsWith("REAR RE-ENTER HH(")));
      ev.push(...this.checkBarPending(pc, buy, prev, cur));
    } else if (buy.rearReenter !== null && !buy.rearReenter.dormant) {
      ev.push(...this.evalRearReenterProgress(pc, buy, buy.rearReenter, prev, cur));
    } else if (buy.rearReenter === null && buy.rear !== null && !buy.rear.dormant) {
      ev.push(...this.evalRearProgress(pc, buy, buy.rear, prev, cur));
    } else if (buy.barLineages.length > 0) {
      ev.push(...this.evalBarLineagesProgress(pc, buy, prev, cur, preTodayBar2Ref));
    } else if (buy.barPending && buy.active) {
      ev.push(...this.checkBarPending(pc, buy, prev, cur));
    } else if (!buy.active) {
      // no-op
    } else if (red1PreexistingAtBuyLevel) {
      ev.push(...this.evalRed1Generic(pc, buy, buy, prev, cur));
    } else if (buy.tzBuy2 !== null) {
      if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
        if (!buy.red1Ever) {
          buy.refHighAtRed1 = buy.refHigh;
        }
        buy.red1Ever = true;
        buy.red1 = new Red1(cur.h, cur.l);
        ev.push(`RED1(${branchLabel(pc.id)})`);
      }
    }

    if (buy.rearReenter !== null && buy.rearReenter.dormant && buy.rearReenter.sl === null) {
      const rre = buy.rearReenter;
      if (cur.l < rre.refLow && rre.refLow - cur.l >= THRESH - EPS && cur.c <= rre.refLow + EPS) {
        ev.push(`REAR RE-ENTER SL(${branchLabel(pc.id)})`);
        rre.sl = new RearReenterSL(cur.l);
        buy.red1 = null;
        buy.barLineages = [];
        buy.barSubCounter = 0;
        buy.barPending = false;
      }
    } else if (buy.rear !== null && buy.rear.dormant && buy.rear.sl === null) {
      const rear = buy.rear;
      if (cur.l < rear.refLow && rear.refLow - cur.l >= THRESH - EPS && cur.c <= rear.refLow + EPS) {
        ev.push(`REAR SL(${branchLabel(pc.id)})`);
        rear.sl = new RearSL(cur.l);
        buy.barLineages = [];
        buy.barSubCounter = 0;
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
        e.startsWith("TZ BUY SL(") ||
        e.startsWith("BAR SL(") ||
        e.startsWith("REAR SL(") ||
        e.startsWith("REAR RE-ENTER SL(")
      ) {
        slLabels.add(e.slice(e.indexOf("(") + 1, -1));
      }
    }
    if (slLabels.size > 0) {
      ev = ev.filter((e) => {
        const matchesSuppressible =
          e.startsWith("TZ BUY HH(") ||
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

  private attachFreshRed1(pc: ParentCycle, buy: Buy, stageObj: BarLineage | Rear | RearReenter, prev: Day, cur: Day): string[] {
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

  private checkBarPending(pc: ParentCycle, buy: Buy, prev: Day, cur: Day): string[] {
    if (cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h) {
      buy.barSubCounter += 1;
      const subLabel = `${branchLabel(pc.id)}.${buy.barSubCounter}`;
      buy.barLineages.push(new BarLineage(subLabel, cur.h, cur.l));
      buy.barPending = false;
      buy.barHighPool = Math.max(buy.barHighPool, cur.h);
      this.supersedeRearForNewBar(buy);
      return [`BAR(${subLabel})`];
    }
    return [];
  }

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
        ev.push(`INVALID TZ BUY HH(${labelId})`);
      }
      return ev;
    }
    const b2 = buy.tzBuy2;
    if (b2.slActive) {
      if (cur.l >= prev.l && cur.h > b2.refHigh && cur.h - b2.refHigh >= THRESH - EPS && cur.c >= b2.refHigh) {
        b2.refHigh = cur.h;
        b2.refLow = cur.l;
        b2.slActive = false;
        ev.push(`TZ BUY 2(${labelId})`);
      }
      return ev;
    }
    if (cur.l < b2.refLow) {
      const gap = b2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= b2.refLow + EPS) {
        b2.slActive = true;
        ev.push(`TZ BUY 2 SL(${labelId})`);
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

  private evalBar2(pc: ParentCycle, buy: Buy, lin: BarLineage, prev: Day, cur: Day, preTodayLinRef: number | null): string[] {
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

  private evalRear2(
    pc: ParentCycle,
    buy: Buy,
    rear: Rear,
    prev: Day,
    cur: Day,
    preTodayRearRef: number | null,
    _preTodayRear2Ref: number | null
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
      if (cur.l >= prev.l && cur.h > r2.refHigh && cur.h - r2.refHigh >= THRESH - EPS && cur.c >= r2.refHigh) {
        r2.refHigh = cur.h;
        r2.refLow = cur.l;
        r2.slActive = false;
        ev.push(`REAR 2(${branchLabel(pc.id)})`);
      }
      return ev;
    }
    if (cur.l < r2.refLow) {
      const gap = r2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= r2.refLow + EPS) {
        r2.slActive = true;
        ev.push(`REAR 2 SL(${branchLabel(pc.id)})`);
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

  private evalRre2(
    pc: ParentCycle,
    buy: Buy,
    rre: RearReenter,
    prev: Day,
    cur: Day,
    preTodayRreRef: number | null,
    _preTodayRre2Ref: number | null
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
      if (cur.l >= prev.l && cur.h > r2.refHigh && cur.h - r2.refHigh >= THRESH - EPS && cur.c >= r2.refHigh) {
        r2.refHigh = cur.h;
        r2.refLow = cur.l;
        r2.slActive = false;
        ev.push(`REAR RE-ENTER 2(${branchLabel(pc.id)})`);
      }
      return ev;
    }
    if (cur.l < r2.refLow) {
      const gap = r2.refLow - cur.l;
      if (gap >= THRESH - EPS && cur.c <= r2.refLow + EPS) {
        r2.slActive = true;
        ev.push(`REAR RE-ENTER 2 SL(${branchLabel(pc.id)})`);
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
          const newestLineage = buy.barLineages[buy.barLineages.length - 1];
          if (lin === newestLineage && this.barEntryShape(prev, cur)) {
            lin.sl = null;
            lin.refHigh = cur.h;
            lin.refLow = cur.l;
            lin.red1Since = false;
            lin.red2Ever = false;
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
      buy.rearReenter = null;
      buy.rear = new Rear(rh, rl);
      buy.barLineages = [];
      buy.barSubCounter = 0;
      return ev;
    }

    if (!reactivatedThisCandle && buy.active && buy.barPending && this.barEntryShape(prev, cur)) {
      buy.barLineages = buy.barLineages.filter((l) => l.sl === null || (!l.sl.invalidated && l.bar2 !== null));
      buy.barSubCounter += 1;
      const subLabel = `${labelId}.${buy.barSubCounter}`;
      buy.barLineages.push(new BarLineage(subLabel, cur.h, cur.l));
      buy.barPending = false;
      buy.barHighPool = Math.max(buy.barHighPool, cur.h);
      ev.push(`BAR(${subLabel})`);
    }

    const newest = buy.barLineages.length > 0 ? buy.barLineages[buy.barLineages.length - 1] : null;
    if (buy.active && newest !== null && newest.sl !== null && !newest.sl.sl2) {
      const lo = newest.sl.refLow;
      const hi = newest.sl.refHigh;
      if (
        cur.l >= prev.l &&
        cur.h > prev.h &&
        cur.h - prev.h >= THRESH - EPS &&
        cur.c >= prev.h &&
        lo <= cur.l &&
        cur.h <= hi
      ) {
        buy.barSubCounter += 1;
        const subLabel = `${labelId}.${buy.barSubCounter}`;
        buy.barLineages.push(new BarLineage(subLabel, cur.h, cur.l));
        buy.barHighPool = Math.max(buy.barHighPool, cur.h);
        ev.push(`BAR(${subLabel})`);
      }
    }

    return ev;
  }

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
      rear.sl = new RearSL(cur.l);
      buy.barLineages = [];
      buy.barSubCounter = 0;
      buy.red1 = null;
      buy.barPending = false;
      return ev;
    }
    const red1Preexisting = buy.red1 !== null && buy.red1.active;
    if (red1Preexisting) {
      ev.push(...this.evalRed1Generic(pc, buy, rear, prev, cur));
    } else if (rear.rear2 !== null && !rear.red2Ever) {
      ev.push(...this.attachFreshRed1(pc, buy, rear, prev, cur));
    }
    return ev;
  }

  private evalRearSlProgress(
    pc: ParentCycle,
    buy: Buy,
    rear: Rear,
    _sl: RearSL,
    prev: Day,
    cur: Day,
    preTodayRear2Ref: number | null
  ): string[] {
    const ev: string[] = [];
    const labelId = branchLabel(pc.id);
    const ref = preTodayRear2Ref !== null ? preTodayRear2Ref : (rear.rear2 as Bar2).refHigh;
    const isReenter = cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
    if (isReenter && !this.milestoneBlocked(pc)) {
      buy.rearReenter = new RearReenter(cur.h, cur.l);
      ev.push(`REAR RE-ENTER(${labelId})`);
      rear.dormant = true;
      if (rear.rear2 !== null) {
        rear.rear2.dormant = true;
      }
      return ev;
    }
    return ev;
  }

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
      rre.sl = new RearReenterSL(cur.l);
      buy.red1 = null;
      buy.barPending = false;
      return ev;
    }
    const red1Preexisting = buy.red1 !== null && buy.red1.active;
    if (red1Preexisting) {
      ev.push(...this.evalRed1Generic(pc, buy, rre, prev, cur));
    } else if (rre.rre2 !== null && !rre.red2Ever) {
      ev.push(...this.attachFreshRed1(pc, buy, rre, prev, cur));
    }
    return ev;
  }

  private evalRearReenterSlProgress(
    pc: ParentCycle,
    buy: Buy,
    rre: RearReenter,
    _sl: RearReenterSL,
    prev: Day,
    cur: Day,
    preTodayRre2Ref: number | null
  ): string[] {
    const ev: string[] = [];
    const labelId = branchLabel(pc.id);
    const ref = preTodayRre2Ref !== null ? preTodayRre2Ref : (rre.rre2 as Bar2).refHigh;
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
export function computeBar2VariantEvents(rows: HistoryRowLike[]): Map<string, string> {
  const days: Day[] = rows
    .filter((r) => r.open !== null && r.high !== null && r.low !== null && r.close !== null)
    .map((r) => ({
      date: r.date,
      o: r.open as number,
      h: r.high as number,
      l: r.low as number,
      c: r.close as number,
    }));

  const engine = new TZEngine();
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
