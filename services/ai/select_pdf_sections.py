"""Select candidate PDF evidence ranges; never claim complete job coverage."""

import re


TOPICS = {
    "education": r"educational qualifications?|essential qualifications?|eligibility criteria|academic qualifications?|degree|diploma|language proficiency|work experience|post.qualification experience|recogni[sz]ed university|nationality|citizenship",
    "age": r"age limit|age relaxation|relaxation in age|upper age|minimum age|maximum age|born not earlier|born not later",
    "vacancies": r"vacanc(?:y|ies)|details of posts|post.wise|category.wise|bank.wise",
    "reservation": r"reservation|reserved categor|benchmark disabilit|non.creamy layer|ex.servicemen|\bEWS\b|\bPwBD\b",
    "dates": r"important dates|tentative schedule|last date|closing date|cut.off date|as on|on.line registration",
    "fee": r"application fees?|examination fee|intimation charges|payment of fees|fee exemption",
}
PATTERNS = {topic: re.compile(pattern, re.I) for topic, pattern in TOPICS.items()}
REFERENCE = re.compile(r"\b(?:see|refer(?:red)?\s+to|given\s+in|specified\s+in|as\s+per)\b[^.\n]{0,100}\b(?:annexure|appendix|paragraph|section|page)\s+[A-Z0-9().-]+", re.I)
AMENDMENT = re.compile(r"\b(?:corrigendum|addendum|stands deleted|read as|substituted)\b", re.I)
OUTLINE = r"(?:(?:[A-Z]|[IVXLCDM]+|\d+(?:\.\d+)*)[.)]\s*)*"
HEADING = re.compile(r"^" + OUTLINE + r"(?:educational qualifications?|essential qualifications?|eligibility criteria|age limit|age relaxation|important dates|tentative schedule|application fees?|intimation charges|vacanc(?:y|ies)|reservation|general instructions|selection process|examination pattern|online examination structure|nationality|citizenship|annexure|appendix|corrigendum|addendum|venues|examination centres)\b", re.I)
NUMBERED_TITLE = re.compile(r"^(?:[A-Z]|[IVXLCDM]+|\d+(?:\.\d+)*)[.)]\s+")
NOTES = re.compile(r"\b(?:notes?|footnotes?|continued|contd|provided that|however|subject to|only for|for the post of)\b", re.I)
SCOPE = re.compile(r"\b(?:only for|for the post of|officer|office assistant|post code|post name)\b", re.I)


def topics_for(text):
    return [topic for topic, pattern in PATTERNS.items() if pattern.search(text)]


def heading(text, following=""):
    """Conservative boundary hints; uncertain levels are explicitly reviewed."""
    if len(text) > 130 or not text.strip():
        return False
    if re.search(r"\.{3,}\s*\d+\s*$", text):
        return False  # Contents entries are locators, not section boundaries.
    joined = text + " " + following
    short_title = len(text.split()) <= 14 and HEADING.match(joined) and not text.endswith(".")
    numbered_caps_title = (
        len(text) <= 150
        and NUMBERED_TITLE.match(text)
        and sum(character.isalpha() for character in text) >= 8
        and text.upper() == text
    )
    numbered_title = (
        len(text.split()) <= 14
        and NUMBERED_TITLE.match(text)
        and sum(character.isalpha() for character in text) >= 8
        and sum(character.isdigit() for character in text) <= 3
        and not text.endswith(".")
    )
    # A numbered all-caps title is common in recruitment PDFs. Plain all-caps
    # text is often a post name or table header, so it must not create a split.
    return bool(short_title or numbered_caps_title or numbered_title)


def expand_table_range(start, end, lines, page_ranges, blocks):
    """Mark selected sections that contain native table geometry.

    The surrounding section already keeps the complete source pages. Extending
    a range based on table geometry is unsafe: many ordinary PDF pages are
    reported as tables by the parser, which can merge unrelated sections.
    """
    has_table = any(blocks[line["page"]].get("tables") for line in lines[start:end])
    return start, end, ["table_source_page"] if has_table else []


def pdf_identity_context(document):
    """Preserve the actual first-page header even when topic selection omits it."""
    if not any(page["number"] == 1 and page.get("native_status") == "usable_candidate"
               for page in document.get("pages", [])):
        return None
    block = next((block for block in document.get("blocks", []) if block["page"] == 1), None)
    if not block:
        return None
    native = next((item for item in block.get("alternatives", [])
                   if item.get("method") == "native_text" and item.get("status") == "candidate"), None)
    lines = native["text"].splitlines()[:12] if native else []
    if not lines:
        return None
    return {"text": "\n".join(lines), "evidence": [{"block_id": block["id"], "page": 1,
        "line_range": [1, len(lines)], "bbox": block["bbox"],
        "bbox_scope": "source_page", "method": "native_text"}]}


