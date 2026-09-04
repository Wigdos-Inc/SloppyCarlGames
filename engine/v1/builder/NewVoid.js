// Clips void mesh faces to their host solids and builds void wall renderable meshes.
// Called post-build by NewLevel.js to attach a per-pair `relations` map onto each void entry.

// Used by builder/NewLevel.js
// Uses math/Matrix.js, math/Collision.js, builder/NewObject.js

import { CreateModelMatrix, CreateRenderMatrixCache } from "../math/Matrix.js";
import { AabbOverlap, MeshesIntersect, PointInsideMesh, SplitTriangleByPlane, StrictAabbOverlap, TriangleAabb } from "../math/Collision.js";
import { Log } from "../core/meta.js";
import { GenerateUVs, GenerateFaceProjectedUvs, TransformPointByMatrix } from "./NewObject.js";
import { BuildFaceTextureData, BuildNoiseAnimationOptions, ResolveTextureBlueprint, VISUAL_TEMPLATES } from "./NewTexture.js";
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { AddVector3, CrossVector3, DivideVector3, DotVector3, ScaleVector3, SubtractVector3, ToVector3, Vector3Sq, WORLD_NORMALS } from "../math/Vector3.js";

const interiorSampleDepth = new Unit(0.001, "cnu");
const minimumOpenFaceArea = 0.000001;
const cavitySampleCount   = 32;

function windingNormal(a, b, c) {
	const n = CrossVector3(SubtractVector3(b, a), SubtractVector3(c, a));
	return DivideVector3(n, ToVector3(Math.sqrt(Vector3Sq(n))));
}

function computeTriangleNormal(positions, i0, i1, i2) {
	return windingNormal(
		{ x: positions[i0 * 3], y: positions[i0 * 3 + 1], z: positions[i0 * 3 + 2] },
		{ x: positions[i1 * 3], y: positions[i1 * 3 + 1], z: positions[i1 * 3 + 2] },
		{ x: positions[i2 * 3], y: positions[i2 * 3 + 1], z: positions[i2 * 3 + 2] }
	);
}

// World-space plain triangles. Intentionally not UnitVector3 — this is throwaway scratch geometry.
function buildWorldTriangles(mesh) {
	const modelMatrix = CreateModelMatrix(mesh.transform);
	const positions   = mesh.geometry.positions;
	const indices     = mesh.geometry.indices;
	const vertices    = [];

	for (let i = 0; i < positions.length; i += 3) {
		vertices.push(TransformPointByMatrix({ x: positions[i], y: positions[i + 1], z: positions[i + 2] }, modelMatrix));
	}

	const triangles = [];
	for (let i = 0; i < indices.length; i += 3) {
		const a = vertices[indices[i]], b = vertices[indices[i + 1]], c = vertices[indices[i + 2]];
		triangles.push({ a, b, c, normal: windingNormal(a, b, c) });
	}
	return triangles;
}

// Cheap prefilter for cutting planes — an exact graze is a no-op split, not an error.
function planeCrossesTriangle(planeNormal, planeOffset, triangle) {
	let front = 0, back = 0;
	for (const vertex of [triangle.a, triangle.b, triangle.c]) {
		const distance = DotVector3(planeNormal, vertex) - planeOffset;
		if (distance > 0) front++;
		if (distance < 0) back++;
	}
	return front > 0 && back > 0;
}

const triangleArea = (triangle) => {
	return 0.5 * Math.sqrt(Vector3Sq(CrossVector3(
		SubtractVector3(triangle.b, triangle.a), 
		SubtractVector3(triangle.c, triangle.a)
	)));
}

// Lining pieces bucketed by source-face local normal — a clipped sliver can't re-derive one.
function groupCoplanarPieces(triples, normals) {
	const normalGroups = [];
	for (let i = 0; i < triples.length; i += 3) {
		const normal = normals[i / 3];

		let matched = false;
		for (const group of normalGroups) {
			if (DotVector3(group.normal, normal) > 0.9999) {
				group.triples.push(triples[i], triples[i + 1], triples[i + 2]);
				matched = true;
				break;
			}
		}
		if (!matched) normalGroups.push({ normal, triples: [triples[i], triples[i + 1], triples[i + 2]] });
	}
	return normalGroups;
}

