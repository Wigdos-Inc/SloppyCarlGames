// Sends Complete Level Data to Engine to build level.

import { ENGINE } from "../../Bootup.js";

let levelsDataPromise = null;

function loadLevelsData() {
	if (!levelsDataPromise) {
		levelsDataPromise = fetch(new URL("./levels.json", import.meta.url))
			.then((response) => response.json())
			.catch(() => null);
	}

	return levelsDataPromise;
}

function resolveLevelCollection(levelsData) {
	if (!levelsData || typeof levelsData !== "object") {
		return [];
	}

	if (Array.isArray(levelsData.levels)) {
		return levelsData.levels;
	}

	return Object.values(levelsData).filter((entry) => entry && typeof entry === "object");
}

function resolveRequestedLevel(levelsData, request) {
	const levels = resolveLevelCollection(levelsData);
	if (!levels.length) {
		return null;
	}

	if (request && request.levelId) {
		const byId = levels.find((level) => level && level.id === request.levelId);
		if (byId) {
			return byId;
		}
	}

	if (request && typeof request.levelIndex === "number") {
		return levels[request.levelIndex] || null;
	}

	return levels[0] || null;
}

function resolveStage(level, request) {
	if (!level || !Array.isArray(level.stages) || level.stages.length === 0) {
		return null;
	}

	if (request && request.stageId) {
		const byId = level.stages.find((stage) => stage && stage.id === request.stageId);
		if (byId) {
			return byId;
		}
	}

	if (request && typeof request.stageIndex === "number") {
		return level.stages[request.stageIndex] || null;
	}

	return level.stages[0] || null;
}

function buildCreateLevelPayload(level, stage) {
	if (!level || !stage) {
		return null;
	}

	return {
		id: stage.id || `${level.id || "level"}-stage0`,
		title: stage.title || level.title || "Untitled Stage",
		world: stage.world || {},
		terrain: stage.terrain || { objects: [] },
		entities: Array.isArray(stage.entities) ? stage.entities : [],
		camera: stage.camera || {},
		music: stage.music || level.music || null,
		meta: {
			levelId: level.id || null,
			stageId: stage.id || null,
		},
	};
}

async function RequestLevelCreate(request, options) {
	const levelsData = await loadLevelsData();
	if (!levelsData) {
		if (ENGINE && typeof ENGINE.Log === "function") {
			ENGINE.Log("GAME", "Failed to load levels.json.", "warn", "Level");
		}
		return null;
	}

	const level = resolveRequestedLevel(levelsData, request || null);
	if (!level) {
		if (ENGINE && typeof ENGINE.Log === "function") {
			ENGINE.Log("GAME", "Requested level not found in levels.json.", "warn", "Level");
		}
		return null;
	}

	const stage = resolveStage(level, request || null);
	if (!stage) {
		if (ENGINE && typeof ENGINE.Log === "function") {
			ENGINE.Log("GAME", "Requested stage not found in levels.json.", "warn", "Level");
		}
		return null;
	}

	const payload = buildCreateLevelPayload(level, stage);
	if (!payload) {
		return null;
	}

	if (payload.music && payload.music.src) {
		payload.music = {
			...payload.music,
			src: new URL(payload.music.src, import.meta.url).href,
		};
	}

	if (ENGINE && ENGINE.UI && typeof ENGINE.UI.ClearUI === "function") {
		ENGINE.UI.ClearUI("engine-ui-root");
	}

	if (ENGINE && ENGINE.Audio && typeof ENGINE.Audio.StopMusic === "function") {
		ENGINE.Audio.StopMusic();
	}

	if (ENGINE && ENGINE.Level && typeof ENGINE.Level.CreateLevel === "function") {
		const sceneGraph = ENGINE.Level.CreateLevel(payload, {
			source: "testGame",
			renderOptions: {
				rootId: "engine-level-root",
			},
			...(options && typeof options === "object" ? options : {}),
		});

		if (
			sceneGraph &&
			payload.music &&
			typeof payload.music === "object" &&
			payload.music.src &&
			ENGINE.Audio &&
			typeof ENGINE.Audio.PlayMusic === "function"
		) {
			const trackName = payload.music.name || `LEVEL_${payload.id || "TRACK"}`;
			ENGINE.Audio.PlayMusic(trackName, payload.music.src, payload.music);
		}
	}

	return payload;
}

export { RequestLevelCreate };