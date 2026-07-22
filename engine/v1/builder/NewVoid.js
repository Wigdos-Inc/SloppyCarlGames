// Classifies void mesh faces as embedded vs open and builds void wall renderable meshes.
// Called post-build by NewLevel.js to attach a per-pair `relations` map onto each void entry.

// Used by builder/NewLevel.js
// Uses math/Matrix.js, math/Collision.js, physics/Collision.js, builder/NewObject.js

import { CreateModelMatrix } from "../math/Matrix.js";
import { AabbOverlap, StrictAabbOverlap } from "../math/Collision.js";
import { NarrowphaseTest } from "../physics/Collision.js";
import { GenerateUVs, GenerateFaceProjectedUvs, TransformPointByMatrix } from "./NewObject.js";
import { BuildFaceTextureData, BuildNoiseAnimationOptions, ResolveNoiseFaceBlueprint, VISUAL_TEMPLATES } from "./NewTexture.js";
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { AddVector3, CrossVector3, DivideVector3, DotVector3, ScaleVector3, SubtractVector3, ToVector3, Vector3Sq, WORLD_NORMALS } from "../math/Vector3.js";

const centroidSphereRadius = new Unit(0.001, "cnu");

function computeTriangleNormal(positions, i0, i1, i2) {
	const a   = { x: positions[i0 * 3], y: positions[i0 * 3 + 1], z: positions[i0 * 3 + 2] };
	const b   = { x: positions[i1 * 3], y: positions[i1 * 3 + 1], z: positions[i1 * 3 + 2] };
	const c   = { x: positions[i2 * 3], y: positions[i2 * 3 + 1], z: positions[i2 * 3 + 2] };
	const n = CrossVector3(SubtractVector3(b, a), SubtractVector3(c, a));
	return DivideVector3(n, ToVector3(Math.sqrt(Vector3Sq(n))));
}

function buildFaceGroupsFromTriangles(positions, indices) {
	const faceGroups = [];
	for (let i = 0; i < indices.length; i += 3) {
		const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
		faceGroups.push({ normal: computeTriangleNormal(positions, i0, i1, i2), vertexIndices: [i0, i1, i2] });
	}
	return faceGroups;
}

function groupCoplanarFaceTriples(srcPositions, faceTriples) {
	const normalGroups = [];
	for (let i = 0; i < faceTriples.length; i += 3) {
		const i0 = faceTriples[i], i1 = faceTriples[i + 1], i2 = faceTriples[i + 2];
		const normal = computeTriangleNormal(srcPositions, i0, i1, i2);

		let matched = false;
		for (const group of normalGroups) {
			if (DotVector3(group.normal, normal) > 0.9999) {
				group.triples.push(i0, i1, i2);
				matched = true;
				break;
			}
		}
		if (!matched) normalGroups.push({ normal, triples: [i0, i1, i2] });
	}
	return normalGroups;
}

