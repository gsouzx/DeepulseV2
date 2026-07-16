// In-memory room state for the multiplayer test mode. No persistence, no
// auth, no anti-cheat validation — this is step 1 of the multiplayer
// roadmap (networking infra, server-simulated shared enemies, and now
// server-authoritative collision/damage/death/wave-progression/revive).
// Everything here resets on server restart (except the room result, which
// gets handed off to the mp-leaderboard model when the room closes).
//
// Enemies and players move in a fixed "world space" (WORLD_WIDTH x
// WORLD_HEIGHT) instead of pixels, because each client's canvas is a
// different size — clients map world <-> local pixel space on their end.
//
// Collision runs on the server (not each client) because enemies are a
// shared simulation: every client must agree on when a hit happened, and
// the server is the only party that sees every player's latest reported
// position each tick. Damage values mirror the single-player rules in
// frontend/src/entities/enemy-types.ts — keep the two in sync by hand,
// there's no shared package between the Node backend and the Vite
// frontend to enforce it automatically.

const MAX_PLAYERS_PER_ROOM = 6;
const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 720;

// Difficulty scales with how many players are actually alive right now, not
// just connected — a room full of downed players eases back up instead of
// staying maxed out with nobody left to fight back. A lone player (or a
// room where everyone died) sees exactly the base numbers below.
const BASE_MAX_ENEMIES = 8;
const EXTRA_ENEMIES_PER_PLAYER = 2;
const MAX_ENEMIES_CAP = 20;

const BASE_ENEMY_SPAWN_INTERVAL_MS = 2000;
const SPAWN_SPEEDUP_PER_EXTRA_PLAYER = 0.12; // each extra player shaves 12% off the spawn interval
const MIN_SPAWN_INTERVAL_FACTOR = 0.4; // floor, so spawns never get absurdly fast

const ENEMY_SPAWN_PADDING = 40;

// Same per-type stats as frontend/src/entities/enemy-types.ts.
const ENEMY_SPECS = {
  jellyfish: { speed: 80, r: 18, hp: 1, dmg: 20, points: 100 },
  angler: { speed: 104, r: 14, hp: 2, dmg: 30, points: 200 },
  leviathan: { speed: 56, r: 26, hp: 4, dmg: 40, points: 500 },
};
const ENEMY_TYPE_IDS = Object.keys(ENEMY_SPECS);

// Same per-frame-of-contact damage factor as single-player's checkCollisions().
const CONTACT_DAMAGE_FACTOR = 0.5;
// Same shield-kill discount as single-player's checkCollisions() shieldActive branch.
const SHIELD_KILL_SCORE_FACTOR = 0.5;
// Sanity clamp on client-reported shield duration — no anti-cheat validation elsewhere in
// this test mode, but an unbounded value here would let a client claim permanent invulnerability.
const MAX_SHIELD_DURATION_MS = 10000;

// ── Wave progression (shared by the whole room) ────────────────────────
const WAVE_ENEMY_BASE = 6; // kills needed to clear wave 1
const WAVE_ENEMY_GROW = 3; // extra kills required per wave above 1
const WAVE_SPEED_GROWTH_PER_WAVE = 0.06; // +6% enemy speed per wave above 1
const WAVE_HP_GROWTH_PER_WAVE = 0.4; // enemies gain a little extra hp per wave above 1
const WAVE_TRANSITION_HEAL = 20; // healed to every alive player when the room clears a wave

// ── Revive ──────────────────────────────────────────────────────────────
const REVIVE_RADIUS = 46; // world-space units — an alive teammate this close revives a downed player
const REVIVE_HOLD_MS = 3000; // continuous nearby time needed for a teammate to fully revive someone
const SELF_REVIVE_DELAY_MS = 10000; // a downed player can self-revive after this, if nobody comes

const DEFAULT_SKIN_ID = 'standard';
const DEFAULT_MAX_HEALTH = 100;
const DEFAULT_PLAYER_RADIUS = 14;

// ── Nickname ──────────────────────────────────────────────────────────────
// Mirrors frontend/src/nickname.ts exactly (letters incl. accents, digits,
// space, hyphen, underscore; 12 chars max) — never trust the client-side
// sanitization alone, a hand-crafted socket payload can send anything.
const MAX_NICKNAME_LENGTH = 12;
const INVALID_NICKNAME_CHARS_REGEX = /[^\p{L}\p{N} _-]/gu;

function sanitizeNickname(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(INVALID_NICKNAME_CHARS_REGEX, '').trim().slice(0, MAX_NICKNAME_LENGTH);
}

function generateFallbackNickname() {
  const digits = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `Piloto ${digits}`;
}

function resolveNickname(raw) {
  return sanitizeNickname(raw) || generateFallbackNickname();
}

