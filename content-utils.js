(() => {
  "use strict";

  if (globalThis.FacebergContentUtils) {
    return;
  }

  function normalizeText(value) {
    return (value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildAlternation(values) {
    return values.map((value) => escapeRegExp(value)).join("|");
  }

  function createPhraseRegex(values, { exact = false, allowTrailingPunctuation = false } = {}) {
    const filteredValues = values.filter(Boolean);
    if (filteredValues.length === 0) {
      return /$a/;
    }

    const pattern = buildAlternation(filteredValues);
    if (exact) {
      const suffix = allowTrailingPunctuation ? String.raw`(?:[\s.,!?;:()\[\]{}…]+)?` : "";
      return new RegExp(`^(?:${pattern})${suffix}$`, "iu");
    }

    return new RegExp(`(?:^|\\s|[.,!?;:()\\[\\]{}])(?:${pattern})(?=$|\\s|[.,!?;:()\\[\\]{}])`, "iu");
  }

  const ENGLISH_UI_DICTIONARY = {
    seeMoreLabels: ["see more"],
    actionMenuLabels: ["actions for this post"],
    commentWords: ["comment", "comments", "reply", "replies", "response", "responses"],
    loadMoreVerbs: ["view", "see", "show"],
    moreWords: ["more"],
    sortKeywords: ["most relevant", "relevant", "all comments", "comments", "newest", "oldest", "top", "recent", "sorted", "all", "most"],
    allCommentsLabels: ["all comments"]
  };

  function getUiMatchers() {
    const commentWordsPattern = buildAlternation(ENGLISH_UI_DICTIONARY.commentWords);
    const loadMoreVerbsPattern = buildAlternation(ENGLISH_UI_DICTIONARY.loadMoreVerbs);
    const moreWordsPattern = buildAlternation(ENGLISH_UI_DICTIONARY.moreWords);

    return {
      seeMoreRegex: createPhraseRegex(ENGLISH_UI_DICTIONARY.seeMoreLabels, { exact: true, allowTrailingPunctuation: true }),
      actionMenuRegex: createPhraseRegex(ENGLISH_UI_DICTIONARY.actionMenuLabels, { exact: true }),
      commentSummaryRegex: new RegExp(
        `\\d[\\d.,\\s]*\\s+(?:${commentWordsPattern})(?=$|\\s|[.,!?;:()\\[\\]{}])`,
        "iu"
      ),
      loadMoreCommentRegex: new RegExp(
        `(?:${loadMoreVerbsPattern})(?:[\\s\\S]{0,80}?)(?:${commentWordsPattern})`,
        "iu"
      ),
      moreCommentRegex: new RegExp(
        `(?:${moreWordsPattern})(?:\\s+de|\\s+of|\\s+di|\\s+من)?\\s+(?:${commentWordsPattern})`,
        "iu"
      ),
      allCommentsRegex: createPhraseRegex(ENGLISH_UI_DICTIONARY.allCommentsLabels)
    };
  }

  const uiMatchers = getUiMatchers();

  function getSpecificSortLabels() {
    const excludedLabels = new Set([
      ...ENGLISH_UI_DICTIONARY.commentWords,
      ...ENGLISH_UI_DICTIONARY.moreWords,
      ...ENGLISH_UI_DICTIONARY.loadMoreVerbs,
      "all",
      "most",
      "comments",
      "comment",
      "replies",
      "reply"
    ].map((value) => normalizeText(value)));

    return ENGLISH_UI_DICTIONARY.sortKeywords
      .map((value) => normalizeText(value))
      .filter((value) => value)
      .filter((value) => value.includes(" ") || !excludedLabels.has(value));
  }

  const specificSortLabels = getSpecificSortLabels();

  function matchesSorterToggleText(text) {
    const normalizedText = normalizeText(text);
    if (!normalizedText || normalizedText.length < 4 || normalizedText.length > 48 || /\d/.test(normalizedText)) {
      return false;
    }

    if (uiMatchers.allCommentsRegex.test(normalizedText)) {
      return true;
    }

    return specificSortLabels.some((label) => normalizedText === label || normalizedText.startsWith(`${label} `));
  }

  function isPostActionControl(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    if (element.getAttribute("aria-haspopup") !== "menu") {
      return false;
    }

    const text = normalizeText(element.textContent || element.getAttribute("aria-label"));
    return !!text && uiMatchers.actionMenuRegex.test(text);
  }

  function hasPostActionControl(root) {
    if (!(root instanceof Element)) {
      return false;
    }

    return [...root.querySelectorAll('[role="button"][aria-haspopup="menu"]')].some((control) => {
      return isPostActionControl(control);
    });
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function hasHiddenFocusAncestor(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    return !!element.closest('[aria-hidden="true"], [inert]');
  }

  function focusElementSafely(element) {
    if (!(element instanceof Element) || hasHiddenFocusAncestor(element)) {
      return false;
    }

    try {
      if (typeof element.focus === "function") {
        element.focus({ preventScroll: true });
        return true;
      }
    } catch {
      // Ignore focus failures.
    }

    return false;
  }

  function pressElement(element, options = {}) {
    if (!(element instanceof Element) || !isVisible(element)) {
      return false;
    }

    const {
      dispatchKeyboard = true,
      dispatchSyntheticClick = true,
      dispatchNativeClick = true
    } = options;

    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.min(Math.max(rect.width / 2, 1), Math.max(rect.width - 1, 1));
    const clientY = rect.top + Math.min(Math.max(rect.height / 2, 1), Math.max(rect.height - 1, 1));
    const pointerOptions = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      view: window
    };
    const mouseOptions = {
      bubbles: true,

      function getRuntimeSettings(deps) {
        return typeof deps?.getSettings === "function"
          ? deps.getSettings()
          : deps?.settings;
      }

      function queueRuntimeStatIncrement(deps, statKey, delta = 1) {
        if (typeof deps?.queueStatIncrement === "function") {
          deps.queueStatIncrement(statKey, delta);
        }
      }
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      view: window
    };

    focusElementSafely(element);

    if (typeof PointerEvent === "function") {
      element.dispatchEvent(new PointerEvent("pointerover", { ...pointerOptions, buttons: 0 }));
      element.dispatchEvent(new PointerEvent("pointerenter", { ...pointerOptions, bubbles: false, buttons: 0 }));
      element.dispatchEvent(new PointerEvent("pointermove", { ...pointerOptions, buttons: 0 }));
      element.dispatchEvent(new PointerEvent("pointerdown", pointerOptions));
      element.dispatchEvent(new PointerEvent("pointerup", { ...pointerOptions, buttons: 0 }));
    }

    element.dispatchEvent(new MouseEvent("mouseover", { ...mouseOptions, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("mouseenter", { ...mouseOptions, bubbles: false, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("mousemove", { ...mouseOptions, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("mousedown", mouseOptions));
    element.dispatchEvent(new MouseEvent("mouseup", { ...mouseOptions, buttons: 0 }));
    if (dispatchSyntheticClick) {
      element.dispatchEvent(new MouseEvent("click", { ...mouseOptions, buttons: 0 }));
    }

    if (dispatchKeyboard) {
      element.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: "Enter",
        code: "Enter"
      }));
      element.dispatchEvent(new KeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        composed: true,
        key: "Enter",
        code: "Enter"
      }));
    }

    if (dispatchNativeClick) {
      try {
        if (typeof element.click === "function") {
          element.click();
        }
      } catch {
        // Ignore native click failures.
      }
    }

    return true;
  }

  globalThis.FacebergContentUtils = Object.freeze({
    ENGLISH_UI_DICTIONARY,
    uiMatchers,
    normalizeText,
    escapeRegExp,
    buildAlternation,
    createPhraseRegex,
    matchesSorterToggleText,
    isPostActionControl,
    hasPostActionControl,
    isVisible,
    pressElement,
    getRuntimeSettings,
    queueRuntimeStatIncrement
  });
})();