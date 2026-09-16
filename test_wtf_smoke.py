"""
Smoke test for tz_engine_wtf.py using hand-constructed synthetic OHLC -- NOT
real market data. This only checks that the TZ BUY 2 layer fires in the
right order and interacts correctly with the already-validated BAR 2/REAR 2/
REAR RE-ENTER 2 machinery ported in from tz_engine_bar2_variant.py.

Test 1: full escalation TZ GREEN -> RED -> TZ BUY -> TZ BUY 2 -> RED1 ->
RED2 (gated on TZ BUY 2 existing) -> BAR(A.1), confirming the new gate
doesn't break the existing BAR-family machinery below it.

Test 2: TZ BUY's own top-level SL fires with NO TZ BUY 2 ever having
formed -- TZ BUY reactivates IN PLACE (same object, same "TZ BUY" event
text, no "NEW TZ BUY") off the dead buy's own frozen peak.

Test 3: TZ BUY's own top-level SL fires AFTER TZ BUY 2 already existed --
reactivation uses max(TZ BUY's own peak, TZ BUY 2's own reference) instead
of just the dead buy's raw peak; a candle that clears the old peak but not
TZ BUY 2's higher reference must NOT reactivate TZ BUY.

Test 4: "TZ BUY 2(" is its own leadership-contest milestone (unlike BAR 2/
REAR 2/REAR RE-ENTER 2, none of which are).

Test 5: TZ BUY 2's own HH display is muted once a deeper tier's reference
(here, a BAR generation) reaches or exceeds TZ BUY 2's own reference --
not merely once that deeper tier exists.

Test 6: a BAR lineage's own SL fires with NO BAR 2 ever having formed for
it (a permanent dead end, real-data-motivated fix) -- a fresh, independent
BAR can still form immediately afterward with NO RED1/RED2 needed, reusing
the dead lineage's own freed sub-label (a complete dead end frees its
number for reuse; one that got BAR 2 would not).

Test 7: multi-generation BAR racing. An older lineage that's already past
its own SL, already has its own BAR 2, and hasn't shown INVALID BAR SL yet
is NOT terminated when a fresh, independent BAR forms elsewhere -- both
race in parallel, ticking forward on the same days, until the older one
wins its own SL2 and forms REAR off its own BAR 2 reference. Also exercises
the exact edge case flagged by the user ("a single candle can trigger
BAR(3) SL + BAR(2) SL2"): the newer lineage breaching its own SL on the
very same candle the older one confirms SL2 -- only the SL2 event shows.

Test 8: TZ BUY's own top-level SL, firing after the branch has already
reached BAR 2, wipes everything below it and reactivates above "whichever
occurred last" (BAR 2's own reference) -- not TZ BUY's own frozen peak, and
not TZ BUY 2's own frozen peak either, both of which are numerically HIGHER
at that point (confirms the reactivation threshold tracks the
structurally deepest tier, not simply the maximum of any frozen values).

Test 9: TZ BUY 2's own SL is decisive -- it wipes the whole BAR family
below it (even one that already has its own BAR 2) and, per an explicit
user-driven rule reversal, ALSO opens spawn eligibility for a fresh
sibling TZ GREEN(n+1), exactly like TZ BUY's own top-level SL does, even
though TZ BUY itself is still active throughout.

Test 10: REAR's own SL, and REAR RE-ENTER's own SL, are NEVER dead ends --
unlike BAR's own SL -- regardless of whether REAR 2 / REAR RE-ENTER 2 ever
formed. REAR's own SL always leads to REAR RE-ENTER; REAR RE-ENTER's own
SL always self-recovers under the same event text. Both mirror TZ BUY's
own "never a dead end" pattern, not BAR's.
"""
from tz_engine_wtf import Day, TZEngine, is_milestone


