import { Unit } from "../math/Utilities.js";
import { DeepFreeze, ReadFromSession, Log } from "./meta.js";

/* === CONFIG === */
// Base values and rule switches for the engine and game-facing API.

const settings = ReadFromSession("settings") ?? null;

const API_CONFIG = {
  Debug: {
    All : settings?.debugMode ?? true,       // Global Debug Switch
    Skip: {
      Splash  : false,                       // Skip Splash Screens
      Intro   : settings?.skipIntro ?? true, // SKip Intro Cutscene
      Cutscene: false,                       // Skip All Cutscenes
    },
    Levels: {
      Triggers: false,                       // Render Trigger Meshes
      FreeCam : false,                       // Free Camera Mode
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
          Size   : 1,                        // CNU
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
      Performance: {                         // Performance Testers
        NoMSAA          : false,             // Turn off level antialiasing; applies on next level load
        FlatShading     : false,             // One color, no texture, fog or lighting; applies on next level load
      },
    },
    Logging: {                               // Logging Flags
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
        Level     : true,
        Render    : true,
        Simulator : true,
        Validation: true,
        Meta      : true,
        Player    : true,
        Events    : true,
        Debug     : true,
      },
    },
  },
  Volume: {
    Master  : settings?.master   ?? 0.5,
    Music   : settings?.music    ?? 1,
    Voice   : settings?.voice    ?? 1,
    MenuSfx : settings?.menuSfx  ?? 1,
    GameSfx : settings?.gameSfx  ?? 1,
    Cutscene: settings?.cutscene ?? 1
  },
  Performance: {
    Scatter         : { Density: "High", Quality: "High" }, // Amount of scatter, and how expensive the shapes are.
    Particles       : "High",                               // The amount of particles generators emit.
    SimDistance     : "High",                               // Umbrella definition for both rendering and simulation distance.
    Animations      : "High",                               // Smoothness of animations.
    FrameRate       : Infinity,                             // FPS for simulation and rendering, fitted to a fraction of RefreshRate. Infinity renders uncapped.
    FrameCounter    : true,                                 // Show rendered FPS while a level runs.
    RefreshRate     : null,                                 // Display refresh rate measured at level start; Infinity when the frame limiter is off.
    Resolution      : 100,                                  // Visual crispness.
    BackfaceCulling : true,                                 // Skip faces turned away from the camera.
    OcclusionCulling: true,                                 // Skip what sits fully behind solid terrain.
  },
  Physics: {
    Gravity   : {
      Enabled         : true,
      Strength        : 10,                       // CNU/s²
      TerminalVelocity: { Air: 30, Water: 12 },   // CNU/s
    },
    Resistance: { Enabled: true },
    Buoyancy  : {
      Enabled      : true,
      Force        : { Min: 1, Max: 8 },          // CNU/s²
      GradientDepth: 2,                           // CNU
    },
    Collision : { 
      Enabled: true, 
      Hurtbox: false, 
      Hitbox : false 
    },
    Correction: {
      Enabled             : true,
      FlatSnapDegrees     : 5,
      ReferenceReleaseRate: 230,                  // Degrees/s
      MaxAngleDelta       : {                     // Degrees
        Air  : { Ground: 35, Sliding: 75, Recover: 20 },
        Water: { Ground: 45, Sliding: 85, Recover: 45 },
      },
      MinGripSpeed: { Air: 0.8, Water: 0.8 },     // Share of maxSpeed needed to grip upside down; eases to 0 at Ground
    },
  },
  CustomEvents: {
    Entities: {
      Spawn          : false,
      Despawn        : false,
      ActionChange   : false,
      Collision      : false,
      GroundedChange : false,
      DamageReceived : false,
      DamageInflicted: false,
    }
  },
  Camera: {
    Fov: 60,                                     // Degrees
    Sensitivity: { Mouse: 40, Keyboard: 50 },
    ZoomStep: 0.5,                               // CNU of arm length change per wheel notch
  },
  Rendering: {
    Texture: {
      Noise  : { Density: 1, SpeckSize: 2 },
      Tiles  : { Density: 1, SpeckSize: 1 },
      Stripes: { Density: 1, SpeckSize: 1 },
      Grid   : { Density: 1, SpeckSize: 1 },
    },
    Fog    : { Air: 100, Water: 60 },            // Fog reach %, 20-100; >100 saturates past the cull radius and pops in
    Filters: {
      ToonLines: false,                          // Ink lines on edges and creases
      Comic    : false,                          // Light bands, fewer colors and halftone dots
    }
  }
};

