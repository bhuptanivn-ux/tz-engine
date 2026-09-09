"""
Smoke test for tz_engine_new_theory.py using hand-constructed synthetic OHLC
-- NOT real market data (none has been supplied for this theory yet). This
only checks that each mechanic in the flow fires in the right order on data
built to exercise it; it is not a substitute for verification against real
OHLC, which is still required before trusting this engine (see
NEW_THEORY_RULEBOOK.md).

Walks the full escalation once:
    TZ GREEN -> TZ GREEN 2 -> RED1 -> RED2 -> TZ BUY -> TZ BUY 2 -> RED1 ->
    RED2 -> BAR(A.1) -> BAR 2(A.1) -> RED1 -> RED2 -> BAR(A.2) -> BAR 2(A.2)
    -> BAR SL(A.2) -> BAR SL2(A.2) -> REAR(A) -> REAR 2(A) -> REAR SL(A) ->
    TZ GREEN (NEW CYCLE, independent sibling spawn -- assumption 1)
"""
from tz_engine_new_theory import Day, Engine

rows = [
    ("d0", 100, 100, 99.0, 99.5),
    ("d1", 100, 101, 99.2, 101),        # TZ GREEN(A)
    ("d2", 101, 102, 99.5, 102),        # TZ GREEN 2(A)
    ("d3", 100, 100, 90.0, 99.3),       # deep dip+reclaim -- buffers GREEN's ref_low
    ("d4", 99, 103, 99.6, 103),         # rally -- fresh local high/low for RED1
    ("d5", 100, 102, 99.3, 99.3),       # RED1(A) [vs GREEN2]
    ("d6", 99, 101, 99.0, 99.0),        # RED2(A)
    ("d7", 99, 104, 99.1, 104),         # TZ BUY(A)
    ("d8", 100, 105, 99.3, 105),        # TZ BUY 2(A)
    ("d9", 99, 104, 90.0, 99.2),        # deep dip+reclaim -- buffers BUY's ref_low
    ("d10", 100, 106, 99.5, 106),       # rally -- fresh local high/low for RED1
    ("d11", 100, 105, 99.2, 99.2),      # RED1(A) [vs BUY2]
    ("d12", 99, 104, 98.9, 98.9),       # RED2(A)
    ("d13", 99, 107, 99.0, 107),        # BAR(A.1)
    ("d14", 100, 101, 90.0, 90.5),      # deep dip pre-BAR2 (BAR SL ungated, safe)
    ("d15", 91, 108, 99.5, 108),        # BAR 2(A.1)
    ("d16", 100, 107, 99.2, 99.2),      # RED1(A.1) [vs BAR2]
    ("d17", 99, 106, 98.9, 98.9),       # RED2(A.1)
    ("d18", 99, 109, 99.0, 109),        # BAR(A.2)
    ("d19", 100, 110, 99.2, 110),       # BAR 2(A.2)
    ("d20", 99, 100, 98.5, 98.5),       # BAR SL(A.2)
    ("d21", 98, 99, 98.2, 98.2),        # BAR SL2(A.2) -- queues REAR ref
    ("d22", 99, 111, 98.5, 111),        # REAR(A) confirms
    ("d23", 99, 112, 98.8, 112),        # REAR 2(A)
    ("d24", 98, 99, 98.2, 98.2),        # REAR SL(A)
    ("d25", 98, 100, 98.3, 100),        # TZ GREEN(B) -- independent new cycle
]

days = [Day(date, o, h, l, c) for date, o, h, l, c in rows]
engine = Engine()

expected_present = [
    "TZ GREEN(A)", "TZ GREEN 2(A)", "RED1(A)", "RED2(A)",
    "TZ BUY(A)", "TZ BUY 2(A)",
    "BAR(A.1)", "BAR 2(A.1)", "RED1(A.1)", "RED2(A.1)",
    "BAR(A.2)", "BAR 2(A.2)",
    "BAR SL(A.2)", "BAR SL2(A.2)",
    "REAR(A)", "REAR 2(A)", "REAR SL(A)",
    "TZ GREEN(B)",
]

seen = set()
print(f"{'date':>4}  events")
for date, events in engine.process(days):
    if events:
        print(f"{date:>4}  {', '.join(events)}")
    seen.update(events)

missing = [e for e in expected_present if e not in seen]
if missing:
    print("\nMISSING (smoke test FAILED):", missing)
    raise SystemExit(1)
print("\nAll expected milestone events fired. Smoke test passed.")
print("Reminder: synthetic data only -- still needs verification against real OHLC.")
