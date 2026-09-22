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
    engine = TZEngine()
    trace = []  # (Day, events, {letter: pre_candle_tz_buy2_ref_low})
    for i in range(1, len(wtf_days)):
        prev, cur = wtf_days[i - 1], wtf_days[i]
        pre_ref_low = {}
        for pid, pc in engine.branches.items():
            if pc.buy is not None and pc.buy.tz_buy2 is not None:
                pre_ref_low[branch_label(pc.id)] = pc.buy.tz_buy2.ref_low
        evs = engine.process(prev, cur)
        trace.append((cur, evs, pre_ref_low))
    return trace


# --------------------------------------------------------------------------
# Step 2: every WTF TZ BUY 2 instance and its own window (formation -> that
# instance's own failure), with the exact WTF-side exit price resolved.
# --------------------------------------------------------------------------

@dataclass
class _WtfInstance:
    letter: str
    formation_date: str
    end_date: str                    # this instance's own failure date, or the last WTF date if it never fails
    end_event: Optional[str]         # None if it never fails within the data
    end_price: Optional[float]       # BAR SL2 -> that week's close; TZ BUY 2 SL / TZ BUY SL -> TZ BUY 2's own ref_low


def _wtf_tzbuy2_instances(wtf_trace) -> list[_WtfInstance]:
    instances = []
    last_date = wtf_trace[-1][0].date if wtf_trace else None
    for i, (day, evs, _pre) in enumerate(wtf_trace):
        for e in evs:
            if e.startswith("TZ BUY 2("):
                letter = e[len("TZ BUY 2("):-1]
                end_date, end_event, end_price = last_date, None, None
                for day2, evs2, pre2 in wtf_trace[i + 1:]:
                    hit = None
                    for e2 in evs2:
                        if e2 == f"TZ BUY 2 SL({letter})" or e2 == f"TZ BUY SL({letter})":
                            hit = e2
                            end_price = pre2.get(letter)  # TZ BUY 2's own ref_low just before this candle wiped/SL'd it
                            break
                        if e2.startswith(f"BAR SL2({letter}."):
                            hit = e2
                            end_price = day2.c  # that WTF week's own close
                            break
                    if hit is not None:
                        end_date, end_event = day2.date, hit
                        break
                instances.append(_WtfInstance(letter, day.date, end_date, end_event, end_price))
    return instances


# --------------------------------------------------------------------------
# Step 3: live (week-lagged) WTF reference lookup for a given letter/window
# --------------------------------------------------------------------------

def _wtf_checkpoints(wtf_trace, letter: str, start_date: str, end_date: str):
    """(date, ref_high) for every TZ BUY 2( / TZ BUY 2 HH( this letter fires
    within [start_date, end_date] -- the raw material for the live anchor."""
    checkpoints = []
    for day, evs, _pre in wtf_trace:
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

def _simulate_dtf(dtf_days: list[Day], wtf_trace, wtf_dates: list[str], inst: _WtfInstance) -> Optional[PrimeTrendResult]:
    checkpoints = _wtf_checkpoints(wtf_trace, inst.letter, inst.formation_date, inst.end_date)

    start_idx = None
    for i, d in enumerate(dtf_days):
        if d.date > inst.formation_date:
            start_idx = i
            break
    if start_idx is None:
        return None

    s1: Optional[_Stage] = None
    s2: Optional[_Stage] = None
    cur_entry = None       # (date, price) of the currently-open Stage 2
    hh, hh_date = 0.0, None
    final: Optional[PrimeTrendResult] = None

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

        # --- Stage 1: DTF TZ BUY ---
        if s1 is None:
            live = _live_ref_asof(checkpoints, wtf_dates, cur.date)
            if live is not None and _breakout_shape(prev, cur, live):
                s1 = _Stage(cur.h, cur.l)
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

    return final


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------

def compute_prime_trend(wtf_rows, dtf_rows) -> list[PrimeTrendResult]:
    """wtf_rows / dtf_rows: lists of (date, o, h, l, c) tuples, dicts with
    date/o/h/l/c keys, or Day objects.

    Returns a list of PrimeTrendResult, one per WTF TZ BUY 2 instance that
    produced a confirmed Stage 2 (DTF TZ BUY ENTRY) before its own
    failure. Instances with no confirmed entry are silently excluded, per
    the PRIME TREND filter rule (see PRIME_TREND_RULEBOOK.md)."""
    def to_day(r):
        if isinstance(r, Day):
            return r
        if isinstance(r, dict):
            return Day(r["date"], float(r["o"]), float(r["h"]), float(r["l"]), float(r["c"]))
        d, o, h, l, c = r
        return Day(d, float(o), float(h), float(l), float(c))

    wtf_days = [to_day(r) for r in wtf_rows]
    dtf_days = [to_day(r) for r in dtf_rows]
    wtf_dates = [d.date for d in wtf_days]

    wtf_trace = _run_wtf_trace(wtf_days)
    instances = _wtf_tzbuy2_instances(wtf_trace)

    results = []
    for inst in instances:
        res = _simulate_dtf(dtf_days, wtf_trace, wtf_dates, inst)
        if res is not None:
            results.append(res)
    return results
