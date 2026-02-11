// Actively tracks metadata and handles logging.

// Accesible to all files for logging and metadata accesibility for debugging, math, positioning, etc

/* === IMPORTS === */
// Engine configuration access.

import { CONFIG } from "./config.js";

/* === SESSION === */
// Persistence helpers for same-tab navigation.

const SESSION_KEYS = {
  Logs: "ENGINE_LOGS",
  Cache: "ENGINE_CACHE",
  SplashPlayed: "ENGINE_SPLASH_PLAYED",
};

function readFromSession(key, fallback) {
  if (typeof sessionStorage === "undefined") {
    return fallback;
  }

  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function pushToSession(key, value) {
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      void error;
    }
  }
  return value;
}

function clearSessionStorage() {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.clear();
  } catch (error) {
    void error;
  }
}

/* === STATE === */
// Stored log history.

const logs = pushToSession(
  SESSION_KEYS.Logs,
  readFromSession(SESSION_KEYS.Logs, {
    Engine: [],
    Game: [],
    Controls: [],
    Other: [],
  })
);

// Cache last known payloads for quick lookups.
const Cache = pushToSession(
  SESSION_KEYS.Cache,
  readFromSession(SESSION_KEYS.Cache, {
    UI: {
      lastPayload: null,
      screenID: null,
      elementIndex: {},
    },
    Level: {
      lastPayload: null,
    },
    Cutscene: {
      lastPayload: null,
    },
  })
);

// Shared delay utility for async flows.
function Wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/* === DEBUG CHECKS === */
// Gate logging based on debug flags.

function getDebugConfig() {
  return CONFIG && CONFIG.DEBUG ? CONFIG.DEBUG : null;
}

function shouldLog(source, channel, level) {
  const debug = getDebugConfig();
  // Allow logs when no debug config exists.
  if (!debug) {
    return true;
  }

  if (debug.ALL !== true) {
    return false;
  }

  const logging = debug.LOGGING || {};
  if (logging.All !== true) {
    return false;
  }

  const type = logging.Type || {};
  if ((level === "log" && type.Log === false) ||
    (level === "warn" && type.Warn === false) ||
    (level === "error" && type.Error === false)) {
    return false;
  }

  const sourceConfig = logging.Source || {};
  if ((source === "ENGINE" && sourceConfig.Engine === false) ||
    (source === "GAME" && sourceConfig.Game === false)) {
    return false;
  }

  const channelConfig = logging.Channel || {};
  if (channel) {
    if (channel.startsWith("Controls")) {
      const controlsConfig = channelConfig.Controls;
      if (controlsConfig === false) {
        return false;
      }

      if (typeof controlsConfig === "object" && controlsConfig !== null) {
        const segments = channel.split(".");
        const subChannel = segments.length > 1 ? segments[1] : null;
        if (subChannel && controlsConfig[subChannel] === false) {
          return false;
        }
        if (subChannel && controlsConfig[subChannel] === true) {
          return true;
        }
      }
    }

    if (typeof channelConfig[channel] === "boolean") {
      return channelConfig[channel];
    }
  }

  return true;
}

function resolveLevel(level) {
  if (level === "warn" || level === "warning") {
    return "warn";
  }

  if (level === "error") {
    return "error";
  }

  return "log";
}

/* === LOGGING === */
// Main log funnel and log replay.

function isValidSource(source) {
  if (typeof source !== "string") {
    return false;
  }

  return /^[A-Z0-9_]+$/.test(source);
}