def select_pdf_sections(document: dict, *, max_characters=120_000) -> dict:
    """Return untruncated candidate units from normalize_pdf output, offline.

    Budget is characters, not tokens. Rejected/missing pages remain coverage gaps.
    Source page IDs and text-line ranges provide reproducible evidence locations.
    """
    if document.get("format") != "pdf":
        raise ValueError("Expected normalized PDF")
    if isinstance(max_characters, bool) or not isinstance(max_characters, int) or max_characters < 1:
        raise ValueError("max_characters must be a positive integer")
    pages = document.get("pages", [])
    readable = {page["number"] for page in pages
                if page.get("native_status") == "usable_candidate"}
    lines, index, page_ranges, blocks = [], [], {}, {}
    for block in sorted(document.get("blocks", []), key=lambda item: item["page"]):
        alternative = next((item for item in block.get("alternatives", [])
                            if item.get("method") == "native_text" and item.get("status") == "candidate"), None)
        if block["page"] not in readable or not alternative:
            continue
        text = alternative.get("text") or ""
        contents = bool(re.search(r"^\s*(?:table of contents|contents|index)\s*$", text[:300], re.I | re.M))
        index.append({"page": block["page"], "topics": topics_for(text),
                      "character_count": len(text), "block_id": block["id"],
                      "role": "contents_hint" if contents else "source_candidate"})
        if contents:
            continue
        start = len(lines)
        for number, line in enumerate(text.splitlines(), 1):
            lines.append({"text": line, "page": block["page"], "line": number,
                          "block_id": block["id"], "bbox": block["bbox"]})
        page_ranges[block["page"]] = (start, len(lines))
        blocks[block["page"]] = block
    boundaries = [0]
    for i, line in enumerate(lines):
        following = lines[i + 1]["text"] if i + 1 < len(lines) else ""
        if i and line["page"] > lines[i - 1]["page"] + 1:
            boundaries.append(i)
        elif i and heading(line["text"], following):
            # Keep split headings together (e.g. EDUCATIONAL / QUALIFICATIONS).
            if HEADING.match(lines[i - 1]["text"] + " " + line["text"]) and len(lines[i - 1]["text"].split()) <= 2:
                continue
            boundaries.append(i)
    boundaries.append(len(lines))
    ranges = []
    for start, end in zip(boundaries, boundaries[1:]):
        text = "\n".join(line["text"] for line in lines[start:end])
        if not topics_for(text) and not AMENDMENT.search(text):
            continue
        reasons = ["topic_or_amendment_match"]
        # Preserve an immediately preceding post/scope unit, not a word window.
        prior = next((a for a, b in zip(boundaries, boundaries[1:]) if b == start), None)
        if prior is not None and SCOPE.search("\n".join(line["text"] for line in lines[prior:start])):
            if lines[start]["page"] <= lines[start - 1]["page"] + 1:
                start = prior
                reasons.append("preceding_post_scope")
        start, end, table_reasons = expand_table_range(start, end, lines, page_ranges, blocks)
        reasons.extend(table_reasons)
        ranges.append((start, end, reasons))
    merged = []
    for start, end, reasons in sorted(ranges):
        if merged and start < merged[-1][1]:
            old_start, old_end, old_reasons = merged[-1]
            merged[-1] = (old_start, max(old_end, end), sorted(set(old_reasons + reasons)))
        else:
            merged.append((start, end, reasons))
    sections, omitted, references, used = [], [], [], 0
    for start, end, reasons in merged:
        group = lines[start:end]
        if not group:
            continue
        text = "\n".join(line["text"] for line in group)
        topics = topics_for(text)
        amendment = bool(AMENDMENT.search(text))
        if not topics and not amendment:
            continue
        evidence = []
        for line in group:
            if evidence and evidence[-1]["block_id"] == line["block_id"]:
                evidence[-1]["line_range"][1] = line["line"]
            else:
                evidence.append({"block_id": line["block_id"], "page": line["page"],
                    "line_range": [line["line"], line["line"]], "bbox": line["bbox"],
                    "bbox_scope": "source_page", "method": "native_text"})
        refs = REFERENCE.findall(text)
        references.extend(refs)
        unit = {"id": f"section-{start}", "topics": topics,
                "heading": group[0]["text"], "page_range": [group[0]["page"], group[-1]["page"]],
                "text": text, "evidence": evidence, "status": "candidate_requires_review",
                "selection_reasons": reasons,
                "warnings": ["section_boundaries_heuristic", "table_continuity_unverified"],
                "unresolved_references": refs}
        if amendment:
            unit["warnings"].append("amendment_scope_requires_review")
        if used + len(text) > max_characters:
            omitted.append({"id": unit["id"], "topics": topics,
                            "page_range": unit["page_range"], "reason": "character_budget_exceeded"})
        else:
            sections.append(unit)
            used += len(text)
    unreadable = [page["number"] for page in pages if page["number"] not in readable]
    return {"source_url": document.get("source_url"), "selector_version": "pdf-sections-v2",
        "status": "budget_exceeded" if omitted else "candidate_requires_review",
        "page_index": index, "sections": sections, "identity_context": pdf_identity_context(document),
        "coverage": {"pages_indexed": len(index), "unreadable_pages": unreadable,
            "missing_topics": [topic for topic in TOPICS if not any(topic in unit["topics"] for unit in sections)],
            "unresolved_references": sorted(set(references)), "omitted_sections": omitted},
        "selected_characters": used,
        "warnings": list(document.get("warnings", [])) + ["coverage_not_established"]}


