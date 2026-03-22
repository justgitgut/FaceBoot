# FaceBoot Regression Checklist

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
3. Open a post dialog from the feed.
4. Verify the comment-ordering popup opens only for the active dialog.
5. Confirm `All comments` becomes the selected option in the dialog.
6. Verify visible comment/reply expansion works after sorting changes.
7. Confirm no unrelated post or menu is opened.

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
5. Confirm FaceBoot does not enter a state where random older posts reopen on each new comment/photo click.

## Observer / Navigation Checks

1. Let the feed update naturally while scrolling.
2. Confirm observer reruns remain stable and do not trigger modal-opening behavior.
3. Navigate between feed, direct-post page, and back.
4. Confirm comment automation remains scoped to direct-post pages or already-open dialogs.

## URL Normalization Checks

1. Enable **Go directly to feeds on activation** and apply settings.
2. Confirm redirected Facebook tabs open on:
   - `https://www.facebook.com/?filter=all&sk=h_chr&sorting_setting=CHRONOLOGICAL`
3. Open a root group page such as `https://www.facebook.com/groups/<id>`.
4. Confirm the URL gains `sorting_setting=CHRONOLOGICAL` without navigating to a different page.

## Anti-Refresh Checks

1. Enable anti-refresh protection.
2. Switch away from Facebook and back.
3. Confirm the page is not force-reloaded.
4. Confirm core cleanup/expansion still works with anti-refresh enabled.

## Acceptance Criteria

Changes are acceptable when all of the following remain true:

1. Feed cleanup removes unwanted content without affecting normal posts.
2. Post expansion works without opening unexpected UI.
3. Dialog comment automation selects `All comments` and then expands visible threads.
4. URL normalization keeps supported feed/group surfaces chronological.
5. No random posts or dialogs open.
6. No stray clicks or composer interruptions occur.
7. Repeated photo/comment opens do not resurrect previously viewed dialogs.