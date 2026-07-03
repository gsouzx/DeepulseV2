const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../config');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

// Ensure config dir and files exist
function ensureFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SCORES_FILE)) {
    fs.writeFileSync(SCORES_FILE, JSON.stringify({ scores: [] }, null, 2));
  }
  if (!fs.existsSync(STATS_FILE)) {
    fs.writeFileSync(STATS_FILE, JSON.stringify({
      totalGames: 0,
      totalScore: 0,
      highestScore: 0,
      highestDepth: 0,
      createdAt: new Date().toISOString()
    }, null, 2));
  }
}

ensureFiles();

// Scores
function getScores() {
  const raw = fs.readFileSync(SCORES_FILE, 'utf8');
  return JSON.parse(raw).scores;
}

function saveScore(entry) {
  const scores = getScores();
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  const top = scores.slice(0, 50); // Keep top 50
  fs.writeFileSync(SCORES_FILE, JSON.stringify({ scores: top }, null, 2));
  return top.slice(0, 10); // Return top 10
}

function getTopScores(limit = 10) {
  return getScores().slice(0, limit);
}

// Stats
function getStats() {
  const raw = fs.readFileSync(STATS_FILE, 'utf8');
  return JSON.parse(raw);
}

function updateStats(score, depth) {
  const stats = getStats();
  stats.totalGames += 1;
  stats.totalScore += score;
  if (score > stats.highestScore) stats.highestScore = score;
  if (depth > stats.highestDepth) stats.highestDepth = depth;
  fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  return stats;
}

module.exports = { getTopScores, saveScore, getStats, updateStats };
