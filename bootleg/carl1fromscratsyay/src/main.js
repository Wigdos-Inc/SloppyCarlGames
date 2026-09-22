// Boot, the fixed-timestep loop, and the screen-to-screen state machine.

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

const input = new Input(window);
const NULL_INPUT = { down: () => false, pressed: () => false };

const STEP = 1 / 60;
const MAX_LIVES = 3;

const Game = {
  state: "title",       // title | play | paused | levelDone | gameOver | victory
  levelIndex: 0,
  lives: MAX_LIVES,
  maxLives: MAX_LIVES,
  bankedCoins: 0,
  bankedStomps: 0,
  bankedTime: 0,
  world: null,
  blink: 0,
  muteFlash: 0,
  lastLevel: null,

  get coins() {
    return this.bankedCoins + (this.world ? this.world.coinsCollected : 0);
  },

  buildWorld(index, playerInput) {
    const world = new World(LEVELS[index], playerInput);
    return world;
  },

  showTitle() {
    this.state = "title";
    this.levelIndex = 0;
    this.world = this.buildWorld(0, NULL_INPUT);
    this.world.invincible = true;
  },

  startRun() {
    this.lives = MAX_LIVES;
    this.bankedCoins = 0;
    this.bankedStomps = 0;
    this.bankedTime = 0;
    this.levelIndex = 0;
    this.startLevel(0);
  },

  startLevel(index) {
    this.levelIndex = index;
    this.world = this.buildWorld(index, input);
    this.state = "play";
  },

  retryLevel() {
    this.startLevel(this.levelIndex);
  },

  // Roll the finished level's takings into the run total.
  bankLevel() {
    const w = this.world;
    this.lastLevel = {
      name: w.name,
      coins: w.coinsCollected,
      coinTotal: w.coinTotal,
      stomps: w.stomps,
      time: w.time,
      score: levelScore(w),
    };
    this.bankedCoins += w.coinsCollected;
    this.bankedStomps += w.stomps;
    this.bankedTime += w.time;
  },

  get totalScore() {
    return this.bankedCoins * 100 + this.bankedStomps * 50;
  },
};

function levelScore(w) {
  const timeBonus = Math.max(0, Math.round(120 - w.time) * 5);
  return w.coinsCollected * 100 + w.stomps * 50 + timeBonus;
}

// ------------------------------------------------------------------ update
function step(dt) {
  Game.blink += dt;
  Game.muteFlash = Math.max(0, Game.muteFlash - dt);

  if (input.pressed("mute")) {
    Sfx.toggleMute();
    Game.muteFlash = 1.2;
  }

  switch (Game.state) {
    case "title":
      Game.world.update(dt);
      if (input.pressed("jump") || input.pressed("confirm")) {
        Sfx.select();
        Game.startRun();
      }
      break;

    case "play":
      if (input.pressed("pause")) {
        Game.state = "paused";
        Sfx.select();
        break;
      }
      if (input.pressed("restart")) {
        Game.retryLevel();
        break;
      }
      Game.world.update(dt);

      if (Game.world.dead && Game.world.deathTimer > 1.1) {
        Game.lives--;
        if (Game.lives <= 0) {
          Game.state = "gameOver";
          Sfx.gameOver();
        } else {
          Game.retryLevel();
        }
      } else if (Game.world.finished && Game.world.finishTimer > 1.0) {
        Game.bankLevel();
        if (Game.levelIndex + 1 >= LEVELS.length) {
          Game.state = "victory";
          Sfx.victory();
        } else {
          Game.state = "levelDone";
        }
      }
      break;

    case "paused":
      if (input.pressed("pause") || input.pressed("confirm")) {
        Game.state = "play";
        Sfx.select();
      } else if (input.pressed("restart")) {
        Game.retryLevel();
      }
      break;

    case "levelDone":
      if (input.pressed("jump") || input.pressed("confirm")) {
        Sfx.select();
        Game.startLevel(Game.levelIndex + 1);
      }
      break;

    case "gameOver":
    case "victory":
      if (input.pressed("jump") || input.pressed("confirm")) {
        Sfx.select();
        Game.showTitle();
      }
      break;
  }
}

