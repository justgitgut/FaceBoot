(() => {
  "use strict";

  const FEEDS_URL = "https://www.facebook.com/?filter=all&sk=h_chr";
  const DEFAULT_SETTINGS = {
    enableAntiRefresh: false,
    enableGoDirectlyToFeeds: false
  };
  const FACEBOOK_URL_PATTERNS = [
    "*://www.facebook.com/*",
    "*://web.facebook.com/*"
  ];

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

  async function redirectFacebookTabsToFeeds() {
    try {
      const tabs = await chrome.tabs.query({ url: FACEBOOK_URL_PATTERNS });

      for (const tab of tabs) {
        if (typeof tab.id === "number") {
          chrome.tabs.update(tab.id, { url: FEEDS_URL });
        }
      }
    } catch (_error) {
      // Ignore transient tab-query/reload errors.
    }
  }

  function isFacebookUrl(url) {
    return /^https?:\/\/(www|web)\.facebook\.com\//i.test(String(url || ""));
  }

  async function setTabDiscardable(tabId, autoDiscardable) {
    try {
      await chrome.tabs.update(tabId, { autoDiscardable });
    } catch (_error) {
      // Ignore transient failures or unsupported tab states.
    }
  }

  async function applyFacebookTabProtection() {
    try {
      const settings = await readSettings();
      const autoDiscardable = settings.enableAntiRefresh !== true;
      const tabs = await chrome.tabs.query({ url: FACEBOOK_URL_PATTERNS });

      await Promise.all(
        tabs
          .filter((tab) => typeof tab.id === "number")
          .map((tab) => setTabDiscardable(tab.id, autoDiscardable))
      );
    } catch (_error) {
      // Ignore transient settings/read errors.
    }
  }

  async function handleActivation() {
    try {
      const settings = await readSettings();
      await applyFacebookTabProtection();
      if (settings.enableGoDirectlyToFeeds === true) {
        await redirectFacebookTabsToFeeds();
      }
    } catch (_error) {
      // Ignore transient settings/read errors.
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    handleActivation();
  });

  chrome.runtime.onStartup.addListener(() => {
    handleActivation();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url && !tab?.url) {
      return;
    }

    const url = changeInfo.url || tab.url;
    if (!isFacebookUrl(url)) {
      return;
    }

    applyFacebookTabProtection();
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (isFacebookUrl(tab.url)) {
      applyFacebookTabProtection();
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync" && areaName !== "local") {
      return;
    }

    if (changes.enableAntiRefresh || changes.enableGoDirectlyToFeeds) {
      handleActivation();
    }
  });
})();
