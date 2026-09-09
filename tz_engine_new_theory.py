"""
TZ ENGINE -- New Theory variant, v2: TZ GREEN -> BAR (unlimited) -> REAR.

STATUS: provisional first-pass implementation. NOT yet verified against real
OHLC data -- no dataset has been supplied for this theory. Every open
question left unresolved has an explicit, documented default; see
NEW_THEORY_RULEBOOK.md for the reasoning behind each one ("v2" section).
Re-check every one of these against real data before trusting this engine's
output.

Separate from, and independent of, tz_engine_v9.py / tz_engine_bar2_variant.py
and the DTF/WTF variant on claude/rulebook-logic-interpretation-g3z130.

v2 supersedes v1: TZ BUY / TZ BUY 2 / TZ GREEN 2 are removed entirely. RED1/
RED2 now attach directly to TZ GREEN, and BAR forms directly above TZ GREEN's
own reference high (not TZ BUY 2's). TZ GREEN has no SL2 of its own -- its
own SL is single-shot per cycle, but what happens next depends on whether
this cycle's RED2 has ever fired:

    TZ GREEN -> RED1 -> RED2 -> BAR(1) -> BAR 2(1) -> RED1 -> RED2 ->
    BAR(2) -> BAR 2(2) -> RED1 -> RED2 -> ... (unlimited) ...
    -> BAR SL -> BAR SL2  ---\\
                               >--> RACE: REAR (above the reference queued at
    TZ GREEN SL (after RED2) -/       the trigger) vs. a fresh TZ GREEN (NEW
                                       CYCLE) reaching ITS OWN first BAR --
                                       whichever happens first wins; the
                                       other is abandoned.
    TZ GREEN SL (before RED2 ever fired) -> immediate fresh TZ GREEN (NEW
        CYCLE), no REAR involved at all (nothing to queue a reference from).

BAR / BAR 2 keep the v1 shape (BAR 2 forms off BAR's own reference; BAR's own
SL/SL2 two-tier escalation is gated on BAR 2 having formed at all -- a BAR SL
with no BAR 2 is a dead end, no SL2 reachable, per the already-established
pattern this theory reuses). REAR / REAR 2 also keep the v1 shape once REAR
actually confirms.
"""
from dataclasses import dataclass, field
from typing import Optional, List
import csv
import datetime

THRESH = 0.20
ANY = 0.01
EPS = 1e-9


def branch_label(n: int) -> str:
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(ord('A') + r) + s
    return s


@dataclass
class Day:
    date: str
    o: float
    h: float
    l: float
    c: float


def load_days_csv(path):
    days = []
    with open(path, newline="") as f:
        reader = csv.reader(f)
        next(reader)  # header
        for row in reader:
            if not row or row[0] == "":
                continue
            date, o, h, l, c = row[0], row[1], row[2], row[3], row[4]
            days.append(Day(date, float(o), float(h), float(l), float(c)))
    return days


def load_days_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb['Sheet1']
    days = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        date, o, h, l, c = row[0], row[1], row[2], row[3], row[4]
        if o is None:
            continue
        if isinstance(date, datetime.datetime):
            date = date.strftime('%d-%m-%Y')
        days.append(Day(date, float(o), float(h), float(l), float(c)))
    return days


# ---------------------------------------------------------------------------
# Shared building blocks
# ---------------------------------------------------------------------------

@dataclass
class RedTracker:
    """RED1/RED2, shared mechanic reused at every escalation point (attaches
    directly to TZ GREEN, and to each generation's BAR 2)."""
    ref_high: float
    ref_low: float
    red2_fired: bool = False


