# Aptus basic held-candidate review workflow: contract proposal

Date: 2026-10-29  
Status: Proposed (Task-owned; submitted for coordinator and Hemant review)  
Baseline commit: `d930a69e0093a440ef5ad99c92a6ab19326cec17`  
Branch: `codex/admin-review-worker-validation`  
Worktree: `/Users/mrblackghost/Work/Projects/aptus-admin-review-worker-validation`

---

## 1. Scope, authority, and boundaries

This proposal defines the interface boundaries, state transitions, and schemas for Aptus's basic held-candidate review workflow:
$$\text{Existing held candidate} \longrightarrow \text{Inspect evidence} \longrightarrow \text{Save correction} \longrightarrow \text{Request Python validation} \longrightarrow \text{Inspect results}$$

### Explicit exclusions:
- No AI correction suggestions, automatic publication, or candidate approval controls (publication controls are deferred to subsequent slices; existing publication protections remain intact).
- No general catalogue editing, bulk review operations, or MCP server integration.
- No production database changes or production service restarts.
- No model calls, web crawling, or network fetching during validation.

---

## 2. Participating actors and authorization

| Actor | Identification & Transport | Permissions |
|---|---|---|
| **Anonymous visitor** | Unauthenticated cookie / headers | Denied access (`401 Unauthorized` on API; redirected to sign-in on `/admin/review`) |
| **Signed-in non-operator** | Valid Better Auth session cookie | Denied access (`403 Forbidden`; verified email not in `APTUS_REVIEW_OPERATOR_EMAILS`) |
| **Authorized operator** | Valid session cookie with verified email matching `APTUS_REVIEW_OPERATOR_EMAILS` | Read review queue, view candidate evidence/facts, save corrections, trigger validation, mark held |
| **Worker runtime** | Bearer token (`Authorization: Bearer <INGEST_TOKEN>`) | Import drafts (`POST /api/internal/review-drafts`), claim validation tasks (`POST /api/internal/review-tasks/claim`), report validation results (`POST /api/internal/review-tasks/:taskId/result`) |

### Selected operator accounts (pre-configured):
- `hemantkumar4213@gmail.com`
- `mrdevghost@gmail.com`

Missing or empty `APTUS_REVIEW_OPERATOR_EMAILS` denies all review access server-side. Reviewer email is always derived from the server session; client-submitted identity is never trusted.

### CSRF & Same-Origin rules:
- State-changing browser mutations (`POST /api/admin/review-drafts/**`) require `Origin` header matching `appAuth.options.baseURL` (standard Aptus protection). Mismatched origin returns `403 Forbidden`.
- `Cache-Control: no-store` and `Pragma: no-cache` are applied to all private review endpoints and pages.

---

## 3. Boundary contracts & HTTP specifications

### 3.1 Worker draft import: `POST /api/internal/review-drafts`

**Authentication**: `Authorization: Bearer <INGEST_TOKEN>`  
**Purpose**: Ingest an offline-held candidate draft along with its source evidence and locations.

#### Request body (`application/json`, max 1 MB):
```json
{
  "bundle_id": "8d6c663917a1282cd6fa4322",
  "source_url": "https://example.gov.in/recruitment.html",
  "source_name": "Example Recruitment Board",
  "disposition": "valid_recruitment_review_draft",
  "facts": {
    "purpose": "recruitment",
    "posts": [ ... ],
    "evidence": [ ... ],
    "missing_fields": [ ... ],
    "purpose_evidence": [ ... ],
    "document_purposes": [ ... ]
  },
  "review": {
    "status": "needs_review",
    "warnings": [ ... ],
    "semantic_support_verified": false,
    "publication_allowed": false,
    "bundle_identity": {},
    "field_checks": []
  },
  "evidence_units": [
    {
      "evidence_id": "ev-1",
      "document_id": "doc-1",
      "source_url": "https://example.gov.in/recruitment.pdf",
      "role": "notice_pdf",
      "authority": "official",
      "locations": [ ... ]
    }
  ],
  "source_evidence": [
    {
      "document_id": "doc-1",
      "format": "pdf",
      "source_url": "https://example.gov.in/recruitment.pdf",
      "sections": [
        {
          "evidence_id": "ev-1",
          "text": "Extracted plain text quotation...",
          "locations": [ ... ]
        }
      ]
    }
  ],
  "hold_reason": "Unstated vacancy count; manual age verification required"
}
```

