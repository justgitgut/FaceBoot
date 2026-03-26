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
2. Open the sorter toggle when present.
3. Switch the sorter to `All comments`.
4. Wait for DOM updates.
5. Expand visible comment/reply summary and load-more controls.

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
- Sorter opening is dispatch-first: the opener sends one click attempt to the resolved toggle target, then a short delayed follow-up verifies whether the popup actually opened.
- The delayed follow-up only acts when the toggle reads open (`aria-expanded="true"`). If Facebook never flips that state, the sorter will not be retried aggressively.
- Menu item selection should stay narrowly targeted to the active popup.
- Popup resolution must stay anchored to the active sorter toggle; visible menus elsewhere on the page are not valid fallbacks.
- Facebook can replace the sorter popup node while the menu is hydrating. Watchers must re-resolve the active popup instead of holding onto the first node they saw.
- Feed dialogs can select immediately from an already-open loaded popup, while direct post and media surfaces may need a short loading watcher when Facebook shows a spinner first.
- Any filter-change stat increment must receive the runtime `deps` object through both the immediate-selection and delayed-retry paths; otherwise the UI can switch correctly while the counter stays at zero.

## Expansion Rules

- Expansion should target summary/load-more/reply controls only.
- Do not auto-click broad primary comment openers from the feed.
- Reply expansion often requires a follow-up pass after the filter switch settles.
- Exact `View all N replies` labels should be treated as reply-summary controls even when Facebook changes surrounding wrappers.
- Direct permalink dialogs can auto-focus the empty comment composer (`Comment as ...`) without any user input. That empty focused composer must not suppress reply expansion; only real typed composer content should block automation.

## Watcher Rules

- Mutation watchers are necessary because sorting and expansion render asynchronously.
- The main expansion follow-up still reruns from `document`, so stale-surface regressions remain a risk when dialog resolution broadens.
- When a newly added dialog appears, rerun automation from that dialog root first.

## Notification Navigation Rules

- The current working code does not have a dedicated notification-suppression layer in `content.js` or `content-comments.js`.
- Notification safety currently relies on narrow dialog selection, direct media/viewer checks, and avoiding broad feed-level comment opener clicks.
- If notification regressions reappear, treat them as structural dialog-resolution bugs first; do not assume a suppression window exists.

## Things To Avoid

- Avoid `document`-level fallback into feed surfaces for comment automation.
- Avoid falling back from a topmost media viewer into older dialogs.
- Avoid counting menu-item activation success before the actual `All comments` row is clicked.
- Avoid anchoring sorter-menu follow-up logic to a popup node that Facebook is free to replace during loading.
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
13. A direct post or media sorter that first opens with a spinner settles onto the same active popup and selects `All comments` without flickering.
14. Feed dialogs with an already-open loaded sorter popup select `All comments` immediately instead of waiting through the loading watcher path.