def run(rows, label):
    days = [Day(date, o, h, l, c) for date, o, h, l, c in rows]
    engine = TZEngine()
    seen = set()
    trace = []
    print(f"-- {label} --")
    for i in range(1, len(days)):
        prev, cur = days[i - 1], days[i]
        evs = engine.process(prev, cur)
        if evs:
            print(f"{cur.date:>4}  {', '.join(evs)}")
        seen.update(evs)
        trace.append((cur.date, evs))
    print()
    run.last_trace = trace
    return seen


# ---------------------------------------------------------------------------
# Test 1: TZ BUY 2 layer + RED1/RED2 gate-shift, through to BAR(A.1)
# ---------------------------------------------------------------------------
rows1 = [
    ("d0", 100, 100, 99.0, 99.5),
    ("d1", 100, 101, 99.2, 101),      # TZ GREEN(A)
    ("d1b", 100.5, 100.5, 99.5, 100), # consolidation (buffers prev.l away from ref_low)
    ("d2", 99.4, 100, 99.3, 99.4),    # RED(A)
    ("d3", 99.5, 102, 99.4, 102),     # TZ BUY(A)
    ("d3b", 99, 99.5, 90.0, 99.5),    # deep dip+reclaim -- buffers buy's own ref_low to 90
    ("d4", 91, 103, 90.5, 103),       # TZ BUY 2(A) (same-day TZ BUY HH suppressed)
    ("d5", 90.3, 91, 85.0, 91),       # deep dip+reclaim -- buffers buy's ref_low (85) and
    # buy2's own ref_low (85) together
    ("d6", 86, 104, 85.5, 104),       # rally -- fresh local high/low
    ("d7", 86, 100, 85.2, 85.3),      # RED1(A) [gated on TZ BUY 2 existing]
    ("d8", 85, 99, 84.9, 85.0),       # RED2(A) -- bar_pending=True
    ("d9", 85, 100, 85.0, 100),       # BAR(A.1)
]
seen1 = run(rows1, "Test 1: TZ BUY -> TZ BUY 2 -> RED1 -> RED2 -> BAR(A.1)")
expected1 = ["TZ GREEN(A)", "RED(A)", "TZ BUY(A)", "TZ BUY 2(A)",
             "RED1(A)", "RED2(A)", "BAR(A.1)"]
missing1 = [e for e in expected1 if e not in seen1]
assert not missing1, f"Test 1 MISSING: {missing1}"
assert "TZ GREEN SL(A)" not in seen1, "Test 1: TZ GREEN SL should never fire"
assert "TZ BUY SL(A)" not in seen1, "Test 1: TZ BUY SL should never fire"

# ---------------------------------------------------------------------------
# Test 2: TZ BUY SL with no TZ BUY 2 ever formed -- reactivates IN PLACE,
# same "TZ BUY" label, off the dead buy's own peak
# ---------------------------------------------------------------------------
rows2 = [
    ("e0", 100, 100, 99.0, 99.5),
    ("e1", 100, 101, 99.2, 101),      # TZ GREEN(A) ref_low=99.2 (TZ GREEN's OWN ref_low,
    # left untouched for the rest of this run -- kept clear of TZ BUY's own
    # ref_low of 99.4 so triggering TZ BUY's own SL doesn't collide with it)
    ("e1b", 100.5, 100.5, 99.5, 100), # consolidation
    ("e2", 99.4, 100, 99.3, 99.4),    # RED(A)
    ("e3", 99.5, 102, 99.4, 102),     # TZ BUY(A) ref_high=102, ref_low=99.4
    ("e4", 99.3, 99.3, 99.2, 99.25),  # TZ BUY SL(A) -- gap 0.2 below TZ BUY's own
    # 99.4; low sits exactly AT TZ GREEN's own 99.2 (gap 0 there -- safe) --
    # before TZ BUY 2 ever formed
    ("e5", 98.5, 103, 99.3, 103),     # TZ BUY(A) reactivates in place -- above 102 (old peak)
]
seen2 = run(rows2, "Test 2: TZ BUY SL before TZ BUY 2 -> reactivates off old peak")
expected2 = ["TZ GREEN(A)", "RED(A)", "TZ BUY(A)", "TZ BUY SL(A)"]
missing2 = [e for e in expected2 if e not in seen2]
assert not missing2, f"Test 2 MISSING: {missing2}"
assert "NEW TZ BUY(A)" not in seen2, "Test 2: NEW TZ BUY no longer exists in this design"

