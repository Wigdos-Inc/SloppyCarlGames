// Clips void mesh faces to their host solids and builds void wall renderable meshes.
// Called post-build by NewLevel.js to attach a per-pair `relations` map onto each void entry.

// Used by builder/NewLevel.js
// Uses math/Matrix.js, math/Collision.js, builder/NewObject.js

import { CreateModelMatrix, CreateRenderMatrixCache, TransformPointByMatrix } from "../math/Matrix.js";
import {
	AabbOverlap,
	BuildTriangleGrid,
	MeshesIntersect,
	PointInsideTriangleGrid,
	SplitTriangleByPlane,
	TriangleAabb,
	TriangleArea,
	TriangleCentroid,
	TriangleGridCandidates,
	TriangleNormal
} from "../math/Collision.js";
import { Log } from "../core/meta.js";
import { GenerateUVs, GenerateFaceProjectedUvs } from "./NewObject.js";
import VISUAL_TEMPLATES from "./templates/textures.json" with { type: "json" };
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { AddVector3, ArrayToVector3, DotVector3, ScaleVector3, SubtractVector3, Vector3ToArray } from "../math/Vector3.js";

const interiorSampleDepth = new Unit(0.001, "cnu");
const minimumOpenFaceArea = 0.000001;

// World-space plain triangles. Intentionally not UnitVector3 — this is throwaway scratch geometry.
function buildWorldTriangles(mesh) {
	const modelMatrix = CreateModelMatrix(mesh.transform);
	const { positions, indices } = mesh.geometry;
	const vertices    = [];

	for (let i = 0; i < positions.length / 3; i++) {
		vertices.push(TransformPointByMatrix(ArrayToVector3(positions, i, true), modelMatrix));
	}

	const triangles = [];
	for (let i = 0; i < indices.length; i += 3) {
		const a = vertices[indices[i]], b = vertices[indices[i + 1]], c = vertices[indices[i + 2]];
		triangles.push({ a, b, c, normal: TriangleNormal(a, b, c) });
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

// Lining pieces bucketed by source-face local normal — a clipped sliver can't re-derive one.
function groupCoplanarPieces(triples, normals) {
	const normalGroups = [];
	for (let i = 0; i < triples.length; i += 3) {
		const normal = normals[i / 3];

		let matched = false;
		for (const group of normalGroups) {
			if (DotVector3(group.normal, normal) > 0.9999) {
				group.triples.push(...Vector3ToArray(ArrayToVector3(triples, i)));
				matched = true;
				break;
			}
		}
		if (!matched) normalGroups.push({ normal, triples: Vector3ToArray(ArrayToVector3(triples, i)) });
	}
	return normalGroups;
}

// Checks a sample of triangles and takes the majority vote, instead of testing every one (too slow on big tubes).
function resolveCavitySign(solid) {
	const { triangles } = solid;
	const step = Math.max(1, Math.floor(triangles.length / 32));
	let inside = 0, sampled = 0;

	for (let i = 0; i < triangles.length; i += step) {
		const triangle = triangles[i];
		const probe    = AddVector3(
			TriangleCentroid(triangle.a, triangle.b, triangle.c), 
			ScaleVector3(triangle.normal, interiorSampleDepth.value)
		);
		if (PointInsideTriangleGrid(probe, solid.grid)) inside++;
		sampled++;
	}

	return inside * 2 >= sampled ? 1 : -1;
}

// One void face in both spaces: local for the lining mesh, world (cavity-facing normal) for clipping.
function buildVoidFaces(voidMesh, voidSolid) {
	const modelMatrix = CreateModelMatrix(voidMesh.transform);
	const indices     = voidMesh.geometry.indices;
	const cavitySign  = resolveCavitySign(voidSolid);
	const faces       = [];

	for (let i = 0; i < indices.length; i += 3) {
		const { x: i0, y: i1, z: i2 } = ArrayToVector3(indices, i);

		const l0 = ArrayToVector3(voidMesh.geometry.positions, i0, true);
		const l1 = ArrayToVector3(voidMesh.geometry.positions, i1, true);
		const l2 = ArrayToVector3(voidMesh.geometry.positions, i2, true);

		const w0 = TransformPointByMatrix(l0, modelMatrix);
		const w1 = TransformPointByMatrix(l1, modelMatrix);
		const w2 = TransformPointByMatrix(l2, modelMatrix);

		const world = { a: w0, b: w1, c: w2, normal: ScaleVector3(TriangleNormal(w0, w1, w2), cavitySign) };
		faces.push({
			key        : `${i0}|${i1}|${i2}`,
			indices    : [i0, i1, i2],
			local      : [l0, l1, l2],
			localNormal: TriangleNormal(l0, l1, l2),
			basis      : barycentricBasis(w0, w1, w2),
			aabb       : TriangleAabb(world),
			flipWinding: cavitySign < 0,                       // Reverse lining to face the cavity.
			world,
		});
	}

	return faces;
}

// Cutting data for one mesh: each triangle's bounds and plane, plus a grid for finding nearby triangles.
function buildCuttingSolid(triangles, aabb) {
	const triangleAabbs = triangles.map(TriangleAabb);
	return {
		triangles,
		triangleAabbs,
		planeOffsets: triangles.map((triangle) => DotVector3(triangle.normal, triangle.a)),
		grid        : BuildTriangleGrid(triangles, triangleAabbs),
		aabb,
	};
}

// Deduped cutting planes — the solid's triangles that straddle this triangle.
function collectCrossingPlanes(solid, triangleAabb, triangle) {
	const planes = [], planeKeys = new Set();

	for (const i of TriangleGridCandidates(solid.grid, triangleAabb)) {
		if (!AabbOverlap(solid.triangleAabbs[i], triangleAabb)) continue;

		const normal = solid.triangles[i].normal, offset = solid.planeOffsets[i];
		if (!planeCrossesTriangle(normal, offset, triangle)) continue;

		const key = `
			${Math.round(normal.x * 1e4)}|
			${Math.round(normal.y * 1e4)}|
			${Math.round(normal.z * 1e4)}|
			${Math.round(offset * 1e4)}
		`;
		if (planeKeys.has(key)) continue;

		planeKeys.add(key);
		planes.push({ normal, offset });
	}

	return planes;
}

// Sampling behind the face is what resolves a cap that sits exactly on the surface.
function pieceInsideSolid(piece, solid) {
	const sample = SubtractVector3(
		TriangleCentroid(piece.a, piece.b, piece.c), 
		ScaleVector3(piece.normal, interiorSampleDepth.value)
	);
	return PointInsideTriangleGrid(sample, solid.grid);
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

		for (const piece of splitTriangleBySolid(voidSolid, hostSolid.triangles[i], hostAabb)) {
			const { a, b, c, normal } = piece;
			if (TriangleArea(a, b, c) < minimumOpenFaceArea) continue;
			if (!pieceInsideSolid(piece, voidSolid)) continue;

			openFaces.push({
				a     : new UnitVector3(a.x, a.y, a.z, "cnu"),
				b     : new UnitVector3(b.x, b.y, b.z, "cnu"),
				c     : new UnitVector3(c.x, c.y, c.z, "cnu"),
				normal: new UnitVector3(normal.x, normal.y, normal.z, "cnu"),
			});
		}
	}

	return openFaces;
}

// Kept host surface after one void, appended to `output`. Candidates narrow as pieces shrink.
function carveTriangleByVoid(hostTriangle, voidSolid, output) {
	const hostAabb = TriangleAabb(hostTriangle);
	if (!AabbOverlap(hostAabb, voidSolid.aabb)) { output.push(hostTriangle); return; }

	const stack = [{ piece: hostTriangle, candidates: TriangleGridCandidates(voidSolid.grid, hostAabb) }];

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

			// Only accept a split that actually cuts the piece in two; otherwise the loop could repeat forever.
			const split = SplitTriangleByPlane(piece, normal, offset);
			if (split.length > 1) { parts = split; break; }
		}

		if (parts !== null) {
			for (const part of parts) stack.push({ piece: part, candidates: near });
			continue;
		}

		if (TriangleArea(piece.a, piece.b, piece.c) >= minimumOpenFaceArea && pieceInsideSolid(piece, voidSolid)) continue;
		output.push(piece);
	}
}

