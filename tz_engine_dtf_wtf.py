"""
DTF / WTF layer -- Daily Time Frame anchored to Weekly Time Frame.

Built entirely on top of the validated main engine (tz_engine_bar2_variant.py),
which is NOT modified except for one small, additive, default-off parameter
on TZEngine._eval_buy (extra_reentry_floor) -- confirmed to produce byte-
identical output against the 2020 verification dataset with the parameter
left at its default. Everything else in this file is new.

*** IMPORTANT CAVEAT ***
Unlike the main engine (verified end-to-end against a full real 2020 OHLC
dataset, line by line), NOTHING in this file has been checked against real
market data -- no dataset for this layer has been supplied. This is a
first, literal, best-effort translation of the rules exactly as specified
through an extensive, iterative, example-driven conversation. Treat it as
a draft implementation to be checked against real data, not as verified.
A few specific gaps are flagged inline where the spec did not say what
happens (search "UNSPECIFIED" below).

======================================================================
THE RULES, AS SPECIFIED
======================================================================

ARCHITECTURE
- WTF (Weekly Time Frame) runs the exact same main engine, fed weekly
  candles resampled from daily data (standard OHLC resampling: Open =
  week's first day's open, High = week's max high, Low = week's min low,
  Close = week's last day's close).
- DTF (Daily Time Frame) is a SEPARATE, independent instance of the same
  main engine, running on daily candles -- except its very first entry
  point (and every re-anchor point after a WTF pause/dormancy/termination
  event) is a special "TZ BUY" formed directly against whichever WTF
  milestone is currently governing, instead of a plain TZ-GREEN PrevHigh
  breakout. Once DTF's own first BAR SL2 fires, DTF permanently detaches
  from WTF and becomes a fully standard, self-contained instance of the
  main engine from that point forward (plain TZ GREEN cycles, exactly
  like the base engine, no further WTF involvement ever again) -- run in
  PARALLEL with the original anchored structure's own REAR/REAR 2/REAR
  RE-ENTER progression, which keeps going independently off that BAR's
  own reference (both tracks coexist; confirmed by the worked example
  "...BAR SL 2 - TZ GREEN (NEW LINEAGE NOT REACHING TZ BUY) - REAR.").
- Events are recorded end-of-day only (no intraday/live streaming).

WTF'S OWN STATE MACHINE (governs whether/how DTF runs)
- WTF PAUSES on its own RED2 (at whichever tier is currently active -- TZ
  BUY 2, BAR, REAR, REAR 2, etc. -- any tier). DTF halts completely; DTF's
  entire internal state is discarded, no memory retained.
- WTF RESTARTS once a fresh BAR forms in WTF (BAR alone is sufficient --
  BAR 2 is not required).
- WTF becomes DORMANT once WTF's own BAR reaches BAR SL2. Resolved by a
  race: a brand-new TZ GREEN cycle reaching its own TZ BUY 2, vs. the
  original lineage's REAR reaching REAR 2 -- whichever happens first. DTF
  halts entirely during this dormant window too (full discard).
- WTF TERMINATES when TZ GREEN SL trades (the base engine's normal
  cascade termination). The terminating branch's DTF history is fully
  discarded/irrelevant. DTF then re-anchors via another race: (A) the
  brand-new TZ GREEN cycle reaching its own TZ BUY 2, vs. (B) some other
  still-alive earlier branch (from the base engine's normal multi-branch/
  leadership-contest structure) that was mid-recovery (BAR SL2->REAR
  path, REAR SL->reactivation, or TZ BUY SL->reactivation) actually
  completing that reactivation first.
- Once any dormancy/termination race resolves (to TZ BUY 2 or to REAR 2),
  DTF behaves identically regardless of which one won -- same TZ BUY /
  TZ BUY 2 mechanism, just anchored to whichever reference is now current.

DTF'S ENTRY-POINT / ANCHORING MECHANICS
- After WTF reaches TZ BUY 2 (or, identically, REAR 2): DTF's TZ BUY forms
  when DTF's High and Close > WTF's governing reference high (>= 0.20 pt
  minimum difference) and DTF's Low >= previous day's DTF low. DTF's own
  TZ BUY 2 (= "TZ BUY ENTRY", confirmed interchangeable name) then forms
  off DTF's own TZ BUY reference, exactly like the main engine's TZ BUY 2.
- RED1/RED2 in DTF only becomes possible once DTF's own TZ BUY 2 (TZ BUY
  ENTRY) is active -- TZ BUY alone is not enough (general principle,
  confirmed to generalize across tiers: RED1/RED2 needs the "2" tier, or
  BAR 2, to be active).
- DTF's own reactivation-on-SL: retry above whichever of {DTF TZ BUY's
  own ref, DTF TZ BUY 2's ref} is more mature -- exactly the main engine's
  existing TZ BUY reactivation rule, no DTF-specific change needed there.
- "TZ BUY SL2": TZ BUY's own SL failing a second, deeper time after an
  intervening recovery -- mirrors BAR SL2 structurally but does NOT
  escalate to REAR. (Reachable for free: this is exactly what happens if
  DTF's TZ BUY reactivates in place and then fails again -- the main
  engine's existing single-tier TZ BUY reactivation, run twice, already
  produces this; no extra code needed.)
- DTF's post-entry progression matches the main engine one-for-one: RED1
  -> RED2 -> BAR -> BAR2 -> (loop, no limit) -> RED1 -> RED2 -> REAR (only
  if a BAR SL2 fires) or a fresh, fully independent TZ GREEN cycle.
- DTF's "new cycle" (post BAR SL2) is a fully standard, self-contained TZ
  GREEN cycle -- plain day-over-day comparison, exactly like the base
  engine, with NO further WTF involvement.

DISPLAY RULES (deferred; NOT applied here -- "while testing show the
events" -- kept only as a comment for the future UI phase):
  TZ BUY's own formation/HH/LL/SL hidden; TZ BUY ENTRY's own HH/LL
  hidden; visible only "TZ BUY ENTRY(label)" and "TZ BUY ENTRY SL(label)";
  once superseded by a deeper tier, TZ BUY ENTRY's own HH stops entirely;
  no same-day TZ-BUY-SL-vs-TZ-BUY-ENTRY-SL suppression (TZ BUY ENTRY SL
  always shows on its own trigger).

RULE A / RULE B (once WTF reaches plain BAR, not BAR 2)
- Rule A: DTF's TZ BUY / TZ BUY 2 form directly above WTF's BAR reference
  high -- identical mechanism to the TZ-BUY-2-anchor case above.
- Rule B: a standalone track, no dependency on any prior DTF event --
  starts with a plain day-over-day RED1 (can occur on the 1st day after
  WTF BAR or any later day). RED1 alone is sufficient to proceed to BAR
  (scenario 1b), or RED1 can resolve into RED2 first (scenario 1a) --
  either way the same breakout-above-recent-high produces "BAR" directly
  (playing the same structural role TZ BUY plays in the base engine, one
  tier down, minus any TZ-GREEN-style wrapper). BAR's own SL reactivates
  via the standard "fresh breakout above previous day's high" shape, NOT
  gated on clearing the earlier BAR's own frozen reference (scenario 1c:
  "reference high will be considered only after BAR ENTRY"). "BAR ENTRY"
  = Rule B's own "2" tier, structurally identical to BAR 2 one tier up
  (own HH/LL/SL/recovery, gates further RED1/RED2 on Rule B's own BAR).

  Full resolved Rule A / Rule B relationship:
  1. Rule B completes (reaches BAR 2 / BAR ENTRY) before Rule A ever forms
     -> Rule A is permanently blocked, can never occur.
  2. Rule A forms before Rule B completes -> Rule A leads. A BAR-BAR2
     structure can still form underneath it (RED1/RED2 while TZ BUY ENTRY
     is active), but does NOT get "BAR ENTRY" status/label while Rule A
     leads -- it is exactly the ordinary "BAR(...)"/"BAR 2(...)" event the
     main engine already produces under a TZ BUY, just tracked in the
     background as a live candidate reference (never discarded).
  3. On any SL of Rule A, reentry occurs above max(Rule A's own reference
     high, Rule B's BAR 2 reference high -- if BAR 2 has formed by that
     point). Uniform "always take the max of whatever currently exists"
     rule -- no permanent discarding of either side, regardless of which
     order the two references matured in. (Implemented via the
     extra_reentry_floor hook on TZEngine._eval_buy.)
  4. If Rule A fails (TZ BUY ENTRY SL) with NO BAR2(B) yet formed at all,
     two fresh, independent candidates go live simultaneously: a brand-
     new RED1-RED2-BAR-BAR ENTRY track (Rule B, starting clean) at its own
     (typically lower) breakout level, and TZ BUY ENTRY's own reentry
     above its own reference high. Whichever level is actually crossed on
     the earlier calendar date governs. On a same-day tie, TZ BUY ENTRY
     (Rule A) wins.
  5. If Rule B wins that live race (its BAR ENTRY is what actually
     triggers) -> Rule A dies permanently -- symmetric with rule 1.

  UNSPECIFIED: what happens to Rule B if its own BAR 2 (BAR ENTRY) later
  reaches its own SL with no further escalation defined (no "REAR" was
  ever specified for Rule B). Implemented here as: Rule B's BAR 2 just
  freezes and keeps climbing as "INVALID BAR HH(RuleB)" forever after,
  mirroring the main engine's own dead-lineage behavior, pending
  confirmation from real data / further rules.
"""
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional

