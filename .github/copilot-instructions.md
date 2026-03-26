# Faceberg Project Guidelines

## Scope

- Use this file for project-wide defaults only.
- Keep detailed regression background in [docs/comment-automation-notes.md](../docs/comment-automation-notes.md) and [docs/regression-checklist.md](../docs/regression-checklist.md).

## Architecture

- `content.js` is the main runtime orchestrator.
- `content-comments.js` owns comment-surface resolution, filter switching, delayed retries, and watcher-driven follow-up passes.
- `content-feed.js` owns feed cleanup only.
- Notification-driven navigation is a known regression area. Facebook can rewrite the URL before replacing the old feed DOM.

## Notification Guardrails

- Never let notification interactions share execution with normal feed, post-expansion, or comment automation.
- Direct-post automation must wait for DOM evidence matching the current target post; do not trust the URL alone.
- Delayed retries and mutation watchers must honor notification suppression, not just the main `runAll()` loop.
- Avoid generic primary comment opener automation on direct post pages when it can route through Facebook navigation handlers.

## Validation Expectations

- Read-only investigation is allowed without approval.
- Before any feature implementation, bug fix, refactor, or other code/behavior-changing edit, first describe the planned operations and wait for user approval.
- If the planned implementation changes materially while working, stop and ask for approval again before editing further.
- This approval requirement is for code or behavior changes, not for read-only exploration.
- Do not commit or push untested changes automatically.
- Only commit or push when the user explicitly asks for it.
- Approval to edit is not approval to commit or push; commit/push requires a separate explicit user request.
- If a change cannot be tested, leave it uncommitted by default and clearly tell the user that it remains untested.
- Before changing notification or comment automation behavior, review [docs/comment-automation-notes.md](../docs/comment-automation-notes.md) and [docs/regression-checklist.md](../docs/regression-checklist.md).
- After changing those paths, explicitly validate the notification navigation checks and related regression checklist items.
- If you discover a new failure mode, update the notes and checklist in the same change.

## Response Style

- Be terse. No step-by-step explanation unless asked. No restating the task. Prefer final artifact over discussion.

**Debugging:** Root cause (1 sentence) + Fix (1 sentence) + unified diff only. No alternatives unless confidence is low.

**Routine code edits:** Unified diff only. No prose, no markdown fences, no reasoning.

**New function/component:** Code only. No intro, no explanation, no comments unless essential.

**Refactoring:** 3 bullets max summary + unified diff only.

**Design/architecture questions:** ≤3 options. Each: approach / pros / cons / when. No intro, no conclusion. Total ≤200 words.

**Code review:** Critical issues + likely bugs + minimal fixes. ≤6 bullets. No praise. No restating the code.

**Analysis:** Root cause + exact fix + patch. ≤8 lines of explanation total.