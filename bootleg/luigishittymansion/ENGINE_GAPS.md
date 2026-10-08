# CNE Engine Gaps — Field Notes from Building "Luigi's Shitty Mansion"

Written while building a third-person ghost-vacuuming game on CNE v0.34.3 from outside the engine
(no engine source access — docs, testGame, SAGE Q&A, and runtime inspection only).

**Severity:** **[BLOCKER]** forced a workaround or would stop most devs · **[FRICTION]** cost real time ·
**[PAPERCUT]** minor. **Evidence:** ✅ reproduced at runtime · 📖 from SAGE reading source, not run by me.

---

## Top 10 (if you only read this)

1. **Decals on cubes never render** (engine bug, ✅). Flat decal quads are wound into their host and
   `BackfaceCulling` is on by default. Fix location in §5.
2. **No entity API** (✅). Moving, tinting, hiding or despawning anything that isn't the player means
   mutating `GetActiveLevel()` internals. No runtime spawn either. (§8)
3. **No in-level HUD path** (✅). `ApplyMenuUI` mid-level kills mouse look; HUDs must be applied
   *before* `CreateLevel` and every later element pre-built and hidden. (§4)
4. **No game-developer API reference** (✅). The real API was found by dumping `ENGINE` in a console. (§1)
5. **No per-frame hook / `IsPaused()`** (✅). Every game reimplements its own rAF loop and pause tracking. (§8)
6. **Player health / damage / respawn aren't game-controllable**, and engine combat soft-locks the
   player after one hit (📖). (§2)
7. **Left mouse never reaches the game in a level** (✅): the camera swallows `pointerdown`. (§3)
8. **Initial camera yaw and spawn facing can't be set** (✅) — I rotated the whole level 180°. (§7)
9. **No lighting, and fog is welded to SimDistance** (✅). (§5)
10. **Dead or misleading surface area** (✅/📖): `Input.boost`, `movement.chase/aggroRange/attacks`,
    `camera.sensitivity`, level `music`, non-camera trigger types all validate and do nothing.

## Where I predict a human will get stuck

- **Their first decal.** It won't show, nothing logs, and nobody would guess "backface culling".
- **"Why doesn't my mouse look work?"** right after adding a HUD the obvious way.
- **Positions.** Bottom-center anchoring, surface-relative entity placement, side-dependent decal axes,
  non-centered pyramids — four different coordinate conventions, none documented in one place.
- **"How do I make the enemy do anything?"** The blueprint has `chase`, `aggroRange`, `attacks` — they
  look like the answer and are inert.
- **Vector APIs.** `.set(x, y, z)` silently writes `undefined`; `facing` and `scale` aren't even
  `UnitVector3`. Expect NaN hunts.
- **Live Server + the engine.** Every file save reloads the page and dumps you back at "click to start";
  there's no "resume where I was" dev affordance (`?play`-style deep links are game-side).

---

## 1. Documentation & Discoverability

- **[FRICTION] No game-developer API reference.** `StartupGuide.md` ends at "show your title screen".
  Everything after that (levels, entities, HUD, audio, events) lives in `system_map/*.md`, which are
  ~130 KB of *engine-internal* notes (shader passes, void carving, decal UV math). A game dev needs a
  one-page `ENGINE.*` reference: every function, its arguments, return value, and the events it fires.
- **[FRICTION] Coordinate anchoring is undocumented.** A terrain/obstacle `position` is **bottom-center**
  (Y is the base, X/Z the center), while the runtime `transform.position` is the true center. Found by
  loading testGame and comparing `worldAabb` against the payload. ✅
