// Initializes the Engine. Engages Startup Sequence and Preps relevant Engines Modules to become usable to the game.

// Prepares Modules for the game, which can then insert UI elements into handlers/UI.js


/* === IMPORTS === */
// Core diagnostics and logging support.

import { Log, LogAll, LogCache, IsPointerLocked, RequestPointerLock, SendEvent, Wait, Cache, Cursor, ExitGame, PushToSession, ReadFromSession, SESSION_KEYS as SessionKey, ReleasePointerLock, VERSION } from "./meta.js";
import { CONFIG } from "./config.js";
import { ApplyMenuUI, LoadScreen, ClearUI } from "../handlers/UI.js";
import { Controls, StartInputRouter } from "../handlers/Controls.js";
import { PlayAudio, PlayMusic, PauseMusic, ResumeMusic, StopMusic, StopSfx, StopAllAudio, UpdateActiveAudioVolumes } from "../handlers/Sound.js";
import { CreateLevel, ClearLevel, Update as UpdateLevel, GetActiveLevel, PauseLevelLoop as PauseLevel, ResumeLevelLoop as ResumeLevel } from "../handlers/game/Level.js";
import { Start, Load, Cache as SimulatorCache, Clear, Exit, GetModelState, GetFullState } from "../handlers/game/Simulator.js";
import { PlayEngineCutscene, PlayRenderedCutscene } from "../handlers/Cutscene.js";
import { ProvideSplashScreenPayload } from "../handlers/menu/Splash.js";
import { PlayerAPI as Player } from "../player/Master.js";
import { DegreesToRadians, RadiansToDegrees, CNUtoWorldUnit, WorldUnitToCNU, Unit, UnitVector3, CNU_SCALE, Clamp, Clamp01 } from "../math/Utilities.js"
import { AddVector3, DivideVector3, DotVector3, MultiplyVector3, ScaleVector3 } from "../math/Vector3.js";
import { ComputeGravity, ComputeResistance, ComputeBuoyancy, ComputeStepVelocity, ComputeSubmergence } from "../math/Forces.js";

/* === INITIALIZATION === */
// Bootstraps engine subsystems and returns the public API.

function Initialize() {
  // Log startup checkpoints.
  Log("ENGINE", "Initializing Engine Core.", "log", "Startup");
  Log("ENGINE", "Initializing Diagnostics.", "log", "Startup");
  Log("ENGINE", "Initializing Logging System.", "log", "Startup");
  Log("ENGINE", "Initializing Event System.", "log", "Startup");
  Log("ENGINE", "Initializing Background Processes.", "log", "Startup");
  Log("ENGINE", "Initializing ENGINE API.", "log", "Startup");
  
  // Start global input routing.
  const Router = StartInputRouter();

  // Expose the engine public API surface.
  return {
    Log,
    CONFIG,
    Cache,
    Meta: {
      LogAll, LogCache, ExitGame, SendEvent, Wait, IsPointerLocked, RequestPointerLock, PushToSession, ReadFromSession,
      SessionKey, CNU_SCALE, VERSION,
    },
    Controls,
    Input: { Router, StartInputRouter, IsPointerLocked, RequestPointerLock, ReleasePointerLock, Cursor, },
    Cutscene: { PlayEngineCutscene, PlayRenderedCutscene },
    Startup: { ProvideSplashScreenPayload },
    UI: { ApplyMenuUI, LoadScreen, ClearUI },
    Audio: { PlayAudio, PlayMusic, PauseMusic, ResumeMusic, StopMusic, StopSfx, StopAllAudio, UpdateActiveAudioVolumes },
    Level: { CreateLevel, ClearLevel, UpdateLevel, GetActiveLevel, PauseLevel, ResumeLevel, Player },
    Math: {
      Convert   : { DegreesToRadians, RadiansToDegrees, CNUtoWorldUnit, WorldUnitToCNU },
      Vector3   : { AddVector3, DivideVector3, MultiplyVector3, ScaleVector3, DotVector3 },
      Instancing: { Unit, UnitVector3 },
      Physics   : { ComputeGravity, ComputeResistance, ComputeBuoyancy, ComputeStepVelocity, ComputeSubmergence },
      Other     : { Clamp, Clamp01 }
    },
    Simulator: { Start, Load, Cache: SimulatorCache, Clear, Exit, GetModelState, GetFullState }
  };
}

/* === EXPORTS === */
// Public initializer for Bootup.

export { Initialize };