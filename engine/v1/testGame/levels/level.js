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

function resolveRequestedLevel(levelsData, request) {
	const levels = levelsData.levels;

	if (request && request.levelId) {
		const byId = levels.find((level) => level.id === request.levelId);
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
	if (request && request.stageId) {
		const byId = level.stages.find((stage) => stage.id === request.stageId);
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
	return {
		id: stage.id,
		title: stage.title || level.title,
		world: stage.world,
		terrain: stage.terrain,
		obstacles: stage.obstacles,
		entities: stage.entities,
		entityBlueprints: entitiesData,
		camera: stage.camera,
		player: stage.player,
		music: stage.music || level.music || null,
		meta: {
			levelId: level.id,
			stageId: stage.id,
		},
	};
}

function buildBlueprintCounts(blueprints) {
	return {
		enemies: blueprints.enemies.length,
		npcs: blueprints.npcs.length,
		collectibles: blueprints.collectibles.length,
		projectiles: blueprints.projectiles.length,
	};
}

async function RequestLevelCreate(request, options) {
	const [levelsData, entitiesData] = await Promise.all([loadLevelsData(), loadEntitiesData()]);

	const level = resolveRequestedLevel(levelsData, request || null);
	if (!level) {
		ENGINE.Log("GAME", "Requested level not found in levels.json.", "warn", "Level");
		return null;
	}

	const stage = resolveStage(level, request || null);
	if (!stage) {
		ENGINE.Log("GAME", "Requested stage not found in levels.json.", "warn", "Level");
		return null;
	}

	const payload = buildCreateLevelPayload(level, stage, entitiesData);

	const blueprintCounts = buildBlueprintCounts(payload.entityBlueprints);
	ENGINE.Log(
		"GAME",
		[
			"Sending level payload to engine:",
			`- levelId: ${payload.meta.levelId}`,
			`- stageId: ${payload.meta.stageId}`,
			`- terrainObjects: ${payload.terrain.objects.length}`,
			`- obstacles: ${payload.obstacles.length}`,
			`- entities(overrides): ${payload.entities.length}`,
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

	if (payload.music && payload.music.src) {
		payload.music = {
			...payload.music,
			src: new URL(payload.music.src, import.meta.url).href,
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
		const trackName = payload.music.name || `LEVEL_${payload.id}`;
		ENGINE.Audio.PlayMusic(trackName, payload.music.src, payload.music);
	}

	return payload;
}

export { RequestLevelCreate };