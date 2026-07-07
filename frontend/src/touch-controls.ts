/**
 * Mobile touch controls: a virtual joystick (movement) + a primary action
 * button (shield), both repositionable/resizable in an "edit mode" and
 * persisted to localStorage. Desktop is untouched — see isTouchCapable().
 */

export interface ControlLayout {
  /** Center x, in px. */
  x: number;
  /** Center y, in px. */
  y: number;
  /** Multiplier applied to the control's viewport-relative base diameter. */
  scale: number;
}

export interface TouchLayoutConfig {
  joystick: ControlLayout;
  action: ControlLayout;
}

export const MIN_SCALE = 0.7;
export const MAX_SCALE = 1.5;

const JOYSTICK_DIAMETER_RATIO = 0.34;
const JOYSTICK_DIAMETER_MIN = 96;
const JOYSTICK_DIAMETER_MAX = 190;

const ACTION_DIAMETER_RATIO = 0.22;
const ACTION_DIAMETER_MIN = 64;
const ACTION_DIAMETER_MAX = 130;

/** Keeps a control fully on-screen instead of flush against the edge. */
const EDGE_MARGIN = 10;
/** Default anchor margin from the screen's corners. */
const DEFAULT_MARGIN = 28;

const STORAGE_KEY = 'dp_touch_layout';

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Pure — a control's base diameter (before its own scale multiplier), sized as a fraction of the smaller viewport dimension and clamped to a sane px range so it's never too small to tap or too big on a tiny screen. */
export function computeBaseDiameter(viewportMin: number, ratio: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, viewportMin * ratio));
}

export function joystickBaseDiameter(viewportWidth: number, viewportHeight: number): number {
  return computeBaseDiameter(
    Math.min(viewportWidth, viewportHeight),
    JOYSTICK_DIAMETER_RATIO,
    JOYSTICK_DIAMETER_MIN,
    JOYSTICK_DIAMETER_MAX,
  );
}

export function actionBaseDiameter(viewportWidth: number, viewportHeight: number): number {
  return computeBaseDiameter(
    Math.min(viewportWidth, viewportHeight),
    ACTION_DIAMETER_RATIO,
    ACTION_DIAMETER_MIN,
    ACTION_DIAMETER_MAX,
  );
}

/** Pure — clamps a circular control's center so its whole bounding box stays inside the viewport (with a small edge margin), even after a resize/rotation or a resize that shrank the control past where it used to sit. */
export function clampCenterToViewport(
  x: number,
  y: number,
  diameter: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const r = diameter / 2;
  const minX = r + EDGE_MARGIN;
  const maxX = Math.max(minX, viewportWidth - r - EDGE_MARGIN);
  const minY = r + EDGE_MARGIN;
  const maxY = Math.max(minY, viewportHeight - r - EDGE_MARGIN);
  return {
    x: Math.min(maxX, Math.max(minX, x)),
    y: Math.min(maxY, Math.max(minY, y)),
  };
}

/** Pure — default bottom-left (joystick) / bottom-right (action) layout for a fresh install with no saved preference. */
export function computeDefaultLayout(viewportWidth: number, viewportHeight: number): TouchLayoutConfig {
  const joystickDiameter = joystickBaseDiameter(viewportWidth, viewportHeight);
  const actionDiameter = actionBaseDiameter(viewportWidth, viewportHeight);

  const joystick = clampCenterToViewport(
    DEFAULT_MARGIN + joystickDiameter / 2,
    viewportHeight - DEFAULT_MARGIN - joystickDiameter / 2,
    joystickDiameter,
    viewportWidth,
    viewportHeight,
  );
  const action = clampCenterToViewport(
    viewportWidth - DEFAULT_MARGIN - actionDiameter / 2,
    viewportHeight - DEFAULT_MARGIN - actionDiameter / 2,
    actionDiameter,
    viewportWidth,
    viewportHeight,
  );

  return {
    joystick: { x: joystick.x, y: joystick.y, scale: 1 },
    action: { x: action.x, y: action.y, scale: 1 },
  };
}

/**
 * Pure — movement vector for the knob's raw offset from the base's center.
 * Below the deadzone the vector is zero (avoids drift from an unsteady
 * thumb); above it, magnitude scales smoothly from 0 to 1 across the
 * remaining travel so a small push moves slower than a full push, mirroring
 * a real analog stick rather than the all-or-nothing feel of a digital key.
 */
export function computeJoystickVector(
  dx: number,
  dy: number,
  maxRadius: number,
  deadzoneRatio = 0.15,
): { x: number; y: number } {
  const dist = Math.hypot(dx, dy);
  const deadzone = maxRadius * deadzoneRatio;
  if (maxRadius <= 0 || dist <= deadzone) return { x: 0, y: 0 };

  const usableRadius = maxRadius - deadzone;
  const magnitude = Math.min(1, (dist - deadzone) / usableRadius);
  return { x: (dx / dist) * magnitude, y: (dy / dist) * magnitude };
}

