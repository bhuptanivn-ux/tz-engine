"""
Regression test for prime_trend.py against real WTF+DTF data -- locks in
the exact worked tables in PRIME_TREND_RULEBOOK.md.

Unlike test_wtf_smoke.py (hand-built synthetic OHLC), this test uses
real market data because PRIME TREND's own live-anchor/week-lag/
dependency rules -- and the letter-recycling bug below -- were
discovered and confirmed against exactly this kind of real, multi-decade
multi-branch history. A synthetic scenario risks silently missing the
same subtlety if hand-built without the same care. The CSVs themselves
are not checked in; each dataset's check is skipped if its files are
absent (e.g. a fresh clone without the uploaded files) so it never
blocks the rest of the suite.
"""
import csv
import os

from prime_trend import compute_prime_trend


def load(path):
    rows = []
    with open(path) as f:
        r = csv.reader(f)
        header = next(r)
        idx = {h.strip().lower(): i for i, h in enumerate(header)}
        for row in r:
            o, h, l, c = row[idx["open"]], row[idx["high"]], row[idx["low"]], row[idx["close"]]
            if o == "" or h == "" or l == "" or c == "":
                continue
            rows.append((row[idx["date"]], float(o), float(h), float(l), float(c)))
    return rows


def check(name, wtf_path, dtf_path, expected, allow_missing_price_fields=False):
    if not (os.path.exists(wtf_path) and os.path.exists(dtf_path)):
        print(f"test_prime_trend_smoke [{name}]: source CSVs not present -- skipping.")
        return
    wtf = load(wtf_path)
    dtf = load(dtf_path)
    results = compute_prime_trend(wtf, dtf)

    assert len(results) == len(expected), (
        f"[{name}] Expected {len(expected)} confirmed PRIME TREND instances, "
        f"got {len(results)}: {results}"
    )
    for got, exp in zip(results, expected):
        letter, wdate, edate, eprice, exit_type, xdate, xprice, hh, hhdate = exp
        assert got.letter == letter, f"[{name}] letter mismatch: {got}"
        assert got.wtf_formation_date == wdate, f"[{name}] WTF formation date mismatch: {got}"
        assert got.entry_date == edate, f"[{name}] entry date mismatch: {got}"
        assert abs(got.entry_price - eprice) < 1e-6, f"[{name}] entry price mismatch: {got}"
        assert got.exit_type == exit_type, f"[{name}] exit type mismatch: {got}"
        assert got.exit_date == xdate, f"[{name}] exit date mismatch: {got}"
        assert got.exit_price is not None and abs(got.exit_price - xprice) < 1e-6, f"[{name}] exit price mismatch: {got}"
        assert got.highest_high is not None and abs(got.highest_high - hh) < 1e-6, f"[{name}] highest high mismatch: {got}"
        assert got.highest_high_date == hhdate, f"[{name}] highest high date mismatch: {got}"
    print(f"test_prime_trend_smoke [{name}]: all {len(expected)} confirmed instances match exactly.")


# ---------------------------------------------------------------------------
# ADANIENT.NS -- the original dataset PRIME TREND was worked out against.
# ---------------------------------------------------------------------------
check(
    "ADANIENT.NS",
    "/root/.claude/uploads/e41d7962-79bc-58e6-bfba-c16a750f637f/ff1c9b9e-ADANIENT.NS_2006-09-20_2026-09-21.csv",
    "/root/.claude/uploads/e41d7962-79bc-58e6-bfba-c16a750f637f/8ba5f2a0-ADANIENT.NS_2006-09-20_2026-09-21_DTF.csv",
    [
        # letter, wtf_formation, entry_date, entry_price, exit_type, exit_date, exit_price, hh, hh_date
        ("A", "2007-07-09", "2007-08-03", 15.76, "BAR SL2(A.1)", "2008-09-29", 21.64, 62.0, "2008-01-03"),
        ("C", "2009-11-03", "2010-04-21", 49.31, "DTF TZ BUY ENTRY SL", "2011-10-04", 46.04, 73.25, "2010-11-04"),
        ("B", "2014-03-10", "2014-03-28", 31.56, "BAR SL2(B.4)", "2015-06-29", 50.79, 74.92, "2015-05-26"),
        ("C", "2017-01-30", "2017-03-16", 57.02, "BAR SL2(C.5)", "2023-01-30", 1539.09, 4064.02, "2022-12-21"),
    ],
)

