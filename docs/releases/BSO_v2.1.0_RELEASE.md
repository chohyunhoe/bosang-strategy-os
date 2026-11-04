# BSO Product v2.1.0 — RELEASE BASELINE

Release date: 2026-08-22
Production baseline: `3985901e970d8547eeff9f18836b2b2bb7907dba`
Release branch: `release/v2.1.0`
Rollback branch: `rollback/pre-v2.1-20260822`
Production worker: `bosang-strategy-os-mobile`

## Release verdict

`RELEASED` — actual mobile smoke passed with the real appraisal document used as Acceptance A.

The release replaces the stable16/mobile-overlay chain with a Product v2.1 runtime built around:

- one canonical `CaseStore`
- one canonical `reviewQueue`
- one responsive renderer shared by PC and mobile
- PDF.js text extraction with local Tesseract OCR fallback
- source-ref based review/edit flow
- review-only PNU/public-data/map/issue candidates
- local-only Output Center and QGIS/VWorld bridges
- session-memory-only multi-case registry

## Acceptance A — real appraisal smoke

The production mobile smoke confirmed the actual document renders the expected practical structure:

- subject lands: 5
- standard lands: 8
- appraisal/transaction cases: 4
- land appraisal results: 5
- subject factor totals: 5
- other-factor decisions: 8
- obstacle rows: 36
- land appraisal amount sum: 7,643,346,000 KRW
- stated obstacle total: 29,350,000 KRW
- extracted obstacle row sum: 29,350,000 KRW
- obstacle cross-check: MATCH
- split-use rows preserve `현황 전` / `현황 도로`
- ambiguous missing individual-factor cells are not inferred

The PDF.js first-obstacle-row/header merge was fixed before the baseline was frozen.

## Mobile smoke — passed

Verified on the production URL:

- no blank home screen
- no legacy JSON candidate cards
- READY state reached after actual PDF upload
- subject lands / standards / cases / valuation results render on mobile
- canonical review queue renders practical review groups
- issue candidates render without automatic appraisal/legal conclusions
- PC/mobile use the same routes, state and commands
- Public Data/PNU and Output Center correctly show `LOCAL_ONLY` on Cloudflare when a local bridge is unavailable

## Safety boundaries

- automatic extraction never sets `auto_confirmed=true`
- PNU candidate generation requires explicit user application
- public-data enrichment does not silently overwrite appraisal-source values
- mechanical issue candidates keep `conclusion=null`
- Output snapshot carries only explicit manual review decisions
- pre-existing `auto_confirmed=true` survives snapshot conversion so the Output Bridge can fail closed
- original PDF/case payloads, credentials, local paths and local outputs are not included in the Cloudflare static bundle
- output file names are masked before local bridge transfer

## CI exception

GitHub Actions runner jobs were unavailable because account usage was exhausted. The repeated zero-step Action failures were not treated as code failures and were not repeatedly retriggered.

When Actions usage is restored, run once:

`npm run release:v2.1:gate`

and then the normal privacy / Parser / Public Data / Brief Output workflows as a post-release cross-check. Do not change the release baseline solely to make unavailable runners green.

## Local-only capabilities

These are part of v2.1 functionality but intentionally do not run from the static Cloudflare origin without the local bridge:

- Output Center DOCX/XLSX/CSV/opinion-package generation
- VWorld exact PNU enrichment
- legal-dong/PNU resolver backend
- QGIS/VWorld map build and map PDF

The web UI must continue to show these as `LOCAL_ONLY` rather than pretending they are connected.

## Freeze rule

Do not commit new feature work directly onto `main` or `release/v2.1.0`.

- emergency production fixes: smallest possible hotfix on `main`, then update the next patch baseline
- non-emergency hardening: `hardening/v2.1.0`
- feature expansion: future version branch

The released v2.1.0 baseline is immutable for comparison and rollback purposes.