from tz_engine_bar2_variant import (
    Day, Bar2, BarSL, BarLineage, Buy, ParentCycle, TZEngine,
    branch_label, THRESH, ANY, EPS,
)

# ======================================================================
# Weekly resampling
# ======================================================================
def resample_weekly(days: list) -> list:
    """Standard Mon-Sun weekly OHLC resampling. The resulting weekly Day is
    labeled with its own last trading day's date (the day the week's data
    is fully known -- WTF only ever "sees" a completed week)."""
    weeks = []
    group = []
    week_start = None
    for d in days:
        dt = datetime.strptime(d.date, "%d-%m-%Y")
        wk = dt - timedelta(days=dt.weekday())
        if week_start is None or wk != week_start:
            if group:
                weeks.append(group)
            group = []
            week_start = wk
        group.append(d)
    if group:
        weeks.append(group)
    out = []
    for g in weeks:
        out.append(Day(
            date=g[-1].date,
            o=g[0].o,
            h=max(x.h for x in g),
            l=min(x.l for x in g),
            c=g[-1].c,
        ))
    return out


# ======================================================================
# WTF state machine
# ======================================================================
class WTFPhase:
    ACTIVE = "ACTIVE"
    PAUSED = "PAUSED"
    DORMANT = "DORMANT"
    TERMINATED = "TERMINATED"


