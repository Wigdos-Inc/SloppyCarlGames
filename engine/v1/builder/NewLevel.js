// Creates the Level's World by creating Terrain, Background, and placing Obstacles, Triggers and Entities
// Can also be used to create Boss Arenas

// Used by handlers/game/Level.js
// Uses NewEntity.js for building Enemies
// Uses NewObstacle.js for static obstacles
// Uses NewParticles.js for level-authored particle generators
// Uses NewObject.js for terrain generation.

import { BuildObject } from "./NewObject.js";
import { BuildEntity } from "./NewEntity.js";
import { GenerateParticles, ParticleGeneratorRequests } from "./NewParticles.js";
import { BuildObstacles } from "./NewObstacle.js";
import { BuildTerrain } from "./NewTerrain.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { BuildScatterBatches, BuildScatterVisualResources } from "./NewScatter.js";
import { BuildVoidWalls } from "./NewVoid.js";
import { CONFIG, PERFORMANCE_SCALING, CAMERA_TUNING } from "../core/config.js";
import { EPSILON, Log } from "../core/meta.js";
import { Clamp, DegreesToRadians, UnitVector3 } from "../math/Utilities.js";
import { AddVector3, AngleBetweenVector3, CrossVector3, DotVector3, ResolveVector3Axis, ScaleVector3, SubtractVector3, ToVector3, Vector3ToArray, WORLD_NORMALS } from "../math/Vector3.js";
import { AabbOverlap, TriangleAabb, TriangleDistanceSq } from "../math/Collision.js";
import { IsPointInSuppressingVoid } from "../physics/Collision.js";

function resolveEntityBlueprintMap(payload) {
	const map = {};
	const blueprints = payload.entityBlueprints;

	const registerList = (list) => list.forEach((entry) => map[entry.id] = entry);

	registerList(blueprints.enemies);
	registerList(blueprints.npcs);
	registerList(blueprints.collectibles);
	registerList(blueprints.projectiles);
	registerList(blueprints.entities);

	return map;
}

function buildEntityInput(source, blueprintMap) {
	const merged = source.blueprintId ? { ...source, baseBlueprint: blueprintMap[source.blueprintId] } : source;
	return {
		...merged,
		id: merged.id,
	};
}

function resolveTriggerColor(triggerType) {
	switch (triggerType) {
		case "cutscene": return { r: 0.45, g: 0.75, b: 1,    a: 0.35 };
		case "dialogue": return { r: 0.4,  g: 1,    b: 0.65, a: 0.35 };
		case "combat"  : return { r: 1,    g: 0.45, b: 0.45, a: 0.35 };
		default        : return { r: 1,    g: 0.85, b: 0.4,  a: 0.35 };
	}
}

function buildTriggerMesh(triggerDefinition, world, index) {
	const triggerHeight = world.height.value - triggerDefinition.start.y;
	const position = triggerDefinition.start.clone().add(triggerDefinition.end).scale(0.5); 
	position.y = (triggerDefinition.start.y + triggerHeight) / 2;

	const color = resolveTriggerColor(triggerDefinition.type);

	const { mesh } = BuildObject(
		{
			id              : triggerDefinition.id,
			shape           : "cube",
			complexity      : "medium",
			dimensions      : new UnitVector3(
				Math.max(1, Math.abs(triggerDefinition.end.x - triggerDefinition.start.x)),
				triggerHeight,
				Math.max(1, Math.abs(triggerDefinition.end.z - triggerDefinition.start.z)),
				"cnu"
			),
			position,
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture: {
				generated: {
					id            : "default-tiles",
					shape         : null,
					compositeMode : null,
					primary       : color,
					secondary     : null,
					density       : 1,
					speckSize     : 1,
					animated      : false,
					holdTimeSpeed : 1,
					blendTimeSpeed: 1,
				},
				custom: [],
			},
			detail         : { scatter: [] },
			role           : "trigger",
			collisionShape : "none",
			trigger        : {
				type        : triggerDefinition.type,
				payload     : triggerDefinition.payload,
				activateOnce: triggerDefinition.activateOnce,
			}
		}
	);
	return mesh;
}

