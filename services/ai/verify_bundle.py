"""Offline candidate recruitment bundling. Authority and amendment scope need review."""

import hashlib
import json
import re
import unicodedata
from urllib.parse import urlsplit

from link_discovery import url_identity
from notice_classification import is_candidate_notice, non_recruitment_role


LABELS = {
    "issuer": r"(?:issuer|recruiting authority|organization|organisation)",
    "campaign": r"(?:campaign|recruitment name|recruitment title)",
    "advertisement_number": (
        r"(?:(?:advertisement|advt\.?|ad\.)\s*(?:no\.?|number)?|"
        r"(?:notice|notification|employment\s+notice|en)\s*(?:no\.?|number)|"
        r"(?:file|f\.)\s*(?:no\.?|number))"
    ),
    "year": r"(?:recruitment year|campaign year)",
}
ROLES = {
    "cancellation": r"\b(?:cancellation|recruitment cancelled|recruitment withdrawn)\b",
    "corrigendum": (
        r"\b(?:corrigendum|addendum|amendment|revised notice|"
        r"extension of (?:last |closing )?date|extension notice|date extension|"
        r"closing date extended|last date extended)\b"
    ),
    "vacancy_annexure": r"\b(?:vacancy annexure|annexure.*vacanc|vacancy details|updated vacancy)\b",
    "form_appendix": r"\b(?:certificate form|proforma|appendix|application form)\b",
}
CHANGE_FIELDS = {
    "vacancies": r"\bvacanc(?:y|ies)\b",
    "deadline": r"\b(?:last date|closing date|deadline)\b",
    "age": r"\b(?:age limit|maximum age|minimum age|age relaxation)\b",
    "qualification": r"\b(?:qualifications?|eligibility criteria|experience requirements?)\b",
    "fee": r"\b(?:application fees?|examination fees?|intimation charges)\b",
    "reservation": r"\b(?:reservation|category relaxation)\b",
}


def amendment_scope(units, role):
    """Record explicit change sentences and their source targets; no fact override."""
    if role not in {"corrigendum", "cancellation"}:
        return None
    evidence, unchanged = [], []
    for text, locations in units:
        for sentence in re.split(r"(?<=[.!?])\s+(?=[A-Z(])", text):
            if re.search(r"\b(?:unchanged|no changes?|not (?:revised|changed|updated|extended))\b", sentence, re.I):
                unchanged.append({"quote": sentence, "locations": locations})
                continue
            # A reference to an "updated annexure" is not itself a new change.
            if not re.search(r"\b(?:(?:has|have|is|are|was|were)\s+(?:been\s+)?updated|revised|extended|amended|substituted|read as|instead of|cancelled|withdrawn)\b", sentence, re.I):
                continue
            changes = [field for field, pattern in CHANGE_FIELDS.items() if re.search(pattern, sentence, re.I)]
            if role == "cancellation" and re.search(r"\b(?:recruitment|notification|advertisement)\b.{0,100}\b(?:cancelled|withdrawn)\b", sentence, re.I | re.S):
                changes.append("cancellation")
            if not changes:
                continue
            targets = re.findall(r"\b(?:Annexure|Appendix|Paragraph|Section)\s*[-–]?\s*(?:[IVXLCDM]+|\d+(?:\.\d+)*)(?!\w)", sentence, re.I)
            targets += re.findall(r"\bfor the post of\s+([^\n.;:]{1,80})", sentence, re.I)
            targets += re.findall(r"\bfor\s+([A-Z][A-Za-z &'-]{1,70}\bBank)\b", sentence)
            evidence.append({"changes": changes, "applies_to": targets,
                             "quote": sentence, "locations": locations})
    changes = sorted({field for item in evidence for field in item["changes"]})
    targets = sorted({target for item in evidence for target in item["applies_to"]})
    return {"changes": changes, "applies_to": targets,
            "evidence": evidence, "unchanged_evidence": unchanged,
            "status": "candidate_scope" if evidence and all(item["applies_to"] for item in evidence) else "needs_review"}


def year_from_ad(ad_value):
    """Extract 4-digit recruitment year from an advertisement or notice number.

    Conservative rule: matches a 4-digit year bounded by standard separators
    (e.g. /2026, -2026, _2026). Does not guess years from arbitrary dates.
    """
    if not isinstance(ad_value, str):
        return None
    match = re.search(r"(?:^|[/\-_ \t])(20\d{2})(?:[/\-_ \t]|$)", ad_value)
    return match.group(1) if match else None


