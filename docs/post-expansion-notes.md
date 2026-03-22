# Post Expansion Notes

This document captures the working rules for feed post-body expansion and the startup-specific failure modes that have regressed repeatedly.

## Working Model

Post expansion is intentionally narrow:

1. Scan the current visible root for likely story-body expanders.
2. Prioritize buttons inside `story_message`, `story_body`, and story-preview containers.
3. Press only visible `See more`-style controls that still look like inline post truncation.
4. Avoid menus, media controls, and unrelated feed buttons.

## First-Post Startup Behavior

- The first visible feed post is special because Facebook often hydrates it in stages.
- A valid `See more` button may already be in the DOM before Facebook attaches the live click handler.
- Startup therefore needs:
  - one eager document pass before async settings/storage resolution, and
  - a few short follow-up passes while the page is still stabilizing.
- A synthetic click that does nothing during that window must not permanently suppress the same button.

## Candidate Rules

- Prioritize buttons inside:
  - `[data-ad-rendering-role="story_message"]`
  - `[data-ad-rendering-role="story_body"]`
  - `[data-ad-comet-preview="message"]`
- Treat preview-message containers like story-message containers for first-feed posts.
- Reject controls inside obvious menu/toolbar surfaces.
- Require post-context signals before clicking anything generic.

## Retry Rules

- Post-expander retries must be bounded.
- Retry cooldowns must be short enough to catch startup hydration, but not so aggressive that the same control is spam-clicked continuously.
- Do not revert to a permanent one-shot blacklist for post expanders; that was the direct cause of the first-post regression.

## Things To Avoid

- Do not broaden feed-wide click heuristics just to fix the first visible post.
- Do not treat all top-of-feed failures as selector misses.
- Do not permanently mark a `See more` button as handled unless the retry window has been exhausted.
- Do not add broad random-click recovery behavior.

## Minimum Regression Pass

After touching post expansion, verify all of the following:

1. Reload the main feed with the first post truncated.
2. Confirm the first visible post expands during startup, before scrolling away.
3. Confirm the first post does not keep the literal `See more` text inline in the body.
4. Confirm later feed posts still expand normally.
5. Confirm no unrelated menu, dialog, or media surface opens.
6. Confirm already-expanded posts are not repeatedly spam-clicked.