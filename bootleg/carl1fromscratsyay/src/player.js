// Carl. Tuned for a forgiving, floaty-but-snappy feel:
// coyote time, jump buffering, and a variable-height jump.

const PLAYER = {
  ACCEL: 780,
  AIR_ACCEL: 560,
  MAX_RUN: 125,
  FRICTION: 1050,
  AIR_FRICTION: 240,
  GRAVITY: 900,
  MAX_FALL: 400,
  JUMP_V: -330,      // apex ~60px (3.7 tiles)
  JUMP_CUT: 0.38,    // releasing jump early clips the rise
  COYOTE: 0.09,      // grace period after walking off a ledge
  BUFFER: 0.12,      // jump pressed slightly before landing still counts
  SPRING_V: -520,
  STOMP_V: -260,
};

class Player {
  constructor(tx, ty) {
    this.w = 10;
    this.h = 20;
    this.spawnX = tx * TILE + 3;
    // Stand him on the floor of the spawn tile rather than inside it.
    this.spawnY = (ty + 1) * TILE - this.h;
    this.reset();
  }

  reset() {
    this.x = this.spawnX;
    this.y = this.spawnY;
    this.prevY = this.y;
    this.vx = 0;
    this.vy = 0;
    this.face = 1;
    this.onGround = false;
    this.coyote = 0;
    this.buffer = 0;
    this.jumping = false;
    this.runTime = 0;
    this.landSquash = 0;
    this.platform = null;
    this.groundTile = null;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update(dt, world) {
    const input = world.input;
    const dir = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);

    if (dir !== 0) {
      const accel = this.onGround ? PLAYER.ACCEL : PLAYER.AIR_ACCEL;
      this.vx = clamp(this.vx + dir * accel * dt, -PLAYER.MAX_RUN, PLAYER.MAX_RUN);
      this.face = dir;
      this.runTime += dt * (Math.abs(this.vx) / PLAYER.MAX_RUN);
    } else {
      const drag = (this.onGround ? PLAYER.FRICTION : PLAYER.AIR_FRICTION) * dt;
      this.vx = Math.abs(this.vx) <= drag ? 0 : this.vx - sign(this.vx) * drag;
      this.runTime = 0;
    }

    if (input.pressed("jump")) this.buffer = PLAYER.BUFFER;
    this.buffer = Math.max(0, this.buffer - dt);
    this.coyote = this.onGround ? PLAYER.COYOTE : Math.max(0, this.coyote - dt);

    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = PLAYER.JUMP_V;
      this.buffer = 0;
      this.coyote = 0;
      this.onGround = false;
      this.jumping = true;
      this.platform = null;
      Sfx.jump();
      world.particles.burst(this.cx, this.y + this.h, 6, {
        color: "#ffffff", speed: 60, life: 0.24, gravity: 160, angle: Math.PI / 2,
      });
    }

    // Short hop when the jump key is let go on the way up.
    if (this.jumping && !input.down("jump") && this.vy < PLAYER.JUMP_V * PLAYER.JUMP_CUT) {
      this.vy = PLAYER.JUMP_V * PLAYER.JUMP_CUT;
    }
    if (this.vy >= 0) this.jumping = false;

    this.vy = Math.min(this.vy + PLAYER.GRAVITY * dt, PLAYER.MAX_FALL);

    const wasAirborne = !this.onGround;
    const fallSpeed = this.vy;

    this.x += this.vx * dt;
    world.collideX(this);
    this.x = clamp(this.x, 0, world.widthPx - this.w);

    this.prevY = this.y;
    this.y += this.vy * dt;
    this.onGround = false;
    this.platform = null;
    this.groundTile = null;
    world.collideY(this);

    if (this.onGround) {
      if (wasAirborne && fallSpeed > 180) {
        this.landSquash = 1;
        world.particles.burst(this.cx, this.y + this.h, 5, {
          color: "#e8e2d0", speed: 50, life: 0.2, gravity: 150, angle: Math.PI / 2,
        });
      }
      if (this.vy > 0) this.vy = 0;
    }

    this.landSquash = Math.max(0, this.landSquash - dt * 5);
  }

  bounce(velocity) {
    this.vy = velocity;
    this.onGround = false;
    this.jumping = false;
    this.platform = null;
  }

  draw(ctx) {
    const cx = Math.round(this.x + this.w / 2);
    const feet = Math.round(this.y + this.h);

    let sx = 1;
    let sy = 1;
    if (!this.onGround) {
      if (this.vy < -60) { sx = 0.86; sy = 1.14; }
      else if (this.vy > 140) { sx = 1.12; sy = 0.92; }
    } else if (this.landSquash > 0) {
      sx = 1 + 0.3 * this.landSquash;
      sy = 1 - 0.3 * this.landSquash;
    }

    ctx.save();
    ctx.translate(cx, feet);
    ctx.scale(sx, sy);

    const f = this.face;
    const running = this.onGround && Math.abs(this.vx) > 8;
    const step = running ? Math.sin(this.runTime * 16) : 0;
    const bob = running ? Math.abs(Math.sin(this.runTime * 16)) * -1 : 0;

    // Sprite is built upward from the feet at y = 0, 20px tall.
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(-5, -1, 10, 1);

    // legs / shoes
    ctx.fillStyle = "#5a3320";
    if (this.onGround) {
      ctx.fillRect(-4 + step * 2, -4, 4, 4);
      ctx.fillRect(1 - step * 2, -4, 4, 4);
    } else {
      ctx.fillRect(-4 + f, -4, 4, 3);
      ctx.fillRect(1 + f, -6, 4, 4);
    }

    // overalls
    ctx.fillStyle = "#2f56ad";
    ctx.fillRect(-5, -11 + bob, 10, 7);
    ctx.fillStyle = "#3b6bd6";
    ctx.fillRect(-5, -11 + bob, 10, 6);
    ctx.fillStyle = "#ffd447";
    ctx.fillRect(-3, -10 + bob, 1, 1);
    ctx.fillRect(2, -10 + bob, 1, 1);

    // shirt + swinging arm
    ctx.fillStyle = "#4fae5f";
    ctx.fillRect(-4, -14 + bob, 8, 3);
    ctx.fillStyle = "#59c26b";
    ctx.fillRect(f > 0 ? 3 : -5, -13 + bob - (this.onGround ? step * 2 : 3), 2, 5);

    // head
    ctx.fillStyle = "#d69a6d";
    ctx.fillRect(-4, -19 + bob, 8, 5);
    ctx.fillStyle = "#f2c199";
    ctx.fillRect(-4, -19 + bob, 8, 4);

    // ear, eye and moustache all face the way he's heading
    ctx.fillStyle = "#d69a6d";
    ctx.fillRect(f > 0 ? -4 : 3, -16 + bob, 1, 2);
    ctx.fillStyle = "#33240f";
    ctx.fillRect(f > 0 ? 1 : -2, -17 + bob, 2, 2);
    ctx.fillRect(f > 0 ? 0 : -4, -15 + bob, 4, 1);

    // cap
    ctx.fillStyle = "#c73d3d";
    ctx.fillRect(-5, -20 + bob, 10, 2);
    ctx.fillStyle = "#d94f4f";
    ctx.fillRect(-5, -20 + bob, 10, 1);
    ctx.fillRect(f > 0 ? 5 : -8, -19 + bob, 3, 1);

    ctx.restore();
  }
}