// Sampled majority, not per-triangle parity — that would be O(n²) on a ~2000-triangle tube.
function resolveCavitySign(triangles) {
	const step = Math.max(1, Math.floor(triangles.length / cavitySampleCount));
	let inside = 0, sampled = 0;

	for (let i = 0; i < triangles.length; i += step) {
		const triangle = triangles[i];
		const centroid = DivideVector3(AddVector3(AddVector3(triangle.a, triangle.b), triangle.c), ToVector3(3));
		const probe    = AddVector3(centroid, ScaleVector3(triangle.normal, interiorSampleDepth.value));
		if (PointInsideMesh(probe, triangles)) inside++;
		sampled++;
	}

	return inside * 2 >= sampled ? 1 : -1;
}

// One void face in both spaces: local for the lining mesh, world (cavity-facing normal) for clipping.
function buildVoidFaces(voidMesh, voidTriangles) {
	const modelMatrix = CreateModelMatrix(voidMesh.transform);
	const positions   = voidMesh.geometry.positions;
	const indices     = voidMesh.geometry.indices;
	const cavitySign  = resolveCavitySign(voidTriangles);
	const faces       = [];

	for (let i = 0; i < indices.length; i += 3) {
		const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];

		const l0 = { x: positions[i0 * 3], y: positions[i0 * 3 + 1], z: positions[i0 * 3 + 2] };
		const l1 = { x: positions[i1 * 3], y: positions[i1 * 3 + 1], z: positions[i1 * 3 + 2] };
		const l2 = { x: positions[i2 * 3], y: positions[i2 * 3 + 1], z: positions[i2 * 3 + 2] };

		const w0 = TransformPointByMatrix(l0, modelMatrix);
		const w1 = TransformPointByMatrix(l1, modelMatrix);
		const w2 = TransformPointByMatrix(l2, modelMatrix);

		const winding     = CrossVector3(SubtractVector3(w1, w0), SubtractVector3(w2, w0));
		const windingLen  = Math.sqrt(Vector3Sq(winding));
		const unitWinding = windingLen > 0 ? DivideVector3(winding, ToVector3(windingLen)) : WORLD_NORMALS.Up;

		const world = { a: w0, b: w1, c: w2, normal: ScaleVector3(unitWinding, cavitySign) };
		faces.push({
			key        : `${i0}|${i1}|${i2}`,
			indices    : [i0, i1, i2],
			local      : [l0, l1, l2],
			localNormal: computeTriangleNormal(positions, i0, i1, i2),
			basis      : barycentricBasis(w0, w1, w2),
			aabb       : TriangleAabb(world),
			world,
		});
	}

	return faces;
}

// Per-mesh cutting geometry — cached AABBs/plane offsets; candidateIndices only for void solids.
function buildCuttingSolid(triangles, aabb, buildCandidates = false) {
	return {
		triangles,
		triangleAabbs   : triangles.map(TriangleAabb),
		planeOffsets    : triangles.map((triangle) => DotVector3(triangle.normal, triangle.a)),
		candidateIndices: buildCandidates ? triangles.map((_, index) => index) : null,
		aabb,
	};
}

// Deduped cutting planes — the solid's triangles that straddle this triangle.
function collectCrossingPlanes(solid, triangleAabb, triangle) {
	const planes    = [];
	const planeKeys = new Set();

	for (let i = 0; i < solid.triangles.length; i++) {
		if (!AabbOverlap(solid.triangleAabbs[i], triangleAabb)) continue;

		const normal = solid.triangles[i].normal;
		const offset = solid.planeOffsets[i];
		if (!planeCrossesTriangle(normal, offset, triangle)) continue;

		const key = `${Math.round(normal.x * 1e4)}|${Math.round(normal.y * 1e4)}|${Math.round(normal.z * 1e4)}|${Math.round(offset * 1e4)}`;
		if (planeKeys.has(key)) continue;
		planeKeys.add(key);
		planes.push({ normal, offset });
	}

	return planes;
}

