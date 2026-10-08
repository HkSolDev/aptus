"""Offline candidate recruitment bundling. Authority and amendment scope need review."""

import hashlib
import json
import re
import unicodedata
from urllib.parse import urlsplit


LABELS = {
    "issuer": r"(?:issuer|recruiting authority|organization|organisation)",
    "campaign": r"(?:campaign|recruitment name|recruitment title)",
    "advertisement_number": r"(?:advertisement|advt\.?|ad\.)\s*(?:no\.?|number)",
    "year": r"(?:recruitment year|campaign year)",
}
ROLES = {
    "cancellation": r"\b(?:cancellation|recruitment cancelled|recruitment withdrawn)\b",
    "corrigendum": r"\b(?:corrigendum|addendum|amendment|revised notice)\b",
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
    roles = [role for role, pattern in ROLES.items() if re.search(pattern, title, re.I)]
    role = roles[0] if len(roles) == 1 else "unknown"
    if not roles and re.search(r"\b(?:recruitment|notification|CRP)\b", title, re.I):
        role = "main_notice"
    identity, evidence, flags = {}, [], []
    for field, label in LABELS.items():
        matches = [(match.group(1).strip(), locators, match.group(0))
                   for text, locators in identity_units
                   for match in re.finditer(r"^\s*" + label + r"\s*[:：]\s*([^\n]{1,160})", text, re.I | re.M)]
        values = {normalized(value): value for value, _, _ in matches}
        identity[field] = next(iter(values.values())) if len(values) == 1 else None
        if len(values) > 1:
            flags.append("ambiguous_" + field)
        evidence.extend({"field": field, "quote": quote, "locations": locators} for _, locators, quote in matches)
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
        matches = [(match.group(0), title_locations)
                   for match in re.finditer(r"\bCRP[ -]+RRBs?\s*[-–]?\s*(?:[IVXLCDM]+|\d+)\b", title.strip().split("\n")[0], re.I)]
        values = {normalized(value): value for value, _ in matches}
        if len(values) == 1:
            identity["campaign"] = next(iter(values.values()))
            evidence.append({"field": "campaign", "quote": matches[0][0], "locations": matches[0][1]})
        elif len(values) > 1:
            flags.append("ambiguous_campaign")
    if identity["year"] and not re.fullmatch(r"20\d{2}", identity["year"]):
        identity["year"] = None
        flags.append("invalid_campaign_year")
    issuer = normalized(identity["issuer"]) if identity["issuer"] else ""
    hosts = next((hosts for name, hosts in issuer_hosts.items() if normalized(name) == issuer), [])
    official = parsed.scheme == "https" and parsed.hostname.casefold() in [host.casefold() for host in hosts]
    if not official:
        flags.append("authority_needs_review")
    if role == "unknown":
        flags.append("document_role_needs_review")
    if role in {"corrigendum", "cancellation"}:
        flags.append("amendment_or_cancellation_scope_needs_review")
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


def verify_bundles(documents, *, issuer_hosts=None):
    """Group only explicit strong identities. No fuzzy match or rule precedence."""
    issuer_hosts = issuer_hosts or {}
    if not isinstance(documents, list) or not isinstance(issuer_hosts, dict):
        raise ValueError("Expected documents array and issuer-to-hosts mapping")
    for issuer, hosts in issuer_hosts.items():
        if not isinstance(issuer, str) or not isinstance(hosts, list) or any(
                not isinstance(host, str) or not re.fullmatch(r"[A-Za-z0-9.-]+", host) for host in hosts):
            raise ValueError("Official hosts must be explicit hostname lists")
    bundles, seen = {}, set()
    for document in documents:
        unit = describe_document(document, issuer_hosts)
        if unit["document_id"] in seen:
            raise ValueError("Duplicate document_id; deduplicate snapshots before Verify")
        seen.add(unit["document_id"])
        identity = unit["identity"]
        issuer, ad, campaign, year = [normalized(identity[key] or "") for key in
                                    ("issuer", "advertisement_number", "campaign", "year")]
        edition = bool(re.search(r"\b(?:[ivxlcdm]+|\d+)\s*$", campaign))
        strong = issuer and not any(reason.startswith("ambiguous_") for reason in unit["review_reasons"])
        if strong and ad and (year or re.search(r"\b20\d{2}\b", ad)):
            key = (issuer, "ad", ad, year)
        elif strong and campaign and (year or edition):
            key = (issuer, "campaign", campaign, year)
        else:
            key = ("unmatched", unit["document_id"])
            unit["review_reasons"].append("insufficient_campaign_identity")
        bundle_id = hashlib.sha256(json.dumps(key).encode()).hexdigest()[:24]
        bundle = bundles.setdefault(bundle_id, {"bundle_id": bundle_id, "identity": identity,
                                               "documents": [], "review_reasons": []})
        bundle["documents"].append(unit)
    for bundle in bundles.values():
        units = bundle["documents"]
        reasons = {reason for unit in units for reason in unit["review_reasons"]}
        mains = [unit for unit in units if unit["role"] == "main_notice"]
        if not mains:
            reasons.add("missing_main_notice")
        if len(mains) > 1:
            reasons.add("multiple_main_documents_need_comparison")
        for field in ("issuer", "campaign", "advertisement_number", "year"):
            if len({normalized(unit["identity"][field]) for unit in units if unit["identity"][field]}) > 1:
                reasons.add("conflicting_" + field)
                bundle["identity"] = {**bundle["identity"], field: None}
        bundle["review_reasons"] = sorted(reasons)
        bundle["status"] = "needs_review" if reasons else "candidate_for_extraction"
    return {"verify_version": "verify-bundle-v1", "bundles": list(bundles.values())}


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser(description="Bundle normalized document JSON offline")
    parser.add_argument("input_json", help="Object containing documents[] and optional issuer_hosts")
    args = parser.parse_args()
    payload = json.loads(Path(args.input_json).read_text())
    print(json.dumps(verify_bundles(payload["documents"], issuer_hosts=payload.get("issuer_hosts")),
                     ensure_ascii=False, indent=2))
