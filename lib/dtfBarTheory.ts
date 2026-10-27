// DTF BAR THEORY -- a DTF-only theory built on the SAME event vocabulary as
// lib/dtfBar.ts (TZ GREEN, RED1/RED2, TZ BUY, BAR1/BAR2, REAR, REAR RE-ENTER)
// but with a different hierarchy, confirmed against real data (PAYTM) rather
// than ported from the WTF/PRIME TREND rulebook. Kept as its own file per
// DTF_THEORIES_RULEBOOK.md's own convention: a related but structurally
// different theory gets its own file, not a patch onto another one.
// lib/dtfBar.ts itself is untouched by this file.
//
// Rules below are user-confirmed against PAYTM daily (2021-11 -> 2023-06)
// unless marked otherwise.
//
// 1. Flow:
//      TZ GREEN -> RED1 -> RED2 -> TZ BUY -> TZ BUY ENTRY -> RED1 -> RED2
//      -> BAR1 -> BAR ENTRY -> RED1 -> RED2 -> BAR1 -> BAR2 -> ...
//    RED1 -> RED2 needs TZ GREEN active (no TZ GREEN SL). TZ BUY needs
//    RED1 -> RED2 completed. TZ BUY ENTRY (formerly "TZ BUY 2") forms above
//    TZ BUY's reference high and is required before the first RED1 under
//    TZ BUY. Once BAR ENTRY is received, RED1 -> RED2 -> BAR1 -> BAR2
//    repeats until BAR SL 2. Only ONE cycle is live outside a race: a
//    breakout before TZ BUY is just TZ GREEN HH (tracked, not recorded).
// 2. TZ BUY SL. TZ BUY's own SL stays at TZ BUY's own low. There is no TZ
//    BUY SL 2. A bare TZ BUY (no TZ BUY ENTRY) SL lets a fresh TZ BUY form
//    straight away while TZ GREEN is active. After TZ BUY ENTRY, TZ BUY SL
//    opens the race (point 5).
// 3. TZ BUY ENTRY has its own reference high/low and its own SL ("TZ BUY
//    ENTRY SL", e.g. 06/05/22). TZ BUY stays active through it, and the RED
//    gate / a RED2-armed BAR1 keep running, so BAR -> BAR ENTRY is still
//    possible. Not yet built: reactivation when only RED1 (no RED2) exists
//    -- REAR above TZ BUY ENTRY's reference high, then TZ BUY ENTRY above
//    that REAR.
// 4. BAR ENTRY (BAR2) reactivates DIRECTLY above its own frozen reference
//    high after a BAR ENTRY SL; while SL'd, a higher high that fails to
//    reactivate it is INVALID BAR ENTRY HH and raises the frozen high. BAR
//    ENTRY's own SL has NO SL2: "BAR SL" -> "BAR SL 2" belongs to the BAR1
//    that produced the live BAR ENTRY (the anchor), from that BAR1's own
//    low, quiet-ratchet-then-decisive-second-breach shape. The previous BAR
//    ENTRY stays live alongside the next round's BAR1 until the NEXT BAR2.
//    The RED gate and a BAR1 it armed keep running through a BAR ENTRY SL.
//    A bare BAR1 SL ("BAR SL") re-forms straight away, without a RED gate.
//    Once BAR ENTRY confirms, TZ BUY HH / TZ BUY ENTRY HH aren't recorded.
// 5. The race -- opened by TZ BUY SL after TZ BUY ENTRY, or by BAR SL 2:
//      (a) REAR, above the dying TZ BUY's own top reference, and
//      (b) a fresh cycle (TZ GREEN B -> RED1 -> RED2 -> TZ BUY(N+1)).
//    As built (pending the user's latest rules): TZ BUY(N+1) takes
//    preference; an activated REAR goes dormant (never reported) and is
//    terminated once TZ BUY(N+1) reaches BAR ENTRY.

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

/** TZ BUY ENTRY (formerly "TZ BUY 2") -- TZ BUY's own escalation above its
 * reference high. Has its OWN reference high/low and its own SL ("TZ BUY
 * ENTRY SL"), while TZ BUY's own SL stays at TZ BUY's own low. */
