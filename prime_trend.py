"""
PRIME TREND -- the DTF-with-respect-to-WTF cross-timeframe follow-up
theory, built on top of TZ BUY (tz_engine_wtf.py). See
PRIME_TREND_RULEBOOK.md for the full specification; read that first if
any term here (WTF TZ BUY 2, BAR SL2, THRESH/ANY, "whichever is higher"
reactivation, etc.) is unfamiliar. This module does NOT modify or
extend TZEngine -- it's a separate, dependent consumer: it runs TZEngine
once over the WTF series to get the WTF event trace (and, alongside it,
a snapshot of each branch's own TZ BUY 2 reference low before every
candle -- needed to resolve the exact WTF-side exit price), then walks
the DTF series on its own using that trace as an anchor.

Every threshold/shape condition below is copy-identical to the ones
already used throughout tz_engine_wtf.py (THRESH=0.20 breakout/SL/
reactivation clearance, ANY=0.01 quiet HH/LL, the `l>=prev.l, h>ref+
THRESH, c>=ref` breakout shape) -- PRIME TREND introduces no new
numeric rules, only a new place to apply the same ones.

STATUS: verified against real ADANIENT.NS WTF+DTF data -- reproduces
the worked table in PRIME_TREND_RULEBOOK.md exactly (see
test_prime_trend_smoke.py).
"""

from dataclasses import dataclass
from typing import Optional

from tz_engine_wtf import Day, TZEngine, branch_label, THRESH, ANY, EPS


# --------------------------------------------------------------------------
# Result type
# --------------------------------------------------------------------------

@dataclass
class PrimeTrendResult:
    letter: str
    wtf_formation_date: str
    entry_date: str
    entry_price: float
    exit_type: str
    exit_date: str
    exit_price: Optional[float]
    highest_high: Optional[float]
    highest_high_date: Optional[str]


@dataclass
class PrimeTrendLiveStatus:
    """A live/right-now snapshot of one currently-open WTF TZ BUY 2
    instance's own Stage 1 / Stage 2 state -- for a screener asking "is
    this stock sitting in a PRIME TREND zone right now", as opposed to
    compute_prime_trend's own historical trade log (which only reports a
    CLOSED or still-open Stage 2 entry, per the Filter rule in
    PRIME_TREND_RULEBOOK.md -- a stock that's only reached Stage 1 never
    appears there at all). Both stage1_* and stage2_* fields are None
    when that stage isn't currently active; stage2_active implies
    stage1_active (Stage 2 cannot outlive Stage 1's own SL -- see
    PRIME_TREND_RULEBOOK.md's "Dependency on Stage 1")."""
    letter: str
    stage1_active: bool
    stage1_since: Optional[str]
    stage1_activation_price: Optional[float]
    stage1_highest_high: Optional[float]
    stage1_highest_high_date: Optional[str]
    stage2_active: bool
    stage2_since: Optional[str]
    stage2_activation_price: Optional[float]
    stage2_highest_high: Optional[float]
    stage2_highest_high_date: Optional[str]


# --------------------------------------------------------------------------
# Stage 1 / Stage 2 state (mirrors Buy/Bar2's own ref_high/ref_low shape)
# --------------------------------------------------------------------------

class _Stage:
    __slots__ = ("ref_high", "ref_low", "active", "frozen_ref", "entry_ratchet")

    def __init__(self, ref_high: float, ref_low: float):
        self.ref_high = ref_high
        self.ref_low = ref_low
        self.active = True
        self.frozen_ref: Optional[float] = None
        self.entry_ratchet = ref_high  # only meaningful on Stage 1; tracks Stage 2's escalation ladder


def _breakout_shape(prev: Day, cur: Day, ref: float) -> bool:
    return cur.l >= prev.l and cur.h > ref and (cur.h - ref) >= THRESH - EPS and cur.c >= ref


def _sl_shape(cur: Day, ref_low: float) -> bool:
    return cur.l < ref_low and (ref_low - cur.l) >= THRESH - EPS and cur.c <= ref_low + EPS