// Sampling behind the face is what resolves a cap that sits exactly on the surface.
function pieceInsideSolid(piece, triangles) {
	const centroid = DivideVector3(AddVector3(AddVector3(piece.a, piece.b), piece.c), ToVector3(3));
	const sample   = SubtractVector3(centroid, ScaleVector3(piece.normal, interiorSampleDepth.value));
	return PointInsideMesh(sample, triangles);
}

// Triangle cut by every solid plane that straddles it; pieces outside the solid's AABB dropped.
function splitTriangleBySolid(solid, triangle, triangleAabb) {
	let pieces = [triangle];

	for (const plane of collectCrossingPlanes(solid, triangleAabb, triangle)) {
		const survivors = [];
		for (const piece of pieces) {
			for (const split of SplitTriangleByPlane(piece, plane.normal, plane.offset)) {
				if (AabbOverlap(TriangleAabb(split), solid.aabb)) survivors.push(split);
			}
		}
		pieces = survivors;
	}

	return pieces;
}

// Host surface triangles clipped to the void solid — the exact opening, in the host's own plane.
function clipHostSurfaceToVoid(voidSolid, hostSolid) {
	const openFaces = [];

	for (let i = 0; i < hostSolid.triangles.length; i++) {
		const hostTriangle = hostSolid.triangles[i];
		const hostAabb     = hostSolid.triangleAabbs[i];
		if (!AabbOverlap(hostAabb, voidSolid.aabb)) continue;

		for (const piece of splitTriangleBySolid(voidSolid, hostTriangle, hostAabb)) {
			if (triangleArea(piece) < minimumOpenFaceArea) continue;
			if (!pieceInsideSolid(piece, voidSolid.triangles)) continue;

			openFaces.push({
				a     : new UnitVector3(piece.a.x, piece.a.y, piece.a.z, "cnu"),
				b     : new UnitVector3(piece.b.x, piece.b.y, piece.b.z, "cnu"),
				c     : new UnitVector3(piece.c.x, piece.c.y, piece.c.z, "cnu"),
				normal: new UnitVector3(piece.normal.x, piece.normal.y, piece.normal.z, "cnu"),
			});
		}
	}

	return openFaces;
}

// Kept host surface after one void, appended to `output`. Candidates narrow as pieces shrink.
function carveTriangleByVoid(hostTriangle, voidSolid, output) {
	const stack = [{ piece: hostTriangle, candidates: voidSolid.candidateIndices }];

	while (stack.length > 0) {
		const { piece, candidates } = stack.pop();
		const pieceAabb = TriangleAabb(piece);
		if (!AabbOverlap(pieceAabb, voidSolid.aabb)) { output.push(piece); continue; }

		const near = [];
		for (const index of candidates) if (AabbOverlap(voidSolid.triangleAabbs[index], pieceAabb)) near.push(index);

		let parts = null;
		for (const index of near) {
			const normal = voidSolid.triangles[index].normal;
			const offset = voidSolid.planeOffsets[index];
			if (!planeCrossesTriangle(normal, offset, piece)) continue;

			// `> 1` is the progress guarantee — the splitter's epsilon is stricter than the predicate's.
			const split = SplitTriangleByPlane(piece, normal, offset);
			if (split.length > 1) { parts = split; break; }
		}

		if (parts !== null) {
			for (const part of parts) stack.push({ piece: part, candidates: near });
			continue;
		}

		if (triangleArea(piece) >= minimumOpenFaceArea && pieceInsideSolid(piece, voidSolid.triangles)) continue;
		output.push(piece);
	}
}

