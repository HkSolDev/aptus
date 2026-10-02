"""Extract age facts from a selected section; not yet wired into the LLM prompt."""

import json
import re


def extract_age_facts(source_text: str) -> dict[str, list[dict]]:
    """Read minimum/maximum ages from an age section; keep their conditions."""
    facts: dict[str, list[dict]] = {"minimum": [], "maximum": []}
    # Capturing the label makes parts alternate: heading, label, text, label, text.
    parts = re.split(r"\b(minimum|maximum)\s+age\s*:?", source_text, flags=re.I)

    for index in range(1, len(parts), 2):
        kind = parts[index].casefold()
        # Stop before relaxation notes so their numbers do not become base age limits.
        block = re.split(
            r"\b(?:read\s+the\s+notification|age\s+relaxation|vacancy\s+details)\b",
            parts[index + 1], maxsplit=1, flags=re.I,
        )[0]
        block = " ".join(block.split()).strip(" :;.")

        # Split '37 Years ... and 40 Years ...', but keep 'TGT and PGT' together.
        for clause in re.split(r"(?:&|\band\b)\s*(?=\d{1,3}\s+years?\b)", block, flags=re.I):
            clause = clause.strip()
            if not clause:
                continue
            # Unsupported wording stays as source text with a null age, never a guess.
            match = re.fullmatch(
                r"(?P<age>\d{1,3})\s+years?(?:\s+(?:for\s+)?(?P<condition>.+))?",
                clause, flags=re.I,
            )
            facts[kind].append({
                "age": int(match.group("age")) if match else None,
                "applies_to": match.group("condition") if match else None,
                "source_text": clause,
            })

    return facts


if __name__ == "__main__":
    source = """Minimum Age:
18 Years for Primary Teacher
Minimum Age:
21 Years for TGT / PGT Teacher
Maximum Age:
37 Years for Male & 40 Years for Female
Read the Notification for Age Relaxation."""
    facts = extract_age_facts(source)
    assert [rule["age"] for rule in facts["minimum"]] == [18, 21]
    assert [(rule["age"], rule["applies_to"]) for rule in facts["maximum"]] == [
        (37, "Male"), (40, "Female"),
    ]
    assert extract_age_facts("No ages stated") == {"minimum": [], "maximum": []}
    unresolved = extract_age_facts("Maximum Age: 23-25 Years (Post Wise)")
    assert unresolved["maximum"][0]["age"] is None
    joined = extract_age_facts("Maximum Age: 37 Years for Male and 40 Years for Female")
    assert [(rule["age"], rule["applies_to"]) for rule in joined["maximum"]] == [
        (37, "Male"), (40, "Female"),
    ]
    role = extract_age_facts("Minimum Age: 21 Years for TGT and PGT Teacher")
    assert role["minimum"][0]["applies_to"] == "TGT and PGT Teacher"
    print(json.dumps(facts, indent=2))