# --------------------------------------------------------------------------
# Step 1: run TZEngine once over the WTF series. Alongside the ordinary
# event trace, snapshot every branch's own TZ BUY 2 ref_low BEFORE each
# candle is processed -- the same "pre-today snapshot" pattern used
# throughout tz_engine_wtf.py itself, needed here because a TZ BUY SL
# (top-level) wipes buy.tz_buy2 to None as PART of that same candle, so
# the only place the ref_low it had is still readable is before that
# candle runs.
# --------------------------------------------------------------------------

def _run_wtf_trace(wtf_days: list[Day]):
    """Branch LETTERS get recycled -- once a branch dies (whether via an
    explicit SL or via collateral termination from the multi-branch
    leadership rules, which emits no SL-type event at all), its id frees
    up and a later, wholly unrelated branch can reuse the same letter.
    So every snapshot here is keyed by `pid` (stable for one branch's
    whole life), never by letter alone -- letter is only resolved from
    `pid` at the point of use, since it's a pure function of `pid` for as
    long as that specific branch is alive."""
    engine = TZEngine()
    trace = []  # (Day, events, {pid: pre_candle_tz_buy2_ref_low}, {pid: letter of every pid alive AFTER this candle})
    for i in range(1, len(wtf_days)):
        prev, cur = wtf_days[i - 1], wtf_days[i]
        pre_ref_low = {}
        for pid, pc in engine.branches.items():
            if pc.buy is not None and pc.buy.tz_buy2 is not None:
                pre_ref_low[pid] = pc.buy.tz_buy2.ref_low
        evs = engine.process(prev, cur)
        alive_after = {pid: branch_label(pid) for pid in engine.branches}
        has_tzbuy2_after = {pid for pid, pc in engine.branches.items()
                             if pc.buy is not None and pc.buy.tz_buy2 is not None}
        trace.append((cur, evs, pre_ref_low, alive_after, has_tzbuy2_after))
    return trace


# --------------------------------------------------------------------------
# Step 2: every WTF TZ BUY 2 instance and its own window (formation -> that
# instance's own failure), with the exact WTF-side exit price resolved.
# Tracked by pid, not by letter, so a recycled letter's later, unrelated
# instance never gets stitched onto an earlier one's own lifetime.
# --------------------------------------------------------------------------

@dataclass
class _WtfInstance:
    letter: str
    formation_date: str
    end_date: str                    # this instance's own failure date, or the last WTF date if it never fails
    end_event: Optional[str]         # None if it never fails (or fails with no explicit SL-type event) within the data
    end_price: Optional[float]       # BAR SL2 -> that week's close; TZ BUY 2 SL / TZ BUY SL -> TZ BUY 2's own ref_low


def _wtf_tzbuy2_instances(wtf_trace) -> list[_WtfInstance]:
    instances = []
    last_date = wtf_trace[-1][0].date if wtf_trace else None
    for i, (day, evs, pre_ref_low, alive_after, has_tzbuy2_after) in enumerate(wtf_trace):
        for e in evs:
            if not e.startswith("TZ BUY 2("):
                continue
            letter = e[len("TZ BUY 2("):-1]
            # Which pid does this formation belong to? Whichever pid holds
            # this exact letter right after this candle -- unambiguous,
            # since only one pid can hold a given letter at a time.
            pid = next((p for p, l in alive_after.items() if l == letter), None)
            if pid is None:
                continue  # shouldn't happen, but don't fabricate an instance if it does
            end_date, end_event, end_price = last_date, None, None
            for day2, evs2, pre2, alive2, has2 in wtf_trace[i + 1:]:
                # Practical exit first (the session-established rule:
                # whichever of BAR SL2 / TZ BUY 2 SL / TZ BUY SL fires
                # first) -- none of these necessarily wipe buy.tz_buy2 to
                # None by themselves (TZ BUY 2 SL just freezes it,
                # recoverable later), so check this before the ceiling.
                hit = None
                for e2 in evs2:
                    if e2 == f"TZ BUY 2 SL({letter})" or e2 == f"TZ BUY SL({letter})":
                        hit = e2
                        end_price = pre2.get(pid)
                        break
                    if e2.startswith(f"BAR SL2({letter}."):
                        hit = e2
                        end_price = day2.c
                        break
                if hit is not None:
                    end_date, end_event = day2.date, hit
                    break
                # Ceiling: this specific pid's own tz_buy2 has genuinely
                # ended (wiped to None, or the whole branch died) with no
                # explicit SL-type event ever firing -- never search past
                # this, or a later, unrelated instance that recycles the
                # same letter gets wrongly stitched onto this one.
                if pid not in alive2 or pid not in has2:
                    end_date = day2.date
                    end_event = "collaterally terminated (no explicit SL event)"
                    break
            instances.append(_WtfInstance(letter, day.date, end_date, end_event, end_price))
    return instances