function classifyFaces(voidMesh, defaultMeshes) {
	const modelMatrix = CreateModelMatrix(voidMesh.transform);
	const positions   = voidMesh.geometry.positions;
	const indices     = voidMesh.geometry.indices;
	const groups      = new Map();

	// Compute mesh center in CNU by averaging all transformed vertex positions.
	let center = ToVector3(0);
	const vertCount = positions.length / 3;
	for (let i = 0; i < vertCount; i++) {
		center = AddVector3(center, TransformPointByMatrix({ x: positions[i * 3], y: positions[i * 3 + 1], z: positions[i * 3 + 2] }, modelMatrix));
	}
	const meshCenter = DivideVector3(center, ToVector3(vertCount));
	const openFacesByMesh = new Map();

	// Cavity-facing authored normal: winding normal oriented toward the mesh center.
	const cavityNormal = (w0, w1, w2, centroid) => {
		const winding = CrossVector3(SubtractVector3(w1, w0), SubtractVector3(w2, w0));
		const windingLen = Math.sqrt(Vector3Sq(winding));
		const unitWinding = windingLen > 0 ? DivideVector3(winding, ToVector3(windingLen)) : WORLD_NORMALS.Up;
		return DotVector3(unitWinding, SubtractVector3(meshCenter, centroid)) >= 0 ? unitWinding : ScaleVector3(unitWinding, -1);
	};

	for (let i = 0; i < indices.length; i += 3) {
		const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];

		const w0 = TransformPointByMatrix({ x: positions[i0 * 3], y: positions[i0 * 3 + 1], z: positions[i0 * 3 + 2] }, modelMatrix);
		const w1 = TransformPointByMatrix({ x: positions[i1 * 3], y: positions[i1 * 3 + 1], z: positions[i1 * 3 + 2] }, modelMatrix);
		const w2 = TransformPointByMatrix({ x: positions[i2 * 3], y: positions[i2 * 3 + 1], z: positions[i2 * 3 + 2] }, modelMatrix);

		const faceAabb = {
			min: { x: Math.min(w0.x, w1.x, w2.x), y: Math.min(w0.y, w1.y, w2.y), z: Math.min(w0.z, w1.z, w2.z) },
			max: { x: Math.max(w0.x, w1.x, w2.x), y: Math.max(w0.y, w1.y, w2.y), z: Math.max(w0.z, w1.z, w2.z) },
		};
		const centroid = DivideVector3(AddVector3(AddVector3(w0, w1), w2), ToVector3(3));

		let best = null;
		let bestDistSq = Infinity;

		for (const mesh of defaultMeshes) {
			if (!StrictAabbOverlap(faceAabb, mesh.worldAabb)) continue;
			if (!NarrowphaseTest({ type: "sphere", center: centroid, radius: centroidSphereRadius }, mesh.detailedBounds)) continue;

			const sq = Vector3Sq(SubtractVector3(centroid, mesh.worldAabb.min.clone().add(mesh.worldAabb.max).scale(0.5)));
			if (sq < bestDistSq) {
				bestDistSq = sq;
				best = mesh;
			}
		}

		if (best) {
			if (!groups.has(best.id)) groups.set(best.id, { defaultMesh: best, faceTriples: [], worldTriangles: [] });
			const group = groups.get(best.id);
			group.faceTriples.push(i0, i1, i2);
			group.worldTriangles.push({ w0, w1, w2, normal: cavityNormal(w0, w1, w2, centroid) });
		}
		else {
			// Open face: not embedded in a default surface but its inward point is inside one.
			// Keep the world triangle so the opening is stenciled over the surface.
			const d = SubtractVector3(meshCenter, centroid);
			const len = Math.sqrt(Vector3Sq(d));
			if (len === 0) continue;
			const inwardPoint = AddVector3(centroid, ScaleVector3(d, 0.01 / len));
			const normal = cavityNormal(w0, w1, w2, centroid);
			for (const mesh of defaultMeshes) {
				if (!AabbOverlap({ min: inwardPoint, max: inwardPoint }, mesh.worldAabb)) continue;
				if (!NarrowphaseTest({ type: "sphere", center: inwardPoint, radius: centroidSphereRadius }, mesh.detailedBounds)) continue;
				if (!openFacesByMesh.has(mesh.id)) openFacesByMesh.set(mesh.id, []);
				openFacesByMesh.get(mesh.id).push({
					a     : new UnitVector3(w0.x, w0.y, w0.z, "cnu"),
					b     : new UnitVector3(w1.x, w1.y, w1.z, "cnu"),
					c     : new UnitVector3(w2.x, w2.y, w2.z, "cnu"),
					normal: new UnitVector3(normal.x, normal.y, normal.z, "cnu"),
				});
			}
		}
	}

	return { groups, openFacesByMesh };
}

