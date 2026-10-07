# Aptus: what I should learn, own, and delegate

Created: 2 October 2026. Companion: [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md).

## The goal

Become able to own an applied AI feature end-to-end: understand the problem,
design a small system, integrate an LLM, verify its output, handle failures,
store correct data, and explain the tradeoffs. Aptus is the practical exercise.
This plan is not a guarantee of a job, salary, or interview result.

I do not need to memorize every line or implement everything without help.
I do need to understand and verify the core behaviour I claim on my resume.

## The most important focus

**Turn uncertain model output into a tested, reliable application contract.**

For each field, ask: Where did it come from? Is its shape valid? Is it supported
by the source? Did it survive storage? What happens if it is wrong or missing?

This connects Python, LLM APIs, validation, databases, and system design through
one real problem. Do not substitute collecting frameworks for solving it.

## What I own versus what the assistant handles

| Area            | I should own and practise                                           | Assistant can handle                                              |
| --------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Architecture    | Explain stages, boundaries, alternatives, and failure policy        | Present tradeoffs, draw the flow, review my decision              |
| Schema          | Decide what each field means; model alternatives and uncertainty    | Pydantic/TypeScript syntax and repetitive field scaffolding       |
| Parsing         | Write section boundaries and understand row alignment               | Small examples, fixtures, unfamiliar syntax explanations          |
| LLM integration | Understand prompts, request/response schema, timeouts, cost         | Provider HTTP plumbing and repetitive adapter setup               |
| Validation      | Write the comparisons and decide null/reject/manual-check behaviour | Suggest counterexamples, review logic, build test scaffolding     |
| Persistence     | Trace every field from JSON to saved row; define update behaviour   | Migration boilerplate and mapping scaffolding after my decision   |
| Reliability     | Decide retry versus skip, success criteria, and safe resends        | Logging/config plumbing and failure simulation                    |
| Matching        | Write and test eligibility comparisons and uncertainty handling     | Test cases and review; never replace exact rules with LLM guesses |
| Documentation   | Explain what I built and its limitations in my own words            | Organize notes, improve clarity, maintain file maps               |
| Tooling/UI      | Verify results and learn tools only as needed                       | Repetitive setup, formatting, basic layout work                   |

Delegation does not mean ignoring the code. I should read the generated change,
run it, and explain what enters, what leaves, and what happens on failure.
If I explicitly ask the assistant to implement core logic, it may help, but
should explain the decision and give me a small verification exercise.

## Learning priorities, in order

### 1. Python fluency through this pipeline

Understand functions, dictionaries, lists, loops, return values, type hints,
exceptions, imports, and objects. Practise `None`, `str | None`, and `list[AgeRule]`:
`age_rules` is a variable whose value is a list; `AgeRule` is the element type.

Understand regex named groups (`(?P<gender>...)` defines the name used by
`match.group("gender")`), `.casefold()`, `.strip()`, and generator expressions.
Learn how to print a small intermediate result and write an assertion before
trying the whole pipeline. A lambda is a small function, not a special scraper.

### 2. Structured output and data contracts

Understand JSON versus Python dictionaries versus Pydantic objects.
Know why `model_validate_json()` parses/checks responses and why
`model_dump(mode="json")` prepares a payload. Understand required-but-nullable
fields and `extra="forbid"`. Know why a Protocol describes an interface while
the factory chooses a concrete provider.

### 3. Evaluation and source grounding

Distinguish schema validity, factual correctness, completeness, persistence,
and eligibility correctness. A response can pass the first and fail the rest.

Build a small evaluation set of real notification examples with manually
checked expected fields. Include missing values, repeated headings, empty cells,
multiple roles, different male/female limits, category conditions, education
alternatives, and confusing application/fee dates. Use saved fixtures for
repeatable tests; use live tests separately to detect source changes.

Keep a short error record: expected value, actual value, source evidence,
failure stage, fix, and regression test. Measure field-level correctness on
that set before claiming that a prompt improvement worked.

### 4. API and storage consistency

Trace a field across Python schema -> JSON -> TypeScript request -> Prisma ->
saved row -> matcher. Learn migrations, transactions, updates, and idempotency
through real changes. A field present in an LLM response but absent from the
database is an integration bug, not necessarily a model bug.

### 5. Failure handling and observability

Understand status codes, timeouts, bounded retries, and backoff. Retry a
temporary failure; do not blindly retry invalid credentials or unsafe writes.
An ingestion timeout may mean the database write succeeded but the response
was lost. Resends therefore need well-defined update behaviour.

