const decoupledCNU = false;

let levelsDataPromise = null;
let entitiesDataPromise = null;

function loadLevelsData() {
	if (!levelsDataPromise) {
		levelsDataPromise = fetch(new URL("./levels.json", import.meta.url))
			.then((response) => response.json());
	}

	return levelsDataPromise;
}

function loadEntitiesData() {
	if (!entitiesDataPromise) {
		entitiesDataPromise = fetch(new URL("./entities.json", import.meta.url))
			.then((response) => response.json());
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
	const processedStage = preprocessStage(stage, cnuScale);

	return {
		id: processedStage.id,
		title: processedStage.title || level.title,
		world: processedStage.world,
		terrain: processedStage.terrain,
		obstacles: processedStage.obstacles,
		entities: processedStage.entities,
		entityBlueprints: entitiesData,
		camera: processedStage.camera,
		player: processedStage.player,
		music: processedStage.music || level.music || null,
		meta: {
			levelId: level.id,
			stageId: processedStage.id,
		},
	};
}

function logPayloadSummary(payload, cnuScale) {
	ENGINE.Log(
		"GAME",
		[
			"Sending scale tester payload to engine:",
			`- levelId: ${payload.meta.levelId}`,
			`- stageId: ${payload.meta.stageId}`,
			`- cnuScale: ${cnuScale}`,
			`- terrainObjects: ${payload.terrain.objects.length}`,
			`- obstacles: ${payload.obstacles.length}`,
		].join("\n"),
		"log",
		"Level"
	);
}

async function RequestLvl1Stage2Create(request, options) {
	const [levelsData, entitiesData] = await Promise.all([loadLevelsData(), loadEntitiesData()]);

	const resolvedRequest = request || { levelIndex: 0, stageIndex: 1 };
	const level = levelsData.levels[resolvedRequest.levelIndex] || null;
	if (!level) {
		ENGINE.Log("GAME", "Scale tester level not found in levels.json.", "warn", "Level");
		return null;
	}

	const stage = level.stages[resolvedRequest.stageIndex] || null;
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
		...options,
	});

	if (sceneGraph && payload.music && payload.music.src) {
		const trackName = payload.music.name || `LEVEL_${payload.id || "TRACK"}`;
		ENGINE.Audio.PlayMusic(trackName, payload.music.src, payload.music);
	}

	return payload;
}

export { RequestLvl1Stage2Create };