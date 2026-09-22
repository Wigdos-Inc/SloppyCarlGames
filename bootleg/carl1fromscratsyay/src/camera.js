// Follow camera with a soft lead in the direction Carl is running.

class Camera {
  constructor(worldW, worldH) {
    this.x = 0;
    this.y = 0;
    this.worldW = worldW;
    this.worldH = worldH;
    this.shake = 0;
    this.offX = 0;
    this.offY = 0;
  }

  snapTo(target) {
    this.x = this.clampX(target.x + target.w / 2 - VIEW_W / 2);
    this.y = this.clampY(target.y + target.h / 2 - VIEW_H / 2);
  }

  clampX(x) { return clamp(x, 0, Math.max(0, this.worldW - VIEW_W)); }
  clampY(y) { return clamp(y, 0, Math.max(0, this.worldH - VIEW_H)); }

  kick(amount) {
    this.shake = Math.max(this.shake, amount);
  }

  update(dt, target) {
    const lead = clamp(target.vx / 110, -1, 1) * 42;
    const goalX = target.x + target.w / 2 - VIEW_W / 2 + lead;
    const goalY = target.y + target.h / 2 - VIEW_H / 2 - 14;

    // Frame-rate independent smoothing.
    const kx = 1 - Math.pow(0.0015, dt);
    const ky = 1 - Math.pow(0.004, dt);
    this.x = this.clampX(lerp(this.x, goalX, kx));
    this.y = this.clampY(lerp(this.y, goalY, ky));

    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 14);
      this.offX = rand(-this.shake, this.shake);
      this.offY = rand(-this.shake, this.shake);
    } else {
      this.offX = 0;
      this.offY = 0;
    }
  }

  // Integer translation keeps the pixel art from shimmering.
  get drawX() { return Math.round(this.x + this.offX); }
  get drawY() { return Math.round(this.y + this.offY); }
}
