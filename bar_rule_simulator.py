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
        # The fresh-anchor lineage that THIS lineage's own dying gen most recently spawned as
        # its paired dual-track counterpart (via the gated re-arming below), if any -- used
        # to tell "this lineage's own further ladder failures" apart from "a totally
        # unrelated, independent history" when deciding whether the house-wide fresh-anchor
        # search needs reopening again. None until this lineage's gen has deep-SL'd (or
        # bar2_recovery-escalated) at least once.
        self.competitor = None
        # Which gen_pending "episode" (see run_house's gen_pending_episode counter) this
        # lineage most recently declined a fresh-gen-formation off of, because an OLDER
        # lineage's own rear_recovery resolved the exact same day (see the older-lineage-
        # precedence gating below). None until a decline has happened; compared against the
        # CURRENT episode counter so a later, genuinely NEW gen_pending (a fresh RED2/GREEN2)
        # re-opens eligibility rather than leaving this lineage permanently blocked.
        self.declined_gen_pending_episode = None
        # True once this lineage has LOST an older-lineage-precedence collision (its own gen-
        # formation declined in favor of an older lineage reaching the same or an equivalent-
        # shape outcome the same day). Permanent, unlike declined_gen_pending_episode -- this
        # lineage's own front must never independently start a FRESH pullback again, since its
        # future is redundant with the older lineage's from that point on. Deliberately does
        # NOT set `dead` -- this lineage's own anchor/gen HH/LL/SL tracking, and its role in
        # competitor-pairing elsewhere, are unrelated mechanics and must keep working exactly
        # as before; only starting a NEW pullback is what's actually redundant here. Confirmed
        # by the user against 21-05-2022/23-05-2022 ("2 different lineages... why mentioned
        # both?"): the lineage that lost the 18-05-2022 SAR-formation race kept independently
        # firing its own dual-tagged GREEN1/GREEN1 SL days later -- that's the specific thing
        # this flag stops, nothing more.
        self.superseded = False
        # The exact front Struct object whose RED2/GREEN2 has already confirmed once. A front
        # only ever gets ONE pullback cycle -- once RED2/GREEN2 fires against it, it cannot
        # host a SECOND, fresh RED1/GREEN1 attach without first changing identity (a genuinely
        # NEW Struct forming for this lineage, via any reform/formation path) -- confirmed by
        # the user against 11-02-2022: RED2 already confirmed 10-02-2022, "there is no BUY
        # event in between, hence RED1 and RED2 not possible" on 11-02-2022 against the SAME,
        # unchanged BAR2. Compared by object identity, so a later front change (a new Struct)
        # naturally re-opens eligibility without needing an explicit reset.
        self.pullback_used = None