// Max authorable skybox gradient stops.
const SKY_STOP_LIMIT = 10;

// Rough triangles per cell when gridding meshes for void carving. Higher means fewer, fuller cells.
const CARVE_GRID_TRIANGLES_PER_CELL = 2;

// Performance-related scaling.
const PERFORMANCE_SCALING = DeepFreeze({
  SimDistance: {
    Tiers    : { Low: new Unit(50, "cnu"), Medium: new Unit(100, "cnu"), High: new Unit(150, "cnu"), Ultra: new Unit(250, "cnu") },
    Fractions: {
      Scatter         : { Cull: 0.70, Fade: 0.40 },                   // Cull relative to SimDistance; Fade relative to Cull
      TextureAnimation: { StopBake: 0.60 },
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
  Loop: {
    MaxSubsteps    : 4,                                               // Physics ticks per frame before time dilates
    UncappedSimRate: 60,                                              // Physics ticks per second when FrameRate is Infinity
  },
  Culling: {
    EntityPadding  : new Unit(2, "cnu"),                              // Room around an entity's parts for animation to swing past them
    ScatterCellSize: new Unit(20, "cnu"),                             // Size of the ground squares scatter grouped for culling
    BlockerBudget  : 16,                                              // Max terrain blockers checked per frame
    MinBlockerSize : new Unit(2, "cnu"),                              // Smallest blocker size considered.
    IdleBackoffMs  : 100,                                             // Longest pause in hiding checks while nothing is hidden
    ResumeDistance : new Unit(5, "cnu"),                              // Camera move that ends a pause in hiding checks
    ResumeTurn     : new Unit(25, "degrees")                          // Camera turn that ends a pause in hiding checks
  }
});

// Footing feel: jump windows, contact grace, grip ramp.
const GROUNDING = DeepFreeze({
  JumpBufferMs  : 120,                                                // Early press held until landing
  CoyoteMs      : 100,                                                // Late press honoured after leaving the ground
  ContactGraceMs: 50,                                                 // Surface pose held after a missed probe
  GripRampMs    : 2000,                                               // Grip demand's crossing of 0 ↔ MinGripSpeed
});

// Movement feel: friction floor, slide damping, reversal braking.
const MOVEMENT_TUNING = DeepFreeze({
  MinSupport        : 0.25,                                       // Friction floor; engages past 75.5°
  SlideUphillScale  : 0.15,                                       // Acceleration kept pressing uphill on a slide
  ReversalBrakeScale: 0.75,                                       // Share of acceleration added to braking on a reversal
  OppositeInput     : { Forward: 0.25, Left: 0.2, Right: 0.25 },  // Input past which a reversal counts as held
});

// Default camera feel.
const CAMERA_TUNING = DeepFreeze({
  Body: {
    Radius      : new Unit(0.3, "cnu"),            // Camera's size; walls and the target keep it this far off
    LagStrength : 1,                               // How tightly the camera keeps up with its target
    RollStrength: 1,                               // How quickly it rolls to the surface
  },       
  Look: { ReturnDelayMs: 500 },                    // Wait after looking before the camera drifts back
  Walls: {       
    ReturnDelayMs : 250,                           // Wait after a wall clears before moving back out
    ZoomStrength  : 1,                             // How sharply it pulls in to a wall
    ReturnStrength: 1,                             // How quickly it moves back out
  },
  Loops: {
    MinCurveThreshold: new Unit(120, "degrees"),   // Least surface curve that counts as loop-like
    Player: {
      EnterCurve: new Unit(45, "degrees"),         // Curve through a loop before it engages
      EnterLean : new Unit(40, "degrees"),         // Lean along the axis that still enters a loop
      ExitLean  : new Unit(60, "degrees"),         // Lean along the axis that still holds a loop
    },
    ExitLeanGrace: 1,                              // Loop radii travelled without progress before a loop ends
    TightFraming : 0.75,                           // Share of a tight loop's height kept in view
    LargeLoopZoom: 1.5,                            // Arm length multiplier in large loops
    SpeedZoom    : 1.25,                           // Arm length multiplier in tight loops at top speed
    CoastGravity : 0.5,                            // Share of gravity while coasting a lock
  },
  Modes: {
    Triggers: {
      FastSpeedFraction: 0.5,                      // Fraction of the character's top speed that counts as fast
      LargeLoopScale   : 10,                       // Loop radius, in character heights, from which a loop is large
    },
    Chase: {
      TrailStrength : 1,                           // How tightly it trails behind the facing
      FollowRampMs  : 1500,                        // From a look or a fresh start to full follow
      MaxNarrowedYaw: new Unit(45, "degrees"),     // Look yaw range off the trail at top speed
      LookResistance: 1,                           // Resistance curve toward the look limits; 1 = even
    },
  },
});

// Toon and comic filter look.
const FILTER_TUNING = DeepFreeze({
  Samples: 4,                                             // Antialiasing samples per pixel while a filter is on
  Lines: {
    Color    : { r: 0.06, g: 0.05, b: 0.08 },             // Ink color
    Width    : 1,                                         // Line thickness in pixels
    Threshold: 0.0015,                                    // How sharp a bend in the surface must be to ink it
  },
  Comic: {
    LightDirection: { x: 0.35, y: 0.85, z: 0.4 },         // World direction toward the light
    Bands         : 3,                                    // Light steps from shadow to fully lit
    ShadowFloor   : 0.75,                                 // Brightness of the darkest band
    Posterize     : {
      Levels  : 8,                                        // Color steps per channel
      Strength: 0.5,                                      // How far colors snap to those steps
    },
    Halftone      : {
      CellSize: 5,                                        // Dot spacing in pixels
      Strength: 0.2,                                      // How dark a full dot gets
      Below   : 0.4,                                      // Brightness under which dots appear
    },
  },
});

// Sprite look.
const SPRITE_TUNING = DeepFreeze({
  FadeStart         : 0.85,                               // Fraction of a sprite's range where its fade begins
  ScreenSizeDistance: new Unit(10, "cnu"),                // Constant-size sprites always look as big as they would from this far
});

// Debug overlay colors per object type.
const DEBUG_COLORS = DeepFreeze({
  BoundingBoxes: {
    Terrain     : { r: 0.95, g: 0.85, b: 0.20, a: 1.00 },
    Scatter     : { r: 0.20, g: 0.80, b: 0.20, a: 1.00 },
    Entity      : { r: 0.20, g: 0.60, b: 1.00, a: 1.00 },
    EntityPart  : { r: 0.45, g: 0.75, b: 1.00, a: 1.00 },
    Obstacle    : { r: 1.00, g: 0.35, b: 0.35, a: 1.00 },
    Void        : { r: 0.35, g: 1.00, b: 0.85, a: 1.00 },
    Player      : { r: 0.90, g: 0.95, b: 1.00, a: 1.00 },
    PlayerPart  : { r: 0.75, g: 0.85, b: 1.00, a: 1.00 },
    Boss        : { r: 0.95, g: 0.20, b: 0.90, a: 1.00 },
    BossPart    : { r: 1.00, g: 0.45, b: 0.95, a: 1.00 },
    Particle    : { r: 0.60, g: 0.40, b: 1.00, a: 1.00 },
    ParticlePart: { r: 0.75, g: 0.60, b: 1.00, a: 1.00 },
  },
  DetailedBounds: {
    Terrain     : { r: 1.00, g: 0.75, b: 0.15, a: 1.00 },
    Obstacle    : { r: 1.00, g: 0.35, b: 0.35, a: 1.00 },
    Entity      : { r: 0.15, g: 0.95, b: 0.95, a: 1.00 },
    Player      : { r: 0.85, g: 0.95, b: 1.00, a: 1.00 },
    Boss        : { r: 1.00, g: 0.35, b: 0.85, a: 1.00 },
    Particle    : { r: 0.60, g: 0.40, b: 1.00, a: 1.00 },
    Void        : { r: 0.35, g: 1.00, b: 0.85, a: 1.00 },
    VoidWall    : { r: 0.20, g: 0.50, b: 1.00, a: 1.00 },
    VoidOpenFace: { r: 1.00, g: 0.20, b: 0.55, a: 1.00 },
  },
  Trails: {
    Player     : { r: 0.00, g: 1.00, b: 1.00, a: 1.00 },
    Boss       : { r: 1.00, g: 0.20, b: 0.90, a: 1.00 },
    Enemies    : { r: 1.00, g: 0.60, b: 0.20, a: 1.00 },
    Collectible: { r: 0.20, g: 1.00, b: 0.40, a: 1.00 },
    Projectile : { r: 1.00, g: 1.00, b: 0.20, a: 1.00 },
    Particle   : { r: 0.70, g: 0.40, b: 1.00, a: 1.00 },
  },
  FlatShading: { r: 0.55, g: 0.55, b: 0.60, a: 1.00 },
});


/* === HANDLERS === */
// Small functions behind config values that need more than a stored value.

let requestedFrameRate = API_CONFIG.Performance.FrameRate;
let refreshRate = null, reportedFrameRate = null;
let unfittedReason = "No refresh rate has been measured yet. FrameRate will be fitted at the first level load.";

// Fits a FrameRate request to refreshRate / n, rounding down unless it's in the top third between two fractions, and never below 30.
function fitFrameRate(requested) {
  if (refreshRate === null || refreshRate === Infinity || requested === Infinity) return requested;

  const divisor = Math.max(1, Math.floor(refreshRate / requested));
  const higher  = refreshRate / divisor;
  const lower   = refreshRate / (divisor + 1);
  return Math.max((requested < lower + (higher - lower) * 2 / 3 ? lower : higher), refreshRate / Math.floor(refreshRate / 30));
}

// Reads back the request fitted to the last measured refresh rate; a write reports what it runs at.
Object.defineProperty(API_CONFIG.Performance, "FrameRate", {
  get: () => fitFrameRate(requestedFrameRate),
  set(value) {
    requestedFrameRate = value;
    const fitted = fitFrameRate(value);
    if (refreshRate === null || refreshRate === Infinity) Log("ENGINE", unfittedReason, "log", "Render");
    else if (fitted === reportedFrameRate) {
      Log("ENGINE", `FrameRate stays at ${fitted} on the ${refreshRate}Hz refresh rate.`, "log", "Render");
    }
    else if (fitted !== value) {
      Log("ENGINE", `FrameRate ${value} set to ${fitted} to fit the ${refreshRate}Hz refresh rate.`, "warn", "Render");
    }
    else Log("ENGINE", `FrameRate set to ${fitted}.`, "log", "Render");
    reportedFrameRate = fitted;
  },
  enumerable: true,
});

// Written by each level-start measurement: Infinity when the frame limiter is off, null without a steady reading.
Object.defineProperty(API_CONFIG.Performance, "RefreshRate", {
  get: () => refreshRate,
  set(value) {
    refreshRate = value;
    if (value === null) unfittedReason = "The refresh rate couldn't be measured; FrameRate runs as set.";
    if (value === Infinity) {
      unfittedReason = "Browser frame limiter is off; FrameRate runs as set.";
      Log("ENGINE", unfittedReason, "log", "Render");
    }

    // Reports when the new measurement changes the FrameRate in use.
    const fitted = fitFrameRate(requestedFrameRate);
    const fitText = value === null || value === Infinity
      ? "with no refresh rate to fit to"
      : `to fit the measured ${value}Hz refresh rate`;
    if (fitted !== reportedFrameRate) Log("ENGINE", `FrameRate is now ${fitted} ${fitText}.`, "log", "Render");
    reportedFrameRate = fitted;
  },
  enumerable: true,
});

/* === EXPORTS === */
// Public configuration surface for engine modules.

export { 
  API_CONFIG as CONFIG, 
  PERFORMANCE_SCALING, 
  GROUNDING, 
  MOVEMENT_TUNING, 
  CAMERA_TUNING,
  FILTER_TUNING,
  SPRITE_TUNING,
  DEBUG_COLORS,
  SKY_STOP_LIMIT,
  CARVE_GRID_TRIANGLES_PER_CELL 
};
