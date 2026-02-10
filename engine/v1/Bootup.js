// Boot sequence entry point.
// Purpose: initialize ENGINE via core/ini.js, show the user-start overlay, then run splash
// and signal the game to load its startup UI. This file owns startup timing only.
// Limits: no gameplay logic, no UI element construction details, no asset loading beyond splash.
// Pipeline: initialize() -> CreateUI() overlay -> Controls input -> RunSplashSequence().


/* === IMPORTS === */
// Core initialization and logging.

import { initialize } from "./core/ini.js";
import { Cursor, Log, sendEvent, Wait } from "./core/meta.js";
import { FadeElement, RemoveRoot, SetElementStyle, SetElementText } from "./handlers/Render.js";
import { CreateUI } from "./handlers/UI.js";
import { PlayIntroCinematic } from "./handlers/Cutscene.js";
import { RunSplashSequence } from "./core/splash.js";

/* === GLOBALS === */
// Single global entry point for the game.

const root = typeof globalThis !== "undefined" ? globalThis : window;
const ENGINE = root.ENGINE || {};
root.ENGINE = ENGINE;

/* === STARTUP === */
// Runs the boot sequence and exposes the public API.

let introHandled = false;
let introResolve = null;
let introCalledResolve = null;
let introDoneResolve = null;

function waitForUserStart() {
  const startupTextId = "engine-startup-text";
  const controls = ENGINE.Controls ? new ENGINE.Controls() : null;
  let started = false;

  const startupOverlayStyles = {
    position: "fixed",
    inset: "0",
    background: "black",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "24px",
    zIndex: "9999",
    opacity: "1",
  };

  const startupTextStyles = {
    color: "white",
    fontFamily: "Arial, sans-serif",
    fontSize: "20px",
    textAlign: "center",
  };

  const startupImageStyles = {
    maxWidth: "60vw",
    maxHeight: "60vh",
    opacity: "0",
  };

  CreateUI({
    rootId: "engine-startup-overlay",
    rootStyles: startupOverlayStyles,
    elements: [
      {
        type: "img",
        id: "engine-splash-image",
        styles: startupImageStyles,
      },
      {
        type: "div",
        id: startupTextId,
        text: "Click or press any key to start game",
        styles: startupTextStyles,
      },
    ],
  });

  const onStart = () => {
    if (started) {
      return;
    }
    started = true;
    if (controls) {
      controls.clear();
    } else {
      window.removeEventListener("keydown", onStart);
      window.removeEventListener("pointerdown", onStart);
    }
    SetElementText(startupTextId, "");
    SetElementStyle(startupTextId, { display: "none" });
    void runStartupSequence();
  };

  if (controls) {
    controls.on("keydown", onStart);
    controls.on("pointerdown", onStart);
  } else {
    window.addEventListener("keydown", onStart, { once: true });
    window.addEventListener("pointerdown", onStart, { once: true });
  }
};

function waitForUiRender(screenId, timeoutMs) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = Math.max(0, timeoutMs || 0);
    const onUiRendered = (event) => {
      const resolvedId = event && event.detail ? event.detail.screenId || null : null;
      if (!screenId || resolvedId === screenId) {
        cleanup();
      }
    };
    const cleanup = () => {
      window.removeEventListener("ENGINE_UI_RENDERED", onUiRendered);
      if (timerId) {
        clearTimeout(timerId);
      }
      resolve();
    };
    const timerId = timeout > 0 ? setTimeout(cleanup, timeout) : null;

    window.addEventListener("ENGINE_UI_RENDERED", onUiRendered);
  });
}

async function runStartupSequence() {
  Cursor.changeState("hidden");
  const context = await RunSplashSequence();
  const overlayId = context && context.overlayId ? context.overlayId : "engine-startup-overlay";

  const introPromise = new Promise((resolve) => {
    introResolve = resolve;
  });
  const introCalledPromise = new Promise((resolve) => {
    introCalledResolve = resolve;
  });
  const introDonePromise = new Promise((resolve) => {
    introDoneResolve = resolve;
  });
  introHandled = false;

  if (!ENGINE.Startup) {
    ENGINE.Startup = {};
  }

  ENGINE.Startup.PlayIntroCinematic = async (payload) => {
    if (introHandled) {
      return false;
    }
    introHandled = true;
    if (introCalledResolve) {
      introCalledResolve(true);
    }
    const played = await PlayIntroCinematic(payload, {
      rootId: overlayId,
      videoId: "engine-intro-video",
    });
    if (introResolve) {
      introResolve(played);
    }
    if (introDoneResolve) {
      introDoneResolve(true);
    }
    return played;
  };

  sendEvent("CUTSCENE_REQUEST", { cutsceneId: "Opening" });
  const introCalled = await Promise.race([
    introCalledPromise,
    Wait(250).then(() => false),
  ]);
  if (!introHandled && introResolve) {
    introHandled = true;
    introResolve(false);
  }

  if (introCalled) {
    await introDonePromise;
  }

  sendEvent("UI_REQUEST", { screenId: "TitleScreen" });
  await waitForUiRender("TitleScreen", 2000);
  await FadeElement(overlayId, 0, 1);
  RemoveRoot(overlayId);
  Cursor.changeState("enabled");
}

(() => {
  if (typeof initialize !== "function") {
    Log("ENGINE", "Bootup failed: initialize not available.", "error", "Startup");
    return;
  }

  Log("ENGINE", "Start Engine Bootup", "log", "Startup");
  const exposed = initialize();
  if (exposed && typeof exposed === "object") {
    Object.assign(ENGINE, exposed);
  }
  Log("ENGINE", "Bootup complete.", "log", "Startup");
  waitForUserStart();
})();

/* === EXPORTS === */
// Public engine surface for the game.

export { ENGINE };