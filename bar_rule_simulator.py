"""
BAR rule simulator v3 -- removes BAR SL2 entirely. Per the user's latest
correction: the cycle no longer has a terminal "SL2" failure state. Instead,
after a DEEP BAR/SAR SL (post-stage2, breaking the outer min/max threshold;
or any BAR/SAR SL before stage2 ever formed), TWO permanently co-existing
recovery paths open up:

  a) NEW TZ GREEN/TZ RED cycle -- a wholly fresh anchor search, independent
     of the dead generation's own reference (only possible if no gen was
     already stage2_formed... no, actually always possible; if the dead gen
     never reached BAR2, only this path exists).
  b) REAR BUY/SELL -- reforms directly above/below the dead generation's own
     BAR2/SAR2 reference (only possible if that generation HAD reached
     stage2). House-specific name: House of Bull uses REAR BUY, House of
     Bear uses REAR SELL -- same mechanism either way. Gets its own REAR
     BUY 2/REAR SELL 2 (identical mechanics to BAR 2: ungoverned dual HH/LL,
     two-tier SL), then RED1/RED2 (or GREEN1/GREEN2) attach to it exactly
     like BAR 2. Once RED2/GREEN2 fires there, the NEXT generation reverts
     to plain BAR/BAR 2 (or SAR/SAR 2) naming -- REAR BUY/SELL is only the
     label for the one generation immediately recovering from a deep SL.

Whichever of (a)/(b) reaches its own stage2 (BAR2(N+1) vs REAR BUY 2) FIRST
becomes "active"; the other does NOT terminate -- it goes DORMANT (per the
user: "stay dormant and not terminated"), and this is a PERMANENT ongoing
dual-track, not a one-time decision -- exactly mirroring the House of
Bull/Bear split, just one level down. A dormant lineage's own frozen
reference (BAR2's/REAR BUY 2's own High/Low) keeps ratcheting via ordinary
price action even while dormant (labeled "INVALID REAR BUY HH"/"INVALID
REAR BUY LL" while literally awaiting a REAR BUY reformation) -- so it's
available again with an up-to-date reference if the other, currently-active
lineage later fails. Confirmed for real against the 2022 case-study dataset
(27-02 through 06-03-2022): a fresh TZ GREEN and a REAR BUY lineage stay
alive at once, each independently firing its own RED1/RED2 on the same
days -- disambiguated in the printed output as "RED1 (REAR BUY)"/"RED1
(TZ GREEN)" (see pullback_track/pullback_buffer below) since the plain
event name alone would otherwise look like a duplicate.

gen_pending (from any lineage's RED2) is a per-HOUSE shared signal: ANY
lineage that is itself alive and past its own stage2 can independently
consume it to form its own next generation -- this models the user's
"if REAR 2 IS ALSO BAR 2(N+1), record that at the backend" / "any new green
can be BAR(N+1) since RED1 and RED2 has also occurred" notes.

REAR BUY/SELL SL is fully recursive/self-similar to BAR SL: if REAR
BUY/SELL's own generation later deep-SLs, the exact same race reopens (a
further TZ GREEN(N+2) vs a new REAR BUY reforming off REAR BUY 2's own
reference), on the SAME lineage object (REAR BUY/SELL is just a naming
state that toggles on/off within one lineage's life, not a separate
lineage kind). If REAR BUY/SELL's own gen SLs before its own 2 ever formed,
that lineage dies permanently (no reference exists to reform against) --
this matches the user's explicit worked example.
"""

THRESH = 0.20
ANY = 0.01

