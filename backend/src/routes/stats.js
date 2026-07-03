const express = require('express');
const router = express.Router();
const { getGameStats } = require('../controllers/statsController');

router.get('/', getGameStats);

module.exports = router;