Track run ID, source URL, stage, duration, status, created/skipped counts, and
error reason. Do not log API keys or unnecessarily expose user data. A crash
handler cannot reliably send a final message after a hard kill or machine loss:
process supervision and an external heartbeat/monitor are separate concerns.

### 6. Deployment and security

Learn environment variables, secret handling, migrations, protected internal
endpoints, scheduling, process restarts, and database backups. Confirm that
multiple users checking jobs do not trigger repeated extraction calls.

Study RAG, embeddings, queues, or orchestration when a concrete requirement
needs them, or separately when a particular interview asks about them. Do not
add them to Aptus merely to name them on a resume. Eligibility itself remains
deterministic, not similarity search.

## Completed slice: preserve the extracted rule object

**Carry `eligibility_rules` from Pydantic through TypeScript into PostgreSQL.**

Before code, I explain:

1. Which extracted rules must survive storage?
2. What storage representation should we choose, and what is its tradeoff?
3. What happens if a changed notification has no rules or extraction fails?
4. How will we prove a rule survived the handoff unchanged?

The chosen representation is nullable PostgreSQL JSONB on each post: it keeps
the nested shape and allows existing rows to remain valid, while matching still
uses flat fields. The assistant can prepare migration/setup boilerplate. I
should own the field mapping and verification, with small hints and review if
needed.

Done means: a fixture with conditional age/education rules reaches storage,
can be read back with those conditions intact, and has a regression test.
It does not yet mean the matcher supports those rules.

The object now survives ingestion and PostgreSQL storage. Runtime shape checks
have regression tests, and local database verification confirmed intact rules,
rejection without writes, and legacy compatibility. Practise explaining why
nullable JSONB supports older rows and why TypeScript interfaces alone cannot
validate HTTP JSON.

After that: connect age validation, test one live notification end-to-end,
then improve failure isolation. Keep each session to one useful slice.

## Working agreement for this chat and future sessions

Assistants should read this guide alongside the architecture snapshot when
working on Aptus, and follow these defaults unless I explicitly ask otherwise:

- Start a coding session by naming one task and the core logic I will practise.
- Label the division briefly: "You own X; I can scaffold Y."
- Ask me for the reasoning before implementing a new architectural choice.
- Give hints or a small example first when I am practising core logic.
- Explain unfamiliar syntax in plain language, without a long theory detour.
- Ask "What can fail here, and what should happen?" before the happy path.
- Review my attempt and fix one misunderstanding at a time.
- End with a test result, one thing learned, and a short interview explanation.
- Remind me at task boundaries, not repeatedly during every small question.
- If I ask for full implementation, help without withholding it; still explain
  what I must verify and what remains incomplete.

These files preserve the agreement when chat context is compacted. They are
not automatic reminders or a scheduled task. Future sessions need to read them;
update them when a task is completed or a decision changes.

## A session that fits my pace

Use this as a flexible routine, not a deadline:

1. Explain the goal and failure case in a few sentences.
2. Inspect one relevant file and trace its input/output.
3. Implement one small behaviour myself; delegate agreed boilerplate.
4. Test normal, missing-data, and incorrect-data cases.
5. Write a short explanation in my own words.

If I cannot explain the change yet, stop expanding the feature and work through
a smaller example. Understanding one reliable slice is better than accepting
a large block unread.

## Interview and resume checklist

For every feature I mention, I should be able to answer:

- What real problem did it solve?
- Why this language, boundary, schema, or tool?
- What alternative did I consider and why not use it now?
- How does it fail, and how do we recover?
- What test or live evidence proves it works?
- What limitations remain?
- Which parts did I write, and which did AI help generate?

An honest current resume description:

> Built a Python pipeline for government-job notification extraction using
> structured LLM output and Pydantic, with a TypeScript ingestion API and
> PostgreSQL persistence; added section parsing and regression tests for
> nested tables and neighboring-field boundaries.

Only claim deployment, extraction accuracy, complete rule support, or real-user
impact after verifying it. Do not present passing unit tests as production
evidence. Apply while improving the project; finishing every future feature
is not a prerequisite for describing the working parts honestly.

## Interview explanation template

"The problem was ____. I considered ____ and ____. I chose ____ because ____.
The main failure case was ____. I handled/tested it by ____. The current
limitation is ____, and the next small improvement is ____."

For Aptus specifically, practise explaining why structured JSON is not factual
validation, why null is safer than guessing, why extraction happens before user
requests, and why the LLM does not decide whether a person is eligible.
