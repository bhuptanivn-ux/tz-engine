"""
Smoke test for tz_engine_new_theory.py (v2) using hand-constructed synthetic
OHLC -- NOT real market data (none has been supplied for this theory yet).
This only checks that each mechanic fires in the right order on data built
to exercise it; it is not a substitute for verification against real OHLC.

Three parts, back to back in one continuous day sequence:

  Part 1 (d1-d2):   TZ GREEN(A) forms, then its own SL fires BEFORE RED2 ever
                     fired -- no REAR queued at all, immediate fresh sibling.
  Part 2 (d3-d18):  TZ GREEN(B) -> RED1 -> RED2 -> BAR(B.1) -> BAR2(B.1) ->
                     RED1 -> RED2 -> BAR(B.2) -> BAR2(B.2) -> BAR SL -> BAR
                     SL2 (queues REAR's reference) -> REAR(B) confirms on the
                     very next qualifying candle, before anything could race
                     it -- "REAR wins" (the ordinary case).
  Part 3 (d19-d32): TZ GREEN(C) -> RED1 -> RED2 -> BAR(C.1) -> BAR2(C.1) ->
                     BAR SL -> BAR SL2 (queues REAR's reference, deliberately
                     never let it confirm) while TZ GREEN(D) spawns and races
                     through its OWN RED1 -> RED2 -> BAR(D.1) faster --
                     "new cycle wins", REAR(C) never forms.
"""
from tz_engine_new_theory import Day, Engine

rows = [
    ("d0", 100, 100, 99.0, 99.5),

    # -- Part 1: early death, no REAR --------------------------------------
    ("d1", 100, 101, 99.2, 101),     # TZ GREEN(A)
    ("d2", 99, 100, 98.9, 98.9),     # TZ GREEN SL(A) -- before RED2

    # -- Part 2: BAR SL2 -> REAR wins ---------------------------------------
    ("d3", 99, 101, 99.0, 101),      # TZ GREEN(B)
    ("d4", 99, 100, 90.0, 99.1),     # deep dip+reclaim -- buffers B's ref_low
    ("d5", 90, 103, 99.5, 103),      # rally -- fresh local high/low
    ("d6", 100, 102, 99.2, 99.2),    # RED1(B) [vs TZ GREEN]
    ("d7", 99, 101, 98.9, 98.9),     # RED2(B)
    ("d8", 99, 104, 99.0, 104),      # BAR(B.1)
    ("d9", 99, 100, 90.0, 90.5),     # deep dip pre-BAR2 (SL ungated, safe)
    ("d10", 90, 105, 99.5, 105),     # BAR 2(B.1)
    ("d11", 100, 104, 99.2, 99.2),   # RED1(B.1) [vs BAR2]
    ("d12", 99, 103, 98.9, 98.9),    # RED2(B.1)
    ("d13", 99, 106, 99.0, 106),     # BAR(B.2)
    ("d14", 99, 107, 99.2, 107),     # BAR 2(B.2)
    ("d15", 99, 100, 98.5, 98.5),    # BAR SL(B.2)
    ("d16", 98, 99, 98.2, 98.2),     # BAR SL2(B.2) -- queues REAR ref (107)
    ("d17", 98, 108, 98.5, 108),     # REAR(B) confirms (also spawns TZ GREEN(C))
    ("d18", 98, 109, 98.8, 109),     # REAR 2(B)

    # -- Part 3: BAR SL2 -> new cycle wins the race -------------------------
    ("d19", 98, 99, 90.0, 98.6),     # deep dip+reclaim -- buffers C's ref_low
    ("d20", 90, 102, 98.7, 102),     # rally -- fresh local high/low
    ("d21", 99, 101, 98.4, 98.4),    # RED1(C) [vs TZ GREEN]
    ("d22", 98, 100, 98.1, 98.1),    # RED2(C)
    ("d23", 98, 110, 98.2, 110),     # BAR(C.1) -- TZ GREEN(C)'s own ref had climbed to 109 (d18)
    ("d24", 98, 111, 98.3, 111),     # BAR 2(C.1)
    ("d25", 98, 100, 97.9, 97.9),    # BAR SL(C.1)
    ("d26", 97, 98, 97.6, 97.6),     # BAR SL2(C.1) -- queues REAR ref (111)
    ("d27", 97, 99, 97.7, 99),       # TZ GREEN(D) -- well below 111, no threat to REAR ref
    ("d28", 97, 98, 90.0, 97.8),     # deep dip+reclaim -- buffers D's ref_low
    ("d29", 90, 101, 97.9, 101),     # rally -- fresh local high/low
    ("d30", 98, 100, 97.6, 97.6),    # RED1(D) [vs TZ GREEN]
    ("d31", 97, 99, 97.3, 97.3),     # RED2(D)
    ("d32", 97, 102, 97.4, 102),     # BAR(D.1) -- wins the race; REAR(C) never confirms
]

days = [Day(date, o, h, l, c) for date, o, h, l, c in rows]
engine = Engine()

expected_present = [
    "TZ GREEN(A)", "TZ GREEN SL(A)",
    "TZ GREEN(B)", "RED1(B)", "RED2(B)",
    "BAR(B.1)", "BAR 2(B.1)", "RED1(B.1)", "RED2(B.1)",
    "BAR(B.2)", "BAR 2(B.2)", "BAR SL(B.2)", "BAR SL2(B.2)",
    "REAR(B)", "REAR 2(B)",
    "TZ GREEN(C)", "RED1(C)", "RED2(C)",
    "BAR(C.1)", "BAR 2(C.1)", "BAR SL(C.1)", "BAR SL2(C.1)",
    "TZ GREEN(D)", "RED1(D)", "RED2(D)", "BAR(D.1)",
]
expected_absent = ["REAR(C)", "REAR(D)"]

seen = set()
print(f"{'date':>4}  events")
for date, events in engine.process(days):
    if events:
        print(f"{date:>4}  {', '.join(events)}")
    seen.update(events)

missing = [e for e in expected_present if e not in seen]
unexpected = [e for e in expected_absent if e in seen]
if missing or unexpected:
    if missing:
        print("\nMISSING (smoke test FAILED):", missing)
    if unexpected:
        print("\nUNEXPECTED, should never have fired (smoke test FAILED):", unexpected)
    raise SystemExit(1)
print("\nAll expected events fired, and the race-loser (REAR) correctly never confirmed.")
print("Smoke test passed. Reminder: synthetic data only -- still needs verification against real OHLC.")
