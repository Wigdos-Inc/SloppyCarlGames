// Sends Complete Level Data to Engine to build level.

import { ENGINE } from "../../Bootup.js";

let levelsDataPromise = null;
let entitiesDataPromise = null;

function loadLevelsData() {
	if (!levelsDataPromise) {
		levelsDataPromise = fetch(new URL("./levels.json", import.meta.url))
			.then((response) => response.json())
			.catch(() => null);
	}

	return levelsDataPromise;
}

function loadEntitiesData() {
	if (!entitiesDataPromise) {
		entitiesDataPromise = fetch(new URL("./entities.json", import.meta.url))
			.then((response) => response.json())
			.catch(() => null);
	}

	return entitiesDataPromise;
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

function buildCreateLevelPayload(level, stage, entitiesData) {
	if (!level || !stage) {
		return null;
	}

	const mergedBlueprints = entitiesData && typeof entitiesData === "object"
		? entitiesData
		: {
			enemies: [],
			npcs: [],
			collectibles: [],
			projectiles: [],
		};

	return {
		id: stage.id || `${level.id || "level"}-stage0`,
		title: stage.title || level.title || "Untitled Stage",
		world: stage.world || {},
		terrain: stage.terrain || { objects: [] },
		obstacles: Array.isArray(stage.obstacles) ? stage.obstacles : [],
		entities: Array.isArray(stage.entities) ? stage.entities : [],
		entityBlueprints: mergedBlueprints,
		camera: stage.camera || {},
		music: stage.music || level.music || null,
		meta: {
			levelId: level.id || null,
			stageId: stage.id || null,
		},
	};
}

function buildBlueprintCounts(blueprints) {
	const source = blueprints && typeof blueprints === "object" ? blueprints : {};
	const count = (key) => (Array.isArray(source[key]) ? source[key].length : 0);
	return {
		enemies: count("enemies"),
		npcs: count("npcs"),
		collectibles: count("collectibles"),
		projectiles: count("projectiles"),
	};
}

async function RequestLevelCreate(request, options) {
	const [levelsData, entitiesData] = await Promise.all([loadLevelsData(), loadEntitiesData()]);
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

	const payload = buildCreateLevelPayload(level, stage, entitiesData);
	if (!payload) {
		return null;
	}

	if (ENGINE && typeof ENGINE.Log === "function") {
		const blueprintCounts = buildBlueprintCounts(payload.entityBlueprints);
		ENGINE.Log(
			"GAME",
			[
				"Sending level payload to engine:",
				`- levelId: ${payload.meta.levelId || "unknown"}`,
				`- stageId: ${payload.meta.stageId || "unknown"}`,
				`- terrainObjects: ${Array.isArray(payload.terrain && payload.terrain.objects) ? payload.terrain.objects.length : 0}`,
				`- obstacles: ${Array.isArray(payload.obstacles) ? payload.obstacles.length : 0}`,
				`- entities(overrides): ${Array.isArray(payload.entities) ? payload.entities.length : 0}`,
			].join("\n"),
			"log",
			"Level"
		);

		ENGINE.Log(
			"GAME",
			[
				"Sending separate entity blueprint payload:",
				`- enemies: ${blueprintCounts.enemies}`,
				`- npcs: ${blueprintCounts.npcs}`,
				`- collectibles: ${blueprintCounts.collectibles}`,
				`- projectiles: ${blueprintCounts.projectiles}`,
			].join("\n"),
			"log",
			"Level"
		);
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
		const sceneGraph = await ENGINE.Level.CreateLevel(payload, {
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