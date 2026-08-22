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

There is really **one generational engine**: `BAR → BAR 2 → RED1 → RED2 → next BAR`. TZ GREEN/TZ GREEN 2 (the very start of a cycle) and REAR/REAR 2, REAR RE-ENTER/REAR RE-ENTER 2 (one-time recovery labels applied respectively right after a BAR SL2, and right after a REAR SL) are just special entry points into that same engine. Once RED1→RED2 fires from any "…2" object, the result is always a plain BAR → BAR 2 cycle from then on, except for REAR RE-ENTER's own direct SL→reactivation, which keeps its own label. (§1–§11 describe this engine as it runs under House of Bull, where the generational label is `BAR`/`BAR 2`; §12 defines House of Bear's mirror, where the same engine's label is `SAR`/`SAR 2` instead — see §12's mapping note.)

---

## 12. House of Bull vs. House of Bear

Two full mirror-image structures, mostly sharing the same event vocabulary (the one deliberate exception: House of Bull's generational label is `BAR`/`BAR 2`, House of Bear's is `SAR`/`SAR 2` — see the mapping below). Both houses' engines always run and always log (§13) — "active" means whichever house's own chain currently reaches furthest, not that the other stops being tracked.

**House of Bull** (as built in §1–§11):
```
TZ GREEN → TZ GREEN 2 → RED1 → RED2 → BAR → BAR 2 → RED1 → RED2 → ...
```

**House of Bear** (exact directional mirror — up ↔ down):
```
TZ RED → TZ RED 2 → GREEN1 → GREEN2 → SAR → SAR 2 → GREEN1 → GREEN2 → ...
```

**Naming/condition mapping (House of Bear):**
- `TZ RED` = same condition shape as `RED1` (downside pullback-attach), now serving as the house's own anchor.
- `TZ RED 2` = same condition shape as `RED2`.
- `GREEN1` = same condition shape as `TZ GREEN` (upside breakout), now serving as the pullback-within-a-downtrend structure.
- `GREEN2` = same condition shape as `TZ GREEN 2`.
- **`SAR` / `SAR 2`** = House of Bear's own name for the generational-engine label that House of Bull calls `BAR` / `BAR 2` — same condition shape as `TZ RED` / `TZ RED 2` (i.e., downside breakdown continuation). **`BAR`/`BAR 2` is Bull-only naming; `SAR`/`SAR 2` is the Bear equivalent** — this is the one deliberate naming difference between the houses. `REAR` and `REAR RE-ENTER` are still reused verbatim in both houses (not renamed).
- Every downstream mechanic built for Bull in §4–§10 under the name `BAR`/`BAR 2` (BAR SL/no SL2, NEW-BAR-2-vs-RED2-forecloses-it, BAR(N+1) triggers and BAR(n) termination rules) applies **exactly, direction-flipped, to `SAR`/`SAR 2`** in House of Bear — read every `BAR`/`BAR 2`/`BAR SL`/`BAR SL2`/`NEW BAR 2` in §4–§10 as `SAR`/`SAR 2`/`SAR SL`/`SAR SL2`/`NEW SAR 2` when applying those rules under House of Bear. `REAR`/`REAR RE-ENTER` (§9–§10) still form off `SAR 2`'s own SL2 and keep their own names unchanged in both houses; when RED1→RED2 (i.e., GREEN1→GREEN2 under Bear — see below) fires after `REAR 2` or `REAR RE-ENTER 2` under an active House of Bear, the resulting plain fresh cycle is `SAR → SAR 2`, not `BAR → BAR 2`.

## 13. House-switch mechanic

**Both houses' full engines run continuously and independently off raw price, from day 1, forever — neither is ever dormant, and both are logged every time either fires an event.** "Active" simply means whichever house's own chain reaches further/triggers first; that does not stop the other house's engine from computing and logging.

**Which house is active initially:** determined purely by whichever chain (TZ GREEN's or TZ RED's own independent anchor search) completes its own sequence through to a `BAR` first. Both can — and typically do — produce events on the very same early dates before this is settled (see the case-study table in §16).