rows = [
    ("01-01-2021", 602,    605.5,  601.65, 604),
    ("02-01-2021", 603.5,  608,    603,    607),
    ("03-01-2021", 606.95, 609,    601,    606.25),
    ("04-01-2021", 606,    607,    605.9,  606),
    ("05-01-2021", 606.15, 606.25, 605.5,  605.9),
    ("06-01-2021", 605.95, 609,    605,    606),
    ("07-01-2021", 605.8,  606,    603,    605),
    ("08-01-2021", 604.95, 605.1,  602,    603),
    ("09-01-2021", 603.05, 605.5,  602.85, 605.25),
    ("10-01-2021", 605,    608,    604.85, 607.85),
    ("11-01-2021", 607.5,  609.1,  607,    608.65),
    ("12-01-2021", 608,    608.5,  606,    606.5),
    ("13-01-2021", 606,    607,    605.85, 606),
    ("14-01-2021", 606.25, 606.75, 605,    605.3),
    ("15-01-2021", 605,    608,    604,    607.75),
    ("16-01-2021", 608,    610,    607.5,  609.5),
    ("17-01-2021", 609,    614,    608.5,  610.3),
    ("18-01-2021", 610,    615,    609.5,  614),
    ("19-01-2021", 613.55, 616.5,  613,    616),
    ("20-01-2021", 615.45, 616.75, 615,    615.25),
    ("21-01-2021", 615,    616.25, 613.35, 614),
    ("22-01-2021", 614.35, 615.5,  613,    613.85),
    ("23-01-2021", 614,    615,    612.25, 612.65),
    ("24-01-2021", 612,    614,    611,    611.35),
    ("25-01-2021", 611.5,  614.5,  611,    613),
    ("26-01-2021", 612.25, 616,    612,    615.5),
    ("27-01-2021", 615.75, 617.25, 615,    615.25),
    ("28-01-2021", 615,    618,    614.85, 617.85),
    ("29-01-2021", 617.5,  620.2,  617,    619),
    ("30-01-2021", 619.5,  622.15, 619,    622),
    ("31-01-2021", 621,    624,    620.05, 623),
    ("01-02-2021", 622,    622.5,  620,    621),
    ("02-02-2021", 620.5,  625.5,  620.05, 624.8),
    ("03-02-2021", 624,    627,    623.5,  626),
    ("04-02-2021", 625.35, 626.75, 623,    623.6),
    ("05-02-2021", 624,    627,    623.75, 626.7),
    ("06-02-2021", 626.25, 629,    626,    628.85),
    ("07-02-2021", 629,    631,    625.5,  626),
    ("08-02-2021", 626.45, 627,    625,    625.45),
    ("09-02-2021", 625.75, 626.15, 624,    624.25),
    ("10-02-2021", 624,    624.7,  621.5,  622.5),
    ("11-02-2021", 623,    623.15, 619.85, 620),
    ("12-02-2021", 620.15, 622.95, 620,    622.5),
    ("13-02-2021", 622.15, 624,    622,    623.5),
    ("14-02-2021", 623.15, 623.5,  621,    622.05),
    ("15-02-2021", 622,    622.5,  620,    620.05),
    ("16-02-2021", 620,    623,    619.65, 622.5),
    ("17-02-2021", 622,    624,    621.5,  623.15),
    ("18-02-2021", 623,    625.25, 622.35, 625),
    ("19-02-2021", 625.05, 630,    624.9,  626),
    ("20-02-2021", 625.85, 626.35, 624.4,  624.65),
    ("21-02-2021", 624.5,  626.95, 624,    626.5),
    ("22-02-2021", 626.5,  627,    625,    625.25),
    ("23-02-2021", 625.5,  626.15, 624,    624.2),
    ("24-02-2021", 624.5,  625.25, 621,    621.5),
    ("25-02-2021", 621.2,  622.05, 619,    619.5),
    ("26-02-2021", 619,    619.5,  617.05, 617.5),
    ("27-02-2021", 617.05, 618.5,  614.5,  614.8),
    ("28-02-2021", 615,    617.75, 614.25, 617),
    ("01-03-2021", 616.85, 619.5,  616.5,  619),
    ("02-03-2021", 618.8,  622.5,  618,    622),
    ("03-03-2021", 623,    627,    622.05, 626),
    ("04-03-2021", 625,    627.35, 624.25, 627),
    ("05-03-2021", 627,    628.5,  626.5,  628),
    ("06-03-2021", 627.35, 628,    625,    625.25),
    ("07-03-2021", 625,    625.35, 621,    622.05),
    ("08-03-2021", 622.1,  623,    617.65, 618.05),
    ("09-03-2021", 618,    619,    614,    615),
    ("10-03-2021", 614.5,  614.5,  612,    613.5),
    ("11-03-2021", 613.25, 615,    611,    612.05),
    ("12-03-2021", 612.5,  614,    611,    611.5),
    ("13-03-2021", 611.25, 612,    609.25, 610),
    ("14-03-2021", 611.05, 613.75, 610.75, 613),
    ("15-03-2021", 612.5,  614,    610,    610.15),
    ("16-03-2021", 610,    613,    609,    612),
    ("17-03-2021", 612.05, 615.25, 611.55, 615),
    ("18-03-2021", 614.05, 615.5,  613.8,  615),
    ("19-03-2021", 614.55, 616,    614,    615.5),
    ("20-03-2021", 615,    617.85, 614.35, 617),
    ("21-03-2021", 616.55, 617,    614,    614.5),
    ("22-03-2021", 615,    616,    613.5,  613.85),
    ("23-03-2021", 614,    615.75, 613,    614),
    ("24-03-2021", 613.5,  614,    611,    612),
    ("25-03-2021", 612.55, 613,    610.25, 610.5),
    ("26-03-2021", 611,    612.85, 610.5,  612),
    ("27-03-2021", 612.15, 613,    609.65, 610.05),
    ("28-03-2021", 610,    611,    608.5,  609),
    ("29-03-2021", 609.5,  610.5,  607.5,  609.95),
    ("30-03-2021", 610,    611,    609.5,  611),
    ("31-03-2021", 611.05, 615,    610.05, 614.2),
    ("01-04-2021", 613.85, 616.05, 613.25, 615.25),
    ("02-04-2021", 615,    616,    613.75, 614),
    ("03-04-2021", 614.25, 617,    614,    616.5),
    ("04-04-2021", 616,    616.05, 614.55, 615),
    ("05-04-2021", 615.05, 615.25, 613,    613.55),
    ("06-04-2021", 614,    614.25, 612.55, 612.75),
    ("07-04-2021", 612.5,  616,    612.35, 615.7),
    ("08-04-2021", 616,    618,    615.2,  617.5),
    ("09-04-2021", 617,    619,    616.5,  616.5),
    ("10-04-2021", 616.75, 620.65, 616.55, 620),
    ("11-04-2021", 620.05, 621,    618.4,  619),
    ("12-04-2021", 618.5,  620,    616,    616.5),
    ("13-04-2021", 617,    620.35, 616.8,  619.85),
    ("14-04-2021", 619.65, 622,    619.5,  621.5),
    ("15-04-2021", 621,    623,    619,    622.05),
    ("16-04-2021", 622,    625,    621.05, 624.55),
    ("17-04-2021", 624,    626.7,  623.25, 626),
    ("18-04-2021", 626.05, 629,    626,    628.5),
    ("19-04-2021", 628,    629.5,  627,    627.05),
    ("20-04-2021", 627,    628.15, 626,    626.45),
    ("21-04-2021", 626.35, 627,    624.75, 625.25),
    ("22-04-2021", 625.05, 626.05, 624,    624.85),
    ("23-04-2021", 625,    627,    624.35, 626.85),
    ("24-04-2021", 626.5,  629,    626.35, 628.65),
]