def run_house(rows, bullish, gen_name, anchor_name):
    events = [[] for _ in rows]
    pullback_buffer = [[] for _ in rows]
    lineages = []
    gen_pending = False        # shared per-house: any lineage's RED2 sets it; any eligible lineage may consume it
    # Bumped every time gen_pending newly turns True (a fresh RED2/GREEN2) -- lets a lineage's
    # declined-due-to-collision state (Lineage.declined_gen_pending_episode) tell "the same
    # still-pending signal I already declined" apart from "a genuinely new one," so a forfeited
    # opportunity stays forfeited only for its own episode, not forever.
    gen_pending_episode = 0
    awaiting_fresh_anchor = True
    # Set (to the dying lineage) at the moment a gen-deep-SL/bar2_recovery-escalation reopens
    # awaiting_fresh_anchor via the gated paths below; consumed the moment the resulting fresh
    # anchor actually forms, pairing the two as dual-track counterparts (see Lineage.competitor).
    pending_competitor_source = None

    def up_break(ph, pl, h, l, c):
        return l >= pl and h > ph + THRESH and c >= ph

    def down_break(ph, pl, h, l, c):
        return h <= ph and l < pl - THRESH and c <= pl

    def formation_break(ph, pl, h, l, c):
        return up_break(ph, pl, h, l, c) if bullish else down_break(ph, pl, h, l, c)

    def rear_recovery_would_resolve(rec, h, l, c, ph, pl):
        ref = rec["ref"]
        if bullish:
            return l >= pl and h > ref + THRESH and c >= ref
        return h <= ph and l < ref - THRESH and c <= ref

    def would_deep_sl(s, h, l, c):
        """Side-effect-free peek at whether s (a gen or anchor Struct) would deep-SL today,
        mirroring process_gen's own deep_sl condition exactly. Used to check the ANCHOR's own
        deep-SL condition BEFORE processing its lineage's gen for the day (see the gen-skip
        below), without mutating anything or printing."""
        if not s.stage2_formed:
            if bullish:
                return (s.ref_low - l) >= THRESH and c <= s.ref_low
            return (h - s.ref_high) >= THRESH and c >= s.ref_high
        if bullish:
            deep_threshold = min(s.bar_ref_low, s.ref_low)
            return (deep_threshold - l) >= THRESH and c <= deep_threshold
        deep_threshold = max(s.bar_ref_high, s.ref_high)
        return (h - deep_threshold) >= THRESH and c >= deep_threshold

    def current_label(lin):
        return lin.recovery_label or gen_name

    def escalated_label(lin):
        """The label a deep-SL recovery escalates TO. None -> REAR BUY/SELL -> REAR BUY/SELL
        RE ENTER (terminal). House-specific: House of Bull uses REAR BUY, House of Bear uses
        REAR SELL -- same mechanism, side-specific name."""
        rear = "REAR BUY" if bullish else "REAR SELL"
        return rear if lin.recovery_label is None else f"{rear} RE ENTER"

    def retire_other_pending(winner):
        """The moment ANY lineage re-establishes itself past its own "2" (gen or anchor), every
        OTHER lineage's still-pending recovery search (rear_recovery/bar2_recovery) that is NOT
        winner's own directly-paired dual-track competitor is retired outright -- it belongs to
        an older, already-superseded race, not the current one. The direct pair (winner and
        whichever lineage it is paired with via Lineage.competitor, checked both ways) is
        deliberately exempt: that specific dyad staying alive at once, each side independently
        progressing for as long as it takes, is the confirmed, intentional dual-track (27-02
        through 06-03-2022; 26-05 through 09-06-2022 -- REAR SELL/REAR SELL 2 still validly
        applying at 03-06/04-06-2022 despite the paired fresh TZ RED already reaching TZ RED 2
        on 29-05-2022: "REAR SELL AND REAR SELL 2 OCCURRED AND WILL BE APPLIED"). What must NOT
        persist is an unrelated, older lineage from a PREVIOUS, already-resolved race -- e.g. one
        formed back on 08-02-2022 whose own paired competitor died long ago -- still sitting
        dormant and resurfacing (a REAR SELL reform, then a further fresh-anchor search) many
        cycles later, well after a completely different, currently-active lineage has already
        re-reached its own "2" one or more times over. Confirmed by the user against
        17-06-2022/24-06-2022.
        """
        for other in lineages:
            if other is winner or other.dead:
                continue
            if other is winner.competitor or other.competitor is winner:
                continue
            if other.rear_recovery is not None or other.bar2_recovery is not None:
                other.rear_recovery = None
                other.bar2_recovery = None
                other.dead = True

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
            if not governed:
                # The gen's own inner reference keeps ratcheting independently even on the
                # SAME day it deep-SLs -- this is a genuinely separate axis (today's LOW
                # extending the inner ref_low further, vs. today's HIGH breaking the deep/
                # outer threshold), not a lesser event superseded by the more severe SL, the
                # way shallow-vs-deep SL naming is superseded (§6). Confirmed by the user
                # against 26-05-2022 ("every SAR 2 LL is very important. Why did you fail to
                # record?") -- SAR2's own ref_low had genuinely moved further that same day
                # (315.5, below its prior 316) independent of the unrelated upside SL breakout.
                if h > s.ref_high + ANY:
                    s.ref_high = h
                    events[i].append(f"{label} 2 HH")
                if l < s.ref_low - ANY:
                    s.ref_low = l
                    events[i].append(f"{label} 2 LL")
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

    def process_pullback(lin, i, h, l, c, ph, pl, front=None):
        nonlocal gen_pending, gen_pending_episode
        pullback = lin.pullback
        if pullback is None or not pullback["active"]:
            if bullish:
                attach = h <= ph and (pl - l) >= THRESH and c <= pl
            else:
                attach = l >= pl and (h - ph) >= THRESH and c >= ph
            if attach:
                lin.pullback = {"ref_high": h, "ref_low": l, "active": True, "front": front}
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
            # This front's ONE pullback cycle is now used up -- confirmed by the user against
            # 11-02-2022 (see Lineage.pullback_used): it cannot host a second, fresh RED1/
            # GREEN1 attach without first changing identity (a genuinely new front).
            lin.pullback_used = pb.get("front")
            gen_pending = True
            gen_pending_episode += 1
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
        gen_formation_candidates = []

        # 0. Fresh anchor search -- always live once triggered by an SL, until it succeeds.
        # Forfeited outright -- not merely deferred -- on a day where this exact breakout
        # ALSO coincides with an EXISTING lineage's own pending REAR BUY/SELL (or RE ENTER)
        # recovery resolving. Confirmed by the user against 10-03-2022/11-03-2022: an
        # intermediate version of this fix let the fresh anchor keep waiting and form on the
        # very next non-colliding day (11-03-2022) -- rejected: "You cannot adjust to further
        # dates just because it was not shown during earlier dates... does not mean it can be
        # carried forward to next dates just like that." The reasoning given: once the older
        # lineage's own future descendants (RED1/RED2/BAR/...) would follow identical rules,
        # a parallel TZ GREEN adds nothing worth recording, so the opportunity is simply
        # consumed/forfeited, not rescheduled -- awaiting_fresh_anchor is cleared here without
        # ever forming an anchor. A later, NEW deep SL still reopens the search as usual.
        blocked_by_older_recovery = any(
            lin.rear_recovery is not None and rear_recovery_would_resolve(lin.rear_recovery, h, l, c, ph, pl)
            for lin in lineages
        )
        # A fresh TZ GREEN/TZ RED anchor cannot form on a day where ANY (non-dead) lineage is
        # sitting in gen_fresh_pending -- that state means RED2/GREEN2 has ALREADY fired for
        # that lineage's dead "2", so its own recovery is GUARANTEED to be a full fresh restart
        # on the SAME lineage (plain BAR/SAR reforming) the moment formation_break allows it --
        # never a brand-new competing anchor. Confirmed by the user: "if a REAR 2 has occurred,
        # or SAR 2 has occurred and there is an SL of [that] 2nd and there is GREEN 2, then TZ
        # GREEN CANNOT OCCUR" -- against 24-06-2022, where an unrelated, long-dormant lineage's
        # own independently-pending fresh-anchor search (open since 20-06-2022) coincidentally
        # resolved into a fresh "TZ RED" the SAME day the actually-current lineage's SAR 2 SL
        # (23-06-2022, itself already past GREEN 2) forced its own guaranteed full restart into
        # plain "SAR" -- the TZ RED must not print at all that day.
        blocked_by_gen_fresh_pending = any(lin.gen_fresh_pending for lin in lineages if not lin.dead)
        # Snapshot, BEFORE any lineage is processed today, which lineages' rear_recovery would
        # resolve today -- used below to gate a DIFFERENT, younger lineage's fresh-gen-formation
        # off gen_pending on the same older-lineage-precedence principle (see there). Must be
        # captured here, not re-checked per-lineage later in the loop below, since an older
        # lineage's own rear_recovery gets resolved and cleared to None during ITS OWN turn in
        # that same loop, before a younger lineage processed afterward would get to see it.
        resolving_rear_recovery_created_days = [
            lin.created_day for lin in lineages
            if lin.rear_recovery is not None and rear_recovery_would_resolve(lin.rear_recovery, h, l, c, ph, pl)
        ]
        if awaiting_fresh_anchor and formation_break(ph, pl, h, l, c) and (blocked_by_older_recovery or blocked_by_gen_fresh_pending):
            awaiting_fresh_anchor = False
        elif awaiting_fresh_anchor and formation_break(ph, pl, h, l, c):
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
            if pending_competitor_source is not None:
                pending_competitor_source.competitor = lin
                pending_competitor_source = None
            else:
                # This search wasn't opened by a gen-deep-SL/bar2_recovery-escalation (which
                # always sets pending_competitor_source) -- it was an anchor's own unconditional
                # total death instead, which pairs with nothing. If some OTHER lineage already
                # holds a currently-pending recovery search at this exact moment, it is the
                # genuinely current, still-relevant one (not a stale leftover) -- pair it as this
                # new anchor's competitor so retire_other_pending (see there) does not mistake it
                # for an unrelated older race the first time this brand-new anchor reaches its
                # own "2". Confirmed against 06-05-2022/07-05-2022: the currently-active lineage
                # (formed 13-04-2022) had a legitimate rear_recovery pending when an unrelated
                # anchor total-death spawned a fresh TZ RED that day -- without this pairing, that
                # TZ RED reaching TZ RED 2 the very next day wrongly retired the still-relevant
                # rear_recovery, silently erasing the later, correct "REAR SELL" reform.
                for other in lineages:
                    if other is not lin and not other.dead and (
                        other.rear_recovery is not None or other.bar2_recovery is not None
                    ):
                        other.competitor = lin
                        break

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
                # original rule, that forecloses the LIGHTER "NEW BAR2 reforms directly" outcome
                # specifically; a full fresh BAR/gen forms instead once formation_break allows
                # it (gen_fresh_pending, checked below). This does NOT abandon bar2_recovery
                # itself, though -- the deep/outer threshold it tracks is a real, independent
                # price fact (whether BAR's own outer reference is ALSO breached) that must keep
                # being checked regardless of which reform path eventually applies -- confirmed
                # by the user against 24-04-2022: the deep threshold (329) was breached that
                # day and `BAR SL` was wrongly missing because an earlier version of this fix
                # nulled bar2_recovery outright the moment gen_pending fired, silently
                # discarding the escalation check below along with it.
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
                    # Escalating into the heavier ladder recovery supersedes the lighter
                    # "ordinary fresh restart off gen_pending" path entirely -- clear
                    # gen_fresh_pending so the "fresh gen formation" trigger further below
                    # can't ALSO independently fire for this SAME lineage while its
                    # rear_recovery is still pending (which would leave both a freshly-formed
                    # gen AND a dangling rear_recovery on the same lineage at once).
                    lin.gen_fresh_pending = False
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
                    # Only reopen the house-wide fresh-anchor search if THIS lineage doesn't
                    # already have a live paired competitor from an EARLIER round of its own
                    # recovery race -- confirmed by the user (03-05-2022): once a fresh anchor
                    # already exists from an earlier failure of this SAME dying lineage's own
                    # ladder, a further failure of that ladder must not spawn a SECOND,
                    # redundant competing fresh anchor while the first one is still alive
                    # ("SAR has already occurred for GREEN2. New TZ RED cannot co-occur.
                    # Basics"). This is scoped to THIS lineage's own paired competitor, not
                    # "any other lineage in the house" -- an unrelated, long-dormant lineage
                    # elsewhere (e.g. one quietly waiting on its own never-reached rear_recovery
                    # target) must not block a completely separate lineage's legitimate first
                    # race. The anchor's own deep SL (below) stays unconditional -- that is
                    # total, unconditional lineage death, not a partial one, so it always needs
                    # a fresh search regardless of pairing.
                    # A competitor that has been superseded (permanently lost an older-lineage-
                    # precedence collision -- see Lineage.superseded) is, for this purpose, a
                    # dead end exactly like a fully dead one: its own future is redundant with
                    # the lineage that beat it, so it can never independently reform or matter
                    # again even though nothing ever sets its `dead` flag. Without this, a
                    # superseded competitor's own anchor sits "alive" forever, permanently
                    # blocking this lineage from ever reopening a fresh-anchor search again --
                    # confirmed against 26-05-2022/28-05-2022: the lineage formed 06-05-2022
                    # was superseded on 18-05-2022, but without this check its still-`alive`
                    # anchor wrongly blocked the legitimate fresh "TZ RED" that should reopen
                    # and form again on 28-05-2022.
                    if lin.competitor is None or lin.competitor.dead or lin.competitor.superseded:
                        awaiting_fresh_anchor = True
                        pending_competitor_source = lin
                    # This is a state TRANSITION for the gen (shallow SL escalating into the
                    # deeper ladder recovery), not a total lineage death -- only the ANCHOR's
                    # own deep SL is that (see the unconditional `continue` there). An ALREADY-
                    # ACTIVE pullback must still get to resolve/ratchet today regardless,
                    # exactly like it already does across an ordinary gen deep SL (confirmed
                    # 01-03-2022, GREEN2 alongside SAR SL) -- this mirrors that same rule at
                    # this transition point too.
                    if lin.pullback is not None and lin.pullback["active"]:
                        process_pullback(lin, i, h, l, c, ph, pl)
                    continue
                if bullish:
                    recovers = l >= pl and h > ref + THRESH and c >= ref
                else:
                    recovers = h <= ph and l < ref - THRESH and c <= ref
                if recovers:
                    if lin.gen_fresh_pending:
                        # RED2/GREEN2 already fired before this recovery -- per the rule above,
                        # the lighter "NEW BAR2 reforms directly" reform is foreclosed even
                        # though price DID recover past the shallow reference; simply drop the
                        # now-resolved recovery and let the ordinary fresh-gen-formation trigger
                        # (below, off its own formation_break condition) decide when the actual
                        # fresh BAR/gen forms, on this day or a later one.
                        lin.bar2_recovery = None
                        if lin.pullback is not None and lin.pullback["active"]:
                            process_pullback(lin, i, h, l, c, ph, pl)
                    else:
                        new_gen = Struct(h, l, gen_name, formed_day=i)
                        new_gen.stage2_formed = True
                        if bullish:
                            new_gen.bar_ref_low = rec["outer"]
                        else:
                            new_gen.bar_ref_high = rec["outer"]
                        lin.gen = new_gen
                        lin.bar2_recovery = None
                        events[i].append(f"{current_label(lin)} 2")
                        retire_other_pending(lin)
                        # Same rationale as above -- reforming the gen today isn't a total
                        # death, so an already-active pullback still gets to resolve/ratchet
                        # today too.
                        if lin.pullback is not None and lin.pullback["active"]:
                            process_pullback(lin, i, h, l, c, ph, pl)
                    continue
                else:
                    base = current_label(lin)
                    inner_label = f"{base} 2"
                    inner_adverse = rec["inner_adverse"]
                    # Once gen_pending has already foreclosed the lighter "NEW BAR2 reforms
                    # directly" outcome (gen_fresh_pending), these routine ratchet EVENTS are
                    # tracking a recovery target that will never actually be used -- only a
                    # full fresh restart (via formation_break) or the deep escalation above
                    # still matter from here. Printing them is misleading noise (implying an
                    # active, meaningful recovery target that no longer exists) -- confirmed by
                    # the user against 18-02-2022 ("BAR 2 SL already triggered [17-02], how is
                    # BAR 2 LL now possible?"). The underlying rec[...] VALUES still update
                    # unconditionally below regardless -- they still feed the deep-threshold
                    # escalation check above, which must keep working exactly as before.
                    silent = lin.gen_fresh_pending
                    # Favorable-side (recovery-target) reference: an attempt at reforming the
                    # "2" that ticks the reference further out without yet fully qualifying
                    # (Low/Close conditions not checked here -- same simple ANY-threshold
                    # ratchet as the deep-SL "INVALID {X} HH/LL" below).
                    if bullish:
                        if h - ref >= ANY:
                            rec["ref"] = h
                            if not silent:
                                events[i].append(f"INVALID {base} HH")
                    else:
                        if ref - l >= ANY:
                            rec["ref"] = l
                            if not silent:
                                events[i].append(f"INVALID {base} LL")
                    # Adverse-side outer/inner references, unchanged mechanic.
                    if bullish:
                        if rec["outer"] - l >= ANY:
                            rec["outer"] = l
                            if not silent:
                                events[i].append(f"{base} LL")
                        if inner_adverse - l >= ANY:
                            rec["inner_adverse"] = l
                            if not silent:
                                events[i].append(f"{inner_label} LL")
                    else:
                        if h - rec["outer"] >= ANY:
                            rec["outer"] = h
                            if not silent:
                                events[i].append(f"{base} HH")
                        if h - inner_adverse >= ANY:
                            rec["inner_adverse"] = h
                            if not silent:
                                events[i].append(f"{inner_label} HH")

            # --- Deep-SL recovery window: escalate to the next recovery level directly ---
            if lin.rear_recovery is not None:
                rec = lin.rear_recovery
                target = rec["target_label"]
                ref = rec["ref"]
                recovers = rear_recovery_would_resolve(rec, h, l, c, ph, pl)
                if recovers:
                    new_gen = Struct(h, l, target, formed_day=i)
                    lin.gen = new_gen
                    lin.gen_started = True
                    lin.recovery_label = target
                    lin.rear_recovery = None
                    events[i].append(target)
                    # Same rationale as the bar2_recovery transitions above -- reforming the
                    # gen today (REAR BUY/SELL or a RE ENTER rung) isn't a total lineage death,
                    # so an already-active pullback still gets to resolve/ratchet today too.
                    if lin.pullback is not None and lin.pullback["active"]:
                        process_pullback(lin, i, h, l, c, ph, pl)
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

            # Peek (side-effect-free) whether this lineage's ANCHOR would ALSO deep-SL today,
            # BEFORE processing its gen. The anchor's deep SL is total, unconditional lineage
            # death (see the anchor-level processing block below); if it's also happening
            # today, the gen's own SL that same day is redundant -- confirmed by the user
            # (04-05-2022): "since TZ RED SL occurred, why need to record its descendant SAR
            # SL?" -- so the gen isn't even processed today, and only the anchor's own "TZ RED
            # SL" prints.
            anchor_dying_today = (
                not lin.anchor_retired and lin.anchor is not None and lin.anchor.alive
                and would_deep_sl(lin.anchor, h, l, c)
            )

            # Whether THIS lineage's gen deep-SL'd today -- used below to block a FRESH
            # RED1/GREEN1 attach from starting the same day (see the fresh-attach eligibility
            # comment further down). An ALREADY-active pullback is unaffected by this flag; it
            # keeps resolving/ratcheting through a deep SL regardless (confirmed 01-03-2022).
            gen_deep_sl_today = False

            # --- gen's own SL/stage2/HH-LL ---
            if lin.gen is not None and lin.gen.alive and not anchor_dying_today:
                label = current_label(lin)
                was_stage2 = lin.gen.stage2_formed
                gen_sl_kind = process_gen(lin.gen, i, h, l, c, label)
                if lin.gen.stage2_formed:
                    lin.anchor_retired = True
                    if not was_stage2:
                        retire_other_pending(lin)
                if gen_sl_kind == "deep":
                    gen_deep_sl_today = True
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
                    # Same gating (by this lineage's own paired competitor, not any other
                    # lineage), including the superseded-counts-as-dead extension, as the
                    # bar2_recovery-escalation site above -- see that comment for the full
                    # rationale (03-05-2022; 26-05-2022/28-05-2022).
                    if lin.competitor is None or lin.competitor.dead or lin.competitor.superseded:
                        awaiting_fresh_anchor = True
                        pending_competitor_source = lin
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
                was_anchor_stage2 = lin.anchor.stage2_formed
                anchor_sl_kind = process_gen(lin.anchor, i, h, l, c, anchor_name, terminal_on_shallow=False, governed=True)
                if lin.anchor.stage2_formed and not was_anchor_stage2:
                    retire_other_pending(lin)
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

            # Fresh-attach eligibility for RED1/GREEN1 uses the SAME pre-today snapshot as
            # fresh-gen-formation (front_stage2_before_today), not today's post-SL live state --
            # confirmed by the user (22-04-2022/23-04-2022): a fresh RED1 attach is a raw,
            # same-day price-action pattern (today's H/L/C vs. yesterday's H/L) unrelated to
            # whatever today's gen SL does to the Struct object; a gen's own SHALLOW SL already
            # dying today must not retroactively block a fresh attach that the day's own price
            # action otherwise supports. `attach_front` falls back to yesterday's front object
            # (whose `.formed_day` the precedence-tiebreak grouping needs) when today's own
            # front is now None because its gen just died today.
            #
            # This does NOT extend to a DEEP SL day, though -- confirmed by the user against
            # 25-04-2022 ("SAR SL occurred, then why GREEN1? Deep SL then what is the point of
            # GREEN1?"): a deep SL is total generation failure (opening the REAR-ladder/fresh-
            # anchor dual-track, §8), and a BRAND-NEW pullback has no live front left worth
            # starting to track against that same day -- unlike an ALREADY-active pullback,
            # which keeps resolving/ratcheting through a deep SL regardless because it has its
            # own independent standing from before the death (confirmed 01-03-2022, GREEN2
            # alongside SAR SL -- see `gen_deep_sl_today`, which only gates the FRESH-attach
            # branch below, not the already-active continuation branch).
            # A lineage that has LOST an older-lineage-precedence collision (Lineage.superseded)
            # must never independently start a FRESH pullback again either -- confirmed by the
            # user against 21-05-2022/23-05-2022 (see that field's own comment for the full
            # rationale). An ALREADY-active pullback (checked separately, above/below) is
            # unaffected -- this only blocks a brand-new attach.
            # A front whose own RED2/GREEN2 has ALREADY confirmed once cannot host a second,
            # fresh attach without first changing identity -- confirmed by the user against
            # 11-02-2022 (see Lineage.pullback_used): RED2 already confirmed 10-02-2022, and
            # with no new BAR forming in between, a fresh RED1 re-attaching to the SAME,
            # unchanged BAR2 on 11-02-2022 is not possible.
            attach_front = front if front is not None else front_before_today
            front_already_used = attach_front is not None and attach_front is lin.pullback_used
            front_ok_for_attach = (
                attach_front is not None and not gen_deep_sl_today and not lin.superseded
                and not front_already_used
                and (front_stage2_before_today or (front is not None and front.stage2_formed))
            )

            if lin.pullback is not None and lin.pullback["active"]:
                process_pullback(lin, i, h, l, c, ph, pl)
            elif front_ok_for_attach:
                # NOT gated on `gen_pending` -- confirmed by the user (01-03-2022: "TZ GREEN 2
                # completed, hence RED1 and RED2 is valid"): gen_pending is a single, PER-HOUSE
                # shared flag, set by whichever lineage's RED2/GREEN2 happens to fire, and can
                # sit unconsumed for weeks (nothing else in the house independently triggers a
                # fresh-gen-formation). Gating a completely different, independently-eligible
                # lineage's fresh attach on that unrelated flag blocked TZ GREEN2's own RED1
                # for the entire 02-03 through 07-03-2022 stretch, even though its own front had
                # been eligible since 01-03 -- confirmed numerically (front_ok_for_attach was
                # True every one of those days; gen_pending, stale since 17-02-2022, was the
                # only thing blocking it).
                #
                # Deferred, not attached immediately -- see the precedence resolution after
                # this loop: if another lineage's front was born the exact same day as this
                # one's, only the OLDER lineage gets to attach a fresh RED1/GREEN1 today.
                fresh_attach_candidates.append((lin, attach_front))

            # --- fresh gen formation off the shared gen_pending signal ---
            if (
                gen_pending
                and (front_stage2_before_today or lin.gen_fresh_pending)
                and lin.declined_gen_pending_episode != gen_pending_episode
            ):
                if formation_break(ph, pl, h, l, c):
                    # Older-lineage precedence, same principle as the top-level fresh-anchor-
                    # vs-older-recovery gate (§8): if an OLDER lineage's own rear_recovery is
                    # ALSO resolving this exact day, this lineage's fresh gen would have "the
                    # same future impact" from here (own "2" -> SL -> RED1/GREEN1 -> reform,
                    # under whatever name) as the older lineage's own reform -- confirmed by
                    # the user against 02-03-2022 ("REAR BUY + BAR" -- only REAR BUY should
                    # print; the older lineage is proper).
                    blocked_by_older_recovery_here = any(
                        cd is not None and lin.created_day is not None and cd < lin.created_day
                        for cd in resolving_rear_recovery_created_days
                    )
                    if blocked_by_older_recovery_here:
                        # Per-day decline ONLY -- does NOT set `superseded`. This collision type
                        # (an older lineage's REAR-ladder reform vs. a younger lineage's
                        # would-be plain gen) is provisional, not a declaration that the two
                        # lineages now share one identity: the older lineage (REAR BUY/SELL)
                        # hasn't necessarily reached its own "2" yet, so there is no guarantee
                        # it will ever independently do what the younger lineage's OWN front
                        # might do later. Confirmed by the user against 04-03-2022 (and the
                        # same principle at 23-03/24-03-2022, 17-04/18-04-2022): TZ GREEN
                        # (declined here on 02-03-2022 in favor of REAR BUY, which never
                        # reaches REAR BUY 2 before dying) must still independently attach its
                        # own RED1 on 04-03-2022 -- "if REAR BUY 2 would have occurred before
                        # 04-03, then excluding TZ GREEN makes sense" -- since REAR BUY 2 never
                        # happens, there is no actual collision with TZ GREEN's own RED1 at
                        # all, ever, in this window. Contrast the OTHER decline branch below
                        # (gen_formation_candidates), where BOTH lineages reach the IDENTICAL
                        # plain name via the SAME mechanism -- a real, permanent merge.
                        lin.declined_gen_pending_episode = gen_pending_episode
                    else:
                        # Deferred, not formed immediately -- see the precedence resolution
                        # after this loop: if ANOTHER lineage would ALSO independently form a
                        # plain gen off this SAME gen_pending signal today, only the OLDEST
                        # lineage actually forms it (both would reach the identical plain name
                        # and an identical future shape from here, so the younger one is
                        # redundant) -- confirmed by the user against 18-05-2022 ("2 different
                        # lineages were at the same occurrence of SAR -- mention the earlier
                        # one"). Genuinely different same-day events (one lineage reaching a
                        # ladder reform, another's pullback ticking) are unaffected -- those are
                        # already handled separately (dual-tagged pullback events, or the
                        # rear_recovery-collision gate above).
                        gen_formation_candidates.append(lin)

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
        lin_to_front = dict(fresh_attach_candidates)
        for lin, front in fresh_attach_candidates:
            by_front_day.setdefault(front.formed_day, []).append(lin)
        for day, same_day_lins in by_front_day.items():
            if len(same_day_lins) > 1:
                winner = min(same_day_lins, key=lambda l: (l.created_day if l.created_day is not None else -1))
                process_pullback(winner, i, h, l, c, ph, pl, front=lin_to_front[winner])
            else:
                process_pullback(same_day_lins[0], i, h, l, c, ph, pl, front=lin_to_front[same_day_lins[0]])

        # Older-lineage precedence among 2+ lineages that would ALL independently form a
        # plain gen off the SAME gen_pending signal today (see the comment at the collection
        # site above) -- only the oldest actually forms it; the rest decline this episode.
        if gen_formation_candidates:
            winner = min(
                gen_formation_candidates,
                key=lambda l: (l.created_day if l.created_day is not None else -1),
            )
            for lin in gen_formation_candidates:
                if lin is winner:
                    new_gen = Struct(h, l, gen_name, formed_day=i)
                    lin.gen = new_gen
                    lin.gen_started = True
                    lin.recovery_label = None
                    lin.gen_fresh_pending = False
                    # A prior generation's bar2_recovery is now fully superseded by this brand-
                    # new gen and must be abandoned, not left ticking in parallel -- this
                    # trigger path (fresh gen off gen_pending) is a SEPARATE mechanism from
                    # bar2_recovery's own escalate/recover/ratchet handling, and doesn't
                    # otherwise touch it at all. Found via 15-06-2022 printing "INVALID SAR LL +
                    # SAR LL" under the SAME lineage that had already formed a brand-new SAR on
                    # 12-06-2022 -- a stale prior-generation reference was still ticking under
                    # the new gen's own current label days after the new gen made it moot. Left
                    # unabandoned, it could also later "recover" on its own criteria and silently
                    # overwrite this brand-new, unrelated gen.
                    lin.bar2_recovery = None
                    events[i].append(gen_name)
                    consumed_gen_pending_today = True
                else:
                    lin.declined_gen_pending_episode = gen_pending_episode
                    # Also permanent -- see Lineage.superseded.
                    lin.superseded = True

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

print(f"{'DATE':12}{'OPEN':8}{'HIGH':8}{'LOW':8}{'CLOSE':8}{'BULL EVENT':40}BEAR EVENT")
for i, (d, o, h, l, c) in enumerate(rows):
    be = " + ".join(bull_events[i])
    re = " + ".join(bear_events[i])
    print(f"{d:12}{o:<8}{h:<8}{l:<8}{c:<8}{be:40}{re}")