// Affine basis for reconstructing a split vertex from its source corners. denominator = 4·area².
function barycentricBasis(a, b, c) {
	const edge0 = SubtractVector3(b, a);
	const edge1 = SubtractVector3(c, a);
	const d00   = DotVector3(edge0, edge0);
	const d01   = DotVector3(edge0, edge1);
	const d11   = DotVector3(edge1, edge1);
	return { edge0, edge1, d00, d01, d11, origin: a, denominator: d00 * d11 - d01 * d01 };
}

function barycentricWeights(basis, point) {
	const offset = SubtractVector3(point, basis.origin);
	const d20    = DotVector3(offset, basis.edge0);
	const d21    = DotVector3(offset, basis.edge1);
	return {
		v: (basis.d11 * d20 - basis.d01 * d21) / basis.denominator,
		w: (basis.d00 * d21 - basis.d01 * d20) / basis.denominator,
	};
}

// Clamped to the source corners — a blended vertex must never widen bounds read off `positions`.
function blendAxis(a0, a1, a2, v, w) {
	return Math.min(Math.max(a0 + v * (a1 - a0) + w * (a2 - a0), Math.min(a0, a1, a2)), Math.max(a0, a1, a2));
}

// Corners keep their source index; clip crossings are blended into local space and deduped per face.
function appendLiningVertex(lining, face, vertex) {
	const corner = vertex === face.world.a ? 0 : vertex === face.world.b ? 1 : vertex === face.world.c ? 2 : -1;
	const key    = corner >= 0
		? `${face.indices[corner]}`
		: `${face.key}|${Math.round(vertex.x * 1e5)}|${Math.round(vertex.y * 1e5)}|${Math.round(vertex.z * 1e5)}`;

	const cached = lining.vertexIds.get(key);
	if (cached !== undefined) return cached;

	const id = lining.positions.length / 3;

	if (corner >= 0) {
		const local = face.local[corner];
		lining.positions.push(local.x, local.y, local.z);
	} 
	else {
		const [p0, p1, p2] = face.local;
		const { v, w }     = barycentricWeights(face.basis, vertex);
		lining.positions.push(
			blendAxis(p0.x, p1.x, p2.x, v, w),
			blendAxis(p0.y, p1.y, p2.y, v, w),
			blendAxis(p0.z, p1.z, p2.z, v, w)
		);
	}

	lining.vertexIds.set(key, id);
	return id;
}

// Void surface clipped to one host solid, minus whatever a neighbouring void already removed.
// Overlapping voids carve a union, so only the union's outer surface may be lined.
function buildHostLining(voidFaces, hostSolid, neighbours) {
	const lining = { positions: [], triples: [], normals: [], worldTriangles: [], vertexIds: new Map() };

	for (const face of voidFaces) {
		if (!AabbOverlap(face.aabb, hostSolid.aabb)) continue;

		let pieces = [];
		for (const piece of splitTriangleBySolid(hostSolid, face.world, face.aabb)) {
			if (triangleArea(piece) < minimumOpenFaceArea) continue;
			if (pieceInsideSolid(piece, hostSolid.triangles)) pieces.push(piece);
		}

		for (const solid of neighbours) {
			if (pieces.length === 0) break;
			if (!AabbOverlap(face.aabb, solid.aabb)) continue;

			const kept = [];
			for (const piece of pieces) carveTriangleByVoid(piece, solid, kept);
			pieces = kept;
		}

		for (const piece of pieces) {
			if (triangleArea(piece) < minimumOpenFaceArea) continue;

			lining.triples.push(
				appendLiningVertex(lining, face, piece.a),
				appendLiningVertex(lining, face, piece.b),
				appendLiningVertex(lining, face, piece.c)
			);
			lining.normals.push(face.localNormal);
			lining.worldTriangles.push({ w0: piece.a, w1: piece.b, w2: piece.c, normal: piece.normal });
		}
	}

	return lining;
}

