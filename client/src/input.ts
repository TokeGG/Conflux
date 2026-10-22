// Keyboard and mouse to the simulation's Input. Mouse look uses pointer lock, so the crosshair stays at the screen centre.
import { BTN, idleInput, ELEMENTS, type Input } from '@conflux/shared';

export interface Bindings {
  forward: string;
  back: string;
  left: string;
  right: string;
  utility: string;
  dodge: string;
  jump: string;
  interact: string;
  cycle: string;
  elements: [string, string, string, string];
}

export const defaultBindings = (): Bindings => ({ forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', utility: 'KeyQ', dodge: 'ShiftLeft', jump: 'Space', interact: 'KeyE', cycle: 'KeyR', elements: ['Digit1', 'Digit2', 'Digit3', 'Digit4'] });

const PITCH_LIMIT = 1.3;

/** Keys typed into a dev panel box are not game controls. */
function typingInAField(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
}

export class InputController {
  bindings = defaultBindings();
  sensitivity = 0.0022;
  yaw = 0;
  pitch = 0;
  private keys = new Set<string>();
  private mouse = 0;
  private swap = -1;
  private element = 0;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', (e) => this.down(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => (this.keys.clear(), (this.mouse = 0)));
    window.addEventListener('mousemove', (e) => this.look(e.movementX, e.movementY));
    target.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== target) void target.requestPointerLock?.();
      if (e.button === 0) this.mouse |= BTN.LMB;
      if (e.button === 2) this.mouse |= BTN.RMB;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse &= ~BTN.LMB;
      if (e.button === 2) this.mouse &= ~BTN.RMB;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** How many times the game asked for the mouse (the smoke tests read this). */
  lockRequests = 0;

  /** Asks for the mouse again; call it from the click that closes a menu, since the browser only allows it on a user gesture. */
  requestLock(): void {
    if (document.pointerLockElement === this.target) return;
    this.lockRequests++;
    void this.target.requestPointerLock?.();
  }

  /** Tells the controller which element is active so Q can step to the next one. */
  setElement(index: number): void {
    this.element = index;
  }

  look(dx: number, dy: number): void {
    if (document.pointerLockElement !== this.target && !this.unlocked) return;
    // yaw measures from +z toward +x, which is to the LEFT of a camera looking along +z, so a mouse move to the right lowers it
    this.yaw -= dx * this.sensitivity;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - dy * this.sensitivity));
  }

  /** Lets tests and the benchmark turn the camera without pointer lock. */
  unlocked = false;

  private down(e: KeyboardEvent): void {
    if (e.repeat || typingInAField(e.target)) return;
    this.keys.add(e.code);
    const i = this.bindings.elements.indexOf(e.code);
    if (i >= 0) this.swap = i;
    if (e.code === this.bindings.cycle) this.swap = (this.element + 1) % ELEMENTS.length;
  }

  poll(camOrigin = idleInput().camOrigin): Input {
    const b = this.bindings;
    const k = (c: string) => (this.keys.has(c) ? 1 : 0);
    let buttons = this.mouse;
    if (k(b.utility)) buttons |= BTN.UTIL;
    if (k(b.dodge)) buttons |= BTN.DODGE;
    if (k(b.jump)) buttons |= BTN.JUMP;
    if (k(b.interact)) buttons |= BTN.INTERACT;
    const swapTo = this.swap;
    this.swap = -1;
    return { // the sim's +moveX is toward (cos yaw, -sin yaw), the left of the screen, so the right key sends -1
      moveX: k(b.left) - k(b.right), moveZ: k(b.forward) - k(b.back), aimYaw: this.yaw, aimPitch: this.pitch, camOrigin, buttons, swapTo };
  }
}