function buildWaterVisualMeshes(world, faceTextureStore) {
	if (!world.water.level) return null;

	const centerX     = world.length.value * 0.5;
	const centerZ     = world.width.value * 0.5;
	const waterBottom = Clamp(world.water.level.value - 0.1, 0, world.deathBarrierY.value);
	const waterHeight = Math.max(0.1, world.water.level.value - waterBottom);

	const { mesh: body } = BuildObject(
		{
			id              : `water-body-${world.length.value}-${world.width.value}-${waterBottom}-${world.water.level.value}`,
			shape           : "cube",
			complexity      : "medium",
			dimensions      : new UnitVector3(world.length.value, waterHeight, world.width.value, "cnu"),
			position        : new UnitVector3(centerX, waterBottom + waterHeight * 0.5, centerZ, "cnu"),
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture         : {
				generated: {
					id: "underwater", shape: null, compositeMode: null,
					primary: null, secondary: null,
					density: 1, speckSize: 1,
					animated: false, holdTimeSpeed : 1, blendTimeSpeed: 1,
				},
				custom: [],
			},
			detail         : { scatter: [] },
			role           : "water",
			collisionShape : "none",
			textureScale   : world.textureScale,
			faceTextureStore,
		}
	);

	const { mesh: top } = BuildObject(
		{
			id: `water-top-${world.length.value}-${world.width.value}-${world.water.level.value}`,
			shape: "plane", complexity: "",
			dimensions      : new UnitVector3(world.length.value, 1, world.width.value, "cnu"),
			position        : new UnitVector3( centerX, world.water.level.value + 0.02, centerZ, "cnu"),
			rotation        : new UnitVector3(0, 0, 0, "radians"),
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: {},
			texture         : {
				generated: {
					id: "sea-surface", shape: null, compositeMode: null,
					primary: null, secondary: null,
					density: 4, speckSize: 2,
					animated: true, holdTimeSpeed: 1, blendTimeSpeed: 1,
				},
				custom: [],
			},
			detail: { scatter: [] }, role: "water", collisionShape: "none",
			textureScale   : world.textureScale,
			faceTextureStore,
		}
	);

	return { body, top };
}

function buildSurfaceMap(terrainDefinitions, obstacleDefinitions) {
	const map = {};
	const addSurface = (def) => {
		map[def.id] = {
			position  : def.position,
			dimensions: def.dimensions,
			scale     : def.scale,
			topY      : def.position.y + (def.dimensions.y * def.scale.y * 0.5),
		};
	};
	terrainDefinitions.forEach(addSurface);
	obstacleDefinitions.forEach(addSurface);
	return map;
}

function buildSceneBoundingBoxes(sceneGraph) {
	const bounds = [];
	const classifyEntityType = (entity) => {
		if (entity.type.includes("player"))   return { whole: "Player", part: "PlayerPart" };
		if (entity.type.includes("boss"))     return { whole: "Boss", part: "BossPart" };
		if (entity.type.includes("particle")) return { whole: "Particle", part: "ParticlePart" };
		return { whole: "Entity", part: "EntityPart" };
	};

	const push = (type, id, aabb) => bounds.push({ 
		type: type, 
		id  : id, 
		min : aabb.min, 
		max : aabb.max 
	});

	sceneGraph.terrain.forEach((mesh) => push("Terrain", mesh.id, mesh.worldAabb));
	sceneGraph.scatter.forEach((mesh) => push("Scatter", mesh.id, mesh.worldAabb));

	// Per-model scatter bounding boxes from instanced batch generation.
	sceneGraph.debug.scatterBounds.forEach(({ type, id, min, max }) => bounds.push({ type, id, min, max }));

	sceneGraph.obstacles.forEach((obstacle) => {
		push("Obstacle", obstacle.id, obstacle.worldAabb);
		obstacle.parts.forEach((part) => push("Obstacle", part.id, part.worldAabb));
	});

	sceneGraph.voids.terrain.forEach((mesh) => push("Void", mesh.id, mesh.worldAabb));
	sceneGraph.voids.obstacles.forEach((obstacle) => {
		push("Void", obstacle.id, obstacle.worldAabb);
		obstacle.parts.forEach((part) => push("Void", part.id, part.worldAabb));
	});

	sceneGraph.entities.forEach((entity) => {
		const category = classifyEntityType(entity);
		push(category.whole, entity.id, entity.collision.aabb);
		entity.model.parts.forEach((part) => push(category.part, `${entity.id}:${part.id}`, part.mesh.worldAabb));
	});

	return bounds;
}