// Rewrites the host index buffer around its voids. Vertices are appended only, so bounds derived
// from `positions` stay bit-identical.
function carveHostGeometry(hostMesh, voidSolids) {
	const geometry    = hostMesh.geometry;
	const positions   = geometry.positions.slice();
	const uvs         = geometry.uvs.slice();
	const indices     = geometry.indices;
	const modelMatrix = CreateModelMatrix(hostMesh.transform);

	const grouped    = geometry.faceTextureGroups !== undefined;
	const groups     = grouped ? geometry.faceTextureGroups : [{ indexStart: 0, indexCount: indices.length }];
	const newGroups  = [];
	const newIndices = [];
	const appended   = new Map();

	const worldVertex = (index) => TransformPointByMatrix(
		{ x: positions[index * 3], y: positions[index * 3 + 1], z: positions[index * 3 + 2] }, modelMatrix
	);

	for (const group of groups) {
		const groupStart = newIndices.length;
		const groupEnd   = group.indexStart + group.indexCount;

		for (let i = group.indexStart; i < groupEnd; i += 3) {
			const i0 = indices[i], i1 = indices[i + 1], i2 = indices[i + 2];
			const a = worldVertex(i0), b = worldVertex(i1), c = worldVertex(i2);

			const basis = barycentricBasis(a, b, c);
			// Degenerate source (sphere/cone poles): no surface to carve.
			if (basis.denominator === 0) { newIndices.push(i0, i1, i2); continue; }

			const source = { a, b, c, normal: windingNormal(a, b, c) };

			let pieces = [source];
			for (const solid of voidSolids) {
				const kept = [];
				for (const piece of pieces) carveTriangleByVoid(piece, solid, kept);
				pieces = kept;
				if (pieces.length === 0) break;
			}

			if (pieces.length === 1 && pieces[0] === source) { newIndices.push(i0, i1, i2); continue; }

			// Corners keep their original index; crossings are blended and deduped per source triangle.
			const resolveVertex = (vertex) => {
				if (vertex === a) return i0;
				if (vertex === b) return i1;
				if (vertex === c) return i2;

				const key    = `${i0}|${i1}|${i2}|${Math.round(vertex.x * 1e5)}|${Math.round(vertex.y * 1e5)}|${Math.round(vertex.z * 1e5)}`;
				const cached = appended.get(key);
				if (cached !== undefined) return cached;

				const { v, w } = barycentricWeights(basis, vertex);
				const index = positions.length / 3;
				const base0 = i0 * 3, base1 = i1 * 3, base2 = i2 * 3;
				const uv0   = i0 * 2, uv1   = i1 * 2, uv2   = i2 * 2;

				positions.push(
					blendAxis(positions[base0 + 0], positions[base1 + 0], positions[base2 + 0], v, w),
					blendAxis(positions[base0 + 1], positions[base1 + 1], positions[base2 + 1], v, w),
					blendAxis(positions[base0 + 2], positions[base1 + 2], positions[base2 + 2], v, w)
				);
				uvs.push(
					blendAxis(uvs[uv0 + 0], uvs[uv1 + 0], uvs[uv2 + 0], v, w),
					blendAxis(uvs[uv0 + 1], uvs[uv1 + 1], uvs[uv2 + 1], v, w)
				);
				appended.set(key, index);
				return index;
			};

			for (const piece of pieces) newIndices.push(resolveVertex(piece.a), resolveVertex(piece.b), resolveVertex(piece.c));
		}

		const indexCount = newIndices.length - groupStart;
		if (indexCount > 0) newGroups.push({ indexStart: groupStart, indexCount, textureID: group.textureID });
	}

	geometry.positions = positions;
	geometry.uvs       = uvs;
	geometry.indices   = newIndices;
	if (grouped) geometry.faceTextureGroups = newGroups;
}

const queueCarve = (carveQueue, hostMesh, voidSolid) => {
	if (!carveQueue.has(hostMesh)) carveQueue.set(hostMesh, []);
	carveQueue.get(hostMesh).push(voidSolid);
};

