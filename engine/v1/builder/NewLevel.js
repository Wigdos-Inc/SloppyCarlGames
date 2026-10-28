// Builds a level's world: terrain, water, obstacles, voids, scatter, triggers, entities and particles.
// Can also be used to create Boss Arenas

// Used by handlers/game/Level.js
// Uses NewTerrain.js and NewObject.js for terrain, water and trigger meshes.
// Uses NewObstacle.js for static obstacles.
// Uses NewVoid.js for void walls.
// Uses NewScatter.js for scatter batches.
// Uses NewEntity.js for level entities.
// Uses NewParticles.js for level-authored particle generators.
// Uses NewTemplate.js to resolve template refs.

import { BuildObject } from "./NewObject.js";
import { BuildEntity } from "./NewEntity.js";
import { GenerateParticles, ParticleGeneratorRequests } from "./NewParticles.js";
import { BuildObstacles } from "./NewObstacle.js";
import { BuildTerrain, CarveOccluders } from "./NewTerrain.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { BuildScatterBatches, BuildScatterVisualResources } from "./NewScatter.js";
import { BuildVoidWalls } from "./NewVoid.js";
import { CONFIG, PERFORMANCE_SCALING, CAMERA_TUNING } from "../core/config.js";
import { EPSILON, Log } from "../core/meta.js";
import { Clamp, DegreesToRadians, Unit, UnitVector3 } from "../math/Utilities.js";
import { 
	AddVector3, 
	AngleBetweenVector3, 
	CrossVector3, 
	DotVector3, 
	ResolveVector3Axis, 
	ScaleVector3, 
	SubtractVector3, 
	ToVector3, 
	Vector3ToArray, 
	WORLD_NORMALS 
} from "../math/Vector3.js";
import { AabbOverlap, ObbFromAabb, TriangleAabb, TriangleCentroid, TriangleDistanceSq } from "../math/Collision.js";
import { IsPointInSuppressingVoid } from "../physics/Collision.js";

// Blueprints by id, across every blueprint category.
function resolveEntityBlueprintMap(payload) {
	const map = {};
	["enemies", "npcs", "collectibles", "projectiles", "entities"].forEach(key => {
		payload.entityBlueprints[key].forEach((entry) => map[entry.id] = entry)
	});

	return map;
}

// Attach the entity's blueprint when it names one.
function buildEntityInput(source, blueprintMap) {
	const merged = source.blueprintId ? { ...source, baseBlueprint: blueprintMap[source.blueprintId] } : source;
	return {
		...merged,
		id: merged.id,
	};
}

// Debug colour per trigger type.
function resolveTriggerColor(triggerType) {
	switch (triggerType) {
		case "cutscene": return { r: 0.45, g: 0.75, b: 1.00, a: 0.35 };
		case "dialogue": return { r: 0.40, g: 1.00, b: 0.65, a: 0.35 };
		case "combat"  : return { r: 1.00, g: 0.45, b: 0.45, a: 0.35 };
		default        : return { r: 1.00, g: 0.85, b: 0.40, a: 0.35 };
	}
}

