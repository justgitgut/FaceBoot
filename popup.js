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
  const statsSummary = document.getElementById("statsSummary");
  const statsGrid = document.getElementById("statsGrid");
  const feedCleanupNote = document.getElementById("feedCleanupNote");
  const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
  const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));
  const feedCleanupDependentRows = Array.from(document.querySelectorAll('[data-parent-toggle="enableFeedFilter"]'));
  const applyButton = document.getElementById("applyButton");
  const donateButton = document.getElementById("donateButton");
  const status = document.getElementById("status");
  const statElements = new Map();
  let clearStatusTimer = null;
  let isDirty = false;
  const DONATE_URL = "https://www.buymeacoffee.com/pinkerton";

  function createStatCard(label, options = {}) {
    const item = document.createElement("div");
    item.className = `stat-item${options.summary ? " stat-item--summary" : ""}`;

    const total = document.createElement("span");
    total.className = "stat-num";
    total.textContent = "0";

    const title = document.createElement("span");
    title.className = "stat-lbl";
    title.textContent = label;

    const session = document.createElement("span");
    session.className = "stat-session";
    session.textContent = "+0 this session";

    item.append(total, title, session);
    return { item, total, session };
  }

  function buildStatsGrid() {
    statsSummary.replaceChildren();
    statsGrid.replaceChildren();
    statElements.clear();

    const removedSummary = createStatCard("All removed items", { summary: true });
    statsSummary.appendChild(removedSummary.item);
    statElements.set("__cleanupTotal__", removedSummary);

    [...CLEANUP_STATS, ...ACTIVITY_STATS].forEach(({ key, label }) => {
      const card = createStatCard(label);
      statsGrid.appendChild(card.item);
      statElements.set(key, card);
    });
  }

  function formatStat(value) {
    return Number(value || 0).toLocaleString();
  }

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
    const cleanupTotals = CLEANUP_STATS.reduce((sum, { key }) => sum + Number(stats[key] || 0), 0);
    const cleanupSessionTotals = CLEANUP_STATS.reduce((sum, { key }) => sum + Number(stats[getSessionStatKey(key)] || 0), 0);
    const summaryCard = statElements.get("__cleanupTotal__");

    if (summaryCard) {
      summaryCard.total.textContent = formatStat(cleanupTotals);
      summaryCard.session.textContent = `+${formatStat(cleanupSessionTotals)} this session`;
    }

    ALL_STATS.forEach(({ key }) => {
      const card = statElements.get(key);
      if (!card) {
        return;
      }

      card.total.textContent = formatStat(stats[key]);
      card.session.textContent = `+${formatStat(stats[getSessionStatKey(key)])} this session`;
    });
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
    const stats = await chrome.storage.local.get(DEFAULT_STATS);
    renderStats(stats);
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

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    let hasStatChange = false;

    Object.keys(DEFAULT_STATS).forEach((key) => {
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

  buildStatsGrid();
  setActiveTab("settingsPanel");

  loadSettings()
    .then(() => {
      isDirty = false;
      applyButton.disabled = true;
    })
    .catch(() => showStatus("Could not load settings.", "error"));
  loadStats().catch(() => showStatus("Could not load activity.", "error"));
})();