// World-space collision data for a void wall: a broadphase worldAabb plus two
// one-sided "voidWall" triangle soups — floor faces (upward authored normal) and
// the rest (walls/ceilings) — split so the floor contributes its own ground
// contact to the solid pool rather than being masked by a deeper wall contact.
// UnitVector3 instances are created once here, at the build boundary.
function buildVoidCollision(worldTriangles) {
	const min = { x: Infinity, y: Infinity, z: Infinity };
	const max = { x: -Infinity, y: -Infinity, z: -Infinity };
	const floorTriangles = [];
	const wallTriangles  = [];

	for (const { w0, w1, w2, normal } of worldTriangles) {
		for (const vertex of [w0, w1, w2]) {
			if (vertex.x < min.x) min.x = vertex.x;
			if (vertex.y < min.y) min.y = vertex.y;
			if (vertex.z < min.z) min.z = vertex.z;
			if (vertex.x > max.x) max.x = vertex.x;
			if (vertex.y > max.y) max.y = vertex.y;
			if (vertex.z > max.z) max.z = vertex.z;
		}
		const triangle = {
			a     : new UnitVector3(w0.x, w0.y, w0.z, "cnu"),
			b     : new UnitVector3(w1.x, w1.y, w1.z, "cnu"),
			c     : new UnitVector3(w2.x, w2.y, w2.z, "cnu"),
			normal: new UnitVector3(normal.x, normal.y, normal.z, "cnu"),
		};
		(normal.y > 0 ? floorTriangles : wallTriangles).push(triangle);
	}

	return {
		worldAabb: {
			min: new UnitVector3(min.x, min.y, min.z, "cnu"),
			max: new UnitVector3(max.x, max.y, max.z, "cnu"),
		},
		floorBounds: { type: "voidWall", triangles: floorTriangles },
		wallBounds : { type: "voidWall", triangles: wallTriangles },
	};
}

function buildVoidMesh(voidMesh, faceTriples, worldTriangles, defaultMesh, textureScale, faceTextureStore) {
	const material     = defaultMesh.material;
	const srcPositions = voidMesh.geometry.positions;
	const collision    = buildVoidCollision(worldTriangles);

	const textureBlueprint = VISUAL_TEMPLATES.textures[defaultMesh.detail.texture.id];

	if (textureBlueprint.pattern === "noise") {
		const normalGroups = groupCoplanarFaceTriples(srcPositions, faceTriples);

		const newPositions  = [];
		const newIndices    = [];
		const indexMap      = new Map();
		const faceGroupData = [];

		for (const group of normalGroups) {
			const indexStart = newIndices.length;

			for (const origIdx of group.triples) {
				if (!indexMap.has(origIdx)) {
					indexMap.set(origIdx, newPositions.length / 3);
					newPositions.push(srcPositions[origIdx * 3], srcPositions[origIdx * 3 + 1], srcPositions[origIdx * 3 + 2]);
				}
				newIndices.push(indexMap.get(origIdx));
			}

			const indexCount    = newIndices.length - indexStart;
			const vertexIndices = [...new Set(newIndices.slice(indexStart, indexStart + indexCount))];
			faceGroupData.push({ normal: group.normal, vertexIndices, indexStart, indexCount });
		}

		const positionArray            = new Float32Array(newPositions);
		const { uvs, faceSpans }       = GenerateFaceProjectedUvs(positionArray, faceGroupData, true);

		const resolvedBlueprint = ResolveNoiseFaceBlueprint(textureBlueprint, defaultMesh.detail.texture);

		const animationOptions = BuildNoiseAnimationOptions(textureBlueprint, defaultMesh.detail.texture);

		const { faceTextureGroups } = BuildFaceTextureData(
			faceTextureStore, material.textureID, resolvedBlueprint, faceGroupData, faceSpans, textureScale, animationOptions
		);

		const mesh = {
			id              : `${voidMesh.id}-void-${defaultMesh.id}`,
			primitive       : "void",
			dimensions      : voidMesh.dimensions,
			complexity      : "void",
			displayColor    : null,
			displayTransform: voidMesh.transform,
			material        : {
				textureID  : material.textureID,
				color      : material.color,
				opacity    : material.opacity,
				transparent: material.transparent,
			},
			geometry: {
				positions       : positionArray,
				uvs             : new Float32Array(uvs),
				indices         : new Uint16Array(newIndices),
				faceTextureGroups,
			},
			worldAabb  : collision.worldAabb,
			floorBounds: collision.floorBounds,
			wallBounds : collision.wallBounds,
		};

		return { mesh };
	}

	// Non-noise / tiling branch: flat remapping, per-triangle face groups, tiling UVs.
	const indexMap     = new Map();
	const newPositions = [];
	const newIndices   = [];

	for (const origIdx of faceTriples) {
		if (!indexMap.has(origIdx)) {
			indexMap.set(origIdx, newPositions.length / 3);
			newPositions.push(srcPositions[origIdx * 3], srcPositions[origIdx * 3 + 1], srcPositions[origIdx * 3 + 2]);
		}
		newIndices.push(indexMap.get(origIdx));
	}

	const positionArray = new Float32Array(newPositions);
	const faceGroups    = buildFaceGroupsFromTriangles(newPositions, newIndices);
	const uvs           = GenerateUVs(positionArray, { faceGroups });

	const mesh = {
		id              : `${voidMesh.id}-void-${defaultMesh.id}`,
		primitive       : "void",
		dimensions      : voidMesh.dimensions,
		complexity      : "void",
		displayColor    : null,
		displayTransform: voidMesh.transform,
		material        : {
			textureID  : material.textureID,
			color      : material.color,
			opacity    : material.opacity,
			transparent: material.transparent,
		},
		geometry: {
			positions: positionArray,
			uvs      : new Float32Array(uvs),
			indices  : new Uint16Array(newIndices),
		},
		worldAabb  : collision.worldAabb,
		floorBounds: collision.floorBounds,
		wallBounds : collision.wallBounds,
	};

	return { mesh };
}

