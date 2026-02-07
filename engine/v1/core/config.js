// Editable base values, multipliers and rule switches.

/* === CONFIG === */
// Base values and rule switches for the engine.

const CONFIG = {
  DEBUG: {
    All: true,
    Logging: true,
    Log: true,
    Warn: true,
    Error: true,
    Startup: true,
    UI: true,
    Audio: true,
  },
  VOLUME: {
    Music: 1,
    Sfx: 1,
    Voice: 1,
  },
};

/* === EXPORTS === */
// Public configuration surface for engine modules.

export { CONFIG };