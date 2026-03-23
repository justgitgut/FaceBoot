(() => {
  "use strict";

  if (window.__facebergNoRefreshInstalled) {
    return;
  }

  window.__facebergNoRefreshInstalled = true;

  const BLOCK_MSG = "[Faceberg] Blocked forced refresh call.";
  const SUSPICIOUS_EVENT_TYPES = /^(visibilitychange|focus|blur|pageshow|pagehide|freeze|resume|popstate|hashchange)$/;
  const VOLATILE_REFRESH_PARAM_PATTERN = /^(?:__.*|fbclid|ref|refsrc|notif_id|notif_t|notif_type|acontext|paipv|locale|ti|eav|av|mibextid|_rdc|_rdr|__tn__|__xts__|utm_[a-z0-9_]+)$/i;
  const RESUME_SUPPRESSION_WINDOW_MS = 10000;
  let wasPageHidden = false;
  let reallyHidden = false;
  let resumeSuppressionUntil = 0;
  let lastUserInteractionAt = 0;

  function isSuspiciousNavigationSource(source) {
    return /location\.reload\s*\(|\.reload\s*\(|history\.go\s*\(\s*0\s*\)|location\.(assign|replace)\s*\(|window\.location\s*=|document\.location\s*=|location\.href\s*=|document\.URL\s*=|visibilitystate|document\.hidden|popstate|hashchange/i.test(source);
  }

  function safeUrl(input) {
    try {
      return new URL(String(input), window.location.href);
    } catch (_error) {
      return null;
    }
  }

  function normalizePathname(pathname) {
    const raw = String(pathname || "/");
    const trimmed = raw.replace(/\/+$/, "");
    return trimmed || "/";
  }

  function toNavigationTarget(input) {
    if (input && typeof input === "object") {
      if (typeof input.href === "string") {
        return input.href;
      }

      try {
        return String(input);
      } catch (_error) {
        return "";
      }
    }

    return String(input ?? "");
  }

  function getCanonicalSearch(url) {
    const entries = [];

    for (const [key, value] of url.searchParams.entries()) {
      if (VOLATILE_REFRESH_PARAM_PATTERN.test(key)) {
        continue;
      }

      entries.push([key, value]);
    }

    entries.sort((left, right) => {
      const leftKey = `${left[0]}\u0000${left[1]}`;
      const rightKey = `${right[0]}\u0000${right[1]}`;
      return leftKey.localeCompare(rightKey);
    });

    return entries.map(([key, value]) => `${key}=${value}`).join("&");
  }

  function getNavigationRelation(input) {
    const target = safeUrl(input);
    if (!target) {
      return null;
    }

    const current = new URL(window.location.href);
    const sameOrigin = target.origin === current.origin;
    const samePath = sameOrigin && target.pathname === current.pathname;
    const sameNormalizedPath = sameOrigin && normalizePathname(target.pathname) === normalizePathname(current.pathname);
    const sameSearch = samePath && target.search === current.search;
    const sameHash = samePath && target.hash === current.hash;
    const sameCanonicalSearch = sameNormalizedPath && getCanonicalSearch(target) === getCanonicalSearch(current);

    return {
      target,
      current,
      sameOrigin,
      samePath,
      sameNormalizedPath,
      sameSearch,
      sameHash,
      sameCanonicalSearch,
      isHashOnlyChange: sameNormalizedPath && sameSearch && !sameHash
    };
  }

  function shouldBlockNavigationTarget(input) {
    const relation = getNavigationRelation(input);
    if (!relation || !relation.sameOrigin || !relation.sameNormalizedPath) {
      return false;
    }

    if (relation.isHashOnlyChange) {
      return false;
    }

    if (relation.sameSearch || relation.sameCanonicalSearch) {
      return true;
    }

    return resumeSuppressionUntil > Date.now();
  }

  function isSuspiciousTimerHandler(handler) {
    if (typeof handler === "string") {
      return /reload|refresh|force_reload|hard_refresh|history\.go\s*\(\s*0\s*\)/i.test(handler);
    }

    if (typeof handler === "function") {
      const source = Function.prototype.toString.call(handler);
      return isSuspiciousNavigationSource(source);
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
    if (!SUSPICIOUS_EVENT_TYPES.test(String(type))) {
      return false;
    }

    const source = getListenerSource(listener);
    if (!source) {
      return false;
    }

    return isSuspiciousNavigationSource(source);
  }

  function guardSuspiciousEventHandlerProperties() {
    const targets = [window, document, document.documentElement, document.body].filter(Boolean);
    const eventProperties = [
      "onvisibilitychange",
      "onfocus",
      "onblur",
      "onpageshow",
      "onresume",
      "onpopstate",
      "onhashchange"
    ];

    for (const target of targets) {
      for (const propertyName of eventProperties) {
        const targetPrototype = Object.getPrototypeOf(target);
        const descriptor =
          Object.getOwnPropertyDescriptor(target, propertyName) ||
          Object.getOwnPropertyDescriptor(targetPrototype, propertyName);

        if (!descriptor || typeof descriptor.set !== "function" || typeof descriptor.get !== "function") {
          continue;
        }

        try {
          Object.defineProperty(target, propertyName, {
            configurable: true,
            enumerable: descriptor.enumerable ?? true,
            get() {
              return descriptor.get.call(this);
            },
            set(value) {
              if (typeof value === "function" && isSuspiciousLifecycleListener(propertyName.slice(2), value)) {
                console.debug(BLOCK_MSG, "event-handler", propertyName);
                reportStat("preventedRefreshes", 1);
                descriptor.set.call(this, null);
                return;
              }

              descriptor.set.call(this, value);
            }
          });
        } catch (_error) {
          // Ignore when event handler properties are not configurable.
        }
      }
    }
  }

  function guardLocationReload() {
    const wrapReload = (holder, methodName) => {
      try {
        const original = holder?.[methodName];
        if (typeof original !== "function") {
          return;
        }

        holder[methodName] = function (...args) {
          console.debug(BLOCK_MSG, methodName, args);
          reportStat("preventedRefreshes", 1);
          return undefined;
        };

        holder[methodName].__facebergOriginal = original;
      } catch (_error) {
        // Ignore if browser blocks overriding location methods.
      }
    };

    wrapReload(window.location, "reload");

    if (window.Location && window.Location.prototype) {
      wrapReload(window.Location.prototype, "reload");
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
          if (args.length > 0 && shouldBlockNavigationTarget(args[0])) {
            console.debug(BLOCK_MSG, methodName, args[0]);
            reportStat("preventedRefreshes", 1);
            return undefined;
          }

          return original.apply(this, args);
        };

        holder[methodName].__facebergOriginal = original;
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

      window.history.go.__facebergOriginal = originalGo;
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

      EventTarget.prototype.addEventListener.__facebergOriginal = originalAddEventListener;
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
        source: "faceberg",
        kind: "stat",
        stat,
        count
      },
      "*"
    );
  }

  function beginResumeSuppression(now = Date.now(), durationMs = RESUME_SUPPRESSION_WINDOW_MS) {
    resumeSuppressionUntil = Math.max(resumeSuppressionUntil, now + durationMs);
  }

  function shouldSuppressResumeLifecycleEvent(event) {
    const eventType = String(event?.type || "").toLowerCase();
    const now = Date.now();

    if (eventType === "visibilitychange") {
      /* We spoofed document.visibilityState, so use the raw event flow:
         the browser fires visibilitychange in alternating hidden→visible
         transitions. Track with a boolean toggle. */
      if (!reallyHidden) {
        /* Transition: visible → hidden */
        reallyHidden = true;
        wasPageHidden = true;
        return true; /* suppress so listeners don't see the hidden transition */
      }

      /* Transition: hidden → visible */
      reallyHidden = false;
      if (wasPageHidden) {
        wasPageHidden = false;
        beginResumeSuppression(now);
        return true;
      }

      return false;
    }

    if (eventType === "pageshow") {
      if (event?.persisted === true || wasPageHidden || resumeSuppressionUntil > now) {
        wasPageHidden = false;
        beginResumeSuppression(now, 1000);
        return true;
      }

      return false;
    }

    if (eventType === "pagehide" || eventType === "freeze") {
      reallyHidden = true;
      wasPageHidden = true;
      beginResumeSuppression(now);
      return false;
    }

    if (eventType === "focus" || eventType === "resume") {
      if (resumeSuppressionUntil > now) {
        return true;
      }
    }

    return false;
  }

  function suppressResumeLifecycleEvent(event) {
    if (!shouldSuppressResumeLifecycleEvent(event)) {
      return;
    }

    try {
      event.stopImmediatePropagation();
      event.stopPropagation();
      event.preventDefault();
      console.debug(BLOCK_MSG, "resume-lifecycle", event.type);
      reportStat("preventedRefreshes", 1);
    } catch (_error) {
      // Ignore if the browser does not allow cancelling a given lifecycle event.
    }
  }

  function guardLocationPropertySetter(propertyName, createNextUrl) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(Location.prototype, propertyName);
      if (!descriptor || typeof descriptor.set !== "function" || typeof descriptor.get !== "function") {
        return;
      }

      Object.defineProperty(Location.prototype, propertyName, {
        configurable: true,
        enumerable: descriptor.enumerable ?? true,
        get: descriptor.get,
        set(value) {
          const nextUrl = createNextUrl(value);
          if (nextUrl && shouldBlockNavigationTarget(nextUrl.href)) {
            console.debug(BLOCK_MSG, `location.${propertyName} setter`, nextUrl.href);
            reportStat("preventedRefreshes", 1);
            return;
          }

          descriptor.set.call(this, value);
        }
      });
    } catch (_error) {
      // Ignore if browser blocks overriding Location property setters.
    }
  }

  function guardLocationHrefSetter() {
    try {
      const hrefDescriptor = Object.getOwnPropertyDescriptor(Location.prototype, "href");
      if (!hrefDescriptor || typeof hrefDescriptor.set !== "function") {
        return;
      }

      Object.defineProperty(Location.prototype, "href", {
        configurable: true,
        enumerable: true,
        get: hrefDescriptor.get,
        set(value) {
          if (shouldBlockNavigationTarget(value)) {
            console.debug(BLOCK_MSG, "location.href setter", value);
            reportStat("preventedRefreshes", 1);
            return;
          }

          hrefDescriptor.set.call(this, value);
        }
      });
    } catch (_error) {
      // Ignore if browser blocks overriding location.href.
    }
  }

  function guardHostLocationSetter(hostPrototype, hostName) {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(hostPrototype, "location");
      if (!descriptor || typeof descriptor.set !== "function" || typeof descriptor.get !== "function") {
        return;
      }

      Object.defineProperty(hostPrototype, "location", {
        configurable: true,
        enumerable: descriptor.enumerable ?? true,
        get: descriptor.get,
        set(value) {
          const target = toNavigationTarget(value);
          if (target && shouldBlockNavigationTarget(target)) {
            console.debug(BLOCK_MSG, `${hostName}.location setter`, target);
            reportStat("preventedRefreshes", 1);
            return;
          }

          descriptor.set.call(this, value);
        }
      });
    } catch (_error) {
      // Ignore if browser blocks overriding host location setter.
    }
  }

  function spoofVisibilityState() {
    try {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        enumerable: true,
        get() {
          return "visible";
        }
      });

      Object.defineProperty(document, "hidden", {
        configurable: true,
        enumerable: true,
        get() {
          return false;
        }
      });

      Object.defineProperty(document, "webkitVisibilityState", {
        configurable: true,
        enumerable: true,
        get() {
          return "visible";
        }
      });

      Object.defineProperty(document, "webkitHidden", {
        configurable: true,
        enumerable: true,
        get() {
          return false;
        }
      });
    } catch (_error) {
      // Ignore if browser blocks overriding visibility properties.
    }

    try {
      const originalHasFocus = Document.prototype.hasFocus;
      Document.prototype.hasFocus = function () {
        return true;
      };
      Document.prototype.hasFocus.__facebergOriginal = originalHasFocus;
    } catch (_error) {
      // Ignore if browser blocks overriding hasFocus.
    }
  }

  function guardWindowOpen() {
    try {
      const originalOpen = window.open;
      if (typeof originalOpen !== "function") {
        return;
      }

      window.open = function (url, target, ...rest) {
        const effectiveTarget = target === undefined ? "_blank" : String(target);
        const isSelfTarget =
          effectiveTarget === "_self" ||
          effectiveTarget === "" ||
          effectiveTarget === "_top" ||
          effectiveTarget === "_parent";

        if (isSelfTarget && url && shouldBlockNavigationTarget(url)) {
          console.debug(BLOCK_MSG, "window.open", url, effectiveTarget);
          reportStat("preventedRefreshes", 1);
          return null;
        }

        return originalOpen.apply(this, [url, target, ...rest]);
      };

      window.open.__facebergOriginal = originalOpen;
    } catch (_error) {
      // Ignore if browser blocks overriding window.open.
    }
  }

  function guardFetch() {
    try {
      const originalFetch = window.fetch;
      if (typeof originalFetch !== "function") {
        return;
      }

      window.fetch = function guardedFetch(resource, init) {
        try {
          if (resumeSuppressionUntil > Date.now()) {
            const sinceInteraction = Date.now() - lastUserInteractionAt;
            const isAutomatic = lastUserInteractionAt === 0 || sinceInteraction > 2000;

            if (isAutomatic) {
              const url = resource instanceof Request ? resource.url : String(resource ?? "");
              const method = (
                (init?.method) ||
                (resource instanceof Request ? resource.method : undefined) ||
                "GET"
              ).toUpperCase();

              if (method === "POST" && /\.facebook\.com\/api\/graphql\//i.test(url)) {
                const delay = Math.max(200, resumeSuppressionUntil - Date.now() + 200);
                console.debug(BLOCK_MSG, "delaying auto graphql feed-refresh", delay + "ms");
                return new Promise((resolve, reject) => {
                  setTimeout(() => {
                    originalFetch.apply(window, [resource, init]).then(resolve, reject);
                  }, delay);
                });
              }
            }
          }
        } catch (_error) {
          // Ignore guard check errors, fall through.
        }

        return originalFetch.apply(window, [resource, init]);
      };

      window.fetch.__facebergOriginal = originalFetch;
    } catch (_error) {
      // Ignore if browser blocks overriding fetch.
    }
  }

  function guardNavigationAPI() {
    if (!window.navigation) {
      return;
    }

    try {
      if (typeof window.navigation.navigate === "function") {
        const originalNavigate = window.navigation.navigate.bind(window.navigation);

        window.navigation.navigate = function (url, options) {
          if (url && shouldBlockNavigationTarget(url)) {
            console.debug(BLOCK_MSG, "navigation.navigate", url);
            reportStat("preventedRefreshes", 1);
            const aborted = Promise.reject(new DOMException("Blocked by Faceberg", "AbortError"));
            aborted.catch(() => {});
            return { committed: aborted, finished: aborted };
          }

          return originalNavigate(url, options);
        };

        window.navigation.navigate.__facebergOriginal = originalNavigate;
      }
    } catch (_error) {
      // Ignore if browser blocks overriding navigation.navigate.
    }

    try {
      if (typeof window.navigation.reload === "function") {
        const originalReload = window.navigation.reload.bind(window.navigation);

        window.navigation.reload = function () {
          console.debug(BLOCK_MSG, "navigation.reload");
          reportStat("preventedRefreshes", 1);
          const aborted = Promise.reject(new DOMException("Blocked by Faceberg", "AbortError"));
          aborted.catch(() => {});
          return { committed: aborted, finished: aborted };
        };

        window.navigation.reload.__facebergOriginal = originalReload;
      }
    } catch (_error) {
      // Ignore if browser blocks overriding navigation.reload.
    }
  }

  guardLocationReload();
  guardLocationNavigationMethods();
  guardLocationHrefSetter();
  guardHostLocationSetter(Window.prototype, "window");
  guardHostLocationSetter(Document.prototype, "document");
  guardWindowOpen();
  guardNavigationAPI();
  guardLocationPropertySetter("search", (value) => {
    const nextUrl = new URL(window.location.href);
    nextUrl.search = String(value ?? "");
    return nextUrl;
  });
  guardLocationPropertySetter("pathname", (value) => {
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = String(value ?? nextUrl.pathname);
    return nextUrl;
  });
  guardHistoryReloads();
  guardFetch();
  guardSuspiciousLifecycleListeners();
  guardSuspiciousEventHandlerProperties();
  guardStringTimeoutReload();
  spoofVisibilityState();
  removeMetaRefresh();

  document.addEventListener("visibilitychange", suppressResumeLifecycleEvent, true);
  window.addEventListener("pageshow", suppressResumeLifecycleEvent, true);
  document.addEventListener("click", () => { lastUserInteractionAt = Date.now(); }, { capture: true, passive: true });
  document.addEventListener("keydown", () => { lastUserInteractionAt = Date.now(); }, { capture: true, passive: true });
  document.addEventListener("touchstart", () => { lastUserInteractionAt = Date.now(); }, { capture: true, passive: true });
  window.addEventListener("pagehide", suppressResumeLifecycleEvent, true);
  window.addEventListener("freeze", suppressResumeLifecycleEvent, true);
  window.addEventListener("focus", suppressResumeLifecycleEvent, true);
  window.addEventListener("resume", suppressResumeLifecycleEvent, true);

  // Block reload/navigation logic triggered by online/offline events
  function blockOnlineOfflineReload(e) {
    try {
      e.stopImmediatePropagation();
      e.stopPropagation();
      e.preventDefault();
      console.debug(BLOCK_MSG, "blocked online/offline event reload", e.type);
      reportStat("preventedRefreshes", 1);
    } catch {}
  }
  window.addEventListener("online", blockOnlineOfflineReload, true);
  window.addEventListener("offline", blockOnlineOfflineReload, true);

  // Override window.ononline/onoffline
  try {
    Object.defineProperty(window, "ononline", {
      configurable: true,
      enumerable: true,
      get() { return null; },
      set(fn) {
        if (typeof fn === "function") {
          console.debug(BLOCK_MSG, "blocked window.ononline assignment");
          reportStat("preventedRefreshes", 1);
        }
      }
    });
    Object.defineProperty(window, "onoffline", {
      configurable: true,
      enumerable: true,
      get() { return null; },
      set(fn) {
        if (typeof fn === "function") {
          console.debug(BLOCK_MSG, "blocked window.onoffline assignment");
          reportStat("preventedRefreshes", 1);
        }
      }
    });
  } catch {}

  const observer = new MutationObserver(() => removeMetaRefresh());
  observer.observe(document.documentElement || document, {
    childList: true,
    subtree: true
  });

})();
