# Changelog

## 2026-03-23 - v1.1.0

### Release Summary

- Rebranded from FaceBoot to Faceberg with new artwork, updated all source identifiers, and shipped a redesigned popup stats UI.

### Changed

- Renamed extension from FaceBoot to Faceberg in manifest, all JS source files, store listings, and documentation.
- Replaced all `__facebootContentScriptInstalled`, `__facebootNoRefreshInstalled`, and `FaceBootStats` identifiers with their `Faceberg` equivalents.
- Enabled anti-refresh protection by default (`enableAntiRefresh: true`).

### Improved — Anti-Refresh (`injected.js`)

- Added `normalizePathname()` to strip trailing slashes before same-path comparison, preventing spurious reload blocks on canonical URL variants.
- Added `toNavigationTarget()` for consistent URL coercion from string or object inputs.
- Extended `VOLATILE_REFRESH_PARAM_PATTERN` to also strip `_rdc`, `_rdr`, `__tn__`, `__xts__`, and `utm_*` parameters from canonical comparisons.
- Added `pagehide` and `freeze` to `SUSPICIOUS_EVENT_TYPES` alongside the existing visibility/focus events.
- Increased `RESUME_SUPPRESSION_WINDOW_MS` from 5 000 ms to 10 000 ms.
- Added `lastUserInteractionAt` tracking to inform smarter suppression decisions.
- Fixed a default-settings mismatch between `background.js` and `content.js` so protected Facebook tabs no longer remain discardable by default and reload after long idle periods.

### Improved — Popup

- Redesigned stats panel with an ROI hero section showing estimated time saved and three breakdown pillars (Cleanup, Expansion, Refresh).
- Replaced individual badge/total elements with a unified detail list for a cleaner at-a-glance view.

### Fixed — Notification Navigation

- Documented and hardened the notification-navigation failure mode where Facebook can rewrite the URL before replacing the old feed DOM.
- Restricted direct-post automation so it waits for DOM evidence matching the current target post instead of acting on stale feed surfaces.
- Added notification-aware suppression so feed cleanup, post expansion, comment automation, delayed retries, and mutation watchers stand down while the notifications surface is active and while notification-driven navigation is settling.
- Removed navigation-prone generic primary comment opener automation from direct post handling to avoid wrong-post opens, stacked dialogs, and parent-group-feed misroutes.

### Documentation

- Added explicit notification-navigation guardrails and regression coverage so future automation changes do not reintroduce random post opens from notifications.

### Icons

- Replaced placeholder book and source assets with new Faceberg ship-and-iceberg artwork across all sizes (16 × 16, 32 × 32, 48 × 48, 128 × 128).
- Added `faceberg.ico`, `faceberg_master_1024.png`, and `logo.png` source assets.
- Updated `make-icons.ps1` for the new logo source.

### Added

- `CHROME-STORE-APPEAL.md` — draft appeal letter for Chrome Web Store submission review.
- `STORE-LISTING-FALLBACK.md` — condensed fallback store listing copy.
- `test.js` — in-page debugging helper.

## 2026-03-22 - v1.0.1

### Release Summary

- Published the first major release with the isolated reel comment resolver, stronger anti-refresh protection, corrected session and filter-change stats, and the redesigned Activity tab.

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