class Struct:
    def __init__(self, ref_high, ref_low, name):
        self.ref_high = ref_high
        self.ref_low = ref_low
        self.alive = True
        self.stage2_formed = False
        self.name = name
        self.bar_ref_low = None
        self.bar_ref_high = None


class Lineage:
    def __init__(self):
        self.anchor = None          # Struct, only for a lineage that began as a fresh TZ GREEN/TZ RED
        self.pullback = None        # RED1/GREEN1 tracker
        self.gen = None             # current BAR/SAR/REAR/REAR RE ENTER Struct
        self.gen_started = False    # True once this lineage's first gen has ever formed
        self.bar2_recovery = None   # shallow-SL "NEW X2 reforms directly" awaiting state
        self.rear_recovery = None   # deep-SL "escalate to next recovery level" awaiting state
        self.dead = False           # permanently dead -- no recovery reference exists
        # Ladder of deep-SL recovery labels: None (plain BAR/SAR) -> "REAR" -> "REAR RE ENTER",
        # where "REAR RE ENTER" is terminal (further deep SLs stay "REAR RE ENTER" forever).
        # Reset to None whenever a fresh gen forms off the ordinary gen_pending/RED2 path.
        self.recovery_label = None
        # True once this lineage's gen has died pre-"2" (no REAR/ladder recovery possible) but
        # its own anchor is still alive and ticking. Such a lineage is NOT a permanent dual-track
        # competitor (that only applies to the REAR-vs-fresh-anchor race at the gen level) -- it
        # gets retired the moment the next fresh anchor successfully forms, matching the
        # single-lineage-at-a-time behavior everywhere except that one deliberate race.
        self.orphaned_anchor = False
        # Once TRUE (permanently), the anchor's own SL/stage2/HH-LL tracking is no longer
        # checked/printed at all -- either BAR 2 (or REAR 2/REAR RE ENTER 2) has "taken over"
        # (set the first time this lineage's gen reaches its own "2" stage), or the anchor has
        # already served its one-time gating role by letting a RED1/GREEN1 pullback attach
        # against it (set the moment that first attach succeeds) -- per the user's correction,
        # a shallow anchor SL has no recovery of its own and nothing downstream depends on the
        # anchor's own High/Low/reference past that point, so its own tracking is redundant.
        self.anchor_retired = False
        # True when a gen's shallow SL fired while gen_pending was ALREADY set (RED2 already
        # fired for this generation before the SL) -- per the original rule: "if RED2 occurs
        # but BAR 2 SL is pending, NEW BAR will start" -- a full fresh BAR/gen forms directly
        # off the already-set gen_pending instead of the lighter "NEW BAR 2 reforms directly"
        # path. Lets the fresh-gen-formation trigger fire even though gen_started blocks the
        # ordinary anchor-fallback ("active BAR required").
        self.gen_fresh_pending = False