/**
 * @type {Map<string, {
 *   players: Map<string, { x: number, y: number, skinId: string, nickname: string, health: number, maxHealth: number, radius: number, alive: boolean, diedAt: number|null, reviveProgressMs: number, score: number, shieldUntil: number, updatedAt: number }>,
 *   enemies: Map<string, { id: string, type: string, x: number, y: number, hp: number, speed: number }>,
 *   nextEnemyId: number,
 *   lastEnemySpawnAt: number,
 *   wave: number,
 *   waveKills: number,
 *   enemiesRequiredForWave: number,
 *   createdAt: number,
 *   peakPlayers: number,
 * }>}
 */
const rooms = new Map();

/** @type {Map<string, string>} playerId -> roomId, for O(1) lookup on move/disconnect */
const playerRoom = new Map();

let nextRoomNumber = 1;

function createRoomState() {
  return {
    players: new Map(),
    enemies: new Map(),
    nextEnemyId: 1,
    lastEnemySpawnAt: 0,
    wave: 1,
    waveKills: 0,
    enemiesRequiredForWave: WAVE_ENEMY_BASE,
    createdAt: Date.now(),
    peakPlayers: 0,
  };
}

function findRoomWithSpace() {
  for (const [roomId, room] of rooms) {
    if (room.players.size < MAX_PLAYERS_PER_ROOM) return roomId;
  }
  return null;
}

function createRoom() {
  const roomId = `room-${nextRoomNumber++}`;
  rooms.set(roomId, createRoomState());
  return roomId;
}

/**
 * The skin catalog (ids, unlock rules, stat power) lives in the frontend
 * (src/skins.ts) since it's presentation/progression data the server has no
 * business owning. The server just stores and echoes back whatever a client
 * reports (skin id, and the max health / radius it already computed from
 * that skin's power), defaulting invalid values — same trust level as
 * positions in this step (no validation).
 */
function sanitizeSkinId(skinId) {
  return typeof skinId === 'string' && skinId.length > 0 ? skinId : DEFAULT_SKIN_ID;
}

function sanitizePositiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Adds a player to the first room with space, or a new one. Returns the
 * room id, its current wave, and its roster + enemies (including the
 * player that just joined).
 */
function joinRoom(playerId, skinId, maxHealth, radius, nickname) {
  const roomId = findRoomWithSpace() ?? createRoom();
  const room = rooms.get(roomId);
  const effectiveMaxHealth = sanitizePositiveNumber(maxHealth, DEFAULT_MAX_HEALTH);
  room.players.set(playerId, {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    skinId: sanitizeSkinId(skinId),
    nickname: resolveNickname(nickname),
    health: effectiveMaxHealth,
    maxHealth: effectiveMaxHealth,
    radius: sanitizePositiveNumber(radius, DEFAULT_PLAYER_RADIUS),
    alive: true,
    diedAt: null,
    reviveProgressMs: 0,
    score: 0,
    shieldUntil: 0,
    updatedAt: Date.now(),
  });
  room.peakPlayers = Math.max(room.peakPlayers, room.players.size);
  playerRoom.set(playerId, roomId);
  return { roomId, wave: room.wave, players: getRoomPlayers(roomId), enemies: getRoomEnemies(roomId) };
}

