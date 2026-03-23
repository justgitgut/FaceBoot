(() => {
  "use strict";

  const FEEDS_URL = "https://www.facebook.com/?filter=all&sk=h_chr&sorting_setting=CHRONOLOGICAL";
  const DEFAULT_SETTINGS = {
    /* Keep this in sync with content.js. If the background default diverges,
       Facebook tabs can remain discardable and Chrome may reload them after a
       long idle period even though the content runtime assumes protection is on. */
    enableAntiRefresh: true,
    enableGoDirectlyToFeeds: false
  };
  const FACEBOOK_URL_PATTERNS = [
    "*://www.facebook.com/*",
    "*://web.facebook.com/*"
  ];
  const CONTENT_SCRIPT_FILES = ["shared-stats.js", "content-utils.js", "content-debug.js", "content-feed.js", "content-comments.js", "content.js"];
  const ANTI_REFRESH_SCRIPT_ID = "faceberg-anti-refresh";
  const SESSION_STATS_DEFAULTS = {
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

  async function resetSessionStats() {
    try {
      /* Session counters belong to the browser/extension session, not individual
         Facebook page loads. Resetting them from the content script causes normal
         navigations or reinjection to wipe the popup's This Session view. */
      await chrome.storage.local.set(SESSION_STATS_DEFAULTS);
    } catch (_error) {
      /* Ignore transient storage failures. */
    }
  }

  async function syncAntiRefreshRegistration(enabled) {
    try {
      const existingScripts = await chrome.scripting.getRegisteredContentScripts({
        ids: [ANTI_REFRESH_SCRIPT_ID]
      });
      const isRegistered = existingScripts.some((script) => script.id === ANTI_REFRESH_SCRIPT_ID);

      if (enabled && !isRegistered) {
        await chrome.scripting.registerContentScripts([
          {
            id: ANTI_REFRESH_SCRIPT_ID,
            matches: FACEBOOK_URL_PATTERNS,
            js: ["injected.js"],
            runAt: "document_start",
            world: "MAIN",
            persistAcrossSessions: true
          }
        ]);
        return;
      }

      if (!enabled && isRegistered) {
        await chrome.scripting.unregisterContentScripts({
          ids: [ANTI_REFRESH_SCRIPT_ID]
        });
      }
    } catch (_error) {
      /* Ignore registration failures and continue with fallback injection. */
    }
  }

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
      /* Ignore transient tab-query/reload errors. */
    }
  }

  function isFacebookUrl(url) {
    return /^https?:\/\/(www|web)\.facebook\.com\//i.test(String(url || ""));
  }

  async function hasFacebergContentScript(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "faceberg:ping" });
      return response?.ok === true;
    } catch (_error) {
      return false;
    }
  }

  async function ensureFacebergInjected(tabId) {
    if (typeof tabId !== "number" || tabId < 0) {
      return;
    }

    if (await hasFacebergContentScript(tabId)) {
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: CONTENT_SCRIPT_FILES
      });
    } catch (_error) {
      /* Ignore restricted pages, duplicate injection races, or transient tab states. */
    }
  }

  async function ensureAntiRefreshInjected(tabId) {
    if (typeof tabId !== "number" || tabId < 0) {
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["injected.js"],
        world: "MAIN"
      });
    } catch (_error) {
      /* Ignore restricted pages, duplicate injection races, or transient tab states. */
    }
  }

  async function applyProtectionToTab(tab) {
    if (!tab || typeof tab.id !== "number" || !isFacebookUrl(tab.url)) {
      return;
    }

    try {
      const settings = await readSettings();
      await ensureFacebergInjected(tab.id);
      if (settings.enableAntiRefresh === true) {
        await ensureAntiRefreshInjected(tab.id);
      }
      await setTabDiscardable(tab.id, settings.enableAntiRefresh !== true);
    } catch (_error) {
      /* Ignore transient settings/read errors. */
    }
  }

  async function applyProtectionToTabId(tabId) {
    if (typeof tabId !== "number" || tabId < 0) {
      return;
    }

    try {
      const tab = await chrome.tabs.get(tabId);
      await applyProtectionToTab(tab);
    } catch (_error) {
      /* Ignore transient tab lookup failures. */
    }
  }

  async function setTabDiscardable(tabId, autoDiscardable) {
    try {
      await chrome.tabs.update(tabId, { autoDiscardable });
    } catch (_error) {
      /* Ignore transient failures or unsupported tab states. */
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
      /* Ignore transient settings/read errors. */
    }
  }

  async function handleActivation() {
    try {
      const settings = await readSettings();
      await syncAntiRefreshRegistration(settings.enableAntiRefresh === true);
      const tabs = await chrome.tabs.query({ url: FACEBOOK_URL_PATTERNS });

      await Promise.all(
        tabs
          .filter((tab) => typeof tab.id === "number")
          .map(async (tab) => {
            await ensureFacebergInjected(tab.id);
            if (settings.enableAntiRefresh === true) {
              await ensureAntiRefreshInjected(tab.id);
            }
          })
      );

      await applyFacebookTabProtection();
      if (settings.enableGoDirectlyToFeeds === true) {
        await redirectFacebookTabsToFeeds();
      }
    } catch (_error) {
      /* Ignore transient settings/read errors. */
    }
  }

  chrome.runtime.onInstalled.addListener(() => {
    resetSessionStats().finally(() => {
      handleActivation();
    });
  });

  chrome.runtime.onStartup.addListener(() => {
    resetSessionStats().finally(() => {
      handleActivation();
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!changeInfo.url && !tab?.url && changeInfo.status !== "complete") {
      return;
    }

    const url = changeInfo.url || tab.url;
    if (!isFacebookUrl(url)) {
      return;
    }

    applyProtectionToTab({ ...tab, id: tabId, url });
  });

  chrome.tabs.onCreated.addListener((tab) => {
    if (isFacebookUrl(tab.url)) {
      applyProtectionToTab(tab);
    }
  });

  chrome.tabs.onActivated.addListener(({ tabId }) => {
    applyProtectionToTabId(tabId);
  });

  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (typeof windowId !== "number" || windowId < 0) {
      return;
    }

    try {
      const [activeTab] = await chrome.tabs.query({ windowId, active: true });
      await applyProtectionToTab(activeTab);
    } catch (_error) {
      /* Ignore transient focus/tab query failures. */
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== "faceberg:protect-tab") {
      return false;
    }

    applyProtectionToTab(sender.tab)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));

    return true;
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
