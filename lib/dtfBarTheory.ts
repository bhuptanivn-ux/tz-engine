// DTF BAR THEORY -- a DTF-only theory built on the SAME event vocabulary as
// lib/dtfBar.ts (TZ GREEN, RED1/RED2, TZ BUY, BAR1/BAR2, REAR) but with a
// different hierarchy, confirmed against real data (PAYTM daily) rather than
// ported from the WTF/PRIME TREND rulebook. Kept as its own file per
// DTF_THEORIES_RULEBOOK.md's own convention: a related but structurally
// different theory gets its own file, not a patch onto another one.
// lib/dtfBar.ts itself is untouched by this file.
//
// Rules below are user-confirmed against PAYTM daily unless marked
// "(default)" -- those are the answers proposed to the user and still
// awaiting confirmation.
//
// 1. Flow (one house = one Cycle):
//      TZ GREEN -> RED1 -> RED2 -> TZ BUY -> TZ BUY ENTRY -> RED1 -> RED2
//      -> BAR1 -> BAR ENTRY -> RED1 -> RED2 -> BAR1 -> BAR2 -> ...
//    RED1 -> RED2 needs TZ GREEN active (no TZ GREEN SL). TZ BUY needs
//    RED1 -> RED2 completed. TZ BUY ENTRY forms above TZ BUY's reference high
//    and is required before the first RED1 under TZ BUY. Once BAR ENTRY is
//    received, RED1 -> RED2 -> BAR1 -> BAR2 repeats. Only one house is live
//    outside a race. TZ GREEN HH is tracked but not recorded.
// 2. TZ BUY SL: TZ BUY's own SL is at TZ BUY's own low. A bare TZ BUY (no TZ
//    BUY ENTRY) SL lets a fresh TZ BUY form straight away while TZ GREEN is
//    active. After TZ BUY ENTRY, TZ BUY SL (which implies TZ BUY ENTRY SL)
//    opens the race (point 6). There is no TZ BUY SL 2 and no BAR SL 2.
// 3. ENTRY tiers -- TZ BUY ENTRY, BAR ENTRY (BAR2) and REAR ENTRY -- share
//    one SL/reactivation shape (EntryTier):
//    - each has its own reference high/low and its own SL, with no SL2;
//    - while SL'd, reactivation is REAR above the tier's frozen high, then
//      the tier re-forms above that REAR's high; a higher high that fails to
//      clear is INVALID <tier> HH and raises the frozen high;
//    - REAR has HH, LL and SL; after a REAR SL the next REAR must clear that
//      REAR's own high, raised by later failed highs (INVALID REAR HH);
//    - a REAR whose tier has re-formed stays tracked for LL/SL only.
//    The RED gate, and a BAR1 it armed, keep running through an ENTRY SL.
//    For TZ BUY ENTRY / REAR ENTRY the REAR step is only sought while no
//    RED2 has armed a BAR (otherwise BAR -> BAR ENTRY carries on).
// 4. BAR: the BAR1 that produced the live BAR ENTRY is the anchor. The
//    previous BAR ENTRY stays live alongside the next round's BAR1 until the
//    NEXT BAR2. A bare BAR1 SL ("BAR SL") re-forms straight away. Under TZ
//    BUY, the anchor's own BAR SL opens the race. Under REAR ENTRY it is
//    only recorded (default) -- BAR ENTRY's own SL/reactivation carries on.
//    Once BAR ENTRY confirms, TZ BUY ENTRY HH / REAR ENTRY HH aren't
//    recorded.
// 5. Old-house REAR (the race REAR): above TZ BUY ENTRY's frozen high
//    (including INVALID TZ BUY ENTRY HH raises), then REAR ENTRY above
//    REAR's high, required before RED1 -> RED2 -> BAR. REAR SL ends REAR
//    ENTRY too; the next REAR must clear the SL'd REAR's own high. A REAR SL
//    after the race was won re-opens the race (default).
// 6. The race: old house's REAR vs new house's TZ BUY (new house = a fresh
//    TZ GREEN -> RED1 -> RED2 -> TZ BUY). REAR first, or on the same day:
//    REAR wins, the new house stops. New house's TZ BUY first: the old house
//    goes dormant (nothing of it is shown) and is terminated once the new
//    house reaches BAR ENTRY.

import { THRESH, EPS, type Day, type HistoryRowLike } from "./tzEngineWtf";

function breaksRef(prev: Day, cur: Day, ref: number): boolean {
  return cur.l >= prev.l && cur.h > ref && cur.h - ref >= THRESH - EPS && cur.c >= ref;
}

/** The plain day-over-day breakout BAR1/TZ BUY/TZ GREEN all use. */
function bar1Shape(prev: Day, cur: Day): boolean {
  return cur.l >= prev.l && cur.h > prev.h && cur.h - prev.h >= THRESH - EPS && cur.c >= prev.h;
}

function isRed1(prev: Day, cur: Day): boolean {
  return cur.h <= prev.h && cur.l < prev.l && prev.l - cur.l >= THRESH - EPS && cur.c <= prev.l;
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

/** The reactivation REAR of an ENTRY tier. */
export class StepRear {
  sl = false;
  constructor(public refHigh: number, public refLow: number) {}
}

/** An ENTRY tier: TZ BUY ENTRY, BAR ENTRY (BAR2) or REAR ENTRY (point 3). */
export class EntryTier {
  sl = false;
  /** The latest reactivation REAR: `rearPending` while the tier has not yet
   * re-formed above it; afterwards kept for its LL/SL only. */
  rear: StepRear | null = null;
  rearPending = false;
  constructor(public refHigh: number, public refLow: number) {}
}

/** BAR1 -- the tier-1 formation under a TZ BUY / REAR ENTRY host. */
export class BarLineage {
  bar2: EntryTier | null = null;
  /** Set once this anchor BAR1's own SL ("BAR SL") has fired. */
  anchorSl = false;
  constructor(public label: string, public refHigh: number, public refLow: number) {}
}

/** What TZ BUY (with TZ BUY ENTRY) and the old-house REAR (with REAR ENTRY)
 * share: an ENTRY tier, the RED gate and the BAR stage under it. */
abstract class BarHost {
  entry: EntryTier | null = null;
  red: Red | null = null;
  /** True while a RED1 may be sought (see evalRedGate). */
  redSeek = false;
  barLineages: BarLineage[] = [];
  barPending = false;
  barGen = 0;
  barDeadLabels = new Set<number>();
  /** Once a BAR ENTRY has confirmed, the ENTRY tier's HH isn't recorded. */
  barEntryEver = false;

  resetBarStage(): void {
    this.red = null;
    this.redSeek = false;
    this.barLineages = [];
    this.barPending = false;
    this.barEntryEver = false;
  }
}

/** The old house's REAR in a race (point 5). */
export class RaceRear extends BarHost {
  constructor(public refHigh: number, public refLow: number) {
    super();
  }
}

/** The race, once opened on the old house's TZ BUY (point 6). */
export class Race {
  /** High the next REAR must clear: TZ BUY ENTRY's frozen high (raised by
   * INVALID TZ BUY ENTRY HH), or after a REAR SL that REAR's own high. */
  seekHigh: number;
  afterRearSl = false;
  rear: RaceRear | null = null;
  /** Set on the day REAR forms (reset at the start of every day). */
  rearToday = false;
  won = false;
  lost = false;
  constructor(seekHigh: number) {
    this.seekHigh = seekHigh;
  }
}

export class TzBuy extends BarHost {
  active = true;
  /** A bare TZ BUY (no TZ BUY ENTRY) sitting SL'd: a fresh TZ BUY may form
   * straight away. */
  bareSl = false;
  race: Race | null = null;
  constructor(public refHigh: number, public refLow: number) {
    super();
  }
}

/** One house: TZ GREEN -> ... */
export class Cycle {
  active = true;
  red: Red | null = null;
  buy: TzBuy | null = null;
  constructor(public seq: number, public refHigh: number, public refLow: number) {}
}

/** One event, attributed to the cycle (Cycle.seq) that produced it. */
export interface TaggedEvent {
  seq: number;
  text: string;
}

/** How an ENTRY tier's events are spelled. */
interface TierNames {
  entry: string; // e.g. "TZ BUY ENTRY", "BAR2(1)" -> built by tag()
  tag: (base: string) => string; // applied to every event of this tier
}

// ---------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------

export class DtfBarTheoryEngine {
  cycles: Cycle[] = [];
  private seq = 0;

  /** Advances one day and returns that day's events as plain text, merged
   * across every active house. Reporting layers should use processTagged(). */
  process(prev: Day, cur: Day): string[] {
    return this.processTagged(prev, cur).map((e) => e.text);
  }

  /** Same as process(), but each event carries the `seq` of the house that
   * produced it. During a race two houses run at once, and their BAR
   * lineages can emit identical text on the same day, so a reporting layer
   * must scope rows by `seq`. */
  processTagged(prev: Day, cur: Day): TaggedEvent[] {
    const byCycle = new Map<Cycle, string[]>();
    const hadBuy = new Set(this.cycles.filter((c) => c.active && c.buy !== null).map((c) => c.seq));
    for (const c of this.cycles) if (c.buy?.race) c.buy.race.rearToday = false;

    for (const cyc of this.cycles) {
      if (!cyc.active) continue;
      byCycle.set(cyc, this.evalCycle(cyc, prev, cur));
    }

    // Resolve races (point 6), oldest racing house first.
    for (const old of this.cycles) {
      const race = old.buy?.race;
      if (!old.active || race == null || race.won || race.lost) continue;
      const younger = this.cycles.filter((c) => c.seq > old.seq && c.active);
      const newHouseBuyBefore = younger.some((c) => hadBuy.has(c.seq));
      const newHouseBuyToday = younger.some((c) => c.buy !== null && !hadBuy.has(c.seq));
      const rearToday = race.rearToday;
      if (newHouseBuyBefore || (newHouseBuyToday && !rearToday)) {
        // New house's TZ BUY came first: old house goes dormant.
        race.lost = true;
      } else if (rearToday) {
        // REAR first, or on the same day as the new house's TZ BUY: REAR
        // wins, the new house stops (and today's events of it are dropped).
        race.won = true;
        for (const c of younger) {
          c.active = false;
          byCycle.delete(c);
        }
      }
    }

    const ev: TaggedEvent[] = [];
    for (const [cyc, texts] of byCycle) {
      if (cyc.buy?.race?.lost) continue; // dormant: nothing of it is shown
      for (const text of texts) ev.push({ seq: cyc.seq, text });
    }

    // A fresh house may spawn whenever nothing is blocking it: no house is
    // live, or every live house is racing with the race still undecided or
    // lost.
    const blocking = this.cycles.some((c) => c.active && !(c.buy?.race != null && !c.buy.race.won));
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
    // Once the race has opened, the house's own TZ GREEN tier is retired --
    // only the race (and, if won, the REAR) matters from here on.
    if (cyc.buy?.race != null) return this.evalRace(cyc, cyc.buy, cyc.buy.race, prev, cur);

    const ev: string[] = [];
    const isSlNow = isSl(cur, cyc.refLow);
    const hasLiveBuy = cyc.buy !== null && cyc.buy.active;

    const newHigh = quietHh(cur, cyc.refHigh);
    if (newHigh !== null) cyc.refHigh = newHigh; // TZ GREEN HH: not recorded
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
        if (isRed1(prev, cur)) {
          cyc.red = new Red(cur.h, cur.l);
          ev.push("RED1");
        }
      } else if (cyc.red.active) {
        const redEv = this.evalRed(cyc.red, prev, cur);
        ev.push(...redEv);
        if (redEv.some((e) => e.startsWith("INVALID"))) cyc.red = null;
      } else if (bar1Shape(prev, cur)) {
        cyc.buy = new TzBuy(cur.h, cur.l);
        ev.push("TZ BUY");
        return ev;
      }
    }

    if (cyc.buy !== null) ev.push(...this.evalBuy(cyc.buy, prev, cur));
    return ev;
  }

  // -----------------------------------------------------------------
  private evalRed(red: Red, prev: Day, cur: Day): string[] {
    const ev: string[] = [];
    if (cur.h > red.refHigh && cur.h - red.refHigh >= THRESH - EPS && cur.c >= red.refHigh) {
      red.active = false;
      return ["INVALID RED1"];
    }
    if (cur.h > red.refHigh) {
      red.refHigh = cur.h;
      ev.push("RED1 HH");
    }
    if (cur.l < red.refLow) {
      const red2Holds = cur.h <= prev.h && red.refLow - cur.l >= THRESH - EPS && cur.c <= red.refLow + EPS;
      if (red2Holds) {
        red.active = false;
        ev.push("RED2");
      } else {
        red.refLow = cur.l;
        ev.push("RED1 LL");
      }
    }
    return ev;
  }

  /** The RED1 -> RED2 gate under a host. RED2 arms the next BAR1. */
  private evalRedGate(host: BarHost, prev: Day, cur: Day): string[] {
    if (!host.redSeek) return [];
    if (host.red === null) {
      if (isRed1(prev, cur)) {
        host.red = new Red(cur.h, cur.l);
        return ["RED1"];
      }
      return [];
    }
    const redEv = this.evalRed(host.red, prev, cur);
    if (redEv.includes("RED2")) {
      host.barPending = true;
      host.redSeek = false;
      host.red = null;
    } else if (redEv.some((e) => e.startsWith("INVALID"))) {
      host.red = null;
    }
    return redEv;
  }

  // -----------------------------------------------------------------
  private evalBuy(buy: TzBuy, prev: Day, cur: Day): string[] {
    let ev: string[] = [];

    if (buy.bareSl) {
      if (bar1Shape(prev, cur)) {
        buy.active = true;
        buy.bareSl = false;
        buy.refHigh = cur.h;
        buy.refLow = cur.l;
        ev.push("TZ BUY");
      }
      return ev;
    }

    // TZ BUY ENTRY: above TZ BUY's reference high, required before RED1.
    if (buy.entry === null && breaksRef(prev, cur, buy.refHigh)) {
      buy.entry = new EntryTier(cur.h, cur.l);
      buy.refHigh = cur.h;
      buy.redSeek = true;
      buy.red = null;
      return ["TZ BUY ENTRY"];
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
      buy.active = false;
      if (buy.entry === null) {
        buy.bareSl = true;
        ev.push("TZ BUY SL");
      } else {
        // TZ BUY's low is below TZ BUY ENTRY's, so TZ BUY SL implies TZ BUY
        // ENTRY SL (both recorded -- default). Opens the race.
        if (!buy.entry.sl) ev.push("TZ BUY ENTRY SL");
        ev.push("TZ BUY SL");
        this.openRace(buy);
      }
      buy.resetBarStage();
      return ev;
    }

    const entry = buy.entry;
    if (entry !== null) {
      const allowRear = !buy.barPending && buy.barLineages.length === 0;
      const res = this.evalEntryTier(entry, prev, cur, allowRear, buy.barEntryEver, {
        entry: "TZ BUY ENTRY",
        tag: (b) => (b.includes("REAR") ? `${b} (TZ BUY ENTRY)` : b),
      });
      ev.push(...res.ev);
      if (res.reformed) {
        buy.redSeek = true;
        return ev;
      }
    }

    const bar = this.evalBarLineages(buy, prev, cur);
    if (bar.raceOpened) {
      ev.push(...bar.ev);
      return ev;
    }
    if (!buy.barEntryEver && bar.ev.some((e) => /^BAR2\(/.test(e))) {
      buy.barEntryEver = true;
      ev = ev.filter((e) => e !== "TZ BUY ENTRY HH");
    }
    ev.push(...bar.ev);
    ev.push(...this.evalRedGate(buy, prev, cur));
    return ev;
  }

  private openRace(buy: TzBuy): void {
    buy.active = false;
    buy.race = new Race(buy.entry !== null ? buy.entry.refHigh : buy.refHigh);
  }

  // -----------------------------------------------------------------
  /** One ENTRY tier's day (point 3). `allowRear`: whether the REAR step may
   * be sought while the tier sits SL'd. */
  private evalEntryTier(
    t: EntryTier,
    prev: Day,
    cur: Day,
    allowRear: boolean,
    silenceHh: boolean,
    names: TierNames
  ): { ev: string[]; reformed: boolean } {
    const ev: string[] = [];
    const tag = names.tag;

    // A REAR whose tier has re-formed: LL / SL only.
    const trackOldRear = (): void => {
      const r = t.rear;
      if (r === null || r.sl || t.rearPending) return;
      if (isSl(cur, r.refLow)) {
        r.sl = true;
        ev.push(tag("REAR SL"));
        return;
      }
      const low = quietLl(cur, r.refLow);
      if (low !== null) {
        r.refLow = low;
        ev.push(tag("REAR LL"));
      }
    };

    if (!t.sl) {
      const slNow = isSl(cur, t.refLow);
      const h = quietHh(cur, t.refHigh);
      if (h !== null) {
        t.refHigh = h;
        if (!slNow && !silenceHh) ev.push(tag(`${names.entry} HH`));
      }
      const l = quietLl(cur, t.refLow);
      if (l !== null) {
        t.refLow = l;
        ev.push(tag(`${names.entry} LL`));
      }
      trackOldRear();
      if (slNow) {
        t.sl = true;
        ev.push(tag(`${names.entry} SL`));
      }
      return { ev, reformed: false };
    }

    // Tier sits SL'd.
    if (t.rear !== null && t.rearPending) {
      const r = t.rear;
      if (breaksRef(prev, cur, r.refHigh)) {
        t.sl = false;
        t.refHigh = cur.h;
        t.refLow = cur.l;
        t.rearPending = false;
        ev.push(tag(names.entry));
        return { ev, reformed: true };
      }
      const slNow = isSl(cur, r.refLow);
      const h = quietHh(cur, r.refHigh);
      if (h !== null) {
        r.refHigh = h;
        if (!slNow) ev.push(tag("REAR HH"));
      }
      const l = quietLl(cur, r.refLow);
      if (l !== null) {
        r.refLow = l;
        ev.push(tag("REAR LL"));
      }
      if (slNow) {
        r.sl = true;
        t.rearPending = false;
        ev.push(tag("REAR SL"));
      }
      return { ev, reformed: false };
    }

    trackOldRear();
    if (!allowRear) return { ev, reformed: false };
    // Seek REAR: above the SL'd REAR's own high if the latest REAR SL'd,
    // else above the tier's frozen high.
    const afterRearSl = t.rear !== null && t.rear.sl;
    const target = afterRearSl ? t.rear!.refHigh : t.refHigh;
    if (breaksRef(prev, cur, target)) {
      t.rear = new StepRear(cur.h, cur.l);
      t.rearPending = true;
      ev.push(tag("REAR"));
    } else if (cur.h > target) {
      if (afterRearSl) {
        t.rear!.refHigh = cur.h;
        ev.push(tag("INVALID REAR HH"));
      } else {
        t.refHigh = cur.h;
        ev.push(tag(`INVALID ${names.entry} HH`));
      }
    }
    return { ev, reformed: false };
  }

  // -----------------------------------------------------------------
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

  /** Every BAR lineage under a host: at most the anchor (with its BAR
   * ENTRY) and a newer BAR1 of the next round. */
  private evalBarLineages(host: BarHost, prev: Day, cur: Day): { ev: string[]; raceOpened: boolean } {
    const ev: string[] = [];

    if (host.barPending && bar1Shape(prev, cur)) {
      const label = this.nextBarLabel(host);
      host.barLineages = host.barLineages.filter((l) => l.bar2 !== null);
      host.barLineages.push(new BarLineage(label, cur.h, cur.l));
      host.barPending = false;
      return { ev: [`BAR1(${label})`], raceOpened: false };
    }

    for (const lin of [...host.barLineages]) {
      if (!host.barLineages.includes(lin)) continue;
      const res = this.evalLineage(host, lin, prev, cur);
      ev.push(...res.ev);
      if (res.raceOpened) return { ev, raceOpened: true };
      if (res.stop) break;
    }
    return { ev, raceOpened: false };
  }

  private evalLineage(
    host: BarHost,
    lin: BarLineage,
    prev: Day,
    cur: Day
  ): { ev: string[]; stop: boolean; raceOpened: boolean } {
    const ev: string[] = [];
    const L = lin.label;

    if (lin.bar2 === null) {
      if (breaksRef(prev, cur, lin.refHigh)) {
        // The NEXT BAR2: the previous BAR ENTRY is superseded, and this BAR1
        // becomes the anchor.
        lin.bar2 = new EntryTier(cur.h, cur.l);
        host.barLineages = [lin];
        host.redSeek = true;
        return { ev: [`BAR2(${L})`], stop: true, raceOpened: false };
      }
      const slNow = isSl(cur, lin.refLow);
      const h = quietHh(cur, lin.refHigh);
      if (h !== null) {
        lin.refHigh = h;
        if (!slNow) ev.push(`BAR1 HH(${L})`);
      }
      const l = quietLl(cur, lin.refLow);
      if (l !== null) {
        lin.refLow = l;
        ev.push(`BAR1 LL(${L})`);
      }
      if (slNow) {
        // Bare BAR1 SL: re-forms straight away, no RED gate.
        host.barDeadLabels.add(parseInt(L, 10));
        host.barLineages = host.barLineages.filter((x) => x !== lin);
        host.barPending = true;
        ev.push(`BAR SL(${L})`);
      }
      return { ev, stop: false, raceOpened: false };
    }

    // Anchor BAR1: its own low keeps being tracked; its own BAR SL opens the
    // race under TZ BUY, and is only recorded under REAR ENTRY (default).
    if (!lin.anchorSl) {
      if (isSl(cur, lin.refLow)) {
        lin.anchorSl = true;
        ev.push(`BAR SL(${L})`);
        if (host instanceof TzBuy) {
          this.openRace(host);
          host.resetBarStage();
          return { ev, stop: true, raceOpened: true };
        }
      } else {
        const l = quietLl(cur, lin.refLow);
        if (l !== null) {
          lin.refLow = l;
          ev.push(`BAR1 LL(${L})`);
        }
      }
    }

    const res = this.evalEntryTier(lin.bar2, prev, cur, true, false, {
      entry: "BAR2",
      tag: (b) => `${b}(${L})`,
    });
    ev.push(...res.ev);
    if (res.reformed) host.redSeek = true;
    return { ev, stop: false, raceOpened: false };
  }

  // -----------------------------------------------------------------
  /** The old house once its race has opened (points 5 and 6). */
  private evalRace(cyc: Cycle, buy: TzBuy, race: Race, prev: Day, cur: Day): string[] {
    // Dormant old house: terminated once the new house reaches BAR ENTRY.
    if (race.lost && this.cycles.some((c) => c.seq > cyc.seq && c.active && c.buy?.barEntryEver)) {
      cyc.active = false;
      return [];
    }

    const rear = race.rear;
    if (rear === null) {
      if (breaksRef(prev, cur, race.seekHigh)) {
        race.rear = new RaceRear(cur.h, cur.l);
        race.rearToday = true;
        return ["REAR"];
      }
      if (cur.h > race.seekHigh) {
        race.seekHigh = cur.h;
        return [race.afterRearSl ? "INVALID REAR HH" : "INVALID TZ BUY ENTRY HH"];
      }
      return [];
    }

    let ev: string[] = [];
    if (rear.entry === null && breaksRef(prev, cur, rear.refHigh)) {
      rear.entry = new EntryTier(cur.h, cur.l);
      rear.refHigh = cur.h;
      rear.redSeek = true;
      return ["REAR ENTRY"];
    }

    const slNow = isSl(cur, rear.refLow);
    const h = quietHh(cur, rear.refHigh);
    if (h !== null) {
      rear.refHigh = h;
      if (!slNow && rear.entry === null) ev.push("REAR HH");
    }
    const l = quietLl(cur, rear.refLow);
    if (l !== null) {
      rear.refLow = l;
      ev.push("REAR LL");
    }
    if (slNow) {
      // REAR SL ends REAR ENTRY too (both recorded -- default); the next REAR
      // must clear this REAR's own high.
      if (rear.entry !== null && !rear.entry.sl) ev.push("REAR ENTRY SL");
      ev.push("REAR SL");
      race.rear = null;
      race.seekHigh = rear.refHigh;
      race.afterRearSl = true;
      // A REAR SL after the race was won re-opens the race (default): a new
      // house may start again and races this house's next REAR.
      race.won = false;
      return ev;
    }

    if (rear.entry !== null) {
      const allowRear = !rear.barPending && rear.barLineages.length === 0;
      const res = this.evalEntryTier(rear.entry, prev, cur, allowRear, rear.barEntryEver, {
        entry: "REAR ENTRY",
        tag: (b) => (b.startsWith("REAR ENTRY") || b === "INVALID REAR ENTRY HH" ? b : `${b} (REAR ENTRY)`),
      });
      ev.push(...res.ev);
      if (res.reformed) {
        rear.redSeek = true;
        return ev;
      }
      const bar = this.evalBarLineages(rear, prev, cur);
      if (!rear.barEntryEver && bar.ev.some((e) => /^BAR2\(/.test(e))) {
        rear.barEntryEver = true;
        ev = ev.filter((e) => e !== "REAR ENTRY HH");
      }
      ev.push(...bar.ev);
      ev.push(...this.evalRedGate(rear, prev, cur));
    }
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
 * house `seq` (see DtfBarTheoryEngine.processTagged). */
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