def normalized(value):
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def content_units(content, kind):
    if kind == "pdf":
        return [(unit["text"], unit["evidence"]) for unit in content.get("sections", [])]
    units = []
    for index, block in enumerate(content.get("blocks", [])):
        text = block.get("text", "")
        if block.get("type") == "list":
            text = "\n".join(block["items"])
        elif block.get("type") == "table":
            text = "\n".join(" | ".join(row) for row in block["rows"])
        units.append((text, [{"block": index}]))
    return units


def describe_document(document, issuer_hosts):
    if not isinstance(document, dict):
        raise ValueError("Every document must be an object")
    identifier, url, kind = (document.get(key) for key in ("document_id", "source_url", "format"))
    if not isinstance(identifier, str) or not identifier or kind not in {"html", "pdf"}:
        raise ValueError("Document needs a nonempty document_id and html/pdf format")
    parsed = urlsplit(url) if isinstance(url, str) else None
    if not parsed or parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Document needs an absolute HTTP(S) source URL without credentials")
    content = document.get("content")
    if not isinstance(content, dict):
        raise ValueError("Document needs normalized content")
    if content.get("source_url") not in (None, url) or content.get("format") not in (None, kind):
        raise ValueError("Content source/format disagrees with document")
    units = content_units(content, kind)
    context = content.get("identity_context") if kind == "pdf" else None
    if context is not None:
        if not isinstance(context, dict) or not isinstance(context.get("text"), str) or not isinstance(context.get("evidence"), list):
            raise ValueError("Identity context needs source text and evidence")
        identity_units = [(context["text"], context["evidence"])] + units
    else:
        identity_units = units
    if any(not isinstance(text, str) or not isinstance(locators, list) for text, locators in units):
        raise ValueError("Content needs text and evidence locations")
    title = content.get("title") or ("\n".join(identity_units[0][0].splitlines()[:8]) if identity_units else "")
    title_locations = identity_units[0][1] if identity_units else []
    identity, evidence, flags = {}, [], []
    roles = [role for role, pattern in ROLES.items() if re.search(pattern, title, re.I)]
    if len(roles) == 1:
        role = roles[0]
    elif len(roles) > 1:
        # Prioritize cancellation and explicit amendment roles over composite matches.
        if "cancellation" in roles and len(set(roles)) == 1:
            role = "cancellation"
        elif "corrigendum" in roles and len(set(roles) - {"corrigendum", "form_appendix"}) == 0:
            role = "corrigendum"
        else:
            role = "unknown"
    else:
        role = "unknown"
    from notice_classification import GENERIC_TITLE, RECRUITMENT_DETAILS
    listing_title = re.fullmatch(r'(?:recruitment(?: advertisements)?|careers|latest recruitment notifications)', title.strip(), re.I)
    if kind == 'html' and (GENERIC_TITLE.search(title) or (
            listing_title and not any(RECRUITMENT_DETAILS.search(text) for text, _ in units))):
        flags.append('navigation_document')
    purpose_role = non_recruitment_role(title, identity_units, kind)
    if purpose_role:
        role = purpose_role
        flags.append("non_recruitment_document")
    elif role == "unknown" and is_candidate_notice(title, identity_units):
        role = "main_notice"
    for field, label in LABELS.items():
        if field == "advertisement_number":
            patterns = [r"^\s*" + label + r"\s*[:：]?\s*([A-Za-z0-9][^|\n]{0,159})",
                # Summary headings put the label after the post name. Accept a
                # bounded identifier, not the prose following a table separator.
                r"(?<!\w)(?:advertisement|advt\.?)\s+(?:no\.?|number)\s*[:：]?\s*"
                r"((?=[A-Za-z0-9./_-]{0,159}\d)[A-Za-z0-9][A-Za-z0-9./_-]{0,159})(?=\s*(?:[|;\n]|$))"]
        else:
            patterns = [r"^\s*" + label + r"\s*[:：]\s*([^\n]{1,160})"]
        matches = [(match.group(1).strip().rstrip(".,;"), locators, match.group(0))
                   for text, locators in identity_units
                   for pattern in patterns
                   for match in re.finditer(pattern, text, re.I | re.M)]
        values = {normalized(value): value for value, _, _ in matches if value}
        identity[field] = next(iter(values.values())) if len(values) == 1 else None
        if len(values) > 1:
            flags.append("ambiguous_" + field)
        evidence.extend({"field": field, "quote": quote, "locations": locators} for _, locators, quote in matches if _ in values.values())
    if not identity["issuer"] and "ambiguous_issuer" not in flags:
        matches = [(issuer, locators) for issuer in issuer_hosts for text, locators in identity_units
                   if re.search(r"(?<!\w)" + re.escape(issuer) + r"(?!\w)", text, re.I)]
        issuers = {normalized(issuer): issuer for issuer, _ in matches}
        if len(issuers) == 1:
            identity["issuer"] = next(iter(issuers.values()))
            evidence.append({"field": "issuer", "quote": matches[0][0], "locations": matches[0][1]})
        elif len(issuers) > 1:
            flags.append("ambiguous_issuer")
    if not identity["campaign"] and "ambiguous_campaign" not in flags:
        # Identify the document's campaign in its title, not older campaigns
        # mentioned later in instructions or eligibility history.
        first_line = title.strip().split("\n")[0]
        campaign_patterns = [
            r"\bCRP[ -]+RRBs?\s*[-–]?\s*(?:[IVXLCDM]+|\d+)\b",
            r"\b(?:Combined\s+Graduate\s+Level|Combined\s+Higher\s+Secondary\s+Level|Junior\s+Engineer|Multi\s+Tasking\s+Staff|Sub[ -]Inspector)\s+Examination\b",
        ]
        for pattern in campaign_patterns:
            matches = [(match.group(0), title_locations)
                       for match in re.finditer(pattern, first_line, re.I)]
            values = {normalized(value): value for value, _ in matches}
            if len(values) == 1:
                identity["campaign"] = next(iter(values.values()))
                evidence.append({"field": "campaign", "quote": matches[0][0], "locations": matches[0][1]})
                break
            elif len(values) > 1:
                flags.append("ambiguous_campaign")
                break
    if identity["year"] and not re.fullmatch(r"20\d{2}", identity["year"]):
        identity["year"] = None
        flags.append("invalid_campaign_year")
    # Why source host and recruiter may differ:
    # Third-party aggregators (such as SarkariResult) or general government hosting platforms
    # host notices for other recruiting organizations. The recruiter must be derived verbatim
    # from document evidence, never assumed equal to the website owner or host domain.
    issuer = normalized(identity["issuer"]) if identity["issuer"] else ""
    hosts = next((hosts for name, hosts in issuer_hosts.items() if normalized(name) == issuer), [])
    official = parsed.scheme == "https" and parsed.hostname.casefold() in [host.casefold() for host in hosts]
    if not official:
        flags.append("authority_needs_review")
    if role == "unknown":
        flags.append("document_role_needs_review")
    if role in {"corrigendum", "cancellation"}:
        flags.append("amendment_or_cancellation_scope_needs_review")
    if role in {"result", "admit_card", "exam_update", "non_employment"} and "non_recruitment_document" not in flags:
        flags.append("non_recruitment_document")
    if not units:
        flags.append("empty_content")
    coverage = content.get("coverage", {})
    if coverage.get("unreadable_pages") or coverage.get("unavailable_blocks") or coverage.get("omitted_sections"):
        flags.append("content_coverage_gap")
    if coverage.get("unresolved_references"):
        flags.append("unresolved_document_references")
    if content.get("status") == "budget_exceeded":
        flags.append("content_budget_exceeded")
    return {**document, "identity": identity, "identity_evidence": evidence,
            "amendment_scope": amendment_scope(units, role),
            "role": role, "role_evidence": {"quote": title, "locations": title_locations},
            "authority": "official_host_candidate" if official else "needs_review",
            "review_reasons": flags}


