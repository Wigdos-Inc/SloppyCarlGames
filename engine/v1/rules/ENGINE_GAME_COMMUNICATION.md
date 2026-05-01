# Engine–Game Communication Rules

These rules define how the engine and games communicate. All communication between the engine and games must follow these patterns without exception.

---

## 1. Engine → Game: Custom Events

When the engine needs to notify a game of something, it dispatches a **Custom Event** via the browser's event system.

- Events are dispatched using `SendEvent(eventName, payload)` from `core/meta.js`.
- Events are fired on `window` as `CustomEvent` instances with a `detail` property.
- Games listen for these events using `window.addEventListener(eventName, handler)`.

```js
// Engine side (inside engine code)
SendEvent("LEVEL_READY", { levelId: "level-1", title: "Green Hills" });

// Game side (inside game code)
window.addEventListener("LEVEL_READY", (event) => {
    const { levelId, title } = event.detail.payload;
});
```

### Rules

- The engine must never call game functions directly.
- The engine must never import game modules.
- The engine must never assume any game-side listener exists — events are fire-and-forget.
- Event names must be strings.

---

## 2. Game → Engine: Function Calls

When a game needs to command or query the engine, it calls functions on the **ENGINE API object** returned by `initialize()` in `core/ini.js`.

- The API is a plain object with categorized methods.
- Games receive it from the engine's initialization function and call methods directly.

```js
// Game side
const ENGINE = await initialize();

ENGINE.Level.CreateLevel(levelPayload);
ENGINE.Audio.PlayMusic("theme.mp3");
ENGINE.UI.ApplyMenuUI(menuPayload);
const playerState = ENGINE.Player.GetState();
```

### Rules

- Games must never import engine modules directly.
- Games must only use the API surface exposed by `ini.js`.
- The API object is the single point of contact from game to engine.
- If a game needs functionality not on the API, it must be added to the API — not accessed through a back-channel import.

---

## 3. Game → Game: No Rules

Communication between game modules is entirely at the game developer's discretion.

- The engine imposes no structure on how games organize their own internal communication.
- Games may use imports, events, global state, or any other pattern they choose.

---

## 4. Engine → Engine: Direct Import/Export

Communication between engine modules uses standard JavaScript `import`/`export`.

- Engine modules import from each other directly.
- No event-based communication between engine modules (events are reserved for engine-to-game).
- No global state sharing via `window` between engine modules (except for debugging).
- Follow the module group hierarchy defined in `rules/MODULE_GROUPS.md`.

```js
// Engine internal communication
import { BuildLevel } from "../../builder/NewLevel.js";
import { ValidateLevelPayload } from "../../core/validate.js";
import { Unit, UnitVector3 } from "../../math/Utilities.js";
```

---

## Summary

| Direction        | Mechanism             | Entry Point         |
|------------------|-----------------------|---------------------|
| Engine → Game    | Custom Events         | `meta.js:SendEvent` |
| Game → Engine    | API function calls    | `ini.js:initialize` |
| Game → Game      | Developer's choice    | N/A                 |
| Engine → Engine  | `import` / `export`   | Direct module paths |
