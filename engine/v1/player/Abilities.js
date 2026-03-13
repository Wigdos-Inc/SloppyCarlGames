// Player ability manager. It tracks:
// - Ability activation conditions.
// - Ability flags.
// - Ability effects on playerState.

// Used by player/Master.js to process ability state each frame.

import { Log } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { ToNumber } from "../math/Utilities.js";