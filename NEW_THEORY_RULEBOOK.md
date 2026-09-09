# New Theory — TZ GREEN → TZ BUY → BAR (unlimited) → REAR cascade

**Status:** provisional design + first-pass implementation (`tz_engine_new_theory.py`).
**Not yet verified against real OHLC data** — no dataset has been supplied for this
theory (03/2021–08/2026 was mentioned but never attached). Nothing below has been
checked against real numbers; treat every mechanic as a hypothesis until it's run
against real data and confirmed, per this project's standing discipline (never
guess past a flagged date, re-verify after every fix).

This is a separate, from-scratch theory. It does **not** touch, extend, or depend
on `tz_engine_v9.py`, `tz_engine_bar2_variant.py`, or the DTF/WTF variant — those
are unrelated, already-built work on `claude/rulebook-logic-interpretation-g3z130`.

## Rules, as given (verbatim intent)

1. TZ GREEN — Low ≥ PrevLow, High > PrevHigh by ≥0.20, Close ≥ PrevHigh, subject to
   the branch-spawn eligibility rule (below).
2. TZ GREEN 2 — same shape as BAR 2 (the template): Low ≥ PrevLow, High > TZ GREEN's
   ref high by ≥0.20, Close ≥ that ref high, only while TZ GREEN itself is pre-SL.
3. RED1 — unchanged shape, attaches to TZ GREEN 2 once it exists.
4. RED2 — unchanged shape, deepens RED1.
5. TZ BUY — forms above TZ GREEN 2's reference high (not TZ GREEN's), once RED2 has
   fired against TZ GREEN 2.
6. TZ BUY 2 — same BAR-2 shape, forms above TZ BUY's own reference high.
7. BAR — forms above TZ BUY 2's reference high, and behaves structurally like TZ BUY
   (not the original plain-PrevHigh-breakout BAR). Only occurs if TZ BUY is still
   active **and** RED2 has fired against TZ BUY 2.
8. BAR 2 — standard BAR-2 shape, forms above BAR's own reference high.
9. BAR / BAR 2 are unlimited: BAR(n) → BAR 2(n) → RED1 → RED2 → BAR(n+1) → BAR 2(n+1)
   → … indefinitely, until a BAR SL2 fires.
10. REAR — forms above BAR 2's reference high, once a BAR SL2 fires.
11. REAR 2 — same BAR-2 shape, forms above REAR's own reference high.

Flow, as given:

```
TZ GREEN - TZ GREEN 2 - RED 1 - RED 2 - TZ BUY - TZ BUY 2 - RED 1 - RED 2 -
BAR - BAR 2 - RED 1 - RED 2 - BAR - BAR 2 - RED 1 - RED 2 /
BAR SL - BAR SL2 - TZ GREEN (NEW CYCLE) / REAR ABOVE THE BAR 2 HH
```

## Open questions — resolutions adopted for this first pass

Each is a judgment call, not a verified fact. Flagged `ASSUMPTION` in the code at
the relevant site; revisit as soon as real data disagrees.

**1. Is "TZ GREEN (NEW CYCLE)" a parallel branch, or an alternative to REAR?**
Adopted: **parallel, independent branch** — not an alternative to REAR. Rule 10
states REAR forms "once BAR SL2 triggers," unconditionally, with no dead-end
caveat, so REAR is the standing outcome of every BAR SL2. A fresh TZ GREEN can
spawn independently, at any point, once this cycle's own RED1-against-GREEN-2 has
fired (see the branch-spawn rule below) — mirroring the base engine's §8 sibling-
spawn rule, and the "TZ GREEN new lineage not reaching TZ BUY" idea from the
BAR2-variant discussion. The diagram places it next to `BAR SL2` only because
that's typically when the original cycle stops being "live" and a sibling becomes
spawn-eligible, not because it's gated on SL2 specifically.

**2. Does LL ever get suppressed once a tier's "2" forms?**
Adopted: **no, never** — mirrors the real bug already found and fixed in the
committed BAR2 variant (BAR's own LL was wrongly bundled with HH and dropped;
only HH should be suppressed). Every tier's LL always displays; only HH is
suppressed once that tier's own "2" exists.