#### Response (`201 Created` or `200 OK` on replay):
```json
{
  "item_id": "cuid_item_123",
  "bundle_id": "8d6c663917a1282cd6fa4322",
  "revision_id": "cuid_rev_1",
  "revision_number": 1,
  "canonical_hash": "a1b2c3...",
  "duplicate": false
}
```

#### Replay and conflict semantics:
- Server computes canonical content hash of `facts`.
- If an item with `bundle_id` already exists:
  - If the incoming facts match existing revision canonical hash: returns existing `{ item_id, revision_id, canonical_hash, duplicate: true }` (`200 OK`).
  - If existing item has human revisions (revision_number > 1): new worker import is saved as a held alternative observation revision, but does NOT overwrite `current_revision_id`. Human work is never overwritten.
- Post rows are never created or updated by this import.

---

### 3.2 List review queue: `GET /api/admin/review-drafts`

**Authentication**: Session cookie + Verified Operator Allowlist  
**Query parameters**:
- `status`: `all` | `held` | `in_review` (default: `all`)
- `limit`: integer, 1 to 50 (default: 20)
- `cursor`: string? (opaque pagination cursor)

#### Response (`200 OK`):
```json
{
  "items": [
    {
      "id": "cuid_item_123",
      "bundle_id": "8d6c663917a1282cd6fa4322",
      "title": "Assistant Pharmacist Recruitment 2026",
      "source_name": "HLL Lifecare",
      "source_url": "https://example.gov.in/recruitment.html",
      "role_count": 5,
      "status": "held",
      "hold_reason": "Unstated vacancy count",
      "current_revision": {
        "id": "cuid_rev_1",
        "revision_number": 1,
        "canonical_hash": "a1b2c3...",
        "validation_state": "none",
        "created_by": "worker_import",
        "created_at": "2026-10-29T10:00:00.000Z"
      },
      "updated_at": "2026-10-29T10:00:00.000Z"
    }
  ],
  "next_cursor": null,
  "counts_as_of": "2026-10-29T16:00:00.000Z",
  "total_items": 1
}
```

---

### 3.3 Get candidate review detail: `GET /api/admin/review-drafts/:id`

**Authentication**: Session cookie + Verified Operator Allowlist  
**Headers returned**: `Cache-Control: no-store, private`, `ETag: W/"<canonical_hash>"`

#### Response (`200 OK`):
```json
{
  "item": {
    "id": "cuid_item_123",
    "bundle_id": "8d6c663917a1282cd6fa4322",
    "source_name": "HLL Lifecare",
    "source_url": "https://example.gov.in/recruitment.html",
    "status": "held",
    "hold_reason": "Unstated vacancy count"
  },
  "revision": {
    "id": "cuid_rev_1",
    "revision_number": 1,
    "canonical_hash": "a1b2c3...",
    "change_reason": null,
    "created_by": "worker_import",
    "created_at": "2026-10-29T10:00:00.000Z",
    "validation_state": "none",
    "facts": { ... },
    "evidence_units": [ ... ],
    "source_evidence": [ ... ]
  },
  "latest_validation": null
}
```

---

### 3.4 Save correction: `POST /api/admin/review-drafts/:id/revisions`

**Authentication**: Session cookie + Verified Operator Allowlist + Same-Origin  
**Headers**: `If-Match: "<base_revision_id_or_hash>"`

#### Request body (`application/json`, max 1 MB):
```json
{
  "base_revision_id": "cuid_rev_1",
  "change_reason": "Corrected max age to 37 and preserved null vacancies per page 2 clause 4",
  "facts": {
    "purpose": "recruitment",
    "posts": [ ... ],
    "evidence": [ ... ],
    "missing_fields": [ ... ],
    "purpose_evidence": [ ... ],
    "document_purposes": [ ... ]
  }
}
```

