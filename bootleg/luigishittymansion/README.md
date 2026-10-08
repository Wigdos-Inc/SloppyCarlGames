# Luigi's Shitty Mansion — Chapter 1: Clean the Mess.

A third-person ghost-vacuuming game built on CarlNet Engine v0.34.3 (`engine/v1`), from outside the engine.

**Run:** serve the repo root (Live Server on :5500) and open `bootleg/luigishittymansion/index.html`.

| URL flag | Effect |
|---|---|
| `?dev` | Skips the splash, keeps engine logging/debug on, exposes `window.LSM` (live run state). |
| `?dev&play` | Same, and jumps straight into Chapter 1 after the click-to-start overlay. |

Without `?dev` the splash plays (CarlNet Engine, then Super Shitty Studios with its jingle). The engine
only plays it once per browser tab; to see it again, open a new tab or run
`sessionStorage.removeItem("ENGINE_SPLASH_PLAYED")` and reload.

## Controls
WASD move · Mouse look (click to lock) · hold **Left Click** or **J** to vacuum · Space jump · Shift sprint · Esc / P pause.

## Goal
Capture all 11 ghosts across six rooms, then the boss (The Landlord) appears in the Dining Hall.
Vacuum trash for points and grab hearts to heal. Ghosts only hurt you with a telegraphed dash (they flash red first).

## Files
| File | What it does |
|---|---|
| `main.js` | Boot and event wiring. |
| `src/splash.js` | Custom splash sequence (CarlNet step + studio step). |
| `src/game.js` | Chapter flow, rAF loop, vacuum, ghost AI, trash, health, boss, win/lose. |
| `src/level.js` | Assembles the level payload (layout is authored front-door-at-z0, then rotated 180°). |
| `src/mansion.js` | Rooms, walls, doorways, windows, decals. |
| `src/furniture.js` | Furniture props built from primitives. |
| `src/robot.js` | Player model (`player.modelParts`) + animation sets. |
| `src/blueprints.js` | Ghost species, trash piles, heart pickup. |
| `src/hud.js`, `src/menus.js` | HUD and all menu screens (ENGINE.UI payloads). |
| `src/gallery.js` | Ghost Gallery (engine Simulator). |
| `src/assets.js`, `src/synth.js` | Optional audio/image files with synthesized fallbacks. |
| `src/world.js` | The only module that touches the live scene graph. |
| `ASSETS.md` | Assets you can drop in to replace placeholders. |
| `ENGINE_GAPS.md` | What the engine is missing, found while building this. |
