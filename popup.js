(() => {
  "use strict";

  const FEEDS_URL = "https://www.facebook.com/?filter=all&sk=h_chr&sorting_setting=CHRONOLOGICAL";
  const FACEBOOK_URL_PATTERNS = [
    "*://www.facebook.com/*",
    "*://web.facebook.com/*"
  ];

  const DEFAULT_SETTINGS = {
    enableAntiRefresh: false,
    enableFeedFilter: true,
    enablePostExpansion: true,
    enableCommentExpansion: true,
    enableBlockReels: true,
    enableBlockPeopleYouMayKnow: true,
    enableBlockFollowPosts: true,
    enableBlockJoinPosts: true,
    enableGoDirectlyToFeeds: false,
    groupFeedDefaultSort: "new posts"
  };
  const sharedStats = globalThis.FacebergStats || {};
  const CLEANUP_STATS = sharedStats.CLEANUP_STATS || [];
  const ACTIVITY_STATS = sharedStats.ACTIVITY_STATS || [];
  const ALL_STATS = sharedStats.ALL_STATS || [];
  const DEFAULT_STATS = {
    ...(sharedStats.DEFAULT_STATS || {}),
    ...(sharedStats.SESSION_STATS_DEFAULTS || {})
  };
  const STATS_RESET_AT_KEY = "activityStatsResetAt";
  const STATS_STORAGE_DEFAULTS = {
    ...DEFAULT_STATS,
    [STATS_RESET_AT_KEY]: 0
  };
  const SAVED_TIME_WEIGHTS = Object.freeze({
    expandedPosts: 3,
    expandedComments: 3,
    commentFilterChanges: 5,
    preventedRefreshes: 10
  });
  const getSessionStatKey = sharedStats.toSessionKey || ((statKey) => `session${statKey.charAt(0).toUpperCase()}${statKey.slice(1)}`);

  const antiRefreshInput = document.getElementById("enableAntiRefresh");
  const feedFilterInput = document.getElementById("enableFeedFilter");
  const postExpansionInput = document.getElementById("enablePostExpansion");
  const commentExpansionInput = document.getElementById("enableCommentExpansion");
  const blockReelsInput = document.getElementById("enableBlockReels");
  const blockPeopleYouMayKnowInput = document.getElementById("enableBlockPeopleYouMayKnow");
  const blockFollowPostsInput = document.getElementById("enableBlockFollowPosts");
  const blockJoinPostsInput = document.getElementById("enableBlockJoinPosts");
  const goDirectlyToFeedsInput = document.getElementById("enableGoDirectlyToFeeds");
  const groupFeedDefaultSortInput = document.getElementById("groupFeedDefaultSort");
  const roiHero = document.getElementById("roiHero");
  const roiTimeValue = document.getElementById("roiTimeValue");
  const roiPillars = document.getElementById("roiPillars");
  const pillarCleanup = document.getElementById("pillarCleanup");
  const pillarExpansion = document.getElementById("pillarExpansion");
  const pillarRefresh = document.getElementById("pillarRefresh");
  const statsBreakdown = document.getElementById("statsBreakdown");
  const detailList = document.getElementById("detailList");
  const emptyState = document.getElementById("emptyState");
  const supportCta = document.getElementById("supportCta");
  const supportLine = document.getElementById("supportLine");
  const resetInfo = document.getElementById("resetInfo");
  const feedCleanupNote = document.getElementById("feedCleanupNote");
  const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
  const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));
  const feedCleanupDependentRows = Array.from(document.querySelectorAll('[data-parent-toggle="enableFeedFilter"]'));
  const applyButton = document.getElementById("applyButton");
  const donateButton = document.getElementById("donateButton");
  const resetStatsButton = document.getElementById("resetStatsButton");
  const copyDebugButton = document.getElementById("copyDebugButton");
  const status = document.getElementById("status");
  const extensionVersion = document.getElementById("extensionVersion");
  const IMPACT_GROUPS = [
    {
      title: "Feed Cleanup",
      items: [
        { key: "removedReels", label: "Reels hidden" },
        { key: "removedFollowPosts", label: "Follow suggestions hidden" },
        { key: "removedJoinPosts", label: "Join suggestions hidden" },
        { key: "removedStories", label: "Stories hidden" },
        { key: "removedPeopleYouMayKnow", label: "People you may know hidden" },
        { key: "removedSponsored", label: "Sponsored posts hidden" }
      ]
    },
    {
      title: "Content Expansion",
      items: [
        { key: "expandedPosts", label: "Posts auto-expanded" },
        { key: "expandedComments", label: "Comment threads opened" },
        { key: "commentFilterChanges", label: "Comment filters corrected" }
      ]
    },
    {
      title: "Refresh Control",
      items: [
        { key: "preventedRefreshes", label: "Page reloads prevented" }
      ]
    }
  ];
  let latestStats = null;
  let clearStatusTimer = null;
  let isDirty = false;
  const DONATE_URL = "https://www.buymeacoffee.com/bzh22";

  function renderExtensionVersion() {
    const manifestVersion = chrome.runtime?.getManifest?.()?.version;
    const versionText = manifestVersion ? `v${manifestVersion}` : "";

    if (extensionVersion) {
      extensionVersion.textContent = versionText;
    }

    const aboutVersion = document.getElementById("aboutVersion");
    if (aboutVersion) {
      aboutVersion.textContent = versionText;
    }
  }

  function buildDetailList(stats) {
    if (!detailList) {
      return;
    }

    detailList.replaceChildren();

    IMPACT_GROUPS.forEach(({ title, items }) => {
      const nonZeroItems = items
        .map(({ key, label }) => ({ key, label, value: Number(stats[key] || 0) }))
        .filter(({ value }) => value > 0)
        .sort((a, b) => b.value - a.value);
      if (nonZeroItems.length === 0) {
        return;
      }

      const group = document.createElement("div");
      group.className = "fb-dl-group";

      const titleEl = document.createElement("div");
      titleEl.className = "fb-dl-group-title";
      titleEl.textContent = title;
      group.appendChild(titleEl);

      nonZeroItems.forEach(({ label, value }) => {
        const row = document.createElement("div");
        row.className = "fb-dl-row";

        const labelEl = document.createElement("span");
        labelEl.textContent = label;

        const valEl = document.createElement("span");
        valEl.className = "fb-dl-val";
        valEl.textContent = formatStat(value);

        row.append(labelEl, valEl);
        group.appendChild(row);
      });

      detailList.appendChild(group);
    });
  }

  function formatStat(value) {
    return Number(value || 0).toLocaleString();
  }

  function setActivePeriod(_period) { /* no-op: both periods shown simultaneously */ }

  function setActiveTab(targetId) {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tabTarget === targetId;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.id === targetId;
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    });
  }

  function renderStats(stats) {
    latestStats = stats;

    let grandTotal = 0;
    const groupTotals = [];

    IMPACT_GROUPS.forEach(({ items }) => {
      let groupTotal = 0;
      items.forEach(({ key }) => {
        groupTotal += Number(stats[key] || 0);
      });
      grandTotal += groupTotal;
      groupTotals.push(groupTotal);
    });

    const isEmpty = grandTotal === 0;
    const savedSeconds = getSavedSeconds(stats, { session: false });

    const actBreakdown = document.getElementById("statsBreakdown");

    if (emptyState) emptyState.hidden = !isEmpty;
    if (roiHero) roiHero.hidden = isEmpty;
    if (roiPillars) roiPillars.hidden = isEmpty;
    if (actBreakdown) actBreakdown.hidden = isEmpty;
    if (supportCta) supportCta.hidden = isEmpty;

    if (!isEmpty) {
      if (roiTimeValue) {
        roiTimeValue.textContent = formatDurationLabel(savedSeconds);
      }
      if (pillarCleanup) pillarCleanup.textContent = formatStat(groupTotals[0]);
      if (pillarExpansion) pillarExpansion.textContent = formatStat(groupTotals[1]);
      if (pillarRefresh) pillarRefresh.textContent = formatStat(groupTotals[2]);

      buildDetailList(stats);

      if (supportLine) {
        supportLine.textContent = pickSupportLine(grandTotal, savedSeconds);
      }
    }

    renderResetInfo(stats[STATS_RESET_AT_KEY]);
  }

  function pickSupportLine(totalActions, savedSeconds) {
    if (savedSeconds >= 3600) {
      return `${formatDurationLabel(savedSeconds)} reclaimed. Faceberg handled the repetitive work for you.`;
    }
    if (savedSeconds >= 1800) {
      return `${formatDurationLabel(savedSeconds)} saved so far. That is time you did not spend clicking through posts and comments.`;
    }
    if (totalActions >= 500) {
      return `${formatStat(totalActions)} small interruptions handled without manual work.`;
    }
    if (totalActions >= 100) {
      return `${formatStat(totalActions)} actions removed from your routine. Less clicking, less waiting, less clutter.`;
    }
    if (totalActions >= 25) {
      return `These counts are already adding up. Faceberg has started removing friction from the feed.`;
    }
    return `These totals will grow as Faceberg keeps handling clutter, expansions, and reloads for you.`;
  }

  function formatDurationLabel(totalSeconds) {
    const seconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainderSeconds = seconds % 60;

    if (hours > 0) {
      return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }

    if (minutes > 0) {
      return remainderSeconds > 0 ? `${minutes}m ${remainderSeconds}s` : `${minutes}m`;
    }

    return `${remainderSeconds}s`;
  }

  function formatResetInfoLabel(resetAt) {
    const timestamp = Number(resetAt || 0);
    if (!timestamp) {
      return "Tracking since now";
    }

    const dateStr = new Date(timestamp).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });

    return `Tracking since ${dateStr}`;
  }

  function getSavedSeconds(stats, { session = false } = {}) {
    const removalsKeySet = new Set(CLEANUP_STATS.map(({ key }) => key));
    let totalSeconds = 0;

    removalsKeySet.forEach((key) => {
      const statKey = session ? getSessionStatKey(key) : key;
      totalSeconds += Number(stats[statKey] || 0) * 2;
    });

    Object.entries(SAVED_TIME_WEIGHTS).forEach(([key, seconds]) => {
      const statKey = session ? getSessionStatKey(key) : key;
      totalSeconds += Number(stats[statKey] || 0) * seconds;
    });

    return totalSeconds;
  }

  function renderResetInfo(resetAt) {
    if (resetInfo) {
      resetInfo.textContent = formatResetInfoLabel(resetAt);
    }
  }

  function showStatus(message, state = "info", sticky = false) {
    status.textContent = message;
    status.dataset.state = state;

    if (clearStatusTimer !== null) {
      window.clearTimeout(clearStatusTimer);
      clearStatusTimer = null;
    }

    if (!sticky) {
      clearStatusTimer = window.setTimeout(() => {
        if (status.textContent === message) {
          status.textContent = "";
          status.dataset.state = "idle";
        }
      }, 1500);
    }
  }

  async function getActiveFacebookTabInfo() {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      return {
        url: "",
        title: "",
        id: null,
        isFacebook: false
      };
    }

    const url = typeof activeTab.url === "string" ? activeTab.url : "";
    return {
      url,
      title: typeof activeTab.title === "string" ? activeTab.title : "",
      id: typeof activeTab.id === "number" ? activeTab.id : null,
      isFacebook: /https?:\/\/(www|web)\.facebook\.com\//i.test(url)
    };
  }

  async function getActiveTabPageDebug(activeTab) {
    if (!activeTab?.isFacebook || typeof activeTab.id !== "number") {
      return {
        summary: null,
        logs: [],
        summaryAttr: null,
        error: activeTab?.id == null ? "No active tab." : "Active tab is not a supported Facebook page."
      };
    }

    try {
      const [executionResult] = await chrome.scripting.executeScript({
        target: { tabId: activeTab.id },
        func: () => {
          const summaryAttr = document.documentElement?.getAttribute("data-faceberg-debug-summary") || null;
          const summary = window.__FACEBERG_DEBUG_SUMMARY || (() => {
            if (!summaryAttr) {
              return null;
            }

            try {
              return JSON.parse(summaryAttr);
            } catch {
              return null;
            }
          })();
          const logs = Array.isArray(window.__FACEBERG_DEBUG_LOGS)
            ? window.__FACEBERG_DEBUG_LOGS.slice(-80)
            : [];

          return {
            summary,
            logs,
            summaryAttr,
            hasDebugSummaryGlobal: !!window.__FACEBERG_DEBUG_SUMMARY,
            hasDebugLogsGlobal: Array.isArray(window.__FACEBERG_DEBUG_LOGS)
          };
        }
      });

      return {
        ...(executionResult?.result || {
          summary: null,
          logs: [],
          summaryAttr: null,
          hasDebugSummaryGlobal: false,
          hasDebugLogsGlobal: false
        }),
        error: null
      };
    } catch (error) {
      return {
        summary: null,
        logs: [],
        summaryAttr: null,
        error: String(error?.message || error || "Unknown page debug capture failure.")
      };
    }
  }

  function buildDebugPayload({ settings, stats, activeTab, pageDebug }) {
    const manifest = chrome.runtime?.getManifest?.() || {};
    const payload = {
      extension: {
        name: manifest.name || "Faceberg",
        version: manifest.version || ""
      },
      generatedAt: new Date().toISOString(),
      activeTab,
      settings,
      stats,
      pageDebug,
      pageDebugInstructions: {
        summary: "window.__FACEBERG_DEBUG_SUMMARY || JSON.parse(document.documentElement.getAttribute('data-faceberg-debug-summary') || 'null')",
        logs: "window.__FACEBERG_DEBUG_LOGS ? window.__FACEBERG_DEBUG_LOGS.slice(-80) : 'no __FACEBERG_DEBUG_LOGS'",
        summaryAttr: "document.documentElement.getAttribute('data-faceberg-debug-summary')"
      }
    };

    return JSON.stringify(payload, null, 2);
  }

  async function copyDebugInformation() {
    const [settings, stats, activeTab] = await Promise.all([
      readSettings(),
      chrome.storage.local.get(STATS_STORAGE_DEFAULTS),
      getActiveFacebookTabInfo()
    ]);

    const pageDebug = await getActiveTabPageDebug(activeTab);
    const payload = buildDebugPayload({ settings, stats, activeTab, pageDebug });
    await navigator.clipboard.writeText(payload);
  }

  function markDirty() {
    isDirty = true;
    applyButton.disabled = false;
    showStatus("Changes pending. Apply to refresh open Facebook tabs.", "pending", true);
  }

  function collectSettingsFromInputs() {
    return {
      enableAntiRefresh: antiRefreshInput.checked,
      enableFeedFilter: feedFilterInput.checked,
      enablePostExpansion: postExpansionInput.checked,
      enableCommentExpansion: commentExpansionInput.checked,
      enableBlockReels: blockReelsInput.checked,
      enableBlockPeopleYouMayKnow: blockPeopleYouMayKnowInput.checked,
      enableBlockFollowPosts: blockFollowPostsInput.checked,
      enableBlockJoinPosts: blockJoinPostsInput.checked,
      enableGoDirectlyToFeeds: goDirectlyToFeedsInput.checked,
      groupFeedDefaultSort: String(groupFeedDefaultSortInput?.value || DEFAULT_SETTINGS.groupFeedDefaultSort)
    };
  }

  function syncDependentToggles() {
    const enabled = feedFilterInput.checked;

    feedCleanupNote.hidden = enabled;

    feedCleanupDependentRows.forEach((row) => {
      const input = row.querySelector('input[type="checkbox"]');
      if (!input) {
        return;
      }

      input.disabled = !enabled;
      row.classList.toggle("fb-toggle--disabled", !enabled);
      row.setAttribute("aria-disabled", String(!enabled));
    });
  }

  async function readSettings() {
    const [syncResult, localResult] = await Promise.allSettled([
      chrome.storage.sync.get(DEFAULT_SETTINGS),
      chrome.storage.local.get(DEFAULT_SETTINGS)
    ]);

    const syncSettings = syncResult.status === "fulfilled" ? syncResult.value : {};
    const localSettings = localResult.status === "fulfilled" ? localResult.value : {};

    /* Prefer sync when available, fallback to local for reliability. */
    return {
      ...DEFAULT_SETTINGS,
      ...localSettings,
      ...syncSettings
    };
  }

  async function persistSettings(nextSettings) {
    const writes = await Promise.allSettled([
      chrome.storage.sync.set(nextSettings),
      chrome.storage.local.set(nextSettings)
    ]);

    const success = writes.some((result) => result.status === "fulfilled");
    if (!success) {
      throw new Error("Failed to persist settings");
    }
  }

  async function loadSettings() {
    const stored = await readSettings();

    antiRefreshInput.checked = stored.enableAntiRefresh !== false;
    feedFilterInput.checked = stored.enableFeedFilter !== false;
    postExpansionInput.checked = stored.enablePostExpansion !== false;
    commentExpansionInput.checked = stored.enableCommentExpansion !== false;
    blockReelsInput.checked = stored.enableBlockReels !== false;
    blockPeopleYouMayKnowInput.checked = stored.enableBlockPeopleYouMayKnow !== false;
    blockFollowPostsInput.checked = stored.enableBlockFollowPosts !== false;
    blockJoinPostsInput.checked = stored.enableBlockJoinPosts !== false;
    goDirectlyToFeedsInput.checked = stored.enableGoDirectlyToFeeds === true;
    if (groupFeedDefaultSortInput) {
      groupFeedDefaultSortInput.value = String(stored.groupFeedDefaultSort || DEFAULT_SETTINGS.groupFeedDefaultSort);
    }
    syncDependentToggles();
  }

  async function loadStats() {
    const stats = await chrome.storage.local.get(STATS_STORAGE_DEFAULTS);
    if (!Number(stats[STATS_RESET_AT_KEY])) {
      const initializedStats = {
        ...stats,
        [STATS_RESET_AT_KEY]: Date.now()
      };
      await chrome.storage.local.set({ [STATS_RESET_AT_KEY]: initializedStats[STATS_RESET_AT_KEY] });
      renderStats(initializedStats);
      return;
    }

    renderStats(stats);
  }

  async function resetStats() {
    const resetPayload = {
      ...DEFAULT_STATS,
      [STATS_RESET_AT_KEY]: Date.now()
    };
    await chrome.storage.local.set(resetPayload);
    renderStats(resetPayload);
  }

  async function saveSettings() {
    await persistSettings(collectSettingsFromInputs());
  }

  async function refreshFacebookTabs(goDirectlyToFeeds) {
    const tabs = await chrome.tabs.query({ url: FACEBOOK_URL_PATTERNS });

    for (const tab of tabs) {
      if (typeof tab.id !== "number") {
        continue;
      }

      try {
        if (goDirectlyToFeeds) {
          await chrome.tabs.update(tab.id, { url: FEEDS_URL });
        } else {
          await chrome.tabs.reload(tab.id);
        }
      } catch (_error) {
        /* Ignore per-tab refresh failures so saved settings are not lost. */
      }
    }
  }

  async function applySettings() {
    if (!isDirty) {
      showStatus("No pending changes.", "info");
      return;
    }

    const next = collectSettingsFromInputs();
    await persistSettings(next);
    await refreshFacebookTabs(next.enableGoDirectlyToFeeds === true);

    isDirty = false;
    applyButton.disabled = true;
    showStatus("Applied. Open Facebook tabs were refreshed.", "success");
  }

  [
    antiRefreshInput,
    feedFilterInput,
    postExpansionInput,
    commentExpansionInput,
    blockReelsInput,
    blockPeopleYouMayKnowInput,
    blockFollowPostsInput,
    blockJoinPostsInput,
    goDirectlyToFeedsInput,
    groupFeedDefaultSortInput
  ].forEach((input) => {
    if (!input) {
      return;
    }

    input.addEventListener("change", () => {
      if (input === feedFilterInput) {
        syncDependentToggles();
      }

      markDirty();
    });
  });

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tabTarget);
    });
  });

  applyButton.addEventListener("click", () => {
    applySettings().catch(() => showStatus("Apply failed.", "error"));
  });

  if (donateButton) {
    donateButton.addEventListener("click", () => {
      chrome.tabs.create({ url: DONATE_URL }).catch(() => {
        showStatus("Could not open support page.", "error");
      });
    });
  }

  const aboutIcon = document.getElementById("aboutIcon");
  if (aboutIcon) {
    aboutIcon.addEventListener("click", () => {
      const isEnlarged = aboutIcon.classList.toggle("fb-about-icon--enlarged");
      aboutIcon.src = isEnlarged ? "icons/logo.png" : "icons/icon128.png";
    });
  }

  if (resetStatsButton) {
    resetStatsButton.addEventListener("click", () => {
      resetStats()
        .then(() => showStatus("Activity stats reset.", "success"))
        .catch(() => showStatus("Could not reset activity stats.", "error"));
    });
  }

  if (copyDebugButton) {
    copyDebugButton.addEventListener("click", () => {
      copyDebugInformation()
        .then(() => showStatus("Debug information copied.", "success"))
        .catch(() => showStatus("Could not copy debug information.", "error"));
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    let hasStatChange = false;

    Object.keys(STATS_STORAGE_DEFAULTS).forEach((key) => {
      if (changes[key]) {
        hasStatChange = true;
      }
    });

    if (hasStatChange) {
      loadStats().catch(() => {
        /* Ignore read failures. */
      });
    }
  });

  setActiveTab("settingsPanel");
  renderExtensionVersion();

  loadSettings()
    .then(() => {
      isDirty = false;
      applyButton.disabled = true;
    })
    .catch(() => showStatus("Could not load settings.", "error"));
  loadStats().catch(() => showStatus("Could not load activity.", "error"));
})();