def run_house(rows, bullish, gen_name, anchor_name):
    events = [[] for _ in rows]
    pullback_buffer = [[] for _ in rows]
    lineages = []
    gen_pending = False        # shared per-house: any lineage's RED2 sets it; any eligible lineage may consume it
    awaiting_fresh_anchor = True

    def up_break(ph, pl, h, l, c):
        return l >= pl and h > ph + THRESH and c >= ph

    def down_break(ph, pl, h, l, c):
        return h <= ph and l < pl - THRESH and c <= pl

    def formation_break(ph, pl, h, l, c):
        return up_break(ph, pl, h, l, c) if bullish else down_break(ph, pl, h, l, c)

    def current_label(lin):
        return lin.recovery_label or gen_name

    def escalated_label(lin):
        """The label a deep-SL recovery escalates TO. None -> REAR BUY/SELL -> REAR BUY/SELL
        RE ENTER (terminal). House-specific: House of Bull uses REAR BUY, House of Bear uses
        REAR SELL -- same mechanism, side-specific name."""
        rear = "REAR BUY" if bullish else "REAR SELL"
        return rear if lin.recovery_label is None else f"{rear} RE ENTER"

    def process_gen(s, i, h, l, c, label, terminal_on_shallow=True):
        """Two-tier deep/shallow SL, ungoverned dual HH/LL tracking. Used for BOTH the
        anchor (TZ GREEN/TZ RED, once TZ GREEN 2/TZ RED 2 mirrors BAR 2's exact mechanics)
        and the gen (BAR/SAR/REAR/REAR RE ENTER) -- structurally identical either way,
        except the anchor call passes terminal_on_shallow=False: per the user's correction,
        a shallow anchor SL has no consequence (does not kill/reform anything), so the
        anchor's own `alive` stays True and the Struct is otherwise left untouched.
        Returns 'deep', 'shallow', or None."""
        if not s.stage2_formed:
            if bullish:
                sl_hit = (s.ref_low - l) >= THRESH and c <= s.ref_low
            else:
                sl_hit = (h - s.ref_high) >= THRESH and c >= s.ref_high
            if sl_hit:
                events[i].append(f"{label} SL")
                s.alive = False
                return "deep"
            if bullish:
                stage2 = (h > s.ref_high + THRESH) and (l >= rows[i - 1][3]) and (c >= s.ref_high)
            else:
                stage2 = (l < s.ref_low - THRESH) and (h <= rows[i - 1][2]) and (c <= s.ref_low)
            if stage2:
                if bullish:
                    s.bar_ref_low = s.ref_low
                    s.ref_high = h
                    s.ref_low = l
                else:
                    s.bar_ref_high = s.ref_high
                    s.ref_low = l
                    s.ref_high = h
                s.stage2_formed = True
                events[i].append(f"{label} 2")
                return None
            if h > s.ref_high + ANY:
                s.ref_high = h
                events[i].append(f"{label} HH")
            if l < s.ref_low - ANY:
                s.ref_low = l
                events[i].append(f"{label} LL")
            return None

        if bullish:
            deep_threshold = min(s.bar_ref_low, s.ref_low)
            shallow_sl = (s.ref_low - l) >= THRESH and c <= s.ref_low
            deep_sl = (deep_threshold - l) >= THRESH and c <= deep_threshold
        else:
            deep_threshold = max(s.bar_ref_high, s.ref_high)
            shallow_sl = (h - s.ref_high) >= THRESH and c >= s.ref_high
            deep_sl = (h - deep_threshold) >= THRESH and c >= deep_threshold

        if deep_sl:
            events[i].append(f"{label} SL")
            s.alive = False
            return "deep"
        if shallow_sl:
            events[i].append(f"{label} 2 SL")
            if terminal_on_shallow:
                s.alive = False
            return "shallow"

        if h > s.ref_high + ANY:
            s.ref_high = h
            events[i].append(f"{label} 2 HH")
        if l < s.ref_low - ANY:
            s.ref_low = l
            events[i].append(f"{label} 2 LL")
        return None

    def pullback_track(lin):
        """Which structure this lineage's pullback is currently attached to -- used only to
        disambiguate output on a day where 2+ DISTINCT lineages each independently fire a
        pullback event (the permanent BAR/SAR-vs-REAR BUY/SELL dual-track): the lineage's own
        current gen label once a gen has started, else its anchor name."""
        return current_label(lin) if lin.gen_started else anchor_name

    def process_pullback(lin, i, h, l, c, ph, pl):
        nonlocal gen_pending
        pullback = lin.pullback
        if pullback is None or not pullback["active"]:
            if bullish:
                attach = h <= ph and (pl - l) >= THRESH and c <= pl
            else:
                attach = l >= pl and (h - ph) >= THRESH and c >= ph
            if attach:
                lin.pullback = {"ref_high": h, "ref_low": l, "active": True}
                pullback_buffer[i].append((lin, "RED1" if bullish else "GREEN1"))
                return True
            return False

        pb = pullback
        if bullish:
            red2 = l <= pb["ref_low"] and h <= ph and (ph - pl) >= THRESH and c <= pb["ref_low"] + 0.001
        else:
            red2 = h >= pb["ref_high"] and l >= pl and (ph - pl) >= THRESH and c >= pb["ref_high"] - 0.001
        if red2:
            pullback_buffer[i].append((lin, "RED2" if bullish else "GREEN2"))
            pb["active"] = False
            gen_pending = True
            return True

        if bullish:
            invalid = (h - pb["ref_high"]) >= THRESH and c >= pb["ref_high"]
        else:
            invalid = (pb["ref_low"] - l) >= THRESH and c <= pb["ref_low"]
        if invalid:
            pullback_buffer[i].append((lin, "RED1 SL" if bullish else "GREEN1 SL"))
            pb["active"] = False
            return True

        fired = False
        if bullish and l < pb["ref_low"]:
            pb["ref_low"] = l
            pullback_buffer[i].append((lin, "RED1 LL"))
            fired = True
        elif (not bullish) and h > pb["ref_high"]:
            pb["ref_high"] = h
            pullback_buffer[i].append((lin, "GREEN1 HH"))
            fired = True
        if bullish and h > pb["ref_high"]:
            pb["ref_high"] = h
            pullback_buffer[i].append((lin, "RED1 HH"))
            fired = True
        elif (not bullish) and l < pb["ref_low"]:
            pb["ref_low"] = l
            pullback_buffer[i].append((lin, "GREEN1 LL"))
            fired = True
        return fired

    for i in range(1, len(rows)):
        _, o, h, l, c = rows[i]
        _, po, ph, pl, pc = rows[i - 1]

        newly_formed = set()
        consumed_gen_pending_today = False

        # 0. Fresh anchor search -- always live once triggered by an SL, until it succeeds.
        if awaiting_fresh_anchor and formation_break(ph, pl, h, l, c):
            # Retire any orphaned-anchor lineage(s) -- a gen that died pre-"2" (no REAR/ladder
            # recovery possible) is not a permanent dual-track competitor; only the REAR-vs-
            # fresh-anchor race at the gen level is. This new anchor replaces it outright.
            for old in lineages:
                if old.orphaned_anchor:
                    old.dead = True
            lin = Lineage()
            lin.anchor = Struct(h, l, anchor_name)
            lineages.append(lin)
            awaiting_fresh_anchor = False
            events[i].append(anchor_name)
            newly_formed.add(id(lin))

        for lin in lineages:
            if lin.dead or id(lin) in newly_formed:
                continue

            # --- Shallow-SL recovery window: NEW BAR2/REAR2 reforms directly ---
            if lin.bar2_recovery is not None and gen_pending:
                # RED2/GREEN2 has fired (on an earlier day, or later the same day the shallow
                # SL originally fired) while this lighter recovery was still pending -- per the
                # original rule, that forecloses it entirely, every day it might otherwise
                # still apply, not just the instant the shallow SL fires. Abandon the recovery
                # and let the ordinary fresh-gen-formation trigger (gen_fresh_pending) take
                # over instead.
                lin.bar2_recovery = None
                lin.gen_fresh_pending = True
            if lin.bar2_recovery is not None:
                rec = lin.bar2_recovery
                ref = rec["ref"]
                # Escalation (checked first, deep-before-shallow convention): if the outer/
                # deep threshold is ALSO breached while awaiting the lighter shallow recovery,
                # that converts straight into the full-restart deep-SL path instead.
                deep_threshold = (
                    min(rec["outer"], rec["inner_adverse"]) if bullish
                    else max(rec["outer"], rec["inner_adverse"])
                )
                if bullish:
                    escalates = (deep_threshold - l) >= THRESH and c <= deep_threshold
                else:
                    escalates = (h - deep_threshold) >= THRESH and c >= deep_threshold
                if escalates:
                    events[i].append(f"{current_label(lin)} SL")
                    lin.rear_recovery = {"ref": rec["inner_adverse"], "target_label": escalated_label(lin)}
                    lin.bar2_recovery = None
                    awaiting_fresh_anchor = True
                    continue
                if bullish:
                    recovers = l >= pl and h > ref + THRESH and c >= ref
                else:
                    recovers = h <= ph and l < ref - THRESH and c <= ref
                if recovers:
                    new_gen = Struct(h, l, gen_name)
                    new_gen.stage2_formed = True
                    if bullish:
                        new_gen.bar_ref_low = rec["outer"]
                    else:
                        new_gen.bar_ref_high = rec["outer"]
                    lin.gen = new_gen
                    lin.bar2_recovery = None
                    events[i].append(f"{current_label(lin)} 2")
                    continue
                else:
                    base = current_label(lin)
                    inner_label = f"{base} 2"
                    inner_adverse = rec["inner_adverse"]
                    # Favorable-side (recovery-target) reference: an attempt at reforming the
                    # "2" that ticks the reference further out without yet fully qualifying
                    # (Low/Close conditions not checked here -- same simple ANY-threshold
                    # ratchet as the deep-SL "INVALID {X} HH/LL" below).
                    if bullish:
                        if h - ref >= ANY:
                            rec["ref"] = h
                            events[i].append(f"INVALID {base} HH")
                    else:
                        if ref - l >= ANY:
                            rec["ref"] = l
                            events[i].append(f"INVALID {base} LL")
                    # Adverse-side outer/inner references, unchanged mechanic.
                    if bullish:
                        if rec["outer"] - l >= ANY:
                            rec["outer"] = l
                            events[i].append(f"{base} LL")
                        if inner_adverse - l >= ANY:
                            rec["inner_adverse"] = l
                            events[i].append(f"{inner_label} LL")
                    else:
                        if h - rec["outer"] >= ANY:
                            rec["outer"] = h
                            events[i].append(f"{base} HH")
                        if h - inner_adverse >= ANY:
                            rec["inner_adverse"] = h
                            events[i].append(f"{inner_label} HH")

            # --- Deep-SL recovery window: escalate to the next recovery level directly ---
            if lin.rear_recovery is not None:
                rec = lin.rear_recovery
                target = rec["target_label"]
                ref = rec["ref"]
                if bullish:
                    recovers = l >= pl and h > ref + THRESH and c >= ref
                else:
                    recovers = h <= ph and l < ref - THRESH and c <= ref
                if recovers:
                    new_gen = Struct(h, l, target)
                    lin.gen = new_gen
                    lin.gen_started = True
                    lin.recovery_label = target
                    lin.rear_recovery = None
                    events[i].append(target)
                    continue
                else:
                    if bullish:
                        if h - ref >= ANY:
                            rec["ref"] = h
                            events[i].append(f"INVALID {target} HH")
                    else:
                        if ref - l >= ANY:
                            rec["ref"] = l
                            events[i].append(f"INVALID {target} LL")

            # --- gen's own SL/stage2/HH-LL ---
            if lin.gen is not None and lin.gen.alive:
                label = current_label(lin)
                gen_sl_kind = process_gen(lin.gen, i, h, l, c, label)
                if lin.gen.stage2_formed:
                    lin.anchor_retired = True
                if gen_sl_kind == "deep":
                    if lin.gen.stage2_formed:
                        ref_val = lin.gen.ref_high if bullish else lin.gen.ref_low
                        lin.rear_recovery = {"ref": ref_val, "target_label": escalated_label(lin)}
                    else:
                        # No stage2 reference ever existed, so no recovery is possible for this
                        # gen-path -- the lineage's own anchor (if still alive) is NOT killed
                        # immediately; it keeps ticking its own HH/LL/SL exactly as before, up
                        # until the next fresh anchor successfully forms, at which point it is
                        # retired (see the orphaned_anchor check at the top of the day loop).
                        # gen_started is already True, so this lineage's front is permanently
                        # None from here on (no anchor-fallback per "active BAR required") --
                        # it simply never forms another gen on its own.
                        lin.orphaned_anchor = True
                    awaiting_fresh_anchor = True
                    lin.gen = None
                elif gen_sl_kind == "shallow":
                    if gen_pending:
                        # RED2 already fired for this generation before the shallow SL --
                        # per the original rule, that forecloses the lightweight "NEW BAR 2
                        # reforms directly" path entirely: a full fresh BAR/gen starts
                        # instead, directly off the already-set gen_pending.
                        lin.gen_fresh_pending = True
                        lin.gen = None
                    else:
                        label = current_label(lin)
                        inner_adverse = lin.gen.ref_low if bullish else lin.gen.ref_high
                        outer_before = lin.gen.bar_ref_low if bullish else lin.gen.bar_ref_high
                        outer_now = outer_before
                        if bullish:
                            if outer_before - l >= ANY:
                                outer_now = l
                                events[i].append(f"{label} LL")
                        else:
                            if h - outer_before >= ANY:
                                outer_now = h
                                events[i].append(f"{label} HH")
                        lin.bar2_recovery = {
                            "ref": lin.gen.ref_high if bullish else lin.gen.ref_low,
                            "inner_adverse": inner_adverse,
                            "outer": outer_now,
                        }
                        lin.gen = None

            # --- Anchor-level processing: two-tier deep/shallow SL, ungoverned dual HH/LL,
            # exactly mirroring the gen (BAR/BAR 2) EXCEPT for the shallow tier's consequence.
            # Per the user's explicit correction: a shallow anchor SL ("TZ GREEN 2 SL"/"TZ RED 2
            # SL") does NOT stop or restart anything -- RED1/RED2/BAR/BAR 2/REAR BUY/etc. (or
            # their Bear mirrors) are never dependent on the anchor's own High/Low/reference
            # once it has served its one-time gating role (letting the first RED1/GREEN1
            # attach). So it is logged (`terminal_on_shallow=False` below keeps the Struct
            # alive and untouched -- no recovery window, no reforming "TZ GREEN 2"/"TZ RED 2").
            # Only the anchor's DEEP SL still matters -- that remains unconditional, total
            # lineage death, unchanged. Separately, tracking stops being checked/printed
            # altogether, permanently, once this lineage's gen has ever reached its own "2"
            # stage (anchor_retired) -- from that point BAR 2/REAR 2/etc. "has taken over".
            if not lin.anchor_retired and lin.anchor is not None and lin.anchor.alive:
                anchor_sl_kind = process_gen(lin.anchor, i, h, l, c, anchor_name, terminal_on_shallow=False)
                if anchor_sl_kind == "deep":
                    lin.dead = True
                    awaiting_fresh_anchor = True
                    gen_pending = False  # complete lineage death -- see the matching note above
                    continue

            # --- pullback attach/continue ---
            front = None
            if lin.gen is not None and lin.gen.alive:
                front = lin.gen
            elif not lin.gen_started and lin.anchor is not None and lin.anchor.alive:
                front = lin.anchor

            # Fresh-attach eligibility for RED1/GREEN1: once the anchor has ever reached its
            # own "2" stage, only a DEEP SL (complete lineage death, via lin.dead -- this code
            # wouldn't even run that day) revokes eligibility. A shallow anchor SL no longer
            # touches `alive` at all (see process_gen's terminal_on_shallow=False above), so it
            # never affects this either.
            front_ok_for_attach = front is not None and front.stage2_formed

            was_active_pullback = lin.pullback is not None and lin.pullback["active"]
            if was_active_pullback:
                process_pullback(lin, i, h, l, c, ph, pl)
            elif front_ok_for_attach and not gen_pending:
                attached = process_pullback(lin, i, h, l, c, ph, pl)
                # The moment a lineage's FIRST pullback (RED1/GREEN1) attaches against the
                # anchor as front, the anchor's own further tracking becomes permanently
                # irrelevant -- retire it now (§3/user correction), not just once the gen
                # reaches its own "2" stage. This still lets today's already-computed anchor
                # event above print; retirement takes effect from tomorrow.
                if attached and front is lin.anchor:
                    lin.anchor_retired = True

            # --- fresh gen formation off the shared gen_pending signal ---
            if gen_pending and ((front is not None and front.stage2_formed) or lin.gen_fresh_pending):
                if formation_break(ph, pl, h, l, c):
                    new_gen = Struct(h, l, gen_name)
                    lin.gen = new_gen
                    lin.gen_started = True
                    lin.recovery_label = None
                    lin.gen_fresh_pending = False
                    events[i].append(gen_name)
                    consumed_gen_pending_today = True

        # gen_pending is a persistent, shared-per-house signal: it stays available across
        # days (any lineage that becomes eligible later can still consume it) until at least
        # one lineage actually consumes it -- all lineages eligible on the SAME day consume it
        # simultaneously (per the user's "recorded at the backend" note) before this clears.
        if consumed_gen_pending_today:
            gen_pending = False

        # Flush this day's pullback events: only tag with the owning lineage's current track
        # when 2+ DISTINCT lineages actually fired a pullback event the same day (the
        # permanent BAR/SAR-vs-REAR BUY/SELL dual-track producing e.g. two independent RED1
        # attaches at once) -- otherwise the plain, untagged name is unambiguous as-is.
        distinct_lins = {id(lin) for lin, _ in pullback_buffer[i]}
        for lin, text in pullback_buffer[i]:
            if len(distinct_lins) > 1:
                events[i].append(f"{text} ({pullback_track(lin)})")
            else:
                events[i].append(text)

    return events


bull_events = run_house(rows, True, "BAR", "TZ GREEN")
bear_events = run_house(rows, False, "SAR", "TZ RED")

print(f"{'DATE':12}{'OPEN':8}{'HIGH':8}{'LOW':8}{'CLOSE':8}{'HOUSE':14}EVENT")
for i, (d, o, h, l, c) in enumerate(rows):
    be = bull_events[i]
    re = bear_events[i]
    if be and re:
        house = "BULL + BEAR"
    elif be:
        house = "BULL"
    elif re:
        house = "BEAR"
    else:
        house = ""
    ev = " + ".join(be + re)
    print(f"{d:12}{o:<8}{h:<8}{l:<8}{c:<8}{house:14}{ev}")
