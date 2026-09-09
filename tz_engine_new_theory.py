"""
TZ ENGINE -- New Theory variant, v3: TZ GREEN -> TZ BUY -> BAR (unlimited) ->
REAR -> REAR RE-ENTER.

STATUS: provisional first-pass implementation. NOT yet verified against real
OHLC data -- no dataset has been supplied for this theory. Every open
question left unresolved has an explicit, documented default; see
NEW_THEORY_RULEBOOK.md ("v3" section) for the reasoning behind each one.
Re-check every one of these against real data before trusting this engine's
output.

Separate from, and independent of, tz_engine_v9.py / tz_engine_bar2_variant.py
and the DTF/WTF variant on claude/rulebook-logic-interpretation-g3z130.

v3 supersedes v2: TZ BUY / TZ BUY 2 are reinstated (v2 had removed them and
had BAR form directly off TZ GREEN -- that change is dismissed). RED1/RED2
attach directly to TZ GREEN (no "TZ GREEN 2"). The escalation:

    TZ GREEN -> RED1 -> RED2 (vs TZ GREEN) ->
    TZ BUY (above TZ GREEN's own ref) -> TZ BUY 2 (above TZ BUY's own ref) ->
    RED1 -> RED2 (vs TZ BUY 2) ->
    BAR(1) (above TZ BUY 2's ref) -> BAR 2(1) -> RED1 -> RED2 ->
    BAR(2) -> BAR 2(2) -> ... (unlimited, while TZ BUY 2 stays active) ...
    -> BAR SL -> BAR SL2 -----------\\
                                      >--> RACE: REAR (above the current
    TZ GREEN SL (after its own RED2) /       highest-tier reference reached
                                              so far) vs. a fresh sibling TZ
                                              GREEN reaching ITS OWN TZ BUY --
                                              whichever is earlier wins; a
                                              same-day tie favors the older
                                              lineage's REAR.
    -> REAR -> REAR 2 -> REAR SL -> RACE: REAR RE-ENTER (above REAR's own
       reference) vs. a fresh sibling reaching its own TZ BUY -- same rule.
    -> REAR RE-ENTER (terminal leaf: single-tier SL/recovery, no further tier)

    TZ GREEN SL (before its own RED2 ever fired), or TZ BUY SL (before TZ BUY
    2 ever formed): immediate fresh sibling, no REAR/RE-ENTER queued at all
    (nothing established yet to recover from).

"Whichever occurred last" (the reference REAR/REAR RE-ENTER queues) always
reduces to "the current reference of the most advanced tier this lineage has
reached", because every tier's own reference is, by construction, both
numerically higher AND chronologically later than the tier before it -- see
_current_top_ref().

Every "2" tier (TZ BUY 2 / BAR 2) shares one shape:
    forms while its parent is pre-SL: Low >= PrevLow, High > parent.ref_high
    by >= THRESH, Close >= parent.ref_high.
and one single-tier SL/recovery cycle (no escalation of its own):
    SL: Low breaks its own ref_low by >= THRESH, Close doesn't reclaim.
    Recovery (same label): High clears sl.ref_high by >= THRESH, Close holds.
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
    """RED1/RED2, shared mechanic reused at every escalation point."""
    ref_high: float
    ref_low: float
    red2_fired: bool = False


def eval_red_tracker(holder, parent_terminated: bool, prev: Day, cur: Day):
    """Attach/advance RED1/RED2 on `holder.red`. `parent_terminated` is
    supplied by the caller -- SL always beats RED1/RED2, so callers must not
    invoke this on a candle where the parent's own SL just fired."""
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
    """Single-tier SL for a "2" structure (TZ BUY 2 / BAR 2) -- no
    escalation of its own. Can recover and re-fire indefinitely."""
    ref_high: float
    ref_low: float


