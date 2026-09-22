// All the drawing that isn't an entity: sky, tiles, HUD, overlays.

const CLOUDS = [
  { x: 40, y: 34, s: 1.0 }, { x: 190, y: 18, s: 0.7 }, { x: 320, y: 46, s: 1.2 },
  { x: 470, y: 26, s: 0.8 }, { x: 610, y: 40, s: 1.0 }, { x: 760, y: 20, s: 0.9 },
  { x: 900, y: 50, s: 1.1 }, { x: 1040, y: 30, s: 0.75 },
];

function drawText(ctx, str, x, y, opts) {
  const o = opts || {};
  const size = o.size || 10;
  ctx.font = (o.weight || "bold") + " " + size + 'px "Courier New", ui-monospace, monospace';
  ctx.textAlign = o.align || "left";
  ctx.textBaseline = o.baseline || "top";
  if (o.shadow !== false) {
    ctx.fillStyle = o.shadowColor || "rgba(0,0,0,0.55)";
    ctx.fillText(str, x + 1, y + 1);
  }
  ctx.fillStyle = o.color || "#ffffff";
  ctx.fillText(str, x, y);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function drawSky(ctx, cam, time) {
  const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
  g.addColorStop(0, "#4aa6f0");
  g.addColorStop(0.55, "#83ccfb");
  g.addColorStop(1, "#cdeeff");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  // sun
  const sunX = VIEW_W - 70 - cam.x * 0.03;
  ctx.fillStyle = "rgba(255,247,200,0.35)";
  ctx.beginPath();
  ctx.arc(sunX, 44, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff6c2";
  ctx.beginPath();
  ctx.arc(sunX, 44, 15, 0, Math.PI * 2);
  ctx.fill();

  // clouds, drifting slowly and wrapping around
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const c of CLOUDS) {
    const span = 1200;
    let x = ((c.x - cam.x * 0.14 + time * 5) % span + span) % span - 120;
    const y = c.y;
    const s = c.s;
    ctx.beginPath();
    ctx.arc(x, y, 9 * s, 0, Math.PI * 2);
    ctx.arc(x + 10 * s, y - 4 * s, 11 * s, 0, Math.PI * 2);
    ctx.arc(x + 22 * s, y, 8 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x - 2, y, 26 * s, 8 * s);
  }

  drawHills(ctx, cam, VIEW_H - 62, 0.25, "#6ea86a", 26, 0.012);
  drawHills(ctx, cam, VIEW_H - 34, 0.45, "#4e8a52", 18, 0.02);
}

function drawHills(ctx, cam, baseY, parallax, color, amp, freq) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, VIEW_H);
  const off = cam.x * parallax;
  for (let x = 0; x <= VIEW_W; x += 4) {
    const wx = x + off;
    const y = baseY - Math.sin(wx * freq) * amp - Math.sin(wx * freq * 2.7) * (amp * 0.3);
    ctx.lineTo(x, y);
  }
  ctx.lineTo(VIEW_W, VIEW_H);
  ctx.closePath();
  ctx.fill();
}

