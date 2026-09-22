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

**Status**: specification only, worked out by hand against real
ADANIENT.NS data (separate WTF weekly and DTF daily CSVs for the same
scrip). Not implemented in `TZEngine`/`tz_engine_wtf.py` — computed by a
separate manual/external analysis script that reads both timeframes' own
OHLC and, for WTF, an already-computed `TZEngine` event trace. Future
theories may reuse pieces of TZ BUY's or PRIME TREND's own mechanics as
a starting point, but each is tracked as its own theory going forward,
not folded into one another.

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

## Anchor: WTF TZ BUY 2's own *live* reference high

The starting anchor for a given WTF TZ BUY 2 instance is that tier's own
reference high — but it is **not frozen at formation**. WTF TZ BUY 2
keeps climbing via its own ordinary `TZ BUY 2 HH(` tracking for as long
as it stays alive, and PRIME TREND must anchor against whatever that
reference currently stands at, not its value on the day WTF TZ BUY 2
first formed (confirmed bug, ADANIENT.NS branch C: using the frozen
formation value of 54.50 wrongly let a DTF candle "clear" an anchor that
had already climbed to 56.23 by the time that candle occurred).

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

A WTF TZ BUY 2 instance only produces a usable PRIME TREND trade if
Stage 2 (DTF TZ BUY ENTRY) actually confirms before that WTF TZ BUY 2
itself fails. If Stage 1 never forms, or forms but never escalates to
Stage 2, before the WTF-side failure, there is no trade for that
instance — it is excluded, not reported with a placeholder price.

## Exit

Whichever of the following fires first after the (latest, still-live)
entry, forgetting any earlier entry/exit pair the moment something
reactivates before it would have counted as final:

- **WTF-side**: `BAR SL2` (exit price = that WTF week's own Close), or
  `TZ BUY 2 SL` / `TZ BUY SL` (exit price = WTF TZ BUY 2's own reference
  low — `TZ BUY SL` counts as a valid exit type here too, since it wipes
  TZ BUY 2 exactly the same way TZ BUY 2's own SL does).
- **DTF-side**: Stage 1's own `TZ BUY SL` or Stage 2's own `TZ BUY ENTRY
  SL`, with no reactivation before the WTF-side event above fires (exit
  price = that stage's own reference low at the moment of SL).

If a DTF-side SL reactivates before the window closes (whether via Stage
1 or Stage 2 recovering), the entry/exit pair it would have closed is
discarded entirely and superseded by whatever the newest live entry
turns out to be.

## Highest High

Maximum daily High strictly *after* the (final) entry date, up to and
including the exit date — never the entry candle's own High.

## Worked results, ADANIENT.NS (all 6 WTF TZ BUY 2 dates checked)

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

## Open items

- Not implemented in `TZEngine`/`tz_engine_wtf.py` — currently a manual
  analysis script only.
- The "BAR ENTRY" side of the original cross-time-frame table (WTF
  BAR → DTF TZ BUY/TZ BUY ENTRY or BAR/BAR ENTRY, disambiguated by
  whether a BAR has ever formed for that lineage) has not been worked
  through to this same depth yet — see `WTF_RULEBOOK.md`'s
  "Cross-time-frame follow-up actions" section for what's specified
  there so far.
- Only verified against one scrip (ADANIENT.NS) and one sibling branch's
  worth of WTF TZ BUY 2 instances so far.
