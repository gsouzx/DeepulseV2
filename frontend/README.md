# DeepPulse — Frontend

Canvas 2D game, built with TypeScript + Vite.

## Running

```bash
npm install
npm run dev
# Open http://localhost:5500
```

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Vite dev server with hot reload |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run lint` | Run ESLint |
| `npm run format` | Format the codebase with Prettier |

## Structure

```
frontend/
├── index.html          # Vite entry point (all screens, HUD, styles)
└── src/
    ├── main.ts         # v1 game engine, ported as-is (see note below)
    └── utils/
        ├── math.ts      # pure math helpers (clamp, lerp, dist, rnd)
        └── math.test.ts # Vitest unit tests
```

> **Migration note:** `src/main.ts` is the original monolithic game engine
> carried over unchanged (marked `@ts-nocheck`) so the toolchain (Vite +
> TypeScript + ESLint + Vitest) could be introduced without touching
> gameplay. It will be split into typed modules under `src/entities`,
> `src/systems`, `src/rendering`, `src/input`, `src/state` and `src/audio`
> in the next refactor pass — see the project roadmap.

## Game Engine Features

- 60fps Canvas 2D rendering loop
- Entity component system (probe, enemies, pickups, particles)
- Parallax bioluminescent background
- 3 enemy types (Jellyfish, Angler, Leviathan)
- Progressive wave system with difficulty scaling
- Shield mechanic with cooldown/recharge
- Pickup system (Energy, Health, Shield)
- Particle burst effects
- Fullscreen responsive canvas
- REST API integration (leaderboard submit/fetch)

## Connecting to Backend

The game connects to `http://localhost:3001/api` by default.
Change `API_BASE` in `src/main.ts` if your backend is on a different port.

If the backend is offline, the game still works fully — score submission shows a graceful fallback.
