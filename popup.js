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
    enableGoDirectlyToFeeds: false
  };
  const sharedStats = globalThis.FaceBootStats || {};
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
  const timeSavedSessionValue = document.getElementById("timeSavedSessionValue");
  const timeSavedTotalValue = document.getElementById("timeSavedTotalValue");
  const cleanupTotalEl = document.getElementById("cleanupTotal");
  const expansionTotalEl = document.getElementById("expansionTotal");
  const refreshTotalEl = document.getElementById("refreshTotal");
  const cleanupBadge = document.getElementById("cleanupBadge");
  const expansionBadge = document.getElementById("expansionBadge");
  const refreshBadge = document.getElementById("refreshBadge");
  const impactSection = document.getElementById("impactSection");
  const emptyState = document.getElementById("emptyState");
  const breakdownDetails = document.getElementById("breakdownDetails");
  const breakdownBody = document.getElementById("breakdownBody");
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
  const status = document.getElementById("status");
  const extensionVersion = document.getElementById("extensionVersion");
  const statRowElements = new Map();
  const IMPACT_GROUPS = [
    {
      totalEl: cleanupTotalEl,
      badgeEl: cleanupBadge,
      title: "Feed Cleanup",
      items: [
        { key: "removedReels", label: "Reels" },
        { key: "removedFollowPosts", label: "Follow suggestions" },
        { key: "removedJoinPosts", label: "Join suggestions" },
        { key: "removedStories", label: "Stories" },
        { key: "removedPeopleYouMayKnow", label: "People you may know" },
        { key: "removedSponsored", label: "Sponsored posts" }
      ]
    },
    {
      totalEl: expansionTotalEl,
      badgeEl: expansionBadge,
      title: "Content Expansion",
      items: [
        { key: "expandedPosts", label: "Posts expanded" },
        { key: "expandedComments", label: "Comment threads expanded" },
        { key: "commentFilterChanges", label: "Comment filters changed" }
      ]
    },
    {
      totalEl: refreshTotalEl,
      badgeEl: refreshBadge,
      title: "Refresh Control",
      items: [
        { key: "preventedRefreshes", label: "Reloads prevented" }
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

  function buildBreakdown() {
    if (!breakdownBody) {
      return;
    }

    breakdownBody.replaceChildren();
    statRowElements.clear();

    IMPACT_GROUPS.forEach(({ title, items }) => {
      const group = document.createElement("div");
      group.className = "fb-bk-group";

      const titleEl = document.createElement("div");
      titleEl.className = "fb-bk-title";
      titleEl.textContent = title;
      group.appendChild(titleEl);

      items.forEach(({ key, label }) => {
        const row = document.createElement("div");
        row.className = "fb-bk-row";

        const labelEl = document.createElement("span");
        labelEl.textContent = label;

        const valEl = document.createElement("span");
        valEl.className = "fb-bk-val";
        valEl.textContent = "0";

        row.append(labelEl, valEl);
        group.appendChild(row);
        statRowElements.set(key, { valEl });
      });

      breakdownBody.appendChild(group);
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

    /* Time saved hero */
    if (timeSavedTotalValue) {
      timeSavedTotalValue.textContent = formatDurationLabel(getSavedSeconds(stats, { session: false }));
    }
    if (timeSavedSessionValue) {
      timeSavedSessionValue.textContent = formatDurationLabel(getSavedSeconds(stats, { session: true }));
    }

    /* Impact counters + session badges */
    let grandTotal = 0;

    IMPACT_GROUPS.forEach(({ totalEl, badgeEl, items }) => {
      let groupTotal = 0;
      let groupSession = 0;

      items.forEach(({ key }) => {
        groupTotal += Number(stats[key] || 0);
        groupSession += Number(stats[getSessionStatKey(key)] || 0);
      });

      grandTotal += groupTotal;

      if (totalEl) {
        totalEl.textContent = formatStat(groupTotal);
      }
      if (badgeEl) {
        badgeEl.textContent = groupSession > 0 ? `+${formatStat(groupSession)} this session` : "";
      }
    });

    /* Detail breakdown values */
    ALL_STATS.forEach(({ key }) => {
      const entry = statRowElements.get(key);
      if (!entry) {
        return;
      }

      const val = Number(stats[key] || 0);
      entry.valEl.textContent = formatStat(val);
      entry.valEl.classList.toggle("fb-bk-val--zero", val === 0);
    });

    /* Empty state vs content */
    const isEmpty = grandTotal === 0;
    if (emptyState) {
      emptyState.hidden = !isEmpty;
    }
    if (impactSection) {
      impactSection.hidden = isEmpty;
    }
    if (breakdownDetails) {
      breakdownDetails.hidden = isEmpty;
    }
    if (supportCta) {
      supportCta.hidden = isEmpty;
    }
    if (supportLine && !isEmpty) {
      supportLine.textContent = pickSupportLine(grandTotal, getSavedSeconds(stats, { session: false }));
    }

    /* Reset footer */
    renderResetInfo(stats[STATS_RESET_AT_KEY]);
  }

  function pickSupportLine(totalActions, savedSeconds) {
    const mins = Math.round(savedSeconds / 60);
    if (mins >= 60) {
      return `${formatDurationLabel(savedSeconds)} reclaimed. Your future self says thanks.`;
    }
    if (totalActions >= 500) {
      return `${formatStat(totalActions)} problems solved. Zero complaints filed.`;
    }
    if (totalActions >= 100) {
      return `That's ${formatStat(totalActions)} things you didn't have to deal with.`;
    }
    if (totalActions >= 10) {
      return "Already making your feed less annoying. Imagine a whole week.";
    }
    return "That's time you'll never waste again. You're welcome.";
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
      enableGoDirectlyToFeeds: goDirectlyToFeedsInput.checked
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
    goDirectlyToFeedsInput
  ].forEach((input) => {
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
      aboutIcon.src = isEnlarged ? "icons/source.png" : "icons/icon128.png";
    });
  }

  if (resetStatsButton) {
    resetStatsButton.addEventListener("click", () => {
      resetStats()
        .then(() => showStatus("Activity stats reset.", "success"))
        .catch(() => showStatus("Could not reset activity stats.", "error"));
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

  buildBreakdown();
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
