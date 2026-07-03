const { getStats } = require('../models/Score');

function getGameStats(req, res) {
  try {
    const stats = getStats();
    const avgScore = stats.totalGames > 0
      ? Math.floor(stats.totalScore / stats.totalGames)
      : 0;

    res.json({
      success: true,
      data: {
        ...stats,
        averageScore: avgScore
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve stats.' });
  }
}

module.exports = { getGameStats };
