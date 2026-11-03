"""Bounded targeted enrichment for missing/weak fields, official syllabus, and historical cutoffs.

Rules enforced deterministically:
1. Requires verified notice identity (issuer + advertisement/campaign + year) before searching.
2. Creates at most one request per allowed missing/conflicting/weak field per post; complete or
   unsupported fields create zero requests.
3. Queries are post-specific; facts are never copied across posts.
4. Gemini Search Grounding is discovery only; snippets and third-party pages are never proof.
5. Selected official sources must be captured with URL, exact quote, document/page/locator,
   capture timestamp, issuer, and advertisement/exam identity.
6. Historical cutoffs are reference_only=True and never affect eligibility or predict cutoffs.
"""

import copy
import json
import unicodedata
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict

from verify_bundle import year_from_ad


ALLOWED_ENRICHMENT_FIELDS = {
    "application_last_date",
    "age_as_on_date",
    "min_age",
    "max_age",
    "vacancies",
    "education_required",
    "min_education_level",
    "min_marks_percent",
    "pay_level",
    "official_site_url",
    "apply_url",
    "selection_process",
    "experience_rules",
}


class EnrichmentProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_url: str
    exact_quote: str
    document_id: str
    page: int | None = None
    locator: str
    captured_at: str
    snapshot_sha256: str | None = None
    authority: Literal["official", "third_party"]
    issuer: str
    advertisement_or_exam_identity: str


class FieldEnrichmentCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    post_name: str
    field_path: str
    value: str | int | float | bool | list[str] | None
    status: Literal["verified", "unresolved", "conflicting"]
    reason: str | None = None
    post_binding_quote: str | None = None
    evidence: list[EnrichmentProvenance] = []


class ReaderSummaryCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    summary_text: str | None
    status: Literal["verified", "unresolved", "conflicting"]
    reason: str | None = None
    evidence: list[EnrichmentProvenance] = []


class OfficialSyllabusCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    post_name: str
    exam_name: str | None
    exam_pattern: str | None = None
    subjects: list[str] = []
    topics: list[str] = []
    status: Literal["verified", "unresolved", "conflicting"]
    reason: str | None = None
    post_binding_quote: str | None = None
    evidence: list[EnrichmentProvenance] = []


class HistoricalCutoffCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recruitment_year: int | None
    stage: str | None
    post_name: str | None
    category: str | None
    score_type: str | None
    score: float | None
    maximum_score: float | None = None
    reference_only: Literal[True] = True
    status: Literal["verified", "unresolved", "conflicting"]
    reason: str | None = None
    post_binding_quote: str | None = None
    evidence: list[EnrichmentProvenance] = []


class EnrichmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str
    target_type: Literal[
        "missing_or_weak_field",
        "official_syllabus",
        "historical_cutoff",
    ]
    post_name: str
    field_path: str | None = None
    trigger_reason: Literal[
        "missing_value",
        "conflicting_value",
        "weak_provenance",
        "validation_failed",
        "syllabus_requested",
        "historical_cutoff_requested",
    ]
    query: str
    issuer: str
    advertisement_or_exam_identity: str
    year: str


def _norm(value: str | None) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()


def verify_enrichment_identity(source_input: dict[str, Any]) -> tuple[bool, dict[str, str], str | None]:
    """Ensure verified issuer + advertisement/exam name + year exist before searching."""
    identity = (source_input or {}).get("identity") or {}
    issuer = (identity.get("issuer") or "").strip()
    ad = (identity.get("advertisement_number") or "").strip()
    campaign = (identity.get("campaign") or "").strip()
    year = (identity.get("year") or year_from_ad(ad) or "").strip()
    ad_or_exam = ad or campaign
    if not issuer or not ad_or_exam or not year:
        return False, {}, "enrichment_requires_verified_identity"
    cov_reasons = set(((source_input or {}).get("coverage") or {}).get("review_reasons", []))
    if any(r.startswith(("conflicting_", "ambiguous_")) for r in cov_reasons):
        return False, {}, "enrichment_identity_conflict"
    return True, {
        "issuer": issuer,
        "advertisement_or_exam_identity": f"{ad_or_exam} ({year})",
        "ad_or_exam": ad_or_exam,
        "year": year,
    }, None


