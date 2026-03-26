# Faceberg Regression Checklist

Use this checklist after changing feed cleanup, post expansion, comment expansion, or page-observer logic.

## Feed Cleanup

1. Open the main Facebook feed.
2. Verify unwanted content is removed from the DOM:
   - Reels containers
   - People You May Know
   - Follow posts
   - Join posts
   - other blocked feed clutter controlled by settings
3. Scroll the feed and confirm removed content does not reappear after observer reruns.
4. Confirm ordinary feed posts remain visible and clickable.

## Post Expansion

1. Find several truncated posts in the feed.
2. Reload with a truncated first feed post visible at the top of the page.
3. Verify the first visible `See more` expands during startup before scrolling away.
4. Confirm the first post does not leave the literal `See more` text concatenated into the visible body.
5. Verify later visible `See more`-style controls also expand the post body.
6. Confirm no unrelated menus or dialogs open during expansion.
7. Confirm already-expanded posts are not spam-clicked repeatedly.

## Comment Expansion

1. Open a direct post/permalink page.
2. Verify visible comment-summary, load-more-comment, and reply-expander controls are expanded.
3. If the page initially opens the sorter with a loading spinner, confirm the popup settles once and does not flicker while Faceberg waits for `All comments`.
3. Open a post dialog from the feed.
4. Verify the comment-ordering popup opens only for the active dialog.
5. Confirm the sorter popup opens automatically when Faceberg can resolve the toggle target.
6. Confirm `All comments` becomes the selected option in the dialog.
7. Confirm `Filter changes` increments by 1 when Faceberg actually switches the sorter away from `Most relevant` or `Newest`.
8. Verify visible comment/reply expansion works after sorting changes.
9. Confirm no unrelated post or menu is opened.
10. Confirm exact `View all N replies` controls expand when visible.
11. Open a `/reel/` page or Reels route with one clearly visible active reel.
12. Verify only the active reel comment surface is targeted.
13. Confirm `All comments` becomes the selected option when the reel sorter is present.
14. Confirm `Filter changes` increments only when the reel sorter actually switches.
15. Verify visible reel comment/reply expansion works after sorting changes.
16. Confirm no older feed/dialog post reopens while using the reel surface.
17. If multiple reel candidates are visible, confirm automation prefers doing nothing over opening the wrong surface.

## Media Viewer Checks

1. From the feed, open a photo from a post that has comments.
2. Confirm a previously viewed post does not reopen over the photo.
3. If the media viewer has inline comments, confirm the filter changes to `All comments`.
4. If the media viewer is a direct `/photo/` or `/watch/` page, confirm comment expansion still works.
5. If Facebook rewrites the URL to `/photo/` while the photo is still acting like a feed overlay, confirm no document-level automation targets an older post underneath it.
6. Repeat photo open/close several times and confirm old dialogs are not re-targeted.

## Safety Checks

1. From the feed, click comment on one post and confirm no unrelated/random post opens.
2. Confirm no stray outside clicks occur.
3. Confirm typing in an active comment composer is not interrupted.
4. Confirm automation does not run on media-viewer pages.

## Sticky Failure Loop Checks

1. Open comments on one post.
2. Close it and open a different post's comments.
3. Open a photo from the feed.
4. Repeat the sequence at least three times.
5. Confirm Faceberg does not enter a state where random older posts reopen on each new comment/photo click.

## Observer / Navigation Checks

1. Let the feed update naturally while scrolling.
2. Confirm observer reruns remain stable and do not trigger modal-opening behavior.
3. Navigate between feed, direct-post page, and back.
4. Confirm comment automation remains scoped to direct-post pages or already-open dialogs.

## Notification Navigation Checks

These checks remain important, but the current code does not have a dedicated notification-suppression window. Failures here usually indicate dialog-resolution or stale-surface regressions.

1. Open the notifications surface from the main Facebook UI.
2. Click a notification that targets a normal feed post.
3. Confirm the intended post opens and no unrelated/random post opens instead.
4. Close the opened post and repeat the same notification click at least twice.
5. Confirm the first click behaves the same as later clicks; there is no stale first-attempt misfire.
6. Click a notification that targets a group post.
7. Confirm Faceberg does not land on the parent group feed when the notification should open the specific post.
8. Confirm two post dialogs never stack on top of each other during notification opens.
9. While the notifications surface is visible, confirm Faceberg does not trigger feed/comment automation elsewhere on the page.
10. After the notification target finishes opening, confirm normal automation resumes on the actual destination post only.

## URL Normalization Checks

1. Enable **Go directly to feeds on activation** and apply settings.
2. Confirm redirected Facebook tabs open on:
   - `https://www.facebook.com/?filter=all&sk=h_chr&sorting_setting=CHRONOLOGICAL`
3. Open a root group page such as `https://www.facebook.com/groups/<id>`.
4. Set **Default group sort** in the popup to a non-default option such as `Most relevant` or `Recent activity` and apply settings.
5. Confirm Faceberg finds the in-page group feed sorter and switches it to the configured default sort without navigating away.
6. Navigate to the same root group feed through Facebook SPA navigation and confirm the sorter still settles on the configured default sort.

## Anti-Refresh Checks

1. Enable anti-refresh protection.
2. Switch away from Facebook and back.
3. Confirm the page is not force-reloaded.
4. Leave Facebook in the background long enough for its resume handlers to fire, then return and confirm the page still does not force-reload.
5. Confirm core cleanup/expansion still works with anti-refresh enabled.

## Activity Stats Checks

1. Trigger at least one feed cleanup action and one automated action.
2. Confirm `This Session` updates without reopening the popup.
3. Refresh the Facebook page and confirm `This Session` is not wiped by that page load.
4. Switch to `All Time` and confirm the totals are at least as large as `This Session`.
5. Use `Reset` and confirm totals clear and the tracking date updates.
6. Use `Copy Debug Information` and confirm the clipboard payload includes extension version, active Facebook tab details, saved settings, current stats, and page-debug extraction hints.

## Acceptance Criteria

Changes are acceptable when all of the following remain true:

1. Feed cleanup removes unwanted content without affecting normal posts.
2. Post expansion works without opening unexpected UI.
3. Dialog comment automation selects `All comments` and then expands visible threads.
4. URL normalization keeps supported feed/group surfaces chronological.
5. No random posts or dialogs open.
6. No stray clicks or composer interruptions occur.
7. Repeated photo/comment opens do not resurrect previously viewed dialogs.
8. Notification-driven navigation never opens the wrong post, a stacked post dialog, or a parent group feed.