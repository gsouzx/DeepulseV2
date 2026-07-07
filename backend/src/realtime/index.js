const { Server } = require('socket.io');
const {
  MAX_PLAYERS_PER_ROOM,
  WORLD_WIDTH,
  WORLD_HEIGHT,
  joinRoom,
  updatePosition,
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
} = require('./rooms');
const { saveMpRoomScore } = require('../models/MpRoomScore');

const TICK_RATE_MS = 50; // 20 ticks/sec
const TICK_RATE_SECONDS = TICK_RATE_MS / 1000;

/**
 * Wires the multiplayer test-mode realtime layer onto an existing HTTP
 * server — same process/port as the REST API, per the roadmap for this step.
 */
function attachRealtime(httpServer, { allowedOrigins }) {
  const io = new Server(httpServer, {
    cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  });

  io.on('connection', socket => {
    socket.on('mp:join', payload => {
      const { roomId, wave, players, enemies } = joinRoom(socket.id, payload?.skinId, payload?.maxHealth, payload?.radius);
      socket.data.roomId = roomId;
      socket.join(roomId);
      socket.emit('mp:joined', {
        roomId,
        selfId: socket.id,
        wave,
        players,
        enemies,
        maxPlayers: MAX_PLAYERS_PER_ROOM,
        worldWidth: WORLD_WIDTH,
        worldHeight: WORLD_HEIGHT,
      });
    });

    socket.on('mp:move', payload => {
      updatePosition(socket.id, payload?.x, payload?.y);
    });

    socket.on('mp:respawn', () => {
      respawnPlayer(socket.id);
    });

    socket.on('disconnect', () => {
      const result = leaveRoom(socket.id);
      if (!result) return;
      const { roomId, closedRoomResult } = result;
      io.to(roomId).emit('mp:playerLeft', { id: socket.id });
      // Room's last player just left — hand its final result to the
      // mp-leaderboard. Automatic, no client action needed (no nickname
      // system yet to attribute the run to a person anyway).
      if (closedRoomResult) saveMpRoomScore(closedRoomResult);
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const roomId of getActiveRoomIds()) {
      maybeSpawnEnemy(roomId, now);
      stepEnemies(roomId, TICK_RATE_SECONDS);
      applyCollisions(roomId);
      updateRevives(roomId, TICK_RATE_MS);
      checkWaveComplete(roomId);
      io.to(roomId).emit('mp:state', {
        players: getRoomPlayers(roomId),
        enemies: getRoomEnemies(roomId),
        wave: getRoomWave(roomId),
      });
    }
  }, TICK_RATE_MS);

  return io;
}

module.exports = { attachRealtime };
