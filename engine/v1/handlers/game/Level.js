// General Level Initialiser and state handler

// Receives level data from game, validated by core/validate.js
// Creates level world or boss arena using builder/NewLevel.js
// Builds enemies and collectibles using builder/NewEntity.js
// End of player pipeline(s) to determine position.
// Uses Render.js for rendering level state per frame.

/* === IMPORTS === */
// Logging, cache, and level builders.

import { Log, Cache } from "../../core/meta.js";
import { BuildLevel } from "../../builder/NewLevel.js";
import { RenderLevel, RemoveRoot } from "../Render.js";
import { StopAllAudio, PlayMusic } from "../Sound.js";

/* === STATE === */
// Stored level state for the active session.

let currentLevelState = null;

/* === PIPELINE === */
// Entry points for the level workflow.

function LoadLevel(levelPayload, options) {
	if (!levelPayload || typeof levelPayload !== "object") {
		Log("ENGINE", "Level payload missing or invalid.", "warn", "Level");
		return null;
	}

	Cache.Level.lastPayload = levelPayload;
	StopAllAudio();
	if (levelPayload.music && levelPayload.music.name && levelPayload.music.src) {
		PlayMusic(levelPayload.music.name, levelPayload.music.src, levelPayload.music);
	}
	const builtLevel = BuildLevel(levelPayload, options);

	currentLevelState = {
		id: builtLevel.id,
		payload: levelPayload,
		world: builtLevel,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};

	RemoveRoot("engine-ui-root");

	if (!options || options.render !== false) {
		RenderLevel(currentLevelState, options && options.renderOptions ? options.renderOptions : null);
	}

	Log("ENGINE", `Loaded level ${builtLevel.id}.`, "log", "Level");
	return currentLevelState;
}

function GetLevelState() {
	return currentLevelState;
}

function UpdateLevelState(patch) {
	if (!currentLevelState || !patch || typeof patch !== "object") {
		return currentLevelState;
	}

	currentLevelState = {
		...currentLevelState,
		...patch,
		updatedAt: Date.now(),
	};

	return currentLevelState;
}

function ClearLevel() {
	currentLevelState = null;
	Cache.Level.lastPayload = null;
	Cache.Level.lastBuild = null;
	Log("ENGINE", "Cleared level state.", "log", "Level");
}

/* === EXPORTS === */
// Public level workflow surface.

export { LoadLevel, GetLevelState, UpdateLevelState, ClearLevel };