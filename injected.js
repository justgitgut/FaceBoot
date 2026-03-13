(() => {
  "use strict";

  if (window.__facebootNoRefreshInstalled) {
    return;
  }

  window.__facebootNoRefreshInstalled = true;

  const BLOCK_MSG = "[FaceBoot] Blocked forced refresh call.";

  function safeUrl(input) {
    try {
      return new URL(String(input), window.location.href);
    } catch (_error) {
      return null;
    }
  }

  function isSamePageNavigationTarget(input) {
    const target = safeUrl(input);
    if (!target) {
      return false;
    }

    const current = new URL(window.location.href);
    return (
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.search === current.search
    );
  }

  function isSuspiciousTimerHandler(handler) {
    if (typeof handler === "string") {
      return /reload|refresh|force_reload|hard_refresh|history\.go\s*\(\s*0\s*\)/i.test(handler);
    }

    if (typeof handler === "function") {
      const source = Function.prototype.toString.call(handler);
      return /location\.reload\s*\(|\.reload\s*\(|history\.go\s*\(\s*0\s*\)|location\.(assign|replace)\s*\(/i.test(source);
    }

    return false;
  }

  function getListenerSource(listener) {
    if (typeof listener === "function") {
      return Function.prototype.toString.call(listener);
    }

    if (listener && typeof listener.handleEvent === "function") {
      return Function.prototype.toString.call(listener.handleEvent);
    }

    return "";
  }

  function isSuspiciousLifecycleListener(type, listener) {
    if (!/^(visibilitychange|focus|blur|pageshow|resume)$/.test(String(type))) {
      return false;
    }

    const source = getListenerSource(listener);
    if (!source) {
      return false;
    }

    return /location\.reload\s*\(|\.reload\s*\(|history\.go\s*\(\s*0\s*\)|location\.(assign|replace)\s*\(|window\.location\s*=|document\.location\s*=|visibilitystate|document\.hidden/i.test(source);
  }

  function guardLocationReload() {
    try {
      const originalReload = window.location.reload.bind(window.location);
      window.location.reload = function (...args) {
        console.debug(BLOCK_MSG, args);
        reportStat("preventedRefreshes", 1);
        return undefined;
      };

      // Keep a reference in case another script checks function identity.
      window.location.reload.__facebootOriginal = originalReload;
    } catch (_error) {
      // Ignore if browser blocks overriding location methods.
    }
  }

  function guardLocationNavigationMethods() {
    const wrapMethod = (holder, methodName) => {
      try {
        const original = holder[methodName];
        if (typeof original !== "function") {
          return;
        }

        holder[methodName] = function (...args) {
          if (args.length > 0 && isSamePageNavigationTarget(args[0])) {
            console.debug(BLOCK_MSG, methodName, args[0]);
            reportStat("preventedRefreshes", 1);
            return undefined;
          }

          return original.apply(this, args);
        };

        holder[methodName].__facebootOriginal = original;
      } catch (_error) {
        // Ignore if browser blocks overriding location methods.
      }
    };

    wrapMethod(window.location, "assign");
    wrapMethod(window.location, "replace");

    if (window.Location && window.Location.prototype) {
      wrapMethod(window.Location.prototype, "assign");
      wrapMethod(window.Location.prototype, "replace");
    }
  }

  function guardHistoryReloads() {
    try {
      const originalGo = window.history.go.bind(window.history);
      window.history.go = function (...args) {
        if (args.length === 0 || Number(args[0]) === 0) {
          console.debug(BLOCK_MSG, "history.go", args);
          reportStat("preventedRefreshes", 1);
          return undefined;
        }

        return originalGo(...args);
      };

      window.history.go.__facebootOriginal = originalGo;
    } catch (_error) {
      // Ignore if browser blocks overriding history methods.
    }
  }

  function guardSuspiciousLifecycleListeners() {
    try {
      const originalAddEventListener = EventTarget.prototype.addEventListener;

      EventTarget.prototype.addEventListener = function (type, listener, options) {
        const isPageLifecycleTarget =
          this === window ||
          this === document ||
          this === document.documentElement ||
          this === document.body;

        if (isPageLifecycleTarget && isSuspiciousLifecycleListener(type, listener)) {
          console.debug(BLOCK_MSG, "event-listener", type);
          reportStat("preventedRefreshes", 1);
          return undefined;
        }

        return originalAddEventListener.call(this, type, listener, options);
      };

      EventTarget.prototype.addEventListener.__facebootOriginal = originalAddEventListener;
    } catch (_error) {
      // Ignore if browser blocks overriding addEventListener.
    }
  }

  function guardStringTimeoutReload() {
    const originalSetTimeout = window.setTimeout;
    const originalSetInterval = window.setInterval;

    window.setTimeout = function (handler, timeout, ...args) {
      if (isSuspiciousTimerHandler(handler)) {
        console.debug(BLOCK_MSG, handler);
        reportStat("preventedRefreshes", 1);
        return 0;
      }

      return originalSetTimeout.call(this, handler, timeout, ...args);
    };

    window.setInterval = function (handler, timeout, ...args) {
      if (isSuspiciousTimerHandler(handler)) {
        console.debug(BLOCK_MSG, handler);
        reportStat("preventedRefreshes", 1);
        return 0;
      }

      return originalSetInterval.call(this, handler, timeout, ...args);
    };
  }

  function removeMetaRefresh() {
    let removedCount = 0;

    document.querySelectorAll("meta[http-equiv]").forEach((meta) => {
      const value = (meta.getAttribute("http-equiv") || "").toLowerCase();
      if (value === "refresh") {
        meta.remove();
        removedCount += 1;
      }
    });

    if (removedCount > 0) {
      reportStat("preventedRefreshes", removedCount);
    }
  }

  function reportStat(stat, count) {
    window.postMessage(
      {
        source: "faceboot",
        kind: "stat",
        stat,
        count
      },
      "*"
    );
  }

  guardLocationReload();
  guardLocationNavigationMethods();
  guardHistoryReloads();
  guardSuspiciousLifecycleListeners();
  guardStringTimeoutReload();
  removeMetaRefresh();

  const observer = new MutationObserver(() => removeMetaRefresh());
  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true
  });
})();
