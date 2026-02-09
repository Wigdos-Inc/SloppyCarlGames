// Actively tracks metadata and handles logging.

// Accesible to all files for logging and metadata accesibility for debugging, math, positioning, etc

/* === IMPORTS === */
// Engine configuration access.

import { CONFIG } from "./config.js";

/* === STATE === */
// Stored log history.

const logs = [];

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

function shouldLog(channel, level) {
  const debug = getDebugConfig();
  if (!debug) {
    return true;
  }

  if (debug.All === true) {
    return true;
  }

  if (debug.Logging === false) {
    return false;
  }

  if (level === "log" && debug.Log === false) {
    return false;
  }

  if (level === "warn" && debug.Warn === false) {
    return false;
  }

  if (level === "error" && debug.Error === false) {
    return false;
  }

  if (channel && debug[channel] === true) {
    return true;
  }

  return false;
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

function log(source, message, level, channel) {
  if (!isValidSource(source)) {
    console.error("ENGINE.Log requires a SOURCE in full caps (A-Z, 0-9, _).");
    return;
  }

  const resolvedLevel = resolveLevel(level);
  const entry = {
    time: Date.now(),
    level: resolvedLevel,
    source: source,
    channel: channel || "All",
    message: message,
  };

  logs.push(entry);

  if (!shouldLog(entry.channel, entry.level)) {
    return;
  }

  const logger = console[resolvedLevel] || console.log;
  logger(
    `[${new Date(entry.time).toISOString()}] [${entry.source}] [${entry.channel}]`,
    entry.message
  );
}

function logAll() {
  logs.forEach((entry) => {
    const logger = console[entry.level] || console.log;
    logger(
      `[${new Date(entry.time).toISOString()}] [${entry.source}] [${entry.channel}]`,
      entry.message
    );
  });
}

function sendEvent(eventName, payload) {
  if (typeof eventName !== "string" || eventName.length === 0) {
    console.error("ENGINE.Meta.SendEvent requires a non-empty event name.");
    return;
  }

  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    console.error("ENGINE.Meta.SendEvent is only available in a browser context.");
    return;
  }

  const detail = {
    payload: payload || null,
  };

  window.dispatchEvent(new CustomEvent(eventName, { detail: detail }));
}

function initMeta() {
  log("ENGINE", "Meta system ready.", "log", "Startup");
}

/* === EXPORTS === */
// Public metadata API for engine modules.

export { log, logAll, sendEvent, initMeta, Wait };