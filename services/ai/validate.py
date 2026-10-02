"""Standalone gender-age checks; not yet called by the extraction pipeline."""

import re

from schema import AgeRule


def extract_gender_max_ages(source_text: str) -> dict[str, int]:
    """Read 'N Years for Male/Female' from a maximum-age-only excerpt."""
    # The caller must select maximum ages: this pattern cannot distinguish minimum ages.
    pattern = (
        r"\b(?P<age>\d{1,3})\s+Years?\s+for\s+"
        r"(?P<gender>male|female)\b"
    )

    matches = re.finditer(pattern, source_text, re.IGNORECASE)
    max_age = {}

    for match in matches:
        gender = match.group("gender").casefold()
        age = int(match.group("age"))

        max_age[gender] = age

    return max_age

def validate_age_rules(
    source_text: str,
    age_rules: list[AgeRule],
) -> list[str]:
    """Compare source maximum ages with extracted rules; return readable issues."""
    expected = extract_gender_max_ages(source_text)
    issues: list[str] = []

    for gender, expected_age in expected.items():
        matching_rule = None

        # This simple check uses the first gender match, not category-specific combinations.
        for rule in age_rules:
            if rule.gender and rule.gender.strip().casefold() == gender:
                matching_rule = rule
                break

        if matching_rule is None:
            issues.append(f"Missing maximum-age rule for {gender}")

        elif matching_rule.max_age != expected_age:
            issues.append(
                f"{gender}: expected {expected_age}, "
                f"received {matching_rule.max_age}"
            )

    return issues


if __name__ == "__main__":
    source = "Maximum Age: 37 Years for Male & 40 Years for Female"
    print("Source:", source)
    print("Expected result: {'male': 37, 'female': 40}")
    print("Detected:", extract_gender_max_ages(source))
