# PRIME TREND — a separate theory, built on top of TZ BUY

**Relationship to TZ BUY**: PRIME TREND is its own theory (Chapter 2, if
TZ BUY is Chapter 1) — not a section of TZ BUY's own rulebook. It
depends entirely on TZ BUY as a prerequisite (it anchors off a WTF TZ
BUY 2 instance and reuses TZ BUY's own tier shapes/thresholds at every
step), but it is a distinct set of rules answering a different question:
given a milestone on a HIGHER time frame (WTF), which SETUP on a LOWER
time frame (DTF) is the actual trade-entry trigger, and when do you exit
it. See `WTF_RULEBOOK.md` for the TZ BUY theory itself; read that first
if any term below (TZ BUY, TZ BUY 2, BAR SL2, THRESH/ANY, "whichever is
higher" reactivation, etc.) is unfamiliar.

**Status**: implemented in Python as `prime_trend.py` (`compute_prime_trend(wtf_rows,
dtf_rows) -> list[PrimeTrendResult]`), worked out by hand and verified
against real ADANIENT.NS data (separate WTF weekly and DTF daily CSVs
for the same scrip) — `test_prime_trend_smoke.py` locks in the exact
worked table below against that real dataset. It does NOT modify or
extend `TZEngine`/`tz_engine_wtf.py` — it's a separate, dependent
consumer: run `TZEngine` once over the WTF series to get its event
trace (plus a per-candle snapshot of each branch's own TZ BUY 2
reference low, needed to resolve the exact WTF-side exit price), then
walk the DTF series independently using that trace as a live anchor.
Not yet ported to TypeScript/`main`. Future theories may reuse pieces of
TZ BUY's or PRIME TREND's own mechanics as a starting point, but each is
tracked as its own theory going forward, not folded into one another.

## Naming

Formerly described only as "DTF with respect to WTF." Henceforth called
**PRIME TREND**, to avoid confusion with plain single-timeframe DTF or
WTF analysis (which is just TZ BUY run on daily or weekly candles by
itself, no cross-timeframe layer involved).

## The chain

`WTF TZ BUY → WTF TZ BUY 2 → (DTF) TZ BUY → (DTF) TZ BUY ENTRY`. Each
arrow is a further escalation, gated on the previous one, exactly
mirroring how every other tier pair in TZ BUY works (TZ BUY → TZ BUY 2,
BAR → BAR 2, etc.) — PRIME TREND simply continues that same
escalating-gate pattern down onto the lower timeframe.

## Anchors: three WTF-side tiers, not just TZ BUY 2

PRIME TREND anchors off **any of three** WTF-side tiers, each treated
identically: **WTF TZ BUY 2**, **WTF REAR 2**, and **WTF REAR RE-ENTER 2**.
`tz_engine_wtf.py` itself calls REAR 2 and REAR RE-ENTER 2 "TZ BUY 2
variant"s throughout — each has its own decisive SL, its own "whichever
is higher" self-recovery, and its own BAR-family attachment, exactly
mirroring TZ BUY 2's mechanics one and two tiers down the REAR family. So
each gets its own independent set of PRIME TREND instances, with the
identical DTF Stage 1/Stage 2 machinery below applied unchanged — the
DTF-side code never even knows which of the three tiers fed it; the only
thing that differs per family is which tier's own live reference high is
the anchor.

The starting anchor for a given instance is that tier's own reference
high — but it is **not frozen at formation**. It keeps climbing via its
own ordinary `<tier> HH(` tracking for as long as it stays alive, and
PRIME TREND must anchor against whatever that reference currently stands
at, not its value on the day it first formed (confirmed bug, ADANIENT.NS
branch C: using the frozen formation value of 54.50 wrongly let a DTF
candle "clear" an anchor that had already climbed to 56.23 by the time
that candle occurred).

**Look-ahead bias guard**: WTF is a *weekly* series, so its own reference
high for "this week" is only known once that week has fully closed — a
Monday's own daily candle cannot legitimately be judged against a WTF
figure that literally includes that same week's own not-yet-elapsed
days. The anchor available to any DTF day is therefore the WTF TZ BUY
2's reference high **as it stood at the end of the most recently fully
completed WTF week strictly before the WTF week containing that DTF
day** — never the current, still-forming week's own value, even same-day.

## Stage 1 — DTF TZ BUY

The first DTF daily candle, after the WTF TZ BUY 2 date, clearing the
live anchor via the full breakout shape already used everywhere in TZ
BUY: `cur.l >= prev.l`, `cur.h > anchor` by `>= 0.20`, `cur.c >= anchor`.

Once formed, DTF TZ BUY is its own independent object with `ref_high`/
`ref_low`, tracking ordinary quiet HH/LL (the `0.01` rule, identical to
TZ BUY's own `TZ BUY HH`/`TZ BUY LL`) and its own SL: `cur.l < ref_low`
by `>= 0.20` with a weak close (`cur.c <= ref_low`). Unlike TZ BUY's own
top-level SL (which also opens spawn eligibility for a fresh sibling `TZ
GREEN(n+1)`), **no new parallel cycle can start here** — the only
channel forward after a DTF TZ BUY SL is that same object reactivating
in place, above its own frozen reference high (`cur.l >= prev.l`,
`cur.h > frozen_ref` by `>= 0.20`, `cur.c >= frozen_ref`), exactly like
TZ BUY's own reactivation. A high that clears the frozen reference
without fulfilling all three conditions is `INVALID DTF TZ BUY HH`
(quiet climb, matching `INVALID BAR SL HH` / `INVALID TZ BUY 2 HH` in TZ
BUY) — the reference keeps climbing without confirming.

## Stage 2 — DTF TZ BUY ENTRY

While DTF TZ BUY (Stage 1) is active, its own reference high is a
ratchet ladder: it climbs on every new daily high (again the ordinary
`0.01` rule — this is the SAME quiet climb as Stage 1's own HH, not a
separate mechanism), and DTF TZ BUY ENTRY confirms the moment a candle
clears the *current* ratcheted ladder value by the full breakout shape
again (`cur.l >= prev.l`, `cur.h >= ladder + 0.20`, `cur.c >= ladder`).

**Entry price = ladder + 0.20** (the qualifying threshold itself), not
the candle's own actual High/Close — worked example (ADANIENT.NS branch
A, WTF TZ BUY 2 2007-07-09): DTF TZ BUY forms 2007-07-16 @ 15.09; the
ladder then climbs 15.19 (FALSE, +0.10) → 15.35 (FALSE, +0.16) → 15.47
(FALSE, +0.12) → 15.56 (FALSE, +0.09) — none of these clear the *prior*
ladder step by the full 0.20, so each is a quiet ratchet, not a
confirmation — until 2007-08-03 clears 15.56 by more than 0.20: **DTF TZ
BUY ENTRY confirms at 15.56 + 0.20 = 15.76**.

Once formed, DTF TZ BUY ENTRY is its own object with the SAME structure
as Stage 1 (`ref_high`/`ref_low`, ordinary quiet HH/LL, its own SL at
`cur.l < ref_low` by `>= 0.20` with a weak close) and its own
reactivation above its own frozen reference (same full-shape condition),
with `INVALID DTF TZ BUY ENTRY HH` for a clearing high that doesn't
fully confirm — exactly mirroring Stage 1's own SL/reactivation/INVALID-
HH cycle one tier up.

**Dependency on Stage 1** (explicit user confirmation, mirrors TZ BUY 2
not persisting through TZ BUY's own reactivation): DTF TZ BUY ENTRY is
wholly dependent on DTF TZ BUY. The moment Stage 1's own SL fires, Stage
2 is wiped entirely, regardless of its own state — there is no
independent survival. Once Stage 1 reactivates, Stage 2's escalation
ladder restarts from scratch off Stage 1's fresh reactivated reference,
exactly like the very first time.

**Dependency on WTF** (explicit user confirmation): the reverse also
holds — DTF can only be active while its *governing* WTF TZ BUY 2 is
itself currently active. If WTF TZ BUY 2 SLs, DTF's own tracking freezes
regardless of what DTF price does in the meantime; DTF can only search
for a fresh Stage 1 again once WTF TZ BUY 2 has itself reactivated, and
that fresh search re-anchors against the newly reactivated WTF
reference — "just like the first time," never against DTF's own
pre-freeze levels.

## Filter

An instance only produces a usable PRIME TREND trade if Stage 2 (DTF TZ
BUY ENTRY) actually confirms at least once before that instance's own WTF
anchor fails. If Stage 1 never forms, or forms but never escalates to
Stage 2, before the WTF-side failure, there is no trade for that
instance — it is excluded, not reported with a placeholder price.

## Every closed entry/exit cycle is its own row (not just the last one)

**Correction** (confirmed bug in the original implementation): a single
WTF anchor window can produce *multiple* DTF entry/exit cycles — Stage 2
can close and reactivate any number of times while the WTF anchor itself
stays alive (e.g. `DTF TZ BUY ENTRY SL`, then a fresh Stage 1/Stage 2
cycle forms and closes again later, all still inside the same WTF window).
The original implementation only ever kept the *last* such cycle,
silently overwriting every earlier CLOSED cycle. Every CLOSED cycle is a
real, permanent trade and must get its own row; only the mechanism for
"still open when the WTF window itself ends" behaves as the single latest
entry, per the Exit section below. User's exact correction, worked
example (ICICIBANK.NS, WTF TZ BUY 2 formed 2014-05-05): "This should
appear as it is. Once TZ BUY ENTRY OCCURS ITS ENTRY SHOULD REFLECT... D
2014-05-05 (WILL REMAIN SAME) ONLY DTF DETAILS WILL CHANGE" — i.e. the
window's *formation* date/letter is shared across every row it produces;
only entry/exit/HH differ row to row.

## Exit

Whichever of the following fires first after the (latest, still-live)
entry, forgetting any earlier entry/exit pair the moment something
reactivates before it would have counted as final:

- **WTF-side**: `BAR SL2` (exit price = that WTF week's own Close), or
  the tier's own "2" SL / its parent tier's SL (exit price = that tier's
  own reference low) — e.g. for a TZ BUY 2 anchor, `TZ BUY 2 SL` or
  `TZ BUY SL`; for a REAR 2 anchor, `REAR 2 SL` or `REAR SL`; for a REAR
  RE-ENTER 2 anchor, `REAR RE-ENTER 2 SL` or `REAR RE-ENTER SL`. The
  parent-tier SL counts as a valid exit type here too, since it wipes the
  "2" tier exactly the same way that tier's own SL does.
- **DTF-side**: Stage 1's own `TZ BUY SL` or Stage 2's own `TZ BUY ENTRY
  SL`, with no reactivation before the WTF-side event above fires (exit
  price = that stage's own reference low at the moment of SL).

If a DTF-side SL reactivates before the window closes (whether via Stage
1 or Stage 2 recovering), the entry/exit pair it would have closed is
discarded entirely and superseded by whatever the newest live entry
turns out to be — this is exactly the mechanism that produces a new row
per the section above, rather than overwriting.

### Combined DTF/WTF exit label

**Addition**: when a window's *final* DTF cycle closes on a DTF-side SL
(`DTF TZ BUY ENTRY SL` or the Stage-1 wipe, `DTF TZ BUY SL (wipes
ENTRY)`), and the WTF anchor itself *later* independently confirms its
own terminal failure (its own "2" SL, its parent tier's SL, or `BAR SL2`)
before any further DTF reactivation ever occurs, the Exit Type is
reported as **`DTF SL - <WTF SL type>`** (e.g. `DTF SL - BAR SL 2`, `DTF
SL - TZ BUY 2 SL`) — signaling that the DTF side failed first, and the
WTF anchor confirmed its own failure afterward, with nothing in between.
This only ever applies to the *last* row of a window: an earlier row is
already followed by a captured reactivation (the section above), which
means the WTF side hadn't actually failed at that point — only the
final, unreactivated cycle can be retroactively confirmed this way. The
exit date/price stay exactly as the DTF-side event recorded them (that's
what practically closed the position); only the label changes, to record
that the WTF side later confirmed the same outcome. User's framing: "then
mention the same as DTF SL - TZ BUY 2 SL (or DTF SL - BAR SL 2)... I will
understand that 1st sl Triggered in DTF followed by wtf."

## Highest High

Maximum daily High strictly *after* the (final) entry date, up to and
including the exit date — never the entry candle's own High.

## Worked results, ADANIENT.NS (all 6 WTF TZ BUY 2 dates checked)

**Stale pending re-verification**: the table below was computed under the
pre-correction implementation (last-cycle-only, TZ BUY 2 anchor only, no
combined DTF/WTF exit label). It has not yet been recomputed against
ADANIENT.NS under the corrected implementation (multi-cycle rows, all
three anchor families, combined exit labels) — held pending, since
ADANIENT.NS testing is under a standing restriction this session. Do not
treat the table below as current until it's re-verified and this note is
removed.

| WTF TZ BUY 2 | PRIME TREND Entry | Exit | Exit Price | Highest High |
|---|---|---|---|---|
| 2007-07-09 (A) | 2007-08-03 @ 15.76 | BAR SL2(A.1), 2008-09-29 | 21.64 | 62.00 (2008-01-03) |
| 2009-11-03 (C) | 2010-04-21 @ 49.31 | DTF TZ BUY ENTRY SL, 2011-10-04 | 46.04 | 73.25 (2010-11-04) |
| 2014-03-10 (B) | 2014-03-28 @ 31.56 | BAR SL2(B.4), 2015-06-29 | 50.79 | 74.92 (2015-05-26) |
| 2017-01-30 (C) | 2017-03-16 @ 57.02 | BAR SL2(C.5), 2023-01-30 | 1539.09 | 4064.02 (2022-12-21) |
| 2024-02-26 (B) | *excluded — Stage 1 never forms in the 2-week window before this WTF TZ BUY 2 SLs* | | | |
| 2024-05-21 (B) | *excluded — Stage 1 forms then SLs the next day, never reactivates before the WTF exit* | | | |

Note the 2009-11-03 and 2017-01-30 rows both involve an intermediate
Stage-1-level SL/reactivation before Stage 2 ever confirmed — in both
cases correctly discarded per the dependency rule above, with the final
reported entry being whichever one survived to the WTF-side exit.

## Bug fix: WTF branch letters get recycled — an instance's own boundary must track the underlying branch id, not its display letter (ICICIBANK.NS)

Found while running `prime_trend.py` against a second scrip
(ICICIBANK.NS): branch "E" formed WTF TZ BUY 2 in 2014-03-24, then was
**collaterally terminated** by the multi-branch leadership rules —
no `TZ BUY 2 SL(`, `TZ BUY SL(`, or `BAR SL2(` event ever fired for it,
it was simply removed once a newer sibling's own milestone terminated
it. Its letter freed up, and a wholly unrelated fresh `TZ GREEN(E)`
reused the same letter in 2022. Matching a WTF TZ BUY 2 instance's own
end purely by scanning for `TZ BUY 2 SL(E)` / `TZ BUY SL(E)` /
`BAR SL2(E.*)` in the visible event text therefore found nothing for
the *real* 2014 instance and kept searching straight through the
unrelated 2022+ branch's own entire history — surfacing as a nonsensical
11-year gap between the 2014 WTF formation and an "entry" that actually
belonged to the later, unrelated branch.

**Fix**: every WTF TZ BUY 2 instance is now tracked by the engine's own
internal branch id (`pid`), never by its display letter alone — a
letter is only resolved from a `pid` at the point of use, valid only
while that specific branch is still the one holding it. The search for
an instance's own end still looks for the practical exit event first
(whichever of `BAR SL2` / `TZ BUY 2 SL` / `TZ BUY SL` fires first, per
the Exit section above — none of these necessarily wipe `tz_buy2` to
`None` by themselves), but **never searches past the point that specific
pid's own `tz_buy2` state actually disappears** (wiped to `None`, or the
whole branch dies) — labelled `collaterally terminated (no explicit SL
event)` when that's what ends it with no explicit exit event ever
firing.

**Verification**: `test_prime_trend_smoke.py` now locks in both
ADANIENT.NS (unaffected by this bug — re-confirmed unchanged) and
ICICIBANK.NS (10 confirmed instances, all now landing on sane, bounded
entry/exit windows) exactly.

## Downstream fix: a core TZ ENGINE bug changed one ICICIBANK.NS instance (2014 window)

Separately from the letter-recycling bug above, a genuine bug was found
and fixed in the underlying `tz_engine_wtf.py` engine itself — see
`WTF_RULEBOOK.md`, "the '1' tiers' own post-SL reactivation reference
must also keep climbing on intervening highs." TZ BUY's own (and REAR's
own, and REAR RE-ENTER's own) post-SL reactivation reference was a
one-time frozen snapshot instead of a live, quietly-climbing reference
like every analogous case elsewhere in the file — found by the user
hand-tracing ICICIBANK.NS branch E's real numbers (219.38 → 223.64 →
225.73) against a `TZ BUY(E)` the engine wrongly confirmed on
2014-03-10.

Because PRIME TREND is built directly on top of the WTF TZ BUY 2 layer,
fixing that engine bug changes the underlying WTF trace, which in turn
changes which WTF TZ BUY 2 formation feeds PRIME TREND for that window.
Before the fix, the table below listed a `2014-03-24(E)` WTF formation
(itself downstream of the buggy `TZ BUY(E)`) entering DTF at
2014-05-12 @ 253.09 and exiting `DTF TZ BUY ENTRY SL` on 2014-07-11 @
247.30 (highest high 289.67, 2014-05-16). With the engine fixed, that
spurious `2014-03-24(E)` formation no longer occurs; the real
cross-timeframe instance for that window is `2014-05-05(D)`, entering
DTF at 2014-05-16 @ 259.84 and exiting `DTF TZ BUY ENTRY SL` on
2014-06-20 @ 254.05 (highest high 274.85, 2014-06-09). Every other
ICICIBANK.NS instance, and all four ADANIENT.NS instances, are
unaffected. `test_prime_trend_smoke.py` has been updated to lock in the
corrected value.

## Open items

- Implemented in Python (`prime_trend.py`). The multi-cycle-row fix, the
  combined DTF/WTF exit label, and the REAR 2 / REAR RE-ENTER 2 anchor
  extension (all above) are applied and verified against real
  ICICIBANK.NS WTF+DTF data (22 rows across 11 TZ BUY 2 instances; no
  REAR 2 / REAR RE-ENTER 2 instances occur in that stock's real history
  once the underlying engine fixes are applied — the extension's wiring
  was separately confirmed against the proven synthetic REAR 2 fixture in
  `test_wtf_smoke.py`, Test 13). **`test_prime_trend_smoke.py`'s expected
  values are now stale** (written for the pre-correction shape) and need
  regenerating against both ADANIENT.NS (blocked by this session's
  standing restriction) and ICICIBANK.NS. Not yet ported to
  TypeScript/`main`, not yet wired into any UI in the live app.
- The "BAR ENTRY" side of the original cross-time-frame table (WTF
  BAR → DTF TZ BUY/TZ BUY ENTRY or BAR/BAR ENTRY, disambiguated by
  whether a BAR has ever formed for that lineage) has not been worked
  through to this same depth yet — see `WTF_RULEBOOK.md`'s
  "Cross-time-frame follow-up actions" section for what's specified
  there so far.
- Only verified against two scrips so far (ADANIENT.NS, ICICIBANK.NS).