// Precomputed values for locating a point within a triangle, used to rebuild split vertices.
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

// Kept within the source corners, so a blended vertex never grows the bounds.
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
			if (TriangleArea(piece.a, piece.b, piece.c) < minimumOpenFaceArea) continue;
			if (pieceInsideSolid(piece, hostSolid)) pieces.push(piece);
		}

		for (const solid of neighbours) {
			if (pieces.length === 0) break;
			if (!AabbOverlap(face.aabb, solid.aabb)) continue;

			const kept = [];
			for (const piece of pieces) carveTriangleByVoid(piece, solid, kept);
			pieces = kept;
		}

		for (const piece of pieces) {
			if (TriangleArea(piece.a, piece.b, piece.c) < minimumOpenFaceArea) continue;

			const a = appendLiningVertex(lining, face, piece.a);
			const b = appendLiningVertex(lining, face, piece.b);
			const c = appendLiningVertex(lining, face, piece.c);
			if (face.flipWinding) lining.triples.push(a, c, b);
			else lining.triples.push(a, b, c);
			lining.normals.push(face.localNormal);
			lining.worldTriangles.push({ w0: piece.a, w1: piece.b, w2: piece.c, normal: piece.normal });
		}
	}

	return lining;
}

// Rewrites the host index buffer around its voids. Vertices are only appended, so bounds from `positions` don't change.
function carveHostGeometry(hostMesh, voidSolids) {
	const { positions, uvs, indices, faceTextureGroups } = hostMesh.geometry;
	const posSliced = positions.slice(), uvsSliced = uvs.slice();

	const grouped    = faceTextureGroups !== undefined;
	const groups     = grouped ? faceTextureGroups : [{ indexStart: 0, indexCount: indices.length }];
	const newGroups  = [], newIndices = [], appended = new Map();

	const modelMatrix = CreateModelMatrix(hostMesh.transform);
	const worldVertex = (index) => TransformPointByMatrix(ArrayToVector3(posSliced, index, true), modelMatrix);

	for (const group of groups) {
		const groupStart = newIndices.length;
		for (let i = group.indexStart; i < (group.indexStart + group.indexCount); i += 3) {
			const { x: i0, y: i1, z: i2 } = ArrayToVector3(indices, i);
			const a = worldVertex(i0), b = worldVertex(i1), c = worldVertex(i2);

			// Degenerate source (sphere/cone poles): no surface to carve.
			const basis = barycentricBasis(a, b, c);
			if (basis.denominator === 0) { newIndices.push(i0, i1, i2); continue; }

			const source = { a, b, c, normal: TriangleNormal(a, b, c) };

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
				switch (vertex) {
					case a: return i0;
					case b: return i1;
					case c: return i2;
				}

				const key    = `
					${i0}|${i1}|${i2}|
					${Math.round(vertex.x * 1e5)}|
					${Math.round(vertex.y * 1e5)}|
					${Math.round(vertex.z * 1e5)}
				`;
				const cached = appended.get(key);
				if (cached !== undefined) return cached;

				const { v, w } = barycentricWeights(basis, vertex);
				const index = posSliced.length / 3;
				const base0 = i0 * 3, base1 = i1 * 3, base2 = i2 * 3;
				const uv0   = i0 * 2, uv1   = i1 * 2, uv2   = i2 * 2;

				posSliced.push(
					blendAxis(posSliced[base0 + 0], posSliced[base1 + 0], posSliced[base2 + 0], v, w),
					blendAxis(posSliced[base0 + 1], posSliced[base1 + 1], posSliced[base2 + 1], v, w),
					blendAxis(posSliced[base0 + 2], posSliced[base1 + 2], posSliced[base2 + 2], v, w)
				);
				uvsSliced.push(
					blendAxis(uvsSliced[uv0 + 0], uvsSliced[uv1 + 0], uvsSliced[uv2 + 0], v, w),
					blendAxis(uvsSliced[uv0 + 1], uvsSliced[uv1 + 1], uvsSliced[uv2 + 1], v, w)
				);

				appended.set(key, index);
				return index;
			};

			for (const piece of pieces) newIndices.push(resolveVertex(piece.a), resolveVertex(piece.b), resolveVertex(piece.c));
		}

		const indexCount = newIndices.length - groupStart;
		if (indexCount > 0) newGroups.push({ indexStart: groupStart, indexCount, textureID: group.textureID });
	}

	hostMesh.geometry.positions = posSliced;
	hostMesh.geometry.uvs       = uvsSliced;
	hostMesh.geometry.indices   = newIndices;
	if (grouped) hostMesh.geometry.faceTextureGroups = newGroups;
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

