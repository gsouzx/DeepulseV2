const { getTopMpScores } = require('../models/MpRoomScore');

function getMpLeaderboard(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const scores = getTopMpScores(limit);
    res.json({ success: true, data: scores, count: scores.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve multiplayer leaderboard.' });
  }
}

module.exports = { getMpLeaderboard };
