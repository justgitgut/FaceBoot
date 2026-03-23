<p align="center">
	<img src="icons/logo.png" alt="Faceberg logo" width="420" />
</p>

# Faceberg

Chrome extension that declutters your Facebook feed, auto-expands posts and visible comment threads, keeps supported feed and group URLs chronological, and offers optional anti-refresh protection.

- Hides Reels, Stories, sponsored posts, People You May Know, and Follow/Join feed cards.
- Auto-expands truncated posts and visible comment/reply threads.
- Switches the active post dialog to `All comments` before expanding visible comment threads.
- Blocks Facebook's forced tab reload when you return to the page.
- Optionally lands you directly on the All Feed view with chronological sorting when opening Facebook.

## Install (Developer Mode)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder (`Faceberg`).

## Publish Prep

- Privacy policy draft: [PRIVACY.md](PRIVACY.md)
- GitHub Pages privacy page: [docs/privacy/index.html](docs/privacy/index.html)
- Chrome Web Store prep notes: [CHROME-STORE.md](CHROME-STORE.md)
- Store listing copy: [STORE-LISTING.md](STORE-LISTING.md)
- Privacy questionnaire guide: [PRIVACY-QUESTIONNAIRE.md](PRIVACY-QUESTIONNAIRE.md)
- Packaging script: [build-release.ps1](build-release.ps1)

## Settings

1. Click the extension icon in Chrome.
2. Open **Faceberg** popup settings.
3. Review live stats in the popup header:
   - Use the Activity tab to switch between `This Session` and `All Time`
   - Review grouped counters for Feed Cleanup and Automated Actions
   - Review estimated time saved and the current tracking start date
   - Reset all accumulated stats with the `Reset` button in the Activity header
4. Toggle features:
	- Enable anti-refresh protection
	- Enable feed cleanup
	- Hide Reels containers
	- Hide People You May Know
	- Hide Follow posts
	- Hide Join posts
	- Auto-expand long posts
	- Auto-expand comments
5. Click **Apply** to save and refresh Facebook tabs.
6. If **Go directly to feeds on activation** is enabled, Apply will open Facebook tabs on:
	- `https://www.facebook.com/?filter=all&sk=h_chr&sorting_setting=CHRONOLOGICAL`

When you open a root group page such as `https://www.facebook.com/groups/<group-id>`, Faceberg also appends `sorting_setting=CHRONOLOGICAL` to the URL.

Note: anti-refresh protection is off by default and should be treated as an optional compatibility feature.

The extension auto-refreshes open Facebook tabs on install/update so filters apply immediately.

## Notes

- This works on `www.facebook.com` and `web.facebook.com`.
- Facebook changes DOM markup frequently; selectors may need occasional updates.
- Auto-click behavior is scoped to visible post/dialog contexts. You can tune the matching patterns in `content.js`.
- The extension stores settings and aggregate counters locally and does not send Facebook data to external servers.
- Session counters reset once per browser startup or extension restart; they do not reset on ordinary Facebook page loads.

## How It Works

- `injected.js`: runs in page context and blocks common refresh triggers (`location.reload`, string-based timer refresh calls, meta refresh tags, and resume lifecycle events that try to refresh when a background tab becomes active again).
- `content.js`: observes the feed and post dialogs, normalizes supported Facebook feed/group URLs, hides unwanted feed content, expands posts, and coordinates modal comment automation.
- `popup.html` + `popup.js`: UI and storage-backed settings for feature toggles, grouped activity stats, period switching, and saved-time estimates.
- `manifest.json`: MV3 config and script registration.

## Automation Boundary

- Feed cleanup removes unwanted content from the DOM.
- Post expansion clicks visible `See more`-style controls.
- Comment automation remains scoped to the current post context.
- In already-open post dialogs, the extension opens the comment-ordering popup for the active post, selects `All comments`, and then expands visible comment/reply controls.
- Feed cleanup and post expansion still do not open random posts or unrelated menus.

See [docs/architecture-v2.md](docs/architecture-v2.md) for the current architecture boundary.
See [docs/regression-checklist.md](docs/regression-checklist.md) for the recommended validation checklist after automation changes.

## Permissions

- `storage`: saves settings and local activity counters.
- `tabs`: refreshes or redirects open Facebook tabs after settings changes and applies tab-specific behavior.
- Host permissions are limited to Facebook web domains.