@dataclass
class WTFAnchor:
    kind: str          # "TZ_BUY2", "BAR", "REAR_2"
    ref_high: float
    pc_id: int


def _label_root(label: str) -> str:
    return label.split(".")[0]


def _label_to_id(label: str) -> int:
    n = 0
    for ch in label:
        n = n * 26 + (ord(ch) - ord('A') + 1)
    return n


class WTFStateMachine:
    """Wraps a real TZEngine, fed weekly candles. Classifies WTF's own
    phase and DTF's current anchor from the weekly event stream plus the
    engine's own live object state (for exact reference values)."""

    def __init__(self):
        self.engine = TZEngine()
        self.phase = WTFPhase.ACTIVE
        self.anchor: Optional[WTFAnchor] = None
        self._racing = False
        self._race_kind = None            # "DORMANT" or "TERMINATED"
        self._race_baseline_seq = 0        # branches with seq > this = "the new cycle"
        self._race_old_pc_id = None        # the pc.id whose REAR/etc. is the "earlier" race arm
        self.just_transitioned = False     # True on the week a pause/dormant/terminate FIRST fires

    def process_week(self, prev_week: Day, cur_week: Day):
        self.just_transitioned = False
        events = self.engine.process(prev_week, cur_week)

        # --- racing resolution (checked before new transitions this week) ---
        if self._racing:
            self._try_resolve_race(events)

        # --- fresh transitions this week ---
        if self.phase == WTFPhase.ACTIVE:
            if any(e.startswith("TZ GREEN SL(") for e in events):
                self.phase = WTFPhase.TERMINATED
                self.anchor = None
                self._start_race("TERMINATED")
                self.just_transitioned = True
            elif any("RED2(" in e for e in events):
                self.phase = WTFPhase.PAUSED
                self.anchor = None
                self.just_transitioned = True
            elif any(e.startswith("BAR SL2(") for e in events):
                self.phase = WTFPhase.DORMANT
                self.anchor = None
                self._start_race("DORMANT")
                self.just_transitioned = True
        elif self.phase == WTFPhase.PAUSED:
            if any(e.startswith("BAR(") for e in events):
                self.phase = WTFPhase.ACTIVE
                self.just_transitioned = True

        # --- update the current anchor reference from live engine state ---
        if self.phase == WTFPhase.ACTIVE:
            self._update_anchor(events)

        return events

    def _start_race(self, kind):
        self._racing = True
        self._race_kind = kind
        self._race_baseline_seq = self.engine._seq_counter
        # the "earlier" arm: whichever branch is still alive right now
        # (dormant is fine) other than a brand-new one that hasn't spawned yet
        alive = [pc for pc in self.engine.branches.values()]
        self._race_old_pc_id = alive[-1].id if alive else None

    def _try_resolve_race(self, events):
        # Arm (A): a NEW cycle (spawned after the race began) reaching TZ BUY 2
        for pid, pc in self.engine.branches.items():
            if pc.seq <= self._race_baseline_seq:
                continue
            if pc.buy is not None and pc.buy.tz_buy2 is not None:
                label = branch_label(pid)
                if any(e.startswith(f"TZ BUY 2({label})") for e in events):
                    self.anchor = WTFAnchor("TZ_BUY2", pc.buy.tz_buy2.ref_high, pid)
                    self.phase = WTFPhase.ACTIVE
                    self._racing = False
                    return
        # Arm (B): an earlier, still-alive branch's REAR reaching REAR 2
        # (dormancy race), or that same branch reactivating at all --
        # TZ BUY, REAR, or REAR RE-ENTER (termination race).
        if self._race_old_pc_id is not None and self._race_old_pc_id in self.engine.branches:
            pc = self.engine.branches[self._race_old_pc_id]
            label = branch_label(pc.id)
            if self._race_kind == "DORMANT":
                if pc.buy is not None and pc.buy.rear is not None and pc.buy.rear.rear2 is not None:
                    if any(e.startswith(f"REAR 2({label})") for e in events):
                        self.anchor = WTFAnchor("REAR_2", pc.buy.rear.rear2.ref_high, pc.id)
                        self.phase = WTFPhase.ACTIVE
                        self._racing = False
                        return
            else:  # TERMINATED race
                if any(e.startswith(f"REAR({label})") for e in events) and pc.buy is not None and pc.buy.rear is not None:
                    self.anchor = WTFAnchor("REAR_2", pc.buy.rear.ref_high, pc.id)
                    self.phase = WTFPhase.ACTIVE
                    self._racing = False
                    return
                if any(e.startswith(f"REAR RE-ENTER({label})") for e in events) and pc.buy is not None and pc.buy.rear_reenter is not None:
                    self.anchor = WTFAnchor("REAR_2", pc.buy.rear_reenter.ref_high, pc.id)
                    self.phase = WTFPhase.ACTIVE
                    self._racing = False
                    return
                if (any(e.startswith(f"TZ BUY({label})") for e in events) and pc.buy is not None
                        and pc.buy.tz_buy2 is None):
                    # a plain TZ BUY reactivation with no TZ BUY 2 yet --
                    # anchor DTF straight to TZ BUY's own reference.
                    self.anchor = WTFAnchor("TZ_BUY2", pc.buy.ref_high, pc.id)
                    self.phase = WTFPhase.ACTIVE
                    self._racing = False
                    return

    def _update_anchor(self, events):
        for pid, pc in self.engine.branches.items():
            if pc.buy is None:
                continue
            label = branch_label(pid)
            buy = pc.buy
            if any(e.startswith(f"BAR({label}.") or e == f"BAR({label})" for e in events) and buy.bar_lineages:
                self.anchor = WTFAnchor("BAR", buy.bar_lineages[-1].ref_high, pid)
            if any(e.startswith(f"TZ BUY 2({label})") for e in events) and buy.tz_buy2 is not None:
                self.anchor = WTFAnchor("TZ_BUY2", buy.tz_buy2.ref_high, pid)
            if (buy.rear is not None and buy.rear.rear2 is not None and
                    any(e.startswith(f"REAR 2({label})") for e in events)):
                self.anchor = WTFAnchor("REAR_2", buy.rear.rear2.ref_high, pid)