#### Response (`201 Created`):
```json
{
  "revision_id": "cuid_rev_2",
  "revision_number": 2,
  "canonical_hash": "b2c3d4...",
  "validation_state": "none"
}
```

#### Concurrency and validation rules:
- If `item.current_revision_id !== base_revision_id`: returns `412 Precondition Failed` with `{ error: "Revision is stale. Reload candidate to see newer changes." }`.
- Validates `facts` using the candidate facts schema:
  - Exact numbers, numeric limits, explicit nulls preserved.
  - No flattening of nested qualification / eligibility structures.
  - Dates verified in ISO format.
- Computes `canonical_hash` server-side.
- Creates new immutable `ReviewRevision` row.
- Updates `item.current_revision_id = new_revision.id`.
- Sets `validation_state = "none"`. Saving does NOT trigger or approve validation implicitly.

---

### 3.5 Request validation: `POST /api/admin/review-drafts/:id/validate`

**Authentication**: Session cookie + Verified Operator Allowlist + Same-Origin

#### Request body:
```json
{
  "revision_id": "cuid_rev_2"
}
```

#### Response (`202 Accepted`):
```json
{
  "task_id": "cuid_task_789",
  "revision_id": "cuid_rev_2",
  "status": "pending",
  "validator_version": "aptus-val-v1"
}
```

#### Semantics:
- Re-checks that `revision_id` belongs to `item.id`.
- If an existing task for this exact `revision_id` and `validator_version` is `completed`:
  Returns `200 OK` with the cached task and result.
- If an existing task is `pending` or `running`:
  Returns `202 Accepted` with the existing `task_id`.
- Otherwise creates a durable `ValidationTask` row (`status = "pending"`).
- Updates `ReviewRevision.validation_state = "waiting_for_worker"`.

---

### 3.6 Check validation status: `GET /api/admin/review-drafts/:id/validation/:taskId`

**Authentication**: Session cookie + Verified Operator Allowlist

#### Response (`200 OK`):
```json
{
  "task_id": "cuid_task_789",
  "revision_id": "cuid_rev_2",
  "status": "completed",
  "validator_version": "aptus-val-v1",
  "result": {
    "status": "needs_review",
    "disposition": "valid_recruitment_review_draft",
    "errors": [],
    "warnings": [
      {
        "field_path": "posts.0.vacancies",
        "reason": "detail_not_supported"
      }
    ],
    "semantic_support_verified": false
  },
  "created_at": "2026-10-29T10:05:00.000Z",
  "completed_at": "2026-10-29T10:05:02.000Z"
}
```

Status taxonomy presented in UI:
- `pending`: Waiting for worker
- `running`: Checking
- `completed` with errors: Check completed with issues
- `completed` with 0 errors: Automated checks passed (explicitly labeled: automated validation is not proof of factual truth)
- `failed`: Worker/check infrastructure failed (explicitly separated from factual rejections)

---

### 3.7 Internal worker claim: `POST /api/internal/review-tasks/claim`

**Authentication**: `Authorization: Bearer <INGEST_TOKEN>`

#### Request body:
```json
{
  "worker_id": "worker-runner-1",
  "lease_seconds": 60
}
```

#### Response:
- If a task is available (`200 OK`):
```json
{
  "task": {
    "task_id": "cuid_task_789",
    "revision_id": "cuid_rev_2",
    "revision_hash": "b2c3d4...",
    "bundle_id": "8d6c663917a1282cd6fa4322",
    "facts": { ... },
    "source_evidence": [ ... ],
    "claim_token": "secret_claim_token_abc"
  }
}
```
- If no task is pending (`204 No Content` or `{ "task": null }`).

#### Claim lease recovery:
- Tasks with `status = "pending"` or (`status = "running"` and `claim_expires_at < now()`) can be claimed.
- Claiming updates `status = "running"`, assigns a secure random `claim_token`, and sets `claim_expires_at = now() + lease_seconds`.