function getOrCreateRelation(relations, id) {
	if (!relations[id]) relations[id] = { suppressed: true, openFaces: [], voidWallMeshes: [] };
	return relations[id];
}

function buildTerrainVoidWalls(sceneGraph, textureScale, faceTextureStore) {
	for (const mesh of sceneGraph.voids.terrain) {
		const { groups, openFacesByMesh } = classifyFaces(mesh, sceneGraph.terrain.filter((m) => m.meta.mode === "default"));
		const relations = {};

		for (const { defaultMesh, faceTriples, worldTriangles } of groups.values()) {
			const built = buildVoidMesh(mesh, faceTriples, worldTriangles, defaultMesh, textureScale, faceTextureStore);
			const relation = getOrCreateRelation(relations, defaultMesh.id);
			relation.voidWallMeshes.push(built.mesh);
		}

		for (const [id, openFaces] of openFacesByMesh) getOrCreateRelation(relations, id).openFaces.push(...openFaces);

		mesh.relations = relations;
	}
}

function buildObstacleVoidWalls(sceneGraph, textureScale, faceTextureStore) {
	const defaultParts = [], partToRecordId = new Map();
	for (const record of sceneGraph.obstacles) {
		if (record.mode !== "default") continue;
		for (const part of record.parts) {
			defaultParts.push(part);
			partToRecordId.set(part.id, record.id);
		}
	}

	for (const record of sceneGraph.voids.obstacles) {
		const relations = {};
		for (const part of record.parts) {
			const { groups, openFacesByMesh } = classifyFaces(part, defaultParts);

			for (const { defaultMesh, faceTriples, worldTriangles } of groups.values()) {
				const built = buildVoidMesh(part, faceTriples, worldTriangles, defaultMesh, textureScale, faceTextureStore);
				getOrCreateRelation(relations, partToRecordId.get(defaultMesh.id)).voidWallMeshes.push(built.mesh);
			}

			for (const [partId, openFaces] of openFacesByMesh) {
				getOrCreateRelation(relations, partToRecordId.get(partId)).openFaces.push(...openFaces);
			}
		}
		record.relations = relations;
	}
}

function BuildVoidWalls(sceneGraph, textureScale, faceTextureStore) {
	buildTerrainVoidWalls(sceneGraph, textureScale, faceTextureStore);
	buildObstacleVoidWalls(sceneGraph, textureScale, faceTextureStore);
}

export { BuildVoidWalls };