# --------------------------------------------------------------------------
# Step 3: live (week-lagged) WTF reference lookup for a given letter/window
# --------------------------------------------------------------------------

def _wtf_checkpoints(wtf_trace, letter: str, start_date: str, end_date: str):
    """(date, ref_high) for every TZ BUY 2( / TZ BUY 2 HH( this letter fires
    within [start_date, end_date] -- the raw material for the live anchor.
    Safe to match by letter alone here: [start_date, end_date] is already
    bounded to this exact branch instance's own lifetime (see
    _wtf_tzbuy2_instances), so no other pid can hold this same letter
    within that window."""
    checkpoints = []
    for day, evs, *_rest in wtf_trace:
        if day.date < start_date or day.date > end_date:
            continue
        for e in evs:
            if e == f"TZ BUY 2({letter})" or e == f"TZ BUY 2 HH({letter})":
                checkpoints.append((day.date, day.h))
    return checkpoints


def _containing_week_start(wtf_dates: list[str], d: str) -> Optional[str]:
    """Largest wtf_date <= d -- the WTF week that contains this DTF day."""
    start = None
    for wd in wtf_dates:
        if wd <= d:
            start = wd
        else:
            break
    return start


def _live_ref_asof(checkpoints, wtf_dates: list[str], d: str) -> Optional[float]:
    """The WTF reference high as it stood at the end of the most recently
    FULLY COMPLETED WTF week strictly before the week containing `d` --
    never the current, still-forming week's own value (look-ahead guard)."""
    week_start = _containing_week_start(wtf_dates, d)
    if week_start is None:
        return None
    ref = None
    for cdate, cref in checkpoints:
        if cdate < week_start:
            ref = cref
        else:
            break
    return ref


# --------------------------------------------------------------------------
# Step 4: the Stage 1 / Stage 2 DTF simulation within one WTF instance's window
# --------------------------------------------------------------------------

