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
    def __init__(self, ref_high, ref_low, name, formed_day=None):
        self.ref_high = ref_high
        self.ref_low = ref_low
        self.alive = True
        self.stage2_formed = False
        self.name = name
        self.bar_ref_low = None
        self.bar_ref_high = None
        # Day index this Struct was created -- used only to tell whether two DISTINCT
        # lineages' current fronts came into being on the exact same day (see
        # Lineage.created_day and the pullback-attach precedence rule below).
        self.formed_day = formed_day


class Lineage:
    def __init__(self, created_day=None):
        # Day index this Lineage object was created -- used only to break ties when 2+
        # lineages' current fronts came into being the same day and both independently
        # qualify for a fresh RED1/GREEN1 attach (see the precedence rule below).
        self.created_day = created_day
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
        # checked/printed at all -- set the first time this lineage's gen reaches its own "2"
        # stage, at which point BAR 2 (or REAR 2/REAR RE ENTER 2) has its own separate
        # deep-SL reference and the anchor's own (now stale) one would be a redundant,
        # unrelated failure mode. NOTE: a RED1/GREEN1 pullback attaching against the anchor
        # does NOT retire it -- confirmed by the user (11-01-2022): the anchor's own DEEP SL
        # must keep being checked, and still fully terminates the lineage (pullback included),
        # for as long as gen_started is False. Only the anchor's SHALLOW SL is a no-op (§2).
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

    def process_gen(s, i, h, l, c, label, terminal_on_shallow=True, governed=False):
        """Two-tier deep SL detection shared by the anchor (TZ GREEN/TZ RED) and the gen
        (BAR/SAR/REAR/REAR RE ENTER), but the two diverge once stage2 has formed:
        - gen (governed=False, terminal_on_shallow=True, the default): ungoverned dual
          HH/LL forever, outer frozen forever once set -- unchanged, reconfirmed by the user.
        - anchor (governed=True, terminal_on_shallow=False): a shallow SL is a logged
          non-terminal event; only the FAVORABLE-side inner reference keeps ratcheting
          (the adverse-inner side is silenced); the OUTER keeps ratcheting continuously on
          the ADVERSE side (unlike the gen's frozen outer) -- confirmed by the user against
          14-02-2022 (outer "TZ RED HH" needed for the deep-SL threshold) and 15-02-2022
          (adverse-inner "TZ RED 2 HH" not required).
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

        if not governed:
            # Gen (BAR 2/SAR 2/REAR BUY 2/etc.): ungoverned dual HH/LL forever, outer frozen
            # forever once set at stage2 formation -- unchanged, reconfirmed by the user.
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

        # Anchor (TZ GREEN 2/TZ RED 2): NONE of its own "2"-suffixed HH/LL/SL ever print, full
        # stop -- confirmed by the user: "once TZ RED 2 occurs, TZ RED 2 SL/LL/HH does not
        # matter... no need to record TZ RED 2 HH/LL/SL." (An earlier version of this fix still
        # printed the favorable-inner side -- e.g. TZ RED 2 LL -- which was still wrong; even
        # that has zero consequence and must not be recorded.) The inner reference (s.ref_high/
        # ref_low) is therefore left exactly as it was set at "2" formation, forever -- it is
        # only ever read below via deep_threshold, and the OUTER's own continuous adverse-side
        # ratchet (next) independently catches up to and then exceeds any stale inner value
        # once price extends far enough, so deep_threshold stays correct without needing the
        # inner side to keep moving. shallow_sl itself is still computed above (it's cheap and
        # shares the deep_threshold's inputs) but deliberately never printed or acted on --
        # confirmed by the user (10-01-2022): a repeat "TZ RED 2 SL" would be doubly wrong,
        # since it cannot even repeat without an interceding re-entry, and there is no such
        # re-entry concept for the anchor at all.
        if bullish:
            if s.bar_ref_low - l >= ANY:
                s.bar_ref_low = l
                events[i].append(f"{label} LL")
        else:
            if h - s.bar_ref_high >= ANY:
                s.bar_ref_high = h
                events[i].append(f"{label} HH")
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
        fresh_attach_candidates = []

        # 0. Fresh anchor search -- always live once triggered by an SL, until it succeeds.
        if awaiting_fresh_anchor and formation_break(ph, pl, h, l, c):
            # Retire any orphaned-anchor lineage(s) -- a gen that died pre-"2" (no REAR/ladder
            # recovery possible) is not a permanent dual-track competitor; only the REAR-vs-
            # fresh-anchor race at the gen level is. This new anchor replaces it outright.
            for old in lineages:
                if old.orphaned_anchor:
                    old.dead = True
            lin = Lineage(created_day=i)
            lin.anchor = Struct(h, l, anchor_name, formed_day=i)
            lineages.append(lin)
            awaiting_fresh_anchor = False
            events[i].append(anchor_name)
            newly_formed.add(id(lin))

        for lin in lineages:
            if lin.dead or id(lin) in newly_formed:
                continue

            # Snapshot, BEFORE today's own processing, whether this lineage's front (gen if
            # started, else anchor) was ALREADY past its own "2" stage as of yesterday. Used
            # only to gate fresh-gen-formation off a stale/carried-over gen_pending signal --
            # confirmed by the user (06-03-2022): a brand-new TZ RED reaching its OWN TZ RED 2
            # for the very first time must NOT, the same day, immediately consume an unrelated,
            # already-pending gen_pending left over from a completely different, earlier-dead
            # lineage's GREEN2 to spawn a fresh SAR out of thin air -- "TZ RED 2 & SAR
            # together? Not possible." The ordinary pullback-attach gate is unaffected by this
            # and still uses the live (same-day) value, since RED1/GREEN1 attaching the very
            # same day the anchor's own "2" forms is separately confirmed correct.
            front_before_today = lin.gen if (lin.gen is not None and lin.gen.alive) else (
                lin.anchor if (not lin.gen_started and lin.anchor is not None and lin.anchor.alive) else None
            )
            front_stage2_before_today = front_before_today is not None and front_before_today.stage2_formed

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
                    # Recovery target is the dead "X 2"'s own FAVORABLE-side reference
                    # (rec["ref"], already tracked/ratcheted by the "INVALID {base} HH/LL"
                    # code above -- e.g. BAR 2's own High) -- confirmed by the user against
                    # 21-02-2022/27-02-2022: NOT rec["inner_adverse"] (BAR 2's own Low),
                    # which this previously and wrongly used.
                    lin.rear_recovery = {
                        "ref": rec["ref"],
                        "target_label": escalated_label(lin),
                        "source_2": f"{current_label(lin)} 2",
                    }
                    lin.bar2_recovery = None
                    awaiting_fresh_anchor = True
                    continue
                if bullish:
                    recovers = l >= pl and h > ref + THRESH and c >= ref
                else:
                    recovers = h <= ph and l < ref - THRESH and c <= ref
                if recovers:
                    new_gen = Struct(h, l, gen_name, formed_day=i)
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
                    new_gen = Struct(h, l, target, formed_day=i)
                    lin.gen = new_gen
                    lin.gen_started = True
                    lin.recovery_label = target
                    lin.rear_recovery = None
                    events[i].append(target)
                    continue
                else:
                    # Ratchet is named after the SOURCE reference being tracked (the dead
                    # "X 2"'s own High/Low, e.g. "INVALID BAR 2 HH") not the escalation's
                    # target label -- confirmed by the user: "record INVALID as INVALID
                    # BAR 2 HH not INVALID REAR BUY HH".
                    source_2 = rec["source_2"]
                    if bullish:
                        if h - ref >= ANY:
                            rec["ref"] = h
                            events[i].append(f"INVALID {source_2} HH")
                    else:
                        if ref - l >= ANY:
                            rec["ref"] = l
                            events[i].append(f"INVALID {source_2} LL")

            # --- gen's own SL/stage2/HH-LL ---
            if lin.gen is not None and lin.gen.alive:
                label = current_label(lin)
                gen_sl_kind = process_gen(lin.gen, i, h, l, c, label)
                if lin.gen.stage2_formed:
                    lin.anchor_retired = True
                if gen_sl_kind == "deep":
                    # A recovery window opens EITHER because this gen reached its own "2" (the
                    # ordinary rule -- BAR/SAR's very first promotion onto the ladder needs BAR
                    # 2/SAR 2's own reference to reform against), OR because this gen was
                    # already a ladder rung (REAR BUY/SELL or their RE ENTER) -- confirmed by
                    # the user against 06-03-2022/10-03-2022: once a lineage is already on the
                    # ladder, a further rung dying BEFORE reaching its own "2" still gets a
                    # recovery window, using that rung's own plain (pre-"2") reference. Only
                    # the FIRST promotion onto the ladder (plain BAR/SAR with no ladder history
                    # yet) still requires its own "2" -- confirmed unaffected by 15-02-2021
                    # (plain BAR dies pre-its-own-"2", no REAR possible, only a fresh TZ GREEN).
                    #
                    # The recovery's NAME only escalates one rung up the ladder if this gen
                    # actually reached its own "2" before dying; a rung dying pre-its-own-"2"
                    # reforms under the SAME label it already had, no escalation -- confirmed
                    # by the user, correcting an intermediate version of this fix: REAR BUY
                    # (formed 02-03-2022) died pre-its-own-"2" on 06-03-2022, and the recovery
                    # reforming above its own High (315) on 10-03-2022 is labeled plain
                    # "REAR BUY" again, NOT "REAR BUY RE ENTER" ("since REAR BUY 2 never
                    # formed" -- RE ENTER is reserved for escalating OFF an actual "2").
                    if lin.gen.stage2_formed or lin.recovery_label is not None:
                        ref_val = lin.gen.ref_high if bullish else lin.gen.ref_low
                        lin.rear_recovery = {
                            "ref": ref_val,
                            "target_label": escalated_label(lin) if lin.gen.stage2_formed else label,
                            "source_2": f"{label} 2" if lin.gen.stage2_formed else label,
                        }
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
            # SL") does NOT stop or restart anything -- it is logged (`terminal_on_shallow=False`
            # below keeps the Struct alive and untouched -- no recovery window, no reforming
            # "TZ GREEN 2"/"TZ RED 2"). The anchor's DEEP SL is the ONLY anchor-level SL that
            # matters, and it must keep being checked for as long as this lineage's gen hasn't
            # taken over -- confirmed by the user against 11-01-2022: even with a GREEN1/GREEN2
            # pullback already attached and resolving, the anchor's own deep SL (`TZ RED SL`)
            # still fires that day and kills the ENTIRE lineage, pullback included, before that
            # day's GREEN2 gets a chance to matter (the `continue` below skips this lineage's
            # pullback processing for the day the deep SL fires, exactly like every other
            # complete-lineage-death path in this file). A pullback attaching does NOT retire
            # the anchor -- only the gen reaching its own "2" stage does (anchor_retired, below):
            # from that point BAR 2/REAR 2/etc. has its own separate deep-SL reference and the
            # anchor's own (now long-stale) one would be a redundant, unrelated failure mode.
            if not lin.anchor_retired and lin.anchor is not None and lin.anchor.alive:
                anchor_sl_kind = process_gen(lin.anchor, i, h, l, c, anchor_name, terminal_on_shallow=False, governed=True)
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

            if lin.pullback is not None and lin.pullback["active"]:
                process_pullback(lin, i, h, l, c, ph, pl)
            elif front_ok_for_attach and not gen_pending:
                # Deferred, not attached immediately -- see the precedence resolution after
                # this loop: if another lineage's front was born the exact same day as this
                # one's, only the OLDER lineage gets to attach a fresh RED1/GREEN1 today.
                fresh_attach_candidates.append((lin, front))

            # --- fresh gen formation off the shared gen_pending signal ---
            if gen_pending and (front_stage2_before_today or lin.gen_fresh_pending):
                if formation_break(ph, pl, h, l, c):
                    new_gen = Struct(h, l, gen_name, formed_day=i)
                    lin.gen = new_gen
                    lin.gen_started = True
                    lin.recovery_label = None
                    lin.gen_fresh_pending = False
                    events[i].append(gen_name)
                    consumed_gen_pending_today = True

        # Fresh RED1/GREEN1 attach precedence: the attach formula itself is a raw price-
        # action check (doesn't reference any lineage-specific reference), so every eligible
        # lineage would independently "notice" the same breakout candle. When 2+ eligible
        # lineages' CURRENT fronts were born the exact same day, only the OLDER lineage (by
        # created_day) actually attaches -- confirmed by the user against the 10-03-2022 dual
        # formation (TZ GREEN and REAR BUY RE ENTER both born that day): "it will attach to
        # REAR BUY [the older lineage]." When fronts were born on DIFFERENT days (even if
        # both lineages are simultaneously eligible), both attach independently and get the
        # dual-tag treatment instead -- confirmed against 04-03-2022, unaffected by this.
        by_front_day = {}
        for lin, front in fresh_attach_candidates:
            by_front_day.setdefault(front.formed_day, []).append(lin)
        for day, same_day_lins in by_front_day.items():
            if len(same_day_lins) > 1:
                winner = min(same_day_lins, key=lambda l: (l.created_day if l.created_day is not None else -1))
                process_pullback(winner, i, h, l, c, ph, pl)
            else:
                process_pullback(same_day_lins[0], i, h, l, c, ph, pl)

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