@dataclass
class Tier2:
    """TZ BUY 2 / BAR 2 -- identical shape and identical single-tier
    SL/recovery cycle."""
    ref_high: float
    ref_low: float
    sl: Optional[Tier2SL] = None
    red: Optional[RedTracker] = None

    @property
    def active(self) -> bool:
        """"BAR - BAR2 can occur if TZ BUY 2 is active": pre-SL, or has since
        recovered. Only meaningful for TZ BUY 2 (gates new BAR generations);
        BAR 2's own `.active` isn't consulted by anything."""
        return self.sl is None


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
    """One TZ GREEN -> TZ BUY/TZ BUY2 -> BAR/BAR2 (unlimited) -> [REAR ->
    REAR RE-ENTER] chain."""
    seq: int
    green_ref_high: float
    green_ref_low: float
    red: Optional[RedTracker] = None   # RED1/RED2 vs TZ GREEN directly
    dead: bool = False                 # TZ GREEN's own SL fired
    red2_ever: bool = False            # TZ GREEN's own RED2 has fired at least once

    buy_ref_high: float = 0.0
    buy_ref_low: float = 0.0
    buy_active: bool = False
    buy_sl_fired: bool = False
    buy2: Optional[Tier2] = None       # RED1/RED2 vs TZ BUY 2 lives on buy2.red

    bar_gens: List[BarGen] = field(default_factory=list)
    bar_sub_counter: int = 0

    terminated: bool = False  # this lineage's forward escalation is over --
    # TZ GREEN SL (after its own RED2), TZ BUY SL (before TZ BUY 2 ever
    # formed), or any BAR generation reaching SL2. Opens spawn eligibility
    # for a fresh sibling immediately.

    rear_ref_high: float = 0.0
    rear_ref_low: float = 0.0
    rear_sl: Optional[Tier1SL] = None  # one-way: REAR does not self-recover,
    # it routes into the REAR RE-ENTER race instead (mirrors the base engine:
    # recovery from REAR's own SL is a new milestone name, not a same-label
    # reactivation).
    rear2: Optional[Tier2] = None

    # REAR RE-ENTER: terminal leaf, single-tier SL/recovery under the same
    # label (mirrors the base engine exactly) -- reuses Tier2's HH/LL/SL/
    # recovery machinery wholesale; its `.red` field is simply never used
    # (base engine: "No RED1 possible here").
    rear_reenter: Optional[Tier2] = None


def _current_top_ref(c: Cycle) -> float:
    """"Whichever occurred last": the current reference of the most advanced
    tier this lineage has reached. Every tier's own reference is, by
    construction, both numerically higher AND chronologically later than the
    tier before it, so this always IS "whichever occurred last" -- no
    separate bookkeeping needed."""
    for gen in reversed(c.bar_gens):
        if not gen.superseded:
            return gen.bar2.ref_high if gen.bar2 is not None else gen.ref_high
    if c.bar_gens:
        newest = c.bar_gens[-1]
        return newest.bar2.ref_high if newest.bar2 is not None else newest.ref_high
    if c.buy2 is not None:
        return c.buy2.ref_high
    if c.buy_active or c.buy_sl_fired:
        return c.buy_ref_high
    return c.green_ref_high