def complete_pdf_sections(candidate: dict, document: dict, *, max_characters=120_000) -> dict:
    """Restore complete source pages around selected qualification/vacancy evidence.

    Keep the broad selection. Do not interpret table cells or claim that pages
    missing from the candidate have been recovered.
    """
    if document.get("format") != "pdf" or candidate.get("source_url") != document.get("source_url"):
        raise ValueError("Candidate and normalized PDF must have the same source")
    if isinstance(max_characters, bool) or not isinstance(max_characters, int) or max_characters < 1:
        raise ValueError("max_characters must be a positive integer")
    expanded = {item["page"] for unit in candidate["sections"]
                if set(unit["topics"]) & {"education", "vacancies", "age", "reservation"}
                for item in unit["evidence"]}
    ranges = {}
    for unit in candidate["sections"]:
        for item in unit["evidence"]:
            ranges.setdefault(item["block_id"], set()).update(
                range(item["line_range"][0], item["line_range"][1] + 1))
    readable = {page["number"] for page in document["pages"]
                if page.get("native_status") == "usable_candidate"}
    sections, recovered = [], set()
    for block in sorted(document["blocks"], key=lambda item: item["page"]):
        if block["id"] not in ranges or block["page"] not in readable:
            continue
        native = next((item for item in block.get("alternatives", [])
                       if item.get("method") == "native_text" and item.get("status") == "candidate"), None)
        if not native:
            continue
        lines = native["text"].splitlines()
        numbers = list(range(1, len(lines) + 1)) if block["page"] in expanded else sorted(ranges[block["id"]])
        if not numbers or any(number < 1 or number > len(lines) for number in numbers):
            raise ValueError("Candidate line range falls outside its source block")
        # Preserve gaps as separate evidence ranges; never claim skipped lines.
        evidence = []
        for number in numbers:
            if evidence and evidence[-1]["line_range"][1] + 1 == number:
                evidence[-1]["line_range"][1] = number
            else:
                evidence.append({"block_id": block["id"], "page": block["page"],
                    "line_range": [number, number], "bbox": block["bbox"],
                    "bbox_scope": "source_page", "method": "native_text"})
        text = "\n".join(lines[number - 1] for number in numbers)
        recovered.add(block["id"])
        sections.append({"id": f"{block['id']}-evidence", "heading": lines[numbers[0] - 1],
            "text": text, "topics": topics_for(text), "page_range": [block["page"], block["page"]],
            "evidence": evidence, "unresolved_references": REFERENCE.findall(text),
            "status": "candidate_requires_review", "warnings": ["table_continuity_unverified"],
            "selection_reasons": ["full_source_page" if block["page"] in expanded else "original_candidate_lines"]})
    used = sum(len(unit["text"]) for unit in sections)
    gaps = sorted(set(ranges) - recovered)
    references = set(candidate.get("coverage", {}).get("unresolved_references", []))
    references.update(ref for unit in sections for ref in unit["unresolved_references"])
    return {**candidate, "selector_version": "pdf-evidence-pages-v1", "sections": sections,
        "identity_context": pdf_identity_context(document),
        "selected_characters": used, "restored_pages": sorted(expanded),
        "status": "budget_exceeded" if used > max_characters or candidate.get("status") == "budget_exceeded" else "candidate_requires_review",
        "coverage": {**candidate.get("coverage", {}), "unavailable_blocks": gaps,
            "unresolved_references": sorted(references),
            "missing_topics": [topic for topic in TOPICS if not any(topic in unit["topics"] for unit in sections)]},
        "warnings": list(candidate.get("warnings", [])) + ["unselected_page_coverage_not_established"]}


if __name__ == "__main__":
    import argparse
    import json
    from pathlib import Path
    from normalize_pdf import normalize_pdf

    parser = argparse.ArgumentParser(description="Preview selected PDF evidence without calling an LLM")
    parser.add_argument("pdf_path")
    parser.add_argument("source_url")
    parser.add_argument("--candidate-json", help="Restore evidence from an existing broad selection")
    args = parser.parse_args()
    document = normalize_pdf(Path(args.pdf_path).read_bytes(), args.source_url, max_pages=100)
    candidate = (json.loads(Path(args.candidate_json).read_text()) if args.candidate_json
                 else select_pdf_sections(document))
    result = complete_pdf_sections(candidate, document)
    print(json.dumps(result, ensure_ascii=False, indent=2))
