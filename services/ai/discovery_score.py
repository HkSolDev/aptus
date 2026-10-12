"""Untested starting weights for static recruitment-link ranking."""

import re
import unicodedata


SPECIFIC = r"recruitment advertisement|recruitment notice|applications? invited|online form|offline form|भर्ती.*विज्ञापन|पद.*आवेदन.*आमंत्रित"
RECRUITMENT = r"\brecruitment\b|\bvacanc(?:y|ies)\b|\bcareers?\b|भर्ती|रिक्ति|रिक्त पद"
BRIDGE = r"careers?|recruitment(?: section| advertisements?)?|current vacancies|vacancies|भर्ती(?: अनुभाग)?|वर्तमान रिक्तियाँ"
RELATED = r"\bresults?\b|admit card|answer key|hall ticket|exam schedule|exam date|परिणाम|प्रवेश पत्र|उत्तर कुंजी"
UNRELATED = r"\btender\b|\bscholarship\b|\bprivacy\b|\blogin\b|\blog in\b|निविदा|छात्रवृत्ति|गोपनीयता|लॉगिन"
IDENTIFIER = r"\b(?:advt\.?|advertisement)\s*(?:no\.?|number)|विज्ञापन\s*(?:संख्या|सं\.)"


def normalize(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).casefold().split())


def score_link(anchor: str, nearby: str, heading: str, url: str) -> dict:
    anchor, nearby, heading, url = map(normalize, (anchor, nearby, heading, url))
    notice = bridge = 0
    reasons = []

    def add(rule, field, match, n=0, b=0):
        nonlocal notice, bridge
        notice += n
        bridge += b
        reasons.append({"rule": rule, "field": field, "match": match,
                        "notice_delta": n, "bridge_delta": b})

    # A repeated cue in the anchor and its row earns points only once.
    for pattern, rule, points in ((SPECIFIC, "specific_recruitment", 6),
                                  (RECRUITMENT, "general_recruitment", 2)):
        if rule == "specific_recruitment" and re.fullmatch(BRIDGE, anchor):
            continue
        match = re.search(pattern, anchor) or re.search(pattern, nearby)
        if match:
            field = "anchor" if re.search(pattern, anchor) else "nearby"
            add(rule, field, match.group(), n=points)
            break
    match = re.search(IDENTIFIER, nearby)
    if notice and match:
        add("advertisement_number", "nearby", match.group(), n=2)
    for field, text in (("heading", heading), ("url", url)):
        pattern = RECRUITMENT if field == "heading" else r"recruitment|vacancy|vacancies|career|advt|advertisement|notification"
        match = re.search(pattern, text)
        if match:
            add("recruitment_" + field, field, match.group(), n=1, b=1)
    if re.fullmatch(BRIDGE, anchor):
        add("bridge_label", "anchor", anchor, b=6)
    elif re.fullmatch(r"view all|more notices|सभी देखें|और सूचनाएँ", anchor) and (
        re.search(RECRUITMENT, nearby + " " + heading)
    ):
        add("recruitment_index", "anchor", anchor, b=3)
    for pattern, rule in ((RELATED, "related_other"), (UNRELATED, "unrelated")):
        match = re.search(pattern, anchor) or re.search(pattern, nearby)
        if match:
            field = "anchor" if re.search(pattern, anchor) else "nearby"
            add(rule, field, match.group(), n=-8, b=-6)
    notice, bridge = max(0, notice), max(0, bridge)
    label = "likely_notice" if notice >= 6 and notice >= bridge else (
        "bridge" if bridge >= 5 and bridge > notice else "uncertain_or_other")
    if label == "uncertain_or_other" and any(r["rule"] == "related_other" for r in reasons):
        label = "recruitment_related_other"
    return {"notice": notice, "bridge": bridge, "priority": max(notice, bridge),
            "label": label, "reasons": reasons}
