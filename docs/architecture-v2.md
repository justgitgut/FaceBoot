# FaceBoot Architecture v2

## Goal

FaceBoot is scoped to three stable behaviors:

1. Filter unwanted Facebook feed content by removing it from the DOM.
2. Expand truncated post bodies.
3. Normalize supported Facebook feed and root-group URLs to chronological sorting.
4. Expand visible comment and reply threads inside an already-open post context.

## Active Boundaries

### Feed Cleanup

- Runs against feed/main-content roots.
- Removes unwanted cards and containers from the DOM.
- Does not open posts, dialogs, or menus.

### Post Expansion

- Clicks visible `See more`-style controls for truncated posts.
- Operates on the current visible root only.
- Does not attempt menu interaction.
- Runs one eager startup pass before async settings load and a few short follow-up passes for the first visible feed items.
- Treats first-feed story-preview hydration as a timing problem first: a valid `See more` button may exist before Facebook finishes wiring its live handler.
- Allows bounded retries for the same visible expander during startup stabilization instead of permanently suppressing the first no-op press.
- See [post-expansion-notes.md](post-expansion-notes.md) for the first-post startup failure mode and the regression rules that protect it.

### Comment Expansion

- Runs only on:
  - direct post/permalink pages, or
  - already-open post dialogs.
- Also supports direct media surfaces such as Facebook photo/watch pages when the
  comment UI lives outside a modal dialog.
- Reels are handled only through a separate active-reel resolver that must identify
  one visible reel comment surface without falling back into older dialogs or broad
  document scans.
- On already-open post dialogs, opens the Facebook comment-ordering popup for the active post only.
- Selects `All comments` before expanding visible comment/reply controls.
- Expands visible comment/reply controls such as summary and load-more actions.
- Does not interact with unrelated menus or other posts.

### Media Viewer Handling

- Media viewers are split into two cases:
  - media dialogs with inline comment UI
  - direct media pages where comments live in `role="complementary"`, `main`, `role="main"`, `data-pagelet`, or `div[role="article"]`
- A media viewer without visible comment UI must not trigger fallback to an older post dialog underneath it.
- Mutation-driven reruns should prefer a newly added dialog root over a broad document rescan.
- Follow-up comment-automation passes must resolve from the current document state, not from a stale previously viewed dialog.

### URL Normalization

- Redirects the optional feed landing page to:
  - `https://www.facebook.com/?filter=all&sk=h_chr&sorting_setting=CHRONOLOGICAL`
- Appends `sorting_setting=CHRONOLOGICAL` to root group URLs such as `/groups/<id>`.
- Uses in-place URL normalization for SPA navigation instead of forcing a full reload.

## Explicit Non-Goals

- No automation of comment filter popups outside the active post dialog.
- No React-internal event bridging for menu item selection.
- No feed-to-modal auto-opening behavior.
- No recovery heuristics based on random outside clicks.
- No feed-wide fallback from `document` into arbitrary post/comment surfaces.
- No fallback from a topmost media viewer into older dialogs underneath it.
- No generic direct comment automation on Reels tab or `/reel/` surfaces.
- No reel fallback from `document` into arbitrary page surfaces when the active reel root is ambiguous.

## Design Principle

Prefer stable DOM transformations and narrowly scoped UI workflows over broad transient popup automation.

If a behavior requires broad popup steering, React internals, or synthetic recovery clicks outside the active dialog, it is outside the default FaceBoot automation boundary and should remain disabled unless reintroduced as a clearly isolated experimental feature.

## Regression Triggers To Avoid

- Treating the first visible dialog as the active post by default.
- Allowing `document`-level comment automation to search the feed for any plausible surface.
- Letting watcher callbacks rerun against the stale dialog that originally created the watcher.
- Counting a filter-toggle click as success without verifying that the popup actually opened.
- Reopening old post dialogs when a photo/media viewer appears without comments yet.
- Resolving a reel comment surface unless one active reel root clearly outranks all other visible candidates.
- Permanently blacklisting a first-post `See more` button after one early synthetic click during startup hydration.
- Assuming top-of-feed expansion failures are always selector problems; the first visible post can fail because Facebook attaches the live handler after the initial pass.

See [regression-checklist.md](regression-checklist.md) for the expected validation steps after any automation changes.