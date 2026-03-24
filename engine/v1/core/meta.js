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

function ReadFromSession(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    Log("ENGINE", `Couldn't read from "${key}" sessionStorage.\n\nError:\n${error}`, "error", "Meta");
    return null;
  }
}

function PushToSession(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    Log("ENGINE", `Couldn't push to "${key}" sessionStorage.\n\nError:\n${error}`, "error", "Meta");
    void error;
  }
  return value;
}

function clearSessionStorage() {
  try {
    sessionStorage.clear();
  } catch (error) {
    Log("ENGINE", `Couldn't clear sessionStorage.\n\nError:\n${error}`, "error", "Meta");
    void error;
  }
}

/* === STATE === */
// Stored log history.

const logs = ReadFromSession(SESSION_KEYS.Logs) ?? {
  all: [],
  engine: [],
  game: [],
  controls: [],
  other: [],
}

// Cache last known payloads for quick lookups.
const Cache = ReadFromSession(SESSION_KEYS.Cache) ?? {
  UI: {
    lastPayload: null,
    screenID: null,
    elementIndex: {},
    uiRuntime: {
      hoverOverMap: {},
      hoverOutMap: {},
      clickMap: {},
      inputMap: {},
      changeMap: {},
      keyMap: {},
    },
  },
  Level: {
    lastPayload: null,
  },
  Cutscene: {
    lastPayload: null,
  },
}

// Shared delay utility for async flows.
function Wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function IsPointerLocked() {
  return Boolean(document.pointerLockElement);
}

function RequestPointerLock(targetElement) {
  const element = targetElement || document.getElementById("engine-level-root-canvas") || document.body;
  element.requestPointerLock();
  return true;
}

/* === DEBUG CHECKS === */
// Gate logging based on debug flags.
function resolveControlsSubtypeFromMessage(message) {
  const lower = message.toLowerCase();
  let eventType = null;

  const userInputMatch = lower.match(/user input:\s*([a-z]+)/);
  if (userInputMatch && userInputMatch[1]) eventType = userInputMatch[1];

  const handledMatch = lower.match(/input action handled:\s*([a-z]+)/);
  if (!eventType && handledMatch && handledMatch[1]) eventType = handledMatch[1];

  if (!eventType) return null;

  if (eventType === "pointerover" || eventType === "pointerout" || eventType === "mousemove") return "Hover";

  if (eventType === "keydown" || eventType === "keyup") return "Key";

  if (
    eventType === "click" ||
    eventType === "pointerdown" ||
    eventType === "pointerup" ||
    eventType === "input" ||
    eventType === "change"
  ) {
    return "Click";
  }

  return null;
}

function shouldLog(source, channel, level, message) {
  // Is Logging allowed?
  const logging = CONFIG.DEBUG.LOGGING;
  if (CONFIG.DEBUG.ALL !== true || logging.All !== true) return false;

  // Is the Logging Type allowed?
  const type = logging.Type;
  if (
    (level === "log" && type.Log === false) ||
    (level === "warn" && type.Warn === false) ||
    (level === "error" && type.Error === false)
  ) {
    return false;
  }

  // Is the Logging Source allowed?
  if ((source === "engine" && logging.Source.Engine === false) || (source === "game" && logging.Source.Game === false)) {
    return false;
  }

  if (channel.startsWith("Controls")) {
    // Is the Controls Logging Subchannel allowed?
    const segments = channel.split(".");
    let subChannel = segments.length > 1 ? segments[1] : null;
    if (!subChannel && channel === "Controls") subChannel = resolveControlsSubtypeFromMessage(message);

    if (subChannel && logging.Channel.Controls[subChannel] === false) return false;
    if (subChannel && logging.Channel.Controls[subChannel] === true) return true;
  }
  return logging.Channel[channel];    // Is the Logging Channel allowed?
}

function resolveLevel(level) {
  if (level === "warn" || level === "warning") return "warn";
  if (level === "error") return "error";
  return "log";
}

