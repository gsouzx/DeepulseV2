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
import { TouchControls } from './touch-controls';
import { stripInvalidNicknameChars, resolveNickname, getSavedNickname, saveNickname } from './nickname';
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
  shieldDurationSolo: 2500,        // ms
  shieldDurationMultiplayer: 4000, // ms — 60% longer: mp throws more simultaneous threats (other players' fights + shared enemies) at once
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
// server-authoritative collision/damage/death/wave/revive/scoring/shield;
// still no nickname system) ─────────────────────────────────────────────
// Deliberately separate from single-player state: its own local position,
// its own render path, own shield/score bookkeeping. See src/multiplayer.ts.
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
    else if (state === 'mp') activateMpShield();
  }
  if (e.code === 'Escape' && state === 'playing') togglePause();
});
window.addEventListener('keyup', e => { keys[e.code] = false; });

// Mobile joystick + action button — no-op shell on desktop (see touch-controls.ts).
const touchControls = new TouchControls();
touchControls.onAction(() => {
  if (state === 'playing') activateShield();
  else if (state === 'mp') activateMpShield();
});

// Multiplayer nickname field — pre-filled from last time, sanitized live as
// typed (invalid characters stripped, but NOT trimmed here: trimming mid-word
// would eat a space the player is about to type past). Trim + the empty ->
// fallback-tag decision happen once, at join time — see enterMultiplayer().
const mpNicknameInput = document.getElementById('mp-nickname-input');
mpNicknameInput.value = getSavedNickname();
mpNicknameInput.addEventListener('input', () => {
  const sanitized = stripInvalidNicknameChars(mpNicknameInput.value);
  if (sanitized !== mpNicknameInput.value) mpNicknameInput.value = sanitized;
  saveNickname(sanitized);
});