function collectRelationHosts(voidSolid, hosts) {
	const related = [];
	for (const host of hosts) {
		if (!AabbOverlap(voidSolid.aabb, host.mesh.worldAabb, true)) continue;

		// Build the host's cutting data on its first overlap with a void.
		if (host.solid === null) host.solid = buildCuttingSolid(buildWorldTriangles(host.mesh), host.mesh.worldAabb);
		if (!MeshesIntersect(voidSolid, host.solid)) continue;
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

function buildVoidMesh(voidMesh, lining, defaultMesh, textureScale) {
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
					newPositions.push(...Vector3ToArray(ArrayToVector3(liningPositions, origIdx, true)));
				}
				newIndices.push(indexMap.get(origIdx));
			}

			const indexCount    = newIndices.length - indexStart;
			const vertexIndices = [...new Set(newIndices.slice(indexStart, indexStart + indexCount))];
			faceGroupData.push({ normal: group.normal, vertexIndices, indexStart, indexCount });
		}

		const positionArray = new Float32Array(newPositions);

		// Raw UVs scaled to the tile's world size — per-face bakes collapse to 1x1 on curved facets.
		const uvs       = GenerateFaceProjectedUvs(positionArray, faceGroupData, false);
		for (let i = 0; i < uvs.length; i++) uvs[i] *= (textureScale / textureBlueprint.size);

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
			// Every lining carries its host's texture so the registry can resolve its id.
			detail           : { texture: defaultMesh.detail.texture },
			geometry: {
				positions       : positionArray,
				uvs             : new Float32Array(uvs),
				indices         : new Uint16Array(newIndices),
			},
			worldAabb  : collision.worldAabb,
			floorBounds: collision.floorBounds,
			wallBounds : collision.wallBounds,
		};

		return mesh;
	}

	// Non-noise / tiling branch: flat remapping, per-triangle face groups, tiling UVs.
	const indexMap     = new Map();
	const newPositions = [], newIndices = [], faceGroups = [];

	for (const origIdx of lining.triples) {
		if (!indexMap.has(origIdx)) {
			indexMap.set(origIdx, newPositions.length / 3);
			newPositions.push(...Vector3ToArray(ArrayToVector3(liningPositions, origIdx, true)));
		}
		newIndices.push(indexMap.get(origIdx));
	}

	for (let i = 0; i < newIndices.length; i += 3) {
		faceGroups.push({ 
			normal: lining.normals[i / 3], 
			vertexIndices: Vector3ToArray(ArrayToVector3(newIndices, i))
		});
	}

	const positionArray = new Float32Array(newPositions);
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
			textureScale: 1,
		},
		detail           : { texture: defaultMesh.detail.texture },
		geometry: {
			positions: positionArray,
			uvs      : new Float32Array(GenerateUVs(positionArray, { faceGroups })),
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
	if (!relations[host.recordId]) {
		relations[host.recordId] = { suppressed: true, openFaces: [], voidWallMeshes: [] };
	}
	pairings.push({ relation: relations[host.recordId], host, voidMesh, voidFaces, voidSolid });
	queueCarve(carveQueue, host.mesh, voidSolid);
}

