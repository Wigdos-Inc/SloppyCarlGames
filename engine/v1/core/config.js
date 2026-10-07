import { Unit } from "../math/Utilities.js";
import { DeepFreeze, ReadFromSession } from "./meta.js";

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
      Triggers: true,                        // Render Trigger Meshes
      FreeCam : false,                       // Free Camera Mode
      BoundingBox: {                         // Render Bounding Boxes
        Terrain     : false,
        Scatter     : false,
        Entity      : false,
        EntityPart  : false,
        Obstacle    : false,
        Void        : false,
        Player      : true,
        PlayerPart  : false,
        Boss        : false,
        BossPart    : false,
        Particle    : false,
        ParticlePart: false,
        Grid        : {                      // Render Debug Grid
          Visible: false,
          Size   : new Unit(1, "cnu"),
        }
      },
      DetailedBounds: {                      // Render Detailed Bounds
        Terrain : false,
        Obstacle: false,
        Void    : false,                     // Void volume + its void walls and open faces
        Entity  : false,
        Player  : true,
        Boss    : false,
        Particle: false,
      },
      Trails: {                              // Render Movement Trails
        Player     : true,
        Boss       : false,
        Enemies    : false,
        Collectible: false,
        Projectile : false,
        Particle   : false,
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
        Level: true,
        Render: true,
        Simulator: true,
        Validation: true,
        Meta: true,
        Player: true,
        Events: true,
        Debug: true,
      },
    },
  },
  Volume: {
    Master  : settings?.master ?? 0.5,
    Music   : settings?.music ?? 1,
    Voice   : settings?.voice ?? 1,
    MenuSfx : settings?.menuSfx ?? 1,
    GameSfx : settings?.gameSfx ?? 1,
    Cutscene: settings?.cutscene ?? 1
  },
  Performance: {
    Scatter        : { Density: "High", Quality: "High" },     // Amount of scatter, and how expensive the shapes are.
    Particles      : "High",                                   // The amount of particles generators emit.
    SimDistance    : "High",                                   // Umbrella definition for both rendering and simulation distance.
    Animations     : "High",                                   // Smoothness of animations.
    FrameRate      : 60,                                       // FPS for simulation and rendering.
    Resolution     : 100,                                      // Visual crispness.
    BackfaceCulling: true,                                     // Cull back faces
  },
  Physics: {
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
      Enabled             : true,
      FlatSnapDegrees     : 5,
      ReferenceReleaseRate: 4,
      MaxAngleDelta       : {
        Air  : { Ground: 35, Sliding: 75, Recover: 20 },
        Water: { Ground: 45, Sliding: 85, Recover: 45 },
      },
      MinGripSpeed        : { Air: 0.8, Water: 0.8 },     // Share of maxSpeed needed to grip upside down; eases to 0 at Ground
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
    Fov: 60,
    Sensitivity: { Mouse: 40, Keyboard: 50 },
    ZoomStep: new Unit(0.5, "cnu"),          // Arm length change per wheel notch
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
      ToonLines: true,                           // Ink lines on edges and creases
      Comic    : true,                           // Light bands, fewer colors and halftone dots
    }
  }
};

// Max authorable skybox gradient stops.
const SKY_STOP_LIMIT = 10;

// Performance-related scaling.
const PERFORMANCE_SCALING = DeepFreeze({
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
});

// Footing feel: jump windows, contact grace, grip ramp.
const GROUNDING = DeepFreeze({
  JumpBufferMs  : 120,    // Early press held until landing
  CoyoteMs      : 100,    // Late press honoured after leaving the ground
  ContactGraceMs: 50,     // Surface pose held after a missed probe
  GripRampMs    : 2000,   // Grip demand's crossing of 0 ↔ MinGripSpeed
});

// Movement feel: friction floor, slide damping, reversal braking.
const MOVEMENT_TUNING = DeepFreeze({
  MinSupport        : 0.25,                         // Friction floor; engages past 75.5°
  SlideUphillScale  : 0.15,                         // Acceleration kept pressing uphill on a slide
  ReversalBrakeScale: 0.75,                         // Share of acceleration added to braking on a reversal
  OppositeInput     : { Forward: 0.25, Left: 0.2, Right: 0.25 },  // Input past which a reversal counts as held
});

// Default camera feel.
const CAMERA_TUNING = DeepFreeze({
  Body: {
    Radius      : new Unit(0.3, "cnu"),     // Camera's size; walls and the target keep it this far off
    LagStrength : 1,                        // How tightly the camera keeps up with its target
    RollStrength: 1,                        // How quickly it rolls to the surface
  },
  Look: { ReturnDelayMs: 500 },             // Wait after looking before the camera drifts back
  Walls: {
    ReturnDelayMs : 250,                    // Wait after a wall clears before moving back out
    ZoomStrength  : 1,                      // How sharply it pulls in to a wall
    ReturnStrength: 1,                      // How quickly it moves back out
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
    Orbit: { SideSwingSpeed: new Unit(120, "degrees") },  // Degrees per second orbitCam swings to a loop's side
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

/* === EXPORTS === */
// Public configuration surface for engine modules.

export { API_CONFIG as CONFIG, PERFORMANCE_SCALING, GROUNDING, MOVEMENT_TUNING, CAMERA_TUNING, FILTER_TUNING, SKY_STOP_LIMIT };