// Initializes the Engine. Engages Startup Sequence and Preps relevant Engines Modules to become usable to the game.

// Prepares Modules for the game, which can then insert UI elements into handlers/UI.js


/* === IMPORTS === */
// Core diagnostics and logging support.

// Engine API function imports.
import { Log, LogAll, LogCache, IsPointerLocked, RequestPointerLock, SendEvent, Wait, Cache, Cursor, ExitGame, PushToSession, ReadFromSession, SESSION_KEYS as SessionKey, ReleasePointerLock, DeepFreeze } from "./meta.js";
import { CONFIG as Config } from "./config.js";
import { ApplyMenuUI, LoadScreen, ClearUI, ConvertHTML } from "../handlers/UI.js";
import { Controls, StartInputRouter } from "../handlers/Controls.js";
import { PlayAudio, PlayMusic, PauseMusic, ResumeMusic, StopMusic, StopSfx, StopAllAudio, UpdateActiveAudioVolumes } from "../handlers/Sound.js";
import { CreateLevel, ClearLevel, Update as UpdateLevel, GetActiveLevel, PauseLevelLoop as PauseLevel, ResumeLevelLoop as ResumeLevel, SpawnParticles } from "../handlers/game/Level.js";
import { Start, Load, Cache as SimulatorCache, Clear, Exit, Download, GetModelState, GetFullState } from "../handlers/game/Simulator.js";
import { PlayEngineCutscene, PlayRenderedCutscene } from "../handlers/Cutscene.js";
import { ProvideSplashScreenPayload } from "../handlers/menu/Splash.js";
import { PlayerAPI as Player } from "../player/Master.js";
import { DegreesToRadians, RadiansToDegrees, CNUtoWorldUnit, WorldUnitToCNU, Unit, UnitVector3, CNU_SCALE, Clamp, Clamp01, Squared as Sq } from "../math/Utilities.js"
import { AddVector3, DivideVector3, DotVector3, MultiplyVector3, ScaleVector3 } from "../math/Vector3.js";
import { ComputeGravity, ComputeResistance, ComputeBuoyancy, ComputeStepVelocity, ComputeSubmergence } from "../math/Forces.js";

// Boot-time engine template instancing (owns the blueprint/template JSON imports).
import { InstanceEngineTemplates } from "../builder/templates/Instance.js";
import { GetCameraPosition } from "../camera/Master.js";
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

  // Create, freeze and expose the engine public API surface.
  return DeepFreeze({
    Log,
    Config,
    Cache,
    Meta: {
      LogAll, LogCache, ExitGame, SendEvent, Wait, IsPointerLocked, RequestPointerLock, PushToSession, ReadFromSession,
      SessionKey, CNU_SCALE, DeepFreeze,
      Version: "0.34.2",
    },
    Controls,
    Input   : Object.freeze({ Router, StartInputRouter, IsPointerLocked, RequestPointerLock, ReleasePointerLock, Cursor, }),
    Cutscene: { PlayEngineCutscene, PlayRenderedCutscene },
    Startup : { ProvideSplashScreenPayload },
    UI      : { ApplyMenuUI, LoadScreen, ClearUI, ConvertHTML },
    Audio   : { PlayAudio, PlayMusic, PauseMusic, ResumeMusic, StopMusic, StopSfx, StopAllAudio, UpdateActiveAudioVolumes },
    Level   : { CreateLevel, ClearLevel, UpdateLevel, GetActiveLevel, PauseLevel, ResumeLevel, SpawnParticles, Player, GetCameraPosition },
    Math    : {
      Convert   : { DegreesToRadians, RadiansToDegrees, CNUtoWorldUnit, WorldUnitToCNU },
      Vector3   : { AddVector3, DivideVector3, MultiplyVector3, ScaleVector3, DotVector3 },
      Instancing: { Unit, UnitVector3 },
      Physics   : { ComputeGravity, ComputeResistance, ComputeBuoyancy, ComputeStepVelocity, ComputeSubmergence },
      Other     : { Clamp, Clamp01, Sq }
    },
    Simulator : { Start, Load, Cache: SimulatorCache, Clear, Exit, Download, GetModelState, GetFullState },
    Blueprints: InstanceEngineTemplates().raw,
  }, ["Config", "Cache", "Input", "Startup"]);
}

/* === EXPORTS === */
// Public initializer for Bootup.

export { Initialize };