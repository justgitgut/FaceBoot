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

### Comment Expansion

- Runs only on:
  - direct post/permalink pages, or
  - already-open post dialogs.
- On already-open post dialogs, opens the Facebook comment-ordering popup for the active post only.
- Selects `All comments` before expanding visible comment/reply controls.
- Expands visible comment/reply controls such as summary and load-more actions.
- Does not interact with unrelated menus or other posts.

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

## Design Principle

Prefer stable DOM transformations and narrowly scoped UI workflows over broad transient popup automation.

If a behavior requires broad popup steering, React internals, or synthetic recovery clicks outside the active dialog, it is outside the default FaceBoot automation boundary and should remain disabled unless reintroduced as a clearly isolated experimental feature.

See [regression-checklist.md](regression-checklist.md) for the expected validation steps after any automation changes.