def eval_red_tracker(holder, parent_terminated: bool, prev: Day, cur: Day):
    """Attach/advance RED1/RED2 on `holder.red`. `parent_terminated` is
    supplied by the caller (TZ GREEN's own `dead`, or a Tier2's own `sl`) --
    SL always beats RED1/RED2, so callers must not invoke this on a candle
    where the parent's own SL just fired."""
    if holder is None or parent_terminated:
        return None
    red = holder.red
    if red is None:
        if cur.h <= prev.h and prev.l - cur.l >= THRESH - EPS and cur.c <= prev.l:
            holder.red = RedTracker(ref_high=cur.h, ref_low=cur.l)
            return "RED1"
        return None
    if red.red2_fired:
        return None
    if cur.h - red.ref_high >= THRESH - EPS and cur.c >= red.ref_high:
        holder.red = None
        return "INVALID_RED1"
    gap = red.ref_low - cur.l
    if cur.l < red.ref_low and cur.h <= prev.h and gap >= THRESH - EPS and cur.c <= red.ref_low + EPS:
        red.red2_fired = True
        return "RED2"
    if cur.l < red.ref_low:
        red.ref_low = cur.l
        return "RED1_LL"
    if cur.h - red.ref_high >= ANY - EPS:
        red.ref_high = cur.h
        return "RED1_HH"
    return None


@dataclass
class Tier2SL:
    """Single-tier SL for a "2" structure (BAR 2 / REAR 2) -- no escalation
    of its own. Can recover and re-fire indefinitely."""
    ref_high: float
    ref_low: float


@dataclass
class Tier2:
    """BAR 2 / REAR 2 -- identical shape and identical single-tier
    SL/recovery cycle."""
    ref_high: float
    ref_low: float
    sl: Optional[Tier2SL] = None
    red: Optional[RedTracker] = None


def try_form_tier2(parent_ref_high: float, prev: Day, cur: Day):
    """"2"-tier formation: Low >= PrevLow, High > parent's ref by >= THRESH,
    Close >= parent's ref. Caller only invokes this while the parent is
    pre-SL."""
    if cur.l >= prev.l and cur.h - parent_ref_high >= THRESH - EPS and cur.c >= parent_ref_high:
        return Tier2(ref_high=cur.h, ref_low=cur.l)
    return None


def eval_tier2_hh_ll(t2: Tier2, prev: Day, cur: Day):
    """LL is never suppressed by the "2" existing; HH is (own display rule)."""
    events = []
    if t2.sl is None:
        if cur.h - t2.ref_high >= ANY - EPS:
            t2.ref_high = cur.h
            events.append("HH")
        if cur.l < t2.ref_low:
            t2.ref_low = cur.l
            events.append("LL")
    return events


def eval_tier2_sl_cycle(t2: Tier2, prev: Day, cur: Day):
    """SL / recovery for a "2" tier. Returns list of event tags fired today."""
    events = []
    if t2.sl is None:
        gap = t2.ref_low - cur.l
        if cur.l <= t2.ref_low and gap >= THRESH - EPS and cur.c <= t2.ref_low:
            t2.sl = Tier2SL(ref_high=t2.ref_high, ref_low=cur.l)
            events.append("SL")
    else:
        if cur.h - t2.sl.ref_high >= THRESH - EPS and cur.c >= t2.sl.ref_high:
            t2.ref_high = cur.h
            t2.ref_low = cur.l
            t2.red = None
            t2.sl = None
            events.append("RECOVER")
        elif cur.l < t2.sl.ref_low:
            t2.sl.ref_low = cur.l
            events.append("SL_LL")
    return events


# ---------------------------------------------------------------------------
# BAR generation (unlimited chain)
# ---------------------------------------------------------------------------

@dataclass
class BarSL:
    ref_high: float
    ref_low: float
    sl2: bool = False


@dataclass
class BarGen:
    label: str
    ref_high: float
    ref_low: float
    bar2: Optional[Tier2] = None
    sl: Optional[BarSL] = None
    superseded: bool = False  # a fresh next-generation BAR has formed above this one


# ---------------------------------------------------------------------------
# Cycle (one TZ GREEN lineage)
# ---------------------------------------------------------------------------

@dataclass
class Tier1SL:
    ref_low: float