def is_official_issuer_url(
    url: str, issuer: str, issuer_hosts: dict[str, list[str]] | None
) -> bool:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return False
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        return False
    hosts_map = issuer_hosts or {}
    issuer_norm = _norm(issuer)
    allowed_hosts = next(
        (hosts for name, hosts in hosts_map.items() if _norm(name) == issuer_norm),
        [],
    )
    host_lower = parsed.hostname.casefold()
    return any(
        host_lower == h.casefold() or host_lower.endswith("." + h.casefold())
        for h in allowed_hosts
    )


def _field_has_strong_official_provenance(
    full_field_path: str,
    facts: dict[str, Any],
    source_input: dict[str, Any],
) -> bool:
    units: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for doc in source_input.get("documents", []):
        for sec in doc.get("sections", []):
            units[sec["evidence_id"]] = (doc, sec)
    for cit in facts.get("evidence", []):
        if cit.get("field_path") != full_field_path and not cit.get("field_path", "").startswith(
            full_field_path + "."
        ):
            continue
        pair = units.get(cit.get("evidence_id", ""))
        if not pair:
            continue
        doc, sec = pair
        quote = (cit.get("quote") or "").strip()
        locs = sec.get("locations") or []
        if (
            quote
            and quote in (sec.get("text") or "")
            and locs
            and doc.get("authority") == "official_host_candidate"
        ):
            return True
    return False


def plan_enrichment_requests(
    facts: dict[str, Any],
    source_input: dict[str, Any],
    *,
    requested_fields: list[str] | None = None,
    validation_errors: list[dict[str, str]] | None = None,
    include_syllabus: bool = False,
    include_historical_cutoffs: bool = False,
) -> dict[str, Any]:
    """Deterministically build post-scoped enrichment requests."""
    verified, id_info, reason = verify_enrichment_identity(source_input)
    if not verified:
        return {
            "status": "blocked",
            "reason": reason,
            "requests": [],
        }

    issuer = id_info["issuer"]
    ad_or_exam = id_info["ad_or_exam"]
    year = id_info["year"]
    ad_identity = id_info["advertisement_or_exam_identity"]

    missing_reasons_by_path = {
        item.get("field_path"): (item.get("reason") or "")
        for item in facts.get("missing_fields", [])
        if isinstance(item, dict)
    }
    val_error_paths = {
        item.get("field_path")
        for item in (validation_errors or [])
        if isinstance(item, dict) and item.get("field_path")
    }

    fields_to_check = (
        [f for f in requested_fields if f in ALLOWED_ENRICHMENT_FIELDS]
        if requested_fields is not None
        else sorted(ALLOWED_ENRICHMENT_FIELDS)
    )

    requests: list[EnrichmentRequest] = []
    seen_keys: set[tuple[str, str, str | None]] = set()

    for idx, post in enumerate(facts.get("posts", [])):
        post_name = (post.get("post_name") or "").strip()
        if not post_name:
            continue
        prefix = f"posts.{idx}"

        for field_name in fields_to_check:
            dedup_key = ("missing_or_weak_field", post_name, field_name)
            if dedup_key in seen_keys:
                continue
            full_path = f"{prefix}.{field_name}"
            val = post.get(field_name)

            trigger: Literal[
                "missing_value",
                "conflicting_value",
                "weak_provenance",
                "validation_failed",
            ] | None = None

            if full_path in val_error_paths or any(
                p.startswith(full_path + ".") for p in val_error_paths if isinstance(p, str)
            ):
                trigger = "validation_failed"
            elif "conflict" in _norm(missing_reasons_by_path.get(full_path, "")):
                trigger = "conflicting_value"
            elif val is None or val == []:
                trigger = "missing_value"
            elif not _field_has_strong_official_provenance(full_path, facts, source_input):
                trigger = "weak_provenance"

            if trigger is not None:
                seen_keys.add(dedup_key)
                requests.append(
                    EnrichmentRequest(
                        request_id=f"req-{idx}-{field_name}",
                        target_type="missing_or_weak_field",
                        post_name=post_name,
                        field_path=field_name,
                        trigger_reason=trigger,
                        query=f"{issuer} {ad_or_exam} {year} {post_name} {field_name} official notification",
                        issuer=issuer,
                        advertisement_or_exam_identity=ad_identity,
                        year=year,
                    )
                )

        if include_syllabus:
            syl_key = ("official_syllabus", post_name, None)
            if syl_key not in seen_keys:
                seen_keys.add(syl_key)
                requests.append(
                    EnrichmentRequest(
                        request_id=f"req-{idx}-syllabus",
                        target_type="official_syllabus",
                        post_name=post_name,
                        field_path=None,
                        trigger_reason="syllabus_requested",
                        query=f"{issuer} {ad_or_exam} {year} {post_name} official syllabus exam pattern",
                        issuer=issuer,
                        advertisement_or_exam_identity=ad_identity,
                        year=year,
                    )
                )

        if include_historical_cutoffs:
            cut_key = ("historical_cutoff", post_name, None)
            if cut_key not in seen_keys:
                seen_keys.add(cut_key)
                requests.append(
                    EnrichmentRequest(
                        request_id=f"req-{idx}-cutoff",
                        target_type="historical_cutoff",
                        post_name=post_name,
                        field_path=None,
                        trigger_reason="historical_cutoff_requested",
                        query=f"{issuer} {ad_or_exam} {post_name} official previous year category cutoff marks",
                        issuer=issuer,
                        advertisement_or_exam_identity=ad_identity,
                        year=year,
                    )
                )

    return {
        "status": "ready",
        "reason": None,
        "identity": id_info,
        "requests": [r.model_dump(mode="json") for r in requests],
    }


