"""
Smoke test for tz_engine_new_theory.py (v5) using hand-constructed synthetic
OHLC -- NOT real market data (none has been supplied for this theory yet).
This only checks that each mechanic fires in the right order on data built
to exercise it; it is not a substitute for verification against real OHLC.

Run 1 (Parts 1-2, one continuous day sequence):
  Part 1 (d1-d2):   TZ GREEN(A) forms, then its own SL fires BEFORE RED2 ever
                     fired -- no REAR queued, immediate fresh sibling.
  Part 2 (d3-d27):  TZ GREEN(B) -> RED1 -> RED2 -> TZ BUY(B) -> TZ BUY 2(B) ->
                     RED1 -> RED2 -> BAR(B.1) -> BAR2(B.1) -> RED1 -> RED2 ->
                     BAR(B.2) -> BAR2(B.2) -> BAR SL -> BAR SL2 (queues REAR)
                     -> REAR(B) confirms on the very next qualifying candle
                     (nothing races it in time -- "REAR wins", ordinary case;
                     a fresh sibling TZ GREEN(C) also spawns the same day, as
                     a side effect of B terminating -- expected, not a race
                     loss, since it hasn't come anywhere near its own TZ BUY)
                     -> REAR 2(B) -> REAR SL(B) -- single-tier, no SL2 --
                     queues REAR RE-ENTER's reference directly (REAR 2's own)
                     -> REAR RE-ENTER(B) confirms immediately. Asserts REAR
                     SL2 / REAR RE-ENTER SL2 never fire (removed: "REAR SL is
                     enough as earlier. Nothing like REAR SL2.").

Run 2 (independent day sequence, its own Engine -- avoids interference with
Run 1's still-live sibling C):
  TZ GREEN(X) -> RED1 -> RED2 -> TZ BUY(X) -> TZ BUY's own SL fires BEFORE
  TZ BUY 2 ever formed -- no REAR queued, immediate fresh sibling (mirrors
  Part 1 one tier down).

Run 3 (independent day sequence): REAR 2's dual role -- once REAR 2 forms,
its own RED1->RED2 opens a fresh BAR(1) cascade, independent of (and without
triggering) REAR's own single-tier SL.
"""
from tz_engine_new_theory import Day, Engine


def run_and_check(rows, expected_present, label):
    days = [Day(date, o, h, l, c) for date, o, h, l, c in rows]
    engine = Engine()
    seen = set()
    print(f"-- {label} --")
    print(f"{'date':>4}  events")
    for date, events in engine.process(days):
        if events:
            print(f"{date:>4}  {', '.join(events)}")
        seen.update(events)
    missing = [e for e in expected_present if e not in seen]
    if missing:
        print(f"\nMISSING in {label} (smoke test FAILED):", missing)
        raise SystemExit(1)
    print()


