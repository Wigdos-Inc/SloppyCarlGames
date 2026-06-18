# Startup Guide — CarlNet Engine v1

This guide explains how to create an HTML page, wire up the engine, and get a game running from scratch. It also covers how to skip the splash sequence and the intro cinematic.

---

## What the Engine Is

*Keywords: browser, JavaScript, ES Modules, import, export, web page, dev server, http-server, Live Server, file://*

The CarlNet Engine is a browser-based JavaScript game engine. It runs entirely in a web page. There is no installation step. You point a browser at an HTML file, and the engine boots, shows splash screens, plays an intro cinematic, and hands control to your game code — all in sequence.

The engine is structured as ES Modules (native browser `import`/`export`). This means you need either a local dev server or a browser that allows `file://` module imports (most modern browsers require a server for this). A simple `http-server` or VS Code's Live Server extension is enough.

---

## The Minimal File Structure

*Keywords: folder structure, index.html, main.js, Bootup.js, engine/v1, file layout, directory, GitHub Pages, external, hosted*

The engine is published on GitHub Pages. You do not need to clone or host the engine yourself. Your game only needs two files:

```
your-game/
├── index.html          ← the page the browser loads
└── main.js             ← your game's entry point
```

`main.js` imports `Bootup.js` directly from the published URL. If you are developing with a local copy of the engine, you can also import from a relative path — both are covered in Step 2.

---

## Step 1 — The HTML Page

*Keywords: HTML, script tag, type module, body, head, meta charset, viewport, empty body*

The HTML file does almost nothing. The engine builds all of its own UI dynamically using JavaScript, so the `<body>` can start completely empty. All you need is one `<script>` tag pointing at your entry point:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Game</title>
  </head>
  <body>
    <script type="module" src="./main.js"></script>
  </body>
</html>
```

The `type="module"` attribute is required. Without it the browser treats the script as plain JavaScript and the `import` statements will fail.

---

## Step 2 — The Entry Point (`main.js`)

*Keywords: StartEngine, Bootup.js, ENGINE, globalThis, entry point, browser check, window, localStorage, sessionStorage, requestAnimationFrame, performance, SPLASH_REQUEST, GitHub Pages, external import, hosted URL*

`main.js` is where your game starts. The first thing it must do is import and call `StartEngine` from `Bootup.js`.

**From the published engine (recommended):**

```js
import { StartEngine } from "https://wigdos-inc.github.io/SloppyCarlGames/engine/v1/Bootup.js";

StartEngine();
```

**From a local copy of the engine (if developing or self-hosting):**

```js
import { StartEngine } from "./engine/v1/Bootup.js";

StartEngine();
```

That single call does a lot. It:

1. Checks that the browser supports everything the engine needs (`window`, `document`, `localStorage`, `sessionStorage`, `requestAnimationFrame`, `performance`, etc.). If anything is missing, it logs an error and stops.
2. Initializes all internal engine subsystems.
3. Exposes the complete engine API on `globalThis.ENGINE` so every module in your game can reach it.
4. Shows a full-screen "Click or press any key to start game" overlay.
5. Fires a `SPLASH_REQUEST` event to ask your game what splash screens to show.

Your code runs *after* `StartEngine()` returns. At that point `ENGINE` is available globally.

---

## Step 3 — Providing a Splash Payload

*Keywords: splash, ProvideSplashScreenPayload, SPLASH_REQUEST, outputType, default, preset, custom, sloppycarl, wigdos, carlnet, presetId, sequence*

Before the user clicks anything, the engine asks your game what it wants displayed during the splash sequence. It does this by firing a `SPLASH_REQUEST` window event shortly after startup.

Your game must answer by calling `ENGINE.Startup.ProvideSplashScreenPayload(payload)`.

The simplest payload is `{ outputType: "default" }`, which plays the three built-in splash screens (Sloppy Carl Games → Wigdos Studios Inc → CarlNet Engine) in order.

There are two ways to provide this payload.

### Recommended: provide it proactively

Call it immediately after `StartEngine()`. Bootup opens the acceptance window during initialization, so this is always safe:

```js
import { StartEngine } from "./engine/v1/Bootup.js";

StartEngine();

