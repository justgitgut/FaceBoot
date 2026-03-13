# Chrome Web Store Privacy Questionnaire Guide

This is a practical answer key for the Chrome Web Store privacy section based on the current FaceBoot codebase.

Review it again before submission in case the extension changes.

## Developer Data Usage Disclosure

### Does the extension collect or use user data?

Recommended answer: Yes, but only locally within the extension environment.

Reason:

- The extension reads Facebook page content to hide or expand items.
- It stores settings and aggregate counters in Chrome storage.
- It does not transmit that data off-device.

If the form distinguishes between local processing and remote collection, make clear that processing is local only.

## Data Types

### Personally identifiable information

Recommended answer: No.

### Health information

Recommended answer: No.

### Financial and payment information

Recommended answer: No.

### Authentication information

Recommended answer: No.

### Personal communications

Recommended answer: No.

Reason:

- The extension may observe comment and post text in the page DOM to find expansion controls, but it does not collect, store, or transmit message or communication content as product data.

### Location

Recommended answer: No.

### Web history

Recommended answer: No.

Reason:

- The extension only runs on Facebook host permissions and does not maintain a browsing-history log.

### User activity

Recommended answer: Yes.

Reason:

- The extension stores aggregate activity counters such as items removed, posts expanded, comment actions, and prevented refreshes.
- These counters stay local in Chrome storage and are used only for the popup activity view.

### Website content

Recommended answer: Yes.

Reason:

- The extension reads page content on Facebook to identify posts, clutter modules, and expansion controls.
- This content is processed locally and is not transmitted externally.

## Data Usage Purposes

For the data categories above, the safe current purposes are:

- Core functionality
- User-facing customization

Do not claim analytics, advertising, creditworthiness, or data sale.

## Is data sold to third parties?

Recommended answer: No.

## Is data transferred to third parties?

Recommended answer: No.

## Is data used for purposes unrelated to the extension's single purpose?

Recommended answer: No.

## Is data used for creditworthiness or lending?

Recommended answer: No.

## Permission Explanations

### `storage`

Used to save user preferences and local activity counters.

### `tabs`

Used to refresh or redirect already-open Facebook tabs after settings changes and to apply tab-specific anti-refresh behavior.

### Host permissions on Facebook domains

Required so the extension can read and modify the Facebook web interface where the user expects the extension to work.

## Reviewer Notes You Can Reuse

FaceBoot works only on Facebook web pages, processes page content locally in the browser, stores only settings and aggregate counters, and does not transmit Facebook content or user data to any external server.