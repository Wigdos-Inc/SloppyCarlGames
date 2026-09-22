// Everything in a level that isn't a tile or Carl himself.

class Entity {
  constructor(x, y, w, h) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.alive = true;
    this.hurts = false;      // touching this kills Carl
    this.stompable = false;  // landing on it kills the entity instead
    this.t = rand(0, 6);
  }
  update() {}
  draw() {}
}

// ---------------------------------------------------------------- coin
class Coin extends Entity {
  constructor(tx, ty) {
    super(tx * TILE + 3, ty * TILE + 3, 10, 10);
    this.bobY = this.y;
  }

  update(dt, world) {
    this.t += dt;
    this.y = this.bobY + Math.sin(this.t * 3) * 1.5;
    if (aabb(this, world.player)) {
      this.alive = false;
      world.collectCoin(this);
    }
  }

  draw(ctx) {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    // A flat ellipse whose width oscillates reads as a spinning coin.
    const squash = Math.abs(Math.cos(this.t * 3));
    const rw = Math.max(1, 5 * squash);
    ctx.fillStyle = "#e0a100";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rw + 0.6, 5.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffd447";
    ctx.beginPath();
    ctx.ellipse(cx, cy, rw, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (squash > 0.5) {
      ctx.fillStyle = "#fff3bf";
      ctx.fillRect(cx - 0.5, cy - 2.5, 1, 5);
    }
  }
}

// ---------------------------------------------------------------- walker
// Patrols a ledge, turns at walls and at drop-offs.
class Walker extends Entity {
  constructor(tx, ty) {
    super(tx * TILE + 1, (ty + 1) * TILE - 14, 14, 14);
    this.vx = -32;
    this.vy = 0;
    this.hurts = true;
    this.stompable = true;
    this.squashTimer = 0;
  }

  update(dt, world) {
    if (this.squashTimer > 0) {
      this.squashTimer += dt;
      if (this.squashTimer > 0.4) this.alive = false;
      return;
    }
    this.t += dt;

    const probeX = this.vx > 0 ? this.x + this.w + 1 : this.x - 1;
    if (world.isSolidAt(probeX, this.y + this.h - 4)) this.vx = -this.vx;
    else if (this.vy === 0 && !world.isStandableAt(probeX, this.y + this.h + 2)) this.vx = -this.vx;

    this.x += this.vx * dt;
    world.collideX(this);

    this.vy = Math.min(this.vy + 900 * dt, 400);
    this.prevY = this.y;
    this.y += this.vy * dt;
    this.onGround = false;
    world.collideY(this);
    if (this.onGround) this.vy = 0;

    if (this.y > world.heightPx + 64) this.alive = false;
  }

  squash(world) {
    this.squashTimer = 0.0001;
    this.hurts = false;
    world.particles.burst(this.x + this.w / 2, this.y + this.h / 2, 12, {
      color: ["#9b5de5", "#c99bff", "#ffffff"],
      speed: 110,
      life: 0.45,
      lift: 40,
    });
  }

  draw(ctx) {
    const squashing = this.squashTimer > 0;
    const h = squashing ? 5 : this.h - 2 + Math.sin(this.t * 7) * 1;
    const y = this.y + this.h - h;
    const cx = this.x + this.w / 2;

    ctx.fillStyle = "#5b2f8c";
    roundRect(ctx, this.x, y + 1, this.w, h, 4);
    ctx.fill();
    ctx.fillStyle = "#9b5de5";
    roundRect(ctx, this.x, y, this.w, h, 4);
    ctx.fill();

    if (squashing) return;

    // feet
    ctx.fillStyle = "#3d1f61";
    const step = Math.sin(this.t * 9) * 2;
    ctx.fillRect(this.x + 1, this.y + this.h - 2, 4, 2);
    ctx.fillRect(this.x + this.w - 5, this.y + this.h - 2 - Math.max(0, step), 4, 2);

    // eyes, looking where it walks
    const dir = this.vx > 0 ? 1 : -1;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cx - 4 + dir, y + 4, 3, 4);
    ctx.fillRect(cx + 1 + dir, y + 4, 3, 4);
    ctx.fillStyle = "#1b0f2e";
    ctx.fillRect(cx - 3 + dir * 2, y + 5, 2, 3);
    ctx.fillRect(cx + 2 + dir * 2, y + 5, 2, 3);
    // scowl
    ctx.fillStyle = "#3d1f61";
    ctx.fillRect(cx - 3, y + 10, 6, 1);
  }
}

