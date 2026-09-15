# WTF — the TZ ENGINE itself, extended with TZ BUY 2 / BAR 2 / REAR 2 / REAR RE-ENTER 2

**Status:** TZ BUY 2 is a new, provisional layer — **not yet verified against
real OHLC data**. Everything at BAR 2 / REAR 2 / REAR RE-ENTER 2 and below
carries over its original real-data validation from `tz_engine_bar2_variant.py`
(verified end-to-end against 01-01-2020 through 08-08-2020) unchanged — this
file only adds a new tier one level above what that file already proved.

This is the **final, consolidated** design — it supersedes an earlier draft
of this file that got two things wrong (corrected via a second round of
explicit user review against a competing draft that surfaced from a parallel
conversation): TZ BUY's own retry mechanic, and whether TZ BUY 2 counts as a
leadership-contest milestone. Both are settled below.

## What WTF is, and how it relates to the other two files in this repo

Per the user's framing: this project develops three theories —
**A) WTF** (the TZ ENGINE itself — the theory this file covers),
**B) DTF with respect to WTF**, **C) DTF** — with WTF the current focus.
WTF is **not** the from-scratch `tz_engine_new_theory.py` theory on this same
branch (a separate, independent hypothesis with its own TZ BUY→BAR structure
that predates TZ BUY 2 entirely) — it is the real TZ ENGINE
(`tz_engine_v9.py`, the validated 37-event base) extended in place with a
"2"-tier confirmation gate at TZ BUY, in addition to the "2" tiers BAR/REAR/
REAR RE-ENTER already have in `tz_engine_bar2_variant.py`.