export class TzBuyEntry {
  sl = false;
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
  /** Once this BAR1 has produced a BAR ENTRY it is the anchor of the BAR
   * stage: its own reference low keeps being tracked, and its own SL
   * ("BAR SL") -> "BAR SL 2" ends the whole BAR stage. */
  barSl: TierSL | null = null;
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
  /** True while this host may seek a RED1 (see evalRedGate). REAR seeks
   * one straight away. */
  redSeek = true;
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
  /** True while a BARE TZ BUY (no TZ BUY ENTRY yet) sits SL'd: no SL2 path,
   * and a new TZ BUY may form straight away on the plain breakout shape
   * while TZ GREEN is active (same as a bare BAR1 SL re-forming). */
  bareSl = false;
  /** True once this TZ BUY's own SL2, or a nested BAR ENTRY's own SL2
   * under it, has fired -- opens the REAR-vs-fresh-cycle race (point 3
   * above): REAR may form above currentTopRef, and a fresh sibling cycle
   * (TZ GREEN B) may spawn. TZ BUY itself never reactivates again past this
   * point (the race's two outcomes supersede it). */
  rearRace = false;
  rear: Rear | null = null;
  /** True once a BAR ENTRY has confirmed under this TZ BUY -- from then on
   * TZ BUY HH is tracked but not recorded (user-confirmed). Reset when TZ
   * BUY SLs. */
  barEntryEver = false;
  /** TZ BUY ENTRY, once formed; cleared when TZ BUY SLs. */
  entry: TzBuyEntry | null = null;
  red: Red | null = null;
  redEver = false;
  /** True while this host may seek a RED1 (see evalRedGate). TZ BUY only
   * starts seeking once TZ BUY 2 forms. */
  redSeek = false;
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

/** One event, attributed to the cycle (Cycle.seq) that produced it. */
export interface TaggedEvent {
  seq: number;
  text: string;
}

// ---------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------

export class DtfBarTheoryEngine {
  cycles: Cycle[] = [];
  private seq = 0;

  /** Advances one day and returns that day's events as plain text, merged
   * across every active cycle. Lossy when two cycles coincidentally emit
   * identical text on the same day -- reporting layers should use
   * processTagged() instead. */
  process(prev: Day, cur: Day): string[] {
    return this.processTagged(prev, cur).map((e) => e.text);
  }

