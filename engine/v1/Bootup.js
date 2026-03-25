// Boot sequence entry point.
// Purpose: initialize ENGINE via core/ini.js, show the user-start overlay, then run splash
// and signal the game to load its startup UI. This file owns startup timing only.
// Limits: no gameplay logic, no UI element construction details, no asset loading beyond splash.
// Pipeline: Initialize() -> CreateUI() overlay -> Controls input -> Startup sequence.


/* === IMPORTS === */
// Core initialization and logging.

import { Initialize } from "./core/ini.js";
import { Cache, Cursor, Log, SendEvent } from "./core/meta.js";
import { CONFIG } from "./core/config.js";
import { FadeElement, RemoveRoot, SetElementStyle, SetElementText } from "./handlers/Render.js";
import { CreateUI } from "./handlers/UI.js";
import { Controls } from "./handlers/Controls.js";
import { PlayEngineCutscene, PlayRenderedCutscene } from "./handlers/Cutscene.js";
import { ApplySplashScreenSequence, AcceptSplashPayload } from "./handlers/menu/Splash.js";

/* === GLOBALS === */
// Single global entry point for the game.

let ENGINE = null;

/* === STARTUP === */
// Runs the boot sequence and exposes the public API.

const introCutscene = {
  requested: false,
  type: null,
  payload: null,
};
const startupOverlayID = "engine-startup-overlay";
const startupTextID = "engine-startup-text";

function clearIntroCinematicBuffer() {
  introCutscene.type = null;
  introCutscene.payload = null;
}

function PlayIntroCinematic(payload, cutsceneType) {
  if (introCutscene.requested !== true) {
    Log("ENGINE", "Intro cinematic payload ignored because intro was not requested.", "warn", "Startup");
    return false;
  }

  if (introCutscene.payload !== null) {
    Log("ENGINE", "Intro cinematic payload already set for this startup sequence.", "warn", "Startup");
    return false;
  }

  const normalizedType = typeof cutsceneType === "string" ? cutsceneType.toLowerCase() : "";
  if (normalizedType !== "rendered" && normalizedType !== "engine") {
    Log("ENGINE", "Intro cinematic ignored: cutsceneType must be 'rendered' or 'engine'.", "warn", "Startup");
    return false;
  }

  introCutscene.type = normalizedType;
  introCutscene.payload = payload;
  return true;
}

function waitForUserStart() {
  const controls = new Controls();
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
    screenId: "EngineStartup",
    rootId: startupOverlayID,
    rootStyles: startupOverlayStyles,
    elements: [
      {
        type: "img",
        id: "engine-splash-image",
        attributes: {},
        styles: startupImageStyles,
        events: {},
        on: {},
        children: [],
      },
      {
        type: "div",
        id: startupTextID,
        text: "Click or press any key to start game",
        attributes: {},
        styles: startupTextStyles,
        events: {},
        on: {},
        children: [],
      },
    ],
  });

  // Open the splash payload acceptance window and notify the game.
  AcceptSplashPayload();
  setTimeout(() => SendEvent("SPLASH_REQUEST", {}), 5);

  const onStart = () => {
    if (started) {
      return;
    }
    started = true;
    controls.clear();
    SetElementText(startupTextID, "");
    SetElementStyle(startupTextID, { display: "none" });
    void runStartupSequence();
  };

  controls.on("keydown", onStart);
  controls.on("pointerdown", onStart);
}

async function runStartupSequence() {
  Cursor.changeState("hidden");

  clearIntroCinematicBuffer();
  const context = await ApplySplashScreenSequence({
    onSequenceStart: () => {
      if (CONFIG.DEBUG.SKIP.Intro === true) {
        Log("ENGINE", "Intro cinematic skipped by settings.", "log", "Startup");
        return;
      }
      introCutscene.requested = true;
      SendEvent("INTRO_CINEMATIC_REQUEST", { cutsceneId: "Opening" });
    },
  });

  const requestedType = introCutscene.type;
  const requestedPayload = introCutscene.payload;
  introCutscene.requested = false;
  clearIntroCinematicBuffer();

  const overlayId = context.overlayId;

  if (CONFIG.DEBUG.SKIP.Intro !== true && requestedPayload !== null) {
    const options = { rootId: overlayId, videoId: "engine-intro-video" };
    if (requestedType === "rendered") await PlayRenderedCutscene(requestedPayload, options);
    else await PlayEngineCutscene(requestedPayload, options);
  }

  SendEvent("UI_REQUEST", { screenId: "TitleScreen" });

  // Provide a shared resolver on Cache so UI modules can notify Bootup
  // that the TitleScreen has been applied. This avoids attaching event
  // listeners inside engine modules (forbidden by engine rules).
  const uiAppliedPromise = new Promise((resolve) => {
    Cache.UI.startupUiAppliedResolve = resolve;

    // Safety fallback to avoid a stuck boot sequence.
    setTimeout(() => {
      if (Cache.UI.startupUiAppliedResolve) Cache.UI.startupUiAppliedResolve(false);
      Cache.UI.startupUiAppliedResolve = null;
      resolve(false);
    }, 2000);
  });

  await uiAppliedPromise;

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
    Log(
      "ENGINE", 
      `
        Bootup failed. Engine must be used in a modern browser context and have access to the following:
        \n- window
        \n- window.dispatchEvent
        \n- document
        \n- document.body
        \n- console
        \n- sessionStorage
        \n- localStorage
        \n- requestAnimationFrame
        \n- performance
      `, 
      "error", 
      "Startup"
    );
    return false;
  }

  return true;
}

(() => {
  // Check for Up-to-Date Browser Context
  if (!browserContextCheck()) return;

  ENGINE = Initialize();
  ENGINE.Startup.PlayIntroCinematic = PlayIntroCinematic;
  Log("ENGINE", "Bootup complete.", "log", "Startup");
  waitForUserStart();
})();

/* === EXPORTS === */
// Public engine surface for the game.

export { ENGINE };
