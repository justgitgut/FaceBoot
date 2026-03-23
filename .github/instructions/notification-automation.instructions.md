---
description: "Use when editing notification navigation, comment automation, watcher logic, delayed retries, post expansion, or the Faceberg content runtime in content.js, content-comments.js, content-feed.js, and content-utils.js. Requires user validation before edits and preserves notification-suppression guardrails."
name: "Notification Automation Guardrails"
applyTo: "content.js, content-comments.js, content-feed.js, content-utils.js"
---

# Notification Automation Guardrails

- Read-only investigation is allowed without approval.
- Before making a code or behavior-changing edit in a matched file, first describe the planned operations and ask the user to validate them.
- If the user wants to add precision, wait for that clarification before editing.
- Documentation-only changes do not require this approval rule unless they are bundled with code or behavior changes.
- Do not automatically commit or push matched-file changes, especially when they are not yet validated against the regression checklist.
- Commit and push only on explicit user request.
- Treat notification-driven navigation as a high-risk regression area.
- Never allow document-level fallback onto stale feed surfaces during notification navigation.
- Preserve notification suppression across:
  - main automation entry points
  - delayed retry timers
  - mutation watcher callbacks
  - direct-post automation resumes
- Do not reintroduce generic primary comment opener clicks for direct post handling unless the user explicitly asks and the regression risk is addressed.
- When changing these files, review [docs/comment-automation-notes.md](../../docs/comment-automation-notes.md) and validate against [docs/regression-checklist.md](../../docs/regression-checklist.md), especially the notification navigation section.