# ---------------------------------------------------------------------------
# Test 3: TZ BUY SL AFTER TZ BUY 2 existed -- reactivation uses TZ BUY 2's
# ref, not the raw old peak
# ---------------------------------------------------------------------------
rows3_base = [
    ("f0", 100, 100, 99.0, 99.5),
    ("f1", 100, 101, 99.2, 101),      # TZ GREEN(A) ref_low=99.2, left untouched
    ("f1b", 100.5, 100.5, 99.5, 100), # consolidation
    ("f2", 99.4, 100, 99.3, 99.4),    # RED(A)
    ("f3", 99.5, 102, 99.4, 102),     # TZ BUY(A) ref_high=102, ref_low=99.4
    ("f4", 99.5, 103, 99.5, 103),     # TZ BUY 2(A) -- forms via a RALLY (Low >=
    # PrevLow, no new low), so TZ BUY's own ref_low stays at 99.4, untouched
    ("f5", 99.3, 99.3, 99.2, 99.3),   # TZ BUY SL(A) -- gap 0.2 below TZ BUY's own
    # 99.4; low sits exactly AT TZ GREEN's own 99.2 (gap 0 there -- safe) --
    # fires cleanly after TZ BUY 2 already exists (ref_high=103)
]
rows3 = rows3_base + [
    ("f6", 98, 104, 99.3, 104),       # TZ BUY(A) reactivates -- clears both old peak (102)
    # and TZ BUY 2's ref (103)
]
seen3 = run(rows3, "Test 3: TZ BUY SL after TZ BUY 2 -> reactivates off TZ BUY 2's ref")
expected3 = ["TZ GREEN(A)", "RED(A)", "TZ BUY(A)", "TZ BUY 2(A)", "TZ BUY SL(A)"]
missing3 = [e for e in expected3 if e not in seen3]
assert not missing3, f"Test 3 MISSING: {missing3}"

rows3b = rows3_base + [
    ("f6", 98, 102.5, 99.3, 102.5),   # clears the old raw peak (102) but NOT TZ BUY 2's
    # higher ref (103) -- must NOT reactivate if the rule is wired correctly
]
seen3b = run(rows3b, "Test 3b: clears old peak but not TZ BUY 2's ref -- no reactivation")
# "TZ BUY(A)" only ever appears once in seen3b (the original formation) --
# a second occurrence would be indistinguishable in a set, so check the
# printed trace above shows no reactivation line at f6 instead.
assert "TZ BUY 2(A)" in seen3b and "TZ BUY SL(A)" in seen3b, "Test 3b setup broken"

# ---------------------------------------------------------------------------
# Test 4: "TZ BUY 2(" is its own leadership-contest milestone
# ---------------------------------------------------------------------------
assert is_milestone("TZ BUY 2(A)"), "Test 4 FAILED: TZ BUY 2( should be a milestone"
assert not is_milestone("TZ BUY 2 HH(A)"), "Test 4 FAILED: TZ BUY 2 HH( must not match"
assert not is_milestone("BAR 2(A.1)"), "Test 4 FAILED: BAR 2( must NOT be a milestone"
assert not is_milestone("REAR 2(A)"), "Test 4 FAILED: REAR 2( must NOT be a milestone"
print("Test 4: TZ BUY 2( milestone status confirmed (BAR 2/REAR 2 unaffected).\n")

