import type { PerspectiveCamera } from 'three';
import type { CitySnapshot } from '../../application/dto/CitySnapshot';
import { CityCollision, type Point } from './CityCollision';

/** A person is about this tall relative to buildings that are eighteen units wide. */
const EYE_HEIGHT = 1.7;
const WALK_SPEED = 11;
const RUN_SPEED = 22;
const PLAYER_RADIUS = 0.9;
const LOOK_SENSITIVITY = 0.0022;
/** Stop just short of straight up and straight down, where the view would flip. */
const MAX_PITCH = Math.PI / 2 - 0.05;

const SPRINT_KEYS = new Set(['ShiftLeft', 'ShiftRight']);

const MOVEMENT_KEYS = new Map<string, 'forward' | 'back' | 'left' | 'right'>([
  ['KeyW', 'forward'], ['ArrowUp', 'forward'],
  ['KeyS', 'back'], ['ArrowDown', 'back'],
  ['KeyA', 'left'], ['ArrowLeft', 'left'],
  ['KeyD', 'right'], ['ArrowRight', 'right'],
]);

/**
 * First-person movement through the city.
 *
 * This is the part that separates the page from a picture of a skyline, so it has to feel
 * solid: the walker cannot pass through a building, cannot tunnel through one when the
 * frame rate drops, and slides along a facade rather than catching on it.
 */
export class WalkControls {
  private readonly collision: CityCollision;
  /** Physical keys, not directions: W and ArrowUp are two ways to hold one heading. */
  private readonly held = new Set<string>();
  private position: Point;
  private yaw = 0;
  private pitch = -0.05;
  private readonly sprint = new Set<string>();
  private locked = false;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    city: CitySnapshot,
    centre: Point,
    private readonly onLockChange: (locked: boolean) => void,
  ) {
    this.collision = new CityCollision(city, PLAYER_RADIUS);
    this.position = this.collision.spawn(centre);
    // Face the middle of town so the first step goes somewhere interesting. A Three
    // camera looks along its local -Z, so the heading is the negated offset.
    this.yaw = Math.atan2(this.position.x - centre.x, this.position.z - centre.z);
    this.apply();
  }

  /**
   * Ask for pointer lock, reporting whether it was granted.
   *
   * The browser refuses outside a user gesture and in some embedded contexts. A refusal
   * used to be swallowed while the renderer had already switched to walk mode, which
   * left the two disagreeing and made the button inert until the page was reloaded.
   */
  async enter(): Promise<boolean> {
    const document = this.canvas.ownerDocument;
    const failed = new Promise<boolean>(resolve => {
      document.addEventListener('pointerlockerror', () => resolve(false), { once: true });
    });
    try {
      await Promise.race([Promise.resolve(this.canvas.requestPointerLock()), failed]);
    } catch {
      return false;
    }
    return document.pointerLockElement === this.canvas;
  }

  exit(): void {
    const document = this.canvas.ownerDocument;
    if (document.pointerLockElement !== this.canvas) return;
    // Teardown runs on every city switch, so it can never be allowed to throw.
    try {
      document.exitPointerLock?.();
    } catch {
      // Nothing to release.
    }
  }

  attach(): void {
    const document = this.canvas.ownerDocument;
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    // Losing focus mid-stride would otherwise leave a key latched and the walker
    // drifting into a wall until the visitor comes back and presses it again.
    this.canvas.ownerDocument.defaultView?.addEventListener('blur', this.releaseKeys);
  }

  update(deltaSeconds: number): void {
    if (!this.locked || this.held.size === 0) return;
    const speed = (this.sprint.size > 0 ? RUN_SPEED : WALK_SPEED) * Math.min(deltaSeconds, 0.1);
    const directions = new Set([...this.held].map(code => MOVEMENT_KEYS.get(code)));
    let forward = 0;
    let strafe = 0;
    if (directions.has('forward')) forward += 1;
    if (directions.has('back')) forward -= 1;
    if (directions.has('right')) strafe += 1;
    if (directions.has('left')) strafe -= 1;
    if (forward === 0 && strafe === 0) return;
    // Diagonals must not be faster than walking straight.
    const scale = speed / Math.hypot(forward, strafe);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Forward is the camera's local -Z and right is its local +X, both rotated by yaw.
    // Using +Z here made W walk backwards, and the test agreed because it was written
    // from the same mistaken convention.
    this.position = this.collision.move(
      this.position,
      (strafe * cos - forward * sin) * scale,
      (-forward * cos - strafe * sin) * scale,
    );
    this.apply();
  }

  dispose(): void {
    const document = this.canvas.ownerDocument;
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.defaultView?.removeEventListener('blur', this.releaseKeys);
    this.exit();
    this.held.clear();
  }

  private apply(): void {
    this.camera.position.set(this.position.x, EYE_HEIGHT, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  private readonly onPointerLockChange = (): void => {
    this.locked = this.canvas.ownerDocument.pointerLockElement === this.canvas;
    if (!this.locked) this.releaseKeys();
    this.onLockChange(this.locked);
  };

  private readonly releaseKeys = (): void => {
    this.held.clear();
    this.sprint.clear();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.locked) return;
    if (MOVEMENT_KEYS.has(event.code)) {
      this.held.add(event.code);
      event.preventDefault();
    }
    if (SPRINT_KEYS.has(event.code)) this.sprint.add(event.code);
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
    this.sprint.delete(event.code);
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.yaw -= event.movementX * LOOK_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - event.movementY * LOOK_SENSITIVITY));
    this.apply();
  };
}
