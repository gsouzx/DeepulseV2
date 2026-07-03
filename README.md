# 🌊 DeepPulse V2 — Ocean Survival Game

> A dark sci-fi ocean survival game: TypeScript + Vite Canvas frontend, Node/Express + Socket.io backend. Single-player survival with a skin/progression system, plus an experimental real-time multiplayer mode.

## 🎮 Gameplay

Control a deep-sea probe navigating the abyss. Dodge hostile creatures, collect energy cores, and survive as long as possible — the deeper you go, the more dangerous it gets. Reach higher waves to permanently unlock new probe skins with real stat trade-offs (more health, bigger hitbox).

**Controls:**
- `WASD` or `Arrow Keys` — Move probe
- `Space` — Activate shield (limited uses)
- `Esc` — Pause

## 🗂️ Project Structure

```
deeppulse/
├── frontend/               # TypeScript + Vite, Canvas 2D
│   ├── index.html          # Vite entry point
│   └── src/
│       ├── main.ts         # game engine (single-player + multiplayer test mode)
│       ├── skins.ts        # skin catalog, unlock rules, stat power
│       ├── multiplayer.ts  # socket.io-client wrapper
│       ├── entities/       # shared enemy type definitions + rendering
│       ├── rendering/      # canvas draw helpers
│       └── utils/          # pure helpers (math, etc.), unit tested
│
├── backend/                # Node.js + Express REST API + Socket.io
│   ├── src/
│   │   ├── routes/         # API routes
│   │   ├── controllers/    # business logic
│   │   ├── models/         # data models (JSON storage)
│   │   └── realtime/       # Socket.io rooms, server-simulated enemies, collision
│   └── config/              # auto-created scores.json / stats.json
│
└── README.md
```

## 🚀 Running Locally

Needs two terminals — the backend (REST API + Socket.io) and the frontend (Vite dev server) run separately.

### Backend
```bash
cd backend
npm install
npm run dev
# REST + Socket.io on http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:5500
```

Copy `backend/.env.example` → `backend/.env` and `frontend/.env.example` → `frontend/.env` if you need to change ports/origins — sane localhost defaults are included.

## 🛠️ Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | TypeScript, Vite, HTML5 Canvas, Vitest |
| Backend | Node.js, Express.js, Socket.io |
| Storage | JSON file (no DB needed — zero setup; SQLite migration planned) |
| Realtime | Socket.io rooms, server-authoritative enemy simulation & collision |

## 📡 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/leaderboard` | Top 10 scores |
| `POST` | `/api/leaderboard` | Submit score |
| `GET` | `/api/stats` | Global game stats |

## ✨ Features

- 🎮 Smooth 60fps Canvas gameplay with a fixed-dt-clamped game loop
- 🐙 3 enemy types with distinct AI-lite chase behavior, shared 1:1 between single-player and multiplayer
- 🧬 Skin/progression system: permanent unlocks tied to best wave reached, real stat trade-offs (health vs. hitbox size)
- 🕹️ Experimental real-time multiplayer test mode: Socket.io rooms, server-simulated shared enemies, server-authoritative collision/damage
- 🏆 Persistent leaderboard (backend)
- 🌑 Bioluminescent dark UI

## 🚧 Status

Actively evolving from a single-player prototype (v1) into a v2 with TypeScript, tests, and multiplayer. The multiplayer mode currently has no nicknames, scoreboard, or anti-cheat — networking/collision infrastructure comes first, polish later.

**Deploying it yourself:** the frontend is a static Vite build (Vercel, Netlify, etc. all work fine). The backend needs a host that keeps a persistent Node process alive (Render, Railway, Fly.io) — Socket.io's room state lives in memory and its game loop runs on a `setInterval`, neither of which survives on serverless/ephemeral platforms like Vercel functions.

## 👤 Author

Made with 💙 for portfolio purposes.
Feel free to fork, star ⭐, and adapt!

## 📄 License

MIT — Use freely, credit appreciated.
