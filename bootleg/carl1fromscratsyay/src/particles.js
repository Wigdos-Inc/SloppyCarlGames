// Throwaway square particles: dust, coin sparkles, enemy confetti.

class Particles {
  constructor() {
    this.list = [];
  }

  burst(x, y, count, opts) {
    const o = opts || {};
    for (let i = 0; i < count; i++) {
      const angle = o.angle !== undefined ? o.angle + rand(-0.6, 0.6) : rand(0, Math.PI * 2);
      const speed = rand((o.speed || 60) * 0.4, o.speed || 60);
      this.list.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (o.lift || 0),
        life: rand((o.life || 0.5) * 0.6, o.life || 0.5),
        maxLife: o.life || 0.5,
        size: o.size || rand(1, 3),
        gravity: o.gravity === undefined ? 260 : o.gravity,
        color: Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : o.color || "#ffffff",
      });
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.list.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    for (const p of this.list) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}
