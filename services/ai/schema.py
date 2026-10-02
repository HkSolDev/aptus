"""LLM output contract: validate structure and dates, not source-grounded accuracy."""

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y")
DATE_HINT = (
    "Format YYYY-MM-DD. Indian sources write DD/MM/YYYY (day first). "
    "null if not stated or unclear."
)


def parse_date(value: object) -> date | None:
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


class CategoryRelaxationRules(BaseModel):
    # Reject invented keys. Nullable fields must still be present; null means unstated.
    model_config = ConfigDict(extra="forbid")

    SC: int | None
    ST: int | None
    OBC: int | None
    EWS: int | None
    PwBD: int | None


class AgeRule(BaseModel):
    """One exact age rule, including gender/category conditions."""

    model_config = ConfigDict(extra="forbid")

    category: str | None
    gender: str | None
    min_age: int | None
    max_age: int | None
    relaxation_years: int | None
    conditions: str | None


class EducationOption(BaseModel):
    """One alternative route through which a candidate can qualify."""

    model_config = ConfigDict(extra="forbid")

    minimum_level: (
        Literal["TENTH", "TWELFTH", "DIPLOMA", "BACHELORS", "MASTERS", "PHD"]
        | None
    )
    minimum_marks_percent: float | None
    qualification: str | None
    subject_requirement: str | None
    conditions: str | None


class EligibilityRules(BaseModel):
    """Detailed rules kept when a flat Post field is not expressive enough."""

    model_config = ConfigDict(extra="forbid")

    gender_requirement: str | None
    category_requirement: list[str]
    education_options: list[EducationOption]
    age_rules: list[AgeRule]
    relaxation_combination_rule: str | None


class Post(BaseModel):
    model_config = ConfigDict(extra="forbid")

    post_name: str | None
    vacancies: int | None
    application_last_date: date | None = Field(description=DATE_HINT)
    age_as_on_date: date | None = Field(description=DATE_HINT)
    min_age: int | None
    max_age: int | None
    education_required: str | None
    post_group: Literal["A", "B", "C", "D"] | None
    pay_level: str | None
    min_education_level: (
        Literal["TENTH", "TWELFTH", "DIPLOMA", "BACHELORS", "MASTERS", "PHD"] | None
    )
    min_marks_percent: float | None
    category_relaxation_applies: bool | None
    category_relaxation_rules: "CategoryRelaxationRules | None"
    eligibility_rules: EligibilityRules

    @field_validator("application_last_date", "age_as_on_date", mode="before")
    @classmethod
    def _bad_date_becomes_none(cls, value: object) -> date | None:
        return parse_date(value)


class PostBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    posts: list[Post]
