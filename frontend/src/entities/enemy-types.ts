import { glow, noGlow } from '../rendering/glow';

export interface EnemyInstance {
  x: number;
  y: number;
  r: number;
  type: EnemyType;
  phase: number;
  hitFlash: number;
}

export interface EnemyType {
  name: string;
  color: string;
  gColor: string;
  /** Base radius in pixels — single-player instances use this directly; multiplayer scales it to the world/local ratio. */
  r: number;
  hp: number;
  dmg: number;
  points: number;
  /** Multiplier applied on top of the room/wave's base enemy speed. */
  speed: number;
  draw(ctx: CanvasRenderingContext2D, e: EnemyInstance): void;
}

/**
 * The single roster of enemy visuals/stats, shared by single-player and the
 * multiplayer test mode so the two can never visually drift apart. Only the
 * *simulation* differs (single-player: local wave-based spawner; multiplayer:
 * server-driven, movement only, no hp/damage yet — see backend/src/realtime/rooms.js,
 * which keeps its own minimal { name, speed } table since it has no renderer).
 */
export const ENEMY_TYPES: EnemyType[] = [
  {
    name: 'jellyfish',
    color: '#ff2d55',
    gColor: '#c01a3a',
    r: 18,
    hp: 1,
    dmg: 20,
    points: 100,
    speed: 1.0,
    draw(ctx, e) {
      const pulse = 0.85 + 0.15 * Math.sin(Date.now() * 0.003 + e.phase);
      const r = e.r * pulse;
      // Bell
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = `rgba(255,45,85,0.3)`;
      glow(ctx, e.type.color, 18);
      ctx.fill();
      ctx.strokeStyle = e.type.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      noGlow(ctx);
      // Tentacles
      for (let i = 0; i < 5; i++) {
        const tx = e.x + (i - 2) * (r * 0.4);
        const ty = e.y;
        const tlen = r * 0.8 + Math.sin(Date.now() * 0.004 + i + e.phase) * 6;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.sin(Date.now() * 0.003 + i) * 4, ty + tlen);
        ctx.strokeStyle = `rgba(255,45,85,0.5)`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    },
  },
  {
    name: 'angler',
    color: '#ffb800',
    gColor: '#cc9200',
    r: 14,
    hp: 2,
    dmg: 30,
    points: 200,
    speed: 1.3,
    draw(ctx, e) {
      const r = e.r;
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, r * 1.4, r, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,184,0,0.2)`;
      glow(ctx, e.type.color, 15);
      ctx.fill();
      ctx.strokeStyle = e.type.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Lure
      const lx = e.x - r * 1.6;
      const ly = e.y - r * 0.5 + Math.sin(Date.now() * 0.005 + e.phase) * 4;
      ctx.beginPath();
      ctx.moveTo(e.x - r, e.y - r * 0.3);
      ctx.lineTo(lx, ly);
      ctx.strokeStyle = `rgba(255,184,0,0.5)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lx, ly, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffb800';
      glow(ctx, '#ffb800', 12);
      ctx.fill();
      noGlow(ctx);
    },
  },
  {
    name: 'leviathan',
    color: '#7b2fff',
    gColor: '#5a20cc',
    r: 26,
    hp: 4,
    dmg: 40,
    points: 500,
    speed: 0.7,
    draw(ctx, e) {
      const r = e.r;
      const t = Date.now() * 0.002 + e.phase;
      // Body
      ctx.beginPath();
      ctx.ellipse(e.x, e.y, r * 1.2, r * 0.8, Math.sin(t * 0.5) * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(123,47,255,0.25)`;
      glow(ctx, e.type.color, 25);
      ctx.fill();
      ctx.strokeStyle = e.type.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      noGlow(ctx);
      // Eye
      ctx.beginPath();
      ctx.arc(e.x + r * 0.5, e.y - r * 0.1, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(123,47,255,0.8)';
      glow(ctx, e.type.color, 15);
      ctx.fill();
      noGlow(ctx);
      // Fins
      ctx.beginPath();
      ctx.moveTo(e.x + r * 1.1, e.y);
      ctx.lineTo(e.x + r * 1.8, e.y - r * 0.6 + Math.sin(t) * 5);
      ctx.lineTo(e.x + r * 1.8, e.y + r * 0.6 + Math.sin(t) * 5);
      ctx.closePath();
      ctx.fillStyle = `rgba(123,47,255,0.4)`;
      ctx.fill();
    },
  },
];

export function findEnemyType(name: string): EnemyType {
  return ENEMY_TYPES.find(t => t.name === name) ?? ENEMY_TYPES[0];
}
