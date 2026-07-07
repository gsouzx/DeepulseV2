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
// TODO: restrict this to the real Vercel domain once it's live — '*' is a
// temporary placeholder while the frontend URL isn't final yet.
const rawAllowedOrigins = process.env.ALLOWED_ORIGINS || '*';
const ALLOWED_ORIGINS =
  rawAllowedOrigins.trim() === '*' ? '*' : rawAllowedOrigins.split(',').map(origin => origin.trim());

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

httpServer.listen(PORT, () => {
  console.log(`\n🌊 DeepPulse API running on http://localhost:${PORT}`);
  console.log(`📡 Leaderboard: http://localhost:${PORT}/api/leaderboard`);
  console.log(`📊 Stats:       http://localhost:${PORT}/api/stats`);
  console.log(`🔌 Realtime (Socket.io) attached to the same server\n`);
});

module.exports = app;