# ======================================================================
# DTF -- "simple" anchor case (WTF at TZ BUY 2 or REAR 2): plain reuse of
# the main engine's own TZ BUY / TZ BUY 2 / BAR-loop / REAR machinery,
# just seeded directly instead of via a TZ-GREEN breakout.
# ======================================================================
class DTFSimpleAnchor:
    def __init__(self):
        self.engine = TZEngine()
        self.pc = ParentCycle(id=1, seq=1, ref_high=0.0, ref_low=0.0, red_ever=True)
        self.engine.branches[1] = self.pc
        self.formed = False

    def try_form(self, anchor_ref: float, prev: Day, cur: Day):
        if self.formed:
            return []
        if (cur.l >= prev.l and cur.h > anchor_ref and (cur.h - anchor_ref) >= THRESH - EPS
                and cur.c >= anchor_ref):
            self.pc.buy = Buy(ref_high=cur.h, ref_low=cur.l)
            self.formed = True
            return ["TZ BUY(A)"]
        return []

    def step(self, prev: Day, cur: Day):
        if not self.formed or self.pc.buy is None:
            return []
        return self.engine._eval_buy(self.pc, self.pc.buy, prev, cur)

    def bar_sl2_fired(self, events) -> bool:
        return any(e.startswith("BAR SL2(") for e in events)


