# Changelog

## 2026-03-22 - v0.2.0

### Release Summary

- Published the first minor release with the isolated reel comment resolver, stronger anti-refresh protection, corrected session and filter-change stats, and the redesigned Activity tab.

### Packaging

- Included the new Activity tab book icon asset and About tab source icon asset in the release package.

## 2026-03-22

### Fixed

- Hardened startup post expansion so the first visible feed post no longer leaves `See more` inline while Facebook is still hydrating the page.
- Added bounded retry handling for valid post expanders that are detectable before Facebook attaches their live click handlers.
- Prevented feed photo/lightbox opens that temporarily rewrite the URL to `/photo/` from triggering document-level direct-page automation too early.
- Restored the guard that prevents random or stale post dialogs from reopening when clicking feed photos.
- Added a reel-specific comment resolver that targets only the active visible reel surface instead of reusing generic direct-post fallback.
- Reel comment automation now switches to `All comments` and expands visible reel threads only when one active reel surface can be identified unambiguously.
- Hardened anti-refresh protection against delayed tab-return reloads by suppressing resume lifecycle signals longer and spoofing visibility/focus checks.
- Moved session stat resets to extension startup so Facebook page loads no longer wipe `This Session` counters.
- Fixed comment filter-change counting by passing runtime stat dependencies through the delayed sorter retry path.
- Redesigned the Activity tab around grouped stats, period switching, reset tracking, and saved-time estimates.

### Documentation

- Documented the first-post startup hydration failure mode and the required regression coverage.
- Documented the feed-photo overlay URL rewrite trap and the media-viewer boundary rules.
- Documented the isolated reel resolver boundary and the requirement to abort when multiple visible reel candidates remain ambiguous.
- Documented the current Activity tab model and added regression coverage for filter-change counting and session-stat persistence.