function buildSceneDetailedBounds(sceneGraph) {
	const detailed = [];
	const classifyEntityType = (entity) => {
		const type = entity.type;
		if (type.includes("player")) return "Player";
		if (type.includes("boss")) return "Boss";
		if (type.includes("particle")) return "Particle";
		return "Entity";
	};

	// `toggle` selects the CONFIG.Debug.Levels.DetailedBounds key; `type` selects the wireframe colour.
	const push = (type, id, bounds, toggle = type) => {
		if (!bounds) return;
		detailed.push({ type: type, id: id, bounds: bounds, toggle: toggle });
	};

	// A void's own volume plus the classified geometry derived from it, all under the Void toggle.
	const pushVoid = (entry) => {
		push("Void", entry.id, entry.detailedBounds);
		for (const hostId in entry.relations) {
			const relation = entry.relations[hostId];
			relation.voidWallMeshes.forEach((wall) => {
				push("VoidWall", `${wall.id}|floor`, wall.floorBounds, "Void");
				push("VoidWall", `${wall.id}|wall`, wall.wallBounds, "Void");
			});
			if (relation.openFaces.length === 0) continue;
			push("VoidOpenFace", `${entry.id}|${hostId}|open`, { type: "triangle-soup", triangles: relation.openFaces }, "Void");
		}
	};

	sceneGraph.terrain.forEach((mesh) => push("Terrain", mesh.id, mesh.detailedBounds));
	sceneGraph.obstacles.forEach((obstacle) => push("Obstacle", obstacle.id, obstacle.detailedBounds));
	sceneGraph.voids.terrain.forEach(pushVoid);
	sceneGraph.voids.obstacles.forEach(pushVoid);

	sceneGraph.entities.forEach((entity) => {
		const category = classifyEntityType(entity);
		if (entity.collision.physics.bounds.type === "capsule") {
			push(category, entity.id, {
				type        : "capsule",
				radius      : entity.collision.physics.bounds.radius,
				halfHeight  : entity.collision.physics.bounds.halfHeight,
				segmentStart: entity.collision.physics.bounds.segmentStart,
				segmentEnd  : entity.collision.physics.bounds.segmentEnd,
			});

			return;
		}

		push(category, entity.id, entity.collision.physics.bounds);
	});

	return detailed;
}

/* === SURFACE CHUNKS === */

// 12 triangles, outward normals.
function boxFacets(center, axes, half) {
	const facets = [];
	const extents = Vector3ToArray(half);
	for (let axis = 0; axis < 3; axis++) {
		const u = (axis + 1) % 3;
		const v = (axis + 2) % 3;
		for (const sign of [-1, 1]) {
			const normal = ScaleVector3(axes[axis], sign);
			const faceCenter = AddVector3(center, ScaleVector3(normal, extents[axis]));
			const [p0, p1, p2, p3] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => AddVector3(faceCenter, AddVector3(
				ScaleVector3(axes[u], su * extents[u]),
				ScaleVector3(axes[v], sv * extents[v])
			)));
			facets.push({ a: p0, b: p1, c: p2, normal }, { a: p0, b: p2, c: p3, normal });
		}
	}
	return facets;
}

