// Initializes the Engine. Engages Startup Sequence and Preps relevant Engines Modules to become usable to the game.

// Prepares Modules for the game, which can then insert UI elements into handlers/UI.js


/* === IMPORTS === */
// Core diagnostics and logging support.

import {
  Log,
  logAll,
  LogCache,
  IsPointerLocked,
  RequestPointerLock,
  sendEvent,
  Wait,
  Cache,
  Cursor,
  ExitGame,
  pushToSession,
  readFromSession,
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
  LoadLevel,
} from "../handlers/game/Level.js";

/* === INITIALIZATION === */
// Bootstraps engine subsystems and returns the public API.

function initialize() {
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
      LogAll: logAll,
      LogCache: LogCache,
      Cursor: Cursor,
      ExitGame: ExitGame,
      SendEvent: sendEvent,
      Wait: Wait,
      IsPointerLocked: IsPointerLocked,
      RequestPointerLock: RequestPointerLock,
      PushToSession: pushToSession,
      ReadFromSession: readFromSession,
      SessionKey: SESSION_KEYS,
    },
    Controls: Controls,
    Input: {
      Router: inputRouter,
      StartInputRouter: StartInputRouter,
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
      LoadLevel: LoadLevel,
      Update: UpdateLevel,
      GetActiveLevel: GetActiveLevel,
    },
  };
}

/* === EXPORTS === */
// Public initializer for Bootup.

export { initialize };