# ======================================================================
# DTF -- Rule B track (standalone, only used while WTF is at plain BAR)
# ======================================================================
@dataclass
class _RuleBPre:
    ref_high: float
    ref_low: float
    red_ever: bool = False
    ref_high_at_red: float = 0.0
    seeded: bool = False


class RuleBTrack:
    """Standalone RED1[-RED2]->BAR->BAR ENTRY(=BAR2) track. No dependency
    on Rule A. Plays the same structural role TZ BUY plays in the base
    engine, one tier down, minus a TZ-GREEN-style wrapper -- so its own
    RED1/BAR formation is written out explicitly here rather than reusing
    _eval_parent (which is TZ-GREEN-specific)."""

    def __init__(self):
        self._engine = TZEngine()          # only used for its reusable methods
        self._pc = ParentCycle(id=1, seq=1, ref_high=0.0, ref_low=0.0)
        self._buy = Buy(ref_high=0.0, ref_low=0.0)  # holds bar_lineages/red1 only
        self.pre = None
        self.lin: Optional[BarLineage] = None
        self.dead = False

    def step(self, prev: Day, cur: Day):
        ev = []
        if self.pre is None:
            # first day this track is watched: just seed, no comparison yet
            self.pre = _RuleBPre(ref_high=cur.h, ref_low=cur.l)
            return ev
        if self.lin is None:
            p = self.pre
            if not p.red_ever:
                if cur.h > p.ref_high and (cur.h - p.ref_high) >= ANY:
                    p.ref_high = cur.h
            if cur.l < p.ref_low:
                p.ref_low = cur.l
            if not p.red_ever:
                if (cur.h <= prev.h and cur.l < prev.l and (prev.l - cur.l) >= THRESH - EPS
                        and cur.c <= prev.l):
                    p.red_ever = True
                    p.ref_high_at_red = p.ref_high
                    ev.append("RED1(RuleB)")
            if p.red_ever:
                ref_high = max(p.ref_high, p.ref_high_at_red)
                if (cur.l >= prev.l and cur.h > ref_high and (cur.h - ref_high) >= THRESH - EPS
                        and cur.c >= ref_high):
                    self.lin = BarLineage(label="RuleB", ref_high=cur.h, ref_low=cur.l)
                    self._buy.bar_lineages = [self.lin]
                    ev.append("BAR(RuleB)")
            return ev

        if self.dead:
            return ev

        lin = self.lin
        eng = self._engine
        # HH/LL tracking + BAR 2 (="BAR ENTRY") formation/HH/LL/SL/recovery,
        # reusing the main engine's own single-lineage helpers verbatim.
        # Pre-today snapshot taken BEFORE the HH tracking mutates lin.ref_high
        # -- same same-day self-reference hazard documented throughout the
        # main engine file (BAR 2's formation must compare against lin's
        # reference AS OF THE START OF TODAY, not after today's own HH climb).
        pre_today_lin_ref = lin.ref_high
        if lin.sl is None:
            ev += eng._eval_bar_lineage_hh(self._pc, self._buy, lin, prev, cur)
            ev += eng._eval_bar2(self._pc, self._buy, lin, prev, cur, pre_today_lin_ref)
        else:
            ev += eng._eval_bar2(self._pc, self._buy, lin, prev, cur, pre_today_lin_ref)

        if lin.sl is None:
            if (cur.l < lin.ref_low and (lin.ref_low - cur.l) >= THRESH - EPS and cur.c <= lin.ref_low + EPS):
                ev.append("BAR SL(RuleB)")
                lin.sl = BarSL(ref_high=cur.h, ref_low=cur.l)
                self._buy.red1 = None
                return ev
            red1_preexisting = self._buy.red1 is not None and self._buy.red1.active
            if red1_preexisting:
                ev += eng._eval_red1_generic(self._pc, self._buy, lin, prev, cur)
            elif lin.bar2 is not None and not lin.red2_ever:
                ev += eng._attach_fresh_red1(self._pc, self._buy, lin, prev, cur)
            return ev

        # lin.sl is not None: reactivation, NOT gated on the earlier BAR's
        # own reference (scenario 1c: "reference high considered only after
        # BAR ENTRY") -- plain fresh-breakout-above-previous-day shape.
        if lin.bar2 is None:
            # dead end: this Rule B attempt never reached BAR ENTRY, so per
            # rule 1/5 it never "completed" -- but a plain BAR reactivation
            # is still available (mirrors the main engine's own INVALID BAR
            # SL -> BAR reactivation path).
            if eng._bar_entry_shape(prev, cur):
                lin.sl = None
                lin.ref_high = cur.h
                lin.ref_low = cur.l
                ev.append("BAR(RuleB)")
            return ev
        # UNSPECIFIED beyond this point (see module docstring): no further
        # escalation was defined for Rule B once its own BAR 2 fails its
        # own SL. Freezing it here, matching the main engine's own
        # dead-lineage behavior for a lineage whose SL fired with no
        # further path back up.
        self.dead = True
        return ev

    @property
    def bar2_ref(self) -> Optional[float]:
        if self.lin is not None and self.lin.bar2 is not None:
            return self.lin.bar2.ref_high
        return None

    @property
    def entered(self) -> bool:
        """True once Rule B has actually reached BAR ENTRY (BAR 2) --
        the "completed" threshold used by rules 1 and 5."""
        return self.bar2_ref is not None