  /** Same as process(), but each event carries the `seq` of the cycle that
   * produced it. During a TZ BUY SL2 / BAR SL2 race two cycles run concurrently (the
   * dying one's REAR and the fresh sibling), and their nested BAR lineages
   * can independently emit identical text on the same day (e.g. both reach
   * "BAR2(1)"), so a reporting layer must scope rows by `seq`, never by
   * matching event text alone. */
  processTagged(prev: Day, cur: Day): TaggedEvent[] {
    const ev: TaggedEvent[] = [];

    // Advance every still-active cycle. Normally there is at most one;
    // during a TZ BUY SL2 / BAR SL2 race there can be exactly two -- the dying
    // cycle (seeking REAR) and a fresh one (seeking its own TZ BUY).
    for (const cyc of this.cycles) {
      if (!cyc.active) continue;
      for (const text of this.evalCycle(cyc, prev, cur)) ev.push({ seq: cyc.seq, text });
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
      ev.push({ seq: fresh.seq, text: "TZ GREEN" });
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
      // TZ GREEN HH is tracked but not recorded (user: "No need to record
      // TZ GREEN HH").
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

    if (buy.rearRace) {
      // TZ BUY's own door is closed for good -- only REAR (above TZ BUY's
      // own dying top reference) is still evaluated here, racing a fresh
      // sibling cycle. Full termination (stop evaluating this cycle at all)
      // only happens once a sibling's own TZ BUY(N+1) reaches BAR ENTRY --
      // up to that point REAR (if it activated) is merely dormant, still
      // tracked internally per the module comment ("REAR keeps climbing").
      if (this.siblingReachedBarEntry(cyc)) {
        cyc.active = false;
        return ev;
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
      // this REAR (if it ever activated) goes dormant for good.
      if (!buy.rear.dormant && this.siblingTzBuyExists(cyc)) {
        buy.rear.dormant = true;
        rearEv.push("REAR DORMANT (TZ BUY N+1)");
      }
      return rearEv;
    }

    if (buy.active) {
      // TZ BUY ENTRY -- TZ BUY's own escalation above its current reference
      // high (same breakout test as BAR1 -> BAR2). Required before the first
      // RED1 under TZ BUY. It has its own reference low and SL; TZ BUY's own
      // SL stays at TZ BUY's own low (PAYTM 2022: TZ BUY 01/04 low 530.00).
      if (buy.entry === null && breaksRef(prev, cur, buy.refHigh)) {
        buy.entry = new TzBuyEntry(cur.h, cur.l);
        buy.refHigh = cur.h;
        buy.redSeek = true;
        buy.red = null;
        ev.push("TZ BUY ENTRY");
        return ev;
      }
      const isSlNow = isSl(cur, buy.refLow);
      const newHigh = quietHh(cur, buy.refHigh);
      if (newHigh !== null) {
        buy.refHigh = newHigh;
        // Once TZ BUY ENTRY exists its own HH is recorded instead.
        if (!isSlNow && buy.entry === null) ev.push("TZ BUY HH");
      }
      const newLow = quietLl(cur, buy.refLow);
      if (newLow !== null) {
        buy.refLow = newLow;
        ev.push("TZ BUY LL");
      }

      if (isSlNow) {
        // TZ BUY SL 2 no longer exists (user-confirmed). A bare TZ BUY (no
        // TZ BUY ENTRY) SL lets a fresh TZ BUY form straight away while TZ
        // GREEN is active (PAYTM 09/12/22 -> SL 19/12/22 -> TZ BUY 26/12/22).
        // After TZ BUY ENTRY, TZ BUY SL itself opens the race: a new
        // lineage vs REAR above TZ BUY's reference high.
        if (buy.entry !== null) buy.rearRace = true;
        else buy.bareSl = true;
        ev.push("TZ BUY SL");
        buy.active = false;
        buy.barEntryEver = false;
        buy.entry = null;
        buy.redSeek = false;
        buy.red = null;
        buy.barLineages = [];
        buy.barPending = false;
        return ev;
      }

      // TZ BUY ENTRY's own HH/LL/SL. TZ BUY stays active through a TZ BUY
      // ENTRY SL, and the RED gate / a RED2-armed BAR1 keep running
      // (cases a and b, user-confirmed).
      const entry = buy.entry;
      if (entry !== null && !entry.sl) {
        const entrySlNow = isSl(cur, entry.refLow);
        const eHigh = quietHh(cur, entry.refHigh);
        if (eHigh !== null) {
          entry.refHigh = eHigh;
          if (!entrySlNow && !buy.barEntryEver) ev.push("TZ BUY ENTRY HH");
        }
        const eLow = quietLl(cur, entry.refLow);
        if (eLow !== null) {
          entry.refLow = eLow;
          ev.push("TZ BUY ENTRY LL");
        }
        if (entrySlNow) {
          entry.sl = true;
          ev.push("TZ BUY ENTRY SL");
        }
      }
    } else if (buy.bareSl) {
      if (bar1Shape(prev, cur)) {
        buy.active = true;
        buy.bareSl = false;
        buy.refHigh = cur.h;
        buy.refLow = cur.l;
        ev.push("TZ BUY");
      }
      return ev;
    } else {
      return ev;
    }

    // BAR lineages first: a BAR ENTRY SL on the same candle cancels the
    // repeat's RED1 -> RED2 before it is evaluated.
    const barEv = this.evalBarLineages(buy, prev, cur);
    // BAR ENTRY confirming today already silences today's TZ BUY HH.
    if (!buy.barEntryEver && barEv.some((e) => /^BAR2\(/.test(e))) {
      buy.barEntryEver = true;
      ev = ev.filter((e) => e !== "TZ BUY HH" && e !== "TZ BUY ENTRY HH");
    }
    ev.push(...barEv);
    ev.push(...this.evalRedGate(buy, prev, cur));
    return ev;
  }

  /** True once some OTHER, still-active (sibling) cycle's own TZ BUY
   * exists. Used only to detect when a dying cycle's own REAR must go
   * dormant per the race. Must filter on `active` -- otherwise a long-dead,
   * unrelated cycle from years earlier (never pruned from `this.cycles`)
   * would falsely count as a sibling forever -- and on `seq` -- only a
   * cycle born after this one can be its TZ BUY(N+1); an OLDER cycle still
   * racing (PAYTM: cycle from 13/05/22, racing since its BAR SL 2 on
   * 29/09/22) made the REAR of 09/01/23 go dormant a day after forming,
   * long before TZ BUY(N+1) on 20/01/23. */
  private siblingTzBuyExists(cyc: Cycle): boolean {
    return this.cycles.some((c) => c.seq > cyc.seq && c.active && c.buy !== null);
  }

  /** True once some OTHER, still-active (sibling) cycle's own TZ BUY has
   * itself reached BAR ENTRY (BAR2) -- the point at which a dying cycle's
   * REAR race is fully terminated, not merely dormant. */
  private siblingReachedBarEntry(cyc: Cycle): boolean {
    return this.cycles.some(
      (c) => c.seq > cyc.seq && c.active && c.buy !== null && c.buy.barLineages.some((lin) => lin.bar2 !== null)
    );
  }

  // -----------------------------------------------------------------
  /** The RED1 -> RED2 gate under a TZ BUY/REAR host. Sought only while
   * `host.redSeek` is set: under TZ BUY from TZ BUY 2 on, under REAR from
   * its formation/re-entry, and again each time a BAR ENTRY (BAR2) forms
   * (the repeating BAR 1 - BAR 2 cascade). RED2 arms the next BAR1. */
  private evalRedGate(host: BarHost, prev: Day, cur: Day): string[] {
    if (!host.redSeek) return [];
    if (host.red === null) {
      if (cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l) {
        host.redEver = true;
        host.red = new Red(cur.h, cur.l);
        return ["RED1"];
      }
      return [];
    }
    const redEv = this.evalRed(host.red, prev, cur, "RED1", "RED2", "RED1 HH");
    if (redEv.includes("RED2")) {
      host.barPending = true;
      host.redSeek = false;
      host.red = null;
    } else if (redEv.some((e) => e.startsWith("INVALID"))) {
      host.red = null;
    }
    return redEv;
  }

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

  /** A BAR ENTRY (BAR2) just formed or reactivated: start seeking the next
   * RED1 -> RED2 of the repeating BAR 1 - BAR 2 cascade. */
  private armRepeat(host: BarHost): void {
    host.redSeek = true;
  }

  /** Evaluates every BAR lineage under a host. Normally there is one; during
   * a repeat round of the BAR 1 - BAR 2 cascade there can be two -- the
   * previous BAR ENTRY (still live: it is only superseded once the NEXT
   * BAR2 forms, user-confirmed) and the newer BAR1 seeking that BAR2. */
  private evalBarLineages(host: BarHost, prev: Day, cur: Day): string[] {
    const ev: string[] = [];

    // A RED2-armed BAR1 -- either the first under this host (or a bare-SL
    // reform), or the next round of the repeating cascade, alongside the
    // previous BAR ENTRY (which keeps running until this BAR1's own BAR2).
    if (host.barPending && bar1Shape(prev, cur)) {
      const label = this.nextBarLabel(host);
      host.barLineages = host.barLineages.filter((l) => l.bar2 !== null);
      host.barLineages.push(new BarLineage(label, cur.h, cur.l));
      host.barPending = false;
      ev.push(`BAR1(${label})`);
      return ev;
    }

    // Oldest first; stop once one of them ends the host's whole BAR stage
    // (BAR SL2) or replaces the set (the newer BAR1 reaching BAR2).
    for (const lin of [...host.barLineages]) {
      if (!host.barLineages.includes(lin)) continue;
      const res = this.evalLineage(host, lin, prev, cur);
      ev.push(...res.ev);
      if (res.stop) break;
    }
    return ev;
  }

  private evalLineage(host: BarHost, lin: BarLineage, prev: Day, cur: Day): { ev: string[]; stop: boolean } {
    const ev: string[] = [];

    if (lin.bar2 === null) {
      // Still at BAR1 (tier-1) -- escalate to BAR ENTRY (BAR2), or a bare,
      // unreported SL that reforms unrestricted ("Immediately BAR1").
      if (breaksRef(prev, cur, lin.refHigh)) {
        lin.bar2 = new Bar2Entry(cur.h, cur.l);
        // The NEXT BAR2 has formed: the previous BAR ENTRY is superseded,
        // and this BAR1 becomes the BAR stage's anchor.
        host.barLineages = [lin];
        this.armRepeat(host);
        ev.push(`BAR2(${lin.label})`);
        return { ev, stop: true };
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
        host.barDeadLabels.add(parseInt(lin.label, 10));
        host.barLineages = host.barLineages.filter((l) => l !== lin);
        host.barPending = true; // bare BAR1 SL re-seeks a fresh BAR1 unrestricted
        ev.push(`BAR SL(${lin.label})`);
      }
      return { ev, stop: false };
    }

    // This BAR1 has produced a BAR ENTRY: it is the anchor. Its own SL ->
    // SL2 ends the whole BAR stage (confirmed, PAYTM 2022: BAR1 06/07 low
    // 656.30 -> BAR 1 LL 26/09 651.00 -> BAR SL 28/09 -> BAR SL 2 29/09).
    const anchor = this.evalAnchorSl(host, lin, cur);
    ev.push(...anchor.ev);
    if (anchor.ended) return { ev, stop: true };
    if (lin.barSl === null && anchor.ev.length === 0) {
      const newLow = quietLl(cur, lin.refLow);
      if (newLow !== null) {
        lin.refLow = newLow;
        ev.push(`BAR1 LL(${lin.label})`);
      }
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
        // The RED gate and any RED2-armed BAR1 keep running through a BAR
        // ENTRY SL (confirmed, PAYTM 26/07/22 and 29/08 -> 09/09/22).
        bar2.sl = new TierSL(bar2.refHigh, cur.l);
        ev.push(`BAR2 SL(${lin.label})`);
      }
      return { ev, stop: false };
    }

    // BAR ENTRY SL'd -- it has no SL2 of its own (the anchor BAR1 does).
    // It reactivates DIRECTLY above its own frozen reference high; a higher
    // high that fails to reactivate is INVALID BAR ENTRY HH and raises that
    // frozen high (confirmed, PAYTM 14/07, 19/07, 20/07/22 -> 21/07/22).
    const sl = bar2.sl;
    if (breaksRef(prev, cur, sl.refHigh)) {
      lin.bar2 = new Bar2Entry(cur.h, cur.l);
      this.armRepeat(host);
      ev.push(`BAR2(${lin.label})`);
      return { ev, stop: false };
    }
    if (cur.h > sl.refHigh) {
      sl.refHigh = cur.h;
      ev.push(`INVALID BAR2 HH(${lin.label})`);
    }
    return { ev, stop: false };
  }

  /** The anchor BAR1's own SL -> SL2 (same quiet-ratchet-then-decisive-
   * second-breach shape as TZ BUY SL -> SL 2). `ended` is true once BAR SL 2
   * has ended the whole BAR stage. */
  private evalAnchorSl(host: BarHost, lin: BarLineage, cur: Day): { ev: string[]; ended: boolean } {
    if (lin.barSl === null) {
      if (isSl(cur, lin.refLow)) {
        lin.barSl = new TierSL(lin.refHigh, cur.l);
        return { ev: [`BAR SL(${lin.label})`], ended: false };
      }
      return { ev: [], ended: false };
    }
    if (cur.l >= lin.barSl.refLow) return { ev: [], ended: false };
    if (!isSl(cur, lin.barSl.refLow)) {
      lin.barSl.refLow = cur.l;
      return { ev: [`BAR SL LL(${lin.label})`], ended: false };
    }
    lin.barSl.sl2 = true;
    host.refHigh = this.currentTopRef(host);
    host.barLineages = [];
    host.barPending = false;
    if (host instanceof TzBuy) {
      // BAR SL 2 opens the same REAR-vs-fresh-cycle race as TZ BUY's own
      // SL 2 (flow 3).
      host.rearRace = true;
    } else {
      host.active = false;
      host.sl = new RearSL(lin.barSl.refLow);
      host.red = null;
      host.redSeek = true; // REAR RE-ENTER seeks a fresh RED1
    }
    return { ev: [`BAR SL2(${lin.label})`], ended: true };
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
        rear.redSeek = true; // REAR RE-ENTER seeks a fresh RED1
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

    // BAR lineages first: a BAR ENTRY SL on the same candle cancels the
    // repeat's RED1 -> RED2 before it is evaluated.
    ev.push(...this.evalBarLineages(rear, prev, cur));
    ev.push(...this.evalRedGate(rear, prev, cur));
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

/** Same as computeDtfBarTheoryEvents, but keeps each event's originating
 * cycle `seq` (see DtfBarTheoryEngine.processTagged). Only days with at
 * least one event are present. */
export function computeDtfBarTheoryTaggedEvents(rows: HistoryRowLike[]): Map<string, TaggedEvent[]> {
  const days = toDays(rows);
  const engine = new DtfBarTheoryEngine();
  const map = new Map<string, TaggedEvent[]>();
  for (let i = 1; i < days.length; i++) {
    const events = engine.processTagged(days[i - 1], days[i]);
    if (events.length > 0) map.set(days[i].date, events);
  }
  return map;
}