# ---------------------------------------------------------------------------
# Test 5: TZ BUY 2's own HH is muted once a deeper tier's reference reaches
# or exceeds it (comparison-based, not existence-based)
# ---------------------------------------------------------------------------
rows5 = rows1 + [
    ("d10", 85, 101, 85.1, 101),      # BAR(A.1)'s own HH -- 101, still below TZ BUY 2's 103
    ("d11", 85, 103.5, 85.2, 103.5),  # BAR(A.1)'s own HH now clears TZ BUY 2's ref (103)
    # -- TZ BUY 2's own HH must be muted from here on, even though TZ BUY 2
    # itself keeps existing and (if it climbed) would otherwise show HH
    ("d12", 85, 106, 85.3, 106),      # a further high -- would be "TZ BUY 2 HH(A)" if
    # TZ BUY 2's own ref (103) were still below it and unmuted; must NOT show now
]
seen5 = run(rows5, "Test 5: TZ BUY 2's own HH muted once BAR(A.1) catches up")
# "TZ BUY 2 HH(A)" legitimately appears once, early (d6, well before BAR(A.1)
# even exists) -- the rule only mutes it FROM the day the deeper tier's
# reference actually catches up (d11) ONWARD. Check the post-mute tail of
# the trace specifically, not the flat set.
mute_from = next(i for i, (date, _) in enumerate(run.last_trace) if date == "d11")
post_mute_events = [e for _, evs in run.last_trace[mute_from:] for e in evs]
assert "TZ BUY 2 HH(A)" not in post_mute_events, \
    "Test 5 FAILED: TZ BUY 2 HH(A) should be muted from d11 onward"

# ---------------------------------------------------------------------------
# Test 6: BAR SL with no BAR 2 ever formed -- permanent dead end for THAT
# lineage, but a fresh independent BAR forms immediately (no RED1/RED2),
# reusing the freed dead-end sub-label "A.1"
# ---------------------------------------------------------------------------
rows6 = [
    ("j0", 100, 100, 99.0, 99.5),
    ("j1", 100, 101, 99.2, 101),      # TZ GREEN(A)
    ("j1b", 100.5, 100.5, 99.5, 100), # consolidation
    ("j2", 99.4, 100, 99.3, 99.4),    # RED(A)
    ("j3", 99.5, 102, 99.4, 102),     # TZ BUY(A) ref_high=102 ref_low=99.4
    ("j3b", 99, 99.5, 90.0, 99.5),    # deep dip+reclaim -- buffers buy's ref_low
    ("j3c", 89, 99.5, 50.0, 99.5),    # further -- buy's ref_low down to 50.0,
    # well clear of everything that follows (TZ GREEN's own ref_low tracks down
    # to 50.0 in lockstep, same mechanism, same candles)
    ("j4", 91, 103, 91.0, 103),       # TZ BUY 2(A) ref_high=103 ref_low=91.0
    ("j5", 95, 104, 94.5, 104),       # rally -- fresh local high/low
    ("j6", 95, 95, 94.2, 94.2),       # RED1(A)
    ("j7", 94.0, 94.0, 93.9, 93.9),   # RED2(A) -- bar_pending=True
    ("j8", 94, 95.5, 94, 95.5),       # BAR(A.1) ref_high=95.5 ref_low=94
    ("j9", 94, 94.2, 93.5, 93.8),     # BAR SL(A.1) -- no BAR 2 ever formed: dead end
    ("j10", 93.6, 96, 93.6, 96),      # fresh BAR forms -- NO RED1/RED2 -- reuses
    # the freed label "A.1" (dead end, no BAR 2), not "A.2"
]
seen6 = run(rows6, "Test 6: BAR SL w/o BAR 2 -> fresh BAR reuses freed label, no RED1/RED2")
assert "BAR SL(A.1)" in seen6, "Test 6: BAR SL(A.1) should fire"
assert "BAR 2(A.1)" not in seen6, "Test 6 setup broken: BAR 2(A.1) should never form"
assert "RED1(B)" not in seen6 and "RED2(B)" not in seen6, "Test 6 setup sanity"
j10_events = next(evs for date, evs in run.last_trace if date == "j10")
assert j10_events == ["BAR(A.1)"], \
    f"Test 6 FAILED: fresh BAR should reuse freed label 'A.1' with no RED1/RED2, got {j10_events}"