// ---------------------------------------------------------------- flyer
// Drifts along a fixed lissajous path, so it never wanders off its post.
class Flyer extends Entity {
  constructor(tx, ty) {
    super(tx * TILE + 1, ty * TILE + 2, 14, 12);
    this.originX = this.x;
    this.originY = this.y;
    this.hurts = true;
    this.stompable = true;
    this.squashTimer = 0;
    this.vy = 0;
  }

  update(dt, world) {
    if (this.squashTimer > 0) {
      this.squashTimer += dt;
      this.vy += 900 * dt;
      this.y += this.vy * dt;
      if (this.squashTimer > 0.7) this.alive = false;
      return;
    }
    this.t += dt;
    this.x = this.originX + Math.sin(this.t * 1.15) * 46;
    this.y = this.originY + Math.sin(this.t * 2.3) * 15;
  }

  squash(world) {
    this.squashTimer = 0.0001;
    this.hurts = false;
    this.vy = -90;
    world.particles.burst(this.x + this.w / 2, this.y + this.h / 2, 12, {
      color: ["#ff6b9d", "#ffc2d6", "#ffffff"],
      speed: 110,
      life: 0.45,
    });
  }

  draw(ctx) {
    const cx = this.x + this.w / 2;
    const cy = this.y + this.h / 2;
    const dir = Math.cos(this.t * 1.15) > 0 ? 1 : -1;

    if (this.squashTimer > 0) {
      ctx.fillStyle = "#ff6b9d";
      roundRect(ctx, this.x, cy, this.w, 4, 2);
      ctx.fill();
      return;
    }

    // wings flap
    const flap = Math.sin(this.t * 14) * 3;
    ctx.fillStyle = "#d94a7a";
    ctx.beginPath();
    ctx.moveTo(cx - 3, cy);
    ctx.lineTo(cx - 10, cy - 3 + flap);
    ctx.lineTo(cx - 3, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy);
    ctx.lineTo(cx + 10, cy - 3 + flap);
    ctx.lineTo(cx + 3, cy + 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#ff6b9d";
    roundRect(ctx, cx - 5, cy - 5, 10, 10, 4);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(cx - 3 + dir, cy - 2, 3, 3);
    ctx.fillStyle = "#5c1030";
    ctx.fillRect(cx - 2 + dir * 2, cy - 1, 2, 2);
    ctx.fillStyle = "#5c1030";
    ctx.fillRect(cx - 2, cy + 3, 4, 1);
  }
}

// ---------------------------------------------------------------- lift
// Two tiles wide, rides back and forth; Carl is carried while standing on it.
class MovingPlatform extends Entity {
  constructor(tx, ty, axis) {
    super(tx * TILE, ty * TILE + 4, TILE * 2, 6);
    this.axis = axis;
    this.originX = this.x;
    this.originY = this.y;
    this.amp = axis === "x" ? 44 : 44;
    this.speed = axis === "x" ? 1.1 : 0.9;
    this.dx = 0;
    this.dy = 0;
    this.isPlatform = true;
  }

  update(dt) {
    const px = this.x;
    const py = this.y;
    this.t += dt;
    if (this.axis === "x") this.x = this.originX + Math.sin(this.t * this.speed) * this.amp;
    else this.y = this.originY + Math.sin(this.t * this.speed) * this.amp;
    this.dx = this.x - px;
    this.dy = this.y - py;
  }

  draw(ctx) {
    ctx.fillStyle = "#6b4a2f";
    ctx.fillRect(this.x, this.y + 3, this.w, 3);
    ctx.fillStyle = "#b1793f";
    ctx.fillRect(this.x, this.y, this.w, 4);
    ctx.fillStyle = "#d9a566";
    ctx.fillRect(this.x, this.y, this.w, 1);
    ctx.fillStyle = "#4a3320";
    for (let i = 4; i < this.w; i += 8) ctx.fillRect(this.x + i, this.y + 1, 1, 2);
  }
}
