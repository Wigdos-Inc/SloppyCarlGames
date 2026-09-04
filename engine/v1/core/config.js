import { Unit } from "../math/Utilities.js";

/* === CONFIG === */
// Base values and rule switches for the engine and game-facing API.


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
      FreeCam : false,                       // Free Camera Mode
      BackfaceCulling: false,                // Cull back faces — wrongly wound geometry vanishes
      BoundingBox: {                         // Render Bounding Boxes
        Terrain     : false,
        Scatter     : false,
        Entity      : false,
        EntityPart  : false,
        Obstacle    : false,
        Void        : false,
        Player      : false,
        PlayerPart  : false,
        Boss        : false,
        BossPart    : false,
        Particle    : false,
        ParticlePart: false,
        Grid        : {                      // Render Debug Grid
          Visible: false,
          Scale  : new Unit(1, "cnu"),
        }
      },
      DetailedBounds: {                      // Render Detailed Bounds
        Terrain : false,
        Obstacle: false,
        Void    : false,                     // Void volume + its void walls and open faces
        Entity  : false,
        Player  : false,
        Boss    : false,
        Particle: false,
      },
      Trails: {                              // Render Movement Trails
        Player     : false,
        Boss       : false,
        Enemies    : false,
        Collectible: false,
        Projectile : false,
        Particle   : false,
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
        Debug: true,
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
    Scatter    : { Density: "High", Quality: "High" },
    Particles  : "High",
    SimDistance: "High",
    Animations : "High",
    FrameRate  : 60,
    Resolution : 100
  },
  PHYSICS: {
    Gravity   : { 
      Enabled         : true, 
      Strength        : new Unit(10, "cnu"), 
      TerminalVelocity: { Air: new Unit(30, "cnu"), Water: new Unit(12, "cnu") } 
    },
    Resistance: { Enabled: true },
    Buoyancy  : { 
      Enabled      : true, 
      Force        : { Min: new Unit(1, "cnu"), Max: new Unit(8, "cnu") }, 
      GradientDepth: new Unit(2, "cnu") 
    },
    Collision : { 
      Enabled: true, 
      Hurtbox: false, 
      Hitbox : false 
    },
    Correction: { 
      Enabled        : true, 
      MinDeltaDegrees: 5, 
      MaxDeltaDegrees: 35 
    },
  },
  CUSTOM_EVENTS: {
    Entities: {
      spawn          : false,
      despawn        : false,
      actionChange   : false,
      collision      : false,
      groundedChange : false,
      damageReceived : false,
      damageInflicted: false,
    }
  },
  CAMERA: { 
    Fov: 60,
    Sensitivity: { 
      Mouse: 40, 
      Keyboard: 50 
    },
  },
  RENDERING: {
    Texture: {
      Noise  : { Density: 1, SpeckSize: 2 },
      Tiles  : { Density: 1, SpeckSize: 1 },
      Stripes: { Density: 1, SpeckSize: 1 },
      Grid   : { Density: 1, SpeckSize: 1 },
    },
    Fog: { Air: 100, Water: 60 },            // Fog reach %, 20-100; >100 saturates past the cull radius and pops in
  }
};

// Max authorable skybox gradient stops.
const SKY_STOP_LIMIT = 10;

// Engine-internal performance-related scaling.
const PERFORMANCE_SCALING = {
  SimDistance: {
    Tiers    : { Low: new Unit(50, "cnu"), Medium: new Unit(100, "cnu"), High: new Unit(150, "cnu"), Ultra: new Unit(250, "cnu") },
    Fractions: {
      Scatter         : { Cull: 0.70, Fade: 0.40 },                   // Cull relative to SimDistance; Fade relative to Cull
      TextureAnimation: { StopBake : 0.60 },
      WorldInstances  : { Cull: 1.5, Fog: 0.90 }                      // Cull relative to SimDistance; Fog relative to Cull
    }
  },
  Density: {
    Scatter  : { Disabled: 0, Low: 0.25, Medium: 0.50, High: 1 },
    Particles: { Disabled: 0, Low: 0.50, Medium: 0.80, High: 1 }
  },
  Animation: {
    Entities: { Disabled: 0, Low: 0.25, Medium: 0.50, High: 1 }       // Frame correction budget
  },
  Loop: { MaxSubsteps: 4 }                                            // Physics ticks per frame before time dilates
}


/* === EXPORTS === */
// Public configuration surface for engine modules.

export { CONFIG, PERFORMANCE_SCALING, SKY_STOP_LIMIT };