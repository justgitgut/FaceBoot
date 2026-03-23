# Privacy Policy for FaceBoot

Last updated: March 22, 2026

FaceBoot does not sell personal data, does not send browsing data to any server, and does not use analytics, ads, or remote code.

## What FaceBoot accesses

FaceBoot runs only on:

- `https://www.facebook.com/*`
- `https://web.facebook.com/*`

It reads page content on those domains in order to:

- hide feed modules such as Reels, sponsored posts, and People You May Know
- expand truncated posts and comment threads
- reduce forced Facebook reload behavior
- optionally redirect Facebook tabs to the All Feed view

## What data FaceBoot stores

FaceBoot stores extension settings and local activity counters using Chrome extension storage:

- `chrome.storage.sync` for settings, when available
- `chrome.storage.local` for settings fallback and activity stats

Stored data is limited to:

- on/off feature preferences
- aggregate counters such as removed items, expanded posts, expanded comment actions, and prevented refreshes

FaceBoot does not intentionally store:

- Facebook account credentials
- message contents
- post contents
- comment contents
- browsing history outside Facebook
- personally identifying analytics

## What data FaceBoot transmits

FaceBoot does not transmit collected data to the developer or to third parties.

All processing happens locally in the browser.

## Third-party services

FaceBoot does not use third-party analytics, ad networks, trackers, or external APIs.

## Data retention

Data remains in your browser storage until you:

- change or clear the extension settings
- clear extension storage through Chrome
- uninstall the extension

Session activity counters reset when the browser session or extension worker session is restarted. Aggregate counters persist in local storage until cleared or the extension is removed.

## Your choices

You can:

- disable individual features from the extension popup
- remove the extension at any time in `chrome://extensions`
- clear Chrome extension storage by removing the extension

## Contact

Support and privacy questions can be directed to the public issue tracker:

- `https://github.com/justgitgut/FaceBoot/issues`