class Engine:
    def __init__(self):
        self.cycles: List[Cycle] = []
        self.next_seq = 1
        # Single-slot "race" state (newest terminating event always wins):
        # a reference queued by TZ GREEN SL / TZ BUY SL / BAR SL2 (kind
        # "REAR") or by REAR's own SL (kind "REAR_REENTER"), racing against
        # whichever fresh sibling cycle reaches its own TZ BUY first.
        self.pending_ref: Optional[float] = None
        self.pending_owner: Optional[Cycle] = None
        self.pending_kind: Optional[str] = None  # "REAR" | "REAR_REENTER"

    # -- spawn eligibility -------------------------------------------------
    def _spawn_eligible(self) -> bool:
        """A fresh sibling TZ GREEN may spawn once the most recent cycle's
        own forward escalation is over (`terminated`). Naturally covers
        recursive re-attempts: a sibling that itself dies early immediately
        becomes eligible-anchor for yet another attempt, while any pending
        race keeps running independently in the background."""
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

    # -- the REAR/REAR-RE-ENTER-vs-fresh-cycle race -------------------------
    def _queue_pending(self, owner: Cycle, ref: float, kind: str):
        """Single slot: the newest terminating event always supersedes
        whatever was previously queued."""
        self.pending_ref = ref
        self.pending_owner = owner
        self.pending_kind = kind

    def _eval_pending(self, prev: Day, cur: Day, events: list):
        """Checked once per day, ahead of per-cycle evaluation, so a same-day
        tie against a sibling reaching TZ BUY resolves in the older
        lineage's favor (per the user's explicit tie rule)."""
        if self.pending_ref is None:
            return
        ref = self.pending_ref
        owner = self.pending_owner
        label = branch_label(owner.seq)
        if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
            if self.pending_kind == "REAR":
                owner.rear_ref_high = cur.h
                owner.rear_ref_low = cur.l
                events.append(f"REAR({label})")
            else:
                owner.rear_reenter = Tier2(ref_high=cur.h, ref_low=cur.l)
                events.append(f"REAR RE-ENTER({label})")
            self.pending_ref = None
            self.pending_owner = None
            self.pending_kind = None
        elif cur.h - ref >= ANY - EPS:
            self.pending_ref = cur.h

    # -- per-cycle evaluation -----------------------------------------------
    def _eval_cycle(self, c: Cycle, prev: Day, cur: Day):
        events = []
        label = branch_label(c.seq)
        if c.terminated and not c.rear_ref_high:
            return events  # fully resolved, lost its race, nothing further to show

        if not c.dead and not c.buy_sl_fired:
            # 1. TZ GREEN's own SL -- single-shot. Before its own RED2:
            # immediate fresh sibling, no REAR queued. After: queue REAR
            # above the current top reference (almost always still TZ
            # GREEN's own, since TZ BUY/BAR haven't formed yet in that gap).
            gap = c.green_ref_low - cur.l
            if cur.l <= c.green_ref_low and gap >= THRESH - EPS and cur.c <= c.green_ref_low:
                c.dead = True
                c.terminated = True
                events.append(f"TZ GREEN SL({label})")
                if c.red2_ever:
                    self._queue_pending(c, _current_top_ref(c), "REAR")
                return events

            green_ref_pre = c.green_ref_high  # snapshot before today's own HH

            # 2. TZ GREEN HH/LL.
            if cur.h - c.green_ref_high >= ANY - EPS:
                c.green_ref_high = cur.h
                events.append(f"TZ GREEN HH({label})")
            if cur.l < c.green_ref_low:
                c.green_ref_low = cur.l
                events.append(f"TZ GREEN LL({label})")

            # 3. RED1/RED2 directly against TZ GREEN.
            tag = eval_red_tracker(c, c.dead, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({label})")
                if tag == "RED2":
                    c.red2_ever = True

            # 4. TZ BUY formation -- above TZ GREEN's own reference, once
            # TZ GREEN's own RED2 has fired.
            if not c.buy_active and not c.buy_sl_fired and c.red is not None and c.red.red2_fired:
                ref = green_ref_pre
                if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                    c.buy_active = True
                    c.buy_ref_high = cur.h
                    c.buy_ref_low = cur.l
                    events.append(f"TZ BUY({label})")

        # 5+6. TZ BUY's own tracking (SL only checked before TZ BUY 2 ever
        # forms -- once TZ BUY 2 exists it takes over as the locus of
        # control and TZ BUY's own top-level SL stops mattering, mirroring
        # how the original theory's TZ BUY SL never cascaded into the BAR
        # family below it -- ASSUMPTION, not explicitly stated for v3).
        if c.buy_active and c.buy2 is None:
            gap = c.buy_ref_low - cur.l
            if cur.l <= c.buy_ref_low and gap >= THRESH - EPS and cur.c <= c.buy_ref_low:
                c.buy_active = False
                c.buy_sl_fired = True
                c.terminated = True
                events.append(f"TZ BUY SL({label})")
                # Before TZ BUY 2 ever formed: no REAR queued (mirrors TZ
                # GREEN's own before-RED2 case) -- this lineage is fully
                # done, no further tracking below.
                return events

            # TZ BUY 2 formation uses the PRE-today reference (avoids the
            # same-day self-comparison bug: forming TZ BUY 2 the same day TZ
            # BUY's own HH ratchets up to today's own High).
            buy_ref_pre = c.buy_ref_high
            t2 = try_form_tier2(buy_ref_pre, prev, cur)
            if t2 is not None:
                c.buy2 = t2
                events.append(f"TZ BUY 2({label})")
            elif cur.h - buy_ref_pre >= ANY - EPS:
                c.buy_ref_high = cur.h
                events.append(f"TZ BUY HH({label})")
            if cur.l < c.buy_ref_low:
                c.buy_ref_low = cur.l
                events.append(f"TZ BUY LL({label})")
        elif c.buy2 is not None:
            # Snapshot before today's own HH update, for the first-BAR
            # formation check below (avoids the self-comparison bug).
            buy2_ref_pre = c.buy2.ref_high
            for tag in eval_tier2_hh_ll(c.buy2, prev, cur):
                events.append(f"TZ BUY 2 {tag}({label})")
            for tag in eval_tier2_sl_cycle(c.buy2, prev, cur):
                events.append(f"TZ BUY 2 {tag}({label})")
            if cur.l < c.buy_ref_low:
                c.buy_ref_low = cur.l
                events.append(f"TZ BUY LL({label})")

            # 7. RED1/RED2 against TZ BUY 2, gating the first BAR generation.
            if not c.bar_gens:
                tag = eval_red_tracker(c.buy2, c.buy2.sl is not None, prev, cur)
                if tag:
                    events.append(f"{tag.replace('_', ' ')}({label})")

            # 8. First BAR generation -- above TZ BUY 2's own reference,
            # once TZ BUY 2's own RED2 has fired ("as the original theory"),
            # only while TZ BUY 2 is active ("BAR - BAR2 can occur if TZ BUY
            # 2 is active" -- also gates every later generation, in
            # _eval_bar_chain).
            if (
                not c.bar_gens and c.buy2.active
                and c.buy2.red is not None and c.buy2.red.red2_fired
            ):
                ref = buy2_ref_pre
                if cur.l >= prev.l and cur.h - ref >= THRESH - EPS and cur.c >= ref:
                    c.bar_sub_counter += 1
                    gen = BarGen(label=f"{label}.{c.bar_sub_counter}", ref_high=cur.h, ref_low=cur.l)
                    c.bar_gens.append(gen)
                    events.append(f"BAR({gen.label})")

        # 9. Unlimited BAR/BAR2/RED1/RED2 loop; BAR SL2 queues REAR.
        if not c.terminated:
            self._eval_bar_chain(c, prev, cur, events)

        # 10. REAR's own HH/LL/SL/2, once REAR has confirmed and hasn't
        # already been superseded by a confirmed REAR RE-ENTER.
        if c.rear_ref_high and c.rear_reenter is None:
            self._eval_rear_tracking(c, prev, cur, events)

        # 11. REAR RE-ENTER's own HH/LL/SL/recovery, once it has confirmed.
        if c.rear_reenter is not None:
            for tag in eval_tier2_hh_ll(c.rear_reenter, prev, cur):
                events.append(f"REAR RE-ENTER {tag}({label})")
            for tag in eval_tier2_sl_cycle(c.rear_reenter, prev, cur):
                events.append(f"REAR RE-ENTER {tag}({label})")

        return events

    def _eval_bar_chain(self, c: Cycle, prev: Day, cur: Day, events: list):
        active_gens = [g for g in c.bar_gens if not g.superseded]
        if not active_gens:
            return
        gen = active_gens[-1]

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
                    self._queue_pending(c, _current_top_ref(c), "REAR")
                    return
                if cur.l < gen.sl.ref_low:
                    gen.sl.ref_low = cur.l
                    events.append(f"BAR SL LL({gen.label})")

        if gen.sl is not None:
            return

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

        if gen.bar2 is not None:
            tag = eval_red_tracker(gen.bar2, gen.bar2.sl is not None, prev, cur)
            if tag:
                events.append(f"{tag.replace('_', ' ')}({gen.label})")

        # Next generation only while TZ BUY 2 is still active ("BAR - BAR 2
        # can occur if TZ BUY 2 is active").
        if (
            c.buy2 is not None and c.buy2.active
            and gen.bar2 is not None and gen.bar2.red is not None
            and gen.bar2.red.red2_fired and bar2_ref_pre is not None
        ):
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
                self._queue_pending(c, c.rear_ref_high, "REAR_REENTER")
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

    def _eval_rear_reenter_tracking(self, c: Cycle, prev: Day, cur: Day, events: list):
        """Terminal leaf: single-tier SL/recovery, no further escalation."""
        label = branch_label(c.seq)
        if c.rear_reenter_sl is None:
            gap = c.rear_reenter_ref_low - cur.l
            if cur.l <= c.rear_reenter_ref_low and gap >= THRESH - EPS and cur.c <= c.rear_reenter_ref_low:
                c.rear_reenter_sl = Tier1SL(ref_low=cur.l)
                events.append(f"REAR RE-ENTER SL({label})")
                return
            if cur.h - c.rear_reenter_ref_high >= ANY - EPS:
                c.rear_reenter_ref_high = cur.h
                events.append(f"REAR RE-ENTER HH({label})")
            if cur.l < c.rear_reenter_ref_low:
                c.rear_reenter_ref_low = cur.l
                events.append(f"REAR RE-ENTER LL({label})")
        else:
            if cur.h - c.rear_reenter_sl.ref_low >= THRESH - EPS and cur.c >= c.rear_reenter_ref_high:
                pass  # recovery handled uniformly like other single-tier SLs below
            gap = c.rear_reenter_ref_high - cur.l  # placeholder, refined below

    def process(self, days: List[Day]):
        out = []
        for i in range(1, len(days)):
            prev, cur = days[i - 1], days[i]
            day_events = []

            self._eval_pending(prev, cur, day_events)

            spawn_ev = self._try_spawn(prev, cur)
            if spawn_ev:
                day_events.append(spawn_ev)

            for c in list(self.cycles):
                was_buy_active = c.buy_active
                events = self._eval_cycle(c, prev, cur)
                day_events.extend(events)
                if not was_buy_active and c.buy_active and self.pending_ref is not None:
                    self.pending_ref = None
                    self.pending_owner = None
                    self.pending_kind = None

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
