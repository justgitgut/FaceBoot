# Chrome Web Store Publishing Checklist

This repository is prepared for packaging, but Chrome Web Store publication still requires store-listing assets and publisher-side configuration.

## Included in the repo

- MV3 manifest and extension source
- 128px extension icon
- reduced permission surface (`storage`, `tabs`)
- privacy policy draft in [PRIVACY.md](PRIVACY.md)
- store listing copy in [STORE-LISTING.md](STORE-LISTING.md)
- privacy questionnaire guide in [PRIVACY-QUESTIONNAIRE.md](PRIVACY-QUESTIONNAIRE.md)
- packaging script in [build-release.ps1](build-release.ps1)
- README aligned with the current extension behavior

## Manual items still required before submission

1. Create or verify a public privacy policy URL.
2. Prepare at least one screenshot of the extension in use.
3. Use a support URL or public issue tracker.
4. Build the release zip for upload.
5. Fill out the Chrome Web Store privacy questionnaire accurately.

## Ready-to-paste materials

- Listing copy: [STORE-LISTING.md](STORE-LISTING.md)
- Privacy policy: [PRIVACY.md](PRIVACY.md)
- Privacy questionnaire answers: [PRIVACY-QUESTIONNAIRE.md](PRIVACY-QUESTIONNAIRE.md)
- Suggested support URL: `https://github.com/justgitgut/FaceBoot/issues`
- Suggested privacy-policy URL if GitHub Pages is enabled: `https://justgitgut.github.io/FaceBoot/privacy/`

## Permission justifications

### `storage`

Used to save feature settings and local activity counters.

### `tabs`

Used to refresh or redirect open Facebook tabs after settings changes and to apply optional anti-refresh behavior when the user enables it.

### Host permissions

Restricted to Facebook web domains so the extension can modify the Facebook interface where the user has enabled its features.

## Packaging

Run the packaging script from the repository root:

`pwsh -ExecutionPolicy Bypass -File .\build-release.ps1`

It creates a versioned zip in `dist/` with the extension files at the archive root, which is the format you want for Chrome Web Store upload.

## Suggested pre-submit test pass

1. Load the unpacked extension in Chrome.
2. Verify the popup loads and settings persist.
3. Verify settings apply to already-open Facebook tabs.
4. Verify post expansion in English, French, and Spanish.
5. Verify comment expansion and comment sort switching.
6. Verify uninstall removes stored settings and counters.

## Notes for the publisher

- A GitHub Pages-ready policy page now exists at [docs/privacy/index.html](docs/privacy/index.html). If this repository is published through GitHub Pages from the `docs/` folder, the privacy-policy URL pattern will be `https://<username>.github.io/<repo>/privacy/`.
- If you want smoother review, keep the store description tightly aligned to the actual behavior in the code and avoid claims like “block all ads” or “works forever” because Facebook markup changes frequently.