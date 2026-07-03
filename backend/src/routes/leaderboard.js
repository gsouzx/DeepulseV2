const express = require('express');
const router = express.Router();
const { getLeaderboard, postScore } = require('../controllers/leaderboardController');

router.get('/', getLeaderboard);
router.post('/', postScore);

module.exports = router;