**3. Does RED1 require the matching "2" to already exist before attaching?**
Adopted: **yes, uniformly** — generalizing rule 7's explicit statement for BAR
("BAR only occurs if TZ BUY is still active AND RED2 has occurred after TZ BUY 2")
to every tier: RED1/RED2 attach to a tier's own "2" once it exists, and the *next*
tier only forms after RED2 has fired against the current tier's "2". This also
means the base engine's standalone one-time "RED" (before RED1) does not exist
separately in this theory — TZ GREEN 2 is followed directly by RED1 (no separate
plain "RED" step), consistent with the flow diagram, which never shows a bare RED.

**4. Is failure at the TZ GREEN or TZ BUY tier terminal (no reactivation)?**
Adopted: **yes, terminal, cycle-wide.** Only BAR/BAR 2 are explicitly called
"unlimited" — TZ GREEN and TZ BUY are one-shot gates into that cascade. TZ GREEN's
own SL is checked every candle, unconditionally, and terminates the entire cycle
(TZ GREEN 2, TZ BUY, TZ BUY 2, every BAR generation, REAR) permanently — mirroring
the base engine's TZ GREEN SL cascade. TZ BUY's own SL is terminal for TZ BUY
itself (no "NEW TZ BUY" retry mechanic — not mentioned in this theory) but does
**not** retroactively kill BAR generations already in progress (mirrors the base
engine's "TZ BUY SL doesn't stop the BAR family below it"); it does stop **new**
BAR generations from forming afterward, per rule 7's explicit "TZ BUY still
active" gate on BAR formation.

**5. Do TZ GREEN 2 / TZ BUY 2 mirror BAR 2's own SL/recovery exactly?**
Adopted: **yes** — every "2" tier (TZ GREEN 2, TZ BUY 2, BAR 2, REAR 2) uses the
identical single-tier SL/recovery cycle: SL fires on a ≥0.20 breach with no
reclaim; recovery (same label) fires when price clears the SL's own ref high by
≥0.20 with Close holding. No escalation to a "2 SL2" at any tier.

## Branch-spawn eligibility (new cycle)

Mirrors the base engine's §8 rule, adapted for the absence of a standalone "RED":
a fresh TZ GREEN (NEW CYCLE) may spawn on a qualifying breakout candle whenever
the anchor cycle's own RED1-against-TZ-GREEN-2 has fired at least once, and that
cycle's TZ BUY is either nonexistent, dead (its own SL fired), or every BAR
generation it ever produced has reached BAR SL2 and none is currently live — or
no cycle exists yet at all.

## BAR's own SL/SL2 vs. BAR 2's SL — two separate mechanisms

- **BAR's own SL/SL2** (two-tier, mirrors the base engine exactly): gated on that
  generation's BAR 2 having formed at all (a BAR SL with no BAR 2 ever formed is a
  permanent dead end for that generation — no SL/SL2 tracking, only a fresh BAR
  generation elsewhere or the top-level TZ BUY SL can follow, per the already-
  committed BAR2-variant rule). BAR SL2 is the trigger for REAR (rule 10).
- **BAR 2's own SL/recovery** (single-tier, rule 5 above): independent of BAR's
  own SL/SL2; does not persist through BAR-level reactivation — a reactivated
  BAR(n) needs a brand new BAR 2 from scratch (mirrors the committed variant).

## Testing so far

`test_new_theory_smoke.py` walks one hand-constructed, synthetic OHLC sequence
through the entire escalation once (TZ GREEN → … → REAR 2 → REAR SL → an
independent sibling TZ GREEN spawn) and asserts every milestone event fires.
This only proves the state machine's plumbing is internally consistent on
data built to exercise it — it is **not** a substitute for verification
against real OHLC, which this theory has never had. Run `python3
test_new_theory_smoke.py`.

## Not yet modeled (deliberate simplification, first pass)

- No cross-cycle leadership/dormancy contest (base engine §7a) — every spawned
  cycle tracks and displays independently. The new theory only mentions the single
  linear escalation plus one independent-sibling-spawn concept; nothing in the
  rules as given calls for multi-branch dormancy suppression. Revisit if real data
  produces overlapping cycles that need arbitration.
- No cross-generation reference pool (`bar_high_pool` equivalent) — REAR's
  reference at SL2 is exactly BAR 2(n)'s own reference for the generation that
  reached SL2 (rule 10), not a pool across earlier generations, since generations
  here are strictly sequential (RED2-driven), not multi-lineage racing.