/** Ignores malformed payloads instead of throwing — this step doesn't validate positions otherwise. */
function updatePosition(playerId, x, y) {
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  const roomId = playerRoom.get(playerId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  const current = room?.players.get(playerId);
  if (!current) return;
  room.players.set(playerId, { ...current, x, y, updatedAt: Date.now() });
}

/**
 * Client-authoritative timing (same trust level as position updates in this
 * test mode): the client decides when its shield activates and for how
 * long, and just informs the server so applyCollisions() can treat the
 * player as invulnerable and every other client can render the glow around
 * them. Duration is clamped so a malicious payload can't claim permanent
 * invulnerability.
 */
function activateShield(playerId, durationMs) {
  const roomId = playerRoom.get(playerId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  const player = room?.players.get(playerId);
  if (!player || !player.alive) return;
  const clampedDuration = Math.min(MAX_SHIELD_DURATION_MS, Math.max(0, sanitizePositiveNumber(durationMs, 0)));
  player.shieldUntil = Date.now() + clampedDuration;
}

/** Shared by both revive paths — brings a downed player back at full health, in the middle of the map. */
function revivePlayer(player) {
  player.health = player.maxHealth;
  player.alive = true;
  player.x = WORLD_WIDTH / 2;
  player.y = WORLD_HEIGHT / 2;
  player.diedAt = null;
  player.reviveProgressMs = 0;
  player.updatedAt = Date.now();
}

/** The death screen's "Reviver" button — only takes effect once SELF_REVIVE_DELAY_MS has passed, so a teammate rushing over is meaningfully faster. */
function respawnPlayer(playerId) {
  const roomId = playerRoom.get(playerId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  const player = room?.players.get(playerId);
  if (!player || player.alive) return;
  if (player.diedAt !== null && Date.now() - player.diedAt < SELF_REVIVE_DELAY_MS) return;
  revivePlayer(player);
}

/**
 * Every tick: any downed player with an alive teammate within REVIVE_RADIUS
 * accrues progress toward a full revive; nobody nearby resets it to zero
 * (no "banking" partial progress between rescue attempts). This is the
 * cooperative alternative to the self-revive cooldown — roughly 3x faster,
 * and the whole point of bringing friends.
 */
function updateRevives(roomId, dtMs) {
  const room = rooms.get(roomId);
  if (!room) return;
  const alivePlayers = Array.from(room.players.values()).filter(p => p.alive);

  room.players.forEach(player => {
    if (player.alive) return;
    const helperNearby = alivePlayers.some(p => Math.hypot(p.x - player.x, p.y - player.y) <= REVIVE_RADIUS);
    if (!helperNearby) {
      player.reviveProgressMs = 0;
      return;
    }
    player.reviveProgressMs += dtMs;
    if (player.reviveProgressMs >= REVIVE_HOLD_MS) {
      revivePlayer(player);
    }
  });
}

/** Removes the player from its room. If that empties the room, the room is deleted and its final result is returned for the mp-leaderboard. */
function leaveRoom(playerId) {
  const roomId = playerRoom.get(playerId);
  if (!roomId) return null;
  playerRoom.delete(playerId);
  const room = rooms.get(roomId);
  if (!room) return { roomId, closedRoomResult: null };

  room.players.delete(playerId);
  let closedRoomResult = null;
  if (room.players.size === 0) {
    closedRoomResult = {
      wave: room.wave,
      durationSeconds: Math.round((Date.now() - room.createdAt) / 1000),
      peakPlayers: room.peakPlayers,
    };
    rooms.delete(roomId);
  }
  return { roomId, closedRoomResult };
}

function getRoomPlayers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.players, ([id, p]) => ({
    id,
    x: p.x,
    y: p.y,
    skinId: p.skinId,
    nickname: p.nickname,
    health: p.health,
    maxHealth: p.maxHealth,
    alive: p.alive,
    score: p.score,
    shieldActive: p.shieldUntil > Date.now(),
    reviveProgress: Math.min(1, p.reviveProgressMs / REVIVE_HOLD_MS),
    selfReviveRemainingMs: p.alive || p.diedAt === null
      ? 0
      : Math.max(0, SELF_REVIVE_DELAY_MS - (Date.now() - p.diedAt)),
  }));
}

function countAlivePlayers(room) {
  let count = 0;
  for (const p of room.players.values()) {
    if (p.alive) count++;
  }
  return count;
}

/** How many enemies a room is allowed to have concurrently, scaled by how many players are alive right now. */
function maxEnemiesForRoom(room) {
  const alive = Math.max(1, countAlivePlayers(room));
  return Math.min(MAX_ENEMIES_CAP, BASE_MAX_ENEMIES + (alive - 1) * EXTRA_ENEMIES_PER_PLAYER);
}

/** How long a room waits between enemy spawns, scaled by how many players are alive right now — more survivors, less breathing room. */
function spawnIntervalForRoom(room) {
  const alive = Math.max(1, countAlivePlayers(room));
  const factor = Math.max(MIN_SPAWN_INTERVAL_FACTOR, 1 - (alive - 1) * SPAWN_SPEEDUP_PER_EXTRA_PLAYER);
  return BASE_ENEMY_SPAWN_INTERVAL_MS * factor;
}

function getRoomEnemies(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.enemies.values(), e => ({ id: e.id, type: e.type, x: e.x, y: e.y }));
}

function getRoomWave(roomId) {
  return rooms.get(roomId)?.wave ?? 1;
}

/** Room ids that currently have at least one player — the tick loop only simulates/broadcasts these. */
function getActiveRoomIds() {
  return Array.from(rooms.keys());
}

