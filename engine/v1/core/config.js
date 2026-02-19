// Editable base values, multipliers and rule switches.

/* === CONFIG === */
// Base values and rule switches for the engine.

const settings = JSON.parse(localStorage.getItem("settings")) ?? null;

let CONFIG = {
  DEBUG: {
    ALL: settings.debugMode ?? false,       // Global Debug Switch
    SKIP: {
      Splash: false,
      Intro: settings.skipIntro ?? false,
      Cutscene: false,
    },
    LEVELS: {
      Triggers: true,
      FreeCam: false,
      BoundingBox: {
        Terrain: false,
        Scatter: false,
        Entity: false,
        EntityPart: false,
        Obstacle: false,
        Player: false,
        PlayerPart: false,
        Boss: false,
        BossPart: false,
      },
    },
    LOGGING: {
      All: true,
      Type: {
        Log: true,
        Warn: true,
        Error: true,
      },
      Source: {
        Engine: true,
        Game: true,
      },
      Channel: {
        Startup: true,
        UI: true,
        Audio: true,
        Cutscene: true,
        Controls: {
          Click: true,
          Hover: true,
          Key: true,
        },
        Level: true,
      },
    },
  },
  VOLUME: {
    Master  : settings.master ?? 0.5,
    Music   : settings.music ?? 1,
    Voice   : settings.voice ?? 1,
    MenuSfx : settings.menuSfx ?? 1,
    GameSfx : settings.gameSfx ?? 1,
    Cutscene: settings.cutscene ?? 1
  },
  PERFORMANCE: {
    TerrainScatter: "High",
  }
};

/* === EXPORTS === */
// Public configuration surface for engine modules.

export { CONFIG };