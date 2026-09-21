from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

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


class Post(BaseModel):
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
    category_relaxation_rules: dict[str, int] | None

    @field_validator("application_last_date", "age_as_on_date", mode="before")
    @classmethod
    def _bad_date_becomes_none(cls, value: object) -> date | None:
        return parse_date(value)






#     # model Post {
#   id                         String          @id @default(cuid())
#   sourceId                   String
#   source                     Source          @relation(fields: [sourceId], references: [id])
#   postName                   String
#   postGroup                  PostGroup?
#   payLevel                   String?
#   minAge                     Int?
#   maxAge                     Int?
#   // Raw text kept for display + manual verification when the level below
#   // can't be classified confidently (e.g. subject-specific requirements).
#   educationRequired          String?
#   minEducationLevel          EducationLevel?
#   minMarksPercent            Float?
#   categoryRelaxationApplies  Boolean?
#   // Age relaxation in years per category for THIS post specifically,
#   // e.g. { "SC": 5, "OBC": 3 }. Kept per-post, not on Source, because a
#   // notification can grant different relaxation to different post groups
#   // (e.g. SSC CGL gives Group 'C' posts additional relaxation beyond the
#   // general table) — one shared value would be wrong for some posts.
#   categoryRelaxationRules    Json?
# }
