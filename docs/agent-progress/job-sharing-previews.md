# Job sharing and previews

Baseline: 5e3b47c23631e5877a395213971cd2313a76b295 (origin/main).
Worktree: /tmp/aptus-job-sharing-previews. Branch: codex/job-sharing-previews.

Approved scope: public detail-page Share/Copy link, job-specific metadata and
one neutral shared image. No backend, database, worker or personal data changes.
Owned paths: job detail page/component, new job-sharing modules and tests,
static share-image route, this record. No frozen API semantics change.

Public origin: set SITE_URL to the exact public HTTPS origin in the frontend
runtime. Without it, ordinary title/description and browser-origin sharing work,
but canonical/Open Graph metadata is deliberately omitted rather than guessed.
Restart/redeploy is required to apply configuration; deployment is not part of
this PR. Backend BETTER_AUTH_URL is not exposed to the frontend.

The /share-image PNG is prerendered at build time with existing Next ImageResponse.
This avoids a Docker public-asset copy change or a new image dependency.

References read: installed Next metadata/OG guide; MDN
https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share and
https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText.
Cancellation is quiet; failed clipboard writes expose a selectable public URL.

Verification: focused metadata tests 2/2; typecheck, lint, build:web and production
Next webpack build passed. Build reports /share-image as static/prerendered.
Crawler/browser test initially hit sandbox port restrictions, then a tsx nested
callback serialization issue; the test helper was corrected and rerun.
Crawler/browser test passed 1/1 using system Chrome: WhatsApp user agent metadata
in head, absolute PNG URL/content type, native-share payload with query removed,
cancellation, successful copy, unavailable clipboard/native-share fallback,
keyboard activation and 390px layout without horizontal overflow.
Broader suite first failed on sandbox socket permissions; unrestricted rerun
recorded separately below. Existing DB-dependent skips are not DB verification.

Risk review: no additional confirmed production bug found in the final focused
diff. SITE_URL configuration and a real WhatsApp preview are release prerequisites;
passing local HTML/browser checks does not establish platform preview rendering.
Public WhatsApp preview requires deployment and remains
unverified until tested on a real public URL. No production changes authorized.
