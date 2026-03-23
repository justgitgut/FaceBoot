(() => {
  "use strict";

  if (globalThis.FacebergFeedRuntime) {
    return;
  }

  const contentUtils = globalThis.FacebergContentUtils;
  if (!contentUtils) {
    return;
  }

  const {
    normalizeText,
    hasPostActionControl,
    isVisible
  } = contentUtils;

  const removedFeedElements = new WeakSet();

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

  function getEnabledPostLabels(settings) {
    const labels = [];

    if (settings?.enableBlockJoinPosts) {
      labels.push("join");
    }

    if (settings?.enableBlockFollowPosts) {
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
        text === `${label}.` ||
        text === `${label}!` ||
        text.startsWith(`${label} `)
      );
    });
  }

  function getMainContainers(root = document) {
    const containers = new Set();

    if (root instanceof Element) {
      if (root.matches('[role="main"]')) {
        containers.add(root);
      }

      root.querySelectorAll('[role="main"]').forEach((element) => containers.add(element));

      const closestMain = root.closest('[role="main"]');
      if (closestMain) {
        containers.add(closestMain);
      }
    }

    if (root === document || containers.size === 0) {
      document.querySelectorAll('[role="main"]').forEach((element) => containers.add(element));
    }

    if (containers.size === 0) {
      containers.add(document);
    }

    return [...containers];
  }

  function removeFeedElement(target, statKey, deps) {
    if (!(target instanceof Element) || removedFeedElements.has(target)) {
      return;
    }

    removedFeedElements.add(target);

    if (statKey) {
      queueStatIncrement(deps, statKey);
    }

    target.remove();
  }

  function markHidden(target, statKey, deps) {
    removeFeedElement(target, statKey, deps);
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

  function getPostContainerFromLabelButton(button) {
    const main = button.closest('[role="main"]') || document.body;

    const listItemContainer = button.closest('[aria-posinset], [data-virtualized], div[role="article"]');
    if (listItemContainer) {
      return listItemContainer;
    }

    let node = button;
    let fallback = null;

    while (node && node !== main) {
      if (node.matches('div[role="article"], [data-pagelet*="FeedUnit"], div.html-div')) {
        if (!fallback) {
          fallback = node;
        }

        if (hasPostActionControl(node)) {
          return node;
        }
      }

      node = node.parentElement;
    }

    return fallback || button.closest("div.html-div") || button;
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

    return (
      !!container.querySelector('a[href*="/friends/suggestions/"]') ||
      !!container.querySelector('[aria-label^="Add friend"], [aria-label^="Remove recommendation"]') ||
      !!container.querySelector('[href="/friends/"]')
    );
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

  function hideReelsContainers(root = document, deps = {}) {
    const settings = getSettings(deps);
    if (!settings?.enableFeedFilter || !settings?.enableBlockReels) {
      return;
    }

    const mainContainers = getMainContainers(root);

    for (const container of mainContainers) {
      const reelsRegions = container.querySelectorAll('[role="region"][aria-label]');
      for (const region of reelsRegions) {
        const label = normalizeText(region.getAttribute("aria-label"));
        if (/\breels?\b/i.test(label)) {
          markHidden(region.closest("div.html-div") || region, "removedReels", deps);
        }
      }

      const reelsHeadings = container.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
      for (const heading of reelsHeadings) {
        const text = normalizeText(heading.textContent);
        if (text === "reels" || text.startsWith("reels ")) {
          markHidden(findClosestReelsContainer(heading), "removedReels", deps);
        }
      }

      const reelsLinks = container.querySelectorAll('[role="link"][aria-label]');
      for (const link of reelsLinks) {
        const label = normalizeText(link.getAttribute("aria-label"));
        if (/\breels?\b/i.test(label)) {
          markHidden(findClosestReelsContainer(link), "removedReels", deps);
        }
      }
    }
  }

  function hideBlockedLabelContainers(root = document, deps = {}) {
    const settings = getSettings(deps);
    if (!settings?.enableFeedFilter) {
      return;
    }

    const blockedLabels = getEnabledPostLabels(settings);
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
          markHidden(target, statKey, deps);
        }
      }
    }
  }

  function hideStoriesContainers(root = document, deps = {}) {
    const settings = getSettings(deps);
    if (!settings?.enableFeedFilter) {
      return;
    }

    const mainContainers = getMainContainers(root);

    for (const container of mainContainers) {
      const storyRegions = container.querySelectorAll('[role="region"][aria-label]');
      for (const region of storyRegions) {
        const label = normalizeText(region.getAttribute("aria-label"));
        if (label === "stories" || label === "story" || /stories tray/i.test(label)) {
          markHidden(getFeedContainer(region), "removedStories", deps);
        }
      }

      const storyGrids = container.querySelectorAll('[role="grid"][aria-label]');
      for (const grid of storyGrids) {
        const label = normalizeText(grid.getAttribute("aria-label"));
        if (/stories tray|stories|story tray/i.test(label)) {
          markHidden(getFeedContainer(grid), "removedStories", deps);
        }
      }

      const storyHeadings = container.querySelectorAll('h1, h2, h3, h4, [role="heading"]');
      for (const heading of storyHeadings) {
        const text = normalizeText(heading.textContent);
        if (text === "stories" || text.startsWith("stories ")) {
          markHidden(getFeedContainer(heading), "removedStories", deps);
        }
      }
    }
  }

  function hidePeopleYouMayKnow(root = document, deps = {}) {
    const settings = getSettings(deps);
    if (!settings?.enableFeedFilter || !settings?.enableBlockPeopleYouMayKnow) {
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

        markHidden(target, "removedPeopleYouMayKnow", deps);
      }
    }
  }

  function hideSidebarSponsored(root = document, deps = {}) {
    const settings = getSettings(deps);
    if (!settings?.enableFeedFilter) {
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
        markHidden(paddedContainer, "removedSponsored", deps);
      }
    }
  }

  function runFeedCleanup(root = document, deps = {}) {
    hideSidebarSponsored(root, deps);
    hideStoriesContainers(root, deps);
    hidePeopleYouMayKnow(root, deps);
    hideBlockedLabelContainers(root, deps);
    hideReelsContainers(root, deps);
  }

  globalThis.FacebergFeedRuntime = Object.freeze({
    runFeedCleanup
  });
})();