---

### 3.8 Internal worker submit result: `POST /api/internal/review-tasks/:taskId/result`

**Authentication**: `Authorization: Bearer <INGEST_TOKEN>`

#### Request body:
```json
{
  "claim_token": "secret_claim_token_abc",
  "revision_hash": "b2c3d4...",
  "validator_version": "aptus-val-v1",
  "result": {
    "status": "needs_review",
    "disposition": "valid_recruitment_review_draft",
    "errors": [],
    "warnings": [ ... ],
    "semantic_support_verified": false
  }
}
```

#### Response (`200 OK`):
```json
{
  "task_id": "cuid_task_789",
  "status": "completed"
}
```

#### Integrity checks:
- Verifies `claim_token`.
- Verifies that `revision_hash` matches `ValidationTask.reviewRevision.canonicalHash`.
- Updates `ValidationTask.status = "completed"`, `ValidationTask.result = result`.
- Updates `ReviewRevision.validation_state`:
  - `checks_passed` if errors array is empty.
  - `completed_with_issues` if errors exist.
- Notice: this strictly updates `reviewRevisionId`. If a newer revision R3 was saved in the meantime, R3's validation state remains unaffected.

---

## 4. Database schema additions (Additive Prisma models)

```prisma
model ReviewItem {
  id                String           @id @default(cuid())
  bundleId          String           @unique
  sourceUrl         String
  sourceName        String
  status            String           @default("held") // "held" | "in_review"
  holdReason        String?
  currentRevisionId String?
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @updatedAt

  revisions         ReviewRevision[]
  currentRevision   ReviewRevision?  @relation("CurrentRevision", fields: [currentRevisionId], references: [id], onDelete: SetNull)

  @@index([status, updatedAt])
}

model ReviewRevision {
  id              String           @id @default(cuid())
  reviewItemId    String
  reviewItem      ReviewItem       @relation(fields: [reviewItemId], references: [id], onDelete: Cascade)
  revisionNumber  Int
  parentRevisionId String?
  parentRevision  ReviewRevision?  @relation("RevisionHierarchy", fields: [parentRevisionId], references: [id], onDelete: SetNull)
  childRevisions  ReviewRevision[] @relation("RevisionHierarchy")

  facts           Json
  sourceEvidence  Json
  evidenceUnits   Json
  rawDigest       String?
  canonicalHash   String
  changeReason    String?
  createdBy       String           @default("worker_import")
  createdAt       DateTime         @default(now())
  validationState String           @default("none") // "none" | "waiting_for_worker" | "checking" | "completed_with_issues" | "checks_passed" | "failed"

  isCurrentFor    ReviewItem[]     @relation("CurrentRevision")
  validationTasks ValidationTask[]

  @@unique([reviewItemId, revisionNumber])
  @@index([canonicalHash])
}

model ValidationTask {
  id               String         @id @default(cuid())
  reviewRevisionId String
  reviewRevision   ReviewRevision @relation(fields: [reviewRevisionId], references: [id], onDelete: Cascade)
  status           String         @default("pending") // "pending" | "running" | "completed" | "failed"
  validatorVersion String         @default("aptus-val-v1")
  claimToken       String?
  claimExpiresAt   DateTime?
  result           Json?
  errorDetails     String?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  @@index([status, claimExpiresAt])
  @@index([reviewRevisionId, validatorVersion])
}
```

---

## 5. Reviewer and verification checklist

- [ ] Proposal submitted before implementing dependent new boundary semantics.
- [ ] No changes to existing frozen contracts in `contracts/`.
- [ ] No loosening of existing ingestion or publisher checks.
- [ ] Operator accounts require verified email matching `APTUS_REVIEW_OPERATOR_EMAILS`.
- [ ] Additive schema changes with local-only migration.
- [ ] Stale edit protection via `If-Match` revision token.
- [ ] Python worker validation path is deterministic and calls no models or networks.
