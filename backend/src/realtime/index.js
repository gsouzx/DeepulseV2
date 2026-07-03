const { Server } = require('socket.io');
const {
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
} = require('./rooms');

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
      const { roomId, players, enemies } = joinRoom(socket.id, payload?.skinId, payload?.maxHealth, payload?.radius);
      socket.data.roomId = roomId;
      socket.join(roomId);
      socket.emit('mp:joined', {
        roomId,
        selfId: socket.id,
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

    socket.on('disconnect', () => {
      const roomId = leaveRoom(socket.id);
      if (roomId) {
        io.to(roomId).emit('mp:playerLeft', { id: socket.id });
      }
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const roomId of getActiveRoomIds()) {
      maybeSpawnEnemy(roomId, now);
      stepEnemies(roomId, TICK_RATE_SECONDS);
      applyCollisions(roomId);
      io.to(roomId).emit('mp:state', { players: getRoomPlayers(roomId), enemies: getRoomEnemies(roomId) });
    }
  }, TICK_RATE_MS);

  return io;
}

module.exports = { attachRealtime };
