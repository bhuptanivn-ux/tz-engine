"""
Regression test for prime_trend.py against real ADANIENT.NS WTF+DTF
data -- locks in the exact worked table in PRIME_TREND_RULEBOOK.md.

Unlike test_wtf_smoke.py (hand-built synthetic OHLC), this test uses
real market data because PRIME TREND's own live-anchor/week-lag/
dependency rules were discovered and confirmed against this exact
dataset -- a synthetic scenario risks silently missing the same subtlety
that produced the original bugs (the frozen-anchor bug, the Stage-1-
wipes-Stage-2 dependency) if hand-built without the same care. The CSVs
themselves are not checked in; this test is skipped if they're absent
(e.g. a fresh clone without the uploaded files) so it never blocks the
rest of the suite.
"""
import csv
import os

from prime_trend import compute_prime_trend

WTF_PATH = "/root/.claude/uploads/e41d7962-79bc-58e6-bfba-c16a750f637f/ff1c9b9e-ADANIENT.NS_2006-09-20_2026-09-21.csv"
DTF_PATH = "/root/.claude/uploads/e41d7962-79bc-58e6-bfba-c16a750f637f/8ba5f2a0-ADANIENT.NS_2006-09-20_2026-09-21_DTF.csv"


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


if not (os.path.exists(WTF_PATH) and os.path.exists(DTF_PATH)):
    print("test_prime_trend_smoke: ADANIENT.NS source CSVs not present -- skipping.")
else:
    wtf = load(WTF_PATH)
    dtf = load(DTF_PATH)
    results = compute_prime_trend(wtf, dtf)

    expected = [
        # letter, wtf_formation, entry_date, entry_price, exit_type_prefix, exit_date, exit_price, hh, hh_date
        ("A", "2007-07-09", "2007-08-03", 15.76, "BAR SL2(A.1)", "2008-09-29", 21.64, 62.0, "2008-01-03"),
        ("C", "2009-11-03", "2010-04-21", 49.31, "DTF TZ BUY ENTRY SL", "2011-10-04", 46.04, 73.25, "2010-11-04"),
        ("B", "2014-03-10", "2014-03-28", 31.56, "BAR SL2(B.4)", "2015-06-29", 50.79, 74.92, "2015-05-26"),
        ("C", "2017-01-30", "2017-03-16", 57.02, "BAR SL2(C.5)", "2023-01-30", 1539.09, 4064.02, "2022-12-21"),
    ]

    assert len(results) == len(expected), (
        f"Expected {len(expected)} confirmed PRIME TREND instances "
        f"(2024-02-26 and 2024-05-21 must both be filtered out -- no "
        f"confirmed DTF TZ BUY ENTRY before their own WTF failure), got "
        f"{len(results)}: {results}"
    )

    for got, exp in zip(results, expected):
        letter, wdate, edate, eprice, exit_type, xdate, xprice, hh, hhdate = exp
        assert got.letter == letter, f"letter mismatch: {got}"
        assert got.wtf_formation_date == wdate, f"WTF formation date mismatch: {got}"
        assert got.entry_date == edate, f"entry date mismatch: {got}"
        assert abs(got.entry_price - eprice) < 1e-6, f"entry price mismatch: {got}"
        assert got.exit_type == exit_type, f"exit type mismatch: {got}"
        assert got.exit_date == xdate, f"exit date mismatch: {got}"
        assert got.exit_price is not None and abs(got.exit_price - xprice) < 1e-6, f"exit price mismatch: {got}"
        assert got.highest_high is not None and abs(got.highest_high - hh) < 1e-6, f"highest high mismatch: {got}"
        assert got.highest_high_date == hhdate, f"highest high date mismatch: {got}"

    print("PRIME TREND smoke test passed: all 4 confirmed ADANIENT.NS instances match the rulebook's worked table exactly,")
    print("and both 2024 instances (2024-02-26, 2024-05-21) are correctly filtered out.")
