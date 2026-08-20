# BAR Rule — House of Bull / House of Bear Reference

**Purpose:** This is a variant rule set for the TZ engine, built on top of the same OHLC state-machine primitives as the original 37-event rule book (`TZ_ENGINE_RULEBOOK_REFERENCE.md`), but with a different structure hierarchy and an added dual-trend ("house") mechanic. Everything not explicitly overridden below inherits from the original rule book: `THRESH = 0.20` (main qualifying threshold), `ANY = 0.01` (minimum move for pre-RED-family HH qualification), and the general RED1/RED2 shared mechanic (§3 of the original).

**Status:** Spec complete per conversation with the user (2026-08-20). Not yet implemented in code. Case studies to follow for cross-verification before/during implementation.

---

## 0. Structure hierarchy (BAR rule, House of Bull)

```
TZ GREEN → TZ GREEN 2 → RED1 → RED2 → [ BAR → BAR 2 ] ↻ (repeating engine)
                                            ↑
                              REAR / REAR RE-ENTER re-enter this same engine
                              as one-time recovery labels (see §9–§10)
```

There is **no branch spawning and no branch-level dormancy** (original §7a/§8 removed entirely) — only one TZ GREEN lineage ever exists per cycle; no sibling branches.

---

## 1. TZ GREEN(n) — unchanged from the original rule book

- Formation: Low ≥ PrevLow, High > PrevHigh by ≥ 0.20, Close ≥ PrevHigh.
- HH: before RED, any higher High ≥ 0.01 qualifies. After RED, weak rule — qualifies if (diff < 0.20) OR (Low < PrevLow) OR (Close < ref_high_at_red).
- LL: gap ≥ 0.20 AND Close doesn't reclaim → new LL; gap < 0.20 → also just an LL update.
- SL ("INVALID TZ GREEN"): Low breaks ref_low by ≥ 0.20, Close doesn't reclaim → terminates the entire cycle permanently. Checked first every candle, returns immediately. HH suppressed on its own SL day (same as original).
- RED(n) itself does not exist in this chain (see §2) — replaced by RED1/RED2 attaching directly after TZ GREEN 2.

## 2. TZ GREEN 2(n) — new

