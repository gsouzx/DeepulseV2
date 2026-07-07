const express = require('express');
const router = express.Router();
const { getMpLeaderboard } = require('../controllers/mpLeaderboardController');

router.get('/', getMpLeaderboard);

module.exports = router;
