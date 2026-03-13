(() => {
  "use strict";

  const DEFAULT_SETTINGS = {
    enableAntiRefresh: false,
    enableFeedFilter: true,
    enablePostExpansion: true,
    enableCommentExpansion: true,
    enableBlockReels: true,
    enableBlockPeopleYouMayKnow: true,
    enableBlockFollowPosts: true,
    enableBlockJoinPosts: true,
    enableGoDirectlyToFeeds: false
  };
  const sharedStats = globalThis.FaceBootStats || {};
  const STATS_DEFAULTS = sharedStats.DEFAULT_STATS || {
    removedReels: 0,
    removedFollowPosts: 0,
    removedJoinPosts: 0,
    removedStories: 0,
    removedPeopleYouMayKnow: 0,
    removedSponsored: 0,
    preventedRefreshes: 0,
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
    sessionExpandedPosts: 0,
    sessionExpandedComments: 0
  };
  const getSessionStatKey = sharedStats.toSessionKey || ((statKey) => `session${statKey.charAt(0).toUpperCase()}${statKey.slice(1)}`);
  let settings = { ...DEFAULT_SETTINGS };

  async function readSettings() {
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

  let antiRefreshInjected = false;
  let statsFlushTimer = null;
  const pendingStatIncrements = {};
  const clickedElements = new WeakSet();
  const clickedPostExpanders = new WeakSet();
  const clickedSorterMenus = new WeakMap();
  const removedFeedElements = new WeakSet();
  let cachedInterfaceLanguage = null;

  function injectMainWorldScript() {
    if (antiRefreshInjected || !settings.enableAntiRefresh) {
      return;
    }

    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.async = false;
    script.dataset.faceboot = "true";
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
    antiRefreshInjected = true;
  }

  function normalizeText(value) {
    return (value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function normalizeLanguageCode(value) {
    return normalizeText(value).split(/[-_]/)[0] || "";
  }

  function readLocaleFromCookies() {
    const match = document.cookie.match(/(?:^|;\s*)locale=([^;]+)/i);
    if (!match) {
      return "";
    }

    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  function readLocaleFromBootScripts() {
    const scripts = document.querySelectorAll('script[type="application/json"][data-sjs]');
    const exactPatterns = [
      /"IntlCurrentLocale",\[\],\{"code":"([^"]+)"/u,
      /"IntlCurrentLocale":\{"code":"([^"]+)"/u,
      /"IntlCurrentLocale"[\s\S]{0,160}?"code":"([^"]+)"/u
    ];
    const fallbackPatterns = [
      /"locale":"([a-z]{2,3}(?:[_-][A-Z]{2})?)"/u,
      /"code":"([a-z]{2,3}(?:[_-][A-Z]{2})?)"/u
    ];

    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text) {
        continue;
      }

      for (const pattern of exactPatterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
          return match[1];
        }
      }
    }

    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text) {
        continue;
      }

      for (const pattern of fallbackPatterns) {
        const match = text.match(pattern);
        if (match?.[1]) {
          return match[1];
        }
      }
    }

    return "";
  }

  function detectInterfaceLanguage() {
    if (cachedInterfaceLanguage) {
      return cachedInterfaceLanguage;
    }

    const candidate =
      readLocaleFromBootScripts() ||
      document.documentElement?.getAttribute("lang") ||
      document.body?.getAttribute("lang") ||
      readLocaleFromCookies() ||
      navigator.language ||
      "en";

    cachedInterfaceLanguage = normalizeLanguageCode(candidate) || "en";
    return cachedInterfaceLanguage;
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

  const UI_LANGUAGE_DICTIONARIES = {
    en: {
      seeMoreLabels: ["see more"],
      actionMenuLabels: ["actions for this post"],
      commentWords: ["comment", "comments", "reply", "replies", "response", "responses"],
      loadMoreVerbs: ["view", "see", "show"],
      moreWords: ["more"],
      sortKeywords: ["most relevant", "relevant", "all comments", "comments", "newest", "oldest", "top", "recent", "sorted", "all", "most"],
      allCommentsLabels: ["all comments"]
    },
    es: {
      seeMoreLabels: ["ver mas", "ver más"],
      actionMenuLabels: ["acciones para esta publicacion", "acciones para esta publicación"],
      commentWords: ["comentario", "comentarios", "respuesta", "respuestas"],
      loadMoreVerbs: ["ver", "mostrar"],
      moreWords: ["mas", "más"],
      sortKeywords: ["mas relevantes", "más relevantes", "relevantes", "todos los comentarios", "comentarios", "mas recientes", "más recientes", "mas antiguos", "más antiguos", "recientes", "antiguos", "todos"],
      allCommentsLabels: ["todos los comentarios"]
    },
    fr: {
      seeMoreLabels: ["en voir plus", "voir plus"],
      actionMenuLabels: ["actions pour cette publication", "actions pour ce post"],
      commentWords: ["commentaire", "commentaires", "reponse", "réponse", "reponses", "réponses", "replique", "réplique", "repliques", "répliques"],
      loadMoreVerbs: ["voir", "afficher", "montrer"],
      moreWords: ["plus", "plus de"],
      sortKeywords: ["les plus pertinents", "pertinent", "pertinents", "tous les commentaires", "commentaires", "plus recents", "plus récents", "recents", "récents", "plus anciens", "anciens", "top", "tout", "tous"],
      allCommentsLabels: ["tous les commentaires"]
    },
    de: {
      seeMoreLabels: ["mehr ansehen", "mehr anzeigen"],
      actionMenuLabels: ["aktionen fur diesen beitrag", "aktionen für diesen beitrag"],
      commentWords: ["kommentar", "kommentare", "antwort", "antworten"],
      loadMoreVerbs: ["ansehen", "anzeigen"],
      moreWords: ["mehr", "weitere"],
      sortKeywords: ["relevanteste", "relevant", "alle kommentare", "kommentare", "neueste", "alteste", "älteste", "top", "aktuell", "alle"],
      allCommentsLabels: ["alle kommentare"]
    },
    pt: {
      seeMoreLabels: ["ver mais"],
      actionMenuLabels: ["acoes para esta publicacao", "ações para esta publicação", "acoes para esta postagem", "ações para esta postagem"],
      commentWords: ["comentario", "comentários", "comentario", "comentarios", "resposta", "respostas"],
      loadMoreVerbs: ["ver", "mostrar"],
      moreWords: ["mais"],
      sortKeywords: ["mais relevantes", "relevantes", "todos os comentarios", "todos os comentários", "comentarios", "comentários", "mais recentes", "mais antigos", "recentes", "antigos", "todos"],
      allCommentsLabels: ["todos os comentarios", "todos os comentários"]
    },
    it: {
      seeMoreLabels: ["mostra altro", "vedi altro"],
      actionMenuLabels: ["azioni per questo post"],
      commentWords: ["commento", "commenti", "risposta", "risposte"],
      loadMoreVerbs: ["vedi", "mostra"],
      moreWords: ["altro", "altri", "piu", "più"],
      sortKeywords: ["piu pertinenti", "più pertinenti", "pertinenti", "tutti i commenti", "commenti", "piu recenti", "più recenti", "piu vecchi", "più vecchi", "recenti", "tutti"],
      allCommentsLabels: ["tutti i commenti"]
    },
    nl: {
      seeMoreLabels: ["meer bekijken", "meer weergeven"],
      actionMenuLabels: ["acties voor dit bericht"],
      commentWords: ["opmerking", "opmerkingen", "reactie", "reacties", "antwoord", "antwoorden"],
      loadMoreVerbs: ["bekijk", "weergeven", "toon"],
      moreWords: ["meer"],
      sortKeywords: ["meest relevant", "relevant", "alle opmerkingen", "alle reacties", "opmerkingen", "reacties", "nieuwste", "oudste", "recent", "alle"],
      allCommentsLabels: ["alle opmerkingen", "alle reacties"]
    },
    ar: {
      seeMoreLabels: ["عرض المزيد"],
      actionMenuLabels: ["إجراءات بشأن هذا المنشور", "اجراءات بشأن هذا المنشور"],
      commentWords: ["تعليق", "تعليقات", "رد", "ردود"],
      loadMoreVerbs: ["عرض", "اظهار", "إظهار", "مشاهدة"],
      moreWords: ["المزيد", "المزيد من", "مزيد", "مزيد من"],
      sortKeywords: ["الأكثر صلة", "الاكثر صلة", "التعليقات", "كل التعليقات", "الأحدث", "الاحدث", "الأقدم", "الاقدم", "الكل"],
      allCommentsLabels: ["كل التعليقات"]
    },
    hi: {
      seeMoreLabels: ["और देखें"],
      actionMenuLabels: ["इस पोस्ट के लिए कार्रवाइयाँ", "इस पोस्ट के लिए कार्रवाइयां"],
      commentWords: ["टिप्पणी", "टिप्पणियाँ", "टिप्पणियां", "जवाब", "जवाबों", "प्रतिक्रिया", "प्रतिक्रियाएँ", "प्रतिक्रियाएं"],
      loadMoreVerbs: ["देखें", "दिखाएं", "दिखाएँ"],
      moreWords: ["और", "ज़्यादा", "ज्यादा", "अधिक"],
      sortKeywords: ["सबसे प्रासंगिक", "प्रासंगिक", "सभी टिप्पणियाँ", "सभी टिप्पणियां", "टिप्पणियाँ", "टिप्पणियां", "नवीनतम", "पुरानी", "हाल की", "सभी"],
      allCommentsLabels: ["सभी टिप्पणियाँ", "सभी टिप्पणियां"]
    },
    id: {
      seeMoreLabels: ["lihat selengkapnya"],
      actionMenuLabels: ["tindakan untuk postingan ini", "tindakan untuk kiriman ini"],
      commentWords: ["komentar", "balasan"],
      loadMoreVerbs: ["lihat", "tampilkan"],
      moreWords: ["lainnya", "lebih banyak"],
      sortKeywords: ["paling relevan", "relevan", "semua komentar", "komentar", "terbaru", "terlama", "atas", "semua"],
      allCommentsLabels: ["semua komentar"]
    }
  };

  function getLocalizedUiMatchers() {
    const language = detectInterfaceLanguage();
    const dictionary = UI_LANGUAGE_DICTIONARIES[language] || UI_LANGUAGE_DICTIONARIES.en;
    const commentWordsPattern = buildAlternation(dictionary.commentWords);
    const loadMoreVerbsPattern = buildAlternation(dictionary.loadMoreVerbs);
    const moreWordsPattern = buildAlternation(dictionary.moreWords);

    return {
      language,
      seeMoreRegex: createPhraseRegex(dictionary.seeMoreLabels, { exact: true, allowTrailingPunctuation: true }),
      actionMenuRegex: createPhraseRegex(dictionary.actionMenuLabels, { exact: true }),
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
      sortMenuRegex: createPhraseRegex(dictionary.sortKeywords),
      allCommentsRegex: createPhraseRegex(dictionary.allCommentsLabels)
    };
  }

  const uiMatchers = getLocalizedUiMatchers();

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

  function pressElement(element) {
    if (!(element instanceof Element) || !isVisible(element)) {
      return false;
    }

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
      cancelable: true,
      composed: true,
      clientX,
      clientY,
      button: 0,
      buttons: 1,
      view: window
    };

    try {
      if (typeof element.focus === "function") {
        element.focus({ preventScroll: true });
      }
    } catch {
      // Ignore focus failures.
    }

    if (typeof PointerEvent === "function") {
      element.dispatchEvent(new PointerEvent("pointerdown", pointerOptions));
      element.dispatchEvent(new PointerEvent("pointerup", { ...pointerOptions, buttons: 0 }));
    }

    element.dispatchEvent(new MouseEvent("mousedown", mouseOptions));
    element.dispatchEvent(new MouseEvent("mouseup", { ...mouseOptions, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("click", { ...mouseOptions, buttons: 0 }));
    return true;
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
        // Ignore storage write failures.
      });
    }, 250);
  }

  async function flushStats() {
    const keys = Object.keys(pendingStatIncrements);
    if (keys.length === 0) {
      return;
    }

    const increments = {};
    keys.forEach((key) => {
      increments[key] = pendingStatIncrements[key];
      delete pendingStatIncrements[key];
    });

    const current = await chrome.storage.local.get({
      ...STATS_DEFAULTS,
      ...SESSION_STATS_DEFAULTS
    });
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

    await chrome.storage.local.set(next);
  }

  async function resetSessionStats() {
    await chrome.storage.local.set({ ...SESSION_STATS_DEFAULTS });
  }

  function getEnabledPostLabels() {
    const labels = [];

    if (settings.enableBlockJoinPosts) {
      labels.push("join");
    }

    if (settings.enableBlockFollowPosts) {
      labels.push("follow");
    }

    return labels;
  }

  function matchesBlockedLabel(text, blockedLabels) {
    if (!text || text.length > 32) {
      return false;
    }

    return blockedLabels.some((label) => {
      return (
        text === label ||
        text === label + "." ||
        text === label + "!" ||
        text.startsWith(label + " ")
      );
    });
  }

  function getMainContainers(root = document) {
    const containers = new Set();

    if (root instanceof Element) {
      if (root.matches('[role="main"]')) {
        containers.add(root);
      }

      root.querySelectorAll('[role="main"]').forEach((el) => containers.add(el));

      const closestMain = root.closest('[role="main"]');
      if (closestMain) {
        containers.add(closestMain);
      }
    }

    if (root === document || containers.size === 0) {
      document.querySelectorAll('[role="main"]').forEach((el) => containers.add(el));
    }

    if (containers.size === 0) {
      containers.add(document);
    }

    return [...containers];
  }

  function removeFeedElement(target, statKey) {
    if (!(target instanceof Element) || removedFeedElements.has(target)) {
      return;
    }

    removedFeedElements.add(target);

    if (statKey) {
      queueStatIncrement(statKey);
    }

    target.remove();
  }

  function markHidden(target, statKey) {
    removeFeedElement(target, statKey);
  }

  function findClosestReelsContainer(start) {
    if (!(start instanceof Element)) {
      return null;
    }

    const regionContainer = start.closest('[role="region"][aria-label]');
    if (regionContainer) {
      const label = normalizeText(regionContainer.getAttribute("aria-label"));
      if (/\breels?\b/i.test(label)) {
        return regionContainer.closest("div.html-div") || regionContainer;
      }
    }

    return (
      start.closest("div.html-div") ||
      start.closest('[role="region"]') ||
      start.closest('div[role="article"]')
    );
  }

  function hideReelsContainers(root = document) {
    if (!settings.enableFeedFilter || !settings.enableBlockReels) {
      return;
    }

    const mainContainers = getMainContainers(root);

    for (const container of mainContainers) {
      const reelsRegions = container.querySelectorAll('[role="region"][aria-label]');
      for (const region of reelsRegions) {
        const label = normalizeText(region.getAttribute("aria-label"));
        if (/\breels?\b/i.test(label)) {
          markHidden(region.closest("div.html-div") || region, "removedReels");
        }
      }

      const reelsHeadings = container.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
      for (const heading of reelsHeadings) {
        const text = normalizeText(heading.textContent);
        if (text === "reels" || text.startsWith("reels ")) {
          markHidden(findClosestReelsContainer(heading), "removedReels");
        }
      }

      const reelsLinks = container.querySelectorAll('[role="link"][aria-label]');
      for (const link of reelsLinks) {
        const label = normalizeText(link.getAttribute("aria-label"));
        if (/\breels?\b/i.test(label)) {
          markHidden(findClosestReelsContainer(link), "removedReels");
        }
      }
    }
  }

  function getPostContainerFromLabelButton(button) {
    const main = button.closest('[role="main"]') || document.body;

    const listItemContainer = button.closest('[aria-posinset], [data-virtualized], div[role="article"]');
    if (listItemContainer) {
      return listItemContainer;
    }

    let node = button;
    let fallback = null;

    while (node && node !== main) {
      if (
        node.matches('div[role="article"], [data-pagelet*="FeedUnit"], div.html-div')
      ) {
        if (!fallback) {
          fallback = node;
        }

        const hasPostMenu = hasPostActionControl(node);
        if (hasPostMenu) {
          return node;
        }
      }

      node = node.parentElement;
    }

    return fallback || button.closest("div.html-div") || button;
  }

  function hideBlockedLabelContainers(root = document) {
    if (!settings.enableFeedFilter) {
      return;
    }

    const blockedLabels = getEnabledPostLabels();
    if (blockedLabels.length === 0) {
      return;
    }

    const mainContainers = getMainContainers(root);

    for (const container of mainContainers) {
      const buttons = container.querySelectorAll('[role="button"][tabindex]');
      for (const button of buttons) {
        if (!isVisible(button)) {
          continue;
        }

        const spans = button.querySelectorAll("span");
        let matched = false;
        let matchedLabel = "";

        for (const span of spans) {
          const text = normalizeText(span.textContent);
          if (matchesBlockedLabel(text, blockedLabels)) {
            matched = true;
            matchedLabel = text.startsWith("join") ? "join" : text.startsWith("follow") ? "follow" : text;
            break;
          }
        }

        if (!matched) {
          const buttonText = normalizeText(button.textContent);
          matched = matchesBlockedLabel(buttonText, blockedLabels);
          if (matched) {
            matchedLabel = buttonText.startsWith("join") ? "join" : buttonText.startsWith("follow") ? "follow" : "";
          }
        }

        if (!matched) {
          continue;
        }

        const target = getPostContainerFromLabelButton(button);
        if (!target) {
          continue;
        }

        const hasPostContext =
          hasPostActionControl(target) ||
          target.querySelector('[data-ad-rendering-role="profile_name"]') ||
          target.querySelector("h4");

        if (hasPostContext) {
          const statKey = matchedLabel === "join" ? "removedJoinPosts" : "removedFollowPosts";
          markHidden(target, statKey);
        }
      }
    }
  }

  function getFeedContainer(start) {
    if (!(start instanceof Element)) {
      return null;
    }

    return (
      start.closest('[aria-posinset]') ||
      start.closest('[data-virtualized]') ||
      start.closest('div[role="article"]') ||
      start.closest('div.html-div') ||
      start
    );
  }

  function hideStoriesContainers(root = document) {
    if (!settings.enableFeedFilter) {
      return;
    }

    const mainContainers = getMainContainers(root);

    for (const container of mainContainers) {
      const storyRegions = container.querySelectorAll('[role="region"][aria-label]');
      for (const region of storyRegions) {
        const label = normalizeText(region.getAttribute("aria-label"));
        if (label === "stories" || label === "story" || /stories tray/i.test(label)) {
          markHidden(getFeedContainer(region), "removedStories");
        }
      }

      const storyGrids = container.querySelectorAll('[role="grid"][aria-label]');
      for (const grid of storyGrids) {
        const label = normalizeText(grid.getAttribute("aria-label"));
        if (/stories tray|stories|story tray/i.test(label)) {
          markHidden(getFeedContainer(grid), "removedStories");
        }
      }

      const storyHeadings = container.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
      for (const heading of storyHeadings) {
        const text = normalizeText(heading.textContent);
        if (text === "stories" || text.startsWith("stories ")) {
          markHidden(getFeedContainer(heading), "removedStories");
        }
      }
    }
  }

  function hasPeopleYouMayKnowSignals(container) {
    if (!(container instanceof Element)) {
      return false;
    }

    const ownLabel = normalizeText(container.getAttribute("aria-label"));
    const heading = container.querySelector('h1, h2, h3, h4, [role="heading"]');
    const headingText = heading ? normalizeText(heading.textContent) : "";
    const region = container.querySelector('[role="region"][aria-label]');
    const regionLabel = region ? normalizeText(region.getAttribute("aria-label")) : "";
    const hasPeopleLabel = [ownLabel, headingText, regionLabel].some((text) => {
      return /\bpeople you may know\b/i.test(text);
    });

    if (!hasPeopleLabel) {
      return false;
    }

    const hasRecommendationSignals =
      !!container.querySelector('a[href*="/friends/suggestions/"]') ||
      !!container.querySelector('[aria-label^="Add friend"], [aria-label^="Remove recommendation"]') ||
      !!container.querySelector('[href="/friends/"]');

    return hasRecommendationSignals;
  }

  function getPeopleYouMayKnowContainer(start) {
    if (!(start instanceof Element)) {
      return null;
    }

    const main = start.closest('[role="main"]') || document.body;
    let node = start;
    let best = null;

    while (node && node !== main) {
      if (
        node.matches('div.html-div, [data-virtualized], [aria-posinset], section, [role="region"]') &&
        hasPeopleYouMayKnowSignals(node)
      ) {
        best = node;
      }

      node = node.parentElement;
    }

    return best || getFeedContainer(start);
  }

  function hidePeopleYouMayKnow(root = document) {
    if (!settings.enableFeedFilter || !settings.enableBlockPeopleYouMayKnow) {
      return;
    }

    const mainContainers = getMainContainers(root);

    for (const container of mainContainers) {
      const titleCandidates = container.querySelectorAll('h1, h2, h3, h4, [role="heading"], [role="region"][aria-label]');
      for (const candidate of titleCandidates) {
        const text = normalizeText(candidate.textContent || candidate.getAttribute("aria-label"));
        if (!/\bpeople you may know\b/i.test(text)) {
          continue;
        }

        const target = getPeopleYouMayKnowContainer(candidate);
        if (!target) {
          continue;
        }

        markHidden(target, "removedPeopleYouMayKnow");
      }
    }
  }

  function getSidebarSponsoredContainer(start) {
    if (!(start instanceof Element)) {
      return null;
    }

    return (
      start.closest('[data-visualcompletion="ignore-late-mutation"]') ||
      start.closest('[data-virtualized]') ||
      start.closest('section, aside, div') ||
      start
    );
  }

  function hasSponsoredSignals(container) {
    if (!(container instanceof Element)) {
      return false;
    }

    const sponsoredHeading = container.querySelector('h1, h2, h3, h4, [role="heading"]');
    const headingText = sponsoredHeading ? normalizeText(sponsoredHeading.textContent) : "";
    if (!/\bsponsored\b/i.test(headingText)) {
      return false;
    }

    const hasMenuButton = !!container.querySelector('[role="button"][aria-label="More"]');
    const hasOutbound = !!container.querySelector('a[role="link"][target="_blank"], a[rel*="nofollow"]');
    const hasMedia = !!container.querySelector("img, video");

    return hasMenuButton && hasOutbound && hasMedia;
  }

  function hideSidebarSponsored(root = document) {
    if (!settings.enableFeedFilter) {
      return;
    }

    const scope = root instanceof Element ? root : document;
    const headings = scope.querySelectorAll('h1, h2, h3, h4, [role="heading"]');

    for (const heading of headings) {
      const text = normalizeText(heading.textContent);
      if (!/\bsponsored\b/i.test(text)) {
        continue;
      }

      const candidate = getSidebarSponsoredContainer(heading);
      if (!candidate) {
        continue;
      }

      const paddedContainer = candidate.closest('[data-visualcompletion="ignore-late-mutation"]') || candidate;
      if (hasSponsoredSignals(paddedContainer)) {
        markHidden(paddedContainer, "removedSponsored");
      }
    }
  }

  function expandPostBodies(root = document) {
    if (!settings.enablePostExpansion) {
      return;
    }

    const scope = root instanceof Element ? root : document;
    const maxPriorityClicks = 6;
    const maxGenericClicks = 3;
    const prioritizedCandidates = scope.querySelectorAll(
      '[data-ad-rendering-role="story_message"] [role="button"][tabindex], [data-ad-rendering-role="story_body"] [role="button"][tabindex]'
    );
    const genericCandidates = scope.querySelectorAll('[role="button"][tabindex]');
    const candidates = [];
    const seenCandidates = new Set();
    let priorityClicksThisRun = 0;
    let genericClicksThisRun = 0;

    function pushCandidate(button, priority) {
      if (!(button instanceof Element) || seenCandidates.has(button)) {
        return;
      }

      seenCandidates.add(button);
      candidates.push({ button, priority });
    }

    prioritizedCandidates.forEach((button) => {
      const text = normalizeText(button.textContent || button.getAttribute("aria-label"));
      if (uiMatchers.seeMoreRegex.test(text)) {
        pushCandidate(button, "priority");
      }
    });
    genericCandidates.forEach((button) => pushCandidate(button, "generic"));

    function isLikelyPostExpander(button) {
      if (!isVisible(button) || clickedPostExpanders.has(button)) {
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
      if (!uiMatchers.seeMoreRegex.test(text)) {
        return false;
      }

      const storyMessage = button.closest('[data-ad-rendering-role="story_message"], [data-ad-rendering-role="story_body"]');
      const article = button.closest(
        'div[role="article"], [data-pagelet*="FeedUnit"], [role="dialog"], [aria-posinset], [data-virtualized]'
      );
      const postContext = article || storyMessage;
      const measurementRoot = storyMessage || postContext;
      if (!postContext || !measurementRoot) {
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

      if (!storyMessage && button.closest('[role="list"], [aria-live], ul, ol')) {
        return false;
      }

      const inlineTextContainer = button.parentElement;
      const inlineText = normalizeText(inlineTextContainer?.textContent || "");
      const hasInlineTruncation = uiMatchers.seeMoreRegex.test(inlineText) && (inlineText.includes("...") || inlineText.includes("…"));
      const hasStoryContext = !!storyMessage && !!postContext.querySelector('[data-ad-rendering-role="profile_name"], a[role="link"][href*="/groups/"], a[role="link"][href*="/posts/"]');

      if (!hasInlineTruncation && !hasStoryContext) {
        return false;
      }

      const buttonRect = button.getBoundingClientRect();
      const measurementRect = measurementRoot.getBoundingClientRect();
      const relativeTop = buttonRect.top - measurementRect.top;

      return relativeTop >= 0 && relativeTop < Math.max(900, measurementRect.height + 120);
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

      clickedPostExpanders.add(button);
      if (!pressElement(button)) {
        continue;
      }

      queueStatIncrement("expandedPosts");

      if (priority === "priority") {
        priorityClicksThisRun += 1;
      } else {
        genericClicksThisRun += 1;
      }
    }
  }

  function clickCommentExpanders(root = document) {
    if (!settings.enableCommentExpansion) {
      return;
    }

    const activeDialog = root instanceof Element
      ? root.closest('[role="dialog"]') || document.querySelector('[role="dialog"]')
      : document.querySelector('[role="dialog"]');

    // Only auto-expand inside an opened post dialog to avoid accidental feed/sidebar clicks.
    if (!activeDialog) {
      return;
    }

    const controls = activeDialog.querySelectorAll('[role="button"]');
    let clicksThisRun = 0;

    function hasCommentContext(control) {
      const host = control.closest('[role="dialog"], div[role="article"], [data-pagelet]') || document;
      const hasComposer = !!host.querySelector('[contenteditable="true"][role="textbox"], textarea');
      const nestedArticleCount = host.querySelectorAll('div[role="article"]').length;
      const hasDiscussionRegion = !!host.querySelector('[role="list"], [role="feed"], [aria-live]');

      return hasComposer || nestedArticleCount >= 2 || hasDiscussionRegion;
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

      if (control.querySelector("svg, img, video")) {
        return false;
      }

      const text = normalizeText(control.textContent || control.getAttribute("aria-label"));
      if (!text || text.length > 140) {
        return false;
      }

      const isCommentSummaryControl = uiMatchers.commentSummaryRegex.test(text);
      const isLoadMoreCommentControl =
        uiMatchers.loadMoreCommentRegex.test(text) ||
        uiMatchers.moreCommentRegex.test(text);

      if (!inCommentThread && !isCommentSummaryControl && !isLoadMoreCommentControl) {
        return false;
      }

      if (control.hasAttribute("aria-label") && !isCommentSummaryControl && !isLoadMoreCommentControl) {
        return false;
      }

      if (isCommentSummaryControl || isLoadMoreCommentControl) {
        return true;
      }

      const hasNumericHint = /\d/.test(text);
      if (!hasNumericHint) {
        return false;
      }

      // Ignore short numeric counters (e.g. reaction counts like "1.3k").
      if (text.length < 6) {
        return false;
      }

      // Numeric labels are common for expandable comment/reply controls and safer than text matching.
      return true;
    }

    for (const control of controls) {
      if (clicksThisRun >= 2) {
        break;
      }

      if (clickedElements.has(control) || !isVisible(control)) {
        continue;
      }

      if (!isLikelyCommentExpander(control)) {
        continue;
      }

      if (!pressElement(control)) {
        continue;
      }

      clickedElements.add(control);
      clicksThisRun += 1;
      queueStatIncrement("expandedComments");
    }
  }

  function switchToAllComments(root = document) {
    if (!settings.enableCommentExpansion) {
      return;
    }

    const activeDialog = root instanceof Element
      ? root.closest('[role="dialog"]') || document.querySelector('[role="dialog"]')
      : document.querySelector('[role="dialog"]');

    // Only adjust comment ordering inside opened post dialogs.
    if (!activeDialog) {
      return;
    }

    function isSelectedMenuItem(item) {
      return (
        item.getAttribute("tabindex") === "0" ||
        item.getAttribute("aria-checked") === "true" ||
        item.getAttribute("aria-selected") === "true"
      );
    }

    function clickMenuItem(item) {
      const interactiveChild = item.querySelector(
        '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [tabindex], button, a'
      );
      (interactiveChild || item).click();
    }

    const menus = [...document.querySelectorAll('[role="menu"]')]
      .filter((menu) => isVisible(menu))
      .map((menu) => {
        const menuItems = [
          ...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')
        ].filter((item) => isVisible(item));

        if (menuItems.length < 2) {
          return null;
        }

        const menuText = normalizeText(menu.textContent);
        let score = 0;

        if (activeDialog.contains(menu) || menu.closest('[role="dialog"]') === activeDialog) {
          score += 3;
        }

        if (uiMatchers.sortMenuRegex.test(menuText)) {
          score += 3;
        }

        if (menuItems.some((item) => isSelectedMenuItem(item))) {
          score += 2;
        }

        return { menu, menuItems, score };
      })
      .filter((entry) => entry && entry.score >= 2)
      .sort((a, b) => b.score - a.score);

    for (const { menuItems } of menus) {
      const explicitAllCommentsItem = menuItems.find((item) => {
        const itemText = normalizeText(item.textContent || item.getAttribute("aria-label"));
        return uiMatchers.allCommentsRegex.test(itemText);
      });

      if (explicitAllCommentsItem && !isSelectedMenuItem(explicitAllCommentsItem)) {
        clickMenuItem(explicitAllCommentsItem);
        queueStatIncrement("expandedComments");
        return;
      }

      // Fallback for localized labels: pick a non-selected option after the selected one.
      const selectedIndex = menuItems.findIndex((item) => isSelectedMenuItem(item));
      const candidate =
        menuItems.find((item, index) => index > selectedIndex && !isSelectedMenuItem(item)) ||
        menuItems.find((item) => !isSelectedMenuItem(item));

      if (candidate) {
        clickMenuItem(candidate);
        queueStatIncrement("expandedComments");
        return;
      }
    }

    // Open only likely comment-order menus in the active dialog.
    const toggles = activeDialog.querySelectorAll('[role="button"][aria-haspopup="menu"][aria-expanded="false"]');
    const dialogHasCommentSignals =
      !!activeDialog.querySelector('[contenteditable="true"][role="textbox"], textarea') ||
      !!activeDialog.querySelector('[role="list"], [aria-live], div[role="article"]');

    const now = Date.now();

    for (const toggle of toggles) {
      if (!isVisible(toggle)) {
        continue;
      }

      const previousClickAt = clickedSorterMenus.get(toggle) || 0;
      if (now - previousClickAt < 3500) {
        continue;
      }

      if (toggle.closest('[role="toolbar"]') || isPostActionControl(toggle)) {
        continue;
      }

      const host = toggle.closest('[role="dialog"], div[role="article"], [data-pagelet]') || activeDialog;
      const hostHasCommentSignals =
        host.querySelector('[contenteditable="true"][role="textbox"], textarea') ||
        host.querySelector('[role="list"], [aria-live]');

      if (!hostHasCommentSignals && !dialogHasCommentSignals) {
        continue;
      }

      const text = normalizeText(toggle.textContent || toggle.getAttribute("aria-label"));
      if (!text || text.length < 4 || text.length > 48 || /\d/.test(text)) {
        continue;
      }

      const looksLikeSorterLabel =
        uiMatchers.sortMenuRegex.test(text);

      if (!looksLikeSorterLabel) {
        continue;
      }

      clickedSorterMenus.set(toggle, now);
      toggle.click();
      return;
    }
  }

  function runAll(root = document) {
    if (settings.enableAntiRefresh) {
      injectMainWorldScript();
    }

    hideSidebarSponsored(root);
    hideStoriesContainers(root);
    hidePeopleYouMayKnow(root);
    hideBlockedLabelContainers(root);
    hideReelsContainers(root);
    expandPostBodies(root);
    switchToAllComments(root);
    clickCommentExpanders(root);
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
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" && areaName !== "local") {
      return;
    }

    let shouldRerun = false;

    if (changes.enableAntiRefresh) {
      settings.enableAntiRefresh = changes.enableAntiRefresh.newValue !== false;
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

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) {
      return;
    }

    const data = event.data;
    if (data.source !== "faceboot" || data.kind !== "stat") {
      return;
    }

    if (data.stat === "preventedRefreshes") {
      const increment = Number(data.count || 1);
      queueStatIncrement("preventedRefreshes", increment > 0 ? increment : 1);
    }
  });

  resetSessionStats()
    .catch(() => {
      // Ignore storage reset failures.
    })
    .then(() => loadSettings())
    .then(() => runAll(document));

  document.addEventListener("DOMContentLoaded", () => runAll(document));
  window.addEventListener("load", () => runAll(document));

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }

      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          runAll(node);
        }
      });
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.setInterval(() => runAll(document), 1500);
})();