function buildTriggerMesh(triggerDefinition, world) {
	const { id, start, end, type, payload, activateOnce } = triggerDefinition;

	// Build a trigger volume over the authored footprint, from its start height up to the world ceiling.
	const triggerHeight = world.height.value - start.y;
	const position = start.clone().add(end).scale(0.5); 
	position.y = start.y + triggerHeight * 0.5;

	const { mesh } = BuildObject(
		{
			id,
			shape           : "cube",
			complexity      : "medium",
			dimensions      : new UnitVector3(
				Math.max(1, Math.abs(end.x - start.x)),
				triggerHeight,
				Math.max(1, Math.abs(end.z - start.z)),
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
					primary       : resolveTriggerColor(type),
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
			trigger        : { type, payload, activateOnce }
		}
	);
	return mesh;
}

// Build the world-wide water body and its animated top surface.
function buildWaterVisualMeshes(world, faceTextureStore) {
	// Levels without a water level don't have water. Shocking, I know.
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
					id            : "underwater", 
					shape         : null, 
					compositeMode : null,
					primary       : null, 
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
			role           : "water",
			collisionShape : "none",
			textureScale   : world.textureScale,
			faceTextureStore,
		}
	);

	const { mesh: top } = BuildObject(
		{
			id              : `water-top-${world.length.value}-${world.width.value}-${world.water.level.value}`,
			shape           : "plane", 
			complexity      : "",
			dimensions      : new UnitVector3(world.length.value, world.width.value, 0, "cnu"),
			position        : new UnitVector3(centerX, world.water.level.value + 0.02, centerZ, "cnu"), // Sit just above the body to avoid flicker.
			rotation        : new UnitVector3(-90, 0, 0, "degrees").toRadians(true),                     // Lay the upright plane flat, facing up.
			scale           : ToVector3(1),
			pivot           : new UnitVector3(0, 0, 0, "cnu"),
			primitiveOptions: { crossed: false, sprite: null },
			texture         : {
				generated: {
					id            : "sea-surface", 
					shape         : null, 
					compositeMode : null,
					primary       : null, 
					secondary     : null,
					density       : 4, 
					speckSize     : 2,
					animated      : true, 
					holdTimeSpeed : 1, 
					blendTimeSpeed: 1,
				},
				custom: [],
			},
			detail        : { scatter: [] }, 
			role          : "water", 
			collisionShape: "none",
			textureScale  : world.textureScale,
			faceTextureStore,
		}
	);

	return { body, top };
}

// Collect spawn surfaces by id. topY determines where models are anchored to.
function buildSurfaceMap(terrainDefinitions, obstacleDefinitions) {
	const map = {};
	const addSurface = (def) => {
		const { position, dimensions, scale } = def;
		map[def.id] = {
			position, dimensions, scale,
			topY: def.position.y + (def.dimensions.y * def.scale.y * 0.5),
		};
	};
	terrainDefinitions.forEach(addSurface);
	obstacleDefinitions.forEach(addSurface);
	return map;
}

// Build debug bounding boxes for every scene object.
function buildDebugBoundingBoxes(sceneGraph) {
	const bounds = [];
	const classifyEntityType = (entity) => {
		if (entity.type.includes("player"))   return { whole: "Player",   part: "PlayerPart" };
		if (entity.type.includes("boss"))     return { whole: "Boss",     part: "BossPart" };
		if (entity.type.includes("particle")) return { whole: "Particle", part: "ParticlePart" };
		return { whole: "Entity", part: "EntityPart" };
	};

	const push = (type, id, aabb) => bounds.push({ 
		type, id, 
		min : aabb.min, 
		max : aabb.max 
	});

	sceneGraph.terrain.forEach((mesh) => push("Terrain", mesh.id, mesh.worldAabb));
	sceneGraph.scatter.forEach((mesh) => push("Scatter", mesh.id, mesh.worldAabb));

	// Scatter boxes come per model from batch generation.
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
		if (entity.collision !== null) push(category.whole, entity.id, entity.collision.aabb);
		entity.model.parts.forEach((part) => push(category.part, `${entity.id}:${part.id}`, part.mesh.worldAabb));
	});

	return bounds;
}

// Build debug wireframes of each object's exact collision shape.
function buildDebugDetailedBounds(sceneGraph) {
	const detailed = [];
	const classifyEntityType = (entity) => {
		if (entity.type.includes("player")) return "Player";
		if (entity.type.includes("boss")) return "Boss";
		if (entity.type.includes("particle")) return "Particle";
		return "Entity";
	};

	// `toggle` references a debug flag. `type` references a wireframe color.
	const push = (type, id, bounds, toggle = type) => {
		if (!bounds) return;
		detailed.push({ type: type, id: id, bounds: bounds, toggle: toggle });
	};

	// Push a void's volume, walls and open faces, all under the Void flag.
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
		if (entity.collision === null) return;
		
		const category = classifyEntityType(entity);
		const { type, radius, halfHeight, segmentStart, segmentEnd } = entity.collision.physics.bounds;
		if (type === "capsule") {
			push(category, entity.id, { type, radius, halfHeight, segmentStart, segmentEnd });
			return;
		}

		push(category, entity.id, entity.collision.physics.bounds);
	});

	return detailed;
}

