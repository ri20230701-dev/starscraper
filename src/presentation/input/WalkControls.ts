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
  private readonly held = new Set<'forward' | 'back' | 'left' | 'right'>();
  private position: Point;
  private yaw = 0;
  private pitch = -0.05;
  private sprinting = false;
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
    // Face the middle of town so the first step goes somewhere interesting.
    this.yaw = Math.atan2(centre.x - this.position.x, centre.z - this.position.z);
    this.apply();
  }

  enter(): void {
    // Pointer lock is refused outside a user gesture and in some embedded contexts.
    // A rejection is the browser's answer, not a crash, so it must not escape here.
    try {
      void Promise.resolve(this.canvas.requestPointerLock()).catch(() => {});
    } catch {
      // Older signatures throw synchronously instead of rejecting.
    }
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
    const speed = (this.sprinting ? RUN_SPEED : WALK_SPEED) * Math.min(deltaSeconds, 0.1);
    let forward = 0;
    let strafe = 0;
    if (this.held.has('forward')) forward += 1;
    if (this.held.has('back')) forward -= 1;
    if (this.held.has('right')) strafe += 1;
    if (this.held.has('left')) strafe -= 1;
    if (forward === 0 && strafe === 0) return;
    // Diagonals must not be faster than walking straight.
    const scale = speed / Math.hypot(forward, strafe);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    this.position = this.collision.move(
      this.position,
      (forward * sin + strafe * cos) * scale,
      (forward * cos - strafe * sin) * scale,
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
    this.sprinting = false;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.locked) return;
    const movement = MOVEMENT_KEYS.get(event.code);
    if (movement) {
      this.held.add(movement);
      event.preventDefault();
    }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.sprinting = true;
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    const movement = MOVEMENT_KEYS.get(event.code);
    if (movement) this.held.delete(movement);
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') this.sprinting = false;
  };

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.locked) return;
    this.yaw -= event.movementX * LOOK_SENSITIVITY;
    this.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch - event.movementY * LOOK_SENSITIVITY));
    this.apply();
  };
}
