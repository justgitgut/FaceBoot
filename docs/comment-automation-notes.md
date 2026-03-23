# Comment Automation Notes

This document captures the working structure of Faceberg comment automation and the failure modes that repeatedly caused regressions.

## Working Model

Comment automation has three stable surfaces:

1. Feed post dialog
2. Direct post/permalink page
3. Direct media surface or media dialog with visible comment UI

Reels use a separate active-surface resolver. They are not part of the generic direct-post or media-page fallback.

The intended order is:

1. Resolve the active comment surface narrowly.
2. Switch the sorter to `All comments`.
3. Wait for DOM updates.
4. Expand visible comment/reply summary and load-more controls.

## Surface Resolution Rules

- Feed-wide comment automation must never search arbitrary page surfaces from `document`.
- On the feed, automation should act only on the active post dialog.
- Direct permalink/media pages may use non-dialog surfaces such as:
  - `[role="complementary"]`
  - `main`
  - `[role="main"]`
  - `[data-pagelet]`
  - `div[role="article"]`
- A topmost media viewer without visible comment UI is a hard stop. Do not fall back to an older dialog underneath it.
- A feed photo/lightbox can rewrite the page URL to `/photo/` before inline comments exist. That URL change alone must not trigger document-level direct-page automation.
- A notifications click can also rewrite the URL before Facebook finishes replacing the old feed DOM. That transition must not allow any feed, dialog, or direct-page automation to act on stale surfaces.
- Do not treat Reels surfaces as direct post surfaces even if the URL contains `/reel/`.
- Reel automation must first identify one active reel context with visible reel media, then resolve comment controls only inside that context or its adjacent comment panel.
- If multiple reel candidates remain close in score, abort instead of guessing.

## Dialog Rules

- Do not assume the first visible dialog is the correct post dialog.
- A dialog is automatable only when it is:
  - a real post dialog with post signals, or
  - a media viewer dialog that already exposes comment UI
- If a broad document pass cannot identify an active automatable dialog, do nothing.

## Filter Rules

- The filter must be switched before reply expansion is attempted.
- A filter-toggle click must not count as success unless one of these becomes true:
  - `aria-expanded="true"`
  - the visible label changes to `All comments`
  - the comment-ordering menu is actually detected
- Menu item selection should stay narrowly targeted to the active popup.
- Any filter-change stat increment must receive the runtime `deps` object through both the immediate-selection and delayed-retry paths; otherwise the UI can switch correctly while the counter stays at zero.

## Expansion Rules

- Expansion should target summary/load-more/reply controls only.
- Do not auto-click broad primary comment openers from the feed.
- Reply expansion often requires a follow-up pass after the filter switch settles.

## Watcher Rules

- Mutation watchers are necessary because sorting and expansion render asynchronously.
- Follow-up passes must resolve from the current document state, not the stale dialog that created the watcher.
- When a newly added dialog appears, rerun automation from that dialog root first.
- Watcher callbacks and delayed retry timers must honor the same notification-suppression state as the main automation loop; otherwise stale follow-up passes can still click old surfaces after a notification interaction starts.

## Notification Navigation Rules

- While the notifications surface is open, automation should do nothing.
- A click inside the notifications surface should start a temporary suppression window so Facebook can finish opening the target post without synthetic interference.
- If that click causes a URL change, extend the suppression briefly across the transition.
- Direct-post handling must not trust the URL alone during notification navigation; the destination DOM must actually match the target post before automation resumes.
- Never auto-click generic primary comment openers during notification-driven navigation. They can route through Facebook navigation handlers and reopen the wrong post or land on the parent group feed.

## Things To Avoid

- Avoid `document`-level fallback into feed surfaces for comment automation.
- Avoid falling back from a topmost media viewer into older dialogs.
- Avoid letting notification interactions share execution with normal feed/comment automation.
- Avoid assuming the main `runAll()` suppression is sufficient; delayed retries and watcher callbacks must be suppressed too.
- Avoid counting synthetic clicks as success without verifying resulting UI state.
- Avoid changing dialog resolution heuristics without rerunning the full regression checklist.
- Avoid removing the comments that explain why feed/document fallbacks are restricted.

## Minimum Regression Pass

After touching comment automation, verify all of the following:

1. Main-feed post bodies still expand.
2. Clicking comments on the feed does not open random posts.
3. The sorter switches from `Most relevant` to `All comments`.
4. Reply/load-more controls expand after sorting changes.
5. Direct `/photo/` and `/watch/` pages still work.
6. Opening a photo does not resurrect a previously viewed post dialog.
7. A feed photo that rewrites the URL to `/photo/` does not trigger random post/dialog reopen behavior before inline comments appear.
8. On a `/reel/` or Reels route, comment automation resolves only the active reel surface and does not reopen a stale post dialog.
9. If the active reel surface is ambiguous, comment automation does nothing.
10. `Filter changes` increments only when the sorter actually transitions to `All comments`.
11. Opening notifications does not cause random posts, stacked post dialogs, or parent group feeds to open.
12. If the same notification is opened repeatedly, the first click behaves the same as later clicks; there is no stale-first-click misfire.
