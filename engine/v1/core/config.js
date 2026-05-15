import { Unit } from "../math/Utilities.js";

/* === CONFIG === */
// Base values and rule switches for the engine.


const settings = JSON.parse(localStorage.getItem("settings")) ?? null;

const CONFIG = {
  DEBUG: {
    ALL : settings?.debugMode ?? false,       // Global Debug Switch
    SKIP: {
      Splash  : false,
      Intro   : settings?.skipIntro ?? false,
      Cutscene: false,
    },
    LEVELS: {
      Triggers: true,
      FreeCam : false,
      BoundingBox: {
        Terrain   : true,
        Scatter   : false,
        Entity    : false,
        EntityPart: false,
        Obstacle  : false,
        Player    : true,
        PlayerPart: false,
        Boss      : false,
        BossPart  : false,
        Grid      : {
          Visible: true,
          Scale  : 1,
        }
      },
      DetailedBounds: {
        Terrain : true,
        Obstacle: true,
        Entity  : true,
        Player  : true,
        Boss    : true,
      },
      Trails: {
        Player     : true,
        Boss       : false,
        Enemies    : false,
        Collectible: false,
        Projectile : false,
      },
    },
    LOGGING: {
      All: true,
      Type: {
        Log  : true,
        Warn : true,
        Error: true,
      },
      Source: {
        Engine: true,
        Game  : true,
      },
      Channel: {
        Startup : true,
        UI      : true,
        Audio   : true,
        Cutscene: true,
        Controls: {
          Click: true,
          Hover: true,
          Key  : true,
        },
        Level: true,
        Validation: true,
        Meta: true,
        Player: true,
      },
    },
  },
  VOLUME: {
    Master  : settings?.master ?? 0.5,
    Music   : settings?.music ?? 1,
    Voice   : settings?.voice ?? 1,
    MenuSfx : settings?.menuSfx ?? 1,
    GameSfx : settings?.gameSfx ?? 1,
    Cutscene: settings?.cutscene ?? 1
  },
  PERFORMANCE: {
    TerrainScatter: "low",
    RenderDistance: "High",
    SimDistance   : "High",
    Animations    : true,
    FrameRate     : 60
  },
  PHYSICS: {
    Gravity   : { 
      Enabled: true, 
      Strength: new Unit(10, "cnu"), 
      TerminalVelocity: { Air: new Unit(30, "cnu"), Water: new Unit(3, "cnu") } 
    },
    Resistance: { Enabled: true },
    Buoyancy  : { 
      Enabled: true, 
      Force: { Min: new Unit(2, "cnu"), Max: new Unit(10, "cnu") }, 
      GradientDepth: new Unit(5, "cnu") 
    },
    Collision : { Enabled: true, Hurtbox: false, Hitbox: false },
    Correction: { Enabled: true, MinDeltaDegrees: 5, MaxDeltaDegrees: 35, GroundSnapTolerance: 0.05 },
  },
  CUSTOM_EVENTS: {
    Entities: {
      spawn          : true,
      despawn        : true,
      stateChange    : true,
      collision      : true,
      groundedChange : true,
      damageReceived : true,
      damageInflicted: true,
    }
  }
};

/* === EXPORTS === */
// Public configuration surface for engine modules.

export { CONFIG };