/* === SURFACE CHUNKS === */

// Split a box into 12 triangles facing outward.
function boxFacets({ center, axes, halfExtents }) {
	const facets = [];
	const extents = Vector3ToArray(halfExtents);
	for (let axis = 0; axis < 3; axis++) {
		const u = (axis + 1) % 3;
		const v = (axis + 2) % 3;
		for (const sign of [-1, 1]) {
			const normal = ScaleVector3(axes[axis], sign);
			const [p0, p1, p2, p3] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => AddVector3(
				AddVector3(center, ScaleVector3(normal, extents[axis])), 
				AddVector3(ScaleVector3(axes[u], su * extents[u]), ScaleVector3(axes[v], sv * extents[v]))
			));
			facets.push({ a: p0, b: p1, c: p2, normal }, { a: p0, b: p2, c: p3, normal });
		}
	}
	return facets;
}

// List a collision shape's triangles. Shapes without flat faces give none.
function boundsFacets(bounds) {
	if (bounds === null) return [];
	switch (bounds.type) {
		case "triangle-soup": return bounds.triangles;
		case "obb"          : return boxFacets(bounds);
		case "aabb"         : return boxFacets(ObbFromAabb(bounds));
		default             : return [];
	}
}

// Merge indices into groups and find the group each one belongs to.
const makeRoots = (count) => Array.from({ length: count }, (_, index) => index);
function findRoot(roots, index) {
	while (roots[index] !== index) index = roots[index] = roots[roots[index]];
	return index;
}
const joinRoots = (roots, a, b) => roots[findRoot(roots, a)] = findRoot(roots, b);

// Estimate a loop's radius.
function foldRadius(a, b, fold) {
	const edge = ResolveVector3Axis(CrossVector3(a.normal, b.normal));
	const width = (facet) => {
		const reach = [facet.a, facet.b, facet.c].map((point) => DotVector3(point, CrossVector3(edge, facet.normal)));
		return Math.max(...reach) - Math.min(...reach);
	};
	return (width(a) + width(b)) / (4 * Math.tan(fold * 0.5));
}

// Find each medium's loop surfaces: the steep parts of a smooth inward curve that runs from floor to ceiling.
function findLoopSurfaces(pieces, owner, facets, links) {
	const loopSurfaces = { Air: new Map(), Water: new Map() };
	const loopIncline  = CAMERA_TUNING.Loops.MinCurveThreshold.toRadians();
	const incline      = facets.map((facet) => AngleBetweenVector3(facet.normal, WORLD_NORMALS.Up));

	for (const medium in loopSurfaces) {
		// Join facets that curve inward up to the medium's ground angle limit.
		const limit  = DegreesToRadians(CONFIG.Physics.Correction.MaxAngleDelta[medium].Ground);
		const smooth = links.filter((l) => l.concave && l.fold <= limit);
		const roots  = makeRoots(facets.length);

		smooth.forEach(({ a, b }) => joinRoots(roots, a, b));

		// Steep facets count only on curves that hold both a floor and a ceiling.
		const floors = new Set(), ceilings = new Set();
		incline.forEach((angle, index) => {
			if (angle <= limit) floors.add(findRoot(roots, index));
			if (angle >= loopIncline) ceilings.add(findRoot(roots, index));
		});
		const steep = (index) => incline[index] > limit && floors.has(findRoot(roots, index)) && ceilings.has(findRoot(roots, index));

		// Group the steep facets. Groups that reach the ceiling count as loops.
		const steepRoots = makeRoots(facets.length);
		smooth.forEach(({ a, b }) => { if (steep(a) && steep(b)) joinRoots(steepRoots, a, b); });
		const loopRoots = new Set();
		incline.forEach((angle, index) => {
			if (angle >= loopIncline && steep(index)) loopRoots.add(findRoot(steepRoots, index));
		});

		// Collect each loop's fold radii.
		const foldRadii = new Map();
		smooth.forEach(({ a, b, fold }) => {
			if (fold <= EPSILON || !steep(a) || !steep(b)) return;
			const root = findRoot(steepRoots, a);
			if (!foldRadii.has(root)) foldRadii.set(root, []);
			foldRadii.get(root).push(foldRadius(facets[a], facets[b], fold));
		});

		// Take the median fold radius. A loop without folds counts as infinitely wide.
		const loopRadius = (root) => {
			const radii = (foldRadii.get(root) || [Infinity]).sort((x, y) => x - y);
			return radii[radii.length >> 1];
		};

		// Store each surface's tightest loop radius.
		incline.forEach((_, index) => {
			const root = findRoot(steepRoots, index);
			if (!steep(index) || !loopRoots.has(root)) return;

			const id = pieces[owner[index]].id;
			loopSurfaces[medium].set(id, Math.min(loopSurfaces[medium].get(id) ?? Infinity, loopRadius(root)));
		});
		loopSurfaces[medium].forEach((radius, id) => loopSurfaces[medium].set(id, new Unit(radius, "cnu")));
	}

	return loopSurfaces;
}

