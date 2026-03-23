(() => {
  "use strict";

  if (globalThis.FacebergCommentsRuntime) {
    return;
  }

  const contentUtils = globalThis.FacebergContentUtils;
  const contentDebug = globalThis.FacebergContentDebug;
  if (!contentUtils || !contentDebug) {
    return;
  }

  const {
    uiMatchers,
    normalizeText,
    matchesSorterToggleText,
    isPostActionControl,
    hasPostActionControl,
    isVisible,
    pressElement
  } = contentUtils;
  const {
    describeElement,
    debugCommentAutomation
  } = contentDebug;

  const clickedElements = new WeakSet();
  const commentExpansionAttemptState = new WeakMap();
  const activeExpansionWatchers = new WeakMap();
  const commentFilterAttemptState = new WeakMap();

  function getSettings(deps) {
    return typeof deps?.getSettings === "function"
      ? deps.getSettings()
      : deps?.settings;
  }

  function queueStatIncrement(deps, statKey, delta = 1) {
    if (typeof deps?.queueStatIncrement === "function") {
      deps.queueStatIncrement(statKey, delta);
    }
  }

  function watchSurfaceMutations(surface, callback, options = {}) {
    if (!(surface instanceof Element) || !document.contains(surface)) {
      return null;
    }

    const maxDuration = options.maxDuration || 4000;
    let rafId = 0;
    let done = false;

    function stop() {
      if (done) {
        return;
      }

      done = true;
      observer.disconnect();
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    function schedule() {
      if (done || rafId) {
        return;
      }

      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (done || !document.contains(surface)) {
          stop();
          return;
        }
        callback(surface);
      });
    }

    const observer = new MutationObserver(schedule);
    observer.observe(surface, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "aria-checked", "aria-selected", "role", "hidden", "style"]
    });

    const bodyObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node.querySelector('[role="menu"]') || node.matches('[role="menu"]'))
          ) {
            schedule();
            return;
          }
        }
      }
    });
    bodyObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

    const timerId = window.setTimeout(stop, maxDuration);

    return {
      stop() {
        window.clearTimeout(timerId);
        stop();
        bodyObserver.disconnect();
      }
    };
  }

  function isDirectPostPage() {
    const path = String(window.location.pathname || "");
    return /\/permalink\/|\/posts\/|\/story\.php/i.test(path);
  }

  function getActiveEditableElement() {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof Element)) {
      return null;
    }

    if (activeElement.closest('[contenteditable="true"], textarea, input, [role="textbox"]')) {
      return activeElement;
    }

    return null;
  }

  function isCommentComposerActive(surface = null) {
    const activeElement = getActiveEditableElement();
    if (!(activeElement instanceof Element)) {
      return false;
    }

    const composer = activeElement.closest(
      '[contenteditable="true"][role="textbox"], [contenteditable="true"][data-lexical-editor="true"], textarea, [role="textbox"]'
    );
    if (!(composer instanceof Element)) {
      return false;
    }

    if (!(surface instanceof Element)) {
      return true;
    }

    return surface.contains(composer);
  }

  function isMediaViewerPage() {
    const path = String(window.location.pathname || "");
    return /\/photo\/|\/watch\//i.test(path);
  }

  function isReelExperiencePage() {
    const path = String(window.location.pathname || "");
    return /\/reel(?:s)?(?:\/|$)/i.test(path);
  }

  function getViewportVisibilityScore(element) {
    if (!(element instanceof Element) || !isVisible(element)) {
      return 0;
    }

    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return 0;
    }

    const viewportWidth = window.innerWidth || document.documentElement?.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement?.clientHeight || 0;
    const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
    const visibleHeight = Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0));

    if (visibleWidth <= 0 || visibleHeight <= 0) {
      return 0;
    }

    return Math.round((visibleWidth * visibleHeight) / 1000);
  }

  function hasVisibleLargeReelMedia(surface) {
    if (!(surface instanceof Element) || !isVisible(surface)) {
      return false;
    }

    return [...surface.querySelectorAll("video")].some((video) => {
      if (!(video instanceof Element) || !isVisible(video)) {
        return false;
      }

      const rect = video.getBoundingClientRect();
      return rect.width >= 220 && rect.height >= 280;
    });
  }

  function hasReelNavigationSignals(surface) {
    if (!(surface instanceof Element) || !isVisible(surface)) {
      return false;
    }

    return !!surface.querySelector('a[role="link"][href*="/reel/"], a[href*="/reel/"]');
  }

  function hasReelsLabelSignals(surface) {
    if (!(surface instanceof Element) || !isVisible(surface)) {
      return false;
    }

    const ownLabel = normalizeText(surface.getAttribute("aria-label"));
    if (ownLabel === "reels" || ownLabel.startsWith("reels ")) {
      return true;
    }

    return [...surface.querySelectorAll('h1, h2, h3, h4, [role="heading"], [role="tab"], [aria-label]')].some((candidate) => {
      if (!(candidate instanceof Element) || !isVisible(candidate)) {
        return false;
      }

      const text = normalizeText(candidate.textContent || candidate.getAttribute("aria-label"));
      return text === "reels" || text.startsWith("reels ");
    });
  }

  function isActiveReelContextCandidate(surface) {
    if (!(surface instanceof Element) || !isVisible(surface)) {
      return false;
    }

    if (!surface.matches('div[role="article"], [data-pagelet], main, [role="main"]')) {
      return false;
    }

    if (surface.closest('[role="dialog"]')) {
      return false;
    }

    if (!hasVisibleLargeReelMedia(surface)) {
      return false;
    }

    return isReelExperiencePage() || hasReelNavigationSignals(surface) || hasReelsLabelSignals(surface);
  }

  function chooseBestScopedCandidate(candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return null;
    }

    candidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.top - right.top;
    });

    const best = candidates[0] || null;
    const second = candidates[1] || null;
    if (!best) {
      return null;
    }

    if (!second) {
      return best.surface;
    }

    const nested = best.surface.contains(second.surface) || second.surface.contains(best.surface);
    if (nested || best.score - second.score >= 45) {
      return best.surface;
    }

    return null;
  }

  function getActiveReelContext(root = document) {
    if (!isReelExperiencePage()) {
      return null;
    }

    const scopeElement = root instanceof Element ? root : document.body;
    const selectors = 'div[role="article"], [data-pagelet], main, [role="main"]';
    const seen = new Set();
    const candidates = [];

    function addCandidate(surface, bias = 0) {
      if (!(surface instanceof Element) || seen.has(surface) || !isActiveReelContextCandidate(surface)) {
        return;
      }

      seen.add(surface);

      let score = bias;
      if (scopeElement instanceof Element && surface === scopeElement) {
        score += 120;
      }
      if (scopeElement instanceof Element && surface.contains(scopeElement)) {
        score += 60;
      }
      if (scopeElement instanceof Element && scopeElement.contains(surface)) {
        score += 30;
      }
      if (surface.matches('main, [role="main"]')) {
        score += 40;
      }
      if (hasReelNavigationSignals(surface)) {
        score += 100;
      }
      if (hasReelsLabelSignals(surface)) {
        score += 45;
      }
      if (hasCommentSurfaceSignals(surface)) {
        score += 55;
      }

      const relatedCommentSurface = [...surface.querySelectorAll('[role="complementary"], div[role="article"], [data-pagelet], main, [role="main"]')]
        .find((candidate) => candidate instanceof Element && isVisible(candidate) && hasCommentSurfaceSignals(candidate));
      if (relatedCommentSurface) {
        score += 50;
      }

      const visibilityScore = getViewportVisibilityScore(surface);
      score += Math.min(140, visibilityScore);

      const rect = surface.getBoundingClientRect();
      candidates.push({
        surface,
        score,
        top: Number.isFinite(rect?.top) ? rect.top : Number.POSITIVE_INFINITY
      });
    }

    if (scopeElement instanceof Element) {
      addCandidate(scopeElement.closest(selectors), 110);
      if (scopeElement.matches(selectors)) {
        addCandidate(scopeElement, 90);
      }
      scopeElement.querySelectorAll?.(selectors).forEach((surface) => addCandidate(surface, 20));
    }

    document.querySelectorAll('video, a[href*="/reel/"]').forEach((node) => {
      if (!(node instanceof Element) || !isVisible(node)) {
        return;
      }

      addCandidate(node.closest(selectors), 35);
    });

    document.querySelectorAll(selectors).forEach((surface) => addCandidate(surface, 5));
    return chooseBestScopedCandidate(candidates);
  }

  function getActiveReelCommentSurface(root = document) {
    if (!isReelExperiencePage()) {
      return null;
    }

    const reelContext = getActiveReelContext(root);
    if (!(reelContext instanceof Element)) {
      return null;
    }

    const scopeElement = root instanceof Element ? root : reelContext;
    const seen = new Set();
    const candidates = [];
    const selectors = '[role="complementary"], div[role="article"], [data-pagelet], main, [role="main"]';

    function addCandidate(surface, bias = 0) {
      if (!(surface instanceof Element) || seen.has(surface) || !isVisible(surface) || !hasCommentSurfaceSignals(surface)) {
        return;
      }

      if (surface.closest('[role="dialog"]')) {
        return;
      }

      if (!(reelContext.contains(surface) || surface.contains(reelContext) || surface.parentElement === reelContext.parentElement)) {
        return;
      }

      seen.add(surface);

      let score = bias;
      if (surface === reelContext) {
        score += 60;
      }
      if (surface.matches('[role="complementary"]')) {
        score += 95;
      }
      if (surface.matches('main, [role="main"], [data-pagelet]')) {
        score += 50;
      }
      if (scopeElement instanceof Element && surface === scopeElement) {
        score += 80;
      }
      if (scopeElement instanceof Element && surface.contains(scopeElement)) {
        score += 35;
      }
      if (scopeElement instanceof Element && scopeElement.contains(surface)) {
        score += 20;
      }

      const sorterToggle = getCommentSorterToggle(surface);
      if (sorterToggle instanceof Element) {
        score += 100;
      }

      if (surface.querySelector('[contenteditable="true"][role="textbox"], textarea')) {
        score += 65;
      }

      if (surface.querySelector('[role="list"], [aria-live], ul, ol')) {
        score += 40;
      }

      if (hasVisibleLargeReelMedia(surface)) {
        score -= 15;
      }

      const rect = surface.getBoundingClientRect();
      score += Math.min(120, getViewportVisibilityScore(surface));

      candidates.push({
        surface,
        score,
        top: Number.isFinite(rect?.top) ? rect.top : Number.POSITIVE_INFINITY
      });
    }

    addCandidate(reelContext, 80);
    reelContext.querySelectorAll(selectors).forEach((surface) => addCandidate(surface, 20));

    if (reelContext.parentElement instanceof Element) {
      reelContext.parentElement.querySelectorAll(':scope > [role="complementary"], :scope > div[role="article"], :scope > [data-pagelet], :scope > main, :scope > [role="main"]').forEach((surface) => addCandidate(surface, 25));
    }

    return chooseBestScopedCandidate(candidates);
  }

  function isReelCommentSurface(surface) {
    if (!(surface instanceof Element) || !isVisible(surface) || !isReelExperiencePage()) {
      return false;
    }

    const activeSurface = getActiveReelCommentSurface(surface);
    return activeSurface === surface;
  }

  function isDirectPageCommentSurface(surface) {
    if (!(surface instanceof Element) || !isVisible(surface)) {
      return false;
    }

    if (isMediaViewerPage()) {
      if (!surface.matches('[role="complementary"], div[role="article"], [data-pagelet], main, [role="main"]')) {
        return false;
      }

      return hasCommentSurfaceSignals(surface);
    }

    if (!isDirectPostPage()) {
      return false;
    }

    if (!surface.matches('div[role="article"], [data-pagelet], main, [role="main"]')) {
      return false;
    }

    return hasCommentSurfaceSignals(surface);
  }

  function isMediaViewerSurface(surface) {
    if (!(surface instanceof Element) || !surface.matches('[role="dialog"]')) {
      return false;
    }

    const dialogLabel = normalizeText(surface.getAttribute("aria-label"));
    if (/\b(photo|image|video|media)\b/i.test(dialogLabel)) {
      return true;
    }

    if (!isMediaViewerPage()) {
      return false;
    }

    return [...surface.querySelectorAll("img, video")].some((media) => {
      if (!(media instanceof Element) || !isVisible(media)) {
        return false;
      }

      const rect = media.getBoundingClientRect();
      return rect.width >= 260 && rect.height >= 180;
    });
  }

  function isIgnoredDialog(surface) {
    if (!(surface instanceof Element) || !surface.matches('[role="dialog"]')) {
      return false;
    }

    const dialogLabel = normalizeText(surface.getAttribute("aria-label"));
    return /notifications|messenger|search|create post/i.test(dialogLabel);
  }

  function hasPostDialogSignals(surface) {
    if (!(surface instanceof Element) || !surface.matches('[role="dialog"]')) {
      return false;
    }

    /* Only use signals that are exclusive to real post dialogs and cannot appear
       inside a Facebook notification or messenger panel.
       Removed: href*="/permalink/", href*="/posts/" — notification items always
       link to these URLs, causing the notification panel to be misidentified as a
       post dialog and triggering comment automation that opens a random post.
       Removed: [role="list"] [role="article"] and [aria-live] [role="article"] —
       the notification panel uses exactly this structure for its notification list. */
    return (
      hasPostActionControl(surface) ||
      !!surface.querySelector(
        '[data-ad-rendering-role="story_message"], ' +
        '[data-ad-rendering-role="story_body"], ' +
        '[data-ad-rendering-role="profile_name"], ' +
        '[data-ad-rendering-role="comment_button"], ' +
        'a[aria-label="hide post"], ' +
        'a[role="link"][href*="/story.php"]'
      )
    );
  }

  function hasAutomatableDialogSignals(surface) {
    if (!(surface instanceof Element) || !surface.matches('[role="dialog"]')) {
      return false;
    }

    /* Feed dialogs require real post signals. Media dialogs are only valid when
       comments are visibly present; otherwise photo viewers can hijack dialog resolution. */
    return hasPostDialogSignals(surface) || (isMediaViewerSurface(surface) && hasCommentSurfaceSignals(surface));
  }

  function getTopVisibleDialog(root = document) {
    const scopedElement = root instanceof Element ? root : null;
    const scopedDialog = scopedElement ? scopedElement.closest('[role="dialog"]') : null;
    if (
      scopedDialog &&
      isVisible(scopedDialog) &&
      !isIgnoredDialog(scopedDialog) &&
      (!isMediaViewerSurface(scopedDialog) || hasCommentSurfaceSignals(scopedDialog))
    ) {
      return scopedDialog;
    }

    const dialogs = [...document.querySelectorAll('[role="dialog"]')].reverse();
    return dialogs.find((dialog) => {
      if (!isVisible(dialog) || isIgnoredDialog(dialog)) {
        return false;
      }
      if (!isMediaViewerSurface(dialog)) {
        return true;
      }
      /* Allow media viewer dialogs that also contain comment UI
         (e.g. photo lightbox with an inline comment section). */
      return hasCommentSurfaceSignals(dialog);
    }) || null;
  }

  function getBlockingMediaViewerOverlay() {
    const topVisibleDialog = [...document.querySelectorAll('[role="dialog"]')]
      .reverse()
      .find((dialog) => isVisible(dialog) && !isIgnoredDialog(dialog)) || null;

    if (topVisibleDialog && isMediaViewerSurface(topVisibleDialog) && !hasCommentSurfaceSignals(topVisibleDialog)) {
      return topVisibleDialog;
    }

    return null;
  }

  function getVisiblePostDialog(root = document) {
    const visibleDialog = getTopVisibleDialog(root);
    /* Only real post dialogs or media viewer dialogs with inline comments should
       suppress normal feed handling; unrelated overlays otherwise hijack comment automation. */
    if (
      visibleDialog &&
      hasAutomatableDialogSignals(visibleDialog)
    ) {
      return visibleDialog;
    }

    if (!(root instanceof Element)) {
      return null;
    }

    /* If the topmost visible overlay is a media viewer without comment UI yet,
       do not fall back to older dialogs underneath it or a previously viewed post
       dialog can be re-targeted when the user simply opens a photo. */
    if (getBlockingMediaViewerOverlay()) {
      return null;
    }

    const dialogs = [...document.querySelectorAll('[role="dialog"]')].reverse();
    return dialogs.find((dialog) => {
      if (!isVisible(dialog) || isIgnoredDialog(dialog)) {
        return false;
      }

      return hasAutomatableDialogSignals(dialog);
    }) || null;
  }

  function isCommentHintControl(control) {
    if (!(control instanceof Element) || !isVisible(control)) {
      return false;
    }

    if (control.closest('[role="menu"], [role="toolbar"]')) {
      return false;
    }

    const text = normalizeText(control.textContent || control.getAttribute("aria-label"));
    return (
      !!control.querySelector('[data-ad-rendering-role="comment_button"]') ||
      uiMatchers.commentSummaryRegex.test(text) ||
      uiMatchers.loadMoreCommentRegex.test(text) ||
      uiMatchers.moreCommentRegex.test(text)
    );
  }

    /* Facebook uses focus and selection separately inside the comment-ordering popup.
      A focused row often has tabindex="0" even when it is not the chosen sort option,
      so only aria-checked / aria-selected are trusted here. If this regresses, do not
      reintroduce tabindex-based selection checks or the code will start treating
      "Newest" as already selected again. */
    function isMenuItemSelected(item) {
    if (!(item instanceof Element)) {
      return false;
    }

    return (
      item.getAttribute("aria-checked") === "true" ||
      item.getAttribute("aria-selected") === "true"
    );
  }

    /* Facebook menu rows often concatenate a short label with a long descriptive sentence.
      Matching against the full text caused false positives such as:
      "Newest ... show all comments with the newest comments first".
      This helper intentionally prefers the shortest stable label-like fragment so
      downstream matching can target the actual option name rather than the description. */
    function getMenuItemMatchText(item) {
    if (!(item instanceof Element)) {
      return "";
    }

    const ariaLabel = normalizeText(item.getAttribute("aria-label"));
    if (ariaLabel) {
      return ariaLabel;
    }

    const candidateTexts = [item, ...item.querySelectorAll("span, div")]
      .filter((candidate) => candidate instanceof Element)
      .map((candidate) => normalizeText(candidate.textContent || candidate.getAttribute("aria-label")))
      .filter((text) => text && text.length <= 80)
      .sort((left, right) => left.length - right.length);

    return candidateTexts[0] || normalizeText(item.textContent || item.getAttribute("aria-label"));
  }

  function matchesAllCommentsText(text) {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return false;
    }

    return /^all comments(?:\b|\s|[.,!?;:()\[\]{}])/.test(normalizedText);
  }

  function matchesFilterOptionText(text) {
    return matchesAllCommentsText(text) || matchesSorterToggleText(text);
  }

  function isCommentOrderingMenu(menu) {
    if (!(menu instanceof Element)) {
      return false;
    }

    const label = normalizeText(menu.getAttribute("aria-label") || "");
    return label === "comment ordering" || label.startsWith("comment ordering ");
  }

    /* The sorter toggle lives inside the active dialog and can read as Newest,
      Most relevant, or All comments. The scoring here intentionally prefers:
      1. a toggle already reading All comments,
      2. an expanded toggle,
      3. a toggle near the discussion region.
      This keeps the code anchored to the current modal instead of some unrelated
      Facebook menu button elsewhere on the page. */
    function getCommentSorterToggle(surface) {
    if (!(surface instanceof Element)) {
      return null;
    }

    const candidates = [];
    const selector = '[role="button"][aria-haspopup="menu"], [role="link"][aria-haspopup="menu"], [tabindex][aria-haspopup="menu"]';

    surface.querySelectorAll(selector).forEach((candidate) => {
      if (!isVisible(candidate) || candidate.closest('[role="menu"], [role="toolbar"]') || isPostActionControl(candidate)) {
        return;
      }

      const text = normalizeText(candidate.textContent || candidate.getAttribute("aria-label"));
      if (!matchesSorterToggleText(text)) {
        return;
      }

      let score = 0;
      if (matchesAllCommentsText(text)) {
        score += 200;
      }
      if (candidate.getAttribute("aria-expanded") === "true") {
        score += 80;
      }
      if (candidate.closest('[role="list"], [aria-live], ul, ol')) {
        score += 30;
      }

      const rect = candidate.getBoundingClientRect();
      candidates.push({
        candidate,
        score,
        top: Number.isFinite(rect?.top) ? rect.top : Number.POSITIVE_INFINITY
      });
    });

    candidates.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.top - right.top;
    });

    return candidates[0]?.candidate || null;
  }

  function getFilterOptionItems(container, toggle = null) {
    if (!(container instanceof Element)) {
      return [];
    }

    const items = [];
    const seenItems = new Set();

    function pushItem(item) {
      if (!(item instanceof Element) || !isVisible(item) || seenItems.has(item)) {
        return;
      }

      seenItems.add(item);
      items.push(item);
    }

    const roleItems = [
      ...container.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="radio"]')
    ].filter((item) => isVisible(item));

    roleItems.forEach(pushItem);

    const genericPressables = [
      ...container.querySelectorAll('[role="button"], [role="link"], button, a[href], [tabindex]')
    ].filter((item) => {
      if (!(item instanceof Element) || !isVisible(item)) {
        return false;
      }

      if (toggle instanceof Element && (item === toggle || item.contains(toggle) || toggle.contains(item))) {
        return false;
      }

      if (item.closest('[role="toolbar"]') || isPostActionControl(item)) {
        return false;
      }

      const text = normalizeText(item.textContent || item.getAttribute("aria-label"));
      return matchesFilterOptionText(text);
    });

    genericPressables.forEach(pushItem);

    [...container.querySelectorAll('[aria-checked], [aria-selected]')]
      .filter((item) => isVisible(item))
      .forEach(pushItem);

    return items;
  }

    /* The open popup is not identified by DOM position alone.
      Facebook may leave multiple menu-like surfaces in the document, so this scores
      candidates using the exact signals that proved reliable during debugging:
      - aria-label="Comment Ordering"
      - presence of a real All comments row
      - presence of the current toggle label (Newest / Most relevant / All comments)
      - proximity to the active sorter toggle
      Keep this scoring behavior intact unless the popup structure changes again. */
    function getCommentSortMenu(surface, toggle = null) {
    const toggleText = normalizeText(toggle?.textContent || toggle?.getAttribute?.("aria-label"));
    const toggleRect = toggle?.getBoundingClientRect?.();
    const menus = [...document.querySelectorAll('[role="menu"], [role="listbox"], [role="dialog"]')]
      .filter((menu) => isVisible(menu))
      .map((menu) => {
        const items = getFilterOptionItems(menu, toggle);

        if (items.length === 0) {
          return null;
        }

        let score = 0;
        const itemTexts = items.map((item) => normalizeText(item.textContent || item.getAttribute("aria-label")));
        if (itemTexts.some((text) => matchesAllCommentsText(text))) {
          score += 140;
        }
        if (itemTexts.some((text) => matchesSorterToggleText(text))) {
          score += 70;
        }
        if (toggleText && itemTexts.some((text) => text === toggleText)) {
          score += 40;
        }
        if (items.some((item) => isMenuItemSelected(item))) {
          score += 15;
        }
        if (surface instanceof Element && surface.contains(menu)) {
          score += 25;
        }

        if (isCommentOrderingMenu(menu)) {
          score += 180;
        }

        if (menu.matches('[role="menu"]')) {
          score += 30;
        }

        if (menu.matches('[role="listbox"]')) {
          score += 20;
        }

        const menuRect = menu.getBoundingClientRect();
        const top = Number.isFinite(menuRect?.top) ? menuRect.top : Number.POSITIVE_INFINITY;
        if (toggleRect) {
          const horizontalDistance = Math.abs(menuRect.left - toggleRect.left);
          const verticalDistance = Math.abs(menuRect.top - toggleRect.bottom);
          score += Math.max(0, 120 - Math.min(120, horizontalDistance));
          score += Math.max(0, 120 - Math.min(120, verticalDistance));
        }

        return score > 0 ? { menu, items, score, top } : null;
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        return left.top - right.top;
      });

    return menus[0] || null;
  }

  function getMenuItemDebugState(item) {
    if (!(item instanceof Element)) {
      return null;
    }

    return {
      role: item.getAttribute("role") || "",
      ariaChecked: item.getAttribute("aria-checked") || "",
      ariaSelected: item.getAttribute("aria-selected") || "",
      tabIndex: item.getAttribute("tabindex") || "",
      text: getMenuItemMatchText(item)
    };
  }

    /* Synthetic clicks on arbitrary child spans often do nothing while still reporting
      success. This helper samples the visual center of the row, then promotes the hit
      target to the nearest interactive ancestor so we click the node Facebook is most
      likely listening to instead of a decorative child element. */
    function getElementCenterHitTarget(container) {
    if (!(container instanceof Element)) {
      return null;
    }

    const rect = container.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const clientX = rect.left + Math.min(Math.max(rect.width / 2, 1), Math.max(rect.width - 1, 1));
    const clientY = rect.top + Math.min(Math.max(rect.height / 2, 1), Math.max(rect.height - 1, 1));

    const target = document.elementFromPoint(clientX, clientY);
    if (!(target instanceof Element) || (target !== container && !container.contains(target))) {
      return null;
    }

    const interactiveTarget = target.closest(
      '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="button"], [role="link"], button, a[href], [tabindex]'
    );

    if (interactiveTarget instanceof Element && (interactiveTarget === container || container.contains(interactiveTarget))) {
      return interactiveTarget;
    }

    return target;
  }

    /* Candidate ordering matters.
      The working behavior is: try the interactive row itself first, then any nested
      interactive descendant, then the center-hit ancestor, and only then fallback
      label containers. Earlier versions tried child spans first and left the popup open
      because Facebook ignored those clicks. */
    function getMenuItemActivationCandidates(item) {
    if (!(item instanceof Element)) {
      return [];
    }

    const labelText = normalizeText(item.textContent || item.getAttribute("aria-label"));
    const candidates = [];
    const seenCandidates = new Set();

    function pushCandidate(candidate) {
      if (!(candidate instanceof Element) || !isVisible(candidate) || seenCandidates.has(candidate)) {
        return;
      }

      seenCandidates.add(candidate);
      candidates.push(candidate);
    }

    pushCandidate(item.matches('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="button"], [role="link"], button, a[href], [tabindex]') ? item : null);
    pushCandidate(item.querySelector('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"], [role="button"], [role="link"], button, a[href], [tabindex]'));
    pushCandidate(getElementCenterHitTarget(item));

    if (labelText) {
      [...item.querySelectorAll('span, div')].forEach((candidate) => {
        const candidateText = normalizeText(candidate.textContent || candidate.getAttribute("aria-label"));
        if (candidateText === labelText) {
          pushCandidate(candidate);
        }
      });
    }

    pushCandidate(item.firstElementChild);
    return candidates;
  }

    /* The comment-ordering popup does not respond reliably to keyboard synthesis here.
      The stable path is:
      1. target the interactive row,
      2. try native click first,
      3. fallback to mouse/pointer-style dispatch only.
      Do not add Enter/keyboard dispatch back into this path unless Facebook changes,
      because it previously caused false positives and inconsistent popup flicker. */
    function activateMenuItem(item) {
    if (!(item instanceof Element) || !isVisible(item)) {
      return false;
    }

    const candidates = getMenuItemActivationCandidates(item);
    const selectedItemBefore = getMenuItemDebugState(item);

    for (const candidate of candidates) {
      debugCommentAutomation("filter-selection-attempt", {
        selectedItemBefore,
        activationTarget: describeElement(candidate)
      });

      try {
        if (typeof candidate.click === "function") {
          candidate.click();
          return true;
        }
      } catch {
        /* Ignore native click failures. */
      }

      if (pressElement(candidate, {
        dispatchKeyboard: false,
        dispatchSyntheticClick: true,
        dispatchNativeClick: false
      })) {
        return true;
      }

      if (pressElement(candidate, {
        dispatchKeyboard: false,
        dispatchSyntheticClick: false,
        dispatchNativeClick: true
      })) {
        return true;
      }
    }

    return false;
  }

  function getFilterToggleActivationCandidates(toggle) {
    if (!(toggle instanceof Element)) {
      return [];
    }

    const labelText = normalizeText(toggle.textContent || toggle.getAttribute("aria-label"));
    const candidates = [];
    const seenCandidates = new Set();

    function pushCandidate(candidate) {
      if (!(candidate instanceof Element) || !isVisible(candidate) || seenCandidates.has(candidate)) {
        return;
      }

      seenCandidates.add(candidate);
      candidates.push(candidate);
    }

    pushCandidate(toggle);
    pushCandidate(getElementCenterHitTarget(toggle));

    if (labelText) {
      [...toggle.querySelectorAll('span, div')].forEach((candidate) => {
        const candidateText = normalizeText(candidate.textContent || candidate.getAttribute("aria-label"));
        if (candidateText === labelText) {
          pushCandidate(candidate);
        }
      });
    }

    pushCandidate(toggle.firstElementChild);
    return candidates;
  }

  function didFilterToggleOpen(surface, toggle) {
    if (!(toggle instanceof Element)) {
      return false;
    }

    const toggleText = normalizeText(toggle.textContent || toggle.getAttribute("aria-label"));
    return (
      toggle.getAttribute("aria-expanded") === "true" ||
      matchesAllCommentsText(toggleText) ||
      !!getCommentSortMenu(surface, toggle)
    );
  }

  function activateFilterToggle(surface, toggle) {
    if (!(toggle instanceof Element) || !isVisible(toggle)) {
      return false;
    }

    const candidates = getFilterToggleActivationCandidates(toggle);

    for (const candidate of candidates) {
      try {
        if (typeof candidate.click === "function") {
          candidate.click();
          if (didFilterToggleOpen(surface, toggle)) {
            return true;
          }
        }
      } catch {
        /* Ignore native click failures. */
      }

      if (pressElement(candidate, {
        dispatchKeyboard: false,
        dispatchSyntheticClick: true,
        dispatchNativeClick: false
      }) && didFilterToggleOpen(surface, toggle)) {
        return true;
      }

      if (pressElement(candidate, {
        dispatchKeyboard: false,
        dispatchSyntheticClick: false,
        dispatchNativeClick: true
      }) && didFilterToggleOpen(surface, toggle)) {
        return true;
      }
    }

    return false;
  }

    /* This state is intentionally minimal now that the popup behavior is stable.
      We only keep enough timing information to avoid double-opening the popup and to
      schedule a single short follow-up pass after opening. The old retry/suspension
      state machine was removed once the selector and click target were corrected. */
    function getCommentFilterState(surface) {
    let state = commentFilterAttemptState.get(surface);
    if (!state) {
      state = {
        lastToggleAt: 0,
        lastSelectionAt: 0,
        interactionUntil: 0,
        retryTimerId: 0
      };
      commentFilterAttemptState.set(surface, state);
    }

    return state;
  }

  function clearCommentFilterRetry(state) {
    if (!state || !state.retryTimerId) {
      return;
    }

    window.clearTimeout(state.retryTimerId);
    state.retryTimerId = 0;
  }

    /* This is the core "choose All comments" step.
      Important constraints from debugging:
      - match against getMenuItemMatchText(), not full textContent
      - only treat a row as selected when aria state says so
      - if the popup is open, click immediately and let a short follow-up verify state
      - avoid long cooldowns or reopen loops now that the correct row is found
      If selection starts hitting Newest again, inspect the label extraction before
      changing anything else. */
    function selectAllCommentsFromOpenMenu(surface, toggle, state, toggleText, deps = {}, { respectCooldown = true } = {}) {
    const openMenu = getCommentSortMenu(surface, toggle);
    if (!openMenu) {
      return "not-open";
    }

    const allCommentsItem = openMenu.items.find((item) => {
      const text = getMenuItemMatchText(item);
      return matchesAllCommentsText(text);
    });

    if (!(allCommentsItem instanceof Element)) {
      debugCommentAutomation("filter-menu-no-all-comments-item", {
        target: describeElement(surface),
        toggleText
      });
      return "unavailable";
    }

    if (isMenuItemSelected(allCommentsItem)) {
      clearCommentFilterRetry(state);
      debugCommentAutomation("filter-menu-item-already-selected", {
        target: describeElement(surface),
        toggleText,
        selectedItem: getMenuItemMatchText(allCommentsItem)
      });
      return "already";
    }

    const now = Date.now();
    if (respectCooldown && now - state.lastSelectionAt < 250) {
      debugCommentAutomation("filter-selection-pending", {
        target: describeElement(surface),
        toggleText
      });
      return "pending";
    }

    if (!activateMenuItem(allCommentsItem)) {
      debugCommentAutomation("filter-selection-failed", {
        target: describeElement(surface),
        toggleText,
        selectedItem: getMenuItemMatchText(allCommentsItem),
        selectedItemBefore: getMenuItemDebugState(allCommentsItem)
      });
      return "unavailable";
    }

    state.lastSelectionAt = now;
    state.interactionUntil = now + 500;
     /* Keep the stat increment here, after a real menu-item activation succeeds.
       Counting earlier would over-report failed opens, and dropping deps anywhere in
       this call chain makes the UI switch without ever recording the filter change. */
     queueStatIncrement(deps, "commentFilterChanges");
    debugCommentAutomation("filter-selection-dispatched", {
      target: describeElement(surface),
      toggleText,
      selectedItem: getMenuItemMatchText(allCommentsItem),
      selectedItemBefore: getMenuItemDebugState(allCommentsItem)
    });
    return "pending";
  }

    /* This is intentionally not a general retry ladder anymore.
      It exists only to give Facebook a brief window to render/commit the popup state
      after opening the sorter. The follow-up runs once after a short delay and only
      acts if the popup is still open. Reintroducing reopen loops here will bring back
      the old flicker and UI hijacking problems. */
    function scheduleAllCommentsSelectionRetry(surface, deps = {}, delay = 90) {
    if (!(surface instanceof Element)) {
      return;
    }

    const state = getCommentFilterState(surface);
    clearCommentFilterRetry(state);
    state.interactionUntil = Date.now() + Math.max(delay + 240, 360);

    state.retryTimerId = window.setTimeout(() => {
      state.retryTimerId = 0;

      if (!surface.isConnected || !isVisible(surface)) {
        return;
      }

      const toggle = getCommentSorterToggle(surface);
      if (!(toggle instanceof Element)) {
        return;
      }

      const currentToggleText = normalizeText(toggle.textContent || toggle.getAttribute("aria-label"));
      if (matchesAllCommentsText(currentToggleText)) {
        clearCommentFilterRetry(state);
        debugCommentAutomation("filter-selected-all-comments", {
          target: describeElement(surface),
          toggleText: currentToggleText
        });
        return;
      }

      if (toggle.getAttribute("aria-expanded") === "true") {
        /* The delayed retry must carry deps too, otherwise filter changes selected on
           the second pass stop incrementing even though the sorter visibly changes. */
        selectAllCommentsFromOpenMenu(surface, toggle, state, currentToggleText, deps, {
          respectCooldown: false
        });
      }
    }, delay);
  }

    /* Full filter flow for the active comment surface:
      1. Find the sorter toggle in the resolved surface only.
      2. Exit immediately if the toggle already reads All comments.
      3. If the popup is already open, select All comments from that popup.
      4. Otherwise open the toggle once and schedule one short follow-up pass.

      This function is intentionally conservative about reopening the popup. The code
      used to carry aggressive retries, suspension windows, and reopen heuristics, but
      those were only compensating for incorrect item matching and wrong click targets.
      If behavior regresses, prefer fixing popup/menu detection before adding retries. */
    function ensureAllCommentsFilter(surface, deps = {}) {
    if (!(surface instanceof Element)) {
      return "unavailable";
    }

    const toggle = getCommentSorterToggle(surface);
    if (!(toggle instanceof Element)) {
      debugCommentAutomation("filter-no-toggle", {
        target: describeElement(surface)
      });
      return "unavailable";
    }

    const now = Date.now();
    const state = getCommentFilterState(surface);
    const toggleText = normalizeText(toggle.textContent || toggle.getAttribute("aria-label"));
    const toggleExpanded = toggle.getAttribute("aria-expanded") === "true";
    const msSinceLastToggle = now - state.lastToggleAt;

    if (matchesAllCommentsText(toggleText)) {
      clearCommentFilterRetry(state);
      debugCommentAutomation("filter-already-all-comments", {
        target: describeElement(surface),
        toggleText
      });
      return "already";
    }

    const immediateSelectionResult = selectAllCommentsFromOpenMenu(surface, toggle, state, toggleText, deps);
    if (immediateSelectionResult !== "not-open") {
      return immediateSelectionResult;
    }

    if (!toggleExpanded && msSinceLastToggle > 300 && now - state.lastSelectionAt > 250) {
      clearCommentFilterRetry(state);
      state.interactionUntil = 0;
    }

    if (toggleExpanded) {
      if (!state.retryTimerId) {
        scheduleAllCommentsSelectionRetry(surface, deps, 70);
      }
      debugCommentAutomation("filter-toggle-already-open", {
        target: describeElement(surface),
        toggleText
      });
      return "pending";
    }

    if (state.interactionUntil > now) {
      if (!state.retryTimerId) {
        scheduleAllCommentsSelectionRetry(surface, deps, 70);
      }
      debugCommentAutomation("filter-interaction-pending", {
        target: describeElement(surface),
        toggleText
      });
      return "pending";
    }

    if (msSinceLastToggle < 240 || (msSinceLastToggle < 500 && state.retryTimerId)) {
      debugCommentAutomation("filter-toggle-pending", {
        target: describeElement(surface),
        toggleText
      });
      return "pending";
    }

    if (!activateFilterToggle(surface, toggle)) {
      debugCommentAutomation("filter-toggle-failed", {
        target: describeElement(surface),
        toggleText
      });
      return "unavailable";
    }

    state.lastToggleAt = now;
    state.interactionUntil = now + 360;
    scheduleAllCommentsSelectionRetry(surface, deps, 90);
    debugCommentAutomation("filter-toggle-opened", {
      target: describeElement(surface),
      toggleText
    });
    return "pending";
  }

  function getCommentSurface(root = document) {
    const scopeElement = root instanceof Element ? root : document.body;
    const forcedDialog = getVisiblePostDialog(scopeElement || document);
    if (forcedDialog) {
      return forcedDialog;
    }

    const reelSurface = getActiveReelCommentSurface(scopeElement || document);
    if (reelSurface) {
      return reelSurface;
    }

    const seenSurfaces = new Set();
    const candidates = [];
    const surfaceSelector = '[role="dialog"], div[role="article"], [data-pagelet], main, [role="main"], [role="complementary"]';
    const onDirectPostPage = isDirectPostPage();
    const onMediaViewerPage = isMediaViewerPage();

    function addCandidate(surface, bias = 0) {
      if (!(surface instanceof Element) || !isVisible(surface) || seenSurfaces.has(surface)) {
        return;
      }

      if (isMediaViewerSurface(surface)) {
        return;
      }

      if (surface.matches('[role="complementary"]') && !isDirectPageCommentSurface(surface)) {
        return;
      }

      seenSurfaces.add(surface);

      let score = bias;
      const containsScope = scopeElement instanceof Element && surface.contains(scopeElement);
      const insideScope = scopeElement instanceof Element && scopeElement.contains(surface);
      const isScopeSurface = scopeElement instanceof Element && surface === scopeElement;

      if (isScopeSurface) {
        score += 110;
      }

      if (containsScope) {
        score += 60;
      }

      if (insideScope) {
        score += 30;
      }

      const sorterToggles = [...surface.querySelectorAll('[role="button"][aria-haspopup="menu"]')]
        .filter((toggle) => isVisible(toggle))
        .filter((toggle) => !toggle.closest('[role="menu"]'))
        .filter((toggle) => !toggle.closest('[role="toolbar"]'))
        .filter((toggle) => !isPostActionControl(toggle))
        .filter((toggle) => {
          const text = normalizeText(toggle.textContent || toggle.getAttribute("aria-label"));
          return matchesSorterToggleText(text);
        });

      const commentHints = [...surface.querySelectorAll('[role="button"]')]
        .filter((control) => isCommentHintControl(control));

      const hasComposer = !!surface.querySelector('[contenteditable="true"][role="textbox"], textarea');
      const renderedCommentCount = [...surface.querySelectorAll('div[role="article"]')].filter((article) => {
        return article.querySelector('[data-ad-rendering-role="profile_name"], a[role="link"]');
      }).length;
      const hasDiscussionRegion = !!surface.querySelector('[role="list"], [aria-live], ul, ol');
      const hasLoadMoreCommentControl = [...surface.querySelectorAll('[role="button"], [role="link"], [tabindex]')]
        .some((control) => {
          if (!(control instanceof Element) || !isVisible(control) || control.closest('[role="menu"], [role="toolbar"]')) {
            return false;
          }

          const text = normalizeText(control.textContent || control.getAttribute("aria-label"));
          return uiMatchers.loadMoreCommentRegex.test(text) || uiMatchers.moreCommentRegex.test(text);
        });
      const isLeafCommentArticle = surface.matches('div[role="article"]') && !sorterToggles.length && !hasComposer && !hasDiscussionRegion;

      if (sorterToggles.length > 0) {
        score += 90;
      }

      if (commentHints.length > 0) {
        score += 70;
      }

      if (hasComposer) {
        score += 50;
      }

      if (hasDiscussionRegion) {
        score += 40;
      }

      if (renderedCommentCount >= 2) {
        score += 25;
      }

      if (hasLoadMoreCommentControl) {
        score += 60;
      }

      if (onDirectPostPage && surface.matches('main, [role="main"], [data-pagelet]')) {
        score += 80;
      }

      if (!onDirectPostPage && surface.matches('main, [role="main"]')) {
        score -= 60;
      }

      if (!onDirectPostPage && surface.matches('[data-pagelet]') && !surface.matches('div[role="article"]')) {
        score -= 25;
      }

      if (isDirectPageCommentSurface(surface)) {
        score += 120;
      }

      if (isLeafCommentArticle) {
        score -= 140;
      }

      if (surface.matches('[role="dialog"]') && score < bias + 90) {
        return;
      }

      candidates.push({ surface, score });
    }

    if (scopeElement instanceof Element) {
      addCandidate(scopeElement.closest(surfaceSelector), 90);

      if (scopeElement.matches(surfaceSelector)) {
        addCandidate(scopeElement, 100);
      }

      const scopedSurface = scopeElement.querySelector?.(surfaceSelector);
      if (scopedSurface) {
        addCandidate(scopedSurface, 40);
      }
    }

    document.querySelectorAll('[role="dialog"]').forEach((dialog) => addCandidate(dialog, 10));

    if (onMediaViewerPage) {
      document.querySelectorAll('[role="complementary"]').forEach((comp) => addCandidate(comp, 10));
    }

    document
      .querySelectorAll('[role="button"][aria-haspopup="menu"]')
      .forEach((toggle) => addCandidate(toggle.closest(surfaceSelector), 55));

    document
      .querySelectorAll('[contenteditable="true"][role="textbox"], textarea')
      .forEach((composer) => addCandidate(composer.closest(surfaceSelector), 45));

    document
      .querySelectorAll('[role="button"]')
      .forEach((control) => {
        if (isCommentHintControl(control)) {
          addCandidate(control.closest(surfaceSelector), 35);
        }
      });

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0]?.surface || null;
  }

  function canAutomateCommentSurface(surface) {
    if (!(surface instanceof Element)) {
      return false;
    }

    if (isReelCommentSurface(surface)) {
      return true;
    }

    if (isMediaViewerSurface(surface) && !hasCommentSurfaceSignals(surface)) {
      return false;
    }

    if (surface.matches('[role="dialog"]')) {
      return hasAutomatableDialogSignals(surface);
    }

    if (isDirectPageCommentSurface(surface)) {
      return true;
    }

    if (!surface.matches('div[role="article"]')) {
      return false;
    }

    const hasPostSignals =
      hasPostActionControl(surface) ||
      !!surface.querySelector(
        '[data-ad-rendering-role="story_message"], ' +
        '[data-ad-rendering-role="story_body"], ' +
        'a[aria-label="hide post"], ' +
        'a[role="link"][href*="/permalink/"], ' +
        'a[role="link"][href*="/posts/"], ' +
        'a[role="link"][href*="/story.php"], ' +
        'a[role="link"][href*="/reel/"], ' +
        'a[role="link"][href*="/videos/"]'
      );

    if (!hasPostSignals) {
      return false;
    }

    const hasComposer = !!surface.querySelector('[contenteditable="true"][role="textbox"], textarea');
    const renderedCommentCount = [...surface.querySelectorAll('div[role="article"]')].filter((article) => {
      return article !== surface && article.querySelector('[data-ad-rendering-role="profile_name"], a[role="link"]');
    }).length;
    const hasDiscussionRegion = !!surface.querySelector('[role="list"], [aria-live], ul, ol');
    const hasLoadMoreCommentControl = [...surface.querySelectorAll('[role="button"], [role="link"], [tabindex]')]
      .some((control) => {
        if (!(control instanceof Element) || !isVisible(control) || control.closest('[role="menu"], [role="toolbar"]')) {
          return false;
        }

        const text = normalizeText(control.textContent || control.getAttribute("aria-label"));
        return uiMatchers.loadMoreCommentRegex.test(text) || uiMatchers.moreCommentRegex.test(text);
      });

    return hasComposer || hasDiscussionRegion || renderedCommentCount >= 1 || hasLoadMoreCommentControl;
  }

  function hasCommentSurfaceSignals(surface) {
    if (!(surface instanceof Element) || !isVisible(surface)) {
      return false;
    }

    const hasSorterToggle = [...surface.querySelectorAll('[role="button"][aria-haspopup="menu"], [role="link"][aria-haspopup="menu"], [tabindex][aria-haspopup="menu"]')]
      .some((toggle) => {
        if (!isVisible(toggle) || toggle.closest('[role="menu"], [role="toolbar"]') || isPostActionControl(toggle)) {
          return false;
        }

        const text = normalizeText(toggle.textContent || toggle.getAttribute("aria-label"));
        return matchesSorterToggleText(text);
      });

    const hasCommentHints = [...surface.querySelectorAll('[role="button"], [role="link"], [tabindex]')]
      .some((control) => isCommentHintControl(control));

    const hasComposer = !!surface.querySelector('[contenteditable="true"][role="textbox"], textarea');
    return hasSorterToggle || hasCommentHints || hasComposer;
  }

  function getCommentActionControls(surface) {
    if (!(surface instanceof Element)) {
      return [];
    }

    const seen = new Set();
    const controls = [];

    function addControl(candidate) {
      if (!(candidate instanceof Element) || !isVisible(candidate) || seen.has(candidate)) {
        return;
      }

      seen.add(candidate);
      controls.push(candidate);
    }

    surface.querySelectorAll('[role="button"]').forEach((candidate) => {
      const text = normalizeText(candidate.textContent || candidate.getAttribute("aria-label"));
      if (
        isCommentHintControl(candidate) ||
        (candidate.getAttribute("aria-haspopup") === "menu" && matchesSorterToggleText(text))
      ) {
        addControl(candidate);
      }
    });

    surface.querySelectorAll('[role="link"]').forEach((candidate) => {
      const text = normalizeText(candidate.textContent || candidate.getAttribute("aria-label"));
      if (
        candidate.getAttribute("aria-haspopup") === "menu" ||
        isCommentHintControl(candidate) ||
        matchesSorterToggleText(text)
      ) {
        addControl(candidate);
      }
    });

    surface.querySelectorAll('[tabindex][aria-haspopup="menu"]').forEach((candidate) => {
      const text = normalizeText(candidate.textContent || candidate.getAttribute("aria-label"));
      if (matchesSorterToggleText(text)) {
        addControl(candidate);
      }
    });

    surface.querySelectorAll('[data-ad-rendering-role="comment_button"]').forEach((marker) => {
      const control = marker.closest('[role="button"], [role="link"], [tabindex]');
      addControl(control);
    });

    return controls;
  }

  function getControlNavigationHref(control) {
    if (!(control instanceof Element)) {
      return "";
    }

    const link = control.matches('a[href]') ? control : control.closest('a[href]');
    const href = link?.getAttribute('href') || "";
    if (!href) {
      return "";
    }

    try {
      return new URL(href, window.location.href).href;
    } catch {
      return href;
    }
  }

  function normalizePathname(pathname) {
    const raw = String(pathname || "/");
    const trimmed = raw.replace(/\/+$/, "");
    return trimmed || "/";
  }

  function getDirectTargetIdentifiers(urlLike) {
    let parsedUrl;
    try {
      parsedUrl = urlLike instanceof URL ? urlLike : new URL(String(urlLike), window.location.href);
    } catch {
      return [];
    }

    const identifiers = new Set();
    const path = normalizePathname(parsedUrl.pathname);
    const postIdMatch = path.match(/\/(?:posts|permalink|videos|reel)\/(\d+)(?:\/|$)/i);
    if (postIdMatch?.[1]) {
      identifiers.add(postIdMatch[1]);
    }

    const storyFbid = parsedUrl.searchParams.get("story_fbid") || parsedUrl.searchParams.get("fbid");
    if (storyFbid) {
      identifiers.add(String(storyFbid));
    }

    return [...identifiers];
  }

  function urlMatchesCurrentDirectTarget(urlLike) {
    let candidateUrl;
    let currentUrl;
    try {
      candidateUrl = urlLike instanceof URL ? urlLike : new URL(String(urlLike), window.location.href);
      currentUrl = new URL(window.location.href);
    } catch {
      return false;
    }

    if (candidateUrl.origin !== currentUrl.origin) {
      return false;
    }

    const currentIdentifiers = getDirectTargetIdentifiers(currentUrl);
    const candidateIdentifiers = getDirectTargetIdentifiers(candidateUrl);
    if (currentIdentifiers.length > 0 && candidateIdentifiers.length > 0) {
      return currentIdentifiers.some((identifier) => candidateIdentifiers.includes(identifier));
    }

    return normalizePathname(candidateUrl.pathname) === normalizePathname(currentUrl.pathname);
  }

  function surfaceMatchesCurrentDirectTarget(surface) {
    if (!(surface instanceof Element) || !isVisible(surface) || !isDirectPostPage()) {
      return false;
    }

    if (surface.matches('a[href]') && urlMatchesCurrentDirectTarget(surface.getAttribute("href") || "")) {
      return true;
    }

    return [...surface.querySelectorAll('a[href]')].some((link) => {
      return urlMatchesCurrentDirectTarget(link.getAttribute("href") || "");
    });
  }

  function isDirectPostDomReady(root = document) {
    if (!isDirectPostPage()) {
      return false;
    }

    const surface = getCommentSurface(root);
    return !!(
      surface instanceof Element &&
      canAutomateCommentSurface(surface) &&
      surfaceMatchesCurrentDirectTarget(surface)
    );
  }

  function isLikelyPostNavigationHref(href) {
    if (!href) {
      return false;
    }

    try {
      const url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) {
        return true;
      }

      if (
        url.pathname !== window.location.pathname &&
        /\/permalink\/|\/posts\/|\/story\.php|\/photo\/|\/videos\/|\/reel\//i.test(url.pathname)
      ) {
        return true;
      }

      if (url.pathname === window.location.pathname && (!url.hash || url.hash === "#")) {
        return false;
      }

      return false;
    } catch {
      return /\/permalink\/|\/posts\/|\/story\.php|\/photo\/|\/videos\/|\/reel\//i.test(href);
    }
  }

  function getDirectPostPrimaryCommentControl(surface, controls = null) {
    if (!(surface instanceof Element)) {
      return null;
    }

    const candidateControls = Array.isArray(controls) ? controls : getCommentActionControls(surface);
    const rankedControls = [];

    for (const control of candidateControls) {
      const text = normalizeText(control.textContent || control.getAttribute("aria-label"));
      const hasCommentMarker = !!control.querySelector('[data-ad-rendering-role="comment_button"]');
      const inCommentThread = !!control.closest('[role="list"], [aria-live], ul, ol');
      const isSummaryControl = !!text && uiMatchers.commentSummaryRegex.test(text);
      const isLoadMoreControl = !!text && (
        uiMatchers.loadMoreCommentRegex.test(text) ||
        uiMatchers.moreCommentRegex.test(text)
      );
      const isReplyControl = /\brepl(?:y|ies)\b/.test(text);
      const hasCommentWord = /\bcomments?\b/.test(text);
      const isNumericCommentCount = /^\d[\d.,km]*\s+comments?$/i.test(text);
      const isBareCommentLabel = /^comments?$/.test(text);
      const navigationHref = getControlNavigationHref(control);
      const isLikelyPostNavigation = isLikelyPostNavigationHref(navigationHref);
      const isInsideLink = !!control.closest('a[href]');

      debugCommentAutomation("opener-candidate", {
        control: describeElement(control),
        controlText: text,
        navigationHref,
        isLikelyPostNavigation,
        isInsideLink
      });

      if (!(control instanceof Element) || !isVisible(control)) {
        debugCommentAutomation("reject-opener-not-visible", { control: describeElement(control) });
        continue;
      }
      if (control.closest('[role="menu"], [role="toolbar"]')) {
        debugCommentAutomation("reject-opener-menu-toolbar", { control: describeElement(control) });
        continue;
      }
      if (control.getAttribute("aria-haspopup") === "menu") {
        debugCommentAutomation("reject-opener-has-popup", { control: describeElement(control) });
        continue;
      }
      if (!hasCommentMarker && !hasCommentWord && !isSummaryControl) {
        debugCommentAutomation("reject-opener-no-comment-marker", { control: describeElement(control) });
        continue;
      }
      if (isLikelyPostNavigation || isInsideLink) {
        debugCommentAutomation("reject-opener-link-or-navigation", {
          control: describeElement(control),
          navigationHref,
          isInsideLink
        });
        continue;
      }
      if (matchesSorterToggleText(text)) {
        debugCommentAutomation("reject-opener-sorter-toggle", { control: describeElement(control) });
        continue;
      }

      let score = 0;
      if (hasCommentMarker) {
        score += 100;
      }
      if (isBareCommentLabel) {
        score += 70;
      }
      if (isNumericCommentCount) {
        score += 55;
      }
      if (isSummaryControl) {
        score += 45;
      }
      if (hasCommentWord) {
        score += 25;
      }
      if (control.matches('[role="button"]')) {
        score += 12;
      }
      if (control.matches('[role="link"]') || isInsideLink) {
        score -= 80;
      }
      if (inCommentThread) {
        score -= 90;
      }
      if (isLoadMoreControl) {
        score -= 60;
      }
      if (isReplyControl) {
        score -= 75;
      }
      if (text.length > 80) {
        score -= 20;
      }

      const rect = control.getBoundingClientRect();
      rankedControls.push({
        control,
        score,
        top: Number.isFinite(rect?.top) ? rect.top : Number.POSITIVE_INFINITY
      });
    }

    rankedControls.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.top - right.top;
    });

    return rankedControls[0]?.control || null;
  }

  function activateCommentControl(element) {
    if (!(element instanceof Element) || !isVisible(element)) {
      return false;
    }

    const targetCandidates = [];

    function pushCandidate(candidate) {
      if (!(candidate instanceof Element) || !isVisible(candidate) || targetCandidates.includes(candidate)) {
        return;
      }

      if (candidate.matches('a[href]') || candidate.closest('a[href]')) {
        return;
      }

      targetCandidates.push(candidate);
    }

    pushCandidate(element.querySelector('[data-ad-rendering-role="comment_button"]'));
    pushCandidate(element.querySelector('span, div'));
    pushCandidate(element);

    const roleParent = element.closest('[role="button"], [role="link"]');
    if (roleParent && roleParent !== element && !roleParent.matches('a[href]')) {
      pushCandidate(roleParent);
    }

    for (const target of targetCandidates) {
      try {
        if (typeof target.click === "function") {
          target.click();
          return true;
        }
      } catch {
        /* Ignore native click failures. */
      }

      if (pressElement(target, {
        dispatchKeyboard: false,
        dispatchSyntheticClick: true,
        dispatchNativeClick: false
      })) {
        return true;
      }
    }

    return false;
  }

  function getActiveCommentAutomationRoot(root = document) {
    if (root instanceof Element) {
      const scopedDialog = getVisiblePostDialog(root);
      if (scopedDialog && hasAutomatableDialogSignals(scopedDialog)) {
        debugCommentAutomation("resolve-root-scoped-dialog", {
          source: describeElement(root),
          resolved: describeElement(scopedDialog)
        });
        return scopedDialog;
      }

      const resolvedSurface = getCommentSurface(root);
      debugCommentAutomation("resolve-root-from-element", {
        source: describeElement(root),
        resolved: describeElement(resolvedSurface),
        canAutomateSurface: resolvedSurface ? canAutomateCommentSurface(resolvedSurface) : false
      });
      if (resolvedSurface && canAutomateCommentSurface(resolvedSurface)) {
        return resolvedSurface;
      }
    }

    const visibleDialog = getVisiblePostDialog(document);

    if (visibleDialog && hasAutomatableDialogSignals(visibleDialog)) {
      debugCommentAutomation("resolve-root-visible-dialog", {
        resolved: describeElement(visibleDialog)
      });
      return visibleDialog;
    }

    /* Restrict page-surface fallback to direct permalink/media pages. Allowing this
       on the feed reintroduces stray comment opens and random post navigation. */
    if (isDirectPostPage() || isMediaViewerPage()) {
      const blockingMediaViewerOverlay = getBlockingMediaViewerOverlay();
      if (blockingMediaViewerOverlay) {
        debugCommentAutomation("resolve-root-blocked-by-media-overlay", {
          overlay: describeElement(blockingMediaViewerOverlay)
        });
        return null;
      }

      const resolvedSurface = getCommentSurface(document);
      if (
        resolvedSurface &&
        canAutomateCommentSurface(resolvedSurface) &&
        (!isDirectPostPage() || surfaceMatchesCurrentDirectTarget(resolvedSurface))
      ) {
        debugCommentAutomation("resolve-root-page-surface", {
          resolved: describeElement(resolvedSurface)
        });
        return resolvedSurface;
      }

      if (isDirectPostPage()) {
        debugCommentAutomation("resolve-root-direct-page-not-ready", {
          currentUrl: window.location.href,
          resolved: describeElement(resolvedSurface)
        });
      }
    }

    const reelSurface = getActiveReelCommentSurface(document);
    if (reelSurface) {
      debugCommentAutomation("resolve-root-reel-surface", {
        resolved: describeElement(reelSurface)
      });
      return reelSurface;
    }

    debugCommentAutomation("resolve-root-none", {
      directPost: isDirectPostPage() || isMediaViewerPage(),
      reelPage: isReelExperiencePage()
    });

    return null;
  }

  function runCommentAutomation(root = document, deps = {}) {
    const target = getActiveCommentAutomationRoot(root);
    if (!target) {
      debugCommentAutomation("run-automation-skip", {
        reason: "no-target"
      });
      return false;
    }

    debugCommentAutomation("run-automation", {
      target: describeElement(target),
      directPost: isDirectPostPage() || isMediaViewerPage(),
      reelPage: isReelExperiencePage()
    });

    const filterState = getCommentFilterState(target);
    const activeToggle = getCommentSorterToggle(target);
    const filterUiOpen =
      (activeToggle instanceof Element && activeToggle.getAttribute("aria-expanded") === "true") ||
      !!getCommentSortMenu(target, activeToggle);
    if (filterState.interactionUntil > Date.now() && filterState.retryTimerId && filterUiOpen) {
      debugCommentAutomation("run-automation-filter-deferred", {
        target: describeElement(target)
      });
      return true;
    }

    const filterResult = ensureAllCommentsFilter(target, deps);
    debugCommentAutomation("run-automation-filter", {
      target: describeElement(target),
      filterResult
    });
    /* Wait for the sorter mutation pass before trying to expand replies; otherwise
       expansion can run against pre-filter content and miss newly rendered controls. */
    if (filterResult === "pending") {
      return true;
    }

    if (isCommentComposerActive(target)) {
      debugCommentAutomation("run-automation-skip", {
        reason: "composer-active",
        target: describeElement(target)
      });
      return false;
    }

    const expansionResult = clickCommentExpanders(target, deps);
    debugCommentAutomation("run-automation-stage", {
      target: describeElement(target),
      expansionResult
    });
    return true;
  }

  function scheduleCommentAutomationPasses(root = document, deps = {}) {
    runCommentAutomation(root, deps);

    const target = getActiveCommentAutomationRoot(root);
    if (!target || activeExpansionWatchers.has(target)) {
      return;
    }

    const watcher = watchSurfaceMutations(target, () => {
      runCommentAutomation(document, deps);
    }, { maxDuration: 6000 });

    if (watcher) {
      activeExpansionWatchers.set(target, watcher);
      window.setTimeout(() => activeExpansionWatchers.delete(target), 6500);
    }
  }

  function clickCommentExpanders(root = document, deps = {}) {
    const settings = getSettings(deps);
    if (!settings?.enableCommentExpansion) {
      return "none";
    }

    const activeDialog = getCommentSurface(root);
    if (!activeDialog || !canAutomateCommentSurface(activeDialog)) {
      return "none";
    }

    if (isCommentComposerActive(activeDialog)) {
      debugCommentAutomation("expand-comments-skip", {
        target: describeElement(activeDialog),
        reason: "composer-active"
      });
      return "pending";
    }

    const controls = getCommentActionControls(activeDialog);

    function getCommentExpansionState(surface) {
      let state = commentExpansionAttemptState.get(surface);
      if (!state) {
        state = {
          lastAttemptAt: 0,
          attempts: 0
        };
        commentExpansionAttemptState.set(surface, state);
      }

      return state;
    }

    const expansionState = getCommentExpansionState(activeDialog);
    const now = Date.now();
    const onDirectPostPage = isDirectPostPage() || isMediaViewerPage() || isReelCommentSurface(activeDialog);
    const isDialogSurface = activeDialog.matches('[role="dialog"]');

    function getCommentExpanderKind(control) {
      const text = normalizeText(control?.textContent || control?.getAttribute?.("aria-label"));
      if (!text) {
        return "other";
      }

      const isReplyControl = /\brepl(?:y|ies)\b|\bresponses?\b/.test(text);

      const isLoadMoreCommentControl =
        uiMatchers.loadMoreCommentRegex.test(text) ||
        uiMatchers.moreCommentRegex.test(text) ||
        /^(?:view|see|show)\s+(?:more\s+|all\s+)?(?:comments?|replies?|responses?)$/i.test(text);
      if (isLoadMoreCommentControl) {
        return isReplyControl ? "replyLoadMore" : "loadMore";
      }

      const isCommentSummaryControl =
        uiMatchers.commentSummaryRegex.test(text) ||
        /^(?:show|view|see)\s+(?:comments?|replies?|responses?)$/i.test(text);
      if (isCommentSummaryControl) {
        return isReplyControl ? "replySummary" : "summary";
      }

      return "other";
    }

    const hasExplicitLoadMoreControl = controls.some((control) => {
      const kind = getCommentExpanderKind(control);
      return kind === "loadMore" || kind === "replyLoadMore";
    });
    const expansionCooldown = hasExplicitLoadMoreControl
      ? 70
      : 170;
    const maxExpansionAttempts = 1;

    if (now - expansionState.lastAttemptAt > Math.max(700, expansionCooldown * 4)) {
      expansionState.attempts = 0;
    }

    if (expansionState.attempts >= maxExpansionAttempts && now - expansionState.lastAttemptAt < expansionCooldown) {
      debugCommentAutomation("expand-comments-skip", {
        target: describeElement(activeDialog),
        reason: "throttled",
        attempts: expansionState.attempts,
        msSinceLastAttempt: now - expansionState.lastAttemptAt
      });
      return "pending";
    }

    function hasVisibleCommentComposer(host) {
      return !!host.querySelector('[contenteditable="true"][role="textbox"], textarea');
    }

    function hasRenderedCommentThread(host) {
      if (!(host instanceof Element)) {
        return false;
      }

      const commentArticles = [...host.querySelectorAll('div[role="article"]')].filter((article) => {
        return article.querySelector('[data-ad-rendering-role="profile_name"], a[role="link"]');
      });

      return commentArticles.length >= 2 || !!host.querySelector('[role="list"] [role="article"], [aria-live] [role="article"]');
    }

    function hasInlineCommentUi(host) {
      if (!(host instanceof Element)) {
        return false;
      }

      return (
        hasRenderedCommentThread(host) ||
        hasVisibleCommentComposer(host) ||
        !!getCommentSorterToggle(host) ||
        !!host.querySelector('[role="list"], [aria-live], ul, ol')
      );
    }

    function hasCommentContext(control) {
      const host = control.closest('[role="dialog"], div[role="article"], [data-pagelet], main, [role="main"], [role="complementary"]') || document;
      const hasComposer = hasVisibleCommentComposer(host);
      const nestedArticleCount = host.querySelectorAll('div[role="article"]').length;
      const hasDiscussionRegion = !!host.querySelector('[role="list"], [role="feed"], [aria-live]');

      return hasComposer || nestedArticleCount >= 2 || hasDiscussionRegion || hasCommentSurfaceSignals(host);
    }

    function isPrimaryCommentOpener(control) {
      if (!(control instanceof Element)) {
        return false;
      }

      if (control.closest('[role="menu"], [role="toolbar"]') || control.getAttribute("aria-haspopup") === "menu") {
        return false;
      }

      const text = normalizeText(control.textContent || control.getAttribute("aria-label"));
      const hasCommentMarker = !!control.querySelector('[data-ad-rendering-role="comment_button"]');
      const hasCommentWord = /\bcomments?\b|\breplies?\b/.test(text);

      return hasCommentMarker || hasCommentWord;
    }

    function activateCommentExpanderControl(control) {
      if (!(control instanceof Element) || !isVisible(control)) {
        return false;
      }

      const targets = [];

      function pushTarget(candidate) {
        if (!(candidate instanceof Element) || !isVisible(candidate) || targets.includes(candidate)) {
          return;
        }

        targets.push(candidate);
      }

      const labelTargets = [control, ...control.querySelectorAll("span, div")]
        .filter((candidate) => candidate instanceof Element)
        .filter((candidate) => isVisible(candidate))
        .filter((candidate) => {
          const text = normalizeText(candidate.textContent || candidate.getAttribute("aria-label"));
          return !!text && text.length <= 64;
        })
        .sort((left, right) => {
          const leftText = normalizeText(left.textContent || left.getAttribute("aria-label"));
          const rightText = normalizeText(right.textContent || right.getAttribute("aria-label"));
          return leftText.length - rightText.length;
        });

      pushTarget(control.closest('[role="button"], [role="link"], [tabindex]'));
      if (!isDialogSurface) {
        pushTarget(labelTargets[0]);
      }
      pushTarget(control);

      for (const target of targets) {
        if (isDialogSurface && target.closest('a[href]')) {
          continue;
        }

        try {
          if (typeof target.click === "function") {
            target.click();
            return true;
          }
        } catch {
          /* Ignore native click failures. */
        }

        if (pressElement(target, {
          dispatchKeyboard: false,
          dispatchSyntheticClick: true,
          dispatchNativeClick: true
        })) {
          return true;
        }
      }

      return false;
    }

    function isLikelyCommentExpander(control) {
      if (!hasCommentContext(control)) {
        return false;
      }

      const inCommentThread = !!control.closest('[role="list"], [aria-live], ul, ol');
      if (control.closest('[role="toolbar"]')) {
        return false;
      }

      if (control.closest('[role="menu"]')) {
        return false;
      }

      if (control.getAttribute("aria-haspopup") === "menu") {
        return false;
      }

      const text = normalizeText(control.textContent || control.getAttribute("aria-label"));
      if (!text || text.length > 140) {
        return false;
      }

      const controlKind = getCommentExpanderKind(control);
      const isCommentSummaryControl = controlKind === "summary" || controlKind === "replySummary";
      const isLoadMoreCommentControl = controlKind === "loadMore" || controlKind === "replyLoadMore";

      if (
        isDialogSurface &&
        !hasInlineCommentUi(activeDialog) &&
        isPrimaryCommentOpener(control)
      ) {
        return false;
      }

      if (
        onDirectPostPage &&
        !hasRenderedCommentThread(activeDialog) &&
        !hasVisibleCommentComposer(activeDialog) &&
        isPrimaryCommentOpener(control)
      ) {
        return true;
      }

      if (!inCommentThread && !isCommentSummaryControl && !isLoadMoreCommentControl) {
        return false;
      }

      if (control.hasAttribute("aria-label") && !isCommentSummaryControl && !isLoadMoreCommentControl) {
        return false;
      }

      if (isCommentSummaryControl || isLoadMoreCommentControl) {
        return true;
      }

      /* Only reject icon-only buttons for "other" kind controls. Verified comment
         expanders (summary/loadMore) often contain a decorative SVG chevron alongside
         their text and should not be blocked by this check. */
      if (control.querySelector("svg, img, video")) {
        return false;
      }

      const hasNumericHint = /\d/.test(text);
      if (!hasNumericHint || text.length < 6) {
        return false;
      }

      return true;
    }

    /* Do not auto-click the generic primary comment opener on direct post pages.
       Even when the resolved surface matches the current target URL, Facebook can
       still route that opener through navigation-style handlers that reopen a post,
       stack dialogs, or land on the parent group feed instead of expanding inline
       comments. Only act on comment UI that is already rendered inline. */
    const directPostPrimaryOpener = null;

    const prioritizedControls = [
      ...controls.filter((control) => getCommentExpanderKind(control) === "replyLoadMore"),
      ...controls.filter((control) => getCommentExpanderKind(control) === "loadMore"),
      ...controls.filter((control) => getCommentExpanderKind(control) === "replySummary"),
      ...controls.filter((control) => getCommentExpanderKind(control) === "summary"),
      ...controls.filter((control) => getCommentExpanderKind(control) === "other")
    ];

    let expanded = false;
    for (const control of prioritizedControls) {
      const retryableDirectOpener = control === directPostPrimaryOpener;
      const controlText = normalizeText(control.textContent || control.getAttribute("aria-label"));
      const controlKind = getCommentExpanderKind(control);
      const isRepeatableControl =
        controlKind === "loadMore" ||
        controlKind === "replyLoadMore" ||
        controlKind === "replySummary";
      const isInsideLink = !!control.closest('a[href]');
      const navigationHref = getControlNavigationHref(control);
      let isBlockedLink = false;

      if (isInsideLink || navigationHref) {
        try {
          const resolved = new URL(navigationHref, window.location.href).href;
          const isExactSelfLink = resolved === window.location.href;
          const isInlineCommentLink = controlKind !== "other" && !isLikelyPostNavigationHref(resolved);
          const allowDialogInlineLink = isDialogSurface && isInlineCommentLink;
          if (!isExactSelfLink && !isInlineCommentLink) {
            isBlockedLink = true;
          }
          debugCommentAutomation(
            isBlockedLink
              ? "expander-skip-nonself-link"
              : allowDialogInlineLink
                ? "expander-allow-dialog-inline-link"
              : isExactSelfLink
                ? "expander-allow-exact-self-link"
                : "expander-allow-inline-comment-link",
            {
              control: describeElement(control),
              controlKind,
              navigationHref,
              resolved,
              current: window.location.href
            }
          );
        } catch {
          isBlockedLink = true;
          debugCommentAutomation("expander-skip-link-parse-error", {
            control: describeElement(control),
            controlKind,
            navigationHref,
            current: window.location.href
          });
        }

        if (isBlockedLink) {
          continue;
        }
      }

      if ((!retryableDirectOpener && !isRepeatableControl && clickedElements.has(control)) || !isVisible(control)) {
        debugCommentAutomation("expander-skip-clicked-or-invisible", { control: describeElement(control) });
        continue;
      }
      if (directPostPrimaryOpener && control !== directPostPrimaryOpener) {
        debugCommentAutomation("expander-skip-not-primary", { control: describeElement(control) });
        continue;
      }
      if (!isLikelyCommentExpander(control)) {
        debugCommentAutomation("expander-skip-not-likely", { control: describeElement(control) });
        continue;
      }
      if (!(retryableDirectOpener ? activateCommentControl(control) : activateCommentExpanderControl(control))) {
        debugCommentAutomation("expander-skip-activation-failed", { control: describeElement(control) });
        continue;
      }
      if (!retryableDirectOpener && !isRepeatableControl) {
        clickedElements.add(control);
      }
      expansionState.lastAttemptAt = now;
      expansionState.attempts += 1;
      debugCommentAutomation("expand-comments-click", {
        target: describeElement(activeDialog),
        control: describeElement(control),
        controlText,
        controlKind
      });
      queueStatIncrement(deps, "expandedComments");
      expanded = true;
      break;
    }

    if (!expanded) {
      debugCommentAutomation("expand-comments-no-match", {
        target: describeElement(activeDialog),
        controlCount: controls.length,
        hasDirectPostPrimaryOpener: !!directPostPrimaryOpener
      });
      return "none";
    }

    if (!activeExpansionWatchers.has(activeDialog)) {
      const watcher = watchSurfaceMutations(activeDialog, () => {
        runCommentAutomation(document, deps);
      }, { maxDuration: expansionCooldown + 2000 });

      if (watcher) {
        activeExpansionWatchers.set(activeDialog, watcher);
        const duration = expansionCooldown + 2500;
        window.setTimeout(() => activeExpansionWatchers.delete(activeDialog), duration);
      }
    }

    return "expanded";
  }

  globalThis.FacebergCommentsRuntime = Object.freeze({
    isDirectPostPage,
    isDirectPostDomReady,
    isMediaViewerPage,
    isReelExperiencePage,
    getActiveReelCommentSurface,
    getBlockingMediaViewerOverlay,
    getVisiblePostDialog,
    hasPostDialogSignals,
    hasCommentSurfaceSignals,
    runCommentAutomation,
    scheduleCommentAutomationPasses
  });
})();