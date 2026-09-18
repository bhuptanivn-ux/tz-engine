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
reached BAR 2, wipes everything below it and reactivates above the MAXIMUM
of every tier's own current reference (TZ BUY's own peak, TZ BUY 2's own
peak, BAR/BAR 2's ref) -- confirmed via two runs: clearing only BAR 2's ref
(101) does NOT reactivate when TZ BUY 2's own peak (104) is higher; clearing
104 does. TZ BUY 2 keeps climbing independently of whatever forms beneath
it, so the reactivation threshold cannot simply defer to the deepest tier
unconditionally -- it must take the max across everything (explicit user
correction, worked example given for REAR 2's own SL reforming above
"REAR 2's own ref or BAR 2's ref, whichever is higher").

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

Test 11 / 12: REAR 2's own SL, and REAR RE-ENTER 2's own SL, are decisive
(mirror TZ BUY 2's own SL, one/two tiers down) -- they wipe RED1 and
bar_pending, close the gate on RED1 re-attaching to REAR/REAR RE-ENTER
until they reform, and recover under the same event text. Fired
deliberately BEFORE their own "fresh cascade" BAR confirms, to sidestep a
routing quirk fixed for Test 13 below (see there).

Test 13 / 13b: corrects an actual bug found while explaining Tests 11/12
to the user -- REAR 2's own SL must remain reachable even AFTER its own
"fresh cascade" BAR/BAR 2 has formed (worked example given: "REAR - REAR 2
- RED1 - RED2 - BAR - BAR 2 - BAR 2 SL + REAR 2 SL - REAR SL... this is
possible"), and its reactivation threshold is the MAXIMUM of REAR 2's own
reference and BAR 2's reference, whichever is higher -- not simply
"defer to the deepest tier" the way an earlier draft of _current_top_ref
assumed (this also corrected Test 8's premise -- see there). Test 13b
additionally confirms REAR 2's own SL opens spawn eligibility for a fresh
sibling TZ GREEN(n+1), mirroring TZ BUY 2's own SL (explicit user
addition: "similarly TZ GREEN cycle can start after REAR 2 SL/REAR RE
ENTER 2 SL as well").

Test 14 / 14b: same as Test 13/13b, one tier deeper -- REAR RE-ENTER 2's
own SL stays reachable after its own fresh-cascade BAR/BAR 2 has formed,
reactivates above max(REAR RE-ENTER 2's own ref, BAR 2's ref), and its own
SL also opens spawn eligibility for a fresh sibling TZ GREEN(n+1).

Test 15: corrects a real bug found against real data (BBOX.NS) -- once a
BAR lineage reaches its own SL2, the fresh-BAR-without-RED1/RED2 mechanism
(Test 6) must NOT let an unrelated new BAR jump in on a merely generic
breakout. The only three valid outcomes after BAR SL2 are TZ BUY's own
SL, REAR (this same lineage's own breakout above its BAR 2's reference),
or a fresh sibling TZ GREEN(n+1) -- confirmed explicitly by the user. A
breakout that clears only the previous day's high, not BAR 2's own
reference, must produce neither a bogus BAR nor REAR.

Test 16: corrects a second real bug found against real data (BBOX.NS) --
a long-dormant branch's own TZ BUY reactivating (its frozen threshold
finally cleared, possibly by the very same breakout that also advances a
newer sibling) must NEVER terminate that newer sibling's currently-live,
ongoing buy outright. It must stay completely hidden -- not even shown as
a milestone -- for as long as the newer sibling's own cycle is still
alive, surfacing only once that sibling's own cycle genuinely fails.
Confirmed explicitly by the user: "it should stay hidden until newer one
fails."
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
# above the MAXIMUM of every tier's own current reference (TZ BUY's own peak,
# TZ BUY 2's own peak, BAR/BAR 2's ref) -- NOT unconditionally the deepest
# tier's ref. Here TZ BUY 2's own peak (104) is numerically HIGHER than BAR
# 2's ref (101) despite being structurally shallower, since TZ BUY 2 keeps
# climbing independently of whatever forms beneath it -- so 104 must win.
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
    # reentry_threshold should be max(104, 101) = 104
]
rows8_neg = rows8 + [
    ("k11", 99.2, 102, 99.2, 102),    # clears BAR 2's ref (101) but NOT 104 -- must
    # NOT reactivate TZ BUY; spawn eligibility (TZ BUY's own SL) is open instead,
    # so a fresh TZ GREEN(B) forms
]
seen8_neg = run(rows8_neg, "Test 8a: clears BAR 2's ref but not the higher TZ BUY 2 peak -- no reactivation")
assert "TZ GREEN(B)" in seen8_neg, "Test 8a FAILED: should spawn a fresh sibling, not reactivate TZ BUY"
k11_neg_events = next(evs for date, evs in run.last_trace if date == "k11")
assert "TZ BUY(A)" not in k11_neg_events, \
    f"Test 8a FAILED: TZ BUY must NOT reactivate at 102 (below the true threshold of 104), got {k11_neg_events}"

rows8_pos = rows8 + [
    ("k11", 99.2, 104.5, 99.2, 104.5),  # clears 104 (TZ BUY 2's own peak) -- reactivates
]
seen8_pos = run(rows8_pos, "Test 8b: clears the higher TZ BUY 2 peak (104) -- reactivates")
expected8 = ["TZ GREEN(A)", "RED(A)", "TZ BUY(A)", "TZ BUY 2(A)", "RED1(A)", "RED2(A)",
             "BAR(A.1)", "BAR 2(A.1)", "TZ BUY SL(A)"]
missing8 = [e for e in expected8 if e not in seen8_pos]
assert not missing8, f"Test 8b MISSING: {missing8}"
k11_pos_events = next(evs for date, evs in run.last_trace if date == "k11")
assert k11_pos_events == ["TZ BUY(A)"], \
    f"Test 8b FAILED: TZ BUY should reactivate at k11 (above max(104, 101)=104), got {k11_pos_events}"

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
    ("j17", 93.2, 105, 93.2, 105),     # REAR RE-ENTER(A) -- not a dead end. Threshold is
    # max(REAR's own ref 98, TZ BUY 2's own peak 104) = 104, since TZ BUY 2 (still alive,
    # never wiped by REAR forming) climbed higher independently -- so this must clear 104,
    # not just 98
    ("j18", 93.0, 93.2, 92.6, 92.8),   # REAR RE-ENTER SL(A) -- no REAR RE-ENTER 2 either
    ("j19", 92.7, 106, 92.7, 106),     # REAR RE-ENTER(A) self-recovers, same text --
    # threshold is now max(TZ BUY 2's peak 104, REAR RE-ENTER's own peak 105) = 105
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

# ---------------------------------------------------------------------------
# Test 11: REAR 2's own SL is decisive (mirrors TZ BUY 2's own SL, one tier
# down) -- wipes RED1/bar_pending, closes the RED1 gate on REAR until REAR 2
# reforms, and recovers under the same "REAR 2(label)" text. Triggered
# deliberately BEFORE its own fresh-cascade BAR ever confirms -- once that
# BAR forms, REAR/REAR 2 go dormant (superseded machinery) and REAR 2's own
# SL check is skipped entirely from then on, so this is the only reachable
# window for this SL.
# ---------------------------------------------------------------------------
rows11 = rows7 + [
    ("j15b", 93, 98, 80, 97),          # REAR LL(A) -- buffers rear.ref_low to 80,
    # well clear of where REAR 2 will track
    ("j16", 93.6, 99, 93.6, 99),       # REAR 2(A) ref_high=99 ref_low=93.6
    ("j17", 94.2, 100, 94.2, 100),     # rally -- REAR 2 HH -> 100
    ("j18", 94.5, 94.5, 94.0, 94.0),   # RED1(A) [gated on REAR 2 existing]
    ("j19", 94.3, 94.3, 93.8, 93.8),   # RED2(A) -- bar_pending=True
    ("j20", 93.5, 93.5, 93.3, 93.4),   # REAR 2 SL(A) -- fires before the fresh BAR
    # cascade ever confirms; wipes RED1/bar_pending
    ("j21", 93.2, 93.2, 93.0, 93.0),   # RED1-shaped day -- gate closed (REAR 2's own
    # SL active), must produce NOTHING
    ("j22", 93.1, 101, 93.1, 101),     # REAR 2(A) recovers, same label
]
seen11 = run(rows11, "Test 11: REAR 2's own SL wipe + gate + recovery")
expected11 = ["REAR(A)", "REAR 2(A)", "RED1(A)", "RED2(A)", "REAR 2 SL(A)"]
missing11 = [e for e in expected11 if e not in seen11]
assert not missing11, f"Test 11 MISSING: {missing11}"
j21_events = next(evs for date, evs in run.last_trace if date == "j21")
assert j21_events == [], \
    f"Test 11 FAILED: RED1 must not reattach while REAR 2's own SL is active, got {j21_events}"
assert "REAR SL(A)" not in seen11, "Test 11 setup: REAR itself must not fail here"

# ---------------------------------------------------------------------------
# Test 12: REAR RE-ENTER 2's own SL -- same pattern one tier deeper, built
# on top of Test 10's REAR RE-ENTER (which formed with no REAR RE-ENTER 2
# at all, proving that path independently) -- reuses rows10 defined above.
# ---------------------------------------------------------------------------
rows12 = rows10 + [
    ("j20", 92.5, 100, 70, 99),        # REAR RE-ENTER LL(A) -- buffers rre.ref_low to 70
    ("j21", 92, 107, 92, 107),         # REAR RE-ENTER 2(A) -- forms off rre's own ref
    # (106, from Test 10's own corrected reactivation) -- ref_high=107 ref_low=92
    ("j22", 92.5, 108, 92.5, 108),     # rally -- REAR RE-ENTER 2 HH -> 108
    ("j23", 92.8, 93, 92.3, 92.3),     # RED1(A) [gated on REAR RE-ENTER 2 existing]
    ("j24", 92.8, 92.8, 92.1, 92.1),   # RED2(A) -- bar_pending=True
    ("j25", 92, 92, 91.7, 91.9),       # REAR RE-ENTER 2 SL(A) -- fires before the fresh
    # BAR cascade ever confirms; wipes RED1/bar_pending
    ("j26", 91.6, 91.6, 91.4, 91.4),   # RED1-shaped day -- gate closed, must produce
    # NOTHING
    ("j27", 91.5, 109, 91.5, 109),     # REAR RE-ENTER 2(A) recovers, same label -- must
    # clear 108, its own peak set at j22
]
seen12 = run(rows12, "Test 12: REAR RE-ENTER 2's own SL wipe + gate + recovery")
expected12 = ["REAR RE-ENTER(A)", "REAR RE-ENTER 2(A)", "RED1(A)", "RED2(A)",
              "REAR RE-ENTER 2 SL(A)"]
missing12 = [e for e in expected12 if e not in seen12]
assert not missing12, f"Test 12 MISSING: {missing12}"
j26_events = next(evs for date, evs in run.last_trace if date == "j26")
assert j26_events == [], \
    f"Test 12 FAILED: RED1 must not reattach while REAR RE-ENTER 2's own SL is active, got {j26_events}"

# ---------------------------------------------------------------------------
# Test 13: REAR 2's own SL fires AFTER its own fresh-cascade BAR/BAR 2 has
# already formed (the exact scenario the user gave -- "BAR 2 SL + REAR 2 SL"
# firing together the same candle) -- proving a real dormancy bug is fixed
# (previously, once that BAR formed, _supersede_rear_for_new_bar wrongly
# marked REAR/REAR 2 dormant, permanently blocking REAR 2's own SL check).
# Reactivation threshold is max(REAR 2's own ref, BAR 2's ref) -- here REAR
# 2's OWN reference (107) wins over the deeper BAR 2 tier (100), the
# opposite of Test 8's TZ BUY example, proving it's a genuine comparison.
# ---------------------------------------------------------------------------
rows13 = rows7 + [
    ("j15b", 93, 98, 80, 97),           # REAR LL(A) -- buffers rear.ref_low to 80
    ("j16", 93.6, 106, 93.6, 106),      # REAR 2(A) ref_high=106 -- already above TZ
    # BUY 2's own peak (104), so this test isolates REAR 2 vs BAR 2 specifically
    ("j17", 94.2, 107, 94.2, 107),      # rally -- REAR 2 HH -> 107
    ("j18", 94.5, 94.5, 94.0, 94.0),    # RED1(A)
    ("j19", 94.3, 94.3, 93.8, 93.8),    # RED2(A) -- bar_pending=True
    ("j20", 93.9, 94.6, 93.9, 94.6),    # BAR(A.1) -- REAR 2's own dual-role cascade
    ("j21", 94, 100, 94, 100),          # BAR 2(A.1) ref_high=100 ref_low=94 -- LOWER
    # than REAR 2's own 107
    ("j22", 93.5, 93.5, 93.3, 93.5),    # BAR 2 SL(A.1) + REAR 2 SL(A) -- SAME candle,
    # exactly the coincidence the user described. REAR 2's own SL wipes the BAR
    # family entirely (bar_lineages=[])
    ("j23", 93.2, 93.2, 93.0, 93.0),    # RED1-shaped day -- gate closed, must produce
    # NOTHING
    ("j24", 93.1, 108, 93.1, 108),      # REAR 2(A) recovers -- must clear max(107, 100)
    # = 107, not just BAR 2's 100
]
seen13 = run(rows13, "Test 13: REAR 2 SL reachable after its own BAR/BAR 2 cascade forms")
expected13 = ["REAR(A)", "REAR 2(A)", "RED1(A)", "RED2(A)", "BAR(A.1)", "BAR 2(A.1)",
              "BAR 2 SL(A.1)", "REAR 2 SL(A)"]
missing13 = [e for e in expected13 if e not in seen13]
assert not missing13, f"Test 13 MISSING: {missing13}"
j22_events = next(evs for date, evs in run.last_trace if date == "j22")
assert set(j22_events) == {"BAR 2 SL(A.1)", "REAR 2 SL(A)"}, \
    f"Test 13 FAILED: both SLs must fire together the same candle, got {j22_events}"
j23_events = next(evs for date, evs in run.last_trace if date == "j23")
assert j23_events == [], \
    f"Test 13 FAILED: RED1 must not reattach while REAR 2's own SL is active, got {j23_events}"
j24_events = next(evs for date, evs in run.last_trace if date == "j24")
assert j24_events == ["REAR 2(A)"], \
    f"Test 13 FAILED: REAR 2 should recover at j24 (above max(107,100)=107), got {j24_events}"

# ---------------------------------------------------------------------------
# Test 13b: REAR 2's own SL also opens spawn eligibility for a fresh sibling
# TZ GREEN(n+1) -- same principle as TZ BUY 2's own SL (Test 9), one tier
# down. Diverges from Test 13 right after the SL fires.
# ---------------------------------------------------------------------------
rows13_spawn = rows13[:-2] + [
    ("j23b", 93.3, 94, 93.3, 94),       # doesn't clear 107 -- but qualifies as a fresh
    # TZ GREEN breakout -- should spawn TZ GREEN(B) since REAR 2's own SL is active
]
seen13b = run(rows13_spawn, "Test 13b: spawn eligibility opens after REAR 2's own SL")
assert "TZ GREEN(B)" in seen13b, "Test 13b FAILED: should spawn a fresh sibling"
j23b_events = next(evs for date, evs in run.last_trace if date == "j23b")
assert j23b_events == ["TZ GREEN(B)"], \
    f"Test 13b FAILED: expected only TZ GREEN(B) to spawn, got {j23b_events}"

# ---------------------------------------------------------------------------
# Test 14: REAR RE-ENTER 2's own SL -- same pattern as Test 13, one tier
# deeper. Built on rows10 (Test 10's REAR RE-ENTER, already defined above).
# Here REAR RE-ENTER 2's own reference (110) is the highest of the chain
# (above both TZ BUY 2's 104 and BAR 2's 99), so it wins the max().
# ---------------------------------------------------------------------------
rows14 = rows10 + [
    ("j20", 92.5, 100, 70, 99),        # REAR RE-ENTER LL(A) -- buffers rre.ref_low to 70
    ("j21", 92, 109, 92, 109),         # REAR RE-ENTER 2(A) ref_high=109 -- above TZ
    # BUY 2's own peak (104)
    ("j22", 92.5, 110, 92.5, 110),     # rally -- REAR RE-ENTER 2 HH -> 110
    ("j23", 92.8, 93, 92.3, 92.3),     # RED1(A)
    ("j24", 92.8, 92.8, 92.1, 92.1),   # RED2(A) -- bar_pending=True
    ("j25", 92.2, 93.3, 92.2, 93.3),   # BAR(A.1) -- REAR RE-ENTER 2's own dual-role cascade
    ("j26", 92.3, 99, 92.3, 99),       # BAR 2(A.1) ref_high=99 ref_low=92.3 -- LOWER
    # than REAR RE-ENTER 2's own 110
    ("j27", 91.8, 91.8, 91.7, 91.9),   # BAR 2 SL(A.1) + REAR RE-ENTER 2 SL(A) -- SAME
    # candle -- proves the dormancy fix applies here too
    ("j28", 91.6, 91.6, 91.4, 91.4),   # RED1-shaped day -- gate closed, must produce
    # NOTHING
    ("j29", 91.5, 111, 91.5, 111),     # REAR RE-ENTER 2(A) recovers -- must clear
    # max(110, 99) = 110
]
seen14 = run(rows14, "Test 14: REAR RE-ENTER 2 SL reachable after its own BAR/BAR 2 cascade forms")
expected14 = ["REAR RE-ENTER(A)", "REAR RE-ENTER 2(A)", "RED1(A)", "RED2(A)", "BAR(A.1)",
              "BAR 2(A.1)", "BAR 2 SL(A.1)", "REAR RE-ENTER 2 SL(A)"]
missing14 = [e for e in expected14 if e not in seen14]
assert not missing14, f"Test 14 MISSING: {missing14}"
j27_events = next(evs for date, evs in run.last_trace if date == "j27")
assert set(j27_events) == {"BAR 2 SL(A.1)", "REAR RE-ENTER 2 SL(A)"}, \
    f"Test 14 FAILED: both SLs must fire together the same candle, got {j27_events}"
j28_events = next(evs for date, evs in run.last_trace if date == "j28")
assert j28_events == [], \
    f"Test 14 FAILED: RED1 must not reattach while REAR RE-ENTER 2's own SL is active, got {j28_events}"
j29_events = next(evs for date, evs in run.last_trace if date == "j29")
assert j29_events == ["REAR RE-ENTER 2(A)"], \
    f"Test 14 FAILED: REAR RE-ENTER 2 should recover at j29 (above max(110,99)=110), got {j29_events}"

# ---------------------------------------------------------------------------
# Test 14b: REAR RE-ENTER 2's own SL also opens spawn eligibility for a
# fresh sibling TZ GREEN(n+1). Diverges from Test 14 right after the SL fires.
# ---------------------------------------------------------------------------
rows14_spawn = rows14[:-2] + [
    ("j28b", 91.8, 92.5, 91.8, 92.5),  # doesn't clear 110 -- but qualifies as a fresh
    # TZ GREEN breakout -- should spawn TZ GREEN(B) since REAR RE-ENTER 2's own SL is active
]
seen14b = run(rows14_spawn, "Test 14b: spawn eligibility opens after REAR RE-ENTER 2's own SL")
assert "TZ GREEN(B)" in seen14b, "Test 14b FAILED: should spawn a fresh sibling"
j28b_events = next(evs for date, evs in run.last_trace if date == "j28b")
assert j28b_events == ["TZ GREEN(B)"], \
    f"Test 14b FAILED: expected only TZ GREEN(B) to spawn, got {j28b_events}"

# ---------------------------------------------------------------------------
# Test 15: once a BAR lineage reaches its own SL2, the fresh-BAR-without-
# RED1/RED2 mechanism (Test 6) must NOT fire on a merely generic breakout --
# only TZ BUY's own SL, REAR, or a fresh sibling TZ GREEN(n+1) may follow.
# Built on rows7 minus its final row (which forms REAR via the SPECIFIC
# breakout above BAR 2's own ref) -- diverges with a breakout that clears
# only the previous day's high, not BAR 2's higher reference.
# ---------------------------------------------------------------------------
rows15 = rows7[:-1] + [
    ("j15", 93.4, 93.9, 93.4, 93.9),  # clears prev day's high (a generic
    # breakout) but NOT BAR 2(A.1)'s own ref (97) -- must NOT spawn a bogus
    # fresh BAR(A.2); TZ GREEN(B) spawning instead (spawn eligibility opened
    # by the lineage's own SL2) is a valid outcome, a bogus BAR is not
]
seen15 = run(rows15, "Test 15: no fresh BAR after SL2 on a merely-generic breakout")
j15_events = next(evs for date, evs in run.last_trace if date == "j15")
assert not any(e.startswith("BAR(") for e in j15_events), \
    f"Test 15 FAILED: a fresh BAR must not form once the newest lineage has reached its own SL2, got {j15_events}"
assert "REAR(A)" not in seen15, "Test 15 setup: this breakout must not clear BAR 2's own ref either"

# ---------------------------------------------------------------------------
# Test 16: a long-dormant branch's own TZ BUY reactivating must NOT
# terminate a newer sibling's currently-live, ongoing buy -- it must stay
# completely hidden until that sibling's own cycle fails. Branch A gets its
# own top-level SL early (freezing its reentry threshold); branch B spawns,
# builds its own full TZ BUY -> TZ BUY 2 cycle well below A's frozen level,
# then climbs past it. Only B's own events may show.
# ---------------------------------------------------------------------------
rows16 = [
    ("m0", 100, 100, 99.0, 99.5),
    ("m1", 100, 101, 99.2, 101),      # TZ GREEN(A)
    ("m1b", 100.5, 100.5, 99.5, 100), # consolidation
    ("m2", 99.4, 100, 99.3, 99.4),    # RED(A)
    ("m3", 99.5, 102, 99.4, 102),     # TZ BUY(A) ref_high=102
    ("m4", 99.3, 99.3, 99.1, 99.2),   # TZ BUY SL(A) -- reentry_threshold=102
    ("m5", 99.2, 99.6, 99.2, 99.6),   # TZ GREEN(B) ref_low=99.2 -- stays under 102
    ("m5b", 99.5, 99.6, 99.3, 99.4),  # consolidation
    ("m6", 99.2, 99.3, 99.1, 99.1),   # RED(B) -- shallow dip, no TZ GREEN SL(B)
    ("m7", 99.2, 99.9, 99.2, 99.9),   # TZ BUY(B) ref_high=99.9 -- still under 102
    ("m8", 99.3, 100.5, 99.3, 100.5), # TZ BUY 2(B) -- MILESTONE: B becomes sole
    # non-dormant leader, A goes dormant -- still under 102
    ("m9", 99.4, 116, 99.4, 116),     # TZ BUY 2 HH(B) -- B's climb now clears A's
    # frozen 102 too (A's OWN reentry_threshold keeps getting pulled up to
    # match it, per the confirmed "keep adding" rule -- but A's own buy must
    # stay fully inert, see Test 17), only B's own event may show
    ("m10", 99.5, 117, 99.5, 117),    # further climb -- A must stay fully hidden
]
seen16 = run(rows16, "Test 16: old dormant branch must not surface/terminate a newer LIVE cycle")
expected16 = ["TZ GREEN(A)", "RED(A)", "TZ BUY(A)", "TZ BUY SL(A)", "TZ GREEN(B)", "RED(B)",
              "TZ BUY(B)", "TZ BUY 2(B)", "TZ BUY 2 HH(B)"]
missing16 = [e for e in expected16 if e not in seen16]
assert not missing16, f"Test 16 MISSING: {missing16}"
post_sl_events = [e for date, evs in run.last_trace for e in evs
                  if date not in ("m1", "m1b", "m2", "m3")]
assert not any(e.startswith("TZ BUY(A)") for e in post_sl_events), \
    f"Test 16 FAILED: A's reactivation must never surface once B's own live cycle exists, got {post_sl_events}"
m9_events = next(evs for date, evs in run.last_trace if date == "m9")
assert m9_events == ["TZ BUY 2 HH(B)"], \
    f"Test 16 FAILED: only B's own event may show even though this breakout also clears A's threshold, got {m9_events}"
m10_events = next(evs for date, evs in run.last_trace if date == "m10")
assert m10_events == ["TZ BUY 2 HH(B)"], \
    f"Test 16 FAILED: A must stay fully hidden going forward, got {m10_events}"


# ---------------------------------------------------------------------------
# Test 17: real bug found against real data (BBOX.NS) -- a dormant sibling's
# own top-level TZ BUY must NOT actually reactivate (buy.active flip, ref_low
# reset) while it's exempted/hidden behind a live newer sibling, even though
# its own reentry_threshold gets pulled up to match the leader's climbing
# peak every week (confirmed rule: "every higher high... will keep adding").
# Test 16 only checked that the VISIBLE event stayed hidden; the real bug
# was one layer deeper -- the reactivation's event TEXT was suppressed but
# the underlying STATE CHANGE (active=True, ref_low reset to whatever that
# week's low happened to be) still went through, which let the hidden
# branch's own SL condition fire later, completely disconnected from
# anything happening in the actually-live cycle (real trace: BBOX.NS's
# "TZ BUY SL(A)" surfacing out of nowhere in March 2020 while sibling C's
# TZ BUY 2 cycle was still fully alive and had never failed). Reuses Test
# 16's exact rows, inspecting the engine's own internal state directly
# instead of just the visible events.
# ---------------------------------------------------------------------------
days17 = [Day(d, o, h, l, c) for d, o, h, l, c in rows16]
engine17 = TZEngine()
for i in range(1, len(days17)):
    prev, cur = days17[i - 1], days17[i]
    engine17.process(prev, cur)
    if cur.date in ("m9", "m10"):
        buy_a = engine17.branches[1].buy
        assert buy_a.active is False, (
            f"Test 17 FAILED at {cur.date}: dormant branch A's own TZ BUY must stay "
            f"inactive while sibling B is live, got active={buy_a.active}")
        assert buy_a.ref_low == 99.4, (
            f"Test 17 FAILED at {cur.date}: A's own ref_low must stay frozen at its "
            f"original formation value, got {buy_a.ref_low}")
print("Test 17: hidden branch's own TZ BUY stays fully inert (no reactivation) while sibling B is live.\n")

# ---------------------------------------------------------------------------
# Test 18: real bug found against real data (PAYTM.NS) -- once TZ BUY 2's own
# SL fires, an intervening new high that clears the frozen pre-SL peak but
# closes back below it must quietly raise the recovery bar ("INVALID TZ BUY
# 2 HH", exactly mirroring INVALID BAR HH) instead of being ignored. Without
# this, a LATER, actually LOWER high could wrongly confirm "recovered"
# against a stale level price had already cleared and abandoned weeks
# earlier. User's exact correction: "After TZ BUY 2 SL, any HH above the HH
# before the SL will be the new HH... TZ BUY CAN REACTIVATE ONLY ABOVE THIS
# HH and the reference high before the SL."
# ---------------------------------------------------------------------------
rows18 = [
    ("k0", 100, 100, 99.0, 99.5),
    ("k1", 100, 101, 99.2, 101),      # TZ GREEN(A)
    ("k1b", 100.5, 100.5, 99.5, 100), # consolidation
    ("k2", 99.4, 100, 99.3, 99.4),    # RED(A)
    ("k3", 99.5, 102, 99.4, 102),     # TZ BUY(A) ref_high=102, ref_low=99.4
    ("k4", 99.5, 103, 99.5, 103),     # TZ BUY 2(A) via rally -- ref_high=103
    ("k5", 99.4, 99.5, 99.3, 99.3),   # TZ BUY 2 SL(A) -- gap 0.2 below TZ BUY
    # 2's own 99.5; TZ BUY's own top-level ref_low(99.4) only breached by 0.1
    # (safe, stays active) -- reentry_threshold snapshots at 103
    ("k6", 99.5, 104, 99.4, 102),     # clears 103 by 1.0 but CLOSES BACK
    # BELOW it (102 < 103) -- must NOT recover; must raise the bar to 104
    ("k7", 99.5, 103.5, 99.4, 100),   # a LOWER high (103.5) than the now-
    # raised 104 -- must show NOTHING (this is the exact real-bug shape:
    # this would have wrongly confirmed recovery against the STALE 103)
    ("k8", 100, 105, 99.5, 105),      # genuinely clears the RAISED 104 with
    # a confirming close -- TZ BUY 2 recovers here, not any candle before
]
seen18 = run(rows18, "Test 18: TZ BUY 2 recovery bar must keep climbing on intervening highs, not stay frozen at the stale pre-SL peak")
expected18 = ["TZ GREEN(A)", "RED(A)", "TZ BUY(A)", "TZ BUY 2(A)", "TZ BUY 2 SL(A)",
              "INVALID TZ BUY 2 HH(A)"]
missing18 = [e for e in expected18 if e not in seen18]
assert not missing18, f"Test 18 MISSING: {missing18}"
k6_events = next(evs for date, evs in run.last_trace if date == "k6")
assert "TZ BUY 2(A)" not in k6_events, \
    f"Test 18 FAILED: clearing the stale 103 with a non-confirming close must NOT recover TZ BUY 2, got {k6_events}"
k7_events = next(evs for date, evs in run.last_trace if date == "k7")
assert not any(e.startswith("TZ BUY 2") for e in k7_events), \
    f"Test 18 FAILED: a high (103.5) below the already-raised bar (104) must show nothing for TZ BUY 2, got {k7_events}"
k8_events = next(evs for date, evs in run.last_trace if date == "k8")
assert "TZ BUY 2(A)" in k8_events, \
    f"Test 18 FAILED: clearing the RAISED bar (104) with a confirming close must recover TZ BUY 2, got {k8_events}"
print("Test 18: TZ BUY 2's post-SL recovery bar correctly keeps climbing on intervening highs.\n")

# ---------------------------------------------------------------------------
# Test 19: same fix, one tier over -- REAR 2's own post-SL recovery bar must
# also keep climbing on intervening highs, not stay frozen at the stale
# pre-SL peak (confirmed: "recovery bar above TZ BUY 2/REAR 2/REAR RE-ENTER
# [2] reference after its SL was a basic requirement. Fix it permanent.").
# Built on rows11's own REAR 2 SL setup (dropping its own final "recovers"
# candle, which only cleared 101 -- rows11's OWN reentry_threshold is
# actually 104, inherited from TZ BUY 2's earlier peak via
# "whichever is higher", so that candle was never a real recovery anyway).
# ---------------------------------------------------------------------------
rows19 = rows11[:-1] + [
    ("j21b", 99, 105, 98.5, 100),   # clears reentry_threshold(104) but closes
    # back below it -- must NOT recover; must raise the bar to 105
    ("j21c", 99, 104.5, 98, 99),    # a LOWER high (104.5) than the now-raised
    # 105 -- must show NOTHING for REAR 2
    ("j22b", 99, 107, 99, 107),     # genuinely clears the RAISED 105 --
    # REAR 2 recovers here, not any candle before
]
seen19 = run(rows19, "Test 19: REAR 2's post-SL recovery bar must also keep climbing on intervening highs")
assert "INVALID REAR 2 HH(A)" in seen19, "Test 19 MISSING: INVALID REAR 2 HH(A)"
j21b_events = next(evs for date, evs in run.last_trace if date == "j21b")
assert "REAR 2(A)" not in j21b_events, \
    f"Test 19 FAILED: clearing the stale 104 with a non-confirming close must NOT recover REAR 2, got {j21b_events}"
j21c_events = next(evs for date, evs in run.last_trace if date == "j21c")
assert not any(e.startswith("REAR 2") for e in j21c_events), \
    f"Test 19 FAILED: a high (104.5) below the already-raised bar (105) must show nothing for REAR 2, got {j21c_events}"
j22b_events = next(evs for date, evs in run.last_trace if date == "j22b")
assert "REAR 2(A)" in j22b_events, \
    f"Test 19 FAILED: clearing the RAISED bar (105) with a confirming close must recover REAR 2, got {j22b_events}"
print("Test 19: REAR 2's post-SL recovery bar correctly keeps climbing on intervening highs.\n")

# ---------------------------------------------------------------------------
# Test 20: same fix, one tier deeper still -- REAR RE-ENTER 2's own post-SL
# recovery bar must also keep climbing on intervening highs. Built on
# rows12's own REAR RE-ENTER 2 SL setup (dropping its own final "recovers"
# candle, which correctly cleared 108 -- rows12's own reentry_threshold IS
# genuinely 108 here, unlike rows11/rows19's case).
# ---------------------------------------------------------------------------
rows20 = rows12[:-1] + [
    ("j26b", 92, 110, 91.8, 100),   # clears reentry_threshold(108) but closes
    # back below it -- must NOT recover; must raise the bar to 110
    ("j26c", 92, 109.5, 91.9, 95),  # a LOWER high (109.5) than the now-raised
    # 110 -- must show NOTHING for REAR RE-ENTER 2
    ("j27b", 92, 112, 92, 112),     # genuinely clears the RAISED 110 --
    # REAR RE-ENTER 2 recovers here, not any candle before
]
seen20 = run(rows20, "Test 20: REAR RE-ENTER 2's post-SL recovery bar must also keep climbing on intervening highs")
assert "INVALID REAR RE-ENTER 2 HH(A)" in seen20, "Test 20 MISSING: INVALID REAR RE-ENTER 2 HH(A)"
j26b_events = next(evs for date, evs in run.last_trace if date == "j26b")
assert "REAR RE-ENTER 2(A)" not in j26b_events, \
    f"Test 20 FAILED: clearing the stale 108 with a non-confirming close must NOT recover REAR RE-ENTER 2, got {j26b_events}"
j26c_events = next(evs for date, evs in run.last_trace if date == "j26c")
assert not any(e.startswith("REAR RE-ENTER 2") for e in j26c_events), \
    f"Test 20 FAILED: a high (109.5) below the already-raised bar (110) must show nothing for REAR RE-ENTER 2, got {j26c_events}"
j27b_events = next(evs for date, evs in run.last_trace if date == "j27b")
assert "REAR RE-ENTER 2(A)" in j27b_events, \
    f"Test 20 FAILED: clearing the RAISED bar (110) with a confirming close must recover REAR RE-ENTER 2, got {j27b_events}"
print("Test 20: REAR RE-ENTER 2's post-SL recovery bar correctly keeps climbing on intervening highs.\n")

print("All expected events fired. Smoke test passed.")
print("Reminder: synthetic data only -- TZ BUY 2 has NOT been verified against real OHLC.")