# ---------------------------------------------------------------------------
# ICICIBANK.NS -- second scrip used to confirm the module generalizes.
# This is also the dataset that caught a real bug: branch letters get
# RECYCLED once a branch dies (even via collateral termination, which
# emits no explicit SL-type event at all), so matching a WTF TZ BUY 2
# instance's own end purely by letter text let a much LATER, wholly
# unrelated branch that reused the same letter get wrongly stitched onto
# an earlier one -- branch "E" formed TZ BUY 2 in 2014, was collaterally
# terminated with no SL event, and letter E was reused by a completely
# fresh, unrelated TZ GREEN(E) in 2022; before the fix, this showed up as
# a nonsensical 11-year gap between the 2014 WTF formation and its
# "entry" (which was actually the 2022+ branch's own price action).
# Fixed by tracking each WTF TZ BUY 2 instance by the engine's own
# internal branch id (pid), not by its display letter -- letters are
# only resolved from a pid at the point of use, and the search for an
# instance's own end never looks past the point that SPECIFIC pid's own
# tz_buy2 state disappears (wiped to None, or the whole branch dies),
# regardless of whether an explicit SL-type event coincides with it.
# ---------------------------------------------------------------------------
check(
    "ICICIBANK.NS",
    "/root/.claude/uploads/e41d7962-79bc-58e6-bfba-c16a750f637f/b3698f39-ICICIBANK.NS_2001-12-31_2026-09-22.csv",
    "/root/.claude/uploads/e41d7962-79bc-58e6-bfba-c16a750f637f/5349ea4c-ICICIBANK.NS_2001-12-31_2026-09-22_DTF.csv",
    [
        ("C", "2003-08-18", "2003-10-03", 38.010000000000005, "BAR SL2(C.5)", "2008-06-02", 139.89, 264.64, "2008-01-14"),
        ("D", "2010-08-09", "2010-09-09", 190.95, "DTF TZ BUY ENTRY SL", "2011-01-10", 187.65, 232.55, "2010-11-05"),
        ("D", "2012-09-17", "2013-01-02", 211.45999999999998, "DTF TZ BUY ENTRY SL", "2013-02-06", 210.47, 224.0, "2013-01-31"),
        ("E", "2014-03-24", "2014-05-12", 253.08999999999997, "DTF TZ BUY ENTRY SL", "2014-07-11", 247.3, 289.67, "2014-05-16"),
        ("A", "2014-11-03", "2015-01-27", 341.56, "DTF TZ BUY ENTRY SL", "2015-01-30", 338.82, 357.64, "2015-01-28"),
        ("B", "2017-05-22", "2017-07-17", 299.7, "DTF TZ BUY ENTRY SL", "2017-07-28", 296.2, 314.45, "2017-07-27"),
        ("B", "2017-10-30", "2018-01-17", 340.95, "DTF TZ BUY ENTRY SL", "2018-02-05", 333.7, 365.7, "2018-01-29"),
        ("C", "2018-11-12", "2021-10-25", 766.0500000000001, "DTF TZ BUY ENTRY SL", "2021-11-11", 773.1, 849.0, "2021-10-27"),
        ("D", "2022-07-25", "2024-03-01", 1070.2, "BAR SL2(D.6)", "2025-01-06", 1249.85, 1362.35, "2024-09-20"),
        ("E", "2025-04-15", "2025-07-22", 1471.8, "DTF TZ BUY ENTRY SL", "2025-08-04", 1464.0, 1500.0, "2025-07-25"),
    ],
)
