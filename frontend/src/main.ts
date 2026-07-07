// ======================================================
// DEEPPULSE — Game Engine
// ======================================================
// NOTE: this file is the v1 game engine, ported as-is so the game kept
// working identically while the Vite/TS/ESLint/Vitest toolchain was
// validated (v2 roadmap step 1). It intentionally has `@ts-nocheck`
// because it still uses the old untyped, monolithic style — step 2 of the
// roadmap replaces it with typed modules under src/entities, src/systems,
// src/rendering, src/input, src/state and src/audio. New features land
// here in the meantime (kept small, with any real logic factored into its
// own typed+tested module, e.g. src/skins.ts) rather than waiting on that
// rewrite.
// @ts-nocheck

import { rnd, clamp, dist, lerp } from './utils/math';
import {
  SKINS,
  isSkinUnlocked,
  getUnlockedSkins,
  getBestWave,
  saveBestWave,
  getSelectedSkinId,
  setSelectedSkinId,
  resolveActiveSkin,
  findSkinById,
  getEffectiveMaxHealth,
  getEffectiveRadius,
} from './skins';
import { MultiplayerClient } from './multiplayer';
import { ENEMY_TYPES, findEnemyType } from './entities/enemy-types';
import { glow, noGlow } from './rendering/glow';

const API_BASE = `${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api`;

// ── Canvas Setup ──────────────────────────────────────
const canvas = document.getElementById('gameCanvas');
const ctx    = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ── Color palette ─────────────────────────────────────
const C = {
  abyss:   '#010812',
  deep:    '#030f1e',
  mid:     '#061428',
  pulse:   '#00f5d4',
  pulseDim:'#00b89c',
  danger:  '#ff2d55',
  warn:    '#ffb800',
  energy:  '#7b2fff',
  text:    '#c8e6ff',
  textDim: '#5a7fa0',
};

// ── State ─────────────────────────────────────────────
let state = 'menu'; // menu | playing | paused | gameover
const keys  = {};
let lastTime = 0;
let gameTime = 0;

// ── Game Config ───────────────────────────────────────
const CFG = {
  probeSpeed:    220,
  probeRadius:   14,
  maxHealth:     100,
  maxShields:    3,
  shieldCooldown:8000,  // ms
  baseEnemySpeed:80,
  enemySpeedGrow:8,     // per wave
  waveEnemyBase: 4,
  waveEnemyGrow: 2,
  pickupChance:  0.35,
};

// ── Game Objects ──────────────────────────────────────
let probe      = {};
let enemies    = [];
let pickups    = [];
let particles  = [];
let score      = 0;
let depth      = 0;
let wave       = 1;
let health     = 100;
let maxHealthForRun = 100; // CFG.maxHealth scaled by the active skin's power — see initGame()
let shields    = 3;
let shieldActive    = false;
let shieldTimer     = 0;
let shieldCooldown  = 0;
let waveTimer       = 0;
let waveTransition  = false;
let enemiesKilled   = 0;
let enemiesForWave  = CFG.waveEnemyBase;
let activeSkin      = SKINS[0];

// ── Multiplayer (test mode — networking infra + server-simulated enemies,
// no collision/damage/nickname/scoring yet) ────────────────────────────
// Deliberately separate from single-player state: its own local position,
// its own render path, no waves/scoring. See src/multiplayer.ts.
// Enemies and remote players are tracked in the server's fixed "world
// space" (mpWorldWidth x mpWorldHeight); drawMultiplayer() maps that to
// this client's own canvas size so it looks right regardless of window size.
const mpClient = new MultiplayerClient();
let mpProbe   = { x: 0, y: 0 };
let mpRoomId  = '';
let mpSelfId  = '';
let mpWorldWidth  = 1280;
let mpWorldHeight = 720;
const mpRemote  = new Map(); // id -> { x, y, targetX, targetY, skinId } (world space)
const mpEnemies = new Map(); // id -> { type, x, y, targetX, targetY, phase } (world space)

// ── Parallax bg layers ────────────────────────────────
const bgLayers = [
  { depth: 0.1, items: [] },
  { depth: 0.3, items: [] },
  { depth: 0.6, items: [] },
];

// ── Input ─────────────────────────────────────────────
window.addEventListener('keydown', e => {
  keys[e.code] = true;
  // Prevent Space's default browser behavior (page scroll, or — if a hidden
  // button from a previous screen still has focus — a synthetic click that
  // would re-trigger it) whenever the player isn't typing into a text field.
  if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT') {
    e.preventDefault();
    if (state === 'playing') activateShield();
  }
  if (e.code === 'Escape' && state === 'playing') togglePause();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// ── Screen Manager ────────────────────────────────────
const screens = {
  menu:     document.getElementById('menu-screen'),
  lb:       document.getElementById('lb-screen'),
  skins:    document.getElementById('skins-screen'),
  gameover: document.getElementById('gameover-screen'),
};
const hud = document.getElementById('hud');

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  hud.classList.remove('visible');
  if (name && screens[name]) screens[name].classList.add('active');
  if (name === null) hud.classList.add('visible');
}

// A menu button stays focused after its own click handler hides its screen
// (the DOM node is still there, just display:none via CSS) — without this,
// a later Space press "clicks" it again via the browser's native button
// activation. Call this whenever transitioning into actual gameplay.
function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

// ── Ambient Bubbles ───────────────────────────────────
function spawnAmbientBubbles() {
  const container = document.getElementById('particles');
  for (let i = 0; i < 18; i++) {
    const b = document.createElement('div');
    b.className = 'bubble';
    const size = 4 + Math.random() * 14;
    b.style.cssText = `
      width:${size}px; height:${size}px;
      left:${Math.random()*100}%;
      animation-duration:${8 + Math.random()*14}s;
      animation-delay:-${Math.random()*15}s;
      opacity:${0.2 + Math.random()*0.4}
    `;
    container.appendChild(b);
  }
}
spawnAmbientBubbles();

// ── Spawn a particle burst ────────────────────────────
function burst(x, y, color, count = 10, speed = 120) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const spd   = rnd(30, speed);
    particles.push({
      x, y,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      life: 1,
      decay: rnd(1.2, 2.5),
      r: rnd(1.5, 4),
      color,
    });
  }
}

// ── Background ────────────────────────────────────────
function initBg() {
  bgLayers.forEach((layer, li) => {
    layer.items = [];
    const count = li === 0 ? 60 : li === 1 ? 30 : 15;
    for (let i = 0; i < count; i++) {
      layer.items.push({
        x: rnd(0, canvas.width),
        y: rnd(0, canvas.height),
        r: rnd(0.5, li * 1.5 + 0.8),
        bright: rnd(0.1, 0.5),
        speed: rnd(8, 20) * layer.depth,
      });
    }
  });
}

function drawBg(dt) {
  // Deep ocean gradient
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0,   '#010e20');
  grad.addColorStop(0.5, '#010812');
  grad.addColorStop(1,   '#000508');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Bioluminescent dots
  bgLayers.forEach(layer => {
    layer.items.forEach(item => {
      item.y += layer.depth * (depth * 0.001 + 1) * dt * 40;
      if (item.y > canvas.height + 10) item.y = -10;

      ctx.beginPath();
      ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,245,212,${item.bright})`;
      glow(ctx, C.pulse, item.r * 4);
      ctx.fill();
      noGlow(ctx);
    });
  });
}

// ── Probe ─────────────────────────────────────────────
function initProbe() {
  probe = {
    x: canvas.width  / 2,
    y: canvas.height / 2,
    vx: 0,
    vy: 0,
    r: getEffectiveRadius(activeSkin, CFG.probeRadius),
    trail: [],
    thrustTime: 0,
  };
}

function updateProbe(dt) {
  let ax = 0, ay = 0;
  if (keys['KeyW'] || keys['ArrowUp'])    ay -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  ay += 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  ax -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ax += 1;

  const mag = Math.hypot(ax, ay);
  if (mag > 0) { ax /= mag; ay /= mag; probe.thrustTime += dt; }
  else         { probe.thrustTime = 0; }

  probe.vx = lerp(probe.vx, ax * CFG.probeSpeed, 8 * dt);
  probe.vy = lerp(probe.vy, ay * CFG.probeSpeed, 8 * dt);

  probe.x = clamp(probe.x + probe.vx * dt, probe.r, canvas.width  - probe.r);
  probe.y = clamp(probe.y + probe.vy * dt, probe.r, canvas.height - probe.r);

  // Trail
  probe.trail.push({ x: probe.x, y: probe.y });
  if (probe.trail.length > 18) probe.trail.shift();
}

// Static probe body/rim/window, re-skinnable. Shared by the in-game probe
// render and the skin-select screen's preview cards, so a preview can never
// drift from how the skin actually looks in play.
function renderProbeGlyph(targetCtx, x, y, r, skin) {
  const { primary, bodyStart, bodyEnd, window } = skin.colors;

  // Body
  targetCtx.beginPath();
  targetCtx.arc(x, y, r, 0, Math.PI * 2);
  const bodyGrad = targetCtx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
  bodyGrad.addColorStop(0, bodyStart);
  bodyGrad.addColorStop(1, bodyEnd);
  targetCtx.fillStyle = bodyGrad;
  glow(targetCtx, primary, r * 1.4);
  targetCtx.fill();

  // Rim
  targetCtx.strokeStyle = primary;
  targetCtx.lineWidth = 1.5;
  targetCtx.stroke();
  noGlow(targetCtx);

  // Window
  targetCtx.beginPath();
  targetCtx.arc(x, y - r * 0.1, r * 0.5, 0, Math.PI * 2);
  targetCtx.fillStyle = `rgba(${window},0.12)`;
  targetCtx.strokeStyle = `rgba(${window},0.5)`;
  targetCtx.lineWidth = 1;
  targetCtx.fill();
  targetCtx.stroke();

  // Inner glow dot
  targetCtx.beginPath();
  targetCtx.arc(x, y - r * 0.1, r * 0.18, 0, Math.PI * 2);
  targetCtx.fillStyle = `rgba(${window},0.8)`;
  glow(targetCtx, primary, r * 0.7);
  targetCtx.fill();
  noGlow(targetCtx);
}

function drawProbe() {
  const { x, y, r, thrustTime } = probe;
  const skin = activeSkin;

  // Trail
  probe.trail.forEach((pt, i) => {
    const alpha = (i / probe.trail.length) * 0.35;
    const rad   = r * 0.5 * (i / probe.trail.length);
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, rad, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${skin.colors.window},${alpha})`;
    ctx.fill();
  });

  // Shield effect (ability color — stays consistent across skins)
  if (shieldActive) {
    ctx.beginPath();
    ctx.arc(x, y, r + 12 + Math.sin(Date.now() * 0.01) * 3, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(123,47,255,0.8)`;
    ctx.lineWidth = 2;
    glow(ctx, C.energy, 20);
    ctx.stroke();
    noGlow(ctx);
  }

  renderProbeGlyph(ctx, x, y, r, skin);

  // Thrusters (animated when moving)
  const thrust = Math.min(thrustTime * 4, 1);
  const thrustLen = r * 0.8 * thrust;
  [-r * 0.6, r * 0.6].forEach(ox => {
    ctx.beginPath();
    ctx.moveTo(x + ox, y + r);
    ctx.lineTo(x + ox, y + r + thrustLen + Math.random() * 4);
    ctx.strokeStyle = `rgba(${skin.colors.window},${0.6 * thrust})`;
    ctx.lineWidth = 3;
    glow(ctx, skin.colors.primary, 8);
    ctx.stroke();
    noGlow(ctx);
  });
}

// ── Enemies ───────────────────────────────────────────
function spawnEnemy() {
  const side = Math.floor(Math.random() * 4);
  const padding = 40;
  let x, y;
  if (side === 0) { x = rnd(0, canvas.width); y = -padding; }
  else if (side === 1) { x = canvas.width + padding; y = rnd(0, canvas.height); }
  else if (side === 2) { x = rnd(0, canvas.width); y = canvas.height + padding; }
  else { x = -padding; y = rnd(0, canvas.height); }

  const typeIdx = wave > 4
    ? Math.floor(rnd(0, ENEMY_TYPES.length))
    : Math.floor(rnd(0, Math.min(wave, ENEMY_TYPES.length)));

  const type = ENEMY_TYPES[typeIdx];
  const spd  = (CFG.baseEnemySpeed + wave * CFG.enemySpeedGrow) * type.speed;

  enemies.push({
    x, y,
    type,
    r: type.r,
    hp: type.hp + Math.floor(wave * 0.5),
    maxHp: type.hp + Math.floor(wave * 0.5),
    speed: spd,
    phase: Math.random() * Math.PI * 2,
    hitFlash: 0,
  });
}

function updateEnemies(dt) {
  enemies.forEach(e => {
    const angle = Math.atan2(probe.y - e.y, probe.x - e.x);
    e.x += Math.cos(angle) * e.speed * dt;
    e.y += Math.sin(angle) * e.speed * dt;
    if (e.hitFlash > 0) e.hitFlash -= dt * 5;
  });

  // Spawn logic
  if (!waveTransition) {
    waveTimer += dt;
    const spawnInterval = Math.max(0.4, 2.0 - wave * 0.15);
    if (waveTimer >= spawnInterval && enemies.length < enemiesForWave + wave * 2) {
      waveTimer = 0;
      spawnEnemy();
    }
  }
}

function drawEnemies() {
  enemies.forEach(e => {
    ctx.save();
    if (e.hitFlash > 0) {
      ctx.globalAlpha = 0.5 + e.hitFlash * 0.5;
    }
    e.type.draw(ctx, e);
    ctx.restore();

    // HP bar
    if (e.hp < e.maxHp) {
      const bw = e.r * 2.2;
      const bx = e.x - bw / 2;
      const by = e.y - e.r - 10;
      ctx.fillStyle = 'rgba(255,45,85,0.2)';
      ctx.fillRect(bx, by, bw, 4);
      ctx.fillStyle = C.danger;
      ctx.fillRect(bx, by, bw * (e.hp / e.maxHp), 4);
    }
  });
}

// ── Pickups ───────────────────────────────────────────
function spawnPickup(x, y) {
  if (Math.random() > CFG.pickupChance) return;
  const types = ['energy', 'health', 'shield'];
  const t     = types[Math.floor(Math.random() * types.length)];
  pickups.push({ x, y, type: t, life: 12, pulse: 0 });
}

function updatePickups(dt) {
  pickups.forEach(p => { p.life -= dt; p.pulse += dt * 3; });
  pickups = pickups.filter(p => p.life > 0);
}

function drawPickups() {
  pickups.forEach(p => {
    const scale = 1 + 0.1 * Math.sin(p.pulse);
    const r = 10 * scale;
    const alpha = Math.min(1, p.life * 0.8);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    ctx.scale(scale, scale);

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);

    if (p.type === 'energy') {
      ctx.fillStyle = 'rgba(0,245,212,0.2)';
      ctx.strokeStyle = C.pulse;
      glow(ctx, C.pulse, 15);
    } else if (p.type === 'health') {
      ctx.fillStyle = 'rgba(255,45,85,0.2)';
      ctx.strokeStyle = C.danger;
      glow(ctx, C.danger, 15);
    } else {
      ctx.fillStyle = 'rgba(123,47,255,0.2)';
      ctx.strokeStyle = C.energy;
      glow(ctx, C.energy, 15);
    }

    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.stroke();
    noGlow(ctx);

    // Icon
    ctx.fillStyle = ctx.strokeStyle;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.type === 'energy' ? '⚡' : p.type === 'health' ? '♥' : '◈', 0, 0);

    ctx.restore();
  });
}

// ── Particles ─────────────────────────────────────────
function updateParticles(dt) {
  particles.forEach(p => {
    p.x    += p.vx * dt;
    p.y    += p.vy * dt;
    p.vx   *= 0.94;
    p.vy   *= 0.94;
    p.life -= p.decay * dt;
  });
  particles = particles.filter(p => p.life > 0);
}

function drawParticles() {
  particles.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
    ctx.fillStyle = p.color.replace(')', `,${p.life})`).replace('rgb(', 'rgba(');
    if (!p.color.includes('rgba')) {
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.life;
    }
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

// ── Shield ────────────────────────────────────────────
function activateShield() {
  if (shieldActive || shields <= 0 || shieldCooldown > 0) return;
  shieldActive = true;
  shieldTimer  = 2500;
  shields--;
  updateShieldUI();
  burst(probe.x, probe.y, 'rgb(123,47,255)', 15, 150);
}

function updateShield(dt) {
  if (shieldActive) {
    shieldTimer -= dt * 1000;
    if (shieldTimer <= 0) {
      shieldActive = false;
      shieldCooldown = CFG.shieldCooldown;
    }
  }
  if (shieldCooldown > 0) {
    shieldCooldown -= dt * 1000;
    if (shieldCooldown <= 0 && shields < CFG.maxShields) {
      shields = Math.min(shields + 1, CFG.maxShields);
      shieldCooldown = shields < CFG.maxShields ? CFG.shieldCooldown : 0;
      updateShieldUI();
    }
  }
}

// ── Collisions ────────────────────────────────────────
// (also spawns pickups on kill)
function checkCollisions() {
  const toRemove = [];
  enemies.forEach(e => {
    if (dist(probe, e) < probe.r + e.r) {
      if (shieldActive) {
        burst(e.x, e.y, 'rgb(123,47,255)', 12, 120);
        score += Math.floor(e.type.points * 0.5);
        toRemove.push(e);
        enemiesKilled++;
        spawnPickup(e.x, e.y);
        return;
      }
      e.hp -= 1;
      if (e.hp <= 0) {
        burst(e.x, e.y, 'rgb(255,45,85)', 14, 150);
        score += e.type.points;
        enemiesKilled++;
        spawnPickup(e.x, e.y);
        toRemove.push(e);
      } else {
        e.hitFlash = 1;
        health -= e.type.dmg * 0.5;
        burst(probe.x, probe.y, 'rgb(255,45,85)', 6, 80);
        if (health <= 0) { health = 0; endGame(); }
        updateHealthUI();
      }
    }
  });
  enemies = enemies.filter(e => !toRemove.includes(e));

  pickups = pickups.filter(p => {
    if (dist(probe, p) < probe.r + 14) {
      applyPickup(p.type);
      burst(p.x, p.y,
        p.type === 'energy'  ? 'rgb(0,245,212)' :
        p.type === 'health'  ? 'rgb(255,45,85)' : 'rgb(123,47,255)',
        8, 80);
      return false;
    }
    return true;
  });
}

function applyPickup(type) {
  if (type === 'energy') {
    score += 250 + wave * 50;
  } else if (type === 'health') {
    health = Math.min(health + 30, maxHealthForRun);
    updateHealthUI();
  } else {
    shields = Math.min(shields + 1, CFG.maxShields);
    updateShieldUI();
  }
}

// ── Wave System ───────────────────────────────────────
function checkWaveComplete() {
  if (!waveTransition && enemiesKilled >= enemiesForWave) {
    waveTransition = true;
    setTimeout(() => {
      wave++;
      enemiesForWave = CFG.waveEnemyBase + wave * CFG.waveEnemyGrow;
      enemiesKilled  = 0;
      waveTransition = false;
      showWaveNotify();
      updateHUD();
      // Bonus
      score += wave * 500;
      health = Math.min(health + 15, maxHealthForRun);
      updateHealthUI();
    }, 1500);
  }
}

function showWaveNotify() {
  const el = document.getElementById('wave-notify');
  el.textContent = `WAVE ${wave}`;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

// ── HUD Updates ───────────────────────────────────────
function updateHUD() {
  document.getElementById('hud-score').textContent = score.toLocaleString();
  document.getElementById('hud-depth').textContent = Math.floor(depth) + 'm';
  document.getElementById('hud-wave').textContent  = wave;
  updateHealthUI();
}

function updateHealthUI() {
  const pct = (health / maxHealthForRun) * 100;
  document.getElementById('health-bar-inner').style.width = pct + '%';
  const val = document.getElementById('hud-score');
  val.className = 'hud-value' + (health < 30 ? ' danger' : health < 60 ? ' warn' : '');
}

function updateShieldUI() {
  const container = document.getElementById('shield-pips');
  container.innerHTML = '';
  for (let i = 0; i < CFG.maxShields; i++) {
    const pip = document.createElement('div');
    pip.className = 'pip' + (i >= shields ? ' empty' : '');
    container.appendChild(pip);
  }
}

// ── Score / Depth ─────────────────────────────────────
function updateScore(dt) {
  depth  += dt * (20 + wave * 5);
  score  += Math.floor(dt * (10 + wave * 3));
  document.getElementById('hud-score').textContent = Math.floor(score).toLocaleString();
  document.getElementById('hud-depth').textContent = Math.floor(depth) + 'm';
}

// ── Game Init ─────────────────────────────────────────
function initGame() {
  score      = 0;
  depth      = 0;
  wave       = 1;
  shields    = CFG.maxShields;
  shieldActive    = false;
  shieldTimer     = 0;
  shieldCooldown  = 0;
  waveTimer       = 0;
  waveTransition  = false;
  enemiesKilled   = 0;
  enemiesForWave  = CFG.waveEnemyBase;
  enemies    = [];
  pickups    = [];
  particles  = [];
  gameTime   = 0;
  activeSkin = resolveActiveSkin(getSelectedSkinId(), getBestWave());
  maxHealthForRun = getEffectiveMaxHealth(activeSkin, CFG.maxHealth);
  health     = maxHealthForRun;

  initProbe();
  initBg();
  updateShieldUI();
  updateHUD();

  setTimeout(showWaveNotify, 600);
}

// ── Pause ─────────────────────────────────────────────
function togglePause() {
  if (state === 'playing') {
    state = 'paused';
  } else if (state === 'paused') {
    state = 'playing';
    lastTime = performance.now();
  }
}

function drawPauseOverlay() {
  ctx.fillStyle = 'rgba(1,8,18,0.7)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = `bold 32px 'Orbitron', monospace`;
  ctx.fillStyle = C.pulse;
  ctx.textAlign = 'center';
  ctx.shadowColor = C.pulse;
  ctx.shadowBlur  = 30;
  ctx.fillText('PAUSED', canvas.width / 2, canvas.height / 2 - 10);
  ctx.shadowBlur = 0;
  ctx.font = `12px 'Share Tech Mono', monospace`;
  ctx.fillStyle = C.textDim;
  ctx.fillText('Press ESC to resume', canvas.width / 2, canvas.height / 2 + 30);
  ctx.textAlign = 'left';
}

// ── End Game ──────────────────────────────────────────
function endGame() {
  state = 'gameover';
  showScreen('gameover');

  document.getElementById('go-score').textContent = Math.floor(score).toLocaleString();
  document.getElementById('go-depth').textContent = Math.floor(depth) + 'm';
  document.getElementById('go-wave').textContent  = wave;
  document.getElementById('go-time').textContent  = Math.floor(gameTime) + 's';
  document.getElementById('rank-badge').textContent = '';

  const previousBest = getBestWave();
  const newBest = saveBestWave(wave);
  const newlyUnlocked = getUnlockedSkins(newBest).filter(skin => skin.unlockWave > previousBest);
  document.getElementById('skin-unlock-badge').textContent = newlyUnlocked.length
    ? `🔓 Nova sonda desbloqueada: ${newlyUnlocked.map(skin => skin.name).join(', ')}!`
    : '';

  // Restore stored name
  const stored = localStorage.getItem('dp_name');
  if (stored) document.getElementById('player-name').value = stored;
}

// ── Main Loop ─────────────────────────────────────────
function loop(now) {
  requestAnimationFrame(loop);
  // Clamped to [0, 0.05]: pre-v1 bug — a button click's performance.now() can
  // race ahead of the next requestAnimationFrame timestamp, producing a
  // momentary negative dt that silently docks a point from the score.
  const dt = Math.max(0, Math.min((now - lastTime) / 1000, 0.05));
  lastTime = now;

  if (state === 'mp') {
    drawBg(dt);
    updateMultiplayer(dt, now);
    updateParticles(dt);
    drawMultiplayer();
    drawParticles();
    return;
  }

  if (state !== 'playing' && state !== 'paused') return;

  drawBg(dt);

  if (state === 'playing') {
    gameTime += dt;
    updateProbe(dt);
    updateEnemies(dt);
    updatePickups(dt);
    updateParticles(dt);
    updateShield(dt);
    checkCollisions();
    checkWaveComplete();
    updateScore(dt);
  }

  drawEnemies();
  drawPickups();
  drawParticles();
  drawProbe();

  if (state === 'paused') drawPauseOverlay();
}

// ── API Calls ─────────────────────────────────────────
async function fetchLeaderboard() {
  try {
    const res  = await fetch(`${API_BASE}/leaderboard`);
    const data = await res.json();
    return data.data || [];
  } catch {
    return [];
  }
}

async function submitScore(playerName) {
  try {
    const res = await fetch(`${API_BASE}/leaderboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        playerName,
        score: Math.floor(score),
        depth: Math.floor(depth),
        duration: Math.floor(gameTime),
        wave,
      })
    });
    const data = await res.json();
    return data;
  } catch {
    return null;
  }
}

function renderLeaderboard(scores) {
  const tbody = document.getElementById('lb-body');
  if (!scores || scores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:24px">No scores yet. Be the first!</td></tr>`;
    return;
  }
  tbody.innerHTML = scores.map((s, i) => `
    <tr>
      <td><span class="rank-num ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">${i + 1}</span></td>
      <td>${s.playerName}</td>
      <td><span class="score-val">${s.score.toLocaleString()}</span></td>
      <td>${s.depth}m</td>
      <td>${s.wave}</td>
    </tr>
  `).join('');
}

// ── Skins Screen ──────────────────────────────────────
function renderSkinsScreen() {
  const bestWave = getBestWave();
  const selectedId = getSelectedSkinId();

  document.getElementById('skins-progress').textContent = `Melhor wave alcançada: ${bestWave}`;

  const grid = document.getElementById('skins-grid');
  grid.innerHTML = '';

  SKINS.forEach(skin => {
    const unlocked = isSkinUnlocked(skin, bestWave);
    const selected = unlocked && skin.id === selectedId;
    const statusText = !unlocked
      ? `Bloqueada — alcance a wave ${skin.unlockWave}`
      : selected ? 'Selecionada' : 'Disponível';

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'skin-card' + (unlocked ? '' : ' locked') + (selected ? ' selected' : '');
    card.disabled = !unlocked;
    card.setAttribute('aria-pressed', String(selected));
    card.setAttribute('aria-label', `${skin.name}. ${statusText}`);

    const canvas = document.createElement('canvas');
    canvas.className = 'skin-canvas';
    canvas.width = 72;
    canvas.height = 72;
    const previewCtx = canvas.getContext('2d');
    previewCtx.globalAlpha = unlocked ? 1 : 0.35;
    renderProbeGlyph(previewCtx, 36, 36, 24, skin);

    const name = document.createElement('div');
    name.className = 'skin-name';
    name.textContent = skin.name;

    const power = document.createElement('div');
    power.className = 'skin-power';
    const hpBonus = Math.round((skin.stats.healthMultiplier - 1) * 100);
    const sizeBonus = Math.round((skin.stats.sizeMultiplier - 1) * 100);
    power.textContent = hpBonus > 0
      ? `+${hpBonus}% vida · +${sizeBonus}% tamanho`
      : 'Sem bônus';

    const status = document.createElement('div');
    status.className = 'skin-status';
    status.textContent = statusText;

    card.append(canvas, name, power, status);
    if (unlocked) {
      card.addEventListener('click', () => {
        setSelectedSkinId(skin.id);
        renderSkinsScreen();
      });
    }
    grid.appendChild(card);
  });
}

// ── Multiplayer (test mode) ───────────────────────────
let mpConnectError = '';
let mpProbeRadius = CFG.probeRadius;
let mpHealth = 0;
let mpMaxHealth = 100;

function updateMpRoomInfo() {
  const el = document.getElementById('mp-room-info');
  el.classList.toggle('mp-info-error', !!mpConnectError);
  if (mpConnectError) {
    el.textContent = `Erro de conexão: ${mpConnectError} — o backend está rodando (npm run dev na pasta backend)?`;
    return;
  }
  el.textContent = mpRoomId
    ? `Sala: ${mpRoomId} · Jogadores: ${mpRemote.size + 1} · Inimigos: ${mpEnemies.size}`
    : 'Conectando...';
}

function updateMpHealthUI() {
  const pct = mpMaxHealth > 0 ? (mpHealth / mpMaxHealth) * 100 : 0;
  document.getElementById('mp-health-bar-inner').style.width = pct + '%';
}

/** Applies the server's canonical health for the local player, bursting on damage — same visual feedback as single-player's hit reaction. */
function applyMpSelfHealth(newHealth) {
  if (newHealth < mpHealth) {
    burst(mpProbe.x, mpProbe.y, 'rgb(255,45,85)', 6, 80);
  }
  mpHealth = newHealth;
  updateMpHealthUI();
}

// World-space (server) <-> local canvas pixel space (this client) conversion.
// A single scale factor (rather than independent x/y) keeps circular hitboxes
// circular; the world is authored at a 1280x720 (16:9) aspect to match it.
function worldToLocalX(worldX) { return (worldX / mpWorldWidth) * canvas.width; }
function worldToLocalY(worldY) { return (worldY / mpWorldHeight) * canvas.height; }
function worldToLocalScale() { return canvas.width / mpWorldWidth; }

function enterMultiplayer() {
  // Guards against a stray double-invocation (e.g. Space "clicking" a still-
  // focused button) opening a second connection on top of the first — that
  // leaves a frozen ghost player behind since nothing updates it anymore.
  if (state === 'mp') return;
  blurActiveElement();

  Object.values(screens).forEach(s => s.classList.remove('active'));
  hud.classList.remove('visible');
  document.getElementById('mp-hud').classList.add('visible');

  // Same skin resolution as single-player, so "Probes" progression carries over.
  activeSkin = resolveActiveSkin(getSelectedSkinId(), getBestWave());
  mpProbeRadius = getEffectiveRadius(activeSkin, CFG.probeRadius);
  mpMaxHealth = getEffectiveMaxHealth(activeSkin, CFG.maxHealth);
  mpHealth = mpMaxHealth;
  updateMpHealthUI();

  mpProbe = { x: canvas.width / 2, y: canvas.height / 2 };
  mpRoomId = '';
  mpSelfId = '';
  mpConnectError = '';
  mpRemote.clear();
  mpEnemies.clear();
  particles = [];
  updateMpRoomInfo();

  state = 'mp';
  lastTime = performance.now();

  mpClient.connect(
    activeSkin.id,
    mpMaxHealth,
    mpProbeRadius,
    payload => {
      mpConnectError = '';
      mpRoomId = payload.roomId;
      mpSelfId = payload.selfId;
      mpWorldWidth = payload.worldWidth;
      mpWorldHeight = payload.worldHeight;
      payload.players.forEach(p => {
        if (p.id === mpSelfId) {
          applyMpSelfHealth(p.health);
          mpMaxHealth = p.maxHealth;
        } else {
          mpRemote.set(p.id, { x: p.x, y: p.y, targetX: p.x, targetY: p.y, skinId: p.skinId });
        }
      });
      payload.enemies.forEach(e => {
        mpEnemies.set(e.id, {
          type: e.type,
          x: e.x,
          y: e.y,
          targetX: e.x,
          targetY: e.y,
          phase: Math.random() * Math.PI * 2,
        });
      });
      updateMpRoomInfo();
    },
    message => {
      mpConnectError = message;
      updateMpRoomInfo();
    },
  );

  mpClient.onState((players, enemies) => {
    const seenPlayers = new Set();
    players.forEach(p => {
      if (p.id === mpSelfId) {
        applyMpSelfHealth(p.health);
        mpMaxHealth = p.maxHealth;
        return;
      }
      seenPlayers.add(p.id);
      const existing = mpRemote.get(p.id);
      if (existing) {
        existing.targetX = p.x;
        existing.targetY = p.y;
      } else {
        mpRemote.set(p.id, { x: p.x, y: p.y, targetX: p.x, targetY: p.y, skinId: p.skinId });
      }
    });
    // Reconcile against the full snapshot too, as a safety net alongside mp:playerLeft.
    for (const id of mpRemote.keys()) {
      if (!seenPlayers.has(id)) mpRemote.delete(id);
    }

    const seenEnemies = new Set();
    enemies.forEach(e => {
      seenEnemies.add(e.id);
      const existing = mpEnemies.get(e.id);
      if (existing) {
        existing.targetX = e.x;
        existing.targetY = e.y;
      } else {
        mpEnemies.set(e.id, {
          type: e.type,
          x: e.x,
          y: e.y,
          targetX: e.x,
          targetY: e.y,
          phase: Math.random() * Math.PI * 2,
        });
      }
    });
    for (const id of mpEnemies.keys()) {
      if (!seenEnemies.has(id)) mpEnemies.delete(id);
    }

    updateMpRoomInfo();
  });

  mpClient.onPlayerLeft(id => {
    mpRemote.delete(id);
    updateMpRoomInfo();
  });
}

function exitMultiplayer() {
  mpClient.disconnect();
  mpRemote.clear();
  mpEnemies.clear();
  mpRoomId = '';
  mpSelfId = '';
  mpConnectError = '';
  particles = [];
  document.getElementById('mp-hud').classList.remove('visible');
  state = 'menu';
  showScreen('menu');
}

function updateMultiplayer(dt, now) {
  let ax = 0, ay = 0;
  if (keys['KeyW'] || keys['ArrowUp'])    ay -= 1;
  if (keys['KeyS'] || keys['ArrowDown'])  ay += 1;
  if (keys['KeyA'] || keys['ArrowLeft'])  ax -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) ax += 1;

  const mag = Math.hypot(ax, ay);
  if (mag > 0) { ax /= mag; ay /= mag; }

  mpProbe.x = clamp(mpProbe.x + ax * CFG.probeSpeed * dt, mpProbeRadius, canvas.width - mpProbeRadius);
  mpProbe.y = clamp(mpProbe.y + ay * CFG.probeSpeed * dt, mpProbeRadius, canvas.height - mpProbeRadius);

  const worldX = (mpProbe.x / canvas.width) * mpWorldWidth;
  const worldY = (mpProbe.y / canvas.height) * mpWorldHeight;
  mpClient.sendPosition(worldX, worldY, now);

  // Simple lerp toward the latest server-reported position, so 20 ticks/sec
  // doesn't read as choppy motion for remote players/enemies.
  const smoothing = Math.min(1, 10 * dt);
  mpRemote.forEach(p => {
    p.x = lerp(p.x, p.targetX, smoothing);
    p.y = lerp(p.y, p.targetY, smoothing);
  });
  mpEnemies.forEach(e => {
    e.x = lerp(e.x, e.targetX, smoothing);
    e.y = lerp(e.y, e.targetY, smoothing);
  });
}

function drawMultiplayer() {
  const scale = worldToLocalScale();

  // Same enemy roster/visuals as single-player (src/entities/enemy-types.ts) —
  // no separate "multiplayer enemy" look to keep in sync by hand.
  mpEnemies.forEach(e => {
    const type = findEnemyType(e.type);
    const adapter = {
      x: worldToLocalX(e.x),
      y: worldToLocalY(e.y),
      r: type.r * scale,
      type,
      phase: e.phase,
      hitFlash: 0,
    };
    type.draw(ctx, adapter);
  });

  // Same probe skin system as single-player — remote players render with
  // whichever skin they picked, not a generic dot.
  mpRemote.forEach(p => {
    const skin = findSkinById(p.skinId);
    const r = getEffectiveRadius(skin, CFG.probeRadius) * scale;
    renderProbeGlyph(ctx, worldToLocalX(p.x), worldToLocalY(p.y), r, skin);
  });

  renderProbeGlyph(ctx, mpProbe.x, mpProbe.y, mpProbeRadius, activeSkin);
}

// ── Button Handlers ───────────────────────────────────
document.getElementById('btn-play').addEventListener('click', () => {
  blurActiveElement();
  showScreen(null);
  state = 'playing';
  lastTime = performance.now();
  initGame();
});

document.getElementById('btn-lb').addEventListener('click', async () => {
  showScreen('lb');
  const scores = await fetchLeaderboard();
  renderLeaderboard(scores);
});

document.getElementById('btn-lb-back').addEventListener('click', () => {
  showScreen('menu');
});

document.getElementById('btn-skins').addEventListener('click', () => {
  showScreen('skins');
  renderSkinsScreen();
});

document.getElementById('btn-skins-back').addEventListener('click', () => {
  showScreen('menu');
});

document.getElementById('btn-mp').addEventListener('click', () => {
  enterMultiplayer();
});

document.getElementById('btn-mp-leave').addEventListener('click', () => {
  exitMultiplayer();
});

document.getElementById('btn-submit').addEventListener('click', async () => {
  const name = document.getElementById('player-name').value.trim() || 'Anonymous';
  localStorage.setItem('dp_name', name);
  const btn = document.getElementById('btn-submit');
  btn.textContent = 'Transmitting...';
  btn.disabled = true;

  const result = await submitScore(name);
  if (result && result.rank) {
    document.getElementById('rank-badge').textContent = `🏆 You ranked #${result.rank} globally!`;
  } else if (result) {
    document.getElementById('rank-badge').textContent = `Score submitted to the abyss.`;
  } else {
    document.getElementById('rank-badge').textContent = `Server offline — score saved locally.`;
  }

  btn.textContent = 'Submitted';
});

document.getElementById('btn-restart').addEventListener('click', () => {
  blurActiveElement();
  showScreen(null);
  state = 'playing';
  lastTime = performance.now();
  initGame();
});

document.getElementById('btn-menu').addEventListener('click', () => {
  state = 'menu';
  showScreen('menu');
});

// ── Start ─────────────────────────────────────────────
lastTime = performance.now();
requestAnimationFrame(loop);
console.log('%c🌊 DeepPulse Engine Initialized', 'color:#00f5d4;font-size:14px;font-weight:bold');