// Group touching surfaces into chunks and find their loop surfaces.
function buildSurfaceChunks(terrain, obstacles, voids) {
	const started = performance.now();

	// Make one piece per surface: its triangles outside voids, plus each void's wall lining.
	const pieces = [];
	const centroid = (f) => TriangleCentroid(f.a, f.b, f.c);
	const addHost = (id, aabb, bounds, flags, hostVoids) => pieces.push({
		id, aabb,
		facets: boundsFacets(bounds).filter((facet) => !(flags.nullable !== false && IsPointInSuppressingVoid(centroid(facet), id, hostVoids))),
	});
	terrain.forEach((mesh) => addHost(mesh.id, mesh.worldAabb, mesh.detailedBounds, mesh.meta, voids.terrain));
	obstacles.forEach((record) => addHost(record.id, record.worldAabb, record.detailedBounds, record, voids.obstacles));
	for (const entry of [...voids.terrain, ...voids.obstacles]) {
		const lining = [];
		for (const hostId in entry.relations) {
			for (const wall of entry.relations[hostId].voidWallMeshes) {
				for (const triangle of wall.floorBounds.triangles) lining.push(triangle);
				for (const triangle of wall.wallBounds.triangles)  lining.push(triangle);
			}
		}
		if (lining.length > 0) pieces.push({ id: entry.id, aabb: entry.worldAabb, facets: lining });
	}

	// Grow bounds by a hair so touching surfaces overlap.
	const expand = (aabb) => ({ min: SubtractVector3(aabb.min, ToVector3(EPSILON)), max: AddVector3(aabb.max, ToVector3(EPSILON)) });
	const facets = [], owner = [], links = [];
	// Link two facets, marking whether they bend inward like a loop or outward like a crest.
	const link = (a, b) => {
		const across  = SubtractVector3(centroid(facets[b]), centroid(facets[a]));
		const concave = DotVector3(facets[a].normal, across) - DotVector3(facets[b].normal, across) >= -EPSILON;
		links.push({ a, b, concave, fold: AngleBetweenVector3(facets[a].normal, facets[b].normal) });
	};

	// Link facets within a piece that share an edge.
	const vertexKey = (p) => `${p.x},${p.y},${p.z}`;
	pieces.forEach((piece, pieceIndex) => {
		const edgeOwners = new Map();
		piece.first = facets.length;

		for (const facet of piece.facets) {
			const index = facets.length;
			facets.push(facet);
			owner.push(pieceIndex);

			const keys = [vertexKey(facet.a), vertexKey(facet.b), vertexKey(facet.c)];
			for (let edge = 0; edge < 3; edge++) {
				const [k1, k2] = [keys[edge], keys[(edge + 1) % 3]].sort();
				if (k1 === k2) continue;

				const shared = edgeOwners.get(`${k1}|${k2}`);
				if (!shared) {
					edgeOwners.set(`${k1}|${k2}`, [index]);
					continue;
				}
				shared.forEach((other) => link(other, index));
				shared.push(index);
			}
		}
	});

	// Link touching facets between pieces whose bounds touch. Pieces without triangles join on bounds alone.
	const pieceRoots = makeRoots(pieces.length);
	const reach      = pieces.map((piece) => expand(piece.aabb));
	const facetReach = facets.map((facet) => expand(TriangleAabb(facet)));

	function nearFacets(piece, bounds) {
		return piece.facets.map((_, offset) => piece.first + offset).filter((index) => AabbOverlap(facetReach[index], bounds));
	}

	for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
		if (!AabbOverlap(reach[i], reach[j])) continue;
		if (pieces[i].facets.length === 0 || pieces[j].facets.length === 0) {
			joinRoots(pieceRoots, i, j);
			continue;
		}

		for (const a of nearFacets(pieces[i], reach[j])) for (const b of nearFacets(pieces[j], reach[i])) {
			if (AabbOverlap(facetReach[a], facetReach[b]) && TriangleDistanceSq(facets[a], facets[b]) <= EPSILON ** 2) link(a, b);
		}
	}

	// Join pieces linked by any facet into one chunk.
	links.forEach(({ a, b }) => joinRoots(pieceRoots, owner[a], owner[b]));
	const chunkByRoot = new Map();
	pieces.forEach((piece, index) => {
		const root = findRoot(pieceRoots, index);
		if (!chunkByRoot.has(root)) chunkByRoot.set(root, { id: `chunk-${chunkByRoot.size}`, surfaceIds: [] });
		chunkByRoot.get(root).surfaceIds.push(piece.id);
	});

	const chunks       = [...chunkByRoot.values()];
	const loopSurfaces = findLoopSurfaces(pieces, owner, facets, links);
	Log(
		"ENGINE", 
		`
			Surface chunks: 
			- Chunks=${chunks.length} 
			- LoopAir=${loopSurfaces.Air.size} 
			- LoopWater=${loopSurfaces.Water.size} 
			- Ms=${(performance.now() - started).toFixed(1)}
		`, 
		"log", 
		"Level"
	);

	return { chunks, loopSurfaces };
}