/* === LOGGING === */
// Main log funnel and log replay.

function getMostRecentLogEntry() {
  if (logs.all.length === 0) return null;

  const latest = logs.all[logs.all.length - 1];
  return latest;
}

function isDuplicateOfLatest(entry) {
  const latest = getMostRecentLogEntry();
  if (
    latest &&
    latest.source === entry.source &&
    latest.channel === entry.channel &&
    latest.level === entry.level &&
    latest.message === entry.message
  ) {
    return true;
  }

  if (!String(entry.channel).startsWith("Controls")) {
    return false;
  }

  if (logs.controls.length === 0) {
    return false;
  }

  const startIndex = Math.max(0, logs.controls.length - 3);
  for (let index = logs.controls.length - 1; index >= startIndex; index--) {
    const existing = logs.controls[index];
    if (
      existing.source === entry.source &&
      existing.channel === entry.channel &&
      existing.level === entry.level &&
      existing.message === entry.message
    ) {
      return true;
    }
  }

  return false;
}

function Log(source, message, level, channel) {
  // Normlize payload
  [level, message] = [level, message].map(v => v.toLowerCase());
  source = source.toUpperCase();

  // Normalize invalid source names into an engine error.
  if (!/^[A-Z0-9_]+$/i.test(source)) {
    message = `Invalid log source "${source}". ${message}`;
    source = "engine";
    level = "error";
  }

  const resolvedLevel = resolveLevel(level);
  const entry = {
    time: new Date(Date.now()).toISOString().replace("T", " | "),
    level: resolvedLevel,
    source: source,
    channel: channel || "All",
    message: message,
  };

  // Prevent Duplicate Logs
  if (isDuplicateOfLatest(entry)) return;

  // Log Caching
  logs.all.push(entry);
  if (entry.channel && entry.channel.startsWith("Controls")) logs.controls.push(entry);
  else if (entry.source === "ENGINE") logs.engine.push(entry);
  else if (entry.source === "GAME") logs.game.push(entry);
  else logs.other.push(entry);

  PushToSession(SESSION_KEYS.Logs, logs);

  // Skip console output when debug gating fails.
  if (!shouldLog(entry.source, entry.channel, entry.level, entry.message)) return;

  const logger = console[resolvedLevel] || console.log;
  logger(
    `[${entry.time}] [${entry.source}] [${entry.channel}]`,
    entry.message
  );
}

// Replay all stored logs in order.
function LogAll() {
  logs.all.forEach((entry) => {
    const logger = console[entry.level] || console.log;
    logger(
      `[${entry.time}] [${entry.source}] [${entry.channel}]`,
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
  document.body.style.background = "black";
  while (document.body.firstChild) document.body.removeChild(document.body.firstChild);
  window.close();
}

function SendEvent(eventName, payload) {
  // Dispatch with payload as detail.
  if (eventName !== "USER_INPUT") Log(
    "ENGINE", 
    `Event: ${eventName}\nPayload: ${JSON.stringify(payload)}`, 
    "log", 
    "Meta"
  );
  window.dispatchEvent(new CustomEvent(eventName, { detail: payload }));
}

/* === CNU === */
// CarlNet Unit Scale: 1 CNU = ~1 Meter.
// All engine measurement values are expressed in CNUs.
// Multiply by CNU_SCALE when converting to WebGL world-space units (Done through Utilities.js classes).
// TLDR: 1 CNU = CNU_SCALE WebGL Units

const CNU_SCALE = 1;

/* === EXPORTS === */
// Public metadata API for engine modules.

export {
  CNU_SCALE,
  Log,
  LogAll,
  LogCache,
  SendEvent,
  Wait,
  IsPointerLocked,
  RequestPointerLock,
  Cache,
  Cursor,
  ExitGame,
  PushToSession,
  ReadFromSession,
  SESSION_KEYS,
};