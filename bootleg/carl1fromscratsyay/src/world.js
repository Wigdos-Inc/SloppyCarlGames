// One playable level: the tile grid, its entities, and all the rules that
// connect them.

class World {
  constructor(def, input) {
    this.def = def;
    this.name = def.name;
    this.input = input;
    this.particles = new Particles();
    this.entities = [];
    this.platforms = [];
    this.springTimers = new Map();

    this.parse(def.rows);

    this.camera = new Camera(this.widthPx, this.heightPx);
    this.camera.snapTo(this.player);

    this.time = 0;
    this.animTime = 0;
    this.coinsCollected = 0;
    this.stomps = 0;
    this.dead = false;
    this.deathTimer = 0;
    this.finished = false;
    this.finishTimer = 0;
    this.invincible = false; // set while the level idles behind the title screen
  }

  parse(rows) {
    this.cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    this.rows = rows.length;
    this.widthPx = this.cols * TILE;
    this.heightPx = this.rows * TILE;
    this.grid = [];
    this.coinTotal = 0;

    for (let ty = 0; ty < this.rows; ty++) {
      const row = rows[ty].padEnd(this.cols, TILE_EMPTY);
      const out = new Array(this.cols);
      for (let tx = 0; tx < this.cols; tx++) {
        const ch = row[tx];
        switch (ch) {
          case "P":
            this.player = new Player(tx, ty);
            out[tx] = TILE_EMPTY;
            break;
          case "o":
            this.entities.push(new Coin(tx, ty));
            this.coinTotal++;
            out[tx] = TILE_EMPTY;
            break;
          case "e":
            this.entities.push(new Walker(tx, ty));
            out[tx] = TILE_EMPTY;
            break;
          case "f":
            this.entities.push(new Flyer(tx, ty));
            out[tx] = TILE_EMPTY;
            break;
          case "m":
            this.platforms.push(new MovingPlatform(tx, ty, "x"));
            out[tx] = TILE_EMPTY;
            break;
          case "n":
            this.platforms.push(new MovingPlatform(tx, ty, "y"));
            out[tx] = TILE_EMPTY;
            break;
          case TILE_GOAL:
            // The flag is drawn three tiles tall, so the trigger matches the
            // whole pole -- you can't sail over the top of it.
            this.goalRect = { x: tx * TILE, y: (ty - 2) * TILE, w: TILE, h: TILE * 3 };
            out[tx] = ch;
            break;
          default:
            out[tx] = ch;
        }
      }
      this.grid.push(out);
    }

    if (!this.player) this.player = new Player(2, this.rows - 3);
  }