function drainCarveQueue(carveQueue) {
	const startedAt = performance.now();
	const totals    = {
		hosts          : carveQueue.size,
		trianglesBefore: 0, trianglesAfter: 0,
		verticesBefore : 0, verticesAfter : 0,
		maxTriangles   : 0, maxTrianglesId: "none",
	};

	for (const [hostMesh, voidSolids] of carveQueue) {
		totals.trianglesBefore += hostMesh.geometry.indices.length / 3;
		totals.verticesBefore  += hostMesh.geometry.positions.length / 3;

		carveHostGeometry(hostMesh, voidSolids);

		const triangles = hostMesh.geometry.indices.length / 3;
		totals.trianglesAfter += triangles;
		totals.verticesAfter  += hostMesh.geometry.positions.length / 3;
		if (triangles > totals.maxTriangles) {
			totals.maxTriangles   = triangles;
			totals.maxTrianglesId = hostMesh.id;
		}
	}

	totals.ms = performance.now() - startedAt;
	return totals;
}

function collectRelationHosts(voidTriangles, voidAabb, hosts) {
	const related = [];
	for (const host of hosts) {
		if (!StrictAabbOverlap(voidAabb, host.mesh.worldAabb)) continue;
		if (!MeshesIntersect(voidTriangles, voidAabb, host.triangles, host.mesh.worldAabb)) continue;
		related.push(host);
	}
	return related;
}

// worldAabb plus floor/wall one-sided "voidWall" soups — split so floor isn't masked by wall.
function buildVoidCollision(worldTriangles) {
	const min = new UnitVector3(Infinity, Infinity, Infinity, "cnu");
	const max = new UnitVector3(-Infinity, -Infinity, -Infinity, "cnu");
	const floorTriangles = [];
	const wallTriangles  = [];

	for (const { w0, w1, w2, normal } of worldTriangles) {
		const triangle = {
			a     : new UnitVector3(w0.x, w0.y, w0.z, "cnu"),
			b     : new UnitVector3(w1.x, w1.y, w1.z, "cnu"),
			c     : new UnitVector3(w2.x, w2.y, w2.z, "cnu"),
			normal: new UnitVector3(normal.x, normal.y, normal.z, "cnu"),
		};
		min.min(triangle.a).min(triangle.b).min(triangle.c);
		max.max(triangle.a).max(triangle.b).max(triangle.c);
		(normal.y > 0 ? floorTriangles : wallTriangles).push(triangle);
	}

	return {
		worldAabb  : { min, max },
		floorBounds: { type: "voidWall", triangles: floorTriangles },
		wallBounds : { type: "voidWall", triangles: wallTriangles },
	};
}