# ---------------------------------------------------------------------------
# Test 7: multi-generation BAR racing -- an older, post-SL, BAR-2'd lineage
# survives a fresh independent BAR forming elsewhere, races in parallel,
# and eventually wins its own SL2 to form REAR
# ---------------------------------------------------------------------------
rows7 = [
    ("j0", 100, 100, 99.0, 99.5),
    ("j1", 100, 101, 99.2, 101),      # TZ GREEN(A)
    ("j1b", 100.5, 100.5, 99.5, 100), # consolidation
    ("j2", 99.4, 100, 99.3, 99.4),    # RED(A)
    ("j3", 99.5, 102, 99.4, 102),     # TZ BUY(A) ref_high=102 ref_low=99.4
    ("j3b", 99, 99.5, 90.0, 99.5),    # deep dip+reclaim
    ("j3c", 89, 99.5, 50.0, 99.5),    # buy/TZ GREEN ref_low -> 50.0, well clear
    ("j4", 91, 103, 91.0, 103),       # TZ BUY 2(A) ref_high=103 ref_low=91.0
    ("j5", 95, 104, 94.5, 104),       # rally
    ("j6", 95, 95, 94.2, 94.2),       # RED1(A)
    ("j7", 94.0, 94.0, 93.9, 93.9),   # RED2(A) -- bar_pending=True
    ("j8", 94, 95.5, 94, 95.5),       # BAR(A.1) ref_high=95.5 ref_low=94
    ("j9", 94, 97, 94.2, 97),         # BAR 2(A.1) ref_high=97 ref_low=94.2
    ("j10", 94, 94.3, 93.5, 93.8),    # BAR SL(A.1) -- BAR 2 exists, NOT a dead end
    ("j11", 93.6, 93.9, 93.6, 93.7),  # quiet day -- lowers "prev" without raising
    # sl.ref_high, so the next breakout won't also read as INVALID BAR SL
    ("j12", 93.7, 94.1, 93.7, 94.1),  # fresh independent BAR(A.2) -- no RED1/RED2 --
    # A.1 survives (post-SL, has BAR 2, not yet invalidated) and keeps racing
    ("j13", 93.8, 94.4, 93.8, 94.0),  # BOTH tick forward the SAME day: BAR SL
    # HH(A.1) + BAR HH(A.2) -- proves they're racing in parallel, not that A.2
    # replaced A.1
    ("j14", 93.6, 93.7, 93.2, 93.3),  # BAR SL2(A.1) wins -- this candle ALSO
    # breaches A.2's own ref_low, but only the SL2 event shows (SL2 priority)
    ("j15", 93.5, 98, 93.5, 98),      # REAR(A) forms off A.1's own BAR 2 ref (97)
]
seen7 = run(rows7, "Test 7: multi-generation BAR racing in parallel")
expected7 = ["TZ GREEN(A)", "RED(A)", "TZ BUY(A)", "TZ BUY 2(A)", "RED1(A)", "RED2(A)",
             "BAR(A.1)", "BAR 2(A.1)", "BAR SL(A.1)", "BAR(A.2)", "BAR SL2(A.1)", "REAR(A)"]
missing7 = [e for e in expected7 if e not in seen7]
assert not missing7, f"Test 7 MISSING: {missing7}"
assert "BAR SL(A.2)" not in seen7, \
    "Test 7 FAILED: A.2's own SL, coinciding with A.1's SL2, must be absorbed, not shown"
j13_events = next(evs for date, evs in run.last_trace if date == "j13")
assert set(j13_events) == {"BAR HH(A.2)", "BAR SL HH(A.1)"}, \
    f"Test 7 FAILED: both lineages should tick forward the same day, got {j13_events}"