def _simulate_dtf(
    dtf_days: list[Day], wtf_trace, wtf_dates: list[str], inst: _WtfInstance
) -> tuple[Optional[PrimeTrendResult], Optional[PrimeTrendLiveStatus]]:
    checkpoints = _wtf_checkpoints(wtf_trace, inst.letter, inst.formation_date, inst.end_date)

    start_idx = None
    for i, d in enumerate(dtf_days):
        if d.date > inst.formation_date:
            start_idx = i
            break
    if start_idx is None:
        return None, None

    s1: Optional[_Stage] = None
    s2: Optional[_Stage] = None
    cur_entry = None       # (date, price) of the currently-open Stage 2
    hh, hh_date = 0.0, None
    final: Optional[PrimeTrendResult] = None

    # Stage 1's own "since it last (re)formed" tracking -- mirrors
    # cur_entry/hh/hh_date one tier up, purely for PrimeTrendLiveStatus
    # (compute_prime_trend's own historical trade log has no use for this,
    # per the Filter rule: a Stage-1-only window is never a reported trade).
    s1_since = None
    s1_activation_price = None
    hh1, hh1_date = 0.0, None

    def close_pair(exit_type: str, exit_date: str, exit_price: float):
        nonlocal final, cur_entry, hh, hh_date
        if cur_entry is not None:
            final = PrimeTrendResult(
                inst.letter, inst.formation_date, cur_entry[0], cur_entry[1],
                exit_type, exit_date, exit_price, hh if hh_date else None, hh_date,
            )
        cur_entry, hh, hh_date = None, 0.0, None

    i = start_idx
    while i < len(dtf_days) and dtf_days[i].date <= inst.end_date:
        prev, cur = dtf_days[i - 1], dtf_days[i]

        if cur_entry is not None and cur.h > hh:
            hh, hh_date = cur.h, cur.date
        if s1 is not None and s1.active and cur.h > hh1:
            hh1, hh1_date = cur.h, cur.date

        # --- Stage 1: DTF TZ BUY ---
        if s1 is None:
            live = _live_ref_asof(checkpoints, wtf_dates, cur.date)
            if live is not None and _breakout_shape(prev, cur, live):
                s1 = _Stage(cur.h, cur.l)
                s1_since, s1_activation_price = cur.date, cur.h
                hh1, hh1_date = 0.0, None
        else:
            if s1.active:
                if _sl_shape(cur, s1.ref_low):
                    s1.frozen_ref = s1.ref_high
                    s1.active = False
                    if s2 is not None:
                        close_pair("DTF TZ BUY SL (wipes ENTRY)", cur.date, s1.ref_low)
                        s2 = None
                else:
                    if cur.l < s1.ref_low:
                        s1.ref_low = cur.l
                    if cur.h > s1.ref_high and (cur.h - s1.ref_high) >= ANY:
                        s1.ref_high = cur.h
            else:
                if _breakout_shape(prev, cur, s1.frozen_ref):
                    s1 = _Stage(cur.h, cur.l)
                    s1_since, s1_activation_price = cur.date, cur.h
                    hh1, hh1_date = 0.0, None
                elif cur.h > s1.frozen_ref:
                    s1.frozen_ref = cur.h

        # --- Stage 2: DTF TZ BUY ENTRY (only while Stage 1 is active) ---
        if s1 is not None and s1.active:
            if s2 is None:
                ref2 = s1.entry_ratchet
                if _breakout_shape(prev, cur, ref2):
                    entry_price = ref2 + THRESH
                    s2 = _Stage(cur.h, cur.l)
                    cur_entry = (cur.date, entry_price)
                    hh, hh_date = 0.0, None
                elif cur.h > ref2:
                    s1.entry_ratchet = cur.h
            else:
                if s2.active:
                    if _sl_shape(cur, s2.ref_low):
                        s2.frozen_ref = s2.ref_high
                        s2.active = False
                        close_pair("DTF TZ BUY ENTRY SL", cur.date, s2.ref_low)
                    else:
                        if cur.l < s2.ref_low:
                            s2.ref_low = cur.l
                        if cur.h > s2.ref_high and (cur.h - s2.ref_high) >= ANY:
                            s2.ref_high = cur.h
                else:
                    if _breakout_shape(prev, cur, s2.frozen_ref):
                        entry_price = s2.frozen_ref + THRESH
                        s2 = _Stage(cur.h, cur.l)
                        cur_entry = (cur.date, entry_price)
                        hh, hh_date = 0.0, None
                    elif cur.h > s2.frozen_ref:
                        s2.frozen_ref = cur.h
        i += 1

    if cur_entry is not None:
        # Stage 2 was still open when the window ended -- the exit is
        # whatever ended this WTF instance (already resolved on inst).
        exit_type = inst.end_event if inst.end_event is not None else "still open"
        final = PrimeTrendResult(
            inst.letter, inst.formation_date, cur_entry[0], cur_entry[1],
            exit_type, inst.end_date, inst.end_price, hh if hh_date else None, hh_date,
        )

    stage1_active = s1 is not None and s1.active
    stage2_active = s2 is not None and s2.active
    live = PrimeTrendLiveStatus(
        letter=inst.letter,
        stage1_active=stage1_active,
        stage1_since=s1_since if stage1_active else None,
        stage1_activation_price=s1_activation_price if stage1_active else None,
        stage1_highest_high=(hh1 if hh1_date else None) if stage1_active else None,
        stage1_highest_high_date=hh1_date if stage1_active else None,
        stage2_active=stage2_active,
        stage2_since=cur_entry[0] if stage2_active and cur_entry else None,
        stage2_activation_price=cur_entry[1] if stage2_active and cur_entry else None,
        stage2_highest_high=(hh if hh_date else None) if stage2_active else None,
        stage2_highest_high_date=hh_date if stage2_active else None,
    )

    return final, live


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------