# ======================================================================
# DTF -- Rule A / Rule B dual-track orchestration (WTF at plain BAR only)
#
# IMPORTANT correction made after re-reading scenarios 2(a)-2(e): once
# Rule A has actually formed, a subsequent "BAR - BAR 2" in the same
# narrative is NOT a separately-running standalone object -- it is Rule
# A's own ordinary BAR/BAR 2 forming via its own RED1/RED2 (already fully
# automatic inside TZEngine._eval_buy, since RED1 attaches once
# buy.tz_buy2 exists). A genuinely SEPARATE standalone Rule B object only
# ever matters (a) before Rule A has formed at all, or (b) after Rule A's
# own SL fires with nothing yet formed underneath it (rule 4's fresh
# race). While Rule A is leading with something already formed under it,
# "Rule B's BAR 2 reference" in rule 3's max-comparison is simply Rule
# A's own current newest bar_lineage's bar2 reference -- read directly off
# buy.bar_lineages, no separate object needed.
# ======================================================================
class DTFBarDual:
    def __init__(self):
        self.rule_a = DTFSimpleAnchor()
        self.rule_b = RuleBTrack()      # only stepped before Rule A ever forms, or during a rule-4 race
        self.rule_a_dead = False
        self.resolved = None            # None while racing; "A" or "B" once permanently decided
        self._racing_after_sl = False   # rule 4: a fresh Rule A-vs-Rule B race is live right now

    def start(self, wtf_bar_ref: float):
        self._wtf_bar_ref = wtf_bar_ref

    def step(self, wtf_bar_ref: float, prev: Day, cur: Day):
        if self.resolved == "B":
            return self.rule_b.step(prev, cur)

        if not self.rule_a.formed:
            # pre-formation race: Rule A watches for its own breakout above
            # the WTF BAR reference; Rule B tracks its own independent
            # RED1[-RED2]->BAR->BAR ENTRY in parallel.
            a_ev = self.rule_a.try_form(wtf_bar_ref, prev, cur)
            b_ev = [] if self.rule_a_dead else self.rule_b.step(prev, cur)

            if self.rule_a.formed:
                self.resolved = "A"
                return a_ev + b_ev
            # rule 1: Rule B reaches its own BAR ENTRY before Rule A ever forms
            if self.rule_b.entered and not self.rule_a_dead:
                self.rule_a_dead = True
                self.resolved = "B"
            return a_ev + b_ev

        # Rule A has formed and leads (or is racing again post-SL, rule 4).
        ra = self.rule_a
        buy = ra.pc.buy
        was_active = buy.active

        extra_floor = None
        if buy.bar_lineages and buy.bar_lineages[-1].bar2 is not None:
            extra_floor = buy.bar_lineages[-1].bar2.ref_high

        ev = ra.engine._eval_buy(ra.pc, buy, prev, cur, extra_reentry_floor=extra_floor)
        sl_fired_now = was_active and not buy.active

        if self._racing_after_sl:
            # rule 4 race in progress: check whether Rule B's own BAR ENTRY
            # (tier 2, symmetric with Rule A's own reentry being a tier-2
            # event) confirms this same day.
            rb_ev = self.rule_b.step(prev, cur)
            if self.rule_b.entered:
                # Rule B wins the race -> Rule A dies permanently (rule 5),
                # UNLESS Rule A's own reentry fired on this SAME day, in
                # which case Rule A wins the tie (rule 4's closing clause).
                if buy.active:
                    self._racing_after_sl = False
                else:
                    self.rule_a_dead = True
                    self.resolved = "B"
            elif buy.active:
                # Rule A's own reentry fired first -- race over, A keeps leading.
                self._racing_after_sl = False
            return ev + rb_ev

        if sl_fired_now and extra_floor is None:
            # rule 4: nothing had formed under Rule A yet -- a fresh,
            # independent Rule B race starts now.
            self.rule_b = RuleBTrack()
            self._racing_after_sl = True

        return ev


