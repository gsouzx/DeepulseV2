const { getTopScores, saveScore, updateStats } = require('../models/Score');

function getLeaderboard(req, res) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const scores = getTopScores(limit);
    res.json({ success: true, data: scores, count: scores.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve leaderboard.' });
  }
}

function postScore(req, res) {
  try {
    const { playerName, score, depth, duration, wave } = req.body;

    // Validation
    if (!playerName || typeof playerName !== 'string') {
      return res.status(400).json({ error: 'Invalid player name.' });
    }
    if (typeof score !== 'number' || score < 0 || score > 9999999) {
      return res.status(400).json({ error: 'Invalid score value.' });
    }

    const sanitizedName = playerName.trim().slice(0, 20).replace(/[^a-zA-Z0-9_\-. ]/g, '');

    const entry = {
      id: Date.now().toString(36),
      playerName: sanitizedName || 'Anonymous',
      score: Math.floor(score),
      depth: Math.floor(depth) || 0,
      duration: Math.floor(duration) || 0,
      wave: Math.floor(wave) || 1,
      submittedAt: new Date().toISOString()
    };

    const leaderboard = saveScore(entry);
    updateStats(entry.score, entry.depth);

    const rank = leaderboard.findIndex(s => s.id === entry.id) + 1;

    res.status(201).json({
      success: true,
      message: rank > 0 ? `You ranked #${rank} on the leaderboard!` : 'Score submitted!',
      rank: rank > 0 ? rank : null,
      entry,
      leaderboard
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit score.' });
  }
}

module.exports = { getLeaderboard, postScore };
