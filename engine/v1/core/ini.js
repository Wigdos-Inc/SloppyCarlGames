// Initializes the Engine. Engages Startup Sequence and Preps relevant Engines Modules to become usable to the game.

// Prepares Modules for the game, which can then insert UI elements into handlers/UI.js


/* === IMPORTS === */
// Core diagnostics and logging support.

import {
  Log,
  LogAll,
  LogCache,
  IsPointerLocked,
  RequestPointerLock,
  SendEvent,
  Wait,
  Cache,
  Cursor,
  ExitGame,
  PushToSession,
  ReadFromSession,
  SESSION_KEYS,
} from "./meta.js";
import { CONFIG } from "./config.js";
import { ApplyMenuUI, LoadScreen, ClearUI } from "../handlers/UI.js";
import { Controls, StartInputRouter } from "../handlers/Controls.js";
import {
  PlaySfx,
  PlayVoice,
  PlayMusic,
  PauseMusic,
  ResumeMusic,
  StopMusic,
  StopSfx,
  StopAllAudio,
  UpdateActiveAudioVolumes,
} from "../handlers/Sound.js";
import {
  CreateLevel,
  Update as UpdateLevel,
  GetActiveLevel,
} from "../handlers/game/Level.js";
import { PlayEngineCutscene, PlayRenderedCutscene } from "../handlers/Cutscene.js";
import { ProvideSplashScreenPayload } from "../handlers/menu/Splash.js";
import { GetPlayerInput, GetPlayerState } from "../player/Master.js";
import { DegreesToRadians, RadiansToDegrees, CNUtoWorldUnit, WorldUnitToCNU, Unit, UnitVector3 } from "../math/Utilities.js"

/* === INITIALIZATION === */
// Bootstraps engine subsystems and returns the public API.

function Initialize() {
  // Log startup checkpoints.
  Log("ENGINE", "Initializing Engine Core.", "log", "Startup");
  Log("ENGINE", "Initializing Diagnostics.", "log", "Startup");
  Log("ENGINE", "Initializing Logging System.", "log", "Startup");
  Log("ENGINE", "Initializing Event System.", "log", "Startup");
  Log("ENGINE", "Initializing Background Processes.", "log", "Startup");
  
  // Start global input routing.
  const inputRouter = StartInputRouter();

  // Expose the engine public API surface.
  return {
    Log: Log,
    Config: CONFIG,
    Cache: Cache,
    Meta: {
      LogAll: LogAll,
      LogCache: LogCache,
      Cursor: Cursor,
      ExitGame: ExitGame,
      SendEvent: SendEvent,
      Wait: Wait,
      IsPointerLocked: IsPointerLocked,
      RequestPointerLock: RequestPointerLock,
      PushToSession: PushToSession,
      ReadFromSession: ReadFromSession,
      SessionKey: SESSION_KEYS,
    },
    Controls: Controls,
    Input: {
      Router: inputRouter,
      StartInputRouter: StartInputRouter,
    },
    Cutscene: {
      PlayEngineCutscene: PlayEngineCutscene,
      PlayRenderedCutscene: PlayRenderedCutscene,
    },
    Startup: {
      ProvideSplashScreenPayload: ProvideSplashScreenPayload,
    },
    UI: {
      ApplyMenuUI: ApplyMenuUI,
      LoadScreen: LoadScreen,
      ClearUI: ClearUI,
    },
    Audio: {
      PlaySfx: PlaySfx,
	    PlayVoice: PlayVoice,
      PlayMusic: PlayMusic,
      PauseMusic: PauseMusic,
      ResumeMusic: ResumeMusic,
      StopMusic: StopMusic,
      StopSfx: StopSfx,
      StopAllAudio: StopAllAudio,
      UpdateActiveAudioVolumes: UpdateActiveAudioVolumes,
    },
    Level: {
      CreateLevel: CreateLevel,
      Update: UpdateLevel,
      GetActiveLevel: GetActiveLevel,
    },
    Player: {
      Input: GetPlayerInput(),
      GetState: GetPlayerState,
    },
    Math: {
      Convert: {
        DegreesToRadians: DegreesToRadians,
        RadiansToDegrees: RadiansToDegrees,
        CNUtoWorldUnit: CNUtoWorldUnit,
        WorldUnitToCNU: WorldUnitToCNU,
      },
      Instancing: {
        Unit: Unit,
        UnitVector3: UnitVector3,
      },
    },
  };
}

/* === EXPORTS === */
// Public initializer for Bootup.

export { Initialize };