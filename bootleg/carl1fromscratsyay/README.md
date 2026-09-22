# Carl 1

A small 2D platformer. Carl runs, jumps, stomps, collects coins, and reaches the
flag three times. Plain JavaScript on a `<canvas>` — no build step, no
dependencies, no assets. Every sprite is drawn with rectangles and every sound
is a WebAudio oscillator.

## Running it

Double-click `index.html`. That's it — the scripts are plain classic scripts, so
it works straight off the filesystem.

If you'd rather serve it (handy while editing, since it avoids stale caching):

```sh
npx serve .          # or: python -m http.server
```

## Controls

| Key | Action |
| --- | --- |
| `←` `→` or `A` `D` | Move |
| `Space`, `W` or `↑` | Jump (hold for a higher jump) |
| `P` or `Esc` | Pause |
| `R` | Restart the current level |
| `M` | Mute |

## Rules

- Three lives. Spikes, enemy contact, and bottomless pits each cost one.
- Land on an enemy's head to squash it; touch it any other way and you're done.
- Springs launch Carl about eight tiles up — worth using for the high coins.
- Coins and the timer are per-level, and reset if you die and retry. They're
  banked into your run total only when you reach the flag.
- Score is `coins × 100 + stomps × 50 + a time bonus` per level.

## Layout

```
index.html        script tags, in dependency order
css/style.css     page chrome and the pixel-perfect canvas scaling
src/util.js       constants (512×288 view, 16px tiles) and small helpers
src/audio.js      oscillator-based sound effects
src/input.js      keyboard state: held keys plus per-step press edges
src/levels.js     the three levels, as ASCII maps
src/particles.js  dust, sparkles, confetti
src/camera.js     follow camera with look-ahead and screen shake
src/entities.js   coins, walkers, flyers, moving platforms
src/player.js     Carl: movement tuning, physics, sprite
src/render.js     sky, parallax hills, tiles, HUD, overlays
src/world.js      level parsing, collision, and the rules tying it together
src/main.js       the fixed-timestep loop and the screen state machine
```

## Editing a level

Levels are ASCII art in `src/levels.js`. One character per 16×16 tile:

| Char | Meaning | Char | Meaning |
| --- | --- | --- | --- |
| `.` | empty air | `o` | coin |
| `#` | solid block | `P` | Carl's spawn |
| `=` | one-way platform (jump up through it) | `G` | goal flag |
| `s` | spikes | `e` | walker enemy |
| `^` | spring | `f` | flyer enemy |
| `m` | moving platform, horizontal | `n` | moving platform, vertical |

Rows are padded to the longest row when parsed, so ragged right edges are fine.

Keep the geometry inside Carl's jump arc, which the constants in
`src/player.js` work out to:

- **apex 3.7 tiles**, so platforms should sit at most **3 tiles** above whatever
  you jump from,
- **flat reach 5.7 tiles**, so pits should be no wider than **4 tiles**,
- while climbing, keep the horizontal gap to **3 tiles or less**.

If you change `JUMP_V`, `GRAVITY`, or `MAX_RUN`, those numbers move with them.

To add a level, append another `{ name, rows }` object to `LEVELS`. The game
picks up the count automatically — the last level in the array is the one that
ends the run.

## Notes

- The playfield is a fixed 512×288 and is scaled up by CSS with
  `image-rendering: pixelated`, so it stays crisp at any window size.
- The simulation runs at a fixed 60 steps per second with an accumulator, so
  physics behave the same on a 60Hz and a 144Hz display.
- Sound only starts after your first keypress, because browsers require a user
  gesture before audio can play.