// -------------------------------------------------------------------- draw
function draw() {
  const blinkOn = Math.sin(Game.blink * 5) > -0.3;

  if (Game.world) Game.world.draw(ctx);

  if (Game.state === "play" || Game.state === "paused") drawHUD(ctx, Game);

  if (Game.state === "title") {
    drawDim(ctx, 0.45);
    drawLogo(ctx, VIEW_W / 2, 92, Game.blink);
    drawText(ctx, "a small jumping man, three small problems", VIEW_W / 2, 128, {
      size: 10, align: "center", color: "#bcd4f5",
    });
    if (blinkOn) {
      drawText(ctx, "PRESS SPACE TO START", VIEW_W / 2, 176, {
        size: 14, align: "center", color: "#ffd447",
      });
    }
    drawLines(ctx, [
      { text: "ARROWS / A D  move     SPACE / W  jump", size: 9, color: "#9fb6d6" },
      { text: "P  pause      R  restart level      M  mute", size: 9, color: "#9fb6d6" },
    ], 222);
  }

  if (Game.state === "paused") {
    drawDim(ctx, 0.55);
    drawText(ctx, "PAUSED", VIEW_W / 2, 108, { size: 24, align: "center", color: "#ffd447" });
    drawLines(ctx, [
      { text: "P or ENTER to resume", size: 10, color: "#dbe6f7" },
      { text: "R to restart this level", size: 10, color: "#9fb6d6" },
    ], 150);
  }

  if (Game.state === "levelDone") {
    const r = Game.lastLevel;
    drawDim(ctx, 0.6);
    drawText(ctx, "LEVEL CLEAR", VIEW_W / 2, 52, { size: 22, align: "center", color: "#ffd447" });
    drawText(ctx, r.name.toUpperCase(), VIEW_W / 2, 82, { size: 11, align: "center", color: "#bcd4f5" });
    drawLines(ctx, [
      { text: "COINS   " + r.coins + " / " + r.coinTotal, size: 12 },
      { text: "STOMPS  " + r.stomps, size: 12 },
      { text: "TIME    " + formatTime(r.time), size: 12 },
      null,
      { text: "LEVEL SCORE  " + r.score, size: 13, color: "#8ef08e" },
    ], 112);
    if (blinkOn) {
      drawText(ctx, "SPACE for " + LEVELS[Game.levelIndex + 1].name.toUpperCase(), VIEW_W / 2, 238, {
        size: 11, align: "center", color: "#ffd447",
      });
    }
  }

  if (Game.state === "gameOver") {
    drawDim(ctx, 0.68);
    drawText(ctx, "GAME OVER", VIEW_W / 2, 84, { size: 28, align: "center", color: "#e0453f" });
    drawLines(ctx, [
      { text: "Carl has run out of hats.", size: 11, color: "#dbe6f7" },
      { text: "Coins collected: " + Game.coins, size: 11, color: "#ffe37a" },
    ], 132);
    if (blinkOn) {
      drawText(ctx, "PRESS SPACE", VIEW_W / 2, 196, { size: 13, align: "center", color: "#ffd447" });
    }
  }

  if (Game.state === "victory") {
    drawDim(ctx, 0.62);
    drawText(ctx, "CARL DID IT", VIEW_W / 2, 46, { size: 28, align: "center", color: "#ffd447" });
    drawLines(ctx, [
      { text: "All three levels cleared.", size: 11, color: "#dbe6f7" },
      null,
      { text: "COINS       " + Game.bankedCoins, size: 12 },
      { text: "STOMPS      " + Game.bankedStomps, size: 12 },
      { text: "TOTAL TIME  " + formatTime(Game.bankedTime), size: 12 },
      { text: "LIVES LEFT  " + Game.lives, size: 12 },
      null,
      { text: "FINAL SCORE  " + Game.totalScore, size: 14, color: "#8ef08e" },
    ], 92);
    if (blinkOn) {
      drawText(ctx, "PRESS SPACE FOR THE TITLE SCREEN", VIEW_W / 2, 252, {
        size: 10, align: "center", color: "#ffd447",
      });
    }
  }

  if (Game.muteFlash > 0) {
    drawText(ctx, Sfx.muted ? "SOUND OFF" : "SOUND ON", VIEW_W / 2, VIEW_H - 22, {
      size: 10, align: "center", color: "#ffffff",
    });
  }
}

// -------------------------------------------------------------------- loop
let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  const elapsed = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  accumulator += elapsed;

  let steps = 0;
  while (accumulator >= STEP && steps < 5) {
    step(STEP);
    accumulator -= STEP;
    steps++;
    // Key edges are consumed by the first step of the frame only.
    if (steps === 1) input.endStep();
  }

  draw();
  requestAnimationFrame(frame);
}

// Audio can only start from a user gesture.
function unlockAudio() {
  Sfx.init();
  Sfx.resume();
}
window.addEventListener("keydown", unlockAudio, { once: true });
window.addEventListener("pointerdown", unlockAudio, { once: true });

// Clicking the canvas focuses the page so the keyboard reaches the game.
canvas.addEventListener("pointerdown", () => window.focus());

Game.showTitle();
requestAnimationFrame(frame);
