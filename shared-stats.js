(() => {
  "use strict";

  const CLEANUP_STATS = [
    { key: "removedReels", label: "Reels removed" },
    { key: "removedFollowPosts", label: "Follow posts" },
    { key: "removedJoinPosts", label: "Join posts" },
    { key: "removedStories", label: "Stories removed" },
    { key: "removedPeopleYouMayKnow", label: "People you may know" },
    { key: "removedSponsored", label: "Sponsored removed" }
  ];

  const ACTIVITY_STATS = [
    { key: "preventedRefreshes", label: "Refreshes blocked" },
    { key: "commentFilterChanges", label: "Filter changes" },
    { key: "expandedPosts", label: "Posts expanded" },
    { key: "expandedComments", label: "Comment actions" }
  ];

  function toSessionKey(statKey) {
    return `session${statKey.charAt(0).toUpperCase()}${statKey.slice(1)}`;
  }

  const ALL_STATS = [...CLEANUP_STATS, ...ACTIVITY_STATS];
  const DEFAULT_STATS = Object.fromEntries(ALL_STATS.map(({ key }) => [key, 0]));
  const SESSION_STATS_DEFAULTS = Object.fromEntries(ALL_STATS.map(({ key }) => [toSessionKey(key), 0]));

  globalThis.FaceBootStats = {
    CLEANUP_STATS,
    ACTIVITY_STATS,
    ALL_STATS,
    DEFAULT_STATS,
    SESSION_STATS_DEFAULTS,
    toSessionKey
  };
})();