  // ------------------------------------------------------------- tile reads
  tile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= this.cols || ty >= this.rows) return TILE_EMPTY;
    return this.grid[ty][tx];
  }

  isSolid(tx, ty) {
    return this.tile(tx, ty) === TILE_SOLID;
  }

  isSolidAt(px, py) {
    return this.isSolid(Math.floor(px / TILE), Math.floor(py / TILE));
  }

  // Solid ground or a one-way platform -- anything an enemy can stand on.
  isStandableAt(px, py) {
    const ch = this.tile(Math.floor(px / TILE), Math.floor(py / TILE));
    return ch === TILE_SOLID || ch === TILE_PLATFORM;
  }

  // ------------------------------------------------------------- collision
  collideX(b) {
    if (b.vx === 0) return;
    const top = Math.floor(b.y / TILE);
    const bottom = Math.floor((b.y + b.h - 1) / TILE);
    if (b.vx > 0) {
      // Probe the leading edge, so resting against a wall stays resolved
      // instead of re-penetrating it by a pixel every step.
      const tx = Math.floor((b.x + b.w) / TILE);
      for (let ty = top; ty <= bottom; ty++) {
        if (this.isSolid(tx, ty)) {
          b.x = tx * TILE - b.w;
          b.vx = 0;
          return;
        }
      }
    } else {
      const tx = Math.floor(b.x / TILE);
      for (let ty = top; ty <= bottom; ty++) {
        if (this.isSolid(tx, ty)) {
          b.x = (tx + 1) * TILE;
          b.vx = 0;
          return;
        }
      }
    }
  }

  collideY(b) {
    const left = Math.floor(b.x / TILE);
    const right = Math.floor((b.x + b.w - 1) / TILE);

    if (b.vy > 0) {
      // The row the feet are entering. Using y+h (not y+h-1) keeps a resting
      // body detected as grounded every step instead of flickering.
      const ty = Math.floor((b.y + b.h) / TILE);
      const prevBottom = b.prevY + b.h;
      for (let tx = left; tx <= right; tx++) {
        const ch = this.tile(tx, ty);
        // One-way platforms only catch you if you were above them last step.
        const lands = ch === TILE_SOLID || (ch === TILE_PLATFORM && prevBottom <= ty * TILE + 1);
        if (lands) {
          b.y = ty * TILE - b.h;
          b.vy = 0;
          b.onGround = true;
          b.groundTile = ch;
          return;
        }
      }
    } else if (b.vy < 0) {
      const ty = Math.floor(b.y / TILE);
      for (let tx = left; tx <= right; tx++) {
        if (this.isSolid(tx, ty)) {
          b.y = (ty + 1) * TILE;
          b.vy = 0;
          return;
        }
      }
    }

    // Moving platforms carry Carl only; enemies ignore them.
    if (b === this.player && b.vy >= 0) {
      const prevBottom = b.prevY + b.h;
      for (const p of this.platforms) {
        if (b.x + b.w <= p.x || b.x >= p.x + p.w) continue;
        if (prevBottom <= p.y + 3 && b.y + b.h >= p.y) {
          b.y = p.y - b.h;
          b.vy = 0;
          b.onGround = true;
          b.platform = p;
          b.groundTile = TILE_PLATFORM;
          return;
        }
      }
    }
  }

  // ------------------------------------------------------------- events
  collectCoin(coin) {
    this.coinsCollected++;
    Sfx.coin();
    this.particles.burst(coin.x + coin.w / 2, coin.y + coin.h / 2, 8, {
      color: ["#ffd447", "#fff3bf", "#ffffff"],
      speed: 80,
      life: 0.4,
      gravity: 90,
      size: 2,
    });
  }

  springPress(tx, ty) {
    const hit = this.springTimers.get(tx + "," + ty);
    if (hit === undefined) return 0;
    return Math.max(0, 1 - (this.animTime - hit) * 6);
  }

  killPlayer() {
    if (this.dead || this.finished || this.invincible) return;
    this.dead = true;
    this.deathTimer = 0;
    this.camera.kick(5);
    Sfx.hurt();
    this.particles.burst(this.player.cx, this.player.cy, 22, {
      color: ["#d94f4f", "#3b6bd6", "#f2c199", "#ffffff"],
      speed: 150,
      life: 0.9,
      lift: 70,
      size: 2,
    });
  }

  reachGoal() {
    if (this.finished || this.dead) return;
    this.finished = true;
    this.finishTimer = 0;
    Sfx.goal();
    this.particles.burst(this.player.cx, this.player.cy, 40, {
      color: ["#ffd447", "#57b04a", "#ffffff", "#e0453f"],
      speed: 160,
      life: 1.1,
      lift: 90,
      size: 2,
    });
  }

  checkEntityHits() {
    const p = this.player;
    for (const e of this.entities) {
      if (!e.alive || !e.hurts) continue;
      if (!aabb(p, e)) continue;
      // Falling onto the top half counts as a stomp, anything else hurts.
      const stomped = p.vy > 0 && p.prevY + p.h <= e.y + 8;
      if (e.stompable && stomped) {
        e.squash(this);
        p.bounce(PLAYER.STOMP_V);
        this.stomps++;
        this.camera.kick(2);
        Sfx.stomp();
      } else {
        this.killPlayer();
        return;
      }
    }
  }

  checkTileTriggers() {
    const p = this.player;

    if (this.goalRect && aabb(p, this.goalRect)) {
      this.reachGoal();
      return;
    }

    // Slightly inset box, so a pixel of overlap isn't instant death.
    const bx = p.x + 2;
    const by = p.y + 3;
    const left = Math.floor(bx / TILE);
    const right = Math.floor((bx + p.w - 5) / TILE);
    const top = Math.floor(by / TILE);
    const bottom = Math.floor((by + p.h - 6) / TILE);

    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        const ch = this.tile(tx, ty);
        if (ch === TILE_SPIKE) {
          this.killPlayer();
          return;
        }
        if (ch === TILE_SPRING && p.vy >= -40) {
          this.springTimers.set(tx + "," + ty, this.animTime);
          p.bounce(PLAYER.SPRING_V);
          this.camera.kick(2);
          Sfx.spring();
          this.particles.burst(tx * TILE + 8, ty * TILE + 14, 10, {
            color: ["#ffd447", "#ffffff"],
            speed: 90,
            life: 0.35,
          });
          return;
        }
      }
    }
  }

  // ------------------------------------------------------------- loop
  update(dt) {
    this.animTime += dt;
    this.particles.update(dt);

    if (this.dead) {
      this.deathTimer += dt;
      this.camera.update(dt, this.player);
      return;
    }

    if (this.finished) {
      this.finishTimer += dt;
      this.player.vx = 0;
      this.player.vy = Math.min(this.player.vy + PLAYER.GRAVITY * dt, PLAYER.MAX_FALL);
      this.player.prevY = this.player.y;
      this.player.y += this.player.vy * dt;
      this.player.onGround = false;
      this.collideY(this.player);
      this.camera.update(dt, this.player);
      return;
    }

    this.time += dt;

    // Platforms move first so anyone riding one inherits the motion.
    for (const p of this.platforms) p.update(dt);
    const ride = this.player.platform;
    if (ride) {
      this.player.x += ride.dx;
      this.player.y += ride.dy;
    }

    this.player.update(dt, this);

    for (const e of this.entities) if (e.alive) e.update(dt, this);
    if (this.entities.some((e) => !e.alive)) {
      this.entities = this.entities.filter((e) => e.alive);
    }

    this.checkEntityHits();
    if (this.dead) return;

    this.checkTileTriggers();

    if (this.player.y > this.heightPx + 48) this.killPlayer();

    this.camera.update(dt, this.player);
  }

  draw(ctx) {
    const t = this.animTime;
    drawSky(ctx, this.camera, t);

    ctx.save();
    ctx.translate(-this.camera.drawX, -this.camera.drawY);
    drawTiles(ctx, this, this.camera, t);
    for (const p of this.platforms) p.draw(ctx, t);
    for (const e of this.entities) e.draw(ctx, t);
    if (!this.dead) this.player.draw(ctx);
    this.particles.draw(ctx);
    ctx.restore();
  }
}
