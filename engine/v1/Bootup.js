// Boot sequence entry point.
// Purpose: initialize ENGINE via core/ini.js, show the user-start overlay, then run splash
// and signal the game to load its startup UI. This file owns startup timing only.
// Limits: no gameplay logic, no UI element construction details, no asset loading beyond splash.
// Pipeline: Initialize() -> CreateUI() overlay -> Controls input -> Startup sequence.


/* === IMPORTS === */
// Core initialization and logging.

import { Initialize } from "./core/ini.js";
import { Cache, Cursor, Log, SendEvent, Wait } from "./core/meta.js";
import { CONFIG } from "./core/config.js";
import { FadeElement, RemoveRoot, SetElementStyle, SetElementText } from "./handlers/Render.js";
import { CreateUI } from "./handlers/UI.js";
import { Controls } from "./handlers/Controls.js";
import { PlayEngineCutscene, PlayRenderedCutscene } from "./handlers/Cutscene.js";
import { ApplySplashScreenSequence } from "./handlers/menu/Splash.js";

/* === GLOBALS === */
// Single global entry point for the game.

let ENGINE = null;

/* === STARTUP === */
// Runs the boot sequence and exposes the public API.

let introHandled = false;
let introCalledResolve = null;
let introDoneResolve = null;

const startupOverlayID = "engine-startup-overlay";
const startupTextID = "engine-startup-text";
const splashRequestTimeout = 1000;
const introRequestTimeout = 1000;

function setupIntroRuntime(overlayId) {
  const introCalledPromise = new Promise((resolve) => introCalledResolve = resolve);
  const introDonePromise = new Promise((resolve) => introDoneResolve = resolve);

  introHandled = false;
  const runIntro = async (type, payload) => {
    if (introHandled) return false;

    introHandled = true;
    introCalledResolve(true);
    const options = { rootId: overlayId, videoId: "engine-intro-video" };
    const played = type === "rendered"
      ? await PlayRenderedCutscene(payload, options)
      : await PlayEngineCutscene(payload, options);
    introDoneResolve(true);
    return played;
  };

  return {
    introCalledPromise,
    introDonePromise,
  };
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
  const context = await ApplySplashScreenSequence({ timeoutMs: splashRequestTimeout });
  const overlayId = context.overlayId;

  if (CONFIG.DEBUG.SKIP.Intro !== true) {
    const { introCalledPromise, introDonePromise } = setupIntroRuntime(overlayId);

    SendEvent("CUTSCENE_REQUEST", { cutsceneId: "Opening" });
    const introCalled = await Promise.race([
      introCalledPromise,
      Wait(introRequestTimeout).then(() => false),
    ]);

    if (introCalled) await introDonePromise;
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
    Log("ENGINE", "Bootup failed. Engine must be used in a browser context and have access to the following:\n- window\n- window.dispatchEvent\n- document\n- document.body\n- console\n- sessionStorage\n- localStorage\n- requestAnimationFrame\n- performance", "error", "Startup");
    return false;
  }

  return true;
}

(() => {
  // Check for Up-to-Date Browser Context
  if (!browserContextCheck()) return;

  ENGINE = Initialize();
  Log("ENGINE", "Bootup complete.", "log", "Startup");
  waitForUserStart();
})();

/* === EXPORTS === */
// Public engine surface for the game.

export { ENGINE };
