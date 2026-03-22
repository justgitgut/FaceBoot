(() => {
  "use strict";

  if (globalThis.FaceBootContentDebug) {
    return;
  }

  const contentUtils = globalThis.FaceBootContentUtils;
  if (!contentUtils) {
    return;
  }

  const { normalizeText } = contentUtils;
  const DEBUG_COMMENT_AUTOMATION = true;
  const DEBUG_COMMENT_AUTOMATION_CONSOLE = false;
  const DEBUG_SUMMARY_ATTRIBUTE = "data-faceboot-debug-summary";

  function createEmptyDebugSummary() {
    return {
      url: window.location.href,
      lastUpdatedAt: "",
      counts: {},
      latest: {},
      recent: []
    };
  }

  function ensureDebugState() {
    if (!window.__FACEBOOT_DEBUG_SUMMARY || typeof window.__FACEBOOT_DEBUG_SUMMARY !== "object") {
      window.__FACEBOOT_DEBUG_SUMMARY = createEmptyDebugSummary();
    }

    if (!Array.isArray(window.__FACEBOOT_DEBUG_LOGS)) {
      window.__FACEBOOT_DEBUG_LOGS = [];
    }

    if (typeof window.__FACEBOOT_DEBUG_REPORT !== "function") {
      window.__FACEBOOT_DEBUG_REPORT = () => JSON.parse(JSON.stringify(window.__FACEBOOT_DEBUG_SUMMARY));
    }

    syncDebugSummaryToPage(window.__FACEBOOT_DEBUG_SUMMARY);
    return window.__FACEBOOT_DEBUG_SUMMARY;
  }

  function syncDebugSummaryToPage(summary) {
    const root = document.documentElement;
    if (!root) {
      return;
    }

    try {
      root.setAttribute(DEBUG_SUMMARY_ATTRIBUTE, JSON.stringify(summary));
    } catch {
      // Ignore serialization or DOM update failures.
    }
  }

  function describeElement(element) {
    if (!(element instanceof Element)) {
      return "<none>";
    }

    const tagName = String(element.tagName || "").toLowerCase();
    const role = element.getAttribute("role");
    const ariaLabel = normalizeText(element.getAttribute("aria-label"));
    const text = normalizeText(element.textContent).slice(0, 80);
    const pagelet = element.getAttribute("data-pagelet");

    return [
      tagName || "element",
      role ? `[role="${role}"]` : "",
      pagelet ? `[data-pagelet="${pagelet}"]` : "",
      ariaLabel ? `aria="${ariaLabel}"` : "",
      text ? `text="${text}"` : ""
    ].filter(Boolean).join(" ");
  }

  function compactDebugValue(value) {
    if (value == null) {
      return value;
    }

    if (typeof value === "string") {
      return value.length > 160 ? `${value.slice(0, 157)}...` : value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.slice(0, 6).map((item) => compactDebugValue(item));
    }

    if (typeof value === "object") {
      const compactObject = {};
      for (const [key, nestedValue] of Object.entries(value)) {
        compactObject[key] = compactDebugValue(nestedValue);
      }
      return compactObject;
    }

    return String(value);
  }

  function getDebugBucket(step) {
    if (step.startsWith("resolve-root")) {
      return "root";
    }

    if (step.startsWith("run-automation")) {
      return "run";
    }

    if (step.startsWith("expand-comments")) {
      return "expand";
    }

    return "other";
  }

  function formatCompactDebugEvent(step, details) {
    const parts = [step];
    const importantKeys = [
      "reason",
      "resolved",
      "target",
      "controlText",
      "toggleText",
      "selectedItem",
      "selectedItemBefore",
      "hasAllCommentsItem",
      "toggleAttempts",
      "selectionAttempts",
      "directPost"
    ];

    for (const key of importantKeys) {
      if (details[key] === undefined) {
        continue;
      }

      parts.push(`${key}=${String(compactDebugValue(details[key]))}`);
    }

    return parts.join(" | ");
  }

  function updateDebugSummary(step, details) {
    const summary = ensureDebugState();

    const compactDetails = compactDebugValue(details);
    const bucket = getDebugBucket(step);

    summary.url = window.location.href;
    summary.lastUpdatedAt = new Date().toISOString();
    summary.counts[step] = (summary.counts[step] || 0) + 1;
    summary.latest[bucket] = {
      step,
      ...compactDetails
    };
    summary.recent.push(formatCompactDebugEvent(step, compactDetails));
    if (summary.recent.length > 20) {
      summary.recent.splice(0, summary.recent.length - 20);
    }

    window.__FACEBOOT_DEBUG_SUMMARY = summary;
    window.__FACEBOOT_DEBUG_REPORT = () => JSON.parse(JSON.stringify(window.__FACEBOOT_DEBUG_SUMMARY));
    syncDebugSummaryToPage(summary);
    return summary;
  }

  function debugCommentAutomation(step, details = {}) {
    if (!DEBUG_COMMENT_AUTOMATION) {
      return;
    }

    try {
      ensureDebugState();
      const payload = {
        timestamp: new Date().toISOString(),
        step,
        url: window.location.href,
        ...details
      };

      const existingLogs = Array.isArray(window.__FACEBOOT_DEBUG_LOGS)
        ? window.__FACEBOOT_DEBUG_LOGS
        : [];
      existingLogs.push(payload);
      if (existingLogs.length > 200) {
        existingLogs.splice(0, existingLogs.length - 200);
      }
      window.__FACEBOOT_DEBUG_LOGS = existingLogs;
      const summary = updateDebugSummary(step, details);

      if (DEBUG_COMMENT_AUTOMATION_CONSOLE) {
        console.log("[FaceBoot]", payload);
        console.log("[FaceBootSummary]", summary);
      }
    } catch {
      // Ignore console serialization failures.
    }
  }

  ensureDebugState();

  globalThis.FaceBootContentDebug = Object.freeze({
    describeElement,
    compactDebugValue,
    debugCommentAutomation
  });
})();