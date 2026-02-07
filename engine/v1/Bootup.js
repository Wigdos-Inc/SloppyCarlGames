// Startup Sequence Starter

// Bootup.js starts the Engine. core/ini.js initializes diagnostics + base values.


/* === IMPORTS === */
// Core initialization and logging.

import { initialize } from "./core/ini.js";
import { log } from "./core/meta.js";
import {
  RenderPayload,
  SetElementStyle,
  SetElementText,
} from "./handlers/Render.js";
import { RunSplashSequence } from "./core/splash.js";

/* === GLOBALS === */
// Single global entry point for the game.

const root = typeof globalThis !== "undefined" ? globalThis : window;
const ENGINE = root.ENGINE || {};
root.ENGINE = ENGINE;

/* === STARTUP === */
// Runs the boot sequence and exposes the public API.

function waitForUserStart() {
  const startupTextId = "engine-startup-text";

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

  RenderPayload({
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
    window.removeEventListener("keydown", onStart);
    window.removeEventListener("pointerdown", onStart);
    SetElementText(startupTextId, "");
    SetElementStyle(startupTextId, { display: "none" });
    RunSplashSequence();
  };

  window.addEventListener("keydown", onStart, { once: true });
  window.addEventListener("pointerdown", onStart, { once: true });
};

(() => {
  if (typeof initialize !== "function") {
    log("ENGINE", "Bootup failed: initialize not available.", "error", "Startup");
    return;
  }

  log("ENGINE", "Bootup Start", "log", "Startup");
  const exposed = initialize();
  if (exposed && typeof exposed === "object") {
    Object.assign(ENGINE, exposed);
  }
  log("ENGINE", "Bootup complete.", "log", "Startup");
  waitForUserStart();
})();

/* === EXPORTS === */
// Public engine surface for the game.

export { ENGINE };