// Sphere, capsule and "none" bounds have no facets.
function boundsFacets(bounds) {
	if (bounds === null) return [];
	switch (bounds.type) {
		case "triangle-soup": return bounds.triangles;
		case "obb"          : return boxFacets(bounds.center, bounds.axes, bounds.halfExtents);
		case "aabb"         : return boxFacets(
			bounds.min.clone().add(bounds.max).scale(0.5),
			[WORLD_NORMALS.Right, WORLD_NORMALS.Up, WORLD_NORMALS.Forward],
			bounds.max.clone().subtract(bounds.min).scale(0.5)
		);
		default: return [];
	}
}

const makeRoots = (count) => Array.from({ length: count }, (_, index) => index);
function findRoot(roots, index) {
	while (roots[index] !== index) index = roots[index] = roots[roots[index]];
	return index;
}
const joinRoots = (roots, a, b) => { roots[findRoot(roots, a)] = findRoot(roots, b); };

// A fold's loop radius: the facets' width across it over its turn.
function foldRadius(a, b, fold) {
	const edge = ResolveVector3Axis(CrossVector3(a.normal, b.normal));
	const width = (facet) => {
		const reach = [facet.a, facet.b, facet.c].map((point) => DotVector3(point, CrossVector3(edge, facet.normal)));
		return Math.max(...reach) - Math.min(...reach);
	};
	return (width(a) + width(b)) / (4 * Math.tan(fold / 2));
}

