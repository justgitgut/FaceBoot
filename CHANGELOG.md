# Changelog

## 2026-03-22

### Fixed

- Hardened startup post expansion so the first visible feed post no longer leaves `See more` inline while Facebook is still hydrating the page.
- Added bounded retry handling for valid post expanders that are detectable before Facebook attaches their live click handlers.
- Prevented feed photo/lightbox opens that temporarily rewrite the URL to `/photo/` from triggering document-level direct-page automation too early.
- Restored the guard that prevents random or stale post dialogs from reopening when clicking feed photos.
- Added a reel-specific comment resolver that targets only the active visible reel surface instead of reusing generic direct-post fallback.
- Reel comment automation now switches to `All comments` and expands visible reel threads only when one active reel surface can be identified unambiguously.

### Documentation

- Documented the first-post startup hydration failure mode and the required regression coverage.
- Documented the feed-photo overlay URL rewrite trap and the media-viewer boundary rules.
- Documented the isolated reel resolver boundary and the requirement to abort when multiple visible reel candidates remain ambiguous.