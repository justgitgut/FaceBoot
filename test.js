// Quick test for buildImpactShowcase logic
const stats = {
  removedReels: 10,
  removedSponsored: 5,
  expandedPosts: 20,
  expandedComments: 15,
  preventedRefreshes: 3
};

function formatStat(value) {
  return Number(value || 0).toLocaleString();
}

const impactItems = [
  {
    icon: "🧹",
    text: `Auto-removed ${formatStat(stats.removedReels || 0)} Reels and ${formatStat(stats.removedSponsored || 0)} sponsored posts`,
    meta: "from your feed"
  },
  {
    icon: "📖",
    text: `Expanded ${formatStat(stats.expandedPosts || 0)} posts and ${formatStat(stats.expandedComments || 0)} comment threads`,
    meta: "without clicking 'See more'"
  },
  {
    icon: "🛡️",
    text: `Prevented ${formatStat(stats.preventedRefreshes || 0)} page reloads`,
    meta: "when switching tabs"
  }
].filter(item => {
  // Only show items with non-zero values
  const text = item.text;
  const numbers = text.match(/\d+/g);
  return numbers && numbers.some(num => parseInt(num) > 0);
});

console.log('Filtered impact items:', impactItems.length);
impactItems.forEach(item => console.log(item.text));