# Why missing identity differs from contradictory identity:
# Missing identity (such as insufficient_campaign_identity) indicates that deterministic
# regex patterns could not reliably locate the recruiter, campaign name, or advertisement number
# in unstructured text; the notice remains readable and can be safely analyzed by the AI
# extraction model with verbatim citations. Conversely, contradictory or ambiguous identity
# (conflicting_*, ambiguous_*, unmatched_amendment_target) signals irreconcilable evidence
# or competing recruitment candidates across documents, which must block extraction to prevent
# conflating distinct recruitments.
GROUPING_BLOCKING_REASONS = {
    "missing_main_notice",
    "multiple_main_documents_need_comparison",
    "unmatched_amendment_target",
    "ambiguous_amendment_target",
    "ambiguous_campaign_advertisement_reference",
    "competing_campaign_candidates",
    "non_recruitment_document",
    "conflicting_issuer",
    "conflicting_campaign",
    "conflicting_advertisement_number",
    "conflicting_year",
    "ambiguous_issuer",
    "ambiguous_campaign",
    "ambiguous_advertisement_number",
}


def grouping_blocking_reasons(bundle):
    """Return grouping-related review reasons that must prevent AI extraction.

    Why grouping uncertainty blocks AI:
    Unresolved identity conflicts, missing main notices, competing main documents,
    or ambiguous amendment attachments indicate that recruitment boundaries
    are unverified. Sending uncertain evidence to AI leads to hallucinated
    cross-recruitment facts or incorrect eligibility criteria.

    Why standalone notices bypass unmatched amendment and non-recruitment blockers:
    A standalone readable notice undergoes purpose classification by the AI model.
    An isolated amendment with an unresolved target is retained for review, but does
    not block purpose classification. True grouping conflicts (conflicting_*), competing
    candidates, and ambiguous multi-document associations remain strict blockers.
    """
    reasons = set(bundle.get("review_reasons", []))
    if 'navigation_document' in reasons:
        return ['navigation_document']
    docs = bundle.get("documents", [])
    if len(docs) == 1:
        standalone_blockers = GROUPING_BLOCKING_REASONS - {
            "unmatched_amendment_target",
            "missing_main_notice",
            "non_recruitment_document",
        }
        return sorted(reasons & standalone_blockers)
    return sorted(reasons & GROUPING_BLOCKING_REASONS)


