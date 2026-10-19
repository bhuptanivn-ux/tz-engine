// DTF BAR THEORY -- a DTF-only theory built on the SAME event vocabulary as
// lib/dtfBar.ts (TZ GREEN, RED1/RED2, TZ BUY, BAR1/BAR2, REAR, REAR RE-ENTER)
// but with a different hierarchy, confirmed against real data (PAYTM) rather
// than ported from the WTF/PRIME TREND rulebook. Kept as its own file per
// DTF_THEORIES_RULEBOOK.md's own convention: a related but structurally
// different theory gets its own file, not a patch onto another one.
// lib/dtfBar.ts itself is untouched by this file.
//
// Confirmed differences from lib/dtfBar.ts (this module's own first pass,
// NOT yet verified beyond the PAYTM dates checked so far):
//
// 1. TZ BUY's own SL escalates to SL2 the same way the nested BAR lineage's
//    own SL already does in lib/dtfBar.ts: while TZ BUY sits SL'd (not yet
//    reactivated), a quiet lower low ratchets the SL's own reference low
//    down ("TZ BUY SL LL"); a candle that closes decisively AT LEAST 0.20
//    pts further below whatever that reference currently is -- even on the
//    very next candle, with no intervening reactivation -- is TZ BUY SL 2.
//    (lib/dtfBar.ts has no such escalation path at all: reactivation always
//    resets buy.sl to null, so a second failure there can only ever
//    re-fire plain "TZ BUY SL".)
// 2. BAR ENTRY (BAR2) reactivates DIRECTLY above its own frozen reference
//    high after a BAR ENTRY SL -- no intermediate "BAR1 reforms first" step,
//    no RED1->RED2 gate. Each such reactivation is reported as its OWN
//    separate row (not folded silently into the row that preceded its SL).
//    BAR ENTRY's own SL escalates to SL2 the same quiet-ratchet way TZ BUY's
//    does (point 1), mirrored for symmetry -- NOT yet independently
//    confirmed against real data, flag any mismatch.
//    RED1->RED2 is reserved for the NESTED "BAR 1 - BAR 2" cascade once BAR
//    ENTRY is first confirmed (not yet implemented in this module).
// 3. TZ BUY SL 2 opens TWO doors at once, which then race:
//      (a) REAR, above the dying TZ BUY's own top reference, and
//      (b) a fresh cycle (TZ GREEN(N+1) -> RED1 -> RED2 -> TZ BUY(N+1)).
//    Whichever occurs is reportable. If ONLY REAR occurs, REAR is live. If
//    TZ BUY(N+1) ever forms -- whether before or after REAR -- TZ BUY(N+1)
//    takes reporting preference; REAR (if it had activated) goes dormant,
//    and is fully terminated once TZ BUY(N+1) itself reaches BAR ENTRY. A
//    REAR that never activated at all before being superseded is left out
//    of the report entirely (same Filter-rule convention as a bare,
//    never-escalated tier).

import { THRESH, EPS, type Day, type HistoryRowLike } from "./tzEngineWtf";

