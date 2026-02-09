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
    Music: 0.5,
    Sfx: 0.5,
    Voice: 0.5,
    Cutscene: 0.5
  },
  CUTSCENE: {
    DisableAll: false,
    SkipIntro: false,
  },
  PHYSICS: {}
};

/* === EXPORTS === */
// Public configuration surface for engine modules.

export { CONFIG };