- **[PAPERCUT] StartupGuide uses the wrong config casing.** It says `ENGINE.Config.DEBUG.SKIP.Splash`;
  the real key is `ENGINE.Config.Debug.Skip.Splash` (the guide's path throws). ✅
- **[PAPERCUT] Config accepts typos silently.** testGame writes `Config.Debug.ALL` while the engine reads
  `Config.Debug.All`; the live config carries both and testGame's "debug mode" toggle does nothing. ✅
  A sealed config or `SetConfig(path, value)` that warns on unknown keys would catch this.
- **[PAPERCUT] `Debug.All` is three things at once**: master log gate, debug-overlay gate, and a `KeyR`
  "kill & respawn" hotkey. Shipping with logs on ships a suicide key; turning it off silences errors. 📖
- **[PAPERCUT] testGame has no in-level HUD example** (`ui.json` → `levelUI.game` is `{}`). ✅
- **[PAPERCUT] Console introspection of `ENGINE` is noisy.** `ENGINE.Input.Router.target` holds
  `window`, so any recursive dump of `ENGINE` explodes into the whole DOM. ✅

## 2. Payload Authoring

- **[FRICTION] No game-defined templates.** `shape: "template"` only resolves against engine-owned JSON
  (`obstacles.json`, `enemies.json` are empty). A chair used 20 times is 20 copies of its parts or
  game-side expansion code — I wrote a `Prop()` helper. A `payload.templates` block would fix this.
- **[FRICTION] Pyramids (and planes/tori) aren't centered**, but the bottom-center lift and the entity
  anchor math assume they are: a pyramid at `y=0` floats half its height, a pyramid hat anchored
  `bottom` on a head floats above it. I swapped to cones and hand-offset the rest. ✅
- **[FRICTION] No supported non-colliding decor.** `collisionShape: "none"` passes validation but
  physics dereferences the null bounds. 📖 I never used it.
- **[FRICTION] Multi-part terrain rotation doesn't rotate part positions** (root rotation is summed into
  each part's Euler; parts spin in place), so a rotated multi-part chair falls apart. 📖
- **[PAPERCUT] `meta.levelId` / `meta.stageId` are required.** A single-level game fails validation
  until it invents both. ✅
- **[PAPERCUT] `UnitVector3.set()` takes an object; positional args silently write `undefined`.** ✅
- **[PAPERCUT] Inconsistent vector types on one object.** `transform.position`/`velocity` are
  `UnitVector3`, `transform.scale` and `facing` are plain objects. `player.facing.set(...)` threw 700
  times a second before I noticed. ✅
- **[PAPERCUT] Placement `rootTransform`/`movement` replace the blueprint's wholesale** (omitted
  rotation/scale reset; omitting `physics` re-enables collision). 📖
- **[PAPERCUT] `world.textureScale` is pixels-per-CNU for noise bakes.** At the testGame value (2) a
  16 m wall bakes to ~32 px and every noise surface is a blur; ~12 looks right. ✅

## 3. Player Character

- **[FRICTION] Custom player models exist but are hidden.** `level.player.modelParts` replaces the model
  (worked great ✅), but appears in no doc or example. `player.character` must still name an engine
  preset because that's where physics flags and collider live; tuning goes through an undocumented
  `metaOverrides` bag (with a `jumpHeight` that must be `{ value }`, 📖).
- **[FRICTION] `Input.boost` is a dead flag** — on the public Input object, bound to Shift in testGame,
  read by nothing. The working path is writing internal `GetState().boost`, which I use for sprint
  and the vacuum slowdown. ✅
- **[FRICTION] Input magnitude is ignored** (`forward: 0.5` = full speed), so slowdowns can't be
  expressed through input. 📖
- **[FRICTION] No player health model.** `GetState().hp` is a stale `3` read by nothing; engine combat
  is ring rules (drop collectibles, die at 0). Hearts, HP and i-frames are all game-side. ✅/📖
- **[BLOCKER] Engine combat soft-locks the player after one hit.** An enemy hit sets `Stunned` +
  `invulnerable.active` and nothing clears them until respawn. 📖 I left combat off.
- **[FRICTION] No game-facing damage/kill/respawn.** `TriggerPlayerDeath`/respawn aren't on `ENGINE`. 📖
- **[FRICTION] No way to force a player animation** (e.g. a "vacuuming" pose); action is recomputed
  from physics every tick. 📖

## 4. Input

- **[FRICTION] `Player.Input` only has `forward`, `right`, `jump`, `boost`.** Every game verb (vacuum,
  interact, attack) is wired by hand from raw events. ✅
- **[FRICTION] Even WASD is the game's job** — every game repeats testGame's keydown/keyup mapper. ✅
- **[FRICTION] Left mouse never reaches the game in a level.** The camera consumes `pointerdown` and
  doesn't forward it as `USER_INPUT`, so "hold click to fire" needs native `window` listeners. ✅
- **[PAPERCUT] With `Debug.All` on (the default), `R` is silently eaten** as debug respawn. 📖

## 5. UI / HUD

- **[BLOCKER-ish] No in-level HUD path.** `ApplyMenuUI` switches global input routing to UI mode;
  mid-level it kills mouse look, wheel zoom and arrow look until pause/resume. The only safe pattern
  is "apply the HUD before `CreateLevel`", so every later element (boss bar, dialog) must be pre-built
  and hidden. Suggested: an `overlay: true` payload flag that renders without touching routing. 📖 (avoided)