// Provide the splash payload right away — no need to wait for an event.
ENGINE.Startup.ProvideSplashScreenPayload({ outputType: "default" });
```

### Alternative: listen for the event

If you need to decide which splash screens to show based on runtime state, listen for the `SPLASH_REQUEST` event:

```js
window.addEventListener("SPLASH_REQUEST", () => {
  ENGINE.Startup.ProvideSplashScreenPayload({ outputType: "default" });
});
```

Either approach works. The proactive call is simpler and avoids timing concerns.

### Splash payload options

| `outputType` | What it does |
|---|---|
| `"default"` | Plays all three built-in screens in the standard order |
| `"preset"` | Plays a subset of the built-ins. Pass a `presetId` array with any of: `"sloppycarl"`, `"wigdos"`, `"carlnet"` |
| `"custom"` | Plays a fully custom sequence you define. Pass a `sequence` array of step objects |

Example of a preset (just the engine logo):

```js
ENGINE.Startup.ProvideSplashScreenPayload({
  outputType: "preset",
  presetId: ["carlnet"],
});
```

---

## Step 4 — Handling the Intro Cinematic Request

*Keywords: intro, cinematic, INTRO_CINEMATIC_REQUEST, PlayIntroCinematic, rendered, engine, video, cutscene, Opening.mp4*

Once the splash sequence finishes, the engine fires an `INTRO_CINEMATIC_REQUEST` window event (unless the intro is set to skip — see below). Your game listens for this and tells the engine what video or cinematic to play.

```js
window.addEventListener("INTRO_CINEMATIC_REQUEST", (event) => {
  if (!event.detail || event.detail.cutsceneId !== "Opening") return;

  ENGINE.Startup.PlayIntroCinematic(
    { source: "./cutscene/Opening.mp4" },
    "rendered"  // "rendered" for a video file, "engine" for an engine-driven cutscene
  );
});
```

If you do not call `ENGINE.Startup.PlayIntroCinematic` in response to this event, the engine treats it as "no intro requested" and proceeds directly to your main menu.

---

## Step 5 — Responding to UI_REQUEST (Your Main Menu)

*Keywords: UI_REQUEST, TitleScreen, main menu, title screen, ApplyMenuUI, screenId*

After splash and intro are done, the engine fires a `UI_REQUEST` event with `{ screenId: "TitleScreen" }`. This is your signal that the startup sequence is complete and it is time to show your main menu.

```js
window.addEventListener("UI_REQUEST", (event) => {
  if (event.detail.screenId === "TitleScreen") {
    // Show your title screen / main menu here.
    ENGINE.UI.ApplyMenuUI(myTitleScreenDefinition);
  }
});
```

---

## Putting It Together — A Complete Minimal Example

*Keywords: minimal example, complete example, boilerplate, quickstart, full example*

This is the smallest working `main.js` that boots the engine, shows the default splash, skips the intro cinematic, and logs when the engine is ready:

```js
import { StartEngine } from "https://wigdos-inc.github.io/SloppyCarlGames/engine/v1/Bootup.js";

// 1. Boot the engine. ENGINE becomes globally available after this call.
StartEngine();

// 2. Tell the engine what splash screens to show.
ENGINE.Startup.ProvideSplashScreenPayload({ outputType: "default" });

