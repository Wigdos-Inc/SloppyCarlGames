// Boot sequence entry point.
// Purpose: initialize ENGINE via core/ini.js, show the user-start overlay, then run splash
// and signal the game to load its startup UI. This file owns startup timing only.
// Limits: no gameplay logic, no UI element construction details, no asset loading beyond splash.
// Pipeline: Initialize() -> CreateUI() overlay -> Controls input -> RunSplashSequence().


/* === IMPORTS === */
// Core initialization and logging.

import { Initialize } from "./core/ini.js";
import { Cursor, Log, SendEvent, Wait } from "./core/meta.js";
import { FadeElement, RemoveRoot, SetElementStyle, SetElementText } from "./handlers/Render.js";
import { CreateUI } from "./handlers/UI.js";
import { PlayIntroCinematic } from "./handlers/Cutscene.js";
import { RunSplashSequence } from "./handlers/menu/Splash.js";

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
  return new Promise((resolve) => {
    const timeout = Math.max(0, timeoutMs || 0);
    const onUiRendered = (event) => {
      if (!screenId || event.detail.screenId === screenId) {
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
  const context = await RunSplashSequence() ?? null;
  const overlayId = context.overlayId;

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

  SendEvent("CUTSCENE_REQUEST", { cutsceneId: "Opening" });
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

  SendEvent("UI_REQUEST", { screenId: "TitleScreen" });
  await waitForUiRender("TitleScreen", 2000);
  await FadeElement(overlayId, 0, 1);
  RemoveRoot(overlayId);
  Cursor.changeState("enabled");
}

function browserContextCheck() {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent === "undefined" ||
    typeof document === "undefined" ||
    typeof document.body === "undefined" ||
    typeof console === "undefined" ||
    typeof sessionStorage === "undefined" ||
    typeof localStorage === "undefined" ||
    typeof requestAnimationFrame === "undefined" ||
    typeof performance === "undefined"
  ) {
    Log("ENGINE", "Bootup failed. Engine must be used in a browser context and have access to the following:\n- window\n- window.dispatchEvent\n- document\n- document.body\n- console\n- sessionStorage\n- localStorage\n- requestAnimationFrame\n- performance", "error", "Startup");
    return false;
  }

  return true;
}

(() => {
  // Check for Up-to-Date Browser Context
  if (!browserContextCheck()) return;

  Object.assign(ENGINE, Initialize());
  Log("ENGINE", "Bootup complete.", "log", "Startup");
  waitForUserStart();
})();

/* === EXPORTS === */
// Public engine surface for the game.

export { ENGINE };