run1_rows = [
    ("d0", 100, 100, 99.0, 99.5),

    # -- Part 1: TZ GREEN SL before RED2 -- no REAR ------------------------
    ("d1", 100, 101, 99.2, 101),     # TZ GREEN(A)
    ("d2", 99, 100, 98.9, 98.9),     # TZ GREEN SL(A) -- before RED2

    # -- Part 2: full escalation through REAR -> REAR RE-ENTER --------------
    ("d3", 99, 101, 99.0, 101),      # TZ GREEN(B)
    ("d4", 99, 100, 90.0, 99.1),     # deep dip+reclaim -- buffers B's ref_low
    ("d5", 90, 103, 99.5, 103),      # rally -- fresh local high/low
    ("d6", 100, 102, 99.2, 99.2),    # RED1(B) [vs TZ GREEN]
    ("d7", 99, 101, 98.9, 98.9),     # RED2(B)
    ("d8", 99, 104, 99.0, 104),      # TZ BUY(B)
    ("d9", 99, 105, 99.3, 105),      # TZ BUY 2(B)
    ("d10", 99, 104, 90.0, 99.2),    # deep dip+reclaim -- buffers TZ BUY's ref_low
    ("d11", 90, 106, 99.5, 106),     # rally -- fresh local high/low
    ("d12", 100, 105, 99.2, 99.2),   # RED1(B) [vs TZ BUY2]
    ("d13", 99, 104, 98.9, 98.9),    # RED2(B)
    ("d14", 99, 107, 99.0, 107),     # BAR(B.1)
    ("d15", 99, 100, 90.0, 90.5),    # deep dip pre-BAR2 (SL ungated, safe)
    ("d16", 90, 108, 99.5, 108),     # BAR 2(B.1)
    ("d17", 100, 107, 99.2, 99.2),   # RED1(B.1) [vs BAR2]
    ("d18", 99, 106, 98.9, 98.9),    # RED2(B.1)
    ("d19", 99, 109, 99.0, 109),     # BAR(B.2)
    ("d20", 99, 110, 99.2, 110),     # BAR 2(B.2)
    ("d21", 99, 100, 98.5, 98.5),    # BAR SL(B.2)
    ("d22", 98, 99, 98.2, 98.2),     # BAR SL2(B.2) -- queues REAR ref (110)
    ("d23", 98, 111, 98.5, 111),     # REAR(B) confirms (TZ GREEN(C) also spawns)
    ("d24", 98, 100, 95.0, 98.6),    # modest dip+reclaim -- buffers rear_ref_low(B) to 95
    ("d25", 95, 113, 98.7, 113),     # rally -- REAR 2(B) forms
    ("d26", 96, 96, 94.5, 94.5),     # REAR SL(B) -- single-tier, queues REAR
    # RE-ENTER ref directly (= REAR 2's own reference, 113)
    # (incidentally also breaches TZ GREEN(C)'s ref_low, since it shares B's
    # rear_ref_low value from the d24 update -- harmless, not asserted here)
    ("d27", 94, 114, 94.6, 114),     # REAR RE-ENTER(B) confirms
]
run1_expected = [
    "TZ GREEN(A)", "TZ GREEN SL(A)",
    "TZ GREEN(B)", "RED1(B)", "RED2(B)",
    "TZ BUY(B)", "TZ BUY 2(B)",
    "BAR(B.1)", "BAR 2(B.1)", "RED1(B.1)", "RED2(B.1)",
    "BAR(B.2)", "BAR 2(B.2)", "BAR SL(B.2)", "BAR SL2(B.2)",
    "REAR(B)", "REAR 2(B)", "REAR SL(B)", "REAR RE-ENTER(B)",
    "TZ GREEN(C)",
]
run1_unexpected = ["REAR SL2(B)", "REAR RE-ENTER SL2(B)"]  # no SL2 for
# either REAR or REAR RE-ENTER -- both are single-tier ("REAR SL is enough
# as earlier. Nothing like REAR SL2. likewise for REAR RE-ENTER.")

run2_rows = [
    ("e0", 100, 100, 99.0, 99.5),
    ("e1", 100, 101, 99.2, 101),      # TZ GREEN(A)
    ("e2", 100, 100, 90.0, 99.3),     # deep dip+reclaim -- buffers A's ref_low
    ("e3", 90, 103, 99.5, 103),       # rally -- fresh local high/low
    ("e4", 100, 102, 99.2, 99.2),     # RED1(A) [vs TZ GREEN]
    ("e5", 99, 101, 98.9, 98.9),      # RED2(A)
    ("e6", 99, 104, 99.0, 104),       # TZ BUY(A)
    ("e7", 99, 100, 98.5, 98.5),      # TZ BUY SL(A) -- before TZ BUY 2 ever formed
]
run2_expected = [
    "TZ GREEN(A)", "RED1(A)", "RED2(A)", "TZ BUY(A)", "TZ BUY SL(A)",
]