- **[FRICTION] No API to update a UI element.** Live values need `document.getElementById(...)`. A
  `UI.SetText(id, text)` / `UI.SetStyle(id, styles)` pair would cover most HUDs. ✅
- **[FRICTION] Clickable elements can't have children** — actions resolve by `event.target.id` with no
  bubbling, so a button with an icon + label stops working when the click lands on the child. 📖
- **[PAPERCUT] Array actions stop at the first success** ("play sound AND change screen" impossible). 📖
- **[PAPERCUT] `ClearUI(rootId)` wipes the global click map by default.** 📖
- **[PAPERCUT] The UI image preloader can't decode SVG data URIs** and warns on every apply, though the
  `<img>` renders fine. ✅
- **[PAPERCUT] Default `engine-ui-root` has no position/z-index.** 📖

## 6. Rendering

- **[BLOCKER — engine bug] Decals on any flat host face are invisible by default.** Every shape/image
  decal on a cube (terrain, obstacle, entity or player part) is culled: the flat decal quad is wound
  opposite to its host face and `Performance.BackfaceCulling` defaults to `true`. ✅ Repro: four cubes
  with a circle decal on the camera-facing side → nothing; `BackfaceCulling = false` → all four appear,
  and so does `chara_prop`'s own chest decal. Per SAGE the fix is in `Render.js`: `flatDecalOrder`
  → `[0, 2, 1, 1, 2, 3]`, or skip culling for flat-shape decal draws (also `drawScatterDecalPass`).
  Workaround here: culling off globally (no measurable FPS cost at ~400 meshes).
- **[FRICTION] Decal position axes depend on `side`.** `front`/`back` offset along x, `left`/`right` along
  z, `top`/`bottom` along x/z with flipped "up". ✅ One engine helper mapping (h, v) per side would help.
- **[FRICTION] No lighting model.** Surfaces are flat `texture × tint`. A haunted mansion lives on light
  (flashlight cones, candle pools, lightning). The only shading is the Comic filter's fixed-direction
  banding — which, to be fair, is what makes the ghosts look right (§11). ✅
- **[FRICTION] Fog is tied to SimDistance.** In a 15 m room fog is invisible unless you also shrink
  SimDistance, which shrinks physics/activity range too. A `Rendering.Fog.Distance` would decouple them. 📖