// 3. When the startup sequence finishes, show your title screen.
window.addEventListener("UI_REQUEST", (event) => {
  if (event.detail.screenId === "TitleScreen") {
    console.log("Engine is ready. Show your main menu here.");
  }
});
```

The HTML for this is exactly what was shown in Step 1.

---

## The Startup Sequence, Step by Step

*Keywords: startup sequence, boot order, module load, user-start overlay, click to start, flow, order of events*

Here is what happens from the moment the browser loads your page to the moment your main menu appears:

1. **Module load** — The browser fetches and evaluates all ES modules, starting from `main.js`. `config.js` reads `localStorage` for any saved settings at this point.
2. **`StartEngine()` called** — Browser environment check runs. Engine subsystems initialize. `ENGINE` is placed on `globalThis`.
3. **User-start overlay appears** — A black full-screen overlay with "Click or press any key to start game" is shown. `SPLASH_REQUEST` fires.
4. **Your game provides a splash payload** — Either proactively (immediately after `StartEngine()`) or in response to `SPLASH_REQUEST`.
5. **User clicks or presses a key** — The overlay clears and the splash sequence begins.
6. **Splash screens play** — Each screen fades in, holds, and fades out. If the splash was already played during this browser session, it is skipped automatically (sessionStorage tracks this).
7. **`INTRO_CINEMATIC_REQUEST` fires** — Your game optionally responds with a video or engine cutscene. If skipped, nothing happens here.
8. **Intro cinematic plays** (if provided).
9. **`UI_REQUEST` fires with `screenId: "TitleScreen"`** — This is your cue to show the main menu.
10. **The startup overlay fades out and is removed.** Your game is in control.

---

## Skipping the Splash Sequence

*Keywords: skip splash, SKIP.Splash, CONFIG.DEBUG.SKIP.Splash, sessionStorage, SplashPlayed, config.js, automatic skip*

The splash sequence skips in two situations:

**Automatically after the first play** — The engine stores a flag in `sessionStorage` the first time splash runs. On every subsequent page reload within the same browser session (tab reuse, F5, etc.), splash is skipped. Opening a fresh tab or closing and reopening the browser plays it again.

**Manually, via config** — Set `ENGINE.Config.DEBUG.SKIP.Splash` to `true` immediately after `StartEngine()` returns. `StartEngine()` is what makes the `ENGINE` API available, and the splash sequence doesn't run until the user clicks — so there is always a window to set this flag before anything plays:

```js
StartEngine();
ENGINE.Config.DEBUG.SKIP.Splash = true;
```

When `Splash` is `true`, `runSplashSequence` logs "Splash screen sequence skipped" and returns immediately. The rest of the startup sequence (intro cinematic, `UI_REQUEST`) still runs normally.

---

## Skipping the Intro Cinematic

*Keywords: skip intro, SKIP.Intro, CONFIG.DEBUG.SKIP.Intro, skipIntro, localStorage, settings, programmatic skip, player toggle, default behavior*

The intro cinematic is controlled by `CONFIG.DEBUG.SKIP.Intro`. When this is `true`, the engine never fires `INTRO_CINEMATIC_REQUEST` and never calls `PlayIntroCinematic`, so no video plays.

**Default behavior** — In the engine's default config, `SKIP.Intro` reads from `localStorage` under a `settings` key: `settings?.skipIntro ?? true`. This means if there is no saved settings object, intro is *skipped by default*. If the user has a `settings` object in localStorage (e.g. from a settings menu), `skipIntro` in that object controls it.

**Programmatically** — You can set it directly after engine initialization:

```js
StartEngine();

// Skip the intro for this session.
ENGINE.Config.DEBUG.SKIP.Intro = true;
```

Because `runStartupSequence` reads `CONFIG.DEBUG.SKIP.Intro` at the moment the user clicks to start, setting this flag any time before that click takes effect.

**Via the settings menu pattern** — The testGame settings menu exposes a toggle that writes `skipIntro` to localStorage. On the next page load, `config.js` picks it up and sets `SKIP.Intro` accordingly. This is how a player-facing "skip intro" toggle would work.

---

## Summary of Key Engine Events

*Keywords: events, SPLASH_REQUEST, INTRO_CINEMATIC_REQUEST, UI_REQUEST, LEVEL_REQUEST, USER_INPUT, event table, window events*

| Event | Direction | When it fires | Your game does |
|---|---|---|---|
| `SPLASH_REQUEST` | Engine → Game | Just after user-start overlay appears | Call `ENGINE.Startup.ProvideSplashScreenPayload(payload)` |
| `INTRO_CINEMATIC_REQUEST` | Engine → Game | After splash ends (if intro not skipped) | Call `ENGINE.Startup.PlayIntroCinematic(payload, type)` |
| `UI_REQUEST` | Engine → Game | After splash + intro are done | Show your title screen / main menu |
| `LEVEL_REQUEST` | Game → Game | When the player starts a level | Your code loads and creates the level |
| `USER_INPUT` | Engine → Game | On keyboard/pointer events | Forward input to the player or UI |

---

## Browser Requirements

*Keywords: browser support, ES Modules, WebGL, localStorage, sessionStorage, requestAnimationFrame, performance, HTTP, file://, server, static file server*

The engine requires a modern browser with support for:

- ES Modules (`import`/`export`)
- `window`, `document`, `localStorage`, `sessionStorage`
- `requestAnimationFrame`
- `performance`
- WebGL (for rendering)

Serving over HTTP (not `file://`) is required for ES Module imports to work correctly in most browsers. Any static file server works.