def _unit_features(unit):
    identity = unit["identity"]
    issuer = normalized(identity.get("issuer") or "")
    ad = normalized(identity.get("advertisement_number") or "")
    campaign = normalized(identity.get("campaign") or "")
    year = normalized(identity.get("year") or "")
    ad_year = year_from_ad(identity.get("advertisement_number"))
    effective_year = year or (normalized(ad_year) if ad_year else "")
    edition = bool(re.search(r"\b(?:[ivxlcdm]+|\d+)\s*$", campaign))
    strong = bool(issuer and not any(r.startswith("ambiguous_") for r in unit["review_reasons"]))
    return {
        "issuer": issuer,
        "ad": ad,
        "campaign": campaign,
        "year": year,
        "effective_year": effective_year,
        "edition": edition,
        "strong": strong,
    }


def _has_conflict(f1, f2):
    """Check whether two documents have conflicting explicit identity evidence.

    Why conflicting explicit identifiers prevent merging:
    Missing fields allow conservative association, but conflicting explicit
    values (e.g. different advertisement numbers, differing campaign names,
    or different explicit recruitment years) represent separate recruitments
    and must never silently merge into one bundle.
    """
    if f1["issuer"] and f2["issuer"] and f1["issuer"] != f2["issuer"]:
        return True
    if f1["ad"] and f2["ad"] and f1["ad"] != f2["ad"]:
        return True
    if f1["campaign"] and f2["campaign"] and f1["campaign"] != f2["campaign"]:
        return True
    if f1["year"] and f2["year"] and f1["year"] != f2["year"]:
        return True
    # Prevent merging when explicit year in one contradicts year derived from ad in the other
    if f1["year"] and f2["effective_year"] and f1["year"] != f2["effective_year"]:
        return True
    if f2["year"] and f1["effective_year"] and f2["year"] != f1["effective_year"]:
        return True
    return False


def _is_notice_specific_html(unit, features_dict):
    """Determine whether an HTML document has specific recruitment identity evidence.

    Why links from navigation pages do not establish evidence membership:
    A link from a navigation, careers, or directory page reflects crawl topology,
    not recruitment identity. A page must possess its own specific recruitment
    identity (such as an advertisement number or campaign name) to join a recruitment
    evidence bundle. Empty-identity directory pages remain discovery hops only.
    """
    if unit.get("format") != "html":
        return False
    feat = features_dict.get(unit["document_id"], {})
    return bool(feat.get("ad") or (feat.get("campaign") and (feat.get("effective_year") or feat.get("edition"))))


