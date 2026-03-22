# Comment Automation Notes

This document captures the working structure of FaceBoot comment automation and the failure modes that repeatedly caused regressions.

## Working Model

Comment automation has three stable surfaces:

1. Feed post dialog
2. Direct post/permalink page
3. Direct media surface or media dialog with visible comment UI

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

## Expansion Rules

- Expansion should target summary/load-more/reply controls only.
- Do not auto-click broad primary comment openers from the feed.
- Reply expansion often requires a follow-up pass after the filter switch settles.

## Watcher Rules

- Mutation watchers are necessary because sorting and expansion render asynchronously.
- Follow-up passes must resolve from the current document state, not the stale dialog that created the watcher.
- When a newly added dialog appears, rerun automation from that dialog root first.

## Things To Avoid

- Avoid `document`-level fallback into feed surfaces for comment automation.
- Avoid falling back from a topmost media viewer into older dialogs.
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