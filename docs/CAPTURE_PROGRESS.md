# Capture — files, results, and remaining work

Branch: `codex/discovery-links`. Checked: 7 October 2026.

## Files

| File | Purpose |
| --- | --- |
| [capture.py](../services/ai/capture.py) | Conditional GET, bounded HTML/PDF download, redirects, acceptance checks, hash comparison, local command. |
| [capture_store.py](../services/ai/capture_store.py) | Saved byte blobs, immutable snapshot records, current URL state, and attempt history. |
| [test_capture.py](../services/ai/tests/test_capture.py) | Controlled HTTP responses and storage-failure checks. |
| [Live results](../outputs/capture/check.json) | Four observations from one HTML page and one official PDF. |

No new dependencies. This callable component is separate from the existing extraction pipeline and public HTTP routes.

## What works

Capture saves content-decoded bytes before character decoding. It returns an outcome, snapshot ID, body path, SHA-256, content type and source URLs. Snapshots include redirect history and selected HTTP metadata; cookies and authentication headers are not archived.

- `changed`: a new accepted representation was saved. The first capture also uses this outcome.
- `identical`: downloaded bytes, final URL and content-type metadata match a usable stored snapshot.
- `revalidated`: a conditional GET returned 304 and the saved body passed its integrity check.
- `rejected` / `failed`: the previous snapshot remains available, with the latest failure recorded separately.

Each URL has its own snapshot provenance; identical byte blobs can be shared between URLs. A changed charset header creates a new snapshot even if the bytes are identical. Changed bytes do not imply changed recruitment facts.

## Actual live results

| Document | First check | Second check | Result |
| --- | --- | --- | --- |
| Sarkari Result homepage HTML | `changed` | `identical` | Same snapshot and hash reused after downloading. |
| RPSC official PDF | `changed` | `revalidated` | Same snapshot reused after HTTP 304. |

Original bodies and archive state for this check are in `/private/tmp/aptus-capture-check`; these temporary files are not deployment storage or committed PDF fixtures. The small JSON report is in the repository.

## Run locally

```sh
services/ai/.venv/bin/python services/ai/capture.py https://www.sarkariresult.com/ /private/tmp/aptus-capture
```

Use `--force` to audit a server by downloading without conditional headers. Ordinary checks use saved ETag/Last-Modified when the request reaches their corresponding target. Server validators are cleared when a fresh 200 omits them. Missing/corrupt stored bytes on a 304 trigger one unconditional recovery request.

Limits: five redirects; 5 MiB decoded HTML / 20 MiB declared or URL-indicated PDF; connect timeout 10 seconds, read timeout 20 seconds, and an elapsed-time check between requests/chunks. The elapsed check is not a strict whole-call deadline. Generic-type PDF bodies use the smaller cap until their type is known.

## Verification

14 Capture tests plus 10 existing discovery/HTML-section tests pass: 24 total. Tests cover first/identical/changed HTML, validators and 304, Hindi bytes, force audits, PDF replacement, disguised HTML at PDF URLs, missing blobs, failures, incomplete/oversized bodies, redirects, private destinations, partial responses, charset metadata and failed snapshot writes.

```sh
PYTHONPATH=services/ai services/ai/.venv/bin/python -m unittest discover -s services/ai/tests -v
```

## Boundaries and remaining work

- One worker owns the local store. Atomic replacements protect existing files during normal process failures; no multi-worker coordination or power-loss durability claim.
- HTML acceptance/login detection is heuristic; a PDF signature is only a format check. No PDF parsing, OCR or job verification yet.
- Public-address DNS checks run before each request/redirect and environment proxy settings are disabled for the default client. HTTPX resolves DNS again for the connection: DNS rebinding is not fully prevented. Keep this a trusted local component until transport pinning or network egress restrictions are in place; no public URL-fetch endpoint was added.
- Crawl permission, scheduling, traversal, offline parsing and discovery integration remain separate steps. Snapshot filenames are SHA-256 values; use the returned content type to select a parser.
- No automatic every-tenth-request audit, parsed-content fingerprint, cleanup/retention policy, or parser-run records yet. Those need their own small decisions and tests.