function isValidControl(value: unknown): value is ControlLayout {
  const v = value as Partial<ControlLayout> | null;
  return !!v && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.scale === 'number';
}

function isValidLayout(value: unknown): value is TouchLayoutConfig {
  const v = value as Partial<TouchLayoutConfig> | null;
  return !!v && isValidControl(v.joystick) && isValidControl(v.action);
}

/** Returns the saved layout, or null if none is stored (or it's malformed) — callers should fall back to computeDefaultLayout(). */
export function loadTouchLayout(): TouchLayoutConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return isValidLayout(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveTouchLayout(layout: TouchLayoutConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function clearTouchLayout(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function isTouchCapable(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

type DragTarget = 'joystick' | 'action';

/**
 * Owns the touch-controls DOM (markup lives in index.html) — wiring up the
 * joystick drag, the action button tap, and the reposition/resize edit mode.
 * A no-op shell on non-touch devices so callers don't need to branch on
 * isTouchCapable() themselves.
 */
export class TouchControls {
  private readonly touchCapable = isTouchCapable();

  private readonly root = document.getElementById('touch-controls') as HTMLElement;
  private readonly joystickEl = document.getElementById('tc-joystick') as HTMLElement;
  private readonly joystickKnob = document.getElementById('tc-joystick-knob') as HTMLElement;
  private readonly actionEl = document.getElementById('tc-action') as HTMLElement;
  private readonly editToggle = document.getElementById('tc-edit-toggle') as HTMLElement;
  private readonly scaleJoystickInput = document.getElementById('tc-scale-joystick') as HTMLInputElement;
  private readonly scaleActionInput = document.getElementById('tc-scale-action') as HTMLInputElement;
  private readonly resetBtn = document.getElementById('tc-reset-btn') as HTMLElement;
  private readonly doneBtn = document.getElementById('tc-done-btn') as HTMLElement;

  private layout: TouchLayoutConfig;
  private hasCustomLayout: boolean;
  private editing = false;
  private visible = false;

  private moveVector = { x: 0, y: 0 };
  private moveTouchId: number | null = null;
  private moveBaseCenter = { x: 0, y: 0 };
  private moveTravelRadius = 0;

  private dragTouchId: number | null = null;
  private dragTarget: DragTarget | null = null;
  private dragOffset = { x: 0, y: 0 };

  private actionHandlers: Array<() => void> = [];

  constructor() {
    const saved = loadTouchLayout();
    this.hasCustomLayout = saved !== null;
    this.layout = saved ?? computeDefaultLayout(window.innerWidth, window.innerHeight);

    if (!this.touchCapable) return; // leave everything hidden/unwired on desktop

    this.applyLayout();
    this.bindEvents();
  }

  onAction(handler: () => void): void {
    this.actionHandlers.push(handler);
  }

  /** Current movement vector (x/y in [-1, 1]), zero when the joystick isn't being touched. */
  getMoveVector(): { x: number; y: number } {
    return { x: this.moveVector.x, y: this.moveVector.y };
  }

  setVisible(active: boolean): void {
    if (!this.touchCapable) return;
    const shouldShow = active;
    if (shouldShow === this.visible) return;
    this.visible = shouldShow;
    this.root.classList.toggle('visible', shouldShow);
    if (!shouldShow) {
      this.exitEditMode();
      this.resetMoveState();
    }
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.handleViewportChange());
    window.addEventListener('orientationchange', () => this.handleViewportChange());

    this.joystickEl.addEventListener('touchstart', e => this.onJoystickTouchStart(e), { passive: false });
    this.actionEl.addEventListener('touchstart', e => this.onActionTouchStart(e), { passive: false });
    window.addEventListener('touchmove', e => this.onWindowTouchMove(e), { passive: false });
    window.addEventListener('touchend', e => this.onWindowTouchEnd(e));
    window.addEventListener('touchcancel', e => this.onWindowTouchEnd(e));

    this.editToggle.addEventListener('click', () => (this.editing ? this.exitEditMode() : this.enterEditMode()));
    this.doneBtn.addEventListener('click', () => this.exitEditMode());
    this.resetBtn.addEventListener('click', () => this.resetToDefault());

    this.scaleJoystickInput.addEventListener('input', () => {
      this.layout.joystick.scale = clampScale(Number(this.scaleJoystickInput.value) / 100);
      this.hasCustomLayout = true;
      this.applyLayout();
    });
    this.scaleActionInput.addEventListener('input', () => {
      this.layout.action.scale = clampScale(Number(this.scaleActionInput.value) / 100);
      this.hasCustomLayout = true;
      this.applyLayout();
    });
    this.scaleJoystickInput.addEventListener('change', () => saveTouchLayout(this.layout));
    this.scaleActionInput.addEventListener('change', () => saveTouchLayout(this.layout));
  }

  private handleViewportChange(): void {
    if (!this.hasCustomLayout) {
      this.layout = computeDefaultLayout(window.innerWidth, window.innerHeight);
    }
    this.applyLayout();
  }

  private applyLayout(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const joystickDiameter = joystickBaseDiameter(vw, vh) * this.layout.joystick.scale;
    const actionDiameter = actionBaseDiameter(vw, vh) * this.layout.action.scale;

    const joystickCenter = clampCenterToViewport(this.layout.joystick.x, this.layout.joystick.y, joystickDiameter, vw, vh);
    const actionCenter = clampCenterToViewport(this.layout.action.x, this.layout.action.y, actionDiameter, vw, vh);
    this.layout.joystick.x = joystickCenter.x;
    this.layout.joystick.y = joystickCenter.y;
    this.layout.action.x = actionCenter.x;
    this.layout.action.y = actionCenter.y;

    this.positionControl(this.joystickEl, joystickCenter.x, joystickCenter.y, joystickDiameter);
    this.positionControl(this.actionEl, actionCenter.x, actionCenter.y, actionDiameter);

    this.scaleJoystickInput.value = String(Math.round(this.layout.joystick.scale * 100));
    this.scaleActionInput.value = String(Math.round(this.layout.action.scale * 100));
  }

  private positionControl(el: HTMLElement, x: number, y: number, diameter: number): void {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${diameter}px`;
    el.style.height = `${diameter}px`;
  }

  private enterEditMode(): void {
    this.editing = true;
    this.resetMoveState();
    this.root.classList.add('tc-editing');
  }

  private exitEditMode(): void {
    if (this.editing) saveTouchLayout(this.layout);
    this.editing = false;
    this.root.classList.remove('tc-editing');
  }

  private resetToDefault(): void {
    this.hasCustomLayout = false;
    clearTouchLayout();
    this.layout = computeDefaultLayout(window.innerWidth, window.innerHeight);
    this.applyLayout();
  }

  private resetMoveState(): void {
    this.moveTouchId = null;
    this.moveVector = { x: 0, y: 0 };
    this.joystickKnob.style.transform = 'translate(-50%, -50%)';
  }

  private onJoystickTouchStart(e: TouchEvent): void {
    if (this.editing) {
      this.startDrag('joystick', e);
      return;
    }
    if (this.moveTouchId !== null) return;
    e.preventDefault();

    const touch = e.changedTouches[0];
    const rect = this.joystickEl.getBoundingClientRect();
    this.moveTouchId = touch.identifier;
    this.moveBaseCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    this.moveTravelRadius = rect.width / 2 - (rect.width * 0.23); // keeps the knob's own radius inside the base
    this.updateMoveVector(touch.clientX, touch.clientY);
  }

  private onActionTouchStart(e: TouchEvent): void {
    if (this.editing) {
      this.startDrag('action', e);
      return;
    }
    e.preventDefault();
    this.actionEl.classList.add('tc-pressed');
    this.actionHandlers.forEach(handler => handler());
  }

  private startDrag(target: DragTarget, e: TouchEvent): void {
    if (this.dragTouchId !== null) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    const control = this.layout[target];
    this.dragTouchId = touch.identifier;
    this.dragTarget = target;
    this.dragOffset = { x: touch.clientX - control.x, y: touch.clientY - control.y };
  }

  private onWindowTouchMove(e: TouchEvent): void {
    if (this.moveTouchId !== null) {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === this.moveTouchId);
      if (touch) {
        e.preventDefault();
        this.updateMoveVector(touch.clientX, touch.clientY);
      }
    }
    if (this.dragTouchId !== null && this.dragTarget) {
      const touch = Array.from(e.changedTouches).find(t => t.identifier === this.dragTouchId);
      if (touch) {
        e.preventDefault();
        this.layout[this.dragTarget].x = touch.clientX - this.dragOffset.x;
        this.layout[this.dragTarget].y = touch.clientY - this.dragOffset.y;
        this.hasCustomLayout = true;
        this.applyLayout();
      }
    }
  }

  private onWindowTouchEnd(e: TouchEvent): void {
    if (this.moveTouchId !== null && Array.from(e.changedTouches).some(t => t.identifier === this.moveTouchId)) {
      this.resetMoveState();
    }
    if (this.dragTouchId !== null && Array.from(e.changedTouches).some(t => t.identifier === this.dragTouchId)) {
      this.dragTouchId = null;
      this.dragTarget = null;
      saveTouchLayout(this.layout);
    }
    this.actionEl.classList.remove('tc-pressed');
  }

  private updateMoveVector(clientX: number, clientY: number): void {
    const dx = clientX - this.moveBaseCenter.x;
    const dy = clientY - this.moveBaseCenter.y;
    this.moveVector = computeJoystickVector(dx, dy, this.moveTravelRadius);

    const knobTravel = this.moveTravelRadius;
    this.joystickKnob.style.transform =
      `translate(calc(-50% + ${this.moveVector.x * knobTravel}px), calc(-50% + ${this.moveVector.y * knobTravel}px))`;
  }
}