def build_reader_summary_from_notice(
    facts: dict[str, Any],
    source_input: dict[str, Any],
    *,
    captured_at: str,
) -> dict[str, Any]:
    """Build a concise, source-grounded reader_summary from current official notice evidence."""
    verified, id_info, reason = verify_enrichment_identity(source_input)
    if not verified:
        return ReaderSummaryCandidate(
            summary_text=None,
            status="unresolved",
            reason=reason or "enrichment_requires_verified_identity",
            evidence=[],
        ).model_dump(mode="json")

    units: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    for doc in source_input.get("documents", []):
        for sec in doc.get("sections", []):
            units[sec["evidence_id"]] = (doc, sec)

    provenance_items: list[EnrichmentProvenance] = []
    for cit in facts.get("evidence", []):
        pair = units.get(cit.get("evidence_id", ""))
        if not pair:
            continue
        doc, sec = pair
        quote = (cit.get("quote") or "").strip()
        locs = sec.get("locations") or []
        if not quote or quote not in (sec.get("text") or "") or not locs:
            continue
        if doc.get("authority") != "official_host_candidate":
            continue
        loc0 = locs[0]
        page = loc0.get("page") if isinstance(loc0.get("page"), int) else None
        locator = (
            f"page:{page}"
            if page is not None
            else f"block:{loc0.get('block', 0)}"
        )
        provenance_items.append(
            EnrichmentProvenance(
                source_url=doc["source_url"],
                exact_quote=quote,
                document_id=doc["document_id"],
                page=page,
                locator=locator,
                captured_at=captured_at,
                authority="official",
                issuer=id_info["issuer"],
                advertisement_or_exam_identity=id_info["advertisement_or_exam_identity"],
            )
        )

    post_names = [
        (p.get("post_name") or "").strip()
        for p in facts.get("posts", [])
        if (p.get("post_name") or "").strip()
    ]
    if not post_names or not provenance_items:
        return ReaderSummaryCandidate(
            summary_text=None,
            status="unresolved",
            reason="insufficient_official_evidence_for_reader_summary",
            evidence=[],
        ).model_dump(mode="json")

    summary_text = (
        f"{id_info['issuer']} recruitment under {id_info['advertisement_or_exam_identity']} "
        f"for {', '.join(post_names)}."
    )
    return ReaderSummaryCandidate(
        summary_text=summary_text,
        status="verified",
        reason=None,
        evidence=provenance_items[:5],
    ).model_dump(mode="json")