**The repeating rebirth/termination cycle** (this is the actual mechanism behind the switch, not a one-shot check):
- Every time the *active* house produces a fresh pullback (RED1→RED2 for an active House of Bull; GREEN1→GREEN2 for an active House of Bear), that identical price action *simultaneously* forms a fresh anchor pair for the *non-active* house (`TZ RED`/`TZ RED 2`, or `TZ GREEN`/`TZ GREEN 2`, respectively) — logged under both houses the same day.
- If the active house's *next* continuation (`BAR`/`BAR 2`) then closes decisively past that fresh non-active anchor's reference (above it for a TZ RED anchor being cleared by an upside BAR; below it for a TZ GREEN anchor being cleared by a downside BAR), the non-active anchor is **terminated** right there.
- The very next time the active house produces another fresh pullback, the non-active anchor is **reborn** from scratch, and the cycle repeats.
- The **switch fires** the first time this cycle breaks the other way: the active house's continuation (`BAR`/`BAR 2` for Bull, `SAR`/`SAR 2` for Bear) **fails** to clear the live non-active anchor's reference, **and** the active house's *next* pullback (RED1→RED2 / GREEN1→GREEN2) then confirms. At that exact point the non-active house takes over as active — and that confirming pullback is relabeled under the *new* active house's own naming, continuing its chain from wherever it structurally already sits (anchor + "…2" already existed from the last rebirth; the just-completed continuation of the old active house becomes `GREEN1`/`GREEN2` — or `RED1`/`RED2` — of the newly active house; this newly confirming pullback becomes the newly active house's own `BAR`/`BAR 2` if Bull, or `SAR`/`SAR 2` if Bear).

**Worked trace (confirmed), Bull active initially, two rebirth cycles before the switch:**
```
TZ GREEN - TZ GREEN 2 - RED1 - RED2 - BAR                [Bull's own chain, reaches BAR first -> Bull active]
              (RED1/RED2 simultaneously = TZ RED/TZ RED2 for Bear)
           BAR closes above TZ RED's reference high      -> Bear's TZ RED terminated (cycle 1 ends)

... BAR 2 ...
new RED1 - RED2                                          (simultaneously = fresh TZ RED/TZ RED2 for Bear, reborn)
BAR - BAR 2                                               (simultaneously = GREEN1/GREEN2 for Bear)
           BAR/BAR 2 does NOT close above TZ RED's ref high -> Bear's TZ RED SURVIVES (cycle 2 does not terminate)
new RED1 - RED2                                          -> this RED1/RED2 IS Bear's own SAR/SAR 2
                                                              => SWITCH: House of Bear becomes active here
```

**Bear → Bull switch is the exact symmetric mirror**, using GREEN1/GREEN2 pullbacks, downside BAR/BAR 2 continuations, and TZ GREEN/TZ GREEN 2 as the reborn/terminated non-active anchor.

**After a switch — reclaiming active status is different from mere tracking.** The house that just lost active status does **not** stop being tracked or logged (§13 above already establishes both houses always run). But to become the *active* house again — not just to keep producing shadow-tracked anchor events — that house must complete a **brand-new anchor from scratch** (a fresh `TZ GREEN` for Bull, a fresh `TZ RED` for Bear), not a continuation of its old pre-switch lineage. Its old lineage's remaining structures (BAR SL2/REAR/REAR RE-ENTER chains, etc.) can still fire and still get logged under that house's label — they just don't carry it back to "active" status on their own.

## 14. Output format — House column

A **House** column is added alongside the Event column in the report output.

- Every date lists **every** house whose engine produced an event that day — `BULL`, `BEAR`, or `BULL + BEAR` — with the corresponding event(s) listed side by side (e.g., `RED1 + TZ RED`, `BAR SL + GREEN1 SL`, `BAR + TZ RED`).
- On the exact date a house-switch confirms, the event printed for that date uses the **new** house's naming for that step, not the old house's — e.g., what would have been labeled `RED 2` under Bull's naming instead prints as `SAR 2`, with House = `BEAR` on that row, since that RED2-shaped price action *is* Bear's own SAR 2 step once the switch is confirmed (and symmetrically, a switch into Bull prints `BAR 2` where Bear's naming would have said `SAR 2`).
- This is a continuous, permanent feature of the output, not just a start-of-dataset phenomenon — both houses' events keep appearing side-by-side for the life of the dataset, per §13's repeating rebirth/termination cycle, not only before the first switch ever happens.

## 15. Worked case-study table (from the user, confirmed correct)

```
DATE      HOUSE OF     EVENT
01/01     BULL         TZ GREEN
02/01     BEAR         TZ RED
03/01     BULL + BEAR  TZ GREEN 2 + TZ RED SL
05/01     BULL + BEAR  RED 1 + TZ RED
07/01     BULL + BEAR  RED 2 + TZ RED 2
09/01     BULL + BEAR  BAR + TZ RED HH + GREEN 1
11/01     BULL + BEAR  BAR SL + GREEN 1 SL
12/01     BULL + BEAR  BAR + GREEN 1
15/01     BULL + BEAR  BAR 2 + GREEN 2
              (GREEN 2 may not appear this same day, or may appear a day or two later,
               if BAR 2 closes above TZ RED's HH reference — see §13's rebirth/termination cycle)
```
Note: row 03/01 lists `BULL + BEAR` — TZ RED SL is still a House-of-Bear event and must be tagged as such even though Bear has no further live structure that day; a house tag is never dropped just because that house's structure terminated on the same date.

---

## 16. Open items — pending case-study verification

- Further case studies from the user, to be cross-verified against this spec before/during implementation (per the original rule book's own testing discipline, §12: never guess, verify every claim against actual OHLC numbers).
- Whether the $0.20 / $0.01 thresholds need to scale for weekly/monthly/yearly candles remains an open question inherited unchanged from the original rule book (§13).
- Not yet implemented in code (`tz_engine_v9.py` or a new module) — spec-only as of this writing.
