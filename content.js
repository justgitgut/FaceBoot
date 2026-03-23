(() => {
  "use strict";

  if (window.__facebergContentScriptInstalled) {
    return;
  }

  window.__facebergContentScriptInstalled = true;

  const DEFAULT_SETTINGS = {
    enableAntiRefresh: true,
    enableFeedFilter: true,
    enablePostExpansion: true,
    enableCommentExpansion: true,
    enableBlockReels: true,
    enableBlockPeopleYouMayKnow: true,
    enableBlockFollowPosts: true,
    enableBlockJoinPosts: true,
    enableGoDirectlyToFeeds: false
  };
  const sharedStats = globalThis.FacebergStats || {};
  const STATS_DEFAULTS = sharedStats.DEFAULT_STATS || {
    removedReels: 0,
    removedFollowPosts: 0,
    removedJoinPosts: 0,
    removedStories: 0,
    removedPeopleYouMayKnow: 0,
    removedSponsored: 0,
    preventedRefreshes: 0,
    commentFilterChanges: 0,
    expandedPosts: 0,
    expandedComments: 0
  };
  const SESSION_STATS_DEFAULTS = sharedStats.SESSION_STATS_DEFAULTS || {
    sessionRemovedReels: 0,
    sessionRemovedFollowPosts: 0,
    sessionRemovedJoinPosts: 0,
    sessionRemovedStories: 0,
    sessionRemovedPeopleYouMayKnow: 0,
    sessionRemovedSponsored: 0,
    sessionPreventedRefreshes: 0,
    sessionCommentFilterChanges: 0,
    sessionExpandedPosts: 0,
    sessionExpandedComments: 0
  };
  const STARTUP_STABILIZATION_DELAYS_MS = [120, 400, 1200];
  const POST_EXPANDER_MAX_ATTEMPTS = 4;
  const POST_EXPANDER_RETRY_COOLDOWN_MS = 250;
  const getSessionStatKey = sharedStats.toSessionKey || ((statKey) => `session${statKey.charAt(0).toUpperCase()}${statKey.slice(1)}`);
  let settings = { ...DEFAULT_SETTINGS };
  let antiRefreshInjected = false;
  let statsFlushTimer = null;
  let extensionContextValid = true;
  let automationSuppressedUntil = 0;
  const pendingStatIncrements = {};
  /* Facebook may render a valid See more button before its live click handler is
     attached. Track bounded retries instead of permanently suppressing the first
     no-op press during startup hydration. */
  const postExpanderAttemptState = new WeakMap();
  let lastObservedUrl = window.location.href;
  const contentUtils = globalThis.FacebergContentUtils;
  if (!contentUtils) {
    return;
  }
  const {
    uiMatchers,
    normalizeText,
    isPostActionControl,
    hasPostActionControl,
    isVisible,
    pressElement
  } = contentUtils;
  const contentFeed = globalThis.FacebergFeedRuntime;
  if (!contentFeed) {
    return;
  }
  const contentComments = globalThis.FacebergCommentsRuntime;
  if (!contentComments) {
    return;
  }
  const runtimeDeps = {
    getSettings: () => settings,
    queueStatIncrement
  };

  function isDirectPostPage() {
    return contentComments.isDirectPostPage();
  }

  function isMediaViewerPage() {
    return contentComments.isMediaViewerPage();
  }

  function getActiveReelCommentSurface(root = document) {
    return contentComments.getActiveReelCommentSurface?.(root) || null;
  }

  function getVisiblePostDialog(root = document) {
    return contentComments.getVisiblePostDialog(root);
  }

  function getBlockingMediaViewerOverlay() {
    return contentComments.getBlockingMediaViewerOverlay?.() || null;
  }

  function getVisibleNotificationSurface(root = document) {
    return contentComments.getVisibleNotificationSurface?.(root) || null;
  }

  function isNotificationInteraction(target) {
    return contentComments.isNotificationInteraction?.(target) || false;
  }

  function hasPostDialogSignals(surface) {
    return contentComments.hasPostDialogSignals(surface);
  }

  function hasCommentSurfaceSignals(surface) {
    return contentComments.hasCommentSurfaceSignals(surface);
  }

  function getDirectPageExpansionRoot(root = document) {
    const scopeElement = root instanceof Element ? root : document.body;
    const selectors = isMediaViewerPage()
      ? ['[role="complementary"]', 'div[role="article"]', '[data-pagelet]', 'main', '[role="main"]']
      : ['div[role="article"]', '[data-pagelet]', 'main', '[role="main"]'];

    for (const selector of selectors) {
      const scopedMatch = scopeElement instanceof Element
        ? scopeElement.closest(selector) || scopeElement.querySelector?.(selector)
        : null;
      if (scopedMatch instanceof Element && isVisible(scopedMatch)) {
        return scopedMatch;
      }

      const documentMatch = document.querySelector(selector);
      if (documentMatch instanceof Element && isVisible(documentMatch)) {
        return documentMatch;
      }
    }

    return root;
  }

  function runCommentAutomation(root = document) {
    return contentComments.runCommentAutomation(root, runtimeDeps);
  }

  function scheduleCommentAutomationPasses(root = document) {
    return contentComments.scheduleCommentAutomationPasses(root, runtimeDeps);
  }

  function suppressAutomationFor(ms) {
    const nextUntil = Date.now() + Math.max(0, Number(ms) || 0);
    if (nextUntil > automationSuppressedUntil) {
      automationSuppressedUntil = nextUntil;
    }
  }

  function shouldSuppressAutomation(root = document) {
    if (Date.now() < automationSuppressedUntil) {
      return true;
    }

    return !!getVisibleNotificationSurface(root);
  }

  function runFeedCleanup(root = document) {
    return contentFeed.runFeedCleanup(root, runtimeDeps);
  }

  /* Mutation-driven scheduling infrastructure.
     Instead of hardcoded setTimeout delays, we watch for actual DOM
     mutations and react as soon as changes land. */
  let pendingRunAllFrame = 0;
  let pendingAutomationFrame = 0;
  let pendingRunAllRoot = null;
  let startupPassTimeouts = [];

  function debouncedRunAll(root = document) {
    if (root instanceof Element) {
      pendingRunAllRoot = root;
    } else if (!(pendingRunAllRoot instanceof Element)) {
      pendingRunAllRoot = document;
    }

    if (pendingRunAllFrame) return;
    pendingRunAllFrame = requestAnimationFrame(() => {
      const nextRoot = pendingRunAllRoot || document;
      pendingRunAllRoot = null;
      pendingRunAllFrame = 0;
      runAll(nextRoot);
    });
  }

  function debouncedCommentAutomation() {
    if (pendingAutomationFrame) return;
    pendingAutomationFrame = requestAnimationFrame(() => {
      pendingAutomationFrame = 0;
      runCommentAutomation(document);
    });
  }

  function scheduleStartupStabilizationPasses() {
    startupPassTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    startupPassTimeouts = [];

    STARTUP_STABILIZATION_DELAYS_MS.forEach((delay) => {
      const timeoutId = window.setTimeout(() => {
        startupPassTimeouts = startupPassTimeouts.filter((value) => value !== timeoutId);
        if (document.visibilityState === "visible") {
          debouncedRunAll(document);
        }
      }, delay);
      startupPassTimeouts.push(timeoutId);
    });
  }

  async function readSettings() {
    if (!canUseExtensionApis()) {
      return { ...DEFAULT_SETTINGS };
    }

    const [syncResult, localResult] = await Promise.allSettled([
      chrome.storage.sync.get(DEFAULT_SETTINGS),
      chrome.storage.local.get(DEFAULT_SETTINGS)
    ]);

    const syncSettings = syncResult.status === "fulfilled" ? syncResult.value : {};
    const localSettings = localResult.status === "fulfilled" ? localResult.value : {};

    return {
      ...DEFAULT_SETTINGS,
      ...localSettings,
      ...syncSettings
    };
  }

  function markExtensionContextInvalid(error) {
    const message = String(error?.message || error || "");
    if (/Extension context invalidated|Receiving end does not exist|message port closed|No tab with id|Cannot access contents/i.test(message)) {
      extensionContextValid = false;
    }
  }

  function canUseExtensionApis() {
    return extensionContextValid &&
      typeof chrome !== "undefined" &&
      !!chrome.runtime?.id &&
      !!chrome.storage?.local;
  }

  function injectMainWorldScript() {
    if (antiRefreshInjected || !settings.enableAntiRefresh || !canUseExtensionApis()) {
      return;
    }

    const existingScript = document.querySelector('script[data-faceberg-main-world="true"]');
    if (existingScript) {
      antiRefreshInjected = true;
      return;
    }

    const script = document.createElement("script");
    try {
      script.src = chrome.runtime.getURL("injected.js");
    } catch (error) {
      markExtensionContextInvalid(error);
      return;
    }
    script.async = false;
    script.dataset.facebergMainWorld = "true";
    script.addEventListener("load", () => script.remove(), { once: true });
    script.addEventListener("error", () => script.remove(), { once: true });
    (document.documentElement || document.head || document.body).appendChild(script);
    antiRefreshInjected = true;
  }

  function requestTabProtection() {
    if (!settings.enableAntiRefresh || !canUseExtensionApis()) {
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: "faceberg:protect-tab" }).catch((error) => {
        markExtensionContextInvalid(error);
        /* Ignore transient service-worker wakeup or messaging failures. */
      });
    } catch (error) {
      markExtensionContextInvalid(error);
    }
  }

  function queueStatIncrement(statKey, delta = 1) {
    if (!statKey || !Number.isFinite(delta) || delta <= 0) {
      return;
    }

    pendingStatIncrements[statKey] = (pendingStatIncrements[statKey] || 0) + delta;

    if (statsFlushTimer !== null) {
      return;
    }

    statsFlushTimer = window.setTimeout(() => {
      statsFlushTimer = null;
      flushStats().catch(() => {
        /* Ignore storage write failures. */
      });
    }, 250);
  }

  async function flushStats() {
    if (!canUseExtensionApis()) {
      return;
    }

    const keys = Object.keys(pendingStatIncrements);
    if (keys.length === 0) {
      return;
    }

    const increments = {};
    keys.forEach((key) => {
      increments[key] = pendingStatIncrements[key];
      delete pendingStatIncrements[key];
    });

    let current;
    try {
      current = await chrome.storage.local.get({
        ...STATS_DEFAULTS,
        ...SESSION_STATS_DEFAULTS
      });
    } catch (error) {
      markExtensionContextInvalid(error);
      return;
    }
    const next = {};

    Object.keys(STATS_DEFAULTS).forEach((key) => {
      const base = Number(current[key] || 0);
      const delta = Number(increments[key] || 0);
      next[key] = base + delta;
    });

    Object.keys(STATS_DEFAULTS).forEach((totalKey) => {
      const sessionKey = getSessionStatKey(totalKey);
      const base = Number(current[sessionKey] || 0);
      const delta = Number(increments[totalKey] || 0);
      next[sessionKey] = base + delta;
    });

    try {
      await chrome.storage.local.set(next);
    } catch (error) {
      markExtensionContextInvalid(error);
    }
  }

  function expandPostBodies(root = document) {
    if (!settings.enablePostExpansion) {
      return;
    }

    const scope = root instanceof Element
      ? root.closest(
        '[data-ad-rendering-role="story_message"], [data-ad-rendering-role="story_body"], div[role="article"], [data-pagelet*="FeedUnit"], [aria-posinset], [data-virtualized]'
      ) || root
      : document;
    const isDialogScope = scope instanceof Element && scope.matches('[role="dialog"]');
    const isDocumentPass = scope === document;
    const maxPriorityClicks = isDocumentPass ? 12 : 4;
    const maxGenericClicks = isDialogScope ? 0 : (isDocumentPass ? 4 : 2);
    const prioritizedCandidateSelector = isDialogScope
      ? '[data-ad-rendering-role="story_message"] [role="button"][tabindex], [data-ad-rendering-role="story_body"] [role="button"][tabindex]'
      : '[data-ad-rendering-role="story_message"] [role="button"][tabindex], [data-ad-rendering-role="story_body"] [role="button"][tabindex], [data-ad-comet-preview="message"] [role="button"][tabindex]';
    const prioritizedCandidates = scope.querySelectorAll(prioritizedCandidateSelector);
    const genericCandidates = isDialogScope
      ? []
      : scope.querySelectorAll('[role="button"][tabindex]');
    const candidates = [];
    const seenCandidates = new Set();
    let priorityClicksThisRun = 0;
    let genericClicksThisRun = 0;

    function getPostExpanderAttemptState(button) {
      return postExpanderAttemptState.get(button) || { attempts: 0, lastAttemptAt: 0 };
    }

    function canAttemptPostExpander(button) {
      const { attempts, lastAttemptAt } = getPostExpanderAttemptState(button);
      if (attempts === 0) {
        return true;
      }

      if (attempts >= POST_EXPANDER_MAX_ATTEMPTS) {
        return false;
      }

      return (Date.now() - lastAttemptAt) >= POST_EXPANDER_RETRY_COOLDOWN_MS;
    }

    function markPostExpanderAttempt(button) {
      const { attempts } = getPostExpanderAttemptState(button);
      postExpanderAttemptState.set(button, {
        attempts: attempts + 1,
        lastAttemptAt: Date.now()
      });
    }

    function hasInlineSeeMoreLabel(button, normalizedButtonText = "") {
      if (!(button instanceof Element)) {
        return false;
      }

      const storyContainer = button.closest('[data-ad-rendering-role="story_message"], [data-ad-rendering-role="story_body"], [data-ad-comet-preview="message"]');
      if (!storyContainer) {
        return false;
      }

      const inlineTextContainer = button.parentElement;
      const inlineText = normalizeText(inlineTextContainer?.textContent || normalizedButtonText);
      if (!inlineText || !/(?:^|[\s.,!?;:()\[\]{}])see more(?=$|[\s.,!?;:()\[\]{}…])/iu.test(inlineText)) {
        return false;
      }

      return inlineText.includes("...") || inlineText.includes("…") || /line-clamp|webkit-box/i.test(inlineTextContainer?.getAttribute("style") || "");
    }

    function pushCandidate(button, priority) {
      if (!(button instanceof Element) || seenCandidates.has(button)) {
        return;
      }

      seenCandidates.add(button);
      candidates.push({ button, priority });
    }

    prioritizedCandidates.forEach((button) => {
      const text = normalizeText(button.textContent || button.getAttribute("aria-label"));
      if (uiMatchers.seeMoreRegex.test(text) || hasInlineSeeMoreLabel(button, text)) {
        pushCandidate(button, "priority");
      }
    });
    genericCandidates.forEach((button) => pushCandidate(button, "generic"));

    function isLikelyPostExpander(button) {
      if (!isVisible(button) || !canAttemptPostExpander(button)) {
        return false;
      }

      if (button.getAttribute("tabindex") !== "0" || button.getAttribute("aria-hidden") === "true") {
        return false;
      }

      if (button.closest('[role="menu"], [role="toolbar"]')) {
        return false;
      }

      const closestMenuButton = button.closest('[role="button"][aria-haspopup="menu"]');
      if (isPostActionControl(closestMenuButton)) {
        return false;
      }

      if (button.getAttribute("aria-haspopup") === "menu") {
        return false;
      }

      if (button.querySelector('svg, img, video')) {
        return false;
      }

      const text = normalizeText(button.textContent || button.getAttribute("aria-label"));
      if (!uiMatchers.seeMoreRegex.test(text) && !hasInlineSeeMoreLabel(button, text)) {
        return false;
      }

      const storyMessage = button.closest('[data-ad-rendering-role="story_message"], [data-ad-rendering-role="story_body"]');
      const previewMessage = button.closest('[data-ad-comet-preview="message"]');
      const article = button.closest(
        'div[role="article"], [data-pagelet*="FeedUnit"], [aria-posinset], [data-virtualized]'
      );
      const postContext = article || storyMessage;
      const measurementRoot = storyMessage || previewMessage || postContext;
      if (!postContext || !measurementRoot) {
        return false;
      }

      if (button.closest('[role="dialog"]') && !storyMessage && !previewMessage) {
        return false;
      }

      if (isDialogScope && !storyMessage) {
        return false;
      }

      const hasPostSignals =
        !!storyMessage ||
        hasPostActionControl(postContext) ||
        !!postContext.querySelector('[data-ad-rendering-role="story_message"], [data-ad-rendering-role="story_body"], [data-ad-rendering-role="profile_name"]') ||
        !!postContext.querySelector('h1, h2, h3, h4, [role="heading"]') ||
        !!postContext.querySelector('a[role="link"][href*="/posts/"], a[role="link"][href*="/reel/"], a[role="link"][href*="/groups/"]');

      if (!hasPostSignals) {
        return false;
      }

      if (!storyMessage && !previewMessage && button.closest('[role="list"], [aria-live], ul, ol')) {
        return false;
      }

      const inlineTextContainer = button.parentElement;
      const inlineText = normalizeText(inlineTextContainer?.textContent || "");
      const hasInlineTruncation = uiMatchers.seeMoreRegex.test(inlineText) && (inlineText.includes("...") || inlineText.includes("…"));
      const hasStoryContext =
        (!!storyMessage || !!previewMessage) &&
        !!postContext.querySelector('[data-ad-rendering-role="profile_name"], a[role="link"][href*="/groups/"], a[role="link"][href*="/posts/"]');
      const isInlineStoryMessageButton =
        (!!storyMessage || !!previewMessage) &&
        !button.querySelector('svg, img, video') &&
        (hasInlineTruncation || /line-clamp|webkit-box/i.test(inlineTextContainer?.getAttribute("style") || "") || !!button.closest('[data-ad-comet-preview="message"]'));

      if (isInlineStoryMessageButton && hasStoryContext) {
        return true;
      }

      if (!hasInlineTruncation && !hasStoryContext) {
        return false;
      }

      const buttonRect = button.getBoundingClientRect();
      const measurementRect = measurementRoot.getBoundingClientRect();
      const relativeTop = buttonRect.top - measurementRect.top;

      return relativeTop >= -160 && relativeTop < Math.max(900, measurementRect.height + 120);
    }

    for (const candidate of candidates) {
      const { button, priority } = candidate;

      if (priority === "priority" && priorityClicksThisRun >= maxPriorityClicks) {
        continue;
      }

      if (priority === "generic" && genericClicksThisRun >= maxGenericClicks) {
        continue;
      }

      if (!isLikelyPostExpander(button)) {
        continue;
      }

      if (!pressElement(button)) {
        continue;
      }

      markPostExpanderAttempt(button);
      queueStatIncrement("expandedPosts");

      if (priority === "priority") {
        priorityClicksThisRun += 1;
      } else {
        genericClicksThisRun += 1;
      }
    }
  }

  function getChronologicalGroupUrl(url = window.location.href) {
    let parsedUrl;
    try {
      parsedUrl = new URL(url, window.location.href);
    } catch {
      return null;
    }

    if (parsedUrl.origin !== window.location.origin) {
      return null;
    }

    if (!/^\/groups\/[^/?#]+\/?$/i.test(parsedUrl.pathname)) {
      return null;
    }

    if (parsedUrl.searchParams.get("sorting_setting") === "CHRONOLOGICAL") {
      return null;
    }

    parsedUrl.searchParams.set("sorting_setting", "CHRONOLOGICAL");
    return parsedUrl.toString();
  }

  function ensureChronologicalGroupUrl() {
    const nextUrl = getChronologicalGroupUrl(window.location.href);
    if (!nextUrl || nextUrl === window.location.href) {
      return false;
    }

    try {
      window.history.replaceState(window.history.state, "", nextUrl);
      lastObservedUrl = nextUrl;
      return true;
    } catch {
      return false;
    }
  }

  function runAll(root = document) {
    if (shouldSuppressAutomation(root)) {
      return;
    }

    ensureChronologicalGroupUrl();

    if (settings.enableAntiRefresh) {
      injectMainWorldScript();
      requestTabProtection();
    }

    const visibleDialog = getVisiblePostDialog(root);
    if (visibleDialog) {
      if (hasPostDialogSignals(visibleDialog) || hasCommentSurfaceSignals(visibleDialog)) {
        expandPostBodies(visibleDialog);
        scheduleCommentAutomationPasses(visibleDialog);
      }
      return;
    }

    if (isMediaViewerPage() && getBlockingMediaViewerOverlay()) {
      return;
    }

    if (isDirectPostPage()) {
      if (!contentComments.isDirectPostDomReady?.(document)) {
        return;
      }

      expandPostBodies(getDirectPageExpansionRoot(root));
      scheduleCommentAutomationPasses(document);
      return;
    }

    if (isMediaViewerPage()) {
      expandPostBodies(getDirectPageExpansionRoot(root));
      scheduleCommentAutomationPasses(document);
      return;
    }

    if (getActiveReelCommentSurface(root)) {
      scheduleCommentAutomationPasses(document);
      return;
    }

    runFeedCleanup(root);
    expandPostBodies(root);
  }

  function scheduleDocumentPasses() {
    runAll(document);
    scheduleStartupStabilizationPasses();
    /* The main MutationObserver at the end of the file reacts to
       further DOM changes. Startup stabilization adds a few short
       follow-up passes because Facebook often hydrates the first feed
       post after the initial document pass. */
  }

  async function loadSettings() {
    try {
      const stored = await readSettings();

      settings = {
        enableAntiRefresh: stored.enableAntiRefresh !== false,
        enableFeedFilter: stored.enableFeedFilter !== false,
        enablePostExpansion: stored.enablePostExpansion !== false,
        enableCommentExpansion: stored.enableCommentExpansion !== false,
        enableBlockReels: stored.enableBlockReels !== false,
        enableBlockPeopleYouMayKnow: stored.enableBlockPeopleYouMayKnow !== false,
        enableBlockFollowPosts: stored.enableBlockFollowPosts !== false,
        enableBlockJoinPosts: stored.enableBlockJoinPosts !== false,
        enableGoDirectlyToFeeds: stored.enableGoDirectlyToFeeds === true
      };
    } catch (_error) {
      settings = { ...DEFAULT_SETTINGS };
    }

    if (settings.enableAntiRefresh) {
      injectMainWorldScript();
    }

    requestTabProtection();
  }

  if (canUseExtensionApis()) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "faceberg:ping") {
        sendResponse({ ok: true });
        return false;
      }

      if (message?.type === "faceberg:rerun") {
        scheduleDocumentPasses();
        sendResponse({ ok: true });
        return false;
      }

      return false;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" && areaName !== "local") {
        return;
      }

      let shouldRerun = false;

      if (changes.enableAntiRefresh) {
        settings.enableAntiRefresh = changes.enableAntiRefresh.newValue !== false;
        if (settings.enableAntiRefresh) {
          injectMainWorldScript();
        }
        requestTabProtection();
        shouldRerun = true;
      }

      if (changes.enableFeedFilter) {
        settings.enableFeedFilter = changes.enableFeedFilter.newValue !== false;
        shouldRerun = true;
      }

      if (changes.enablePostExpansion) {
        settings.enablePostExpansion = changes.enablePostExpansion.newValue !== false;
        shouldRerun = true;
      }

      if (changes.enableCommentExpansion) {
        settings.enableCommentExpansion = changes.enableCommentExpansion.newValue !== false;
        shouldRerun = true;
      }

      if (changes.enableBlockReels) {
        settings.enableBlockReels = changes.enableBlockReels.newValue !== false;
        shouldRerun = true;
      }

      if (changes.enableBlockPeopleYouMayKnow) {
        settings.enableBlockPeopleYouMayKnow = changes.enableBlockPeopleYouMayKnow.newValue !== false;
        shouldRerun = true;
      }

      if (changes.enableBlockFollowPosts) {
        settings.enableBlockFollowPosts = changes.enableBlockFollowPosts.newValue !== false;
        shouldRerun = true;
      }

      if (changes.enableBlockJoinPosts) {
        settings.enableBlockJoinPosts = changes.enableBlockJoinPosts.newValue !== false;
        shouldRerun = true;
      }

      if (changes.enableGoDirectlyToFeeds) {
        settings.enableGoDirectlyToFeeds = changes.enableGoDirectlyToFeeds.newValue === true;
        shouldRerun = true;
      }

      if (shouldRerun) {
        runAll(document);
      }
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) {
      return;
    }

    const data = event.data;
    if (data.source !== "faceberg" || data.kind !== "stat") {
      return;
    }

    if (data.stat === "preventedRefreshes") {
      const increment = Number(data.count || 1);
      queueStatIncrement("preventedRefreshes", increment > 0 ? increment : 1);
    }
  });

  /* Run one eager pass with defaults so first-feed expansion does not wait on
     async storage reads during page startup. A second pass still runs after
     settings load to apply the persisted configuration. */
  scheduleDocumentPasses();

  loadSettings()
    .then(() => {
      scheduleDocumentPasses();
    });

  document.addEventListener("DOMContentLoaded", () => {
    scheduleDocumentPasses();
  });
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    if (isNotificationInteraction(target)) {
      suppressAutomationFor(6000);
    }
  }, true);
  window.addEventListener("load", () => {
    scheduleDocumentPasses();
  });
  window.addEventListener("pageshow", () => {
    scheduleDocumentPasses();
  });
  window.addEventListener("popstate", () => scheduleDocumentPasses());
  window.addEventListener("hashchange", () => scheduleDocumentPasses());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      scheduleDocumentPasses();
    }
  });

  const observer = new MutationObserver((mutations) => {
    let hasNewElements = false;
    let addedDialog = null;
    for (const mutation of mutations) {
      if (mutation.type !== "childList") continue;
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          hasNewElements = true;

          const element = node;
          if (element instanceof Element) {
            if (element.matches('[role="dialog"]')) {
              addedDialog = element;
            } else {
              const nestedDialog = element.querySelector?.('[role="dialog"]');
              if (nestedDialog instanceof Element) {
                addedDialog = nestedDialog;
              }
            }
          }
        }
      }
    }
    if (!hasNewElements) return;

    /* Prefer the exact newly added dialog when Facebook opens comments/photo UI.
       A broad document rescan here can reselect stale dialogs that are still visible underneath. */
    if (addedDialog && isVisible(addedDialog)) {
      debouncedRunAll(addedDialog);
      return;
    }

    debouncedRunAll(document);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  /* Fallback heartbeat catches edge cases the MutationObserver may miss,
     such as SPA navigation that only changes the URL without DOM mutations. */
  window.setInterval(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastObservedUrl) {
      lastObservedUrl = currentUrl;
      if (Date.now() < automationSuppressedUntil) {
        suppressAutomationFor(2500);
      }
      debouncedRunAll();
      return;
    }

    if (document.visibilityState === "visible") {
      debouncedRunAll();
    }
  }, 8000);
})();
