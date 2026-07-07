const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../config');
const MP_SCORES_FILE = path.join(DATA_DIR, 'mp-scores.json');

// A room's result — no player name attached, since multiplayer test mode
// has no nickname system yet. Ranked by how far the room's shared wave got,
// tie-broken by how long the room survived.
function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MP_SCORES_FILE)) {
    fs.writeFileSync(MP_SCORES_FILE, JSON.stringify({ scores: [] }, null, 2));
  }
}

ensureFile();

function getMpScores() {
  const raw = fs.readFileSync(MP_SCORES_FILE, 'utf8');
  return JSON.parse(raw).scores;
}

function sortMpScores(scores) {
  return [...scores].sort((a, b) => b.wave - a.wave || b.durationSeconds - a.durationSeconds);
}

/** Called when a room closes (its last player left) — records the room's final result. Returns nothing; this isn't a client-facing submission, it's automatic. */
function saveMpRoomScore(entry) {
  const scores = getMpScores();
  scores.push(entry);
  const top = sortMpScores(scores).slice(0, 50); // keep top 50
  fs.writeFileSync(MP_SCORES_FILE, JSON.stringify({ scores: top }, null, 2));
}

function getTopMpScores(limit = 10) {
  return sortMpScores(getMpScores()).slice(0, limit);
}

module.exports = { saveMpRoomScore, getTopMpScores };
