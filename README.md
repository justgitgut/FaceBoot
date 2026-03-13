# FaceBoot

Chrome extension that declutters your Facebook feed, auto-expands posts and comment threads, and offers optional anti-refresh protection.

- Hides Reels, Stories, sponsored posts, People You May Know, and Follow/Join feed cards.
- Auto-expands truncated posts and deep comment threads.
- Blocks Facebook's forced tab reload when you return to the page.
- Optionally lands you directly on the All Feed view when opening Facebook.

## Install (Developer Mode)

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder (`FaceBoot`).

## Publish Prep

- Privacy policy draft: [PRIVACY.md](PRIVACY.md)
- GitHub Pages privacy page: [docs/privacy/index.html](docs/privacy/index.html)
- Chrome Web Store prep notes: [CHROME-STORE.md](CHROME-STORE.md)
- Store listing copy: [STORE-LISTING.md](STORE-LISTING.md)
- Privacy questionnaire guide: [PRIVACY-QUESTIONNAIRE.md](PRIVACY-QUESTIONNAIRE.md)
- Packaging script: [build-release.ps1](build-release.ps1)

## Settings

1. Click the extension icon in Chrome.
2. Open **FaceBoot** popup settings.
3. Review live stats in the popup header:
	- Reels removed
	- Follow posts removed
	- Join posts removed
	- Refreshes prevented
	- Comment actions
	- Posts expanded
   - Each stat shows total and session count (session resets on page reload)
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
	- `https://www.facebook.com/?filter=all&sk=h_chr`

Note: anti-refresh protection is off by default and should be treated as an optional compatibility feature.

The extension auto-refreshes open Facebook tabs on install/update so filters apply immediately.

## Notes

- This works on `www.facebook.com` and `web.facebook.com`.
- Facebook changes DOM markup frequently; selectors may need occasional updates.
- Auto-click behavior can be aggressive on busy pages. You can tune the regex patterns in `content.js`.
- The extension stores settings and aggregate counters locally and does not send Facebook data to external servers.

## How It Works

- `injected.js`: runs in page context and blocks common refresh triggers (`location.reload`, string-based timer refresh calls, and meta refresh tags).
- `content.js`: observes the feed and post dialogs, hides Reels/Join/Follow content based on separate toggles, clicks comment expansion controls, and attempts to select `All comments`.
- `popup.html` + `popup.js`: UI and storage-backed settings for feature toggles and blocked labels.
- `manifest.json`: MV3 config and script registration.

## Permissions

- `storage`: saves settings and local activity counters.
- `tabs`: refreshes or redirects open Facebook tabs after settings changes and applies tab-specific behavior.
- Host permissions are limited to Facebook web domains.