run3_rows = [
    ("f0", 100, 100, 99.0, 99.5),
    ("f1", 100, 101, 99.2, 101),      # TZ GREEN(A)
    ("f2", 100, 100, 50.0, 99.3),     # deep dip+reclaim -- buffers A's ref_low far
    # below anything the rest of this sequence touches (TZ GREEN's own SL
    # stays checked forever, so it must never collide with a later buffer)
    ("f3", 50, 103, 99.5, 103),       # rally
    ("f4", 100, 102, 99.2, 99.2),     # RED1(A) [vs TZ GREEN]
    ("f5", 99, 101, 98.9, 98.9),      # RED2(A)
    ("f6", 99, 104, 99.0, 104),       # TZ BUY(A)
    ("f7", 99, 105, 99.3, 105),       # TZ BUY 2(A)
    ("f8", 99, 104, 90.0, 99.2),      # deep dip+reclaim -- buffers TZ BUY's ref_low
    ("f9", 90, 106, 99.5, 106),       # rally
    ("f10", 100, 105, 99.2, 99.2),    # RED1(A) [vs TZ BUY2]
    ("f11", 99, 104, 98.9, 98.9),     # RED2(A)
    ("f12", 99, 107, 99.0, 107),      # BAR(A.1)
    ("f13", 100, 101, 90.0, 90.5),    # deep dip pre-BAR2 (SL ungated, safe)
    ("f14", 91, 108, 90.5, 108),      # BAR 2(A.1)
    ("f15", 90, 91, 89.7, 89.7),      # BAR SL(A.1)
    ("f16", 89, 90, 89.4, 89.4),      # BAR SL2(A.1) -- queues REAR ref (108)
    ("f17", 89, 109, 89.5, 109),      # REAR(A) confirms
    ("f18", 89, 110, 89.8, 110),      # REAR 2(A) forms
    ("f19", 89, 100, 80.0, 89.6),     # deep dip+reclaim -- buffers rear_ref_low(A) to 80
    ("f20", 80, 111, 89.9, 111),      # rally -- fresh local high/low for RED1 vs REAR2
    ("f21", 89, 110, 89.6, 89.6),     # RED1(A) [vs REAR2]
    ("f22", 89, 109, 89.3, 89.3),     # RED2(A) [vs REAR2]
    ("f23", 89, 112, 89.5, 112),      # BAR(A.2) -- REAR 2's dual role: fresh cascade opens
]
run3_expected = [
    "TZ GREEN(A)", "RED1(A)", "RED2(A)", "TZ BUY(A)", "TZ BUY 2(A)",
    "BAR(A.1)", "BAR 2(A.1)", "BAR SL(A.1)", "BAR SL2(A.1)",
    "REAR(A)", "REAR 2(A)",
    "BAR(A.2)",
]
run3_unexpected = ["REAR SL(A)"]  # must NOT fire -- SL beats RED1/RED2, and
# this test exercises the RED1/RED2 path specifically, not REAR's own SL


def run_and_check_absent(rows, expected_present, expected_absent, label):
    days = [Day(date, o, h, l, c) for date, o, h, l, c in rows]
    engine = Engine()
    seen = set()
    print(f"-- {label} --")
    print(f"{'date':>4}  events")
    for date, events in engine.process(days):
        if events:
            print(f"{date:>4}  {', '.join(events)}")
        seen.update(events)
    missing = [e for e in expected_present if e not in seen]
    unexpected = [e for e in expected_absent if e in seen]
    if missing or unexpected:
        if missing:
            print(f"\nMISSING in {label} (smoke test FAILED):", missing)
        if unexpected:
            print(f"\nUNEXPECTED in {label} (smoke test FAILED):", unexpected)
        raise SystemExit(1)
    print()


run_and_check_absent(run1_rows, run1_expected, run1_unexpected,
                      "Run 1: Parts 1-2 (early death / full REAR->REAR RE-ENTER)")
run_and_check(run2_rows, run2_expected, "Run 2: TZ BUY SL before TZ BUY 2 -- no REAR")
run_and_check_absent(run3_rows, run3_expected, run3_unexpected,
                      "Run 3: REAR 2's dual role -- RED1/RED2 opens a fresh BAR cascade")

print("All expected events fired in all runs.")
print("Smoke test passed. Reminder: synthetic data only -- still needs verification against real OHLC.")
