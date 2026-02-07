// Initializes the Engine. Engages Startup Sequence and Preps relevant Engines Modules to become usable to the game.

// Prepares Modules for the game, which can then insert UI elements into handlers/UI.js


/* === IMPORTS === */
// Core diagnostics and logging support.

import { log, logAll, initMeta, sendEvent } from "./meta.js";
import { ApplyMenuUI, LoadScreen } from "../handlers/UI.js";
import {
  PlaySfx,
  PlayVoice,
  PlayMusic,
  PauseMusic,
  ResumeMusic,
  StopMusic,
  StopSfx,
  StopAllAudio,
} from "../handlers/Sound.js";

/* === INITIALIZATION === */
// Bootstraps engine subsystems and returns the public API.

function initialize() {
  log("ENGINE", "Initializing Engine Core.", "log", "Startup");
  log("ENGINE", "Initializing Diagnostics.", "log", "Startup");
  log("ENGINE", "Initializing Logging System.", "log", "Startup");
  log("ENGINE", "Initializing Event System.", "log", "Startup");
  

  return {
    Log: log,
    Meta: {
      LogAll: logAll,
      SendEvent: sendEvent,
    },
    UI: {
      ApplyMenuUI: ApplyMenuUI,
      LoadScreen: LoadScreen,
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
    },
  };
}

/* === EXPORTS === */
// Public initializer for Bootup.

export { initialize };