function Log(source, message, level, channel) {
  let resolvedSource = source;
  let resolvedMessage = message;

  // Normalize invalid source names into an engine warning.
  if (!isValidSource(resolvedSource)) {
    resolvedMessage = `Invalid log source "${resolvedSource}". ${resolvedMessage}`;
    resolvedSource = "ENGINE";
  }

  const resolvedLevel = resolveLevel(level);
  const entry = {
    time: Date.now(),
    level: resolvedLevel,
    source: resolvedSource,
    channel: channel || "All",
    message: resolvedMessage,
  };

  if (entry.channel && entry.channel.startsWith("Controls")) {
    logs.Controls.push(entry);
  } else if (entry.source === "ENGINE") {
    logs.Engine.push(entry);
  } else if (entry.source === "GAME") {
    logs.Game.push(entry);
  } else {
    logs.Other.push(entry);
  }

  pushToSession(SESSION_KEYS.Logs, logs);

  // Skip console output when debug gating fails.
  if (!shouldLog(entry.source, entry.channel, entry.level)) {
    return;
  }

  const logger = console[resolvedLevel] || console.log;
  logger(
    `[${new Date(entry.time).toISOString()}] [${entry.source}] [${entry.channel}]`,
    entry.message
  );
}

// Replay all stored logs in order.
function logAll() {
  const allEntries = [
    ...logs.Engine,
    ...logs.Game,
    ...logs.Controls,
    ...logs.Other,
  ].sort((a, b) => a.time - b.time);

  allEntries.forEach((entry) => {
    const logger = console[entry.level] || console.log;
    logger(
      `[${new Date(entry.time).toISOString()}] [${entry.source}] [${entry.channel}]`,
      entry.message
    );
  });
}

// Log the current cache snapshot.
function LogCache() {
  Log("ENGINE", "Cache snapshot:", "log", "Meta");
  Log("ENGINE", JSON.stringify(Cache, null, 2), "log", "Meta");
}

const Cursor = {
  currentState: "enabled",
  currentShape: "auto",
  changeState(state) {
    const resolvedState = state || "enabled";
    this.currentState = resolvedState;
    this.apply();
    Log("ENGINE", `Cursor state: ${resolvedState}`, "log", "Controls");
  },
  changeShape(shape) {
    const resolvedShape = shape || "auto";
    this.currentShape = resolvedShape;
    this.apply();
    Log("ENGINE", `Cursor shape: ${resolvedShape}`, "log", "Controls");
  },
  apply() {
    if (typeof document === "undefined") {
      return;
    }
    const hidden = this.currentState !== "enabled";
    const cursorValue = hidden ? "none" : this.currentShape;
    const pointerValue = hidden ? "none" : "auto";

    if (document.documentElement) {
      document.documentElement.style.cursor = cursorValue;
      document.documentElement.style.pointerEvents = pointerValue;
    }

    if (document.body) {
      document.body.style.cursor = cursorValue;
      document.body.style.pointerEvents = pointerValue;
    }

    const overlay = document.getElementById("engine-startup-overlay");
    if (overlay) {
      overlay.style.cursor = cursorValue;
      overlay.style.pointerEvents = pointerValue;
    }

    let styleTag = document.getElementById("engine-cursor-style");
    if (!styleTag) {
      styleTag = document.createElement("style");
      styleTag.id = "engine-cursor-style";
      document.head.appendChild(styleTag);
    }
    styleTag.textContent = hidden
      ? "html, body, #engine-startup-overlay { cursor: none !important; }"
      : "";
  },
};

function ExitGame() {
  Log("ENGINE", "Exit requested.", "log", "Meta");
  clearSessionStorage();
  Cursor.changeState("hidden");
  if (typeof document !== "undefined" && document.body) {
    document.body.style.background = "black";
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  }
  if (typeof window !== "undefined" && typeof window.close === "function") {
    window.close();
  }
}

function sendEvent(eventName, payload) {
  // Guard against invalid event usage.
  if (typeof eventName !== "string" || eventName.length === 0) {
    Log("ENGINE", "Meta.SendEvent requires a non-empty event name.", "error", "Meta");
    return;
  }

  // Ensure a browser context exists.
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    Log("ENGINE", "Meta.SendEvent is only available in a browser context.", "error", "Meta");
    return;
  }

  // Dispatch with payload as detail.
  const detail = {
    payload: payload || null,
  };

  window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
}

/* === EXPORTS === */
// Public metadata API for engine modules.

export {
  Log,
  logAll,
  LogCache,
  sendEvent,
  Wait,
  Cache,
  Cursor,
  ExitGame,
  pushToSession,
  readFromSession,
  SESSION_KEYS,
};