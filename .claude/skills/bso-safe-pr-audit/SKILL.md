---
name: bso-safe-pr-audit
description: Audits and minimally fixes bosang-strategy-os pull requests for privacy, provenance, fail-closed behavior, appraisal-safety boundaries, regression coverage, and Git merge controls. Use for parser, VWorld, QGIS, live-data, appraisal, document-output, or review-pipeline PR audits.
disable-model-invocation: true
argument-hint: "[pr-number] [audit-scope]"
---

# BSO Safe PR Audit

## Purpose

Audit and minimally correct a bosang-strategy-os pull request without expanding
the approved MVP scope.

Treat all automated outputs as review-support material. Never convert extracted,
inferred, calculated, fixture, or public-data values into an appraisal conclusion,
legal conclusion, compensation prediction, or increase probability.

## Start-up checks

Before editing:

1. Read the repository CLAUDE.md, AGENTS.md, relevant README files, and the target PR.
2. Fetch the remote and identify the actual current branch and HEAD.
3. Inspect git status and preserve all existing user work.
4. Separate:
   - verified source facts;
   - parser or API output;
   - inference;
   - fixture expectation;
   - manual-review requirement.
5. Define the approved scope and completion criteria before changing code.

Do not assume that a previously reported SHA, test count, CI result, API status,
or PR description remains current.

## Privacy and secret boundary

Never commit or expose:

- actual appraisal PDFs or passwords;
- API keys, tokens, or credential-bearing URLs;
- detailed addresses or owner information;
- actual PNU values linked to a case;
- actual transaction values or case-specific source rows;
- local filesystem usernames or private paths;
- unredacted API responses;
- company-confidential source files.

Actual case-derived outputs must remain in a local-only, git-ignored location.

Only anonymized or synthetic fixtures and non-identifying aggregate counts may be
committed. A label such as "masked" is not evidence of anonymization; inspect every
serialized field.

## Appraisal and legal safety boundary

Do not automatically determine:

- selected comparable standard land;
- accepted transaction or appraisal case;
- six detailed individual factors;
- other-factor adjustment;
- compensation increase amount or rate;
- success probability;
- appraisal or legal conclusion.

Unknown values remain null, NOT_IDENTIFIABLE, REVIEW_REQUIRED, or an equivalent
fail-closed status.

Reverse calculation, price-gap ratios, similarity scores, grades, and priority
labels are review aids only. They do not replace source-confirmed appraisal factors.

Never use synthetic fixture values in a live-case execution path.

## Data-integrity boundary

Preserve source values and source rows unless duplicate identity is proven by an
explicit deterministic rule.

Do not:

- repair invalid dates by silently changing the date;
- delete rows based only on similarity heuristics;
- select the first API result when zero, multiple, or mismatched results exist;
- fill missing values with conventional defaults such as 1.0;
- force results to match an expected target count;
- report synthetic fixture results as actual-case findings.

Heuristic relationships must be retained as POSSIBLE, CANDIDATE, or
REVIEW_REQUIRED rather than CONFIRMED.

## Change policy

1. Make the smallest change that resolves the verified defect.
2. Add a regression test for every corrected defect.
3. Do not redesign unrelated architecture or UI.
4. Do not add a new external service unless explicitly approved.
5. Preserve backward-compatible schema where practical.
6. If schema migration is unavoidable, report the change before implementing it.
7. Prefer deterministic scripts and tests over prose-only assurances.
8. Do not hide programming or schema errors inside broad transport-error handling.

## Verification order

Run the relevant checks in this order:

1. focused tests for changed modules;
2. complete subsystem tests;
3. repository-required test suites;
4. syntax, lint, and git diff checks;
5. privacy and secret scans;
6. generated-output inspection;
7. CI status verification where available.

For output and privacy changes, use sentinel values and verify that they do not
appear outside the approved local-only location.

Passing tests do not prove live API success or actual-case factual accuracy.
Report those gates separately.

## Git and PR boundary

- Never force-push.
- Never discard existing user changes.
- Never merge to main without explicit user approval.
- Keep a Draft PR as Draft unless explicitly authorized otherwise.
- Do not mark a PR complete while required local or manual gates remain open.
- Use focused commits with descriptive messages.
- Update the PR description only to reflect verified current facts.
- Correct obsolete or overconfident prior claims rather than preserving them.

## Final report

Report in this order:

1. conclusion;
2. verified problems;
3. files changed;
4. behavior before and after;
5. tests and CI;
6. privacy and secret scan;
7. unresolved local or manual gates;
8. commit SHA;
9. PR state and merge state;
10. exact next local command, when applicable.

Clearly separate:

- VERIFIED;
- INFERENCE;
- REVIEW_REQUIRED;
- NOT_EXECUTED;
- BLOCKED_BY_LOCAL_INPUT.

Do not describe fixture results, mocked responses, or local reports from another
session as results reproduced in the current session.