def _validate_captured_item(
    *,
    item: dict[str, Any],
    request: dict[str, Any],
    capture_client: Any,
    issuer_hosts: dict[str, list[str]] | None,
    is_historical_cutoff: bool = False,
) -> tuple[bool, EnrichmentProvenance | None, str | None]:
    source_url = (item.get("source_url") or "").strip()
    exact_quote = (item.get("exact_quote") or "").strip()
    post_binding_quote = (item.get("post_binding_quote") or exact_quote).strip()
    if not source_url:
        return False, None, "search_snippet_not_proof"
    if not exact_quote:
        return False, None, "enrichment_missing_quote"
    if capture_client is None:
        return False, None, "search_snippet_not_proof"

    captured = capture_client.capture_source(source_url)
    if not isinstance(captured, dict) or captured.get("status") != "captured":
        return False, None, "source_capture_failed"

    final_url = (captured.get("source_url") or source_url).strip()
    official = is_official_issuer_url(final_url, request["issuer"], issuer_hosts)
    authority: Literal["official", "third_party"] = "official" if official else "third_party"
    if authority != "official":
        return False, None, "third_party_source_not_official"

    text_units = captured.get("text_units") or []
    full_text_norm = _norm(" \n ".join(u.get("text", "") for u in text_units if isinstance(u, dict)))

    # Verify issuer and advertisement/exam identity in captured official source
    if _norm(request["issuer"]) not in full_text_norm:
        return False, None, "enrichment_identity_mismatch"

    if is_historical_cutoff:
        rec_year = str(item.get("recruitment_year") or "")
        if not rec_year or rec_year not in exact_quote or rec_year not in full_text_norm:
            return False, None, "enrichment_identity_mismatch"
    else:
        ad_token = _norm(request["advertisement_or_exam_identity"].split("(")[0].strip())
        if ad_token and ad_token not in full_text_norm:
            return False, None, "enrichment_identity_mismatch"

    # Verify post-specific binding (never copy facts across posts)
    expected_post_norm = _norm(request["post_name"])
    claimed_post_norm = _norm(item.get("post_name") or request["post_name"])
    if claimed_post_norm != expected_post_norm:
        return False, None, "enrichment_post_binding_mismatch"
    if (
        expected_post_norm not in _norm(post_binding_quote)
        and expected_post_norm not in _norm(exact_quote)
    ):
        return False, None, "enrichment_post_binding_mismatch"
    if _norm(post_binding_quote) not in full_text_norm:
        return False, None, "enrichment_post_binding_mismatch"

    # Locate exact_quote in captured text_units
    matched_unit = next(
        (
            u
            for u in text_units
            if isinstance(u, dict)
            and _norm(exact_quote) in _norm(u.get("text", ""))
            and bool((u.get("locator") or "").strip())
        ),
        None,
    )
    if matched_unit is None:
        return False, None, "enrichment_quote_not_in_captured_source"

    captured_at = (captured.get("captured_at") or "").strip()
    doc_id = (captured.get("document_id") or "").strip()
    if not captured_at or not doc_id:
        return False, None, "enrichment_missing_capture_metadata"

    prov = EnrichmentProvenance(
        source_url=final_url,
        exact_quote=exact_quote,
        document_id=doc_id,
        page=matched_unit.get("page") if isinstance(matched_unit.get("page"), int) else None,
        locator=matched_unit["locator"],
        captured_at=captured_at,
        snapshot_sha256=captured.get("sha256"),
        authority="official",
        issuer=request["issuer"],
        advertisement_or_exam_identity=request["advertisement_or_exam_identity"],
    )
    return True, prov, None