function drawTiles(ctx, world, cam, time) {
  const x0 = Math.max(0, Math.floor(cam.x / TILE) - 1);
  const x1 = Math.min(world.cols - 1, Math.ceil((cam.x + VIEW_W) / TILE) + 1);
  const y0 = Math.max(0, Math.floor(cam.y / TILE) - 1);
  const y1 = Math.min(world.rows - 1, Math.ceil((cam.y + VIEW_H) / TILE) + 1);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const ch = world.tile(tx, ty);
      if (ch === TILE_EMPTY) continue;
      const x = tx * TILE;
      const y = ty * TILE;

      if (ch === TILE_SOLID) {
        const open = world.tile(tx, ty - 1) !== TILE_SOLID;
        ctx.fillStyle = "#6e4429";
        ctx.fillRect(x, y, TILE, TILE);
        ctx.fillStyle = "#8a5a3b";
        ctx.fillRect(x, y, TILE - 1, TILE - 1);
        ctx.fillStyle = "#5b3722";
        ctx.fillRect(x + 3, y + 8, 3, 2);
        ctx.fillRect(x + 10, y + 12, 2, 2);
        if (open) {
          ctx.fillStyle = "#3f8a41";
          ctx.fillRect(x, y, TILE, 5);
          ctx.fillStyle = "#57b04a";
          ctx.fillRect(x, y, TILE, 3);
          ctx.fillStyle = "#79cf62";
          ctx.fillRect(x, y, TILE, 1);
        }
      } else if (ch === TILE_PLATFORM) {
        ctx.fillStyle = "#6b4a2f";
        ctx.fillRect(x, y + 3, TILE, 3);
        ctx.fillStyle = "#b1793f";
        ctx.fillRect(x, y, TILE, 4);
        ctx.fillStyle = "#d9a566";
        ctx.fillRect(x, y, TILE, 1);
        ctx.fillStyle = "#4a3320";
        ctx.fillRect(x + 4, y + 1, 1, 2);
        ctx.fillRect(x + 11, y + 1, 1, 2);
      } else if (ch === TILE_SPIKE) {
        ctx.fillStyle = "#59606e";
        ctx.fillRect(x, y + TILE - 3, TILE, 3);
        for (let i = 0; i < 4; i++) {
          const sx = x + i * 4;
          ctx.fillStyle = i % 2 ? "#aab6c8" : "#c8d3e2";
          ctx.beginPath();
          ctx.moveTo(sx, y + TILE - 2);
          ctx.lineTo(sx + 2, y + 4);
          ctx.lineTo(sx + 4, y + TILE - 2);
          ctx.closePath();
          ctx.fill();
        }
      } else if (ch === TILE_SPRING) {
        const press = world.springPress(tx, ty);
        const top = y + 4 + press * 7;
        ctx.fillStyle = "#7a2f2f";
        ctx.fillRect(x + 2, y + TILE - 3, TILE - 4, 3);
        ctx.strokeStyle = "#e0b040";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 3; i++) {
          const yy = top + 4 + ((y + TILE - 3 - top - 4) * i) / 3;
          ctx.moveTo(x + 3, yy);
          ctx.lineTo(x + TILE - 3, yy + 1.5);
        }
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.fillStyle = "#b03a3a";
        ctx.fillRect(x + 1, top, TILE - 2, 4);
        ctx.fillStyle = "#e05a5a";
        ctx.fillRect(x + 1, top, TILE - 2, 2);
      } else if (ch === TILE_GOAL) {
        ctx.fillStyle = "#4a3320";
        ctx.fillRect(x + 6, y - TILE * 2, 2, TILE * 3);
        ctx.fillStyle = "#ffd447";
        ctx.beginPath();
        ctx.arc(x + 7, y - TILE * 2, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#e0453f";
        ctx.beginPath();
        ctx.moveTo(x + 8, y - TILE * 2 + 2);
        for (let i = 0; i <= 6; i++) {
          const fx = x + 8 + i * 3;
          ctx.lineTo(fx, y - TILE * 2 + 2 + Math.sin(time * 6 + i * 0.8) * 1.6);
        }
        for (let i = 6; i >= 0; i--) {
          const fx = x + 8 + i * 3;
          ctx.lineTo(fx, y - TILE * 2 + 12 + Math.sin(time * 6 + i * 0.8) * 1.6);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}

function drawHeart(ctx, x, y, filled) {
  ctx.fillStyle = filled ? "#e0453f" : "rgba(0,0,0,0.35)";
  ctx.fillRect(x + 1, y, 2, 1);
  ctx.fillRect(x + 4, y, 2, 1);
  ctx.fillRect(x, y + 1, 7, 3);
  ctx.fillRect(x + 1, y + 4, 5, 1);
  ctx.fillRect(x + 2, y + 5, 3, 1);
  ctx.fillRect(x + 3, y + 6, 1, 1);
  if (filled) {
    ctx.fillStyle = "#ff8a80";
    ctx.fillRect(x + 1, y + 1, 2, 1);
  }
}

function drawCoinIcon(ctx, x, y) {
  ctx.fillStyle = "#e0a100";
  ctx.beginPath();
  ctx.ellipse(x + 4, y + 4, 4, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffd447";
  ctx.beginPath();
  ctx.ellipse(x + 4, y + 4, 3, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawHUD(ctx, game) {
  const world = game.world;

  ctx.fillStyle = "rgba(8,12,26,0.35)";
  ctx.fillRect(0, 0, VIEW_W, 18);

  for (let i = 0; i < game.maxLives; i++) drawHeart(ctx, 8 + i * 10, 6, i < game.lives);

  drawCoinIcon(ctx, 52, 5);
  drawText(ctx, "x" + String(game.coins).padStart(2, "0"), 63, 5, { size: 10, color: "#ffe37a" });

  drawText(ctx, world.name.toUpperCase(), VIEW_W / 2, 5, { size: 10, align: "center" });
  drawText(ctx, formatTime(world.time), VIEW_W - 8, 5, { size: 10, align: "right", color: "#cfe3ff" });
}

function drawDim(ctx, alpha) {
  ctx.fillStyle = "rgba(6,8,18," + alpha + ")";
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
}

// Centered stack of lines. Each line: { text, size, color, gap }
function drawLines(ctx, lines, startY) {
  let y = startY;
  for (const line of lines) {
    if (!line) { y += 8; continue; }
    drawText(ctx, line.text, VIEW_W / 2, y, {
      size: line.size || 10,
      color: line.color || "#ffffff",
      align: "center",
    });
    y += (line.size || 10) + (line.gap === undefined ? 8 : line.gap);
  }
  return y;
}

// The chunky title logo, drawn from text with an outline pass.
function drawLogo(ctx, cx, cy, time) {
  const bounce = Math.sin(time * 2) * 3;
  ctx.font = 'bold 54px "Courier New", ui-monospace, monospace';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#1b2440";
  ctx.strokeText("CARL 1", cx, cy + bounce);
  const g = ctx.createLinearGradient(0, cy - 26 + bounce, 0, cy + 26 + bounce);
  g.addColorStop(0, "#ffe680");
  g.addColorStop(0.5, "#ffc73d");
  g.addColorStop(1, "#e08a1e");
  ctx.fillStyle = g;
  ctx.fillText("CARL 1", cx, cy + bounce);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