`tz_engine_wtf.py` was built by copying `tz_engine_bar2_variant.py` (already
has BAR 2/REAR 2/REAR RE-ENTER 2, real-data-validated) and adding TZ BUY 2 on
top, following the exact same "2"-tier pattern, rather than re-deriving that
already-solved layer from the un-extended base engine. A hint that other,
parallel work exists on the same idea: an uploaded copy of
`tz_engine_bar2_variant.py` was found to already carry its own, different TZ
BUY 2 implementation (field `tz_buy2`, method `_eval_tzbuy2`, an
`extra_reentry_floor` hook explicitly commented as being for "Rule B's own
BAR 2"). This file's naming was aligned to match it (`tz_buy2`/`_eval_tzbuy2`)
to reduce friction whenever the DTF-with-respect-to-WTF hooks are wired in
later — but the *rules themselves* were decided in this conversation and
confirmed point-by-point (below), not copied wholesale from that file, which
disagreed with the user's explicit instructions on two points.

## The flow

```
TZ GREEN → RED → TZ BUY (above TZ GREEN's own ref) →
TZ BUY 2 (above TZ BUY's own ref) →
RED1 → RED2 (vs TZ BUY — NOT reachable until TZ BUY 2 has formed) →
BAR(1) → BAR 2(1) → RED1 → RED2 → BAR(2) → BAR 2(2) → ... (unlimited) →
BAR SL → BAR SL2 (only reachable once BAR 2 has formed) →
REAR → REAR 2 → RED1 → RED2 → BAR(1) (fresh cascade, REAR 2's own dual role) →
REAR SL (only reachable once REAR 2 has formed) →
REAR RE-ENTER → REAR RE-ENTER 2 → RED1 → RED2 → BAR(1) (fresh cascade) →
REAR RE-ENTER SL (only reachable once REAR RE-ENTER 2 has formed) →
REAR RE-ENTER (self-recovers, same event text, terminal)
```

TZ BUY's own top-level SL is never a dead end, unlike BAR/REAR/REAR
RE-ENTER's own SL (permanent dead ends when their "2" never formed) — it
always reactivates. This mirrors BAR's own already-existing "reactivate in
place under the same label" behavior (BAR's own SL, with BAR 2 existing, can
reactivate via INVALID BAR SL under the *same* `"BAR(label)"` text — this
isn't new, it's the pattern TZ BUY's retry was corrected to match).

## Rules, as given by the user (final, confirmed answers)

**A. Retry after TZ BUY's own SL — no "NEW TZ BUY."** TZ BUY reactivates IN
PLACE: same `Buy` object, same `"TZ BUY(label)"` event text, whether or not
TZ BUY 2 ever formed. There is no "NEW TZ BUY" distinction anywhere in this
file anymore (dropped entirely, including from `MILESTONE_KEYS` and
`SL_LL_KEYS`). This is a **correction** to this file's own first draft
(which had kept the base engine's `NEW_TZ_BUY` kind/label as a separate
`Buy` object) — confirmed explicitly wrong; the uploaded competing draft's
behavior on this point is correct.

**B. Retry threshold — `max()`, not either/or.** The reactivation threshold
is `max(TZ BUY's own frozen reference, TZ BUY 2's own reference if it ever
formed)`. Practically equivalent to "TZ BUY 2's ref if it exists, else TZ
BUY's own peak" (TZ BUY 2's reference is always strictly higher than TZ
BUY's own by construction, once it exists) — confirmed by the user as "the
same practical effect." Implemented as the `max()` form for clarity and to
match the uploaded file exactly.

**C. TZ BUY 2 IS its own leadership-contest milestone** — added to
`MILESTONE_KEYS` as `"TZ BUY 2("`. This is a deliberate **asymmetry**: BAR 2,
REAR 2, and REAR RE-ENTER 2 remain non-milestones (unchanged from the
original validated engine) — the elevation applies to TZ BUY 2 only, not
uniformly to every "2" tier (explicit user choice between the two options
when asked). `"TZ BUY 2("` does not collide with the `is_fresh_buy` check
(`e.startswith("TZ BUY(")`, which `"TZ BUY 2("` does not match due to the
space before the digit), so TZ BUY 2 forming/reactivating is a
*continuation* milestone (the newer-branch-with-an-existing-live-buy
exemption applies), not a *fresh* one.

**D / I. TZ BUY 2's own SL does NOT open spawn eligibility for TZ
GREEN(n+1).** Only TZ BUY's own top-level SL does. This needed **zero new
code** — the base engine's existing spawn-eligibility rule already keys off
`buy.active` (TZ BUY's own state), not any "2"-tier's SL flag, so it already
produces exactly this behavior without modification. This directly
contradicts the uploaded competing draft, which explicitly makes TZ BUY 2's
own SL open eligibility too — confirmed by the user as the uploaded draft's
mistake, not something to adopt.

**E. TZ BUY 2's own HH — comparison-based mute, not existence-based.**
Unlike BAR's own HH (permanently suppressed the instant BAR 2 exists, since
BAR 2's reference is guaranteed higher than BAR's own by construction), TZ
BUY 2's own HH is **not** guaranteed lower than whatever eventually forms
below it — it may have been climbing long before any BAR/REAR/REAR RE-ENTER
ever formed. So TZ BUY 2's own HH display is muted only once some deeper
tier's *actual reference value* (any BAR generation's own ref, any BAR 2's
own ref, REAR's, REAR 2's, REAR RE-ENTER's, REAR RE-ENTER 2's) reaches or
exceeds TZ BUY 2's own current reference — a live numeric comparison,
re-checked every candle until it trips, then permanent. Confirmed
TZ-BUY-2-only (not extended to BAR 2/REAR 2/REAR RE-ENTER 2, which have no
such rule and don't need one, being guaranteed-ordered already).

**F. Cross-theory hook (`extra_reentry_floor`)** — explicitly deferred:
"will come to it later in DTF with respect to WTF." Not implemented in this
file yet; the uploaded draft's version of this hook is a forward reference
to work not yet started here.

**H. TZ BUY 2's own SL recovers under the SAME `"TZ BUY 2(label)"` text** —
already true in this file from the original TZ BUY 2 build (mirrors BAR 2's
own SL/recovery cycle, which already uses the same pattern); reconfirmed by
the user, no change needed.

**J. BAR/BAR 2 already have the "reactivate in place, same label" pattern**
that TZ BUY's retry was corrected to match — this is the *original*,
real-data-validated behavior TZ BUY 2 was modeled on, not something newly
introduced. When BAR's own SL fires:
- **With BAR 2 having formed**: can reactivate under the same `"BAR(label)"`
  text via INVALID BAR SL, if it independently re-qualifies as a fresh
  breakout; otherwise continues toward BAR SL2.
- **With no BAR 2 ever formed**: that *specific lineage* is a permanent dead
  end — no INVALID BAR SL, no BAR SL2, no REAR reachable from it.

Either way, **a brand-new BAR(n+1) can still start elsewhere in the same
buy**, via two paths that don't care whether the dead lineage ever had its
own BAR 2:
1. A fresh RED2 (against whatever's currently active) followed by a
   qualifying breakout ("mechanism 1").
2. A fresh breakout landing directly inside the dead lineage's own SL price
   range ("mechanism 2") — this path doesn't check `bar2 is not None` on the
   dead lineage at all, in the original, already-validated engine. Flagged
   to the user as a possible inconsistency (BAR 2 gates SL2 but not this
   path) — not yet resolved as a bug or confirmed intentional; left
   unchanged pending that decision.

## Naming

`Buy.tz_buy2: Optional[Bar2]`, `Buy.tz_buy2_hh_muted: bool`,
`Engine._eval_tzbuy2(...)` — aligned to match the uploaded competing
draft's naming, to minimize friction if that file's DTF-with-respect-to-WTF
hooks are integrated later. `Buy.kind` was removed entirely (no longer
needed once "NEW TZ BUY" was dropped).

## A latent bug fixed along the way

The retroactive same-day HH-suppression pass (used to suppress
`"TZ BUY HH("` the same day `"TZ BUY 2("` fires) originally built its
underlying-event key as `label + " HH("` inside a loop that *also*
reassigned a local variable named `label` to the current event's branch
letter on every iteration — a genuine variable-shadowing bug that would have
silently corrupted this suppression after the very first event on any given
candle. Fixed by hardcoding `"TZ BUY HH("` directly (safe now that there is
only one possible top-level label, post-A) and renaming the loop's local
variable to `branch_lbl` so it can never collide with anything else again.

## Testing so far

`test_wtf_smoke.py` — five independent synthetic OHLC sequences:

1. Full escalation TZ GREEN → RED → TZ BUY → TZ BUY 2 → RED1 → RED2 (gated
   on TZ BUY 2) → BAR(A.1).
2. TZ BUY SL with no TZ BUY 2 ever formed → reactivates in place off the
   dead buy's own raw peak; asserts `"NEW TZ BUY("` never appears.
3. TZ BUY SL after TZ BUY 2 already existed → reactivates off
   `max(TZ BUY's own ref, TZ BUY 2's ref)`; a companion run confirms a
   candle clearing the old peak but not TZ BUY 2's reference does not
   reactivate.
4. Direct check that `is_milestone("TZ BUY 2(A)")` is `True` while
   `is_milestone("BAR 2(A.1)")` / `is_milestone("REAR 2(A)")` stay `False`.
5. TZ BUY 2's own HH display is muted from the exact candle a BAR
   generation's own reference (or its own BAR 2) reaches or exceeds TZ BUY
   2's reference — checked via the per-day trace, not just the flat event
   set (since the event legitimately fires earlier in the same run, before
   the deeper tier catches up).

This only proves the layer's plumbing is internally consistent on data built
to exercise it — not a substitute for verification against real OHLC, which
TZ BUY 2 has never had. Run `python3 test_wtf_smoke.py`.

## Open items

- Whether BAR's "mechanism 2" (a fresh BAR branching directly off a dead
  lineage's own SL price range) should also be gated on that lineage having
  had its own BAR 2 — flagged under J above, not yet resolved.
- The `extra_reentry_floor` cross-theory hook (deferred to DTF-with-respect-
  to-WTF work).