def run_targeted_enrichment(
    facts: dict[str, Any],
    source_input: dict[str, Any],
    *,
    search_client: Any,
    capture_client: Any,
    issuer_hosts: dict[str, list[str]] | None = None,
    requested_fields: list[str] | None = None,
    validation_errors: list[dict[str, str]] | None = None,
    include_syllabus: bool = False,
    include_historical_cutoffs: bool = False,
    include_reader_summary: bool = True,
    captured_at: str = "2026-11-03T10:00:00Z",
) -> dict[str, Any]:
    """Execute planned targeted enrichment requests without mutating extraction output or Post."""
    plan = plan_enrichment_requests(
        facts,
        source_input,
        requested_fields=requested_fields,
        validation_errors=validation_errors,
        include_syllabus=include_syllabus,
        include_historical_cutoffs=include_historical_cutoffs,
    )
    reader_summary = (
        build_reader_summary_from_notice(facts, source_input, captured_at=captured_at)
        if include_reader_summary
        else None
    )
    if plan["status"] != "ready":
        return {
            "status": "unresolved",
            "retryable": False,
            "reason_codes": [plan["reason"] or "enrichment_requires_verified_identity"],
            "requests": [],
            "field_candidates": [],
            "reader_summary": reader_summary,
            "official_syllabus": [],
            "historical_cutoffs": [],
        }

    field_candidates: list[dict[str, Any]] = []
    syllabus_candidates: list[dict[str, Any]] = []
    cutoff_candidates: list[dict[str, Any]] = []
    reason_codes: list[str] = []
    any_retryable = False

    for req in plan["requests"]:
        discovery = search_client.discover_for_request(req)
        if not isinstance(discovery, dict) or discovery.get("status") != "ok":
            r_code = (
                discovery.get("reason")
                if isinstance(discovery, dict)
                else "enrichment_search_failed"
            ) or "enrichment_search_failed"
            reason_codes.append(r_code)
            if isinstance(discovery, dict) and discovery.get("retryable"):
                any_retryable = True
            if req["target_type"] == "missing_or_weak_field":
                field_candidates.append(
                    FieldEnrichmentCandidate(
                        post_name=req["post_name"],
                        field_path=req["field_path"],
                        value=None,
                        status="unresolved",
                        reason=r_code,
                        evidence=[],
                    ).model_dump(mode="json")
                )
            elif req["target_type"] == "official_syllabus":
                syllabus_candidates.append(
                    OfficialSyllabusCandidate(
                        post_name=req["post_name"],
                        exam_name=None,
                        status="unresolved",
                        reason=r_code,
                        evidence=[],
                    ).model_dump(mode="json")
                )
            elif req["target_type"] == "historical_cutoff":
                cutoff_candidates.append(
                    HistoricalCutoffCandidate(
                        recruitment_year=None,
                        stage=None,
                        post_name=req["post_name"],
                        category=None,
                        score_type=None,
                        score=None,
                        status="unresolved",
                        reason=r_code,
                        evidence=[],
                    ).model_dump(mode="json")
                )
            continue

        items = discovery.get("candidates") or []
        if req["target_type"] == "missing_or_weak_field":
            valid_values: list[tuple[Any, EnrichmentProvenance, str | None]] = []
            item_reasons: list[str] = []
            for item in items:
                ok, prov, err = _validate_captured_item(
                    item=item,
                    request=req,
                    capture_client=capture_client,
                    issuer_hosts=issuer_hosts,
                )
                val = item.get("value")
                if not ok or prov is None or val is None:
                    item_reasons.append(err or "enrichment_unproven_value")
                    continue
                if isinstance(val, str) and _norm(val) not in _norm(prov.exact_quote):
                    item_reasons.append("enrichment_value_not_in_quote")
                    continue
                if isinstance(val, (int, float)) and not isinstance(val, bool):
                    num_s = str(int(val)) if float(val).is_integer() else str(val)
                    if num_s not in prov.exact_quote:
                        item_reasons.append("enrichment_value_not_in_quote")
                        continue
                valid_values.append((val, prov, item.get("post_binding_quote")))

            distinct_vals = {json.dumps(v[0], sort_keys=True) for v in valid_values}
            if len(distinct_vals) > 1:
                reason_codes.append("enrichment_conflicting_values")
                field_candidates.append(
                    FieldEnrichmentCandidate(
                        post_name=req["post_name"],
                        field_path=req["field_path"],
                        value=None,
                        status="conflicting",
                        reason="enrichment_conflicting_values",
                        evidence=[v[1] for v in valid_values],
                    ).model_dump(mode="json")
                )
            elif len(distinct_vals) == 1:
                chosen_val, chosen_prov, binding_q = valid_values[0]
                field_candidates.append(
                    FieldEnrichmentCandidate(
                        post_name=req["post_name"],
                        field_path=req["field_path"],
                        value=chosen_val,
                        status="verified",
                        reason=None,
                        post_binding_quote=binding_q or chosen_prov.exact_quote,
                        evidence=[chosen_prov],
                    ).model_dump(mode="json")
                )
            else:
                r_code = item_reasons[0] if item_reasons else "enrichment_no_verified_candidate"
                reason_codes.append(r_code)
                field_candidates.append(
                    FieldEnrichmentCandidate(
                        post_name=req["post_name"],
                        field_path=req["field_path"],
                        value=None,
                        status="unresolved",
                        reason=r_code,
                        evidence=[],
                    ).model_dump(mode="json")
                )

        elif req["target_type"] == "official_syllabus":
            valid_syl: list[tuple[dict[str, Any], EnrichmentProvenance]] = []
            syl_reasons: list[str] = []
            for item in items:
                ok, prov, err = _validate_captured_item(
                    item=item,
                    request=req,
                    capture_client=capture_client,
                    issuer_hosts=issuer_hosts,
                )
                if not ok or prov is None:
                    syl_reasons.append(err or "enrichment_unproven_syllabus")
                    continue
                subjects = [s for s in (item.get("subjects") or []) if isinstance(s, str) and s.strip()]
                topics = [t for t in (item.get("topics") or []) if isinstance(t, str) and t.strip()]
                exam_name = (item.get("exam_name") or "").strip() or None
                exam_pattern = (item.get("exam_pattern") or "").strip() or None
                if not exam_name or not subjects:
                    syl_reasons.append("enrichment_incomplete_syllabus")
                    continue
                if any(_norm(s) not in _norm(prov.exact_quote) for s in subjects):
                    syl_reasons.append("enrichment_syllabus_subject_not_in_quote")
                    continue
                valid_syl.append(
                    (
                        {
                            "exam_name": exam_name,
                            "exam_pattern": exam_pattern,
                            "subjects": subjects,
                            "topics": topics,
                            "post_binding_quote": item.get("post_binding_quote") or prov.exact_quote,
                        },
                        prov,
                    )
                )

            distinct_syl = {
                json.dumps(
                    {"exam_name": s[0]["exam_name"], "subjects": s[0]["subjects"]},
                    sort_keys=True,
                )
                for s in valid_syl
            }
            if len(distinct_syl) > 1:
                reason_codes.append("enrichment_conflicting_syllabus")
                syllabus_candidates.append(
                    OfficialSyllabusCandidate(
                        post_name=req["post_name"],
                        exam_name=None,
                        status="conflicting",
                        reason="enrichment_conflicting_syllabus",
                        evidence=[s[1] for s in valid_syl],
                    ).model_dump(mode="json")
                )
            elif len(distinct_syl) == 1:
                chosen_s, chosen_prov = valid_syl[0]
                syllabus_candidates.append(
                    OfficialSyllabusCandidate(
                        post_name=req["post_name"],
                        exam_name=chosen_s["exam_name"],
                        exam_pattern=chosen_s["exam_pattern"],
                        subjects=chosen_s["subjects"],
                        topics=chosen_s["topics"],
                        status="verified",
                        reason=None,
                        post_binding_quote=chosen_s["post_binding_quote"],
                        evidence=[chosen_prov],
                    ).model_dump(mode="json")
                )
            else:
                r_code = syl_reasons[0] if syl_reasons else "enrichment_no_verified_syllabus"
                reason_codes.append(r_code)
                syllabus_candidates.append(
                    OfficialSyllabusCandidate(
                        post_name=req["post_name"],
                        exam_name=None,
                        status="unresolved",
                        reason=r_code,
                        evidence=[],
                    ).model_dump(mode="json")
                )

        elif req["target_type"] == "historical_cutoff":
            by_cat_stage: dict[tuple[int, str, str], list[tuple[dict[str, Any], EnrichmentProvenance]]] = {}
            cut_reasons: list[str] = []
            for item in items:
                ok, prov, err = _validate_captured_item(
                    item=item,
                    request=req,
                    capture_client=capture_client,
                    issuer_hosts=issuer_hosts,
                    is_historical_cutoff=True,
                )
                if not ok or prov is None:
                    cut_reasons.append(err or "enrichment_unproven_cutoff")
                    continue
                rec_year = item.get("recruitment_year")
                stage = (item.get("stage") or "").strip()
                category = (item.get("category") or "").strip()
                score_type = (item.get("score_type") or "").strip()
                score = item.get("score")
                max_score = item.get("maximum_score")
                if (
                    not isinstance(rec_year, int)
                    or not stage
                    or not category
                    or not score_type
                    or not isinstance(score, (int, float))
                    or isinstance(score, bool)
                ):
                    cut_reasons.append("enrichment_incomplete_cutoff")
                    continue
                score_str = str(int(score)) if float(score).is_integer() else str(score)
                if score_str not in prov.exact_quote or _norm(category) not in _norm(prov.exact_quote):
                    cut_reasons.append("enrichment_cutoff_not_in_quote")
                    continue
                key = (rec_year, stage, category)
                by_cat_stage.setdefault(key, []).append((item, prov))

            if not by_cat_stage:
                r_code = cut_reasons[0] if cut_reasons else "enrichment_no_verified_cutoff"
                reason_codes.append(r_code)
                cutoff_candidates.append(
                    HistoricalCutoffCandidate(
                        recruitment_year=None,
                        stage=None,
                        post_name=req["post_name"],
                        category=None,
                        score_type=None,
                        score=None,
                        status="unresolved",
                        reason=r_code,
                        evidence=[],
                    ).model_dump(mode="json")
                )
            else:
                for (rec_year, stage, category), group in sorted(by_cat_stage.items()):
                    scores = {float(g[0]["score"]) for g in group}
                    if len(scores) > 1:
                        reason_codes.append("enrichment_conflicting_cutoff")
                        cutoff_candidates.append(
                            HistoricalCutoffCandidate(
                                recruitment_year=rec_year,
                                stage=stage,
                                post_name=req["post_name"],
                                category=category,
                                score_type=group[0][0].get("score_type"),
                                score=None,
                                maximum_score=None,
                                status="conflicting",
                                reason="enrichment_conflicting_cutoff",
                                evidence=[g[1] for g in group],
                            ).model_dump(mode="json")
                        )
                    else:
                        chosen_c, chosen_prov = group[0]
                        cutoff_candidates.append(
                            HistoricalCutoffCandidate(
                                recruitment_year=rec_year,
                                stage=stage,
                                post_name=req["post_name"],
                                category=category,
                                score_type=chosen_c["score_type"],
                                score=float(chosen_c["score"]),
                                maximum_score=(
                                    float(chosen_c["maximum_score"])
                                    if isinstance(chosen_c.get("maximum_score"), (int, float))
                                    else None
                                ),
                                status="verified",
                                reason=None,
                                post_binding_quote=chosen_c.get("post_binding_quote") or chosen_prov.exact_quote,
                                evidence=[chosen_prov],
                            ).model_dump(mode="json")
                        )

    return {
        "status": "retryable" if any_retryable else ("completed_with_unresolved" if reason_codes else "completed"),
        "retryable": any_retryable,
        "reason_codes": sorted(set(reason_codes)),
        "requests": plan["requests"],
        "field_candidates": field_candidates,
        "reader_summary": reader_summary,
        "official_syllabus": syllabus_candidates,
        "historical_cutoffs": cutoff_candidates,
    }