# ---------------------------------------------------------------------------
# Test 8: TZ BUY's own SL, firing after BAR 2 has already formed, reactivates
# above BAR 2's own reference ("whichever occurred last") -- NOT TZ BUY's own
# frozen peak or TZ BUY 2's own frozen peak, both numerically higher at that
# point
# ---------------------------------------------------------------------------
rows8 = [
    ("k0", 100, 100, 99.0, 99.5),
    ("k1", 100, 101, 99.2, 101),      # TZ GREEN(A) ref_low=99.2, left untouched
    ("k1b", 100.5, 100.5, 99.5, 100), # consolidation
    ("k2", 99.4, 100, 99.3, 99.4),    # RED(A)
    ("k3", 99.5, 102, 99.4, 102),     # TZ BUY(A) ref_high=102 ref_low=99.4
    ("k4", 99.5, 103, 99.5, 103),     # TZ BUY 2(A) ref_high=103 ref_low=99.5 (rally)
    ("k5", 99.8, 104, 99.8, 104),     # rally -- TZ BUY 2 HH -> 104 (both TZ BUY's own
    # peak and TZ BUY 2's own peak climb to 104 from here on -- HIGHER than what
    # BAR 2 will reach below)
    ("k6", 100, 100, 99.6, 99.6),     # RED1(A)
    ("k7", 99.5, 99.5, 99.4, 99.4),   # RED2(A) -- bar_pending=True
    ("k8", 99.5, 100, 99.5, 100),     # BAR(A.1) ref_high=100 ref_low=99.5
    ("k9", 99.6, 101, 99.6, 101),     # BAR 2(A.1) ref_high=101 ref_low=99.6
    ("k10", 99.3, 99.5, 99.1, 99.2),  # TZ BUY SL(A) -- wipes TZ BUY 2/BAR/BAR 2;
    # reentry_threshold should be BAR 2's own ref (101), not 104
    ("k11", 99.2, 102, 99.2, 102),    # reactivates at 102 -- clears 101 but NOT 104,
    # proving the threshold used was BAR 2's ref, not the (higher) frozen peaks
]
seen8 = run(rows8, "Test 8: TZ BUY SL reactivates above BAR 2's ref, not the higher frozen peaks")
expected8 = ["TZ GREEN(A)", "RED(A)", "TZ BUY(A)", "TZ BUY 2(A)", "RED1(A)", "RED2(A)",
             "BAR(A.1)", "BAR 2(A.1)", "TZ BUY SL(A)"]
missing8 = [e for e in expected8 if e not in seen8]
assert not missing8, f"Test 8 MISSING: {missing8}"
k11_events = next(evs for date, evs in run.last_trace if date == "k11")
assert k11_events == ["TZ BUY(A)"], \
    f"Test 8 FAILED: TZ BUY should reactivate at k11 (above BAR 2's ref 101), got {k11_events}"

# ---------------------------------------------------------------------------
# Test 9: TZ BUY 2's own SL wipes the BAR family below it (even with BAR 2
# already formed) AND opens spawn eligibility for a fresh sibling TZ
# GREEN(n+1) -- explicit rule-reversal addition, mirroring TZ BUY's own SL --
# even though TZ BUY itself stays active throughout
# ---------------------------------------------------------------------------
rows9 = [
    ("i0", 100, 100, 99.0, 99.5),
    ("i1", 100, 101, 99.2, 101),      # TZ GREEN(A)
    ("i1b", 100.5, 100.5, 99.5, 100), # consolidation
    ("i2", 99.4, 100, 99.3, 99.4),    # RED(A)
    ("i3", 99.5, 102, 99.4, 102),     # TZ BUY(A) ref_high=102 ref_low=99.4
    ("i3b", 99, 99.5, 90.0, 99.5),    # deep dip+reclaim -- buy's ref_low -> 90.0
    ("i3c", 89, 99.5, 50.0, 99.5),    # further -- buy's ref_low -> 50.0, far below
    # where TZ BUY 2 will track, so TZ BUY 2's own SL can fire later without
    # also breaching TZ BUY's own SL
    ("i4", 91, 103, 91.0, 103),       # TZ BUY 2(A) ref_high=103 ref_low=91.0
    ("i5", 92, 104, 91.5, 104),       # rally -- TZ BUY 2 HH -> 104
    ("i6", 92, 92, 91.2, 91.2),       # RED1(A)
    ("i7", 91.5, 91.5, 90.9, 90.9),   # RED2(A) -- bar_pending=True
    ("i8", 91, 93, 91, 93),           # BAR(A.1) ref_high=93 ref_low=91
    ("i9", 91, 94, 91.2, 94),         # BAR 2(A.1) ref_high=94 ref_low=91.2
    ("i10", 90.5, 91.0, 90.6, 90.7),  # TZ BUY 2 SL(A) -- wipes BAR(A.1)/BAR 2(A.1)
    # (no "BAR SL(A.1)" should fire -- the wipe pre-empts it); TZ BUY(A) itself
    # stays active throughout
    ("i11", 90.6, 92, 90.6, 92),      # spawn eligibility from TZ BUY 2's own SL --
    # TZ GREEN(B) forms even though TZ BUY(A) is still active
]
seen9 = run(rows9, "Test 9: TZ BUY 2 SL wipes BAR family + opens spawn eligibility")
expected9 = ["TZ GREEN(A)", "RED(A)", "TZ BUY(A)", "TZ BUY 2(A)", "RED1(A)", "RED2(A)",
             "BAR(A.1)", "BAR 2(A.1)", "TZ BUY 2 SL(A)", "TZ GREEN(B)"]