// Chunks join touching pieces; loop surfaces are picked per medium.
function buildSurfaceChunks(terrain, obstacles, voids) {
	const started = performance.now();
	const pieces = [];
	const centroid = (f) => ScaleVector3(AddVector3(AddVector3(f.a, f.b), f.c), 1 / 3);
	const addHost = (id, aabb, bounds, flags, hostVoids) => pieces.push({
		id, aabb,
		facets: boundsFacets(bounds).filter((facet) => !(flags.nullable !== false && IsPointInSuppressingVoid(centroid(facet), id, hostVoids))),
	});
	terrain.forEach((mesh) => addHost(mesh.id, mesh.worldAabb, mesh.detailedBounds, mesh.meta, voids.terrain));
	obstacles.forEach((record) => addHost(record.id, record.worldAabb, record.detailedBounds, record, voids.obstacles));
	for (const entry of [...voids.terrain, ...voids.obstacles]) {
		const lining = [];
		for (const hostId in entry.relations) {
			entry.relations[hostId].voidWallMeshes.forEach((wall) => lining.push(...wall.floorBounds.triangles, ...wall.wallBounds.triangles));
		}
		if (lining.length > 0) pieces.push({ id: entry.id, aabb: entry.worldAabb, facets: lining });
	}

	// Touching means no gap beyond float noise.
	const expand = (aabb) => ({ min: SubtractVector3(aabb.min, ToVector3(EPSILON)), max: AddVector3(aabb.max, ToVector3(EPSILON)) });
	const facets = [], owner = [], incline = [], links = [];
	// Concave: each facet rises toward the other, as inside a loop; a crest falls away.
	const link = (a, b) => {
		const across = SubtractVector3(centroid(facets[b]), centroid(facets[a]));
		const concave = DotVector3(facets[a].normal, across) - DotVector3(facets[b].normal, across) >= -EPSILON;
		links.push({ a, b, concave, fold: AngleBetweenVector3(facets[a].normal, facets[b].normal) });
	};

	// Within a piece: shared edges.
	const vertexKey = (p) => `${p.x},${p.y},${p.z}`;
	pieces.forEach((piece, pieceIndex) => {
		const edgeOwners = new Map();
		piece.first = facets.length;
		for (const facet of piece.facets) {
			const index = facets.length;
			facets.push(facet);
			owner.push(pieceIndex);
			incline.push(AngleBetweenVector3(facet.normal, WORLD_NORMALS.Up));
			const keys = [vertexKey(facet.a), vertexKey(facet.b), vertexKey(facet.c)];
			for (let edge = 0; edge < 3; edge++) {
				const [k1, k2] = [keys[edge], keys[(edge + 1) % 3]].sort();
				if (k1 === k2) continue;
				const shared = edgeOwners.get(`${k1}|${k2}`);
				if (!shared) { edgeOwners.set(`${k1}|${k2}`, [index]); continue; }
				shared.forEach((other) => link(other, index));
				shared.push(index);
			}
		}
	});

	// Across pieces: touching facets, for pieces whose bounds touch.
	const pieceRoots = makeRoots(pieces.length);
	const reach = pieces.map((piece) => expand(piece.aabb));
	const facetReach = facets.map((facet) => expand(TriangleAabb(facet)));
	const nearFacets = (piece, bounds) => piece.facets.map((_, offset) => piece.first + offset).filter((index) => AabbOverlap(facetReach[index], bounds));
	for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
		if (!AabbOverlap(reach[i], reach[j])) continue;
		if (pieces[i].facets.length === 0 || pieces[j].facets.length === 0) { joinRoots(pieceRoots, i, j); continue; }
		const nearJ = nearFacets(pieces[j], reach[i]);
		for (const a of nearFacets(pieces[i], reach[j])) for (const b of nearJ) {
			if (AabbOverlap(facetReach[a], facetReach[b]) && TriangleDistanceSq(facets[a], facets[b]) <= EPSILON * EPSILON) link(a, b);
		}
	}

	// Chunks: pieces joined by any adjacency.
	links.forEach(({ a, b }) => joinRoots(pieceRoots, owner[a], owner[b]));
	const chunkByRoot = new Map();
	pieces.forEach((piece, index) => {
		const root = findRoot(pieceRoots, index);
		if (!chunkByRoot.has(root)) chunkByRoot.set(root, { id: `chunk-${chunkByRoot.size}`, surfaceIds: [] });
		chunkByRoot.get(root).surfaceIds.push(piece.id);
	});

	// Loop surfaces: smooth components with floor and ceiling, then their steeper-than-ground sub-components reaching the ceiling. Each keeps its loop radius.
	const loopSurfaces = { Air: new Map(), Water: new Map() };
	const loopIncline = CAMERA_TUNING.Loops.MinCurveThreshold.toRadians();
	for (const medium in loopSurfaces) {
		const limit = DegreesToRadians(CONFIG.Physics.Correction.MaxAngleDelta[medium].Ground);
		const smooth = links.filter((l) => l.concave && l.fold <= limit);
		const roots = makeRoots(facets.length);
		smooth.forEach(({ a, b }) => joinRoots(roots, a, b));
		const floors = new Set(), ceilings = new Set();
		incline.forEach((angle, index) => {
			if (angle <= limit) floors.add(findRoot(roots, index));
			if (angle >= loopIncline) ceilings.add(findRoot(roots, index));
		});
		const steep = (index) => incline[index] > limit && floors.has(findRoot(roots, index)) && ceilings.has(findRoot(roots, index));

		const steepRoots = makeRoots(facets.length);
		smooth.forEach(({ a, b }) => { if (steep(a) && steep(b)) joinRoots(steepRoots, a, b); });
		const loopRoots = new Set();
		incline.forEach((angle, index) => { if (angle >= loopIncline && steep(index)) loopRoots.add(findRoot(steepRoots, index)); });
		// Median fold radius per loop; one without folds has no size.
		const foldRadii = new Map();
		smooth.forEach(({ a, b, fold }) => {
			if (fold <= EPSILON || !steep(a) || !steep(b)) return;
			const root = findRoot(steepRoots, a);
			if (!foldRadii.has(root)) foldRadii.set(root, []);
			foldRadii.get(root).push(foldRadius(facets[a], facets[b], fold));
		});
		const loopRadius = (root) => {
			const radii = (foldRadii.get(root) || [Infinity]).sort((x, y) => x - y);
			return radii[radii.length >> 1];
		};
		incline.forEach((_, index) => {
			const root = findRoot(steepRoots, index);
			if (!steep(index) || !loopRoots.has(root)) return;
			const id = pieces[owner[index]].id;
			loopSurfaces[medium].set(id, Math.min(loopSurfaces[medium].get(id) ?? Infinity, loopRadius(root)));
		});
	}

	const chunks = [...chunkByRoot.values()];
	Log("ENGINE", `Surface chunks: chunks=${chunks.length}, loopAir=${loopSurfaces.Air.size}, loopWater=${loopSurfaces.Water.size}, ms=${(performance.now() - started).toFixed(1)}`, "log", "Level");
	return { chunks, loopSurfaces };
}