function breaksRef(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

/** The plain day-over-day breakout BAR1/TZ BUY/TZ GREEN all use. */
function bar1Shape(prev: Day, cur: Day): boolean {
  return cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h;
}

function isSl(cur: Day, refLow: number): boolean {
  return cur.l <= refLow && refLow - cur.l >= THRESH - EPS && cur.c <= refLow + EPS;
}

function quietHh(cur: Day, refHigh: number): number | null {
  return cur.h > refHigh ? cur.h : null;
}

function quietLl(cur: Day, refLow: number): number | null {
  if (cur.l >= refLow) return null;
  const gap = refLow - cur.l;
  if ((gap >= THRESH - EPS && cur.c > refLow + EPS) || gap < THRESH - EPS) return cur.l;
  return null;
}

// ---------------------------------------------------------------------
// State objects
// ---------------------------------------------------------------------

export class Red {
  active = true;
  constructor(public refHigh: number, public refLow: number) {}
}

/** A tier's own SL object, tracking the confirmed quiet-ratchet-then-
 * decisive-second-breach escalation to "SL2" -- shared shape for TZ BUY's
 * own SL and BAR ENTRY's own SL (point 1/2 above). */
export class TierSL {
  sl2 = false;
  constructor(public refHigh: number, public refLow: number) {}
}

/** BAR ENTRY (BAR2) -- reactivates directly above its own frozen reference
 * high; each reactivation is reported as its own row by the caller. */
export class Bar2Entry {
  sl: TierSL | null = null;
  constructor(public refHigh: number, public refLow: number) {}
}

/** BAR1 -- the tier-1 formation underneath a TZ BUY/REAR host, before its
 * first escalation to BAR ENTRY (BAR2). */
export class BarLineage {
  bar2: Bar2Entry | null = null;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

export class RearSL {
  constructor(public refLow: number) {}
}
export class RearReenter {
  sl: RearSL | null = null;
  constructor(public refHigh: number, public refLow: number) {}
}
export class Rear {
  active = true;
  rear2: Bar2Entry | null = null;
  sl: RearSL | null = null;
  reenter: RearReenter | null = null;
  red: Red | null = null;
  redEver = false;
  barLineages: BarLineage[] = [];
  barPending = false;
  barGen = 0;
  barDeadLabels = new Set<number>();
  /** Once true, this REAR is confirmed dormant (superseded by a fresh
   * TZ BUY(N+1)) -- still tracked internally (per the module comment,
   * REAR "keeps climbing") but never again reported as live. */
  dormant = false;
  constructor(public refHigh: number, public refLow: number) {}
}

export class TzBuy {
  active = true;
  refHigh: number;
  refLow: number;
  sl: TierSL | null = null;
  /** True once this TZ BUY's own SL2 has fired -- opens the REAR-vs-fresh-
   * cycle race (point 3 above). TZ BUY itself never reactivates again past
   * this point (the race's two outcomes supersede it). Distinct from
   * `rearDoorOpen`: a nested BAR ENTRY's own SL2 also lets REAR form (same
   * as lib/dtfBar.ts's plain rearGateOpen), but that alone does NOT put
   * this cycle into the fresh-cycle race -- only TZ BUY's own SL2 does. */
  rearRace = false;
  /** True once EITHER this flag's own trigger (BAR ENTRY SL2 under this
   * TZ BUY) or `rearRace` has fired -- REAR may form above currentTopRef.
   * Kept separate from `rearRace` so only TZ BUY's own SL2 enables the
   * race-with-a-fresh-cycle behavior. */
  rearDoorOpen = false;
  rear: Rear | null = null;
  red: Red | null = null;
  redEver = false;
  barLineages: BarLineage[] = [];
  barPending = false;
  barGen = 0;
  barDeadLabels = new Set<number>();
  constructor(refHigh: number, refLow: number) {
    this.refHigh = refHigh;
    this.refLow = refLow;
  }
}

/** One full TZ GREEN -> ... lineage. */
export class Cycle {
  active = true;
  redEver = false;
  red: Red | null = null;
  buy: TzBuy | null = null;
  constructor(public seq: number, public refHigh: number, public refLow: number) {}
}

type BarHost = TzBuy | Rear;

// ---------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------

export class DtfBarTheoryEngine {
  cycles: Cycle[] = [];
  private seq = 0;

  process(prev: Day, cur: Day): string[] {
    const ev: string[] = [];

    // Advance every still-active cycle. Normally there is at most one;
    // during a TZ BUY SL2 race there can be exactly two -- the dying
    // cycle (seeking REAR) and a fresh one (seeking its own TZ BUY).
    for (const cyc of this.cycles) {
      if (cyc.active) ev.push(...this.evalCycle(cyc, prev, cur));
    }

    // A fresh cycle may spawn whenever nothing is blocking it: either no
    // cycle is active at all, or every active cycle's own TZ BUY has
    // already lost its own door (rearRace) -- i.e. a race is already in
    // progress, and this is the "fresh cycle" side of that race.
    const blocking = this.cycles.some((c) => c.active && !(c.buy !== null && c.buy.rearRace));
    if (!blocking && bar1Shape(prev, cur)) {
      this.seq += 1;
      const fresh = new Cycle(this.seq, cur.h, cur.l);
      this.cycles.push(fresh);
      ev.push("TZ GREEN");
    }

    return ev;
  }

  // -----------------------------------------------------------------
  private evalCycle(cyc: Cycle, prev: Day, cur: Day): string[] {
    // Once this cycle's own TZ BUY has lost its door for good (rearRace),
    // the cycle's own outer "TZ GREEN" tier is retired -- only the REAR-
    // vs-fresh-cycle race inside evalBuy matters from here on. Evaluating
    // the outer tier too would both double-report quiet climbs that the
    // fresh sibling cycle is already reporting, and risk a stray
    // "TZ GREEN SL" cutting the race short on an old, irrelevant reference.
    if (cyc.buy !== null && cyc.buy.rearRace) return this.evalBuy(cyc, cyc.buy, prev, cur);

    const ev: string[] = [];
    const isSlNow = isSl(cur, cyc.refLow);
    const hasLiveBuy = cyc.buy !== null && cyc.buy.active;

    const newHigh = quietHh(cur, cyc.refHigh);
    if (newHigh !== null) {
      cyc.refHigh = newHigh;
      if (!hasLiveBuy && !isSlNow) ev.push("TZ GREEN HH");
    }
    const newLow = quietLl(cur, cyc.refLow);
    if (newLow !== null) {
      cyc.refLow = newLow;
      if (!hasLiveBuy) ev.push("TZ GREEN LL");
    }
    if (cyc.buy !== null && cyc.buy.refHigh > cyc.refHigh) cyc.refHigh = cyc.buy.refHigh;

    if (isSlNow) {
      ev.push("TZ GREEN SL");
      cyc.active = false;
      return ev;
    }

    if (cyc.buy === null) {
      if (cyc.red === null) {
        if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
          cyc.redEver = true;
          cyc.red = new Red(cur.h, cur.l);
          ev.push("RED1");
        }
      } else if (cyc.red.active) {
        const redEv = this.evalRed(cyc.red, prev, cur, "RED1", "RED2", "RED1 HH");
        ev.push(...redEv);
        if (redEv.some((e) => e.startsWith("INVALID"))) cyc.red = null;
      } else if (bar1Shape(prev, cur)) {
        cyc.buy = new TzBuy(cur.h, cur.l);
        ev.push("TZ BUY");
      }
    }

    if (cyc.buy !== null) ev.push(...this.evalBuy(cyc, cyc.buy, prev, cur));
    return ev;
  }

  // -----------------------------------------------------------------
  private evalRed(red: Red, prev: Day, cur: Day, label1: string, label2: string, hhLabel: string): string[] {
    const ev: string[] = [];
    if (cur.h > red.refHigh && cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) {
      ev.push(`INVALID ${label1}`);
      red.active = false;
      return ev;
    }
    if (cur.h > red.refHigh) {
      red.refHigh = cur.h;
      ev.push(hhLabel);
    }
    if (cur.l < red.refLow) {
      const red2Holds = cur.h <= prev.h && red.refLow - cur.l >= THRESH - EPS && cur.c <= red.refLow + EPS;
      if (red2Holds) {
        red.active = false;
        ev.push(label2);
      } else {
        red.refLow = cur.l;
        ev.push(`${label1} LL`);
      }
    }
    return ev;
  }

  // -----------------------------------------------------------------
  private evalBuy(cyc: Cycle, buy: TzBuy, prev: Day, cur: Day): string[] {
    let ev: string[] = [];

    if (buy.rearDoorOpen) {
      // TZ BUY's own door is closed for good -- only REAR (above TZ BUY's
      // own dying top reference) is still evaluated here. The race-with-a-
      // fresh-cycle behavior (spawning, dormancy, termination) applies ONLY
      // when the door opened via TZ BUY's OWN SL2 (`rearRace`) -- a nested
      // BAR ENTRY SL2 alone just opens REAR's door, same as
      // lib/dtfBar.ts's plain rearGateOpen, with no race semantics.
      if (buy.rearRace) {
        // Full termination (stop evaluating this cycle at all) only
        // happens once a sibling's own TZ BUY(N+1) reaches BAR ENTRY -- up
        // to that point REAR (if it activated) is merely dormant, still
        // tracked internally per the module comment ("REAR keeps
        // climbing").
        if (this.siblingReachedBarEntry(cyc)) {
          cyc.active = false;
          return ev;
        }
      }

      if (buy.rear === null) {
        const ref = this.currentTopRef(buy);
        if (breaksRef(prev, cur, ref)) {
          buy.rear = new Rear(cur.h, cur.l);
          return ["REAR"];
        }
        return ev;
      }
      const rearEv = this.evalRear(buy, buy.rear, prev, cur);
      // Supersession check: once a SIBLING fresh cycle's own TZ BUY exists,
      // this REAR (if it ever activated) goes dormant for good. Only
      // meaningful when this door opened via TZ BUY's own SL2 -- a fresh
      // sibling can only ever exist in that case (see process()'s own
      // `blocking` check, gated on `rearRace`, not `rearDoorOpen`).
      if (buy.rearRace && !buy.rear.dormant && this.siblingTzBuyExists(cyc)) {
        buy.rear.dormant = true;
        rearEv.push("REAR DORMANT (TZ BUY N+1)");
      }
      return rearEv;
    }

    if (buy.active) {
      const isSlNow = isSl(cur, buy.refLow);
      const newHigh = quietHh(cur, buy.refHigh);
      if (newHigh !== null) {
        buy.refHigh = newHigh;
        if (!isSlNow) ev.push("TZ BUY HH");
      }
      const newLow = quietLl(cur, buy.refLow);
      if (newLow !== null) {
        buy.refLow = newLow;
        ev.push("TZ BUY LL");
      }

      if (isSlNow) {
        buy.sl = new TierSL(buy.refHigh, cur.l);
        ev.push("TZ BUY SL");
        buy.active = false;
        buy.red = null;
        buy.barLineages = [];
        buy.barPending = false;
        return ev;
      }
    } else if (buy.sl !== null) {
      if (breaksRef(prev, cur, buy.sl.refHigh)) {
        buy.active = true;
        buy.refHigh = cur.h;
        buy.refLow = cur.l;
        buy.sl = null;
        ev.push("TZ BUY");
        return ev;
      }
      // Quiet-ratchet-then-decisive-second-breach escalation to SL2 --
      // same shape as the nested BAR lineage's own BAR SL -> BAR SL2.
      if (cur.l < buy.sl.refLow) {
        if (isSl(cur, buy.sl.refLow)) {
          buy.sl.sl2 = true;
          buy.rearRace = true;
          buy.rearDoorOpen = true;
          ev.push("TZ BUY SL 2");
        } else {
          buy.sl.refLow = cur.l;
          ev.push("TZ BUY SL LL");
        }
      }
      return ev;
    } else {
      return ev;
    }

    if (buy.red === null) {
      if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
        buy.redEver = true;
        buy.red = new Red(cur.h, cur.l);
        ev.push("RED1");
      }
    } else if (buy.red.active) {
      const redEv = this.evalRed(buy.red, prev, cur, "RED1", "RED2", "RED1 HH");
      ev.push(...redEv);
      if (redEv.includes("RED2")) buy.barPending = true;
      else if (redEv.some((e) => e.startsWith("INVALID"))) buy.red = null;
    }

    ev.push(...this.evalBarLineages(buy, prev, cur));
    return ev;
  }

  /** True once some OTHER, still-active (sibling) cycle's own TZ BUY
   * exists. Used only to detect when a dying cycle's own REAR must go
   * dormant per the race. Must filter on `active` -- otherwise a long-dead,
   * unrelated cycle from years earlier (never pruned from `this.cycles`)
   * would falsely count as a sibling forever. */
  private siblingTzBuyExists(cyc: Cycle): boolean {
    return this.cycles.some((c) => c !== cyc && c.active && c.buy !== null);
  }

  /** True once some OTHER, still-active (sibling) cycle's own TZ BUY has
   * itself reached BAR ENTRY (BAR2) -- the point at which a dying cycle's
   * REAR race is fully terminated, not merely dormant. */
  private siblingReachedBarEntry(cyc: Cycle): boolean {
    return this.cycles.some(
      (c) => c !== cyc && c.active && c.buy !== null && c.buy.barLineages.some((lin) => lin.bar2 !== null)
    );
  }

  // -----------------------------------------------------------------
  private currentTopRef(host: BarHost): number {
    let top = host.refHigh;
    for (const lin of host.barLineages) {
      top = Math.max(top, lin.refHigh);
      if (lin.bar2 !== null) top = Math.max(top, lin.bar2.refHigh);
    }
    return top;
  }

  private nextBarLabel(host: BarHost): string {
    let n: number;
    if (host.barDeadLabels.size > 0) {
      n = Math.min(...host.barDeadLabels);
      host.barDeadLabels.delete(n);
    } else {
      host.barGen += 1;
      n = host.barGen;
    }
    return String(n);
  }

  private evalBarLineages(host: BarHost, prev: Day, cur: Day): string[] {
    const ev: string[] = [];

    if (host.barPending && host.barLineages.length === 0 && bar1Shape(prev, cur)) {
      const label = this.nextBarLabel(host);
      host.barLineages.push(new BarLineage(label, cur.h, cur.l));
      host.barPending = false;
      ev.push(`BAR1(${label})`);
      return ev;
    }
    if (host.barLineages.length === 0) return ev;

    const lin = host.barLineages[host.barLineages.length - 1];

    if (lin.bar2 === null) {
      // Still at BAR1 (tier-1) -- escalate to BAR ENTRY (BAR2), or a bare,
      // unreported SL that reforms unrestricted ("Immediately BAR1").
      if (breaksRef(prev, cur, lin.refHigh)) {
        lin.bar2 = new Bar2Entry(cur.h, cur.l);
        ev.push(`BAR2(${lin.label})`);
        return ev;
      }
      const slNow = isSl(cur, lin.refLow);
      const newHigh = quietHh(cur, lin.refHigh);
      if (newHigh !== null) {
        lin.refHigh = newHigh;
        if (!slNow) ev.push(`BAR1 HH(${lin.label})`);
      }
      const newLow = quietLl(cur, lin.refLow);
      if (newLow !== null) {
        lin.refLow = newLow;
        ev.push(`BAR1 LL(${lin.label})`);
      }
      if (slNow) {
        const n = parseInt(lin.label, 10);
        host.barDeadLabels.add(n);
        host.barLineages = [];
        host.barPending = true; // bare BAR1 SL re-seeks a fresh BAR1 unrestricted
        ev.push(`BAR1 SL(${lin.label})`);
      }
      return ev;
    }

    // BAR ENTRY (BAR2) is live.
    const bar2 = lin.bar2;
    if (bar2.sl === null) {
      const isSlNow = isSl(cur, bar2.refLow);
      const newHigh = quietHh(cur, bar2.refHigh);
      if (newHigh !== null) {
        bar2.refHigh = newHigh;
        if (!isSlNow) ev.push(`BAR2 HH(${lin.label})`);
      }
      const newLow = quietLl(cur, bar2.refLow);
      if (newLow !== null) {
        bar2.refLow = newLow;
        ev.push(`BAR2 LL(${lin.label})`);
      }
      if (isSlNow) {
        bar2.sl = new TierSL(bar2.refHigh, cur.l);
        ev.push(`BAR2 SL(${lin.label})`);
      }
      return ev;
    }

    // BAR ENTRY SL'd -- reactivates DIRECTLY above its own frozen reference
    // high (no BAR1 restart), or escalates to SL2 via the same quiet-
    // ratchet-then-decisive-second-breach shape as TZ BUY's own SL.
    const sl = bar2.sl;
    if (breaksRef(prev, cur, sl.refHigh)) {
      const newLabel = this.nextBarLabel(host);
      const freshBar2 = new Bar2Entry(cur.h, cur.l);
      host.barLineages = [new BarLineage(newLabel, sl.refHigh, sl.refLow)];
      host.barLineages[0].bar2 = freshBar2;
      ev.push(`BAR2(${newLabel})`);
      return ev;
    }
    if (cur.l < sl.refLow) {
      if (isSl(cur, sl.refLow)) {
        sl.sl2 = true;
        host.refHigh = this.currentTopRef(host);
        host.barLineages = [];
        host.barPending = false;
        if (host instanceof TzBuy) {
          // Nested BAR ENTRY's own SL2 opens REAR's door, but -- unlike TZ
          // BUY's own SL2 -- does NOT put this cycle into the race with a
          // fresh sibling (rearRace stays false; see the TzBuy field docs).
          host.rearDoorOpen = true;
          ev.push(`BAR2 SL2(${lin.label})`);
        } else {
          host.active = false;
          host.sl = new RearSL(sl.refLow);
          host.red = null;
          ev.push(`BAR2 SL2(${lin.label})`);
        }
      } else {
        sl.refLow = cur.l;
        ev.push(`BAR2 SL LL(${lin.label})`);
      }
    }
    return ev;
  }

  // -----------------------------------------------------------------
  private evalRear(buy: TzBuy, rear: Rear, prev: Day, cur: Day): string[] {
    const ev: string[] = [];

    if (rear.active) {
      let tier: { refHigh: number; refLow: number } = rear.reenter !== null ? rear.reenter : rear;
      let baseTierName = rear.reenter !== null ? "REAR RE-ENTER" : "REAR";

      if (rear.reenter === null && rear.rear2 === null && breaksRef(prev, cur, tier.refHigh)) {
        rear.rear2 = new Bar2Entry(cur.h, cur.l);
        ev.push("REAR2");
        return ev;
      }
      if (rear.rear2 !== null && rear.reenter === null) {
        tier = rear.rear2;
        baseTierName = "REAR2";
      }

      const isSlNow = isSl(cur, tier.refLow);
      const newHigh = quietHh(cur, tier.refHigh);
      if (newHigh !== null) {
        tier.refHigh = newHigh;
        if (!isSlNow) ev.push(`${baseTierName} HH`);
      }
      const newLow = quietLl(cur, tier.refLow);
      if (newLow !== null) {
        tier.refLow = newLow;
        ev.push(`${baseTierName} LL`);
      }

      if (isSlNow) {
        rear.sl = new RearSL(cur.l);
        rear.active = false;
        ev.push(`${baseTierName} SL`);
        rear.red = null;
        rear.barLineages = [];
        rear.barPending = false;
        return ev;
      }
    } else {
      let ref: number;
      if (rear.reenter !== null) {
        ref = rear.reenter.refHigh;
      } else {
        ref = Math.max(rear.refHigh, this.currentTopRef(buy));
        if (rear.rear2 !== null) ref = Math.max(ref, rear.rear2.refHigh);
      }
      if (breaksRef(prev, cur, ref)) {
        rear.active = true;
        if (rear.reenter === null) {
          rear.reenter = new RearReenter(cur.h, cur.l);
        } else {
          rear.reenter.refHigh = cur.h;
          rear.reenter.refLow = cur.l;
        }
        ev.push("REAR RE-ENTER");
        rear.sl = null;
      }
      return ev;
    }

    if (rear.red === null) {
      if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
        rear.redEver = true;
        rear.red = new Red(cur.h, cur.l);
        ev.push("RED1");
      }
    } else if (rear.red.active) {
      const redEv = this.evalRed(rear.red, prev, cur, "RED1", "RED2", "RED1 HH");
      ev.push(...redEv);
      if (redEv.includes("RED2")) rear.barPending = true;
      else if (redEv.some((e) => e.startsWith("INVALID"))) rear.red = null;
    }

    ev.push(...this.evalBarLineages(rear, prev, cur));
    return ev;
  }
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

/** Runs a fresh DtfBarTheoryEngine over a sequence of OHLC rows (ascending
 * by date) and produces a date -> comma-joined-event-string map, same shape
 * as lib/dtfBar.ts's own computeDtfBarEvents. */
export function computeDtfBarTheoryEvents(rows: HistoryRowLike[]): Map<string, string> {
  const days = toDays(rows);
  const engine = new DtfBarTheoryEngine();
  const map = new Map<string, string>();
  for (let i = 1; i < days.length; i++) {
    const events = engine.process(days[i - 1], days[i]);
    if (events.length > 0) map.set(days[i].date, events.join(", "));
  }
  return map;
}