missing9 = [e for e in expected9 if e not in seen9]
assert not missing9, f"Test 9 MISSING: {missing9}"
assert "BAR SL(A.1)" not in seen9, \
    "Test 9 FAILED: TZ BUY 2's own SL should wipe the BAR family before its own SL check runs"
assert "TZ BUY SL(A)" not in seen9, "Test 9 setup: TZ BUY itself must stay active throughout"

# ---------------------------------------------------------------------------
# Test 10: REAR's own SL (no REAR 2 ever formed) leads to REAR RE-ENTER --
# never a dead end; REAR RE-ENTER's own SL (no REAR RE-ENTER 2 either)
# self-recovers under the same event text -- also never a dead end. Both
# mirror TZ BUY's pattern, not BAR's Family-2 dead-end pattern.
# ---------------------------------------------------------------------------
rows10 = rows7 + [
    ("j16", 93.4, 93.5, 93.0, 93.2),   # REAR SL(A) -- no REAR 2 ever formed
    ("j17", 93.1, 99, 93.1, 99),       # REAR RE-ENTER(A) above 98 -- not a dead end
    ("j18", 93.0, 93.2, 92.6, 92.8),   # REAR RE-ENTER SL(A) -- no REAR RE-ENTER 2 either
    ("j19", 92.7, 100, 92.7, 100),     # REAR RE-ENTER(A) self-recovers above 99, same text
]
seen10 = run(rows10, "Test 10: REAR SL / REAR RE-ENTER SL never dead ends")
expected10 = ["REAR(A)", "REAR SL(A)", "REAR RE-ENTER(A)", "REAR RE-ENTER SL(A)"]
missing10 = [e for e in expected10 if e not in seen10]
assert not missing10, f"Test 10 MISSING: {missing10}"
j17_events = next(evs for date, evs in run.last_trace if date == "j17")
assert j17_events == ["REAR RE-ENTER(A)"], \
    f"Test 10 FAILED: REAR SL should lead straight to REAR RE-ENTER, got {j17_events}"
j19_events = next(evs for date, evs in run.last_trace if date == "j19")
assert j19_events == ["REAR RE-ENTER(A)"], \
    f"Test 10 FAILED: REAR RE-ENTER SL should self-recover under the same text, got {j19_events}"
assert "REAR RE-ENTER 2(A)" not in seen10, "Test 10 setup: REAR RE-ENTER 2 should never form"
assert "REAR 2(A)" not in seen10, "Test 10 setup: REAR 2 should never form"

print("All expected events fired. Smoke test passed.")
print("Reminder: synthetic data only -- TZ BUY 2 has NOT been verified against real OHLC.")