function RefreshSceneBoundingBoxes(sceneGraph) {
	sceneGraph.debugBoundingBoxes = buildSceneBoundingBoxes(sceneGraph);
	sceneGraph.debug.detailedBounds = buildSceneDetailedBounds(sceneGraph);
	return sceneGraph.debugBoundingBoxes;
}

async function BuildLevel(payload) {
	const scatterBatches      = new Map();
	const scatterDebugBounds  = [];
	const enqueueScatterBatches = (objectMesh, indexSeed, openFaces) => {
		if (objectMesh.detail.scatter.length === 0) return;
		BuildScatterBatches({
			objectMesh, indexSeed, openFaces,
			scatterMultiplier   : PERFORMANCE_SCALING.Density.Scatter[CONFIG.Performance.Scatter.Density],
			world               : payload.world,
			explicitScatter     : objectMesh.detail.scatter,
			batchMap            : scatterBatches,
			debugBboxAccumulator: scatterDebugBounds,
		});
	};

	// A central storage for easy reuse.
	const faceTextureStore = {};

	// A cache to prevent geometry regeneration
	const partGeometryCache = new Map();

	// Template refs resolve once here; resolution inside the builders is passthrough for these.
	const terrainDefinitions  = payload.terrain.objects.map((definition) => ResolveObjectSource(definition, "terrain"));
	const obstacleDefinitions = payload.obstacles.map((definition) => ResolveObjectSource(definition, "obstacle"));

	const { terrain, voidTerrain, meshes: allTerrain } = BuildTerrain(terrainDefinitions, payload.world, faceTextureStore);

	const { built: allObstacleRecords } = BuildObstacles(obstacleDefinitions, { textureScale: payload.world.textureScale, faceTextureStore });
	const obstacleRecords          = allObstacleRecords.filter((r) => r.mode !== "void");
	const voidObstacleRecords = allObstacleRecords.filter((r) => r.mode === "void");

	// Void walls run before scatter so scatter may avoid openings.
	const voids = { terrain: voidTerrain, obstacles: voidObstacleRecords };
	BuildVoidWalls({ terrain, obstacles: obstacleRecords, voids }, payload.world.textureScale);
	const { chunks, loopSurfaces } = buildSurfaceChunks(terrain, obstacleRecords, voids);

	// Store centerlines by surface id for improved loop detection in tubes.
	const tubeCenterlines = new Map();
	const addCenterlines = (id, meshes) => {
		const lines = meshes.filter((mesh) => mesh.centerline !== null).map((mesh) => mesh.centerline);
		if (lines.length > 0) tubeCenterlines.set(id, lines);
	};
	[...terrain, ...voidTerrain].forEach((mesh) => addCenterlines(mesh.id, [mesh]));
	allObstacleRecords.forEach((record) => addCenterlines(record.id, record.parts));

	// Open faces per default object id, gathered from every void relation that references it.
	const openFacesByObjectId = new Map();
	const collectOpenFaces = (entries) => {
		for (const entry of entries) {
			for (const id in entry.relations) {
				if (!openFacesByObjectId.has(id)) openFacesByObjectId.set(id, []);
				openFacesByObjectId.get(id).push(...entry.relations[id].openFaces);
			}
		}
	};
	collectOpenFaces(voidTerrain);
	collectOpenFaces(voidObstacleRecords);

	// Generate scatter batches for default terrain and default obstacles, now that openings exist.
	allTerrain.forEach((terrainMesh, index) => {
		if (terrainMesh.meta.mode === "default") enqueueScatterBatches(terrainMesh, index + 1, openFacesByObjectId.get(terrainMesh.id) ?? []);
	});
	obstacleRecords.forEach((record, index) => {
		if (record.mode === "default") enqueueScatterBatches(record.mesh, payload.terrain.objects.length + index + 1, openFacesByObjectId.get(record.id) ?? []);
	});

	let totalBatchInstances = 0;
	scatterBatches.forEach((batch) => { totalBatchInstances += batch.instanceCount; });
	if (totalBatchInstances > 0) {
		Log(
			"ENGINE",
			`Scatter batches: ${scatterBatches.size} batch key(s), ${totalBatchInstances} total instance(s)`,
			"log",
			"Level"
		);
	}

	const triggers = payload.terrain.triggers.map((triggerDefinition, index) => {
		return buildTriggerMesh(triggerDefinition, payload.world, index);
	});
	if (triggers.length > 0) Log("ENGINE", `Trigger group created: count=${triggers.length}`, "log", "Level");

	const entities = payload.entities.map((entity) => {
		const { entity: built } = BuildEntity(
			buildEntityInput(entity, resolveEntityBlueprintMap(payload)),
			buildSurfaceMap(terrainDefinitions, obstacleDefinitions),
			payload.world.textureScale,
			faceTextureStore,
			partGeometryCache
		);
		return built;
	});
	if (entities.length > 0) Log("ENGINE", `Entity group created: count=${entities.length}`, "log", "Level");

	let particleGroups = 0;

	// Materialized before the loop: the loop pushes its groups into the `entities` array it reads from.
	const generatorRequests = [
		...allTerrain.flatMap((mesh) => ParticleGeneratorRequests(mesh, "terrain")),
		...allObstacleRecords.flatMap((record) => ParticleGeneratorRequests(record, "obstacle")),
		...entities.flatMap((entity) => ParticleGeneratorRequests(entity, "entity")),
	];

	generatorRequests.forEach((request) => {
		const { groups } = GenerateParticles(
			request,
			payload.player === null ? null : payload.player.spawnPosition,
			payload.world.textureScale,
			faceTextureStore,
			partGeometryCache
		);
		entities.push(...groups);
		particleGroups += groups.length;
	});
	if (particleGroups > 0) Log("ENGINE", `Particle group created: count=${particleGroups}`, "log", "Level");

	const waterVisual = buildWaterVisualMeshes(payload.world, faceTextureStore);

	const sceneGraph = {
		world: payload.world,
		terrain, entities, triggers, scatter: [], scatterBatches,
		obstacles               : obstacleRecords,
		voids, waterVisual, chunks, loopSurfaces, tubeCenterlines,
		scatterPrimitiveGeometry: BuildScatterVisualResources(scatterBatches),
		debug                   : {
			showTriggerVolumes: !!(CONFIG.Debug.All === true && CONFIG.Debug.Levels.Triggers === true),
			detailedBounds    : [],
			scatterBounds     : scatterDebugBounds,
		},
		effects: {
			underwater: {
				enabled     : false,
				particleHook: null,
			},
		},
		cameraConfig       : payload.camera,
		playerConfig       : payload.player,
		meta               : payload.meta,
		pendingFaceTextures: faceTextureStore,
		partGeometryCache,
	};

	RefreshSceneBoundingBoxes(sceneGraph);
	Log(
		"ENGINE",
		`Level generation complete: terrain=${terrain.length}, obstacles=${obstacleRecords.length}, voidTerrain=${voidTerrain.length}, voidObstacles=${voidObstacleRecords.length}, entities=${entities.length}, triggers=${triggers.length}, scatterBatches=${scatterBatches.size}, scatterInstances=${totalBatchInstances}`,
		"log",
		"Level"
	);
	return sceneGraph;
}

export { BuildLevel, RefreshSceneBoundingBoxes };