# ======================================================================
# DTF top-level engine
# ======================================================================
class DTFPhase:
    AWAITING_WTF = "AWAITING_WTF"
    ANCHORED_SIMPLE = "ANCHORED_SIMPLE"
    ANCHORED_BAR_DUAL = "ANCHORED_BAR_DUAL"
    INDEPENDENT = "INDEPENDENT"


class DTFEngine:
    def __init__(self):
        self.phase = DTFPhase.AWAITING_WTF
        self._simple: Optional[DTFSimpleAnchor] = None
        self._dual: Optional[DTFBarDual] = None
        self._independent: Optional[TZEngine] = None
        self._old_track: Optional[DTFSimpleAnchor] = None  # keeps running REAR/etc. post BAR SL2
        self._prev_anchor_kind = None

    def _reset(self):
        self.phase = DTFPhase.AWAITING_WTF
        self._simple = None
        self._dual = None
        self._prev_anchor_kind = None
        # NOTE: independent-phase tracks (post first BAR SL2) are NOT reset
        # by WTF pause/dormancy/termination -- "TZ GREEN has got nothing to
        # do with the start from tz buy... BAR SL 2 does not have any thing
        # to do in wtf" -- once DTF is independent it stays independent.

    def process_day(self, wtf: WTFStateMachine, prev: Day, cur: Day):
        if self.phase == DTFPhase.INDEPENDENT:
            return self._step_independent(prev, cur)

        if wtf.phase in (WTFPhase.PAUSED, WTFPhase.DORMANT, WTFPhase.TERMINATED):
            if self.phase != DTFPhase.AWAITING_WTF:
                self._reset()
            return []

        # wtf.phase == ACTIVE
        if wtf.anchor is None:
            return []

        if wtf.anchor.kind != self._prev_anchor_kind and self.phase != DTFPhase.AWAITING_WTF:
            # WTF's governing structure changed (e.g. TZ_BUY2 -> BAR ->
            # REAR_2 as it progresses) while DTF had not yet formed
            # anything of its own -- re-anchor to the new reference.
            if not self._has_formed_anything():
                self._reset()

        if wtf.anchor.kind in ("TZ_BUY2", "REAR_2"):
            return self._step_simple(wtf, prev, cur)
        if wtf.anchor.kind == "BAR":
            return self._step_dual(wtf, prev, cur)
        return []

    def _has_formed_anything(self) -> bool:
        if self.phase == DTFPhase.ANCHORED_SIMPLE:
            return self._simple is not None and self._simple.formed
        if self.phase == DTFPhase.ANCHORED_BAR_DUAL:
            return self._dual is not None and (self._dual.rule_a.formed or self._dual.rule_b.entered)
        return False

    def _step_simple(self, wtf, prev, cur):
        if self.phase != DTFPhase.ANCHORED_SIMPLE:
            self.phase = DTFPhase.ANCHORED_SIMPLE
            self._simple = DTFSimpleAnchor()
            self._prev_anchor_kind = wtf.anchor.kind
        ev = self._simple.try_form(wtf.anchor.ref_high, prev, cur)
        ev += self._simple.step(prev, cur)
        if self._simple.bar_sl2_fired(ev):
            self._go_independent()
        return ev

    def _step_dual(self, wtf, prev, cur):
        if self.phase != DTFPhase.ANCHORED_BAR_DUAL:
            self.phase = DTFPhase.ANCHORED_BAR_DUAL
            self._dual = DTFBarDual()
            self._dual.start(wtf.anchor.ref_high)
            self._prev_anchor_kind = wtf.anchor.kind
        ev = self._dual.step(wtf.anchor.ref_high, prev, cur)
        if self._dual.resolved == "A" and any(e.startswith("BAR SL2(") for e in ev):
            self._go_independent()
        return ev

    def _go_independent(self):
        # the just-finished anchored track keeps running its own
        # REAR/REAR2/REAR RE-ENTER progression forever after -- it is not
        # discarded, it just stops being what DTF's ENTRY logic looks at.
        self._old_track = self._simple if self.phase == DTFPhase.ANCHORED_SIMPLE else (
            self._dual.rule_a if self._dual is not None else None)
        self.phase = DTFPhase.INDEPENDENT
        self._independent = TZEngine()

    def _step_independent(self, prev, cur):
        ev = list(self._independent.process(prev, cur))
        if self._old_track is not None and self._old_track.pc.buy is not None:
            old_ev = self._old_track.engine._eval_buy(
                self._old_track.pc, self._old_track.pc.buy, prev, cur)
            # disambiguate: the old anchored track and the fresh
            # independent engine both start their own branch numbering
            # from "A" -- prefix the old track's labels so they never
            # collide with the independent engine's own fresh branches.
            old_ev = [e.replace("(A", "(OLD-A", 1) if "(A" in e else e for e in old_ev]
            ev += old_ev
        return ev