// Rebuild after scene changes.
function RefreshDebugBoundingBoxes(sceneGraph) {
	sceneGraph.debugBoundingBoxes = buildDebugBoundingBoxes(sceneGraph);
	sceneGraph.debug.detailedBounds = buildDebugDetailedBounds(sceneGraph);
	return sceneGraph.debugBoundingBoxes;
}

// Build the persistent sceneGraph from a level payload.
async function BuildLevel(payload) {
	const scatterBatches = new Map(), scatterDebugBounds = [];
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

	// Shared storage between builders. Reusable face textures and part geometry.
	const faceTextureStore = {}, partGeometryCache = new Map();

	// Resolve template refs once here. The builders take these as they are.
	const terrainDefinitions  = payload.terrain.objects.map((definition) => ResolveObjectSource(definition, "terrain"));
	const obstacleDefinitions = payload.obstacles.map((definition)       => ResolveObjectSource(definition, "obstacle"));

	const { terrain, voidTerrain, meshes: allTerrain } = BuildTerrain(terrainDefinitions, payload.world, faceTextureStore);

	const { built: allObstacleRecords } = BuildObstacles(obstacleDefinitions, { textureScale: payload.world.textureScale, faceTextureStore });
	const obstacleRecords     = allObstacleRecords.filter((r) => r.mode !== "void");
	const voidObstacleRecords = allObstacleRecords.filter((r) => r.mode === "void");

	// Void walls run before scatter so scatter can avoid openings.
	const voids = { terrain: voidTerrain, obstacles: voidObstacleRecords };
	BuildVoidWalls({ terrain, obstacles: obstacleRecords, voids }, payload.world.textureScale);

	// Rebuild terrain blockers so void openings stay clear.
	CarveOccluders(terrain, voidTerrain);

	const { chunks, loopSurfaces } = buildSurfaceChunks(terrain, obstacleRecords, voids);

	// Store centerlines by surface id for improved loop detection in tubes.
	const tubeCenterlines = new Map();
	const addCenterlines = (id, meshes) => {
		const lines = meshes.filter((mesh) => mesh.centerline !== null).map((mesh) => mesh.centerline);
		if (lines.length > 0) tubeCenterlines.set(id, lines);
	};
	[...terrain, ...voidTerrain].forEach((mesh) => addCenterlines(mesh.id, [mesh]));
	allObstacleRecords.forEach((record) => addCenterlines(record.id, record.parts));

	// Gather each object's open faces from every void that cuts into it.
	const openFacesByObjectId = new Map();
	const collectOpenFaces = (entries) => {
		for (const entry of entries) {
			for (const id in entry.relations) {
				if (!openFacesByObjectId.has(id)) openFacesByObjectId.set(id, []);

				const openFaces = openFacesByObjectId.get(id);
				for (const face of entry.relations[id].openFaces) openFaces.push(face);
			}
		}
	};
	collectOpenFaces(voidTerrain);
	collectOpenFaces(voidObstacleRecords);

	// Generate scatter batches for default terrain and obstacles.
	allTerrain.forEach((terrainMesh, index) => {
		if (terrainMesh.meta.mode === "default") enqueueScatterBatches(terrainMesh, index + 1, openFacesByObjectId.get(terrainMesh.id) ?? []);
	});
	obstacleRecords.forEach((record, index) => {
		if (record.mode === "default") enqueueScatterBatches(record.mesh, payload.terrain.objects.length + index + 1, openFacesByObjectId.get(record.id) ?? []);
	});

	let totalBatchInstances = 0;
	scatterBatches.forEach((batch) => totalBatchInstances += batch.instanceCount);
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

	const spawnSurfaces = buildSurfaceMap(terrainDefinitions, obstacleDefinitions);
	const entities = payload.entities.map((entity) => {
		const { entity: built } = BuildEntity(
			buildEntityInput(entity, resolveEntityBlueprintMap(payload)),
			spawnSurfaces,
			payload.world.textureScale,
			faceTextureStore,
			partGeometryCache
		);
		return built;
	});
	if (entities.length > 0) Log("ENGINE", `Entity group created: count=${entities.length}`, "log", "Level");

	let particleGroups = 0;

	// Note: Gather every request first. Generation pushes new groups into `entities`.
	const generatorRequests = [
		...allTerrain.flatMap((mesh) => ParticleGeneratorRequests(mesh, "terrain")),
		...allObstacleRecords.flatMap((record) => ParticleGeneratorRequests(record, "obstacle")),
		...entities.flatMap((entity) => ParticleGeneratorRequests(entity, "entity")),
	];

	generatorRequests.forEach((request) => {
		const { groups } = GenerateParticles(
			request,
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
		obstacles: obstacleRecords,
		voids, waterVisual, chunks, loopSurfaces, tubeCenterlines,
		scatterPrimitiveGeometry: BuildScatterVisualResources(scatterBatches),
		debug                   : {
			showTriggerVolumes: CONFIG.Debug.All === true && CONFIG.Debug.Levels.Triggers === true,
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
		spawnSurfaces,
		meta               : payload.meta,
		pendingFaceTextures: faceTextureStore,
		partGeometryCache,
	};

	RefreshDebugBoundingBoxes(sceneGraph);
	Log(
		"ENGINE",
		`
			Level generation complete: 
			- Terrain=${terrain.length}
			- Obstacles=${obstacleRecords.length}, 
			- VoidTerrain=${voidTerrain.length}, 
			- VoidObstacles=${voidObstacleRecords.length}, 
			- Entities=${entities.length}, 
			- Triggers=${triggers.length}, 
			- ScatterBatches=${scatterBatches.size}, 
			- ScatterInstances=${totalBatchInstances}
		`,
		"log",
		"Level"
	);
	return sceneGraph;
}

export { BuildLevel, RefreshDebugBoundingBoxes };