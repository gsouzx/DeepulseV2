require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const leaderboardRoutes = require('./routes/leaderboard');
const statsRoutes = require('./routes/stats');
const mpLeaderboardRoutes = require('./routes/mpLeaderboard');
const { attachRealtime } = require('./realtime');

const app = express();
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0';
// Comma-separated allowlist, no wildcard fallback: an empty/unset
// ALLOWED_ORIGINS fails closed (cors rejects every cross-origin request)
// rather than failing open to '*'. Local dev sets this in backend/.env;
// production must set it on the host (Railway) to the real frontend
// domain(s), e.g. https://deeppulse-three.vercel.app.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Middleware
app.use(cors({
  origin: ALLOWED_ORIGINS,
  methods: ['GET', 'POST'],
}));

app.use(express.json({ limit: '10kb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests, slow down pilot.' }
});
app.use('/api', limiter);

// Routes
app.use('/api/leaderboard', leaderboardRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/mp-leaderboard', mpLeaderboardRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'online', timestamp: new Date().toISOString(), game: 'DeepPulse' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found in the abyss.' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('⚠️  Server error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

const httpServer = http.createServer(app);
attachRealtime(httpServer, { allowedOrigins: ALLOWED_ORIGINS });

httpServer.listen(PORT, HOST, () => {
  console.log(`\n🌊 DeepPulse API listening on ${HOST}:${PORT}`);
  console.log(`📡 Leaderboard: /api/leaderboard`);
  console.log(`📊 Stats:       /api/stats`);
  console.log(`🔌 Realtime (Socket.io) attached to the same server\n`);
});

module.exports = app;
