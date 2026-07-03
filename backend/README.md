# DeepPulse — Backend API

Express.js REST API for the DeepPulse game.  
Zero database setup — uses local JSON files for persistence.

## Setup

```bash
npm install
npm run dev   # development (nodemon)
npm start     # production
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/leaderboard` | Top 10 scores |
| GET | `/api/leaderboard?limit=25` | Top N scores |
| POST | `/api/leaderboard` | Submit score |
| GET | `/api/stats` | Global game stats |

## POST /api/leaderboard

**Body:**
```json
{
  "playerName": "PilotX",
  "score": 4200,
  "depth": 850,
  "duration": 93,
  "wave": 7
}
```

**Response:**
```json
{
  "success": true,
  "rank": 3,
  "entry": { ... },
  "leaderboard": [ ... ]
}
```

## Data Storage

Scores are stored in `config/scores.json` (auto-created).  
Global stats in `config/stats.json` (auto-created).
