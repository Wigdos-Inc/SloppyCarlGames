import { ENGINE } from "../../Bootup.js";

const decoupledCNU = false;

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

function divideScalar(value, cnuScale) {
	return value / cnuScale;
}

function divideVector3(vector, cnuScale) {
	return {
		x: divideScalar(vector.x, cnuScale),
		y: divideScalar(vector.y, cnuScale),
		z: divideScalar(vector.z, cnuScale),
	};
}

function preprocessPart(part, cnuScale) {
	const nextPart = structuredClone(part);
	nextPart.dimensions = divideVector3(nextPart.dimensions, cnuScale);
	nextPart.localPosition = divideVector3(nextPart.localPosition, cnuScale);
	nextPart.pivot = divideVector3(nextPart.pivot, cnuScale);
	return nextPart;
}

function preprocessLevelObject(levelObject, cnuScale) {
	const nextObject = structuredClone(levelObject);
	nextObject.dimensions = divideVector3(nextObject.dimensions, cnuScale);
	nextObject.position = divideVector3(nextObject.position, cnuScale);
	nextObject.pivot = divideVector3(nextObject.pivot, cnuScale);
	nextObject.parts = Array.isArray(nextObject.parts)
		? nextObject.parts.map((part) => preprocessPart(part, cnuScale))
		: [];
	return nextObject;
}

function preprocessWorld(world, cnuScale) {
	const nextWorld = structuredClone(world);
	nextWorld.length = divideScalar(nextWorld.length, cnuScale);
	nextWorld.width = divideScalar(nextWorld.width, cnuScale);
	nextWorld.height = divideScalar(nextWorld.height, cnuScale);
	nextWorld.deathBarrierY = divideScalar(nextWorld.deathBarrierY, cnuScale);
	if (typeof nextWorld.waterLevel === "number") nextWorld.waterLevel = divideScalar(nextWorld.waterLevel, cnuScale);
	return nextWorld;
}

function preprocessPlayer(player, cnuScale) {
	const nextPlayer = structuredClone(player);
	nextPlayer.spawnPosition = divideVector3(nextPlayer.spawnPosition, cnuScale);
	return nextPlayer;
}

function preprocessTerrain(terrain, cnuScale) {
	const nextTerrain = structuredClone(terrain);
	nextTerrain.objects = Array.isArray(nextTerrain.objects)
		? nextTerrain.objects.map((entry) => preprocessLevelObject(entry, cnuScale))
		: [];
	nextTerrain.triggers = Array.isArray(nextTerrain.triggers)
		? nextTerrain.triggers.map((trigger) => ({
			...structuredClone(trigger),
			start: divideVector3(trigger.start, cnuScale),
			end: divideVector3(trigger.end, cnuScale),
		}))
		: [];
	return nextTerrain;
}

function preprocessStage(stage, cnuScale) {
	const nextStage = structuredClone(stage);
	nextStage.world = preprocessWorld(nextStage.world, cnuScale);
	nextStage.player = preprocessPlayer(nextStage.player, cnuScale);
	nextStage.terrain = preprocessTerrain(nextStage.terrain, cnuScale);
	nextStage.obstacles = Array.isArray(nextStage.obstacles)
		? nextStage.obstacles.map((entry) => preprocessLevelObject(entry, cnuScale))
		: [];
	return nextStage;
}

function buildCreateLevelPayload(level, stage, entitiesData, cnuScale) {
	const mergedBlueprints = entitiesData && typeof entitiesData === "object"
		? entitiesData
		: {
			enemies: [],
			npcs: [],
			collectibles: [],
			projectiles: [],
		};
	const processedStage = preprocessStage(stage, cnuScale);

	return {
		id: processedStage.id || `${level.id || "level"}-stage0`,
		title: processedStage.title || level.title || "Untitled Stage",
		world: processedStage.world || {},
		terrain: processedStage.terrain || { objects: [] },
		obstacles: Array.isArray(processedStage.obstacles) ? processedStage.obstacles : [],
		entities: Array.isArray(processedStage.entities) ? processedStage.entities : [],
		entityBlueprints: mergedBlueprints,
		camera: processedStage.camera || {},
		player: processedStage.player || null,
		music: processedStage.music || level.music || null,
		meta: {
			levelId: level.id || null,
			stageId: processedStage.id || null,
		},
	};
}

function logPayloadSummary(payload, cnuScale) {
	ENGINE.Log(
		"GAME",
		[
			"Sending scale tester payload to engine:",
			`- levelId: ${payload.meta.levelId || "unknown"}`,
			`- stageId: ${payload.meta.stageId || "unknown"}`,
			`- cnuScale: ${cnuScale}`,
			`- terrainObjects: ${Array.isArray(payload.terrain && payload.terrain.objects) ? payload.terrain.objects.length : 0}`,
			`- obstacles: ${Array.isArray(payload.obstacles) ? payload.obstacles.length : 0}`,
		].join("\n"),
		"log",
		"Level"
	);
}

async function RequestLvl1Stage2Create(request, options) {
	const [levelsData, entitiesData] = await Promise.all([loadLevelsData(), loadEntitiesData()]);
	if (!levelsData) {
		ENGINE.Log("GAME", "Failed to load levels.json for scale tester.", "warn", "Level");
		return null;
	}

	const resolvedRequest = request || { levelIndex: 0, stageIndex: 1 };
	const levelCollection = Array.isArray(levelsData.levels) ? levelsData.levels : [];
	const level = levelCollection[resolvedRequest.levelIndex] || null;
	if (!level) {
		ENGINE.Log("GAME", "Scale tester level not found in levels.json.", "warn", "Level");
		return null;
	}

	const stage = Array.isArray(level.stages) ? level.stages[resolvedRequest.stageIndex] || null : null;
	if (!stage) {
		ENGINE.Log("GAME", "Scale tester stage not found in levels.json.", "warn", "Level");
		return null;
	}

	const cnuScale = ENGINE.Meta.CNU_SCALE;
	const effectiveScale = decoupledCNU ? cnuScale : 1;
	let payload = buildCreateLevelPayload(level, stage, entitiesData, effectiveScale);
	logPayloadSummary(payload, effectiveScale);

	if (payload.music && payload.music.src) {
		payload = {
			...payload,
			music: {
				...payload.music,
				src: new URL(payload.music.src, import.meta.url).href,
			},
		};
	}

	ENGINE.UI.ClearUI("engine-ui-root");
	ENGINE.Audio.StopMusic();

	const sceneGraph = await ENGINE.Level.CreateLevel(payload, {
		source: "testGame",
		renderOptions: {
			rootId: "engine-level-root",
		},
		...(options && typeof options === "object" ? options : {}),
	});

	if (sceneGraph && payload.music && payload.music.src) {
		const trackName = payload.music.name || `LEVEL_${payload.id || "TRACK"}`;
		ENGINE.Audio.PlayMusic(trackName, payload.music.src, payload.music);
	}

	return payload;
}

export { RequestLvl1Stage2Create };