# ======================================================================
# Top-level driver: combines WTF (weekly) + DTF (daily)
# ======================================================================
def run(days: list):
    """days: full daily OHLC series (chronological). Advances WTF once per
    completed week (using that week's last trading day as the event date)
    and DTF every single day. Returns a list of (date, dtf_events,
    wtf_events_or_None) tuples."""
    weekly = resample_weekly(days)
    wtf = WTFStateMachine()
    dtf = DTFEngine()

    # Build a lookup: for each daily index, which weekly candle (if any)
    # closes on that day.
    weekly_close_dates = {w.date for w in weekly}

    out = []
    prev_day = days[0]
    prev_week = weekly[0]
    week_idx = 1
    for i in range(1, len(days)):
        cur_day = days[i]
        wtf_ev = None
        if cur_day.date in weekly_close_dates and week_idx < len(weekly):
            cur_week = weekly[week_idx]
            wtf_ev = wtf.process_week(prev_week, cur_week)
            prev_week = cur_week
            week_idx += 1

        dtf_ev = dtf.process_day(wtf, prev_day, cur_day)
        out.append((cur_day.date, dtf_ev, wtf_ev))
        prev_day = cur_day

    return out


if __name__ == "__main__":
    import csv
    import os

    HERE = os.path.dirname(os.path.abspath(__file__))
    DATASET = os.path.join(HERE, "data", "tz_2020_verification_dataset.csv")
    days = []
    with open(DATASET, newline="") as f:
        for row in csv.DictReader(f):
            days.append(Day(date=row["DATE"], o=float(row["OPEN"]), h=float(row["HIGH"]),
                             l=float(row["LOW"]), c=float(row["CLOSE"])))
    for date, dtf_ev, wtf_ev in run(days):
        line = f"{date:12}"
        if wtf_ev:
            line += f"  WTF: {' + '.join(wtf_ev)}"
        if dtf_ev:
            line += f"  DTF: {' + '.join(dtf_ev)}"
        if wtf_ev or dtf_ev:
            print(line)