- **[PAPERCUT] No game-facing color grading / tint** (the underwater `colorShift` isn't exposed). 📖

## 7. Audio

- **[FRICTION] Level payload `music` is validated, normalized… and never played.** 📖
- **[FRICTION] Looping SFX are fragile**: no handle, stop-by-exact-src, and a cleanup bug that can orphan
  a loop when another SFX ends. 📖 The vacuum hum runs outside the engine.
- **[PAPERCUT] Music `loop` defaults to `false`; `PlayMusic` no-ops if the name matches the current
  track even with a different `src`.** 📖
- **[PAPERCUT] testGame spells UI music `source` and level music `src`** (both accepted via alias). ✅
- **[FRICTION] No way to chain music (intro → loop).** `PlayMusic` returns nothing, fires no "ended" event,
  has no queue/`next` option, and exposes no position or duration. The intro → loop handoff here is a
  game-side countdown of the intro's length (read from file metadata with a plain `Audio`), held while the
  level is paused. It works ✅ but can drift by the engine's start latency. The alternative,
  `await PlayAudio(intro)`, puts the intro on the SFX volume and outside `PauseMusic`. 📖
  A `PlayMusic` promise, a `MUSIC_ENDED` event, or `{ next: { src, loop } }` would each fix it.

## 7b. Splash

- **[FRICTION] Custom splash sequences can't include built-in presets.** "CarlNet splash, then mine" means
  copying the CarlNet step by hand and pointing at the engine's own asset files
  (`engine/v1/assets/engine/carlNetEngine.png/.mp3`) — not an API, so it breaks if that layout moves. ✅
  A step like `{ preset: "carlnet" }` inside a custom sequence would solve it.
- **[FRICTION] Splash images can't be sized.** They render at natural size, capped at 60vw/60vh, centered
  on black. A 676 px logo with transparent margins showed at ~310 px; I crop and upscale it to a data URL
  at boot. A per-step `size`/`fit` field (and a background color) would avoid that. ✅
- **[PAPERCUT] Step audio isn't tied to the step.** `sfx` starts at step start but plays to completion, so
  a 14 s jingle on a 4 s step bleeds into the title music; step length must be hand-matched to the clip.
  There's also no per-step event to hook. ✅📖
- **[PAPERCUT] Any validation error silently swaps in the full default sequence**, logged only when
  `Debug.All` is on — a typo in `holdMs` looks like "my splash was ignored". Steps are also keyed by `name`,
  so two unnamed steps overwrite each other. 📖

## 8. Entities & Game Logic (the big one)

- **[BLOCKER] No entity API.** Moving an NPC, despawning a captured ghost or fading a part means mutating
  engine internals (`transform.position.set`, `mesh.displayColor`, `entities.splice`). It works ✅ but has
  no contract. Minimum surface: `Entities.Get(id)`, `SetTransform`, `SetVelocity`,
  `SetTint(id, partId?, rgba)`, `Despawn(id)`, `Spawn(blueprintId, transform)`.
- **[BLOCKER] No runtime spawning.** `SpawnIntoScene` exists internally (the Simulator uses it) but isn't
  exposed; everything is pre-placed and pooled. I splice the boss out at start and push it back later. ✅
- **[FRICTION] No per-frame hook / no `IsPaused()`.** Every game runs its own rAF loop, delta clamp and
  pause flag, one frame out of phase with the sim. ✅
- **[FRICTION] Enemy "AI" fields are dead.** `chase`, `jump`, `jumpOnSight`, `disappear`, `aggroRange`,
  `attacks[]` validate and do nothing (`attacks` normalizes to `undefined`s). 📖
- **[FRICTION] Only the player animates** — blueprint `animations` play only in the Simulator. 📖
- **[FRICTION] Every entity is solid to the player, no opt-out.** Ghosts should be intangible but
  harmful, and pickups/props in motion will shove the player. 📖
- **[FRICTION] Only camera triggers do anything.** `custom`/`dialogue`/`cutscene` fire no events. 📖
- **[PAPERCUT] Entity `customEvents` must live on the blueprint** and are double-gated by
  `Config.CustomEvents.*` (all `false`). 📖
- **[PAPERCUT] `movement.speed > 0` silently fights game-written positions.** 📖
- **[PAPERCUT] `ClearLevel` leaves `Player.Input` flags and pointer lock as-is.** 📖

## 9. Camera

- **[FRICTION] No camera-direction API.** Aim-where-you-look needs camera forward; the only route is
  `GetActiveLevel().cameraConfig.state.forward`. ✅
- **[FRICTION] Initial camera yaw and spawn facing can't be set.** orbitCam opens on the player's +Z side
  and the player spawns facing +Z, so I rotated the whole level 180° at the payload boundary. ✅
- **[PAPERCUT] `camera.sensitivity` and `levelOpening.endPosition` have no consumer.** 📖
- **[PAPERCUT] Mouse sensitivity is latched at level start.** 📖
- **[PAPERCUT] No invert-Y option.** ✅

## 10. Pause

- **[PAPERCUT] Pause doesn't pause audio** (music must be paused by hand; SFX can't be). 📖
- **[PAPERCUT] `PauseLevel()` fires the same `LEVEL_PAUSED` as the player pressing Esc**, so freezing for
  a game-over screen needs a game-side "I paused it" flag. 📖

## 11. Simulator

- **[PAPERCUT] Framing never zooms in** — floored at the template defaults, so a 0.8 m ghost is a speck
  on a huge disc. ✅
- **[PAPERCUT] No caption/overlay hook** — a label needs raw DOM, since `ApplyMenuUI` would steal input
  routing from the Simulator camera. ✅

## 12. What worked well

- **The Simulator.** `Cache` + `Start` + `Load` + `Exit` just worked; it plays player animation sets and
  became the in-game "Ghost Gallery" in ~60 lines.
- **`player.modelParts` + `animations`.** A fully custom 27-part robot with walk/idle/jump sets, through
  the engine's own animation channel, with no engine changes.
- **Particles.** `SpawnParticles` bursts with velocity/color overrides carry the vacuum stream, ghost
  spawns and captures; level-authored generators run the fireplace, candles and stove.
- **ToonLines + Comic filters.** One flag each, live-toggleable, and together they get very close to the
  reference art: faceted, banded ghosts with ink outlines.
- **Collectibles.** Hearts are plain `collectible` entities; pickup and `COLLECTIBLE_PICKED_UP` are free.
- **Pause/resume and UI events.** The `LEVEL_PAUSED` → overlay → `ResumeLevel()` loop is clean once known.
- **Performance.** ~400 terrain meshes, ~70 entities, two filters: steady display-rate FPS.