def verify_bundles(documents, *, issuer_hosts=None, edges=None):
    """Group recruitment documents conservatively using identity and explicit links.

    Preserves separate bundles for distinct campaigns on the same host.
    """
    issuer_hosts = issuer_hosts or {}
    edges = edges or []
    if not isinstance(documents, list) or not isinstance(issuer_hosts, dict):
        raise ValueError("Expected documents array and issuer-to-hosts mapping")
    for issuer, hosts in issuer_hosts.items():
        if not isinstance(issuer, str) or not isinstance(hosts, list) or any(
                not isinstance(host, str) or not re.fullmatch(r"[A-Za-z0-9.-]+", host) for host in hosts):
            raise ValueError("Official hosts must be explicit hostname lists")

    units = []
    seen = set()
    for document in documents:
        unit = describe_document(document, issuer_hosts)
        if unit["document_id"] in seen:
            raise ValueError("Duplicate document_id; deduplicate snapshots before Verify")
        seen.add(unit["document_id"])
        units.append(unit)

    if not units:
        return {"verify_version": "verify-bundle-v1", "bundles": []}

    features = {u["document_id"]: _unit_features(u) for u in units}

    # Extract outbound normalized URLs from document links and crawl edges.
    # Why a shared listing parent cannot establish recruitment identity:
    # A crawl parent (such as a portal, feed, or navigation index) links to
    # multiple distinct recruitments. Shared parentage must not bridge separate campaigns.
    doc_outbound = {}
    for u in units:
        links = set()
        for link in u["content"].get("links", []):
            url = link.get("url")
            if isinstance(url, str):
                ident = url_identity(url, url)
                if ident:
                    links.add(ident)
        for edge in edges:
            parent = edge.get("parent_url")
            dest = edge.get("url")
            if parent and dest and url_identity(parent, parent) == u["source_url"]:
                ident = url_identity(dest, dest)
                if ident:
                    links.add(ident)
        doc_outbound[u["document_id"]] = links

    unit_by_url = {}
    for u in units:
        unit_by_url.setdefault(u["source_url"], []).append(u)

    hub_doc_ids = set()
    for u in units:
        linked_targets = [
            target
            for url in doc_outbound[u["document_id"]]
            for target in unit_by_url.get(url, [])
            if target["document_id"] != u["document_id"]
        ]
        for i in range(len(linked_targets)):
            for j in range(i + 1, len(linked_targets)):
                if _has_conflict(features[linked_targets[i]["document_id"]],
                                 features[linked_targets[j]["document_id"]]):
                    hub_doc_ids.add(u["document_id"])
                    break
            if u["document_id"] in hub_doc_ids:
                break

    # Why uncertain documents stay separate:
    # When deterministic grouping cannot establish a shared recruitment identity (e.g. matching
    # advertisement numbers or campaign names), documents must remain isolated in standalone
    # single-document bundles. Merging uncertain documents merely because they share a host or
    # title pattern risks corrupting extraction with unrelated evidence.
    primary_units = [u for u in units if u["role"] not in {"corrigendum", "cancellation"}]
    amendment_units = [u for u in units if u["role"] in {"corrigendum", "cancellation"}]

    clusters = [[u] for u in primary_units]

    def cluster_features(cluster):
        issuers = {features[u["document_id"]]["issuer"] for u in cluster if features[u["document_id"]]["issuer"]}
        ads = {features[u["document_id"]]["ad"] for u in cluster if features[u["document_id"]]["ad"]}
        campaigns = {features[u["document_id"]]["campaign"] for u in cluster if features[u["document_id"]]["campaign"]}
        years = {features[u["document_id"]]["year"] for u in cluster if features[u["document_id"]]["year"]}
        eff_years = {features[u["document_id"]]["effective_year"] for u in cluster if features[u["document_id"]]["effective_year"]}
        return {
            "issuer": next(iter(issuers)) if len(issuers) == 1 else "",
            "ad": next(iter(ads)) if len(ads) == 1 else "",
            "campaign": next(iter(campaigns)) if len(campaigns) == 1 else "",
            "year": next(iter(years)) if len(years) == 1 else "",
            "effective_year": next(iter(eff_years)) if len(eff_years) == 1 else "",
            "edition": any(features[u["document_id"]]["edition"] for u in cluster),
            "strong": any(features[u["document_id"]]["strong"] for u in cluster),
        }

    def clusters_conflict(c1, c2):
        for u1 in c1:
            for u2 in c2:
                if _has_conflict(features[u1["document_id"]], features[u2["document_id"]]):
                    return True
        return False

    # Step 1: Merge clusters sharing identical strong issuer and advertisement number.
    merged = True
    while merged:
        merged = False
        for i in range(len(clusters)):
            for j in range(i + 1, len(clusters)):
                c1, c2 = clusters[i], clusters[j]
                if clusters_conflict(c1, c2):
                    continue
                f1, f2 = cluster_features(c1), cluster_features(c2)
                if f1["strong"] and f2["strong"] and f1["issuer"] == f2["issuer"] and f1["ad"] and f1["ad"] == f2["ad"]:
                    clusters[i] = c1 + c2
                    clusters.pop(j)
                    merged = True
                    break
            if merged:
                break

    # Step 2: Campaign-based fallback.
    # Why weaker evidence cannot bridge two strong identities:
    # A document lacking an advertisement number may join an ad-identified recruitment
    # only when it matches exactly one candidate. If multiple candidates match,
    # it must remain unmerged rather than bridging distinct recruitments.
    #
    # Why an unresolved document must be blocked even when kept separate:
    # An unmerged document with ambiguous associations (such as matching multiple
    # candidate recruitments) cannot be safely extracted on its own. 'Kept separate'
    # must not be interpreted as 'safe to extract'; unresolved ambiguity must block AI input.
    merged = True
    while merged:
        merged = False
        for i in range(len(clusters)):
            c1 = clusters[i]
            f1 = cluster_features(c1)
            if f1["strong"] and not f1["ad"] and f1["campaign"] and (f1["effective_year"] or f1["edition"]):
                compatible_indices = []
                for j in range(len(clusters)):
                    if i == j:
                        continue
                    c2 = clusters[j]
                    if clusters_conflict(c1, c2):
                        continue
                    f2 = cluster_features(c2)
                    if f2["issuer"] == f1["issuer"] and f2["campaign"] == f1["campaign"] and f2["ad"]:
                        if f1["effective_year"] and f2["effective_year"] and f1["effective_year"] != f2["effective_year"]:
                            continue
                        compatible_indices.append(j)
                if len(compatible_indices) == 1:
                    target_idx = compatible_indices[0]
                    clusters[target_idx] = clusters[target_idx] + c1
                    clusters.pop(i)
                    merged = True
                    break
                elif len(compatible_indices) > 1:
                    # Matches multiple advertisement-bearing recruitments!
                    # Do not guess or select the first candidate.
                    # Mark all units in this cluster with explicit ambiguity reasons.
                    competing = [cluster_features(clusters[k])["ad"] for k in compatible_indices if cluster_features(clusters[k])["ad"]]
                    for u in c1:
                        if "ambiguous_campaign" not in u["review_reasons"]:
                            u["review_reasons"].append("ambiguous_campaign")
                        if "ambiguous_campaign_advertisement_reference" not in u["review_reasons"]:
                            u["review_reasons"].append("ambiguous_campaign_advertisement_reference")
                        u["competing_candidates"] = competing
        if not merged:
            break

    # Step 3: Explicit direct link association between complementary notice documents.
    # Why links from navigation pages do not establish evidence membership:
    # A link from a navigation, careers, or directory page reflects crawl topology,
    # not recruitment identity. A page must possess its own specific recruitment
    # identity (such as an advertisement number or campaign name) and point specifically
    # to a detailed notice PDF to join a recruitment evidence bundle.
    merged = True
    while merged:
        merged = False
        for i in range(len(clusters)):
            for j in range(len(clusters)):
                if i == j:
                    continue
                c1, c2 = clusters[i], clusters[j]
                if clusters_conflict(c1, c2):
                    continue
                link_found = False
                for u1 in c1:
                    if u1["document_id"] in hub_doc_ids:
                        continue
                    # u1 must be a notice-specific HTML page with genuine recruitment identity
                    if not _is_notice_specific_html(u1, features):
                        continue
                    for u2 in c2:
                        # u2 must be a PDF document
                        if u2["format"] != "pdf":
                            continue
                        if u2["source_url"] in doc_outbound[u1["document_id"]]:
                            f1, f2 = features[u1["document_id"]], features[u2["document_id"]]
                            if not f1["issuer"] or not f2["issuer"] or f1["issuer"] == f2["issuer"]:
                                link_found = True
                                break
                    if link_found:
                        break
                if link_found:
                    clusters[i] = c1 + c2
                    clusters.pop(j)
                    merged = True
                    break
            if merged:
                break

    # Step 4: Attach amendment documents (corrigenda, cancellations).
    for a in amendment_units:
        fa = features[a["document_id"]]
        main_candidates = []
        for c in clusters:
            if not any(u["role"] == "main_notice" for u in c):
                continue
            if any(_has_conflict(fa, features[u["document_id"]]) for u in c):
                continue
            fc = cluster_features(c)
            if fa["issuer"] and fc["issuer"] and fa["issuer"] != fc["issuer"]:
                continue
            main_candidates.append(c)

        attached = False
        if fa["ad"]:
            ad_matches = [c for c in main_candidates if cluster_features(c)["ad"] == fa["ad"]]
            if len(ad_matches) == 1:
                ad_matches[0].append(a)
                attached = True
            elif len(ad_matches) > 1:
                a["review_reasons"].append("ambiguous_amendment_target")
                clusters.append([a])
                attached = True

        if not attached and fa["campaign"] and (fa["effective_year"] or fa["edition"]):
            camp_matches = [
                c for c in main_candidates
                if cluster_features(c)["campaign"] == fa["campaign"]
                and (not fa["effective_year"] or not cluster_features(c)["effective_year"]
                     or cluster_features(c)["effective_year"] == fa["effective_year"])
            ]
            if len(camp_matches) == 1:
                camp_matches[0].append(a)
                attached = True
            elif len(camp_matches) > 1:
                a["review_reasons"].append("ambiguous_amendment_target")
                clusters.append([a])
                attached = True

        if not attached and a["document_id"] not in hub_doc_ids:
            linked_matches = []
            for c in main_candidates:
                if any(a["source_url"] in doc_outbound[u["document_id"]] for u in c if u["document_id"] not in hub_doc_ids):
                    linked_matches.append(c)
            if len(linked_matches) == 1:
                linked_matches[0].append(a)
                attached = True

        if not attached:
            a["review_reasons"].append("unmatched_amendment_target")
            clusters.append([a])

    # Step 5: Detect cross-cluster conflicts under the same advertisement identity.
    # Why conflicting identity artifacts need collision-free identifiers:
    # When multiple clusters share the same issuer and advertisement number but
    # have conflicting explicit campaigns or years, they represent conflicting claims.
    # They must all record review reasons, block AI, and use collision-free
    # artifact identifiers rather than silently overwriting each other.
    for i in range(len(clusters)):
        f_i = cluster_features(clusters[i])
        if not f_i["strong"] or not f_i["ad"]:
            continue
        for j in range(i + 1, len(clusters)):
            f_j = cluster_features(clusters[j])
            if not f_j["strong"] or not f_j["ad"]:
                continue
            if f_i["issuer"] == f_j["issuer"] and f_i["ad"] == f_j["ad"]:
                if f_i["campaign"] and f_j["campaign"] and f_i["campaign"] != f_j["campaign"]:
                    for u in clusters[i]:
                        if "conflicting_campaign" not in u["review_reasons"]:
                            u["review_reasons"].append("conflicting_campaign")
                    for u in clusters[j]:
                        if "conflicting_campaign" not in u["review_reasons"]:
                            u["review_reasons"].append("conflicting_campaign")
                if f_i["year"] and f_j["year"] and f_i["year"] != f_j["year"]:
                    for u in clusters[i]:
                        if "conflicting_year" not in u["review_reasons"]:
                            u["review_reasons"].append("conflicting_year")
                    for u in clusters[j]:
                        if "conflicting_year" not in u["review_reasons"]:
                            u["review_reasons"].append("conflicting_year")

    # Step 6: Assemble deterministic final bundles.
    bundles = []
    for cluster in clusters:
        units_in_cluster = sorted(cluster, key=lambda item: item["document_id"])
        bundle_reasons = {r for u in units_in_cluster for r in u["review_reasons"]}

        bundle_identity = {}
        for field in ("issuer", "advertisement_number", "campaign", "year"):
            field_values = {
                normalized(u["identity"].get(field) or ""): u["identity"].get(field)
                for u in units_in_cluster
                if u["identity"].get(field)
            }
            if len(field_values) == 1:
                bundle_identity[field] = next(iter(field_values.values()))
            elif len(field_values) > 1:
                bundle_identity[field] = None
                bundle_reasons.add("conflicting_" + field)
            else:
                bundle_identity[field] = None

        if "conflicting_campaign" in bundle_reasons:
            bundle_identity["campaign"] = None
        if "conflicting_year" in bundle_reasons:
            bundle_identity["year"] = None
        if "conflicting_issuer" in bundle_reasons:
            bundle_identity["issuer"] = None

        if not bundle_identity["year"] and bundle_identity["advertisement_number"]:
            ad_yr = year_from_ad(bundle_identity["advertisement_number"])
            if ad_yr and "conflicting_year" not in bundle_reasons:
                bundle_identity["year"] = ad_yr

        # Conflict artifact identifier policy:
        # Separate unresolved results must not share an output/state key.
        # Preserve established IDs for ordinary unambiguous recruitments.
        # For conflicting or ambiguous clusters, prefix with "conflict" and include
        # the cluster's distinguishing features and primary document_id.
        b_issuer = normalized(bundle_identity.get("issuer") or "")
        b_ad = normalized(bundle_identity.get("advertisement_number") or "")
        b_campaign = normalized(bundle_identity.get("campaign") or "")
        b_year = normalized(bundle_identity.get("year") or "")
        b_edition = bool(re.search(r"\b(?:[ivxlcdm]+|\d+)\s*$", b_campaign))
        b_strong = bool(b_issuer and not any(r.startswith("ambiguous_") for r in bundle_reasons))

        has_identity_conflict = any(r.startswith("conflicting_") for r in bundle_reasons)

        if has_identity_conflict:
            # Deterministic, collision-free conflict artifact ID
            c_feat = cluster_features(units_in_cluster)
            key = (
                "conflict",
                b_issuer or c_feat["issuer"],
                "ad",
                b_ad or c_feat["ad"],
                c_feat["campaign"],
                c_feat["year"],
                units_in_cluster[0]["document_id"],
            )
        elif b_strong and b_ad and (b_year or re.search(r"\b20\d{2}\b", b_ad)):
            key = (b_issuer, "ad", b_ad, b_year)
        elif b_strong and b_campaign and (b_year or b_edition):
            key = (b_issuer, "campaign", b_campaign, b_year)
        else:
            key = ("unmatched", units_in_cluster[0]["document_id"])
            bundle_reasons.add("insufficient_campaign_identity")

        bundle_id = hashlib.sha256(json.dumps(key).encode()).hexdigest()[:24]

        mains = [u for u in units_in_cluster if u["role"] == "main_notice"]
        if not mains:
            # Standalone document clusters undergo AI purpose classification;
            # missing_main_notice applies only to multi-document clusters lacking a core notice.
            if len(units_in_cluster) > 1:
                bundle_reasons.add("missing_main_notice")
        elif len(mains) == 1:
            pass
        elif len(mains) == 2:
            formats = {u["format"] for u in mains}
            has_conflict = any(r.startswith("conflicting_") for r in bundle_reasons)
            if formats == {"html", "pdf"} and not has_conflict:
                pass
            else:
                bundle_reasons.add("multiple_main_documents_need_comparison")
        else:
            bundle_reasons.add("multiple_main_documents_need_comparison")

        sorted_reasons = sorted(bundle_reasons)
        status = "needs_review" if sorted_reasons else "candidate_for_extraction"
        bundle_entry = {
            "bundle_id": bundle_id,
            "identity": bundle_identity,
            "documents": units_in_cluster,
            "review_reasons": sorted_reasons,
            "status": status,
        }
        competing = [u.get("competing_candidates") for u in units_in_cluster if u.get("competing_candidates")]
        if competing:
            bundle_entry["competing_candidates"] = competing[0]
        bundles.append(bundle_entry)

    bundles.sort(key=lambda b: b["bundle_id"])
    return {"verify_version": "verify-bundle-v1", "bundles": bundles}


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description="Bundle normalized document JSON offline")
    parser.add_argument("input_json", help="Object containing documents[] and optional issuer_hosts")
    args = parser.parse_args()
    payload = json.loads(Path(args.input_json).read_text())
    print(json.dumps(verify_bundles(payload["documents"], issuer_hosts=payload.get("issuer_hosts")),
                     ensure_ascii=False, indent=2))
