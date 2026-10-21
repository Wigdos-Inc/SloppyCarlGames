// Builds terrain meshes: single-part objects (legacy path) and flattened multi-part composition.

// Used by NewLevel.js
// Uses NewTemplate.js for template resolution and NewObject.js for meshes
// Uses math/Collision.js for the solid blocker boxes inside each mesh

import { BuildObject } from "./NewObject.js";
import { ResolveObjectSource } from "./NewTemplate.js";
import { PERFORMANCE_SCALING } from "../core/config.js";
import { Log } from "../core/meta.js";
import { AabbLargestFace, InscribedBox, SolidBoxes, VoidCutBoxes } from "../math/Collision.js";
import { CreateModelMatrix, InvertAffineMatrix, TransformPointByMatrix } from "../math/Matrix.js";
import { UnitVector3 } from "../math/Utilities.js";
import { MultiplyVector3 } from "../math/Vector3.js";

function buildSingleTerrain(source, world, faceTextureStore) {
	source.position.y += source.dimensions.y * source.scale.y * 0.5;

	const { mesh } = BuildObject(
		{
			...source,
			id            : source.id,
			role          : "terrain",
			collisionShape: source.collisionShape,
			mode          : source.mode,
			textureScale  : world.textureScale,
			faceTextureStore,
		}
	);

	return [mesh];
}

// Independent flattened meshes: root+local transform composition with per-part grounding.
function buildTerrainParts(source, world, faceTextureStore) {
	return source.parts.map((part, partIndex) => {
		const combinedScale = MultiplyVector3(source.scale, part.localScale);
		const worldPos = source.position.clone().add(MultiplyVector3(part.localPosition, source.scale));
		worldPos.y += part.dimensions.y * combinedScale.y * 0.5;

		const { mesh } = BuildObject(
			{
				...part,
				id            : `${source.id}:${part.id}`,
				position      : worldPos,
				rotation      : source.rotation.clone().add(part.localRotation),
				scale         : combinedScale,
				pivot         : source.pivot,
				detail        : { scatter: part.detail.scatter.length > 0 ? part.detail.scatter : (partIndex === 0 ? source.detail.scatter : []) },
				role          : "terrain",
				collisionShape: source.collisionShape,
				mode          : source.mode,
				nullable      : source.nullable,
				sticky        : source.sticky,
				textureScale  : world.textureScale,
				faceTextureStore,
			}
		);

		return mesh;
	});
}

// A solid piece in the mesh's own space, plus its world corners and world box for the render step.
function occluderPiece(piece, matrix) {
	const corners = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
		const local = { 
			x: i & 1 ? piece.max.x : piece.min.x, 
			y: i & 2 ? piece.max.y : piece.min.y, 
			z: i & 4 ? piece.max.z : piece.min.z 
		};
		const world = TransformPointByMatrix(local, matrix);
		return new UnitVector3(world.x, world.y, world.z, "cnu");
	});

	const worldAabb = { min: corners[0].clone(), max: corners[0].clone() };
	for (const corner of corners) {
		worldAabb.min.min(corner);
		worldAabb.max.max(corner);
	}

	return {
		min : new UnitVector3(piece.min.x, piece.min.y, piece.min.z, "cnu"),
		max : new UnitVector3(piece.max.x, piece.max.y, piece.max.z, "cnu"),
		face: AabbLargestFace(worldAabb),
		corners, worldAabb,
	};
}

// Note: Built once from the build transform. Only opaque default-mode terrain gets blockers.
function buildOccluder(mesh, carvingVoids) {
	const matrix  = CreateModelMatrix(mesh.transform);
	const inverse = InvertAffineMatrix(matrix);
	const inner   = mesh.meta.mode === "default" && !mesh.material.transparent
		? InscribedBox(mesh.primitive, mesh.dimensions, mesh.detail.primitiveOptions)
		: null;
	if (inner === null) return { inverse, pieces: [] };

	const cuts   = carvingVoids.flatMap((voidMesh) => VoidCutBoxes(voidMesh.solidTriangles, voidMesh.centerline, inverse));
	const pieces = SolidBoxes(inner, cuts, mesh.transform.scale, PERFORMANCE_SCALING.Culling.MinBlockerSize);
	return { inverse, pieces: pieces.map((piece) => occluderPiece(piece, matrix)) };
}

// Rebuilds the blockers of every terrain mesh a void cuts into, leaving the opening clear.
function CarveOccluders(terrain, voidTerrain) {
	const voidsByHost = new Map();
	for (const voidMesh of voidTerrain) {
		for (const hostId in voidMesh.relations) {
			if (!voidsByHost.has(hostId)) voidsByHost.set(hostId, []);
			voidsByHost.get(hostId).push(voidMesh);
		}
	}

	for (const mesh of terrain) {
		if (voidsByHost.has(mesh.id)) mesh.occluder = buildOccluder(mesh, voidsByHost.get(mesh.id));
	}
	Log("ENGINE", `Terrain blockers carved: hosts=${voidsByHost.size}`, "log", "Level");
}

function BuildTerrain(objects, world, faceTextureStore) {
	const meshes = [];
	objects.forEach((definition) => {
		const source = ResolveObjectSource(definition, "terrain");
		const built = source.parts.length === 0
			? buildSingleTerrain(source, world, faceTextureStore)
			: buildTerrainParts(source, world, faceTextureStore);
		for (const mesh of built) meshes.push(mesh);
	});

	const terrain     = meshes.filter((mesh) => mesh.meta.mode !== "void");
	const voidTerrain = meshes.filter((mesh) => mesh.meta.mode === "void");
	if (terrain.length > 0) Log("ENGINE", `Terrain object group created: count=${terrain.length}`, "log", "Level");

	// Blockers for every terrain mesh, before any void cuts into them.
	for (const mesh of terrain) mesh.occluder = buildOccluder(mesh, []);

	return { terrain, voidTerrain, meshes };
}

export { BuildTerrain, CarveOccluders };