@dataclass
class Cycle:
    """One TZ GREEN -> RED1/RED2 -> BAR/BAR2 (unlimited) -> [REAR] chain."""
    seq: int
    green_ref_high: float
    green_ref_low: float
    red: Optional[RedTracker] = None
    red2_ever: bool = False  # this cycle's own RED2 (against TZ GREEN) has fired at least once

    bar_gens: List[BarGen] = field(default_factory=list)
    bar_sub_counter: int = 0

    dead: bool = False        # TZ GREEN's own SL fired
    terminated: bool = False  # dead=True, OR any generation reached BAR SL2 --
    # in either case this cycle's own forward escalation is over and a new
    # sibling TZ GREEN becomes spawn-eligible (§ branch-spawn rule below).

    rear_ref_high: float = 0.0
    rear_ref_low: float = 0.0
    rear_sl: Optional[Tier1SL] = None
    rear2: Optional[Tier2] = None


class Engine:
    def __init__(self):
        self.cycles: List[Cycle] = []
        self.next_seq = 1
        # Single-slot "race" state (newest terminating event always wins,
        # mirroring the base engine's single-slot REAR-family convention):
        # a reference queued by either BAR SL2 or a post-RED2 TZ GREEN SL,
        # racing against whichever fresh sibling cycle reaches its own first
        # BAR first. See NEW_THEORY_RULEBOOK.md, "v2 -- the endgame race".
        self.pending_rear_ref: Optional[float] = None
        self.pending_rear_owner: Optional[Cycle] = None

    # -- spawn eligibility -------------------------------------------------
    def _spawn_eligible(self) -> bool:
        """A fresh sibling TZ GREEN may spawn once the most recent cycle's
        own forward escalation is over (`terminated`) -- whether via its own
        TZ GREEN SL or via any of its BAR generations reaching SL2. This
        naturally covers the recursive case too: a fresh sibling that itself
        fails early (its own TZ GREEN SL before its own RED2) immediately
        becomes eligible-anchor for yet another attempt, all while any
        pending REAR race keeps running independently in the background."""
        return not self.cycles or self.cycles[-1].terminated

    def _try_spawn(self, prev: Day, cur: Day):
        if not self._spawn_eligible():
            return None
        if cur.l >= prev.l and cur.h - prev.h >= THRESH - EPS and cur.c >= prev.h:
            c = Cycle(seq=self.next_seq, green_ref_high=cur.h, green_ref_low=cur.l)
            self.next_seq += 1
            self.cycles.append(c)
            return f"TZ GREEN({branch_label(c.seq)})"
        return None

    # -- the REAR-vs-fresh-cycle race ---------------------------------------
    def _queue_rear(self, owner: Cycle, ref: float):
        """Single slot: the newest terminating event's reference always
        supersedes whatever was previously queued (mirrors the base engine's
        REAR-family single-slot convention)."""
        self.pending_rear_ref = ref
        self.pending_rear_owner = owner

    def _eval_pending_rear(self, prev: Day, cur: Day, events: list):
        """Checked once per day, ahead of per-cycle evaluation, so that a
        fresh sibling reaching BAR the same day REAR would confirm is
        resolved deterministically (tie -> REAR wins, since its reference
        was queued earlier in wall-clock time -- see rulebook)."""
        if self.pending_rear_ref is None:
            return
        ref = self.pending_rear_ref
        owner = self.pending_rear_owner
        label = branch_label(owner.seq)
        if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
            owner.rear_ref_high = cur.h
            owner.rear_ref_low = cur.l
            events.append(f"REAR({label})")
            self.pending_rear_ref = None
            self.pending_rear_owner = None
        elif cur.h - ref >= ANY - EPS:
            self.pending_rear_ref = cur.h

    # -- per-cycle evaluation -----------------------------------------------
    def _eval_cycle(self, c: Cycle, prev: Day, cur: Day):
        events = []
        label = branch_label(c.seq)
        if c.terminated and not c.rear_ref_high:
            # Fully resolved with no REAR ever confirmed for it (either it
            # lost the race, or it died before RED2 with nothing to race).
            return events

        if not c.dead:
            # 1. TZ GREEN's own SL -- single-shot, no SL2 of its own. What
            # happens next depends on whether RED2 has ever fired.
            gap = c.green_ref_low - cur.l
            if cur.l <= c.green_ref_low and gap >= THRESH - EPS and cur.c <= c.green_ref_low:
                c.dead = True
                c.terminated = True
                events.append(f"TZ GREEN SL({label})")
                if c.red2_ever:
                    # Queue REAR above TZ GREEN's OWN reference high (not the
                    # last BAR 2's -- the "BIG CHANGE" simplification; see
                    # rulebook for the alternate reading this replaces).
                    self._queue_rear(c, c.green_ref_high)
                # else: no REAR queued at all -- a fresh sibling can spawn
                # immediately (handled by _spawn_eligible/_try_spawn).
                return events

            # Snapshot BEFORE today's own HH update, for BAR's own formation
            # check below (avoids the self-comparison bug: forming BAR the
            # same day TZ GREEN's own HH ratchets up to today's own High).
            green_ref_pre = c.green_ref_high

            # 2. TZ GREEN HH/LL.
            if cur.h - c.green_ref_high >= ANY - EPS:
                c.green_ref_high = cur.h
                events.append(f"TZ GREEN HH({label})")
            if cur.l < c.green_ref_low:
                c.green_ref_low = cur.l
                events.append(f"TZ GREEN LL({label})")

            # 3. RED1/RED2 directly against TZ GREEN (no "TZ GREEN 2" in v2).
            tag = eval_red_tracker(c, c.dead, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({label})")
                if tag == "RED2":
                    c.red2_ever = True

            # 4. First BAR generation -- above TZ GREEN's own reference,
            # once TZ GREEN's own RED2 has fired.
            if c.red is not None and c.red.red2_fired and not c.bar_gens:
                ref = green_ref_pre
                if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                    c.bar_sub_counter += 1
                    gen = BarGen(label=f"{label}.{c.bar_sub_counter}", ref_high=cur.h, ref_low=cur.l)
                    c.bar_gens.append(gen)
                    events.append(f"BAR({gen.label})")

        # 5. Unlimited BAR/BAR2/RED1/RED2 loop; BAR SL2 queues REAR (handled
        # inside _eval_bar_chain). Stops once terminated -- a cycle that
        # already resolved (via either termination path) must not keep
        # evaluating stale BAR generations after REAR later confirms.
        if not c.terminated:
            self._eval_bar_chain(c, prev, cur, events)

        # 6. REAR's own HH/LL/SL/2, once REAR has actually confirmed for
        # this cycle (independent of `dead`/`terminated` -- REAR outlives
        # the cycle that spawned it).
        if c.rear_ref_high:
            self._eval_rear_tracking(c, prev, cur, events)

        return events

    def _eval_bar_chain(self, c: Cycle, prev: Day, cur: Day, events: list):
        active_gens = [g for g in c.bar_gens if not g.superseded]
        if not active_gens:
            return
        gen = active_gens[-1]

        # BAR's own SL/SL2 -- gated on BAR2 having formed (dead end otherwise).
        if gen.bar2 is not None:
            if gen.sl is None:
                gap = gen.ref_low - cur.l
                if cur.l <= gen.ref_low and gap >= THRESH - EPS and cur.c <= gen.ref_low:
                    gen.sl = BarSL(ref_high=gen.ref_high, ref_low=cur.l)
                    events.append(f"BAR SL({gen.label})")
                    return
            elif not gen.sl.sl2:
                gap2 = gen.sl.ref_low - cur.l
                if cur.l <= gen.sl.ref_low and gap2 >= THRESH - EPS and cur.c <= gen.sl.ref_low:
                    gen.sl.sl2 = True
                    c.terminated = True
                    events.append(f"BAR SL2({gen.label})")
                    ref = gen.bar2.ref_high if gen.bar2 is not None else gen.ref_high
                    self._queue_rear(c, ref)
                    return
                if cur.l < gen.sl.ref_low:
                    gen.sl.ref_low = cur.l
                    events.append(f"BAR SL LL({gen.label})")

        if gen.sl is not None:
            return

        # BAR 2 formation uses the PRE-today reference (avoids self-
        # comparison against today's own weak-HH bump). LL never suppressed.
        pre_bar_ref_high = gen.ref_high
        bar2_ref_pre = gen.bar2.ref_high if gen.bar2 is not None else None
        if gen.bar2 is None:
            t2 = try_form_tier2(pre_bar_ref_high, prev, cur)
            if t2 is not None:
                gen.bar2 = t2
                events.append(f"BAR 2({gen.label})")
            elif cur.h - pre_bar_ref_high >= ANY - EPS:
                gen.ref_high = cur.h
                events.append(f"BAR HH({gen.label})")
        else:
            for tag in eval_tier2_hh_ll(gen.bar2, prev, cur):
                events.append(f"BAR 2 {tag}({gen.label})")
            for tag in eval_tier2_sl_cycle(gen.bar2, prev, cur):
                events.append(f"BAR 2 {tag}({gen.label})")
        if cur.l < gen.ref_low:
            gen.ref_low = cur.l
            events.append(f"BAR LL({gen.label})")

        # RED1/RED2 against this generation's BAR 2, gating the next generation.
        if gen.bar2 is not None:
            tag = eval_red_tracker(gen.bar2, gen.bar2.sl is not None, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({gen.label})")

        # Attempt next-generation formation once this generation's BAR 2 had
        # a fired RED2 coming into today and is awaiting the fresh breakout
        # above BAR 2's pre-today reference.
        if gen.bar2 is not None and gen.bar2.red is not None and gen.bar2.red.red2_fired and bar2_ref_pre is not None:
            ref = bar2_ref_pre
            if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                gen.superseded = True
                c.bar_sub_counter += 1
                new_gen = BarGen(
                    label=f"{branch_label(c.seq)}.{c.bar_sub_counter}",
                    ref_high=cur.h, ref_low=cur.l,
                )
                c.bar_gens.append(new_gen)
                events.append(f"BAR({new_gen.label})")

    def _eval_rear_tracking(self, c: Cycle, prev: Day, cur: Day, events: list):
        label = branch_label(c.seq)
        if c.rear_sl is None:
            gap = c.rear_ref_low - cur.l
            if cur.l <= c.rear_ref_low and gap >= THRESH - EPS and cur.c <= c.rear_ref_low:
                c.rear_sl = Tier1SL(ref_low=cur.l)
                events.append(f"REAR SL({label})")
                return
            pre_rear_ref_high = c.rear_ref_high
            if c.rear2 is None:
                t2 = try_form_tier2(pre_rear_ref_high, prev, cur)
                if t2 is not None:
                    c.rear2 = t2
                    events.append(f"REAR 2({label})")
                elif cur.h - pre_rear_ref_high >= ANY - EPS:
                    c.rear_ref_high = cur.h
                    events.append(f"REAR HH({label})")
            else:
                for tag in eval_tier2_hh_ll(c.rear2, prev, cur):
                    events.append(f"REAR 2 {tag}({label})")
                for tag in eval_tier2_sl_cycle(c.rear2, prev, cur):
                    events.append(f"REAR 2 {tag}({label})")
            if cur.l < c.rear_ref_low:
                c.rear_ref_low = cur.l
                events.append(f"REAR LL({label})")

    def process(self, days: List[Day]):
        out = []
        for i in range(1, len(days)):
            prev, cur = days[i - 1], days[i]
            day_events = []

            # Pending REAR race checked first (per-day tie-break: REAR wins
            # a same-day tie against a sibling's fresh BAR -- see rulebook).
            self._eval_pending_rear(prev, cur, day_events)

            spawn_ev = self._try_spawn(prev, cur)
            if spawn_ev:
                day_events.append(spawn_ev)

            for c in list(self.cycles):
                had_bar_gens = bool(c.bar_gens)
                events = self._eval_cycle(c, prev, cur)
                day_events.extend(events)
                # This cycle just formed its OWN first BAR (not a later
                # generation) -- it wins the race against any still-pending
                # REAR queued by an older, already-terminated cycle.
                if not had_bar_gens and c.bar_gens and self.pending_rear_ref is not None:
                    self.pending_rear_ref = None
                    self.pending_rear_owner = None

            out.append((cur.date, day_events))
        return out


def run(path):
    if path.lower().endswith(".csv"):
        days = load_days_csv(path)
    else:
        days = load_days_xlsx(path)
    engine = Engine()
    return engine.process(days)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("usage: python tz_engine_new_theory.py <path.csv|path.xlsx>")
        sys.exit(1)
    for date, events in run(sys.argv[1]):
        if events:
            print(date, "|", ", ".join(events))