function buildVoidMesh(voidMesh, lining, defaultMesh, textureScale, faceTextureStore) {
	const material        = defaultMesh.material;
	const liningPositions = lining.positions;
	const collision       = buildVoidCollision(lining.worldTriangles);

	const textureBlueprint = VISUAL_TEMPLATES.textures[defaultMesh.detail.texture.id];

	if (textureBlueprint.pattern === "noise") {
		const normalGroups = groupCoplanarPieces(lining.triples, lining.normals);

		const newPositions  = [];
		const newIndices    = [];
		const indexMap      = new Map();
		const faceGroupData = [];

		for (const group of normalGroups) {
			const indexStart = newIndices.length;

			for (const origIdx of group.triples) {
				if (!indexMap.has(origIdx)) {
					indexMap.set(origIdx, newPositions.length / 3);
					newPositions.push(liningPositions[origIdx * 3], liningPositions[origIdx * 3 + 1], liningPositions[origIdx * 3 + 2]);
				}
				newIndices.push(indexMap.get(origIdx));
			}

			const indexCount    = newIndices.length - indexStart;
			const vertexIndices = [...new Set(newIndices.slice(indexStart, indexStart + indexCount))];
			faceGroupData.push({ normal: group.normal, vertexIndices, indexStart, indexCount });
		}

		const positionArray            = new Float32Array(newPositions);
		const { uvs, faceSpans }       = GenerateFaceProjectedUvs(positionArray, faceGroupData, true);
		const resolvedBlueprint = ResolveTextureBlueprint(textureBlueprint, defaultMesh.detail.texture);
		const animationOptions = BuildNoiseAnimationOptions(textureBlueprint, defaultMesh.detail.texture);
		const { faceTextureGroups } = BuildFaceTextureData(
			faceTextureStore, material.textureID, resolvedBlueprint, faceGroupData, faceSpans, textureScale, animationOptions
		);

		const mesh = {
			id               : `${voidMesh.id}-void-${defaultMesh.id}`,
			primitive        : "void",
			dimensions       : voidMesh.dimensions,
			complexity       : "void",
			displayColor     : null,
			displayTransform : voidMesh.transform,
			renderMatrixCache: CreateRenderMatrixCache(voidMesh.transform),
			material         : {
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

		return mesh;
	}

	// Non-noise / tiling branch: flat remapping, per-triangle face groups, tiling UVs.
	const indexMap     = new Map();
	const newPositions = [];
	const newIndices   = [];
	const faceGroups   = [];

	for (const origIdx of lining.triples) {
		if (!indexMap.has(origIdx)) {
			indexMap.set(origIdx, newPositions.length / 3);
			newPositions.push(liningPositions[origIdx * 3], liningPositions[origIdx * 3 + 1], liningPositions[origIdx * 3 + 2]);
		}
		newIndices.push(indexMap.get(origIdx));
	}

	for (let i = 0; i < newIndices.length; i += 3) {
		faceGroups.push({ normal: lining.normals[i / 3], vertexIndices: [newIndices[i], newIndices[i + 1], newIndices[i + 2]] });
	}

	const positionArray = new Float32Array(newPositions);
	const uvs           = GenerateUVs(positionArray, { faceGroups });

	const mesh = {
		id               : `${voidMesh.id}-void-${defaultMesh.id}`,
		primitive        : "void",
		dimensions       : voidMesh.dimensions,
		complexity       : "void",
		displayColor     : null,
		displayTransform : voidMesh.transform,
		renderMatrixCache: CreateRenderMatrixCache(voidMesh.transform),
		material         : {
			textureID   : material.textureID,
			color       : material.color,
			opacity     : material.opacity,
			transparent : material.transparent,
			// Scale 1 makes triplanar's objPos sampling match the planar projection it replaces.
			textureScale: 1,
		},
		geometry: {
			positions: positionArray,
			uvs      : new Float32Array(uvs),
			indices  : new Uint16Array(newIndices),
			triplanar: true,
		},
		worldAabb  : collision.worldAabb,
		floorBounds: collision.floorBounds,
		wallBounds : collision.wallBounds,
	};

	return mesh;
}

// One void↔host pairing. Deferred: a lining can only be cut once every void on that host is known.
function queuePairing(pairings, carveQueue, relations, host, voidMesh, voidFaces, voidSolid) {
	if (!relations[host.recordId]) relations[host.recordId] = { suppressed: true, openFaces: [], voidWallMeshes: [] };
	pairings.push({ relation: relations[host.recordId], host, voidMesh, voidFaces, voidSolid });
	queueCarve(carveQueue, host.mesh, voidSolid);
}

// The host-clipped lining mesh, plus the void-clipped host openings.
function drainPairings(pairings, carveQueue, textureScale, faceTextureStore) {
	for (const { relation, host, voidMesh, voidFaces, voidSolid } of pairings) {
		const neighbours = carveQueue.get(host.mesh).filter((solid) => solid !== voidSolid);
		const lining     = buildHostLining(voidFaces, host.solid, neighbours);

		if (lining.triples.length > 0) {
			relation.voidWallMeshes.push(buildVoidMesh(voidMesh, lining, host.mesh, textureScale, faceTextureStore));
		}

		relation.openFaces.push(...clipHostSurfaceToVoid(voidSolid, host.solid));
	}
}

function accumulateVoidTotals(totals, id, relations) {
	totals.voids++;
	for (const hostId in relations) {
		totals.hosts     ++;
		totals.voidWalls += relations[hostId].voidWallMeshes.length;
		totals.openFaces += relations[hostId].openFaces.length;
		if (relations[hostId].openFaces.length > totals.maxPerHost) {
			totals.maxPerHost   = relations[hostId].openFaces.length;
			totals.maxPerHostId = id;
		}
	}
}

function buildTerrainVoidWalls(sceneGraph, built, pairings, carveQueue) {
	if (sceneGraph.voids.terrain.length === 0) return;

	const hosts = sceneGraph.terrain
		.filter((m) => m.meta.mode === "default" && m.meta.nullable !== false)
		.map((mesh) => {
			const triangles = buildWorldTriangles(mesh);
			return { mesh, recordId: mesh.id, triangles, solid: buildCuttingSolid(triangles, mesh.worldAabb) };
		});

	for (const mesh of sceneGraph.voids.terrain) {
		const voidTriangles = buildWorldTriangles(mesh);
		const voidSolid     = buildCuttingSolid(voidTriangles, mesh.worldAabb, true);
		const voidFaces     = buildVoidFaces(mesh, voidTriangles);
		const relations     = {};

		for (const host of collectRelationHosts(voidTriangles, mesh.worldAabb, hosts)) {
			queuePairing(pairings, carveQueue, relations, host, mesh, voidFaces, voidSolid);
		}

		mesh.relations      = relations;
		mesh.solidTriangles = voidTriangles;
		built.push({ id: mesh.id, relations });
	}
}

function buildObstacleVoidWalls(sceneGraph, built, pairings, carveQueue) {
	if (sceneGraph.voids.obstacles.length === 0) return;

	const hosts = [];
	for (const record of sceneGraph.obstacles) {
		if (record.mode !== "default" || record.nullable === false) continue;
		for (const part of record.parts) {
			const triangles = buildWorldTriangles(part);
			hosts.push({ mesh: part, recordId: record.id, triangles, solid: buildCuttingSolid(triangles, part.worldAabb) });
		}
	}

	for (const record of sceneGraph.voids.obstacles) {
		const relations      = {};
		const solidTriangles = [];
		for (const part of record.parts) {
			const voidTriangles = buildWorldTriangles(part);
			solidTriangles.push(...voidTriangles);
			const voidSolid = buildCuttingSolid(voidTriangles, part.worldAabb, true);
			const voidFaces = buildVoidFaces(part, voidTriangles);

			for (const host of collectRelationHosts(voidTriangles, part.worldAabb, hosts)) {
				queuePairing(pairings, carveQueue, relations, host, part, voidFaces, voidSolid);
			}
		}
		record.relations      = relations;
		record.solidTriangles = solidTriangles;
		built.push({ id: record.id, relations });
	}
}

function BuildVoidWalls(sceneGraph, textureScale, faceTextureStore) {
	const totals     = { voids: 0, hosts: 0, voidWalls: 0, openFaces: 0, maxPerHost: 0, maxPerHostId: "none" };
	const carveQueue = new Map();
	const pairings   = [];
	const built      = [];

	buildTerrainVoidWalls(sceneGraph, built, pairings, carveQueue);
	buildObstacleVoidWalls(sceneGraph, built, pairings, carveQueue);

	drainPairings(pairings, carveQueue, textureScale, faceTextureStore);
	for (const { id, relations } of built) accumulateVoidTotals(totals, id, relations);

	const carve = drainCarveQueue(carveQueue);

	Log("ENGINE", `Void classification complete: voids=${totals.voids}, hosts=${totals.hosts}, voidWalls=${totals.voidWalls}, openFaces=${totals.openFaces}, maxPerHost=${totals.maxPerHost} (${totals.maxPerHostId})`, "log", "Level");
	Log("ENGINE", `Void carve complete: hosts=${carve.hosts}, triangles=${carve.trianglesBefore}→${carve.trianglesAfter}, vertices=${carve.verticesBefore}→${carve.verticesAfter}, maxHostTriangles=${carve.maxTriangles} (${carve.maxTrianglesId}), ms=${carve.ms.toFixed(1)}`, "log", "Level");
}

export { BuildVoidWalls };