/** Spawns one enemy from a world-space edge if the room is under its cap and the spawn interval has elapsed. Hp/speed scale with the room's current wave, fixed at spawn time — matches single-player's per-wave ramp. */
function maybeSpawnEnemy(roomId, now) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.enemies.size >= maxEnemiesForRoom(room)) return;
  if (now - room.lastEnemySpawnAt < spawnIntervalForRoom(room)) return;
  room.lastEnemySpawnAt = now;

  const type = ENEMY_TYPE_IDS[Math.floor(Math.random() * ENEMY_TYPE_IDS.length)];
  const side = Math.floor(Math.random() * 4);
  let x, y;
  if (side === 0) { x = Math.random() * WORLD_WIDTH; y = -ENEMY_SPAWN_PADDING; }
  else if (side === 1) { x = WORLD_WIDTH + ENEMY_SPAWN_PADDING; y = Math.random() * WORLD_HEIGHT; }
  else if (side === 2) { x = Math.random() * WORLD_WIDTH; y = WORLD_HEIGHT + ENEMY_SPAWN_PADDING; }
  else { x = -ENEMY_SPAWN_PADDING; y = Math.random() * WORLD_HEIGHT; }

  const spec = ENEMY_SPECS[type];
  const waveAbove1 = room.wave - 1;
  const id = `enemy-${room.nextEnemyId++}`;
  room.enemies.set(id, {
    id,
    type,
    x,
    y,
    hp: spec.hp + Math.floor(waveAbove1 * WAVE_HP_GROWTH_PER_WAVE),
    speed: spec.speed * (1 + waveAbove1 * WAVE_SPEED_GROWTH_PER_WAVE),
  });
}

/** Moves every enemy in the room toward whichever alive player is currently nearest. Dead players are invisible to them — no reason to keep circling a wreck. */
function stepEnemies(roomId, dtSeconds) {
  const room = rooms.get(roomId);
  if (!room || room.enemies.size === 0) return;
  const players = Array.from(room.players.values()).filter(p => p.alive);
  if (players.length === 0) return;

  room.enemies.forEach(enemy => {
    let nearest = players[0];
    let nearestDist = Infinity;
    for (const p of players) {
      const d = Math.hypot(p.x - enemy.x, p.y - enemy.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = p;
      }
    }
    const angle = Math.atan2(nearest.y - enemy.y, nearest.x - enemy.x);
    enemy.x += Math.cos(angle) * enemy.speed * dtSeconds;
    enemy.y += Math.sin(angle) * enemy.speed * dtSeconds;
  });
}

/**
 * Same rule as single-player's checkCollisions(): every tick a player
 * overlaps a live enemy, the enemy loses 1 hp and the player takes
 * `dmg * CONTACT_DAMAGE_FACTOR` — unless their shield is up (shieldUntil in
 * the future), in which case they take no damage and instead one-shot the
 * enemy for a half-points kill, exactly like single-player's shieldActive
 * branch. The player who lands the killing blow (shielded or not) is
 * credited the enemy's points. Health clamps at 0, which now flips the
 * player to `alive: false` and starts their revive clock — they stop
 * taking/dealing damage and enemies stop chasing them (see stepEnemies)
 * until updateRevives()/respawnPlayer() brings them back. Each enemy kill
 * counts toward the room's shared wave — see checkWaveComplete().
 */
function applyCollisions(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.players.size === 0 || room.enemies.size === 0) return;
  const now = Date.now();

  room.enemies.forEach(enemy => {
    if (enemy.hp <= 0) return;
    const spec = ENEMY_SPECS[enemy.type];
    room.players.forEach(player => {
      if (enemy.hp <= 0 || !player.alive) return;
      const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      if (dist >= player.radius + spec.r) return;

      if (player.shieldUntil > now) {
        enemy.hp = 0;
        player.score += Math.floor(spec.points * SHIELD_KILL_SCORE_FACTOR);
        return;
      }

      enemy.hp -= 1;
      player.health = Math.max(0, player.health - spec.dmg * CONTACT_DAMAGE_FACTOR);
      if (player.health <= 0) {
        player.alive = false;
        player.diedAt = now;
        player.reviveProgressMs = 0;
      }
      if (enemy.hp <= 0) {
        player.score += spec.points;
      }
    });
  });

  for (const [id, enemy] of room.enemies) {
    if (enemy.hp <= 0) {
      room.enemies.delete(id);
      room.waveKills += 1;
    }
  }
}

/** Advances the room's shared wave once enough enemies have died, healing every alive player a little as a reward — same beat as single-player's wave-clear bonus. */
function checkWaveComplete(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.waveKills < room.enemiesRequiredForWave) return;

  room.wave += 1;
  room.waveKills = 0;
  room.enemiesRequiredForWave = WAVE_ENEMY_BASE + (room.wave - 1) * WAVE_ENEMY_GROW;

  room.players.forEach(player => {
    if (!player.alive) return;
    player.health = Math.min(player.maxHealth, player.health + WAVE_TRANSITION_HEAL);
  });
}

module.exports = {
  MAX_PLAYERS_PER_ROOM,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  joinRoom,
  updatePosition,
  activateShield,
  respawnPlayer,
  updateRevives,
  leaveRoom,
  getRoomPlayers,
  getRoomEnemies,
  getRoomWave,
  getActiveRoomIds,
  maybeSpawnEnemy,
  stepEnemies,
  applyCollisions,
  checkWaveComplete,
};