- Formation: current-day High > TZ GREEN's reference High by ≥ 0.20, current-day Low ≥ PrevLow, current-day Close ≥ TZ GREEN's reference High.
- **No HH/LL tracked at all.**
- **Gates RED1**: RED1 cannot attach until TZ GREEN 2 has formed (mirrors the original book's "RED1 needs something live to attach to").
- **No soft/close-based invalidation**: a Close below TZ GREEN 2's reference during RED1/RED2 formation does not end the cycle. The cycle stays active regardless of whether RED1/RED2 has fired. Only TZ GREEN's own SL (§1) can terminate everything.

## 3. RED1(n) / RED2(n) — same mechanic as the original book, new gating role

- RED1 attach: High ≤ PrevHigh, Low < PrevLow by ≥ 0.20, Close ≤ PrevLow.
- RED1 HH: further High within the pullback, any amount above `red1.ref_high`.
- RED1 LL: Low breaks `red1.ref_low` but the full RED2 conjunction doesn't hold.
- RED2: Low breaks `red1.ref_low` AND High ≤ PrevDayHigh AND gap ≥ 0.20 AND Close ≤ `red1.ref_low + eps`.
- INVALID RED1: High clears `red1.ref_high` by ≥ 0.20, Close holds above → `red1.active = False`.
- **SL always beats RED1/RED2** — checked first every candle.
- RED1 only ever attaches once the current generation's own "...2" object exists: TZ GREEN 2 the first time; BAR 2 / REAR 2 / REAR RE-ENTER 2 on every subsequent generation.
- RED2 firing is what enables the next generation of BAR to form (see §4, §8).

## 4. BAR(n) — formation

- Forms via the original book's **mechanism 1 only**: `bar_pending` (set by RED2) consumed by a general breakout — Low ≥ PrevLow, High > PrevHigh by ≥ 0.20, Close ≥ PrevHigh.
- **No mechanism 2** (no lineage branching directly off another lineage's SL range while both coexist as in the original book) — this concept doesn't apply here; multi-generation coexistence in this rule set works differently (see §8).

## 5. BAR 2(n)

- Formation: current-day High > BAR's reference High by ≥ 0.20, Low ≥ PrevLow, Close ≥ BAR's reference High.
- **HH/LL are recorded** (unlike TZ GREEN 2 — this is the key difference between the two "…2" objects).
- Gates the next RED1 attach, same role TZ GREEN 2 played for the first RED1.

## 6. BAR SL(n) / (no BAR 2 SL2)

- BAR SL: Low breaks BAR(n)'s ref_low by ≥ 0.20, Close doesn't reclaim.
- BAR SL HH/LL are tracked, same role as the original book's §4 — feeds the INVALID BAR SL / REAR reference computation whenever BAR SL's own HH is higher than BAR's own HH.
- **There is no "BAR 2 SL2" concept.**

## 7. BAR 2 SL recovery — two mutually exclusive paths

1. **"NEW BAR 2"**: if BAR 2(n) hits its SL and RED1→RED2 has **not** fired yet, a fresh NEW BAR 2 can form above BAR 2(n)'s own (pre-SL) reference high — **only while BAR(n) itself is still un-SL'd**. Same Close/Low shape as every other buy condition: High & Close compared to the reference High, Low compared to PrevLow.
2. **RED2 forecloses that path permanently**, whenever it fires (before, on, or after the BAR 2 SL): "NEW BAR 2" becomes unavailable for that generation. The only way forward is a full next generation — BAR(N+1) → BAR 2(N+1). The earlier BAR(n)/BAR 2(n) goes **dormant** (not terminated) until BAR 2(N+1) validly confirms — kept alive because its HH still feeds REAR's reference.

## 8. BAR(N+1) — two independent triggers, and BAR(n)'s fate

**Triggers for a new BAR(N+1) lineage:**
- **(A) RED1 → RED2 path** — gated by BAR 2(n) having already formed (§3).
- **(B) BAR SL(n) recovery path** — a fresh qualifying breakout off BAR SL(n)'s own reference forms BAR(N+1) as a separate lineage, independent of RED1/RED2, and independent of whether INVALID BAR SL(n) has fired yet (can happen before or after it).

**BAR(n)'s fate once BAR(N+1) exists:**
- If BAR(n) never reached its own SL: it stays active/racing until **BAR 2(N+1) validly confirms** — the only thing that terminates it.
- If BAR(n) already has a BAR SL: it stays active/racing (own SL2 still possible, BAR SL HH/LL still tracked) until the **earlier of** INVALID BAR SL(n) firing or BAR 2(N+1) validly confirming.
- If neither has happened yet, BAR(n) simply keeps racing in parallel with the new generation — its own SL2 can still fire independently.

**Worked cases (all confirmed):**
- Case 1 (no BAR SL(n) at all): `BAR(n) - BAR2(n) - RED1 - RED2 - BAR(n+1) - BAR2(n+1)` — BAR(n) terminates only after BAR 2(n+1) validly confirms.
- Case 2 (BAR SL(n) exists, INVALID BAR SL(n) still pending): `BAR(n) - BAR2(n) - BARSL(n) - BAR(n+1) - BAR2(n+1) - RED1 + BARSL2(n)` — BAR(n) remains active/not terminated the whole time; its own SL2 can still fire independently of what's happening at n+1.
- Case 3A: `... - BAR(n+1) - BAR2(n+1) + INVALID BARSL(n)` → BAR(n) terminates when INVALID BAR SL(n) fires on/after BAR2(n+1) confirming.
- Case 3B: `... - BAR(n+1) + INVALID BARSL(n) - BAR2(n+1)` → BAR(n) terminates when INVALID BAR SL(n) fires before BAR2(n+1) confirms.
- Rule: **BAR(n) terminates at the earlier of INVALID BAR SL(n) firing, or BAR 2(N+1) validly confirming.** If BAR(n) never had an SL, only the BAR 2(n+1)-confirms trigger applies.

## 9. BAR SL2(n) → REAR(n) / REAR 2(n)

- BAR SL2: Low breaks BAR SL(n)'s ref_low further (or latest SL LL) by ≥ 0.20, Close doesn't reclaim — permanent terminal failure of that BAR lineage generation.
- **REAR(n)** — a **one-time recovery label**, not an ongoing family with its own RED1→RED2→REAR(N+1) engine. Forms above **BAR 2(n)'s** reference high, as the recovery immediately following that BAR SL2.
- **REAR 2(n)** — same X→X2 pattern as BAR→BAR2, HH/LL recorded (like BAR 2).
- **RED1→RED2 after REAR 2(n)** attaches the same way as after BAR 2 — but firing RED2 produces a **plain fresh BAR → BAR 2** cycle (not "REAR(N+1)"). The REAR label is spent after this point; the engine reverts to ordinary BAR/BAR 2/RED1/RED2 naming going forward.
- REAR SL: only SL, **no SL2** at the REAR level (matches the original book).

## 10. REAR RE-ENTER(n) / REAR RE-ENTER 2(n)

- **REAR RE-ENTER(n)** — a one-time recovery label, forms above REAR('s / REAR 2's) reference high, once REAR's own SL has occurred.
- **REAR RE-ENTER 2(n)** — same pattern, HH/LL recorded.
- **RED1→RED2 after REAR RE-ENTER 2(n)** also just produces a plain fresh **BAR → BAR 2** cycle (not "REAR RE-ENTER(N+1)").
- **REAR RE-ENTER's own SL** (if it fires before ever reaching RED1/RED2 via REAR RE-ENTER 2): price recovering above REAR RE-ENTER's own reference high **reactivates under the same "REAR RE-ENTER" label again** (not a new/different label, not straight to BAR) — matches the original book's own-SL reactivation behavior (§6).
- Two triggers that both produce a `REAR RE-ENTER` event, same label either way:
  - (A) REAR's own SL occurred → recovery above REAR's reference high.
  - (B) REAR RE-ENTER's own prior SL occurred → recovery above that REAR RE-ENTER's own reference high (reactivation).

## 11. Summary — the repeating generational engine

There is really **one generational engine**: `BAR → BAR 2 → RED1 → RED2 → next BAR`. TZ GREEN/TZ GREEN 2 (the very start of a cycle) and REAR/REAR 2, REAR RE-ENTER/REAR RE-ENTER 2 (one-time recovery labels applied respectively right after a BAR SL2, and right after a REAR SL) are just special entry points into that same engine. Once RED1→RED2 fires from any "…2" object, the result is always a plain BAR → BAR 2 cycle from then on, except for REAR RE-ENTER's own direct SL→reactivation, which keeps its own label.

---

## 12. House of Bull vs. House of Bear

Two full mirror-image structures share the same event vocabulary. Only one house is "active" (live-naming) at a time; the other is tracked in shadow, ready to take over.

**House of Bull** (as built in §1–§11):
```
TZ GREEN → TZ GREEN 2 → RED1 → RED2 → BAR → BAR 2 → RED1 → RED2 → ...
```

**House of Bear** (exact directional mirror — up ↔ down):
```
TZ RED → TZ RED 2 → GREEN1 → GREEN2 → BAR → BAR 2 → GREEN1 → GREEN2 → ...
```

**Naming/condition mapping (House of Bear):**
- `TZ RED` = same condition shape as `RED1` (downside pullback-attach), now serving as the house's own anchor.
- `TZ RED 2` = same condition shape as `RED2`.
- `GREEN1` = same condition shape as `TZ GREEN` (upside breakout), now serving as the pullback-within-a-downtrend structure.
- `GREEN2` = same condition shape as `TZ GREEN 2`.
- `BAR` / `BAR 2` = same condition shape as `TZ RED` / `TZ RED 2` (i.e., downside breakdown continuation) — **the event names `BAR`, `BAR 2`, `REAR`, `REAR RE-ENTER` are reused verbatim in both houses**, deliberately not renamed per house, to avoid multiplying vocabulary. Only the qualifying direction differs depending on which house is currently active.
- Every downstream mechanic built for Bull in §4–§10 (BAR SL/no SL2, NEW-BAR-2-vs-RED2-forecloses-it, BAR(N+1) triggers and BAR(n) termination rules, REAR/REAR RE-ENTER as one-time recovery labels) is inherited **exactly, direction-flipped**, with no Bear-specific exceptions.

## 13. House-switch mechanic

**Shadow tracking:** while House of Bull is active, every RED1→RED2 pullback is *simultaneously* a live candidate `TZ RED`/`TZ RED 2` for a nascent House of Bear — tracked in parallel the whole time, without taking over.

**Bull → Bear switch activates when, in this order:**
1. A BAR/BAR 2 continuation (or a later day within it) **fails to close above the reference High of the RED1 that preceded it**, **and**
2. A **new** RED1 followed by RED2 then occurs.

At that point House of Bear becomes the live/active structure. House of Bull is abandoned — it can only return via a **brand-new TZ GREEN** from scratch, never a continuation of the old lineage.

**Bear → Bull switch (exact symmetric mirror):**
1. A BAR/BAR 2 (downside) continuation fails to close **below the reference Low of the GREEN1 that preceded it**, **and**
2. A **new** GREEN1 followed by GREEN2 then occurs.

House of Bull becomes live; House of Bear is abandoned, only returning via a **brand-new TZ RED**.

**Worked example (Bull → Bear), confirming the naming carries the switch:**
```
TZ GREEN - TZ GREEN 2 - RED1 (≡ TZ RED) - RED2 (≡ TZ RED 2)
  - BAR (≡ GREEN1) - BAR 2 (≡ GREEN2)
  - RED1 (≡ Bear's BAR) - RED2 (≡ Bear's BAR 2)
```
If the BAR/BAR 2 step does not close above the earlier RED1's reference High, and this new RED1→RED2 confirms, House of Bear activates on the RED2 date.

## 14. Output format — House column

A **House** column is added alongside the Event column in the report output. On the exact date a house-switch confirms, the event printed for that date uses the **new** house's naming for that step, not the old house's — e.g., what would have been labeled `RED 2` under Bull's naming instead prints as `BAR 2`, with House = `BEAR` on that row, since that RED2-shaped price action *is* Bear's own BAR 2 step once the switch is confirmed. Every other row's House value reflects whichever house was live/active on that date.

---

## 15. Open items — pending case-study verification

- Full case studies from the user, to be cross-verified against this spec before/during implementation (per the original rule book's own testing discipline, §12: never guess, verify every claim against actual OHLC numbers).
- Whether the $0.20 / $0.01 thresholds need to scale for weekly/monthly/yearly candles remains an open question inherited unchanged from the original rule book (§13).
- Not yet implemented in code (`tz_engine_v9.py` or a new module) — spec-only as of this writing.
