// Editable base values, multipliers and rule switches.

/* === CONFIG === */
// Base values and rule switches for the engine.

const CONFIG = {
  DEBUG: {
    All: true,       // Global Debug Switch
    Logging: true,   // All Debug Logging
    Log: true,       // Console Logs
    Warn: true,      // Console Warnings
    Error: true,     // Console Errors
    Engine: true,    // Engine Logs
    Game: true,      // Game Logs
    Startup: true,   // Startup Workflow
    UI: true,        // Menus & UI Workflow
    Audio: true,     // Audio Workflow
    Controls: true,  // Controls Workflow
    Cutscene: true,  // Cutscene Workflow
  },
  VOLUME: {
    Music: 0.5,
    Sfx: 0.5,
    Voice: 0.5,
    Cutscene: 0.5
  },
  CUTSCENE: {
    DisableAll: false,
    SkipIntro: true,
  }
};

/* === EXPORTS === */
// Public configuration surface for engine modules.

export { CONFIG };