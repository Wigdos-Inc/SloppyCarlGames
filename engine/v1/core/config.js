import { Unit } from "../math/Utilities.js";

/* === CONFIG === */
// Base values and rule switches for the engine.


const settings = JSON.parse(localStorage.getItem("settings")) ?? null;

const CONFIG = {
  DEBUG: {
    ALL : settings?.debugMode ?? true,       // Global Debug Switch
    SKIP: {
      Splash  : false,                       // Skip Splash Screens
      Intro   : settings?.skipIntro ?? true, // SKip Intro Cutscene
      Cutscene: false,                       // Skip All Cutscenes
    },
    LEVELS: {
      Triggers: true,                        // Render Trigger Meshes
      FreeCam : false,                        // Free Camera Mode
      BoundingBox: {                         // Render Bounding Boxes
        Terrain   : true,
        Scatter   : false,
        Entity    : false,
        EntityPart: false,
        Obstacle  : false,
        Player    : true,
        PlayerPart: false,
        Boss      : false,
        BossPart  : false,
        Grid      : {                        // Render Debug Grid
          Visible: true,
          Scale  : 1,
        }
      },
      DetailedBounds: {                      // Render Detailed Bounds
        Terrain : true,
        Obstacle: true,
        Entity  : true,
        Player  : true,
        Boss    : true,
      },
      Trails: {                              // Render Movement Trails
        Player     : true,
        Boss       : false,
        Enemies    : false,
        Collectible: false,
        Projectile : false,
      },
    },
    LOGGING: {                               // Logging Flags
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
        Simulator: true,
        Validation: true,
        Meta: true,
        Player: true,
        Events: true,
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
    TerrainScatter: "High",
    RenderDistance: "High",
    SimDistance   : "High",
    Animations    : {
      Active : true,
      Quality: "high"
    },
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
      Force: { Min: new Unit(1, "cnu"), Max: new Unit(8, "cnu") }, 
      GradientDepth: new Unit(2, "cnu") 
    },
    Collision : { Enabled: true, Hurtbox: false, Hitbox: false },
    Correction: { Enabled: true, MinDeltaDegrees: 5, MaxDeltaDegrees: 35 },
  },
  CUSTOM_EVENTS: {
    Entities: {
      spawn          : false,
      despawn        : false,
      stateChange    : false,
      collision      : false,
      groundedChange : false,
      damageReceived : false,
      damageInflicted: false,
    }
  },
  CAMERA: { Fov: 60 }
};

/* === EXPORTS === */
// Public configuration surface for engine modules.

export { CONFIG };