// ── Screen Manager ────────────────────────────────────
const screens = {
  menu:     document.getElementById('menu-screen'),
  lb:       document.getElementById('lb-screen'),
  mpLb:     document.getElementById('mp-lb-screen'),
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

  // Touch joystick contributes an analog vector (magnitude 0..1) on top of the
  // keyboard's digital one; a lone keyboard press still normalizes to exactly 1.
  const touchMove = touchControls.getMoveVector();
  ax += touchMove.x;
  ay += touchMove.y;

  const mag = Math.hypot(ax, ay);
  if (mag > 0) {
    const clampedMag = Math.min(mag, 1);
    ax = (ax / mag) * clampedMag;
    ay = (ay / mag) * clampedMag;
    probe.thrustTime += dt;
  } else {
    probe.thrustTime = 0;
  }

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

/** Shield glow ring — shared by single-player's own probe and multiplayer's local/remote probes, so the effect reads identically everywhere it can appear. */
function drawShieldRing(targetCtx, x, y, r) {
  targetCtx.beginPath();
  targetCtx.arc(x, y, r + 12 + Math.sin(Date.now() * 0.01) * 3, 0, Math.PI * 2);
  targetCtx.strokeStyle = `rgba(123,47,255,0.8)`;
  targetCtx.lineWidth = 2;
  glow(targetCtx, C.energy, 20);
  targetCtx.stroke();
  noGlow(targetCtx);
}

const NICKNAME_MAX_WIDTH_PX = 90;

/**
 * Multiplayer-only nametag — small text centered above a probe/wreck,
 * following it every frame. Canvas has no native text-ellipsis, so long
 * names (already capped at 12 chars server-side) are truncated by
 * measurement as a second line of defense. `opacity` lets the local
 * player's own tag render more discreetly than everyone else's — see the
 * call site in drawMultiplayer() for why.
 */
function drawNickname(targetCtx, x, y, r, text, opacity = 1) {
  if (!text) return;
  targetCtx.save();
  targetCtx.globalAlpha = opacity;
  targetCtx.font = `10px 'Share Tech Mono', monospace`;
  targetCtx.textAlign = 'center';
  targetCtx.textBaseline = 'alphabetic';
  targetCtx.shadowColor = 'rgba(0,0,0,0.9)';
  targetCtx.shadowBlur = 4;
  targetCtx.fillStyle = 'rgba(220,245,255,0.95)';

  let display = text;
  if (targetCtx.measureText(display).width > NICKNAME_MAX_WIDTH_PX) {
    while (display.length > 1 && targetCtx.measureText(display + '…').width > NICKNAME_MAX_WIDTH_PX) {
      display = display.slice(0, -1);
    }
    display += '…';
  }
  targetCtx.fillText(display, x, y - r - 8);
  targetCtx.restore();
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
  if (shieldActive) drawShieldRing(ctx, x, y, r);

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

  const eligible = ENEMY_TYPES.filter(t => {
    if (wave < (t.minWave ?? 1)) return false;
    if (t.maxOnScreen === undefined) return true;
    return enemies.filter(e => e.type.name === t.name).length < t.maxOnScreen;
  });
  if (eligible.length === 0) return; // every eligible type is already at its on-screen cap
  const type = eligible[Math.floor(rnd(0, eligible.length))];
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
function spawnPickup(x, y, guaranteed = false) {
  if (!guaranteed && Math.random() > CFG.pickupChance) return;
  const types = ['energy', 'health', 'shield'];
  const t     = types[Math.floor(Math.random() * types.length)];
  pickups.push({ x, y, type: t, life: 12, pulse: 0 });
}

/** Normal enemies: one chance-gated drop, same as always. Types with `pickupDrops` set (bosses) instead drop that many, guaranteed, fanned out so they don't stack on one pixel. */
function dropEnemyPickups(e) {
  const count = e.type.pickupDrops;
  if (!count) { spawnPickup(e.x, e.y); return; }
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + rnd(-0.3, 0.3);
    spawnPickup(e.x + Math.cos(angle) * 16, e.y + Math.sin(angle) * 16, true);
  }
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
  shieldTimer  = CFG.shieldDurationSolo;
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
    const hitDist = e.type.hitRadius ?? (probe.r + e.r);
    if (dist(probe, e) < hitDist) {
      if (shieldActive) {
        burst(e.x, e.y, 'rgb(123,47,255)', 12, 120);
        score += Math.floor(e.type.points * 0.5);
        toRemove.push(e);
        enemiesKilled++;
        dropEnemyPickups(e);
        return;
      }
      e.hp -= 1;
      if (e.hp <= 0) {
        burst(e.x, e.y, 'rgb(255,45,85)', 14, 150);
        score += e.type.points;
        enemiesKilled++;
        dropEnemyPickups(e);
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

  touchControls.setVisible(state === 'playing' || state === 'paused' || state === 'mp');

  if (state === 'mp' || state === 'mp-dead') {
    // Kept alive during mp-dead too — a downed player still watches
    // teammates/enemies move behind the death screen (updateMultiplayer
    // itself skips input/movement when !mpAlive; see there).
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

/** Room sessions, not individuals — there's no nickname system yet, so this ranks co-op runs by how far the shared wave got. */
async function fetchMpLeaderboard() {
  try {
    const res  = await fetch(`${API_BASE}/mp-leaderboard`);
    const data = await res.json();
    return data.data || [];
  } catch {
    return [];
  }
}

function renderMpLeaderboard(scores) {
  const tbody = document.getElementById('mp-lb-body');
  if (!scores || scores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-dim);padding:24px">Nenhuma sala concluída ainda. Seja o primeiro!</td></tr>`;
    return;
  }
  tbody.innerHTML = scores.map((s, i) => `
    <tr>
      <td><span class="rank-num ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">${i + 1}</span></td>
      <td>${s.wave}</td>
      <td>${Math.floor(s.durationSeconds / 60)}m ${s.durationSeconds % 60}s</td>
      <td>${s.peakPlayers}</td>
    </tr>
  `).join('');
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
const MP_SELF_REVIVE_DELAY_MS = 10000; // mirrors the server's SELF_REVIVE_DELAY_MS — just for immediate UI feedback before the first status update arrives
let mpConnectError = '';
let mpProbeRadius = CFG.probeRadius;
let mpHealth = 0;
let mpMaxHealth = 100;
let mpAlive = true;
let mpSurvivalTime = 0;
let mpWave = 1;
let mpReviveProgress = 0; // 0..1, from a nearby teammate reviving us
let mpSelfReviveRemainingMs = 0;
let mpScore = 0;
let mpRankingLastRenderAt = 0;
let mpShields = CFG.maxShields;
let mpShieldActive = false;
let mpShieldTimer = 0;
let mpShieldCooldown = 0;
let mpNickname = '';

function updateMpRoomInfo() {
  const el = document.getElementById('mp-room-info');
  el.classList.toggle('mp-info-error', !!mpConnectError);
  if (mpConnectError) {
    el.textContent = `Erro de conexão: ${mpConnectError} — o backend está rodando (npm run dev na pasta backend)?`;
    return;
  }
  const aliveRemote = Array.from(mpRemote.values()).filter(p => p.alive !== false).length;
  const aliveCount = aliveRemote + (mpAlive ? 1 : 0);
  el.textContent = mpRoomId
    ? `Sala: ${mpRoomId} · Jogadores: ${mpRemote.size + 1} (${aliveCount} vivos) · Inimigos: ${mpEnemies.size}`
    : 'Conectando...';
}

/**
 * Top 5 alive players in the room by score, agar.io-style — dead players
 * drop off immediately (filtered by `alive`, not just "last known score"),
 * and the local player's row is highlighted so they can spot themselves at
 * a glance. Called on every join/state snapshot, but only actually
 * re-renders every RANKING_THROTTLE_MS (see the call sites) since a 20
 * ticks/sec DOM rebuild would be wasted work for a once-a-few-frames read.
 */
function renderMpRanking() {
  const container = document.getElementById('mp-ranking');
  const roster = [];
  if (mpAlive) roster.push({ id: mpSelfId, score: mpScore, self: true });
  mpRemote.forEach((p, id) => {
    if (p.alive) roster.push({ id, score: p.score || 0, nickname: p.nickname, self: false });
  });
  roster.sort((a, b) => b.score - a.score);

  container.innerHTML = roster.slice(0, 5).map((p, i) => {
    // The local player is always labeled "Você" rather than their own typed
    // nickname — instant self-recognition beats matching your own name in a
    // list, and it's consistent with how the rest of the mp HUD refers to you.
    const label = p.self ? 'Você' : p.nickname || 'Piloto';
    return `<div class="mp-ranking-row${p.self ? ' mp-ranking-self' : ''}">` +
      `<span class="mp-ranking-name"><span class="mp-ranking-rank">${i + 1}.</span>${label}</span>` +
      `<span class="mp-ranking-score">${Math.floor(p.score).toLocaleString()}</span>` +
      `</div>`;
  }).join('');
}

function updateMpHealthUI() {
  const pct = mpMaxHealth > 0 ? (mpHealth / mpMaxHealth) * 100 : 0;
  document.getElementById('mp-health-bar-inner').style.width = pct + '%';
}

function updateMpShieldUI() {
  const container = document.getElementById('mp-shield-pips');
  container.innerHTML = '';
  for (let i = 0; i < CFG.maxShields; i++) {
    const pip = document.createElement('div');
    pip.className = 'pip' + (i >= mpShields ? ' empty' : '');
    container.appendChild(pip);
  }
}

/** Same charge/cooldown rules as single-player's activateShield(), just with the multiplayer duration and its own client-local counters — see CFG.shieldDurationMultiplayer. Tells the server via mp:shield so collisions (invulnerability + instakill) and other clients' rendering of this player's glow both work. */
function activateMpShield() {
  if (mpShieldActive || mpShields <= 0 || mpShieldCooldown > 0) return;
  mpShieldActive = true;
  mpShieldTimer = CFG.shieldDurationMultiplayer;
  mpShields--;
  updateMpShieldUI();
  burst(mpProbe.x, mpProbe.y, 'rgb(123,47,255)', 15, 150);
  mpClient.activateShield(CFG.shieldDurationMultiplayer);
}

/** Mirrors single-player's updateShield(dt) — ticks down the active duration, then the recharge cooldown. Runs even while downed so a teammate reviving you doesn't also cost you your recharge progress. */
function updateMpShield(dt) {
  if (mpShieldActive) {
    mpShieldTimer -= dt * 1000;
    if (mpShieldTimer <= 0) {
      mpShieldActive = false;
      mpShieldCooldown = CFG.shieldCooldown;
    }
  }
  if (mpShieldCooldown > 0) {
    mpShieldCooldown -= dt * 1000;
    if (mpShieldCooldown <= 0 && mpShields < CFG.maxShields) {
      mpShields = Math.min(mpShields + 1, CFG.maxShields);
      mpShieldCooldown = mpShields < CFG.maxShields ? CFG.shieldCooldown : 0;
      updateMpShieldUI();
    }
  }
}

function updateMpWaveUI() {
  document.getElementById('mp-hud-wave').textContent = mpWave;
}

function showMpWaveNotify() {
  const el = document.getElementById('wave-notify');
  el.textContent = `WAVE ${mpWave}`;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

/** The room's shared wave only ever goes up while a client is connected — a jump straight to the notify + HUD update, no transition state needed client-side (the server already gated it on enough kills). */
function applyMpWave(newWave) {
  if (newWave > mpWave) {
    mpWave = newWave;
    showMpWaveNotify();
  } else {
    mpWave = newWave;
  }
  updateMpWaveUI();
}

/** Reflects the server's canonical health/revive status for the local player. Bursts on damage (same feedback as single-player's hit reaction), and flips the death screen on in either direction — dying, or getting revived by a teammate while already on it. */
function applyMpSelfStatus(p) {
  if (p.health < mpHealth) {
    burst(mpProbe.x, mpProbe.y, 'rgb(255,45,85)', 6, 80);
  }
  mpHealth = p.health;
  mpScore = p.score || 0;
  updateMpHealthUI();

  if (mpHealth <= 0 && mpAlive) {
    mpAlive = false;
    handleMpDeath();
  } else if (mpHealth > 0 && !mpAlive) {
    mpAlive = true;
    completeMpRevive();
  }

  mpReviveProgress = p.reviveProgress || 0;
  mpSelfReviveRemainingMs = p.selfReviveRemainingMs || 0;
  updateMpDeathScreenUI();
}

function updateMpDeathScreenUI() {
  if (state !== 'mp-dead') return;
  const btn = document.getElementById('btn-mp-revive');
  if (mpSelfReviveRemainingMs > 0) {
    btn.disabled = true;
    btn.textContent = `Reviver (${Math.ceil(mpSelfReviveRemainingMs / 1000)}s)`;
  } else {
    btn.disabled = false;
    btn.textContent = 'Reviver';
  }
  const helpEl = document.getElementById('mp-gameover-help');
  if (mpReviveProgress > 0) {
    helpEl.style.display = 'block';
    helpEl.textContent = `Um colega está te reanimando... ${Math.round(mpReviveProgress * 100)}%`;
  } else {
    helpEl.style.display = 'none';
  }
}

function handleMpDeath() {
  state = 'mp-dead';
  mpSelfReviveRemainingMs = MP_SELF_REVIVE_DELAY_MS;
  document.getElementById('mp-hud').classList.remove('visible');
  document.getElementById('mp-gameover-time').textContent = Math.floor(mpSurvivalTime) + 's';
  document.getElementById('mp-gameover-screen').classList.add('active');
  updateMpDeathScreenUI();
}

/** Shared tail of both revive paths (self-service button, or a teammate finishing the job) — leaves the death screen and rejoins the action. */
function completeMpRevive() {
  mpSurvivalTime = 0;
  mpReviveProgress = 0;
  mpSelfReviveRemainingMs = 0;
  mpProbe = { x: canvas.width / 2, y: canvas.height / 2 };
  document.getElementById('mp-gameover-screen').classList.remove('active');
  document.getElementById('mp-hud').classList.add('visible');
  state = 'mp';
  lastTime = performance.now();
}

function reviveMultiplayer() {
  if (mpSelfReviveRemainingMs > 0) return;
  mpClient.respawn();
  mpAlive = true;
  mpHealth = mpMaxHealth;
  updateMpHealthUI();
  completeMpRevive();
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
  document.getElementById('mp-gameover-screen').classList.remove('active');
  hud.classList.remove('visible');
  document.getElementById('mp-hud').classList.add('visible');

  // Same skin resolution as single-player, so "Probes" progression carries over.
  activeSkin = resolveActiveSkin(getSelectedSkinId(), getBestWave());
  mpProbeRadius = getEffectiveRadius(activeSkin, CFG.probeRadius);
  mpMaxHealth = getEffectiveMaxHealth(activeSkin, CFG.maxHealth);
  mpHealth = mpMaxHealth;
  mpAlive = true;
  mpSurvivalTime = 0;
  mpWave = 1;
  mpReviveProgress = 0;
  mpSelfReviveRemainingMs = 0;
  mpScore = 0;
  mpShields = CFG.maxShields;
  mpShieldActive = false;
  mpShieldTimer = 0;
  mpShieldCooldown = 0;
  updateMpHealthUI();
  updateMpWaveUI();
  updateMpShieldUI();

  mpProbe = { x: canvas.width / 2, y: canvas.height / 2 };
  mpRoomId = '';
  mpSelfId = '';
  mpConnectError = '';
  mpRemote.clear();
  mpEnemies.clear();
  particles = [];
  updateMpRoomInfo();

  // Resolved once per join: sanitized input, or a fresh "Piloto ####" tag if
  // it sanitizes to empty — never blocks entering the room. Written back to
  // the field/localStorage so a fallback tag becomes this player's saved
  // identity too, and so the field reflects whatever actually got used.
  mpNickname = resolveNickname(mpNicknameInput.value);
  mpNicknameInput.value = mpNickname;
  saveNickname(mpNickname);

  state = 'mp';
  lastTime = performance.now();

  mpClient.connect(
    activeSkin.id,
    mpMaxHealth,
    mpProbeRadius,
    mpNickname,
    payload => {
      mpConnectError = '';
      mpRoomId = payload.roomId;
      mpSelfId = payload.selfId;
      mpWorldWidth = payload.worldWidth;
      mpWorldHeight = payload.worldHeight;
      applyMpWave(payload.wave);
      payload.players.forEach(p => {
        if (p.id === mpSelfId) {
          mpMaxHealth = p.maxHealth;
          applyMpSelfStatus(p);
        } else {
          mpRemote.set(p.id, {
            x: p.x,
            y: p.y,
            targetX: p.x,
            targetY: p.y,
            skinId: p.skinId,
            nickname: p.nickname || '',
            alive: p.alive,
            score: p.score || 0,
            shieldActive: p.shieldActive || false,
            reviveProgress: p.reviveProgress || 0,
          });
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
      renderMpRanking();
    },
    message => {
      mpConnectError = message;
      updateMpRoomInfo();
    },
  );

  mpClient.onState((players, enemies, wave) => {
    applyMpWave(wave);
    const seenPlayers = new Set();
    players.forEach(p => {
      if (p.id === mpSelfId) {
        mpMaxHealth = p.maxHealth;
        applyMpSelfStatus(p);
        return;
      }
      seenPlayers.add(p.id);
      const existing = mpRemote.get(p.id);
      if (existing) {
        existing.targetX = p.x;
        existing.targetY = p.y;
        existing.alive = p.alive;
        existing.score = p.score || 0;
        existing.shieldActive = p.shieldActive || false;
        existing.reviveProgress = p.reviveProgress || 0;
      } else {
        mpRemote.set(p.id, {
          x: p.x,
          y: p.y,
          targetX: p.x,
          targetY: p.y,
          skinId: p.skinId,
          nickname: p.nickname || '',
          alive: p.alive,
          score: p.score || 0,
          shieldActive: p.shieldActive || false,
          reviveProgress: p.reviveProgress || 0,
        });
      }
    });
    // Reconcile against the full snapshot too, as a safety net alongside mp:playerLeft.
    for (const id of mpRemote.keys()) {
      if (!seenPlayers.has(id)) mpRemote.delete(id);
    }

    // Throttled — a full DOM rebuild every 50ms tick would be wasted work for a list that only needs to feel "live", not frame-perfect.
    const nowMs = performance.now();
    if (nowMs - mpRankingLastRenderAt > 250) {
      mpRankingLastRenderAt = nowMs;
      renderMpRanking();
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
  mpAlive = true;
  mpScore = 0;
  particles = [];
  document.getElementById('mp-hud').classList.remove('visible');
  document.getElementById('mp-gameover-screen').classList.remove('active');
  document.getElementById('mp-ranking').innerHTML = '';
  state = 'menu';
  showScreen('menu');
}

function updateMultiplayer(dt, now) {
  updateMpShield(dt);

  // A downed player sends no input and stays put — a teammate has to reach
  // THEM — but still watches the world (enemies, teammates) keep moving,
  // via the lerp below, which runs regardless of mpAlive.
  if (mpAlive) {
    mpSurvivalTime += dt;

    let ax = 0, ay = 0;
    if (keys['KeyW'] || keys['ArrowUp'])    ay -= 1;
    if (keys['KeyS'] || keys['ArrowDown'])  ay += 1;
    if (keys['KeyA'] || keys['ArrowLeft'])  ax -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) ax += 1;

    const touchMove = touchControls.getMoveVector();
    ax += touchMove.x;
    ay += touchMove.y;

    const mag = Math.hypot(ax, ay);
    if (mag > 0) {
      const clampedMag = Math.min(mag, 1);
      ax = (ax / mag) * clampedMag;
      ay = (ay / mag) * clampedMag;
    }

    mpProbe.x = clamp(mpProbe.x + ax * CFG.probeSpeed * dt, mpProbeRadius, canvas.width - mpProbeRadius);
    mpProbe.y = clamp(mpProbe.y + ay * CFG.probeSpeed * dt, mpProbeRadius, canvas.height - mpProbeRadius);

    const worldX = (mpProbe.x / canvas.width) * mpWorldWidth;
    const worldY = (mpProbe.y / canvas.height) * mpWorldHeight;
    mpClient.sendPosition(worldX, worldY, now);
  }

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
  // whichever skin they picked, not a generic dot. Downed players stay
  // visible as a dimmed wreck (not a full glyph) — teammates need to see
  // exactly where to swim to revive them.
  mpRemote.forEach(p => {
    const skin = findSkinById(p.skinId);
    const r = getEffectiveRadius(skin, CFG.probeRadius) * scale;
    const x = worldToLocalX(p.x), y = worldToLocalY(p.y);
    if (p.alive) {
      if (p.shieldActive) drawShieldRing(ctx, x, y, r);
      renderProbeGlyph(ctx, x, y, r, skin);
    } else {
      renderMpWreck(x, y, r, skin, p.reviveProgress || 0);
    }
    drawNickname(ctx, x, y, r, p.nickname);
  });

  if (mpAlive) {
    if (mpShieldActive) drawShieldRing(ctx, mpProbe.x, mpProbe.y, mpProbeRadius);
    renderProbeGlyph(ctx, mpProbe.x, mpProbe.y, mpProbeRadius, activeSkin);
  } else {
    renderMpWreck(mpProbe.x, mpProbe.y, mpProbeRadius, activeSkin, mpReviveProgress);
  }
  // Shown too, but dimmer than remote tags — mainly so this player can
  // confirm their own nickname actually took effect (sanitization, fallback
  // tag) rather than to identify themselves, which they obviously don't need.
  drawNickname(ctx, mpProbe.x, mpProbe.y, mpProbeRadius, mpNickname, 0.6);
}

/** A downed player's probe, dimmed, plus a glowing progress ring once a teammate is close enough to be reviving them. */
function renderMpWreck(x, y, r, skin, reviveProgress) {
  ctx.save();
  ctx.globalAlpha = 0.35;
  renderProbeGlyph(ctx, x, y, r, skin);
  ctx.restore();

  if (reviveProgress > 0) {
    ctx.beginPath();
    ctx.arc(x, y, r + 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reviveProgress);
    ctx.strokeStyle = C.pulse;
    ctx.lineWidth = 3;
    ctx.shadowColor = C.pulse;
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
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

document.getElementById('btn-mp-lb').addEventListener('click', async () => {
  showScreen('mpLb');
  const scores = await fetchMpLeaderboard();
  renderMpLeaderboard(scores);
});

document.getElementById('btn-mp-lb-back').addEventListener('click', () => {
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

document.getElementById('btn-mp-revive').addEventListener('click', () => {
  reviveMultiplayer();
});

document.getElementById('btn-mp-gameover-leave').addEventListener('click', () => {
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
