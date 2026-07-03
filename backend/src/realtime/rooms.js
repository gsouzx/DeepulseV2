// In-memory room state for the multiplayer test mode. No persistence, no
// auth, no anti-cheat validation — this is step 1 of the multiplayer
// roadmap (networking infra, server-simulated shared enemies, and now
// server-authoritative collision/damage). Everything here resets on
// server restart.
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

const MAX_ENEMIES_PER_ROOM = 8;
const ENEMY_SPAWN_INTERVAL_MS = 2000;
const ENEMY_SPAWN_PADDING = 40;

// Same per-type stats as frontend/src/entities/enemy-types.ts.
const ENEMY_SPECS = {
  jellyfish: { speed: 80, r: 18, hp: 1, dmg: 20 },
  angler: { speed: 104, r: 14, hp: 2, dmg: 30 },
  leviathan: { speed: 56, r: 26, hp: 4, dmg: 40 },
};
const ENEMY_TYPE_IDS = Object.keys(ENEMY_SPECS);

// Same per-frame-of-contact damage factor as single-player's checkCollisions().
const CONTACT_DAMAGE_FACTOR = 0.5;

const DEFAULT_SKIN_ID = 'standard';
const DEFAULT_MAX_HEALTH = 100;
const DEFAULT_PLAYER_RADIUS = 14;

/**
 * @type {Map<string, {
 *   players: Map<string, { x: number, y: number, skinId: string, health: number, maxHealth: number, radius: number, updatedAt: number }>,
 *   enemies: Map<string, { id: string, type: string, x: number, y: number, hp: number }>,
 *   nextEnemyId: number,
 *   lastEnemySpawnAt: number,
 * }>}
 */
const rooms = new Map();

/** @type {Map<string, string>} playerId -> roomId, for O(1) lookup on move/disconnect */
const playerRoom = new Map();

let nextRoomNumber = 1;

function createRoomState() {
  return { players: new Map(), enemies: new Map(), nextEnemyId: 1, lastEnemySpawnAt: 0 };
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
 * room id and its current roster + enemies (including the player that just joined).
 */
function joinRoom(playerId, skinId, maxHealth, radius) {
  const roomId = findRoomWithSpace() ?? createRoom();
  const room = rooms.get(roomId);
  const effectiveMaxHealth = sanitizePositiveNumber(maxHealth, DEFAULT_MAX_HEALTH);
  room.players.set(playerId, {
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT / 2,
    skinId: sanitizeSkinId(skinId),
    health: effectiveMaxHealth,
    maxHealth: effectiveMaxHealth,
    radius: sanitizePositiveNumber(radius, DEFAULT_PLAYER_RADIUS),
    updatedAt: Date.now(),
  });
  playerRoom.set(playerId, roomId);
  return { roomId, players: getRoomPlayers(roomId), enemies: getRoomEnemies(roomId) };
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

/** Removes the player from its room, deleting the room (and its enemies) if it's now empty. Returns the vacated room id, or null. */
function leaveRoom(playerId) {
  const roomId = playerRoom.get(playerId);
  if (!roomId) return null;
  playerRoom.delete(playerId);
  const room = rooms.get(roomId);
  if (room) {
    room.players.delete(playerId);
    if (room.players.size === 0) rooms.delete(roomId);
  }
  return roomId;
}

function getRoomPlayers(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.players, ([id, p]) => ({
    id,
    x: p.x,
    y: p.y,
    skinId: p.skinId,
    health: p.health,
    maxHealth: p.maxHealth,
  }));
}

function getRoomEnemies(roomId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.enemies.values(), e => ({ id: e.id, type: e.type, x: e.x, y: e.y }));
}

/** Room ids that currently have at least one player — the tick loop only simulates/broadcasts these. */
function getActiveRoomIds() {
  return Array.from(rooms.keys());
}

/** Spawns one enemy from a world-space edge if the room is under its cap and the spawn interval has elapsed. */
function maybeSpawnEnemy(roomId, now) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.enemies.size >= MAX_ENEMIES_PER_ROOM) return;
  if (now - room.lastEnemySpawnAt < ENEMY_SPAWN_INTERVAL_MS) return;
  room.lastEnemySpawnAt = now;

  const type = ENEMY_TYPE_IDS[Math.floor(Math.random() * ENEMY_TYPE_IDS.length)];
  const side = Math.floor(Math.random() * 4);
  let x, y;
  if (side === 0) { x = Math.random() * WORLD_WIDTH; y = -ENEMY_SPAWN_PADDING; }
  else if (side === 1) { x = WORLD_WIDTH + ENEMY_SPAWN_PADDING; y = Math.random() * WORLD_HEIGHT; }
  else if (side === 2) { x = Math.random() * WORLD_WIDTH; y = WORLD_HEIGHT + ENEMY_SPAWN_PADDING; }
  else { x = -ENEMY_SPAWN_PADDING; y = Math.random() * WORLD_HEIGHT; }

  const id = `enemy-${room.nextEnemyId++}`;
  room.enemies.set(id, { id, type, x, y, hp: ENEMY_SPECS[type].hp });
}

/** Moves every enemy in the room toward whichever player is currently nearest. */
function stepEnemies(roomId, dtSeconds) {
  const room = rooms.get(roomId);
  if (!room || room.players.size === 0 || room.enemies.size === 0) return;
  const players = Array.from(room.players.values());

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
    const speed = ENEMY_SPECS[enemy.type].speed;
    const angle = Math.atan2(nearest.y - enemy.y, nearest.x - enemy.x);
    enemy.x += Math.cos(angle) * speed * dtSeconds;
    enemy.y += Math.sin(angle) * speed * dtSeconds;
  });
}

/**
 * Same rule as single-player's checkCollisions(): every tick a player
 * overlaps a live enemy, the enemy loses 1 hp and the player takes
 * `dmg * CONTACT_DAMAGE_FACTOR`. No shield/kill mechanic in multiplayer yet,
 * so this is purely "sustained contact chips both sides down". Health
 * clamps at 0 — what happens at 0 (respawn, game over) isn't decided yet.
 */
function applyCollisions(roomId) {
  const room = rooms.get(roomId);
  if (!room || room.players.size === 0 || room.enemies.size === 0) return;

  room.enemies.forEach(enemy => {
    if (enemy.hp <= 0) return;
    const spec = ENEMY_SPECS[enemy.type];
    room.players.forEach(player => {
      if (enemy.hp <= 0 || player.health <= 0) return;
      const dist = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      if (dist >= player.radius + spec.r) return;

      enemy.hp -= 1;
      player.health = Math.max(0, player.health - spec.dmg * CONTACT_DAMAGE_FACTOR);
    });
  });

  for (const [id, enemy] of room.enemies) {
    if (enemy.hp <= 0) room.enemies.delete(id);
  }
}

module.exports = {
  MAX_PLAYERS_PER_ROOM,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  joinRoom,
  updatePosition,
  leaveRoom,
  getRoomPlayers,
  getRoomEnemies,
  getActiveRoomIds,
  maybeSpawnEnemy,
  stepEnemies,
  applyCollisions,
};