// The host-clipped lining mesh, plus the void-clipped host openings.
function drainPairings(pairings, carveQueue, textureScale) {
	for (const { relation, host, voidMesh, voidFaces, voidSolid } of pairings) {
		const neighbours = carveQueue.get(host.mesh).filter((solid) => solid !== voidSolid);
		const lining     = buildHostLining(voidFaces, host.solid, neighbours);
		if (lining.triples.length > 0) {
			relation.voidWallMeshes.push(buildVoidMesh(voidMesh, lining, host.mesh, textureScale));
		}

		// Note: Push one face at a time. Spreading a large carve into one push overflows the call stack.
		for (const face of clipHostSurfaceToVoid(voidSolid, host.solid)) relation.openFaces.push(face);
	}
}

function accumulateVoidTotals(totals, id, relations) {
	totals.voids++;
	for (const hostId in relations) {
		totals.hosts++;
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
		.map((mesh) => ({ mesh, recordId: mesh.id, solid: null }));

	for (const mesh of sceneGraph.voids.terrain) {
		const voidTriangles = buildWorldTriangles(mesh);
		const voidSolid     = buildCuttingSolid(voidTriangles, mesh.worldAabb);
		const related       = collectRelationHosts(voidSolid, hosts);
		const relations     = {};

		if (related.length > 0) {
			const voidFaces = buildVoidFaces(mesh, voidSolid);
			for (const host of related) queuePairing(pairings, carveQueue, relations, host, mesh, voidFaces, voidSolid);
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
		for (const part of record.parts) hosts.push({ mesh: part, recordId: record.id, solid: null });
	}

	for (const record of sceneGraph.voids.obstacles) {
		const relations = {}, solidTriangles = [];
		for (const part of record.parts) {
			const voidTriangles = buildWorldTriangles(part);
			for (const triangle of voidTriangles) solidTriangles.push(triangle);

			const voidSolid = buildCuttingSolid(voidTriangles, part.worldAabb);
			const related   = collectRelationHosts(voidSolid, hosts);
			if (related.length === 0) continue;

			const voidFaces = buildVoidFaces(part, voidSolid);
			for (const host of related) {
				queuePairing(pairings, carveQueue, relations, host, part, voidFaces, voidSolid);
			}
		}
		record.relations      = relations;
		record.solidTriangles = solidTriangles;
		built.push({ id: record.id, relations });
	}
}

function BuildVoidWalls(sceneGraph, textureScale) {
	const totals     = { voids: 0, hosts: 0, voidWalls: 0, openFaces: 0, maxPerHost: 0, maxPerHostId: "none" };
	const carveQueue = new Map();
	const pairings   = [], built = [];
	const startedAt  = performance.now();

	buildTerrainVoidWalls(sceneGraph, built, pairings, carveQueue);
	buildObstacleVoidWalls(sceneGraph, built, pairings, carveQueue);

	drainPairings(pairings, carveQueue, textureScale);
	for (const { id, relations } of built) accumulateVoidTotals(totals, id, relations);
	const classifyMs = performance.now() - startedAt;

	const carve = drainCarveQueue(carveQueue);

	Log("ENGINE", `Void classification complete: voids=${totals.voids}, hosts=${totals.hosts}, voidWalls=${totals.voidWalls}, openFaces=${totals.openFaces}, maxPerHost=${totals.maxPerHost} (${totals.maxPerHostId}), ms=${classifyMs.toFixed(1)}`, "log", "Level");
	Log("ENGINE", `Void carve complete: hosts=${carve.hosts}, triangles=${carve.trianglesBefore}→${carve.trianglesAfter}, vertices=${carve.verticesBefore}→${carve.verticesAfter}, maxHostTriangles=${carve.maxTriangles} (${carve.maxTrianglesId}), ms=${carve.ms.toFixed(1)}`, "log", "Level");
}

export { BuildVoidWalls };