def _to_day(r):
    if isinstance(r, Day):
        return r
    if isinstance(r, dict):
        return Day(r["date"], float(r["o"]), float(r["h"]), float(r["l"]), float(r["c"]))
    d, o, h, l, c = r
    return Day(d, float(o), float(h), float(l), float(c))


def _prepare(wtf_rows, dtf_rows):
    wtf_days = [_to_day(r) for r in wtf_rows]
    dtf_days = [_to_day(r) for r in dtf_rows]
    wtf_dates = [d.date for d in wtf_days]
    wtf_trace = _run_wtf_trace(wtf_days)
    instances = _wtf_tzbuy2_instances(wtf_trace)
    return dtf_days, wtf_trace, wtf_dates, instances


def compute_prime_trend(wtf_rows, dtf_rows) -> list[PrimeTrendResult]:
    """wtf_rows / dtf_rows: lists of (date, o, h, l, c) tuples, dicts with
    date/o/h/l/c keys, or Day objects.

    Returns a list of PrimeTrendResult, one per WTF TZ BUY 2 instance that
    produced a confirmed Stage 2 (DTF TZ BUY ENTRY) before its own
    failure. Instances with no confirmed entry are silently excluded, per
    the PRIME TREND filter rule (see PRIME_TREND_RULEBOOK.md)."""
    dtf_days, wtf_trace, wtf_dates, instances = _prepare(wtf_rows, dtf_rows)

    results = []
    for inst in instances:
        res, _live = _simulate_dtf(dtf_days, wtf_trace, wtf_dates, inst)
        if res is not None:
            results.append(res)
    return results


def compute_prime_trend_live(wtf_rows, dtf_rows) -> list[PrimeTrendLiveStatus]:
    """Same inputs as compute_prime_trend, but answers a different
    question: "is this stock sitting in a PRIME TREND zone RIGHT NOW" (for
    a live screener), not "what trades has it produced historically".

    Returns one PrimeTrendLiveStatus per WTF TZ BUY 2 instance that is
    STILL OPEN as of the last available WTF candle (i.e. hasn't failed at
    its own SL / BAR SL2 within the supplied data) -- there is normally at
    most one such instance for a given stock, but every currently-open one
    is returned rather than assuming exactly one. Unlike
    compute_prime_trend, a Stage-1-only window (never escalated to Stage
    2) is NOT excluded here -- a live screener needs to show "this stock
    just cleared its WTF anchor" just as much as "this stock has a
    confirmed entry", since both are actionable right now. An instance
    with neither stage currently active (already failed on the DTF side
    but the WTF anchor itself hasn't failed yet) is omitted."""
    dtf_days, wtf_trace, wtf_dates, instances = _prepare(wtf_rows, dtf_rows)

    live_statuses = []
    for inst in instances:
        if inst.end_event is not None:
            continue  # this instance already failed on the WTF side -- not "right now"
        _res, live = _simulate_dtf(dtf_days, wtf_trace, wtf_dates, inst)
        if live is not None and (live.stage1_active or live.stage2_active):
            live_statuses.append(live)
    return live_statuses
