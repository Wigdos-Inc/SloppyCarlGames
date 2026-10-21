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
	PointsAabb,
	SplitPolygonByPlane,
	TriangleAabb,
	TriangleArea,
	TriangleCentroid,
	TriangleGridCandidates,
	TriangleNormal
} from "../math/Collision.js";
import { EPSILON, Log } from "../core/meta.js";
import { GenerateUVs, GenerateFaceProjectedUvs } from "./NewObject.js";
import VISUAL_TEMPLATES from "./templates/textures.json" with { type: "json" };
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { AddVector3, ArrayToVector3, DotVector3, ScaleVector3, SubtractVector3, Vector3ToArray } from "../math/Vector3.js";

const interiorSampleDepth = new Unit(0.001, "cnu");
const planeTolerance = 0.0001;

// Convert a mesh to world-space triangles, as plain vectors for temporary cutting math.
function buildWorldTriangles(mesh) {
	const modelMatrix = CreateModelMatrix(mesh.transform);
	const { positions, indices } = mesh.geometry;
	const vertices = [];

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

function polygonArea(polygon) {
	let area = 0;
	for (let i = 2; i < polygon.length; i++) area += TriangleArea(polygon[0], polygon[i - 1], polygon[i]);
	return area;
}

// Check if the plane cuts through the polygon. Only touching it doesn't count.
function planeCrossesPolygon(planeNormal, planeOffset, polygon) {
	let front = 0, back = 0;
	for (const vertex of polygon) {
		const distance = DotVector3(planeNormal, vertex) - planeOffset;
		if (distance > 0) front++;
		if (distance < 0) back++;
	}
	return front > 0 && back > 0;
}

// Group lining triangles that face the same way, using their original face's direction (tiny cut pieces can't give a reliable one).
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

// Find whether the void's triangles face into its cavity (1) or away (-1). Vote over a sample; checking every triangle is too slow on big tubes.
function resolveCavitySign(solid) {
	const step = Math.max(1, Math.floor(solid.triangles.length / 32));
	let inside = 0, sampled = 0;

	for (let i = 0; i < solid.triangles.length; i += step) {
		const triangle = solid.triangles[i];
		const probe    = AddVector3(
			TriangleCentroid(triangle.a, triangle.b, triangle.c), 
			ScaleVector3(triangle.normal, interiorSampleDepth.value)
		);
		if (PointInsideTriangleGrid(probe, solid.grid)) inside++;
		sampled++;
	}

	return inside * 2 >= sampled ? 1 : -1;
}

// Make a local copy of each void triangle for the lining mesh, and a world copy facing into the cavity for cutting.
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

// Build cutting data for one mesh: each triangle's bounds and plane, plus a grid for finding nearby triangles.
function buildCuttingSolid(triangles, aabb) {
	const triangleAabbs = triangles.map(TriangleAabb);
	return {
		triangles,
		triangleAabbs,
		planeOffsets: triangles.map((triangle) => DotVector3(triangle.normal, triangle.a)),
		grid        : BuildTriangleGrid(triangles, triangleAabbs),
		vertices    : [...new Set(triangles.flatMap((triangle) => [triangle.a, triangle.b, triangle.c]))],
		clearSides  : new Array(triangles.length),                // Cached per triangle by clearSideOf.
		aabb,
	};
}

// Find which side of triangle `index` has no part of the solid: 1 front, -1 back, 0 neither. Cache it after first use.
function clearSideOf(solid, index) {
	if (solid.clearSides[index] !== undefined) return solid.clearSides[index];

	const normal = solid.triangles[index].normal, offset = solid.planeOffsets[index];
	let lowest = Infinity, highest = -Infinity;
	for (const vertex of solid.vertices) {
		const distance = DotVector3(normal, vertex) - offset;
		lowest  = Math.min(lowest, distance);
		highest = Math.max(highest, distance);
	}
	return solid.clearSides[index] = highest <= planeTolerance ? 1 : lowest >= -planeTolerance ? -1 : 0;
}

// Check if the piece sits on triangle `index`'s empty side, proving it's outside the solid. Lying flat on the triangle doesn't count.
function outsideByWall(solid, index, polygon) {
	const side = clearSideOf(solid, index);
	if (side === 0) return false;

	const normal    = solid.triangles[index].normal, offset = solid.planeOffsets[index];
	const distances = polygon.map((vertex) => side * (DotVector3(normal, vertex) - offset));
	return distances.every((distance) => distance >= -planeTolerance) && distances.some((distance) => distance > planeTolerance);
}

// Collect the solid's triangle planes that cut through this piece, skipping duplicates.
function collectCrossingPlanes(solid, pieceAabb, polygon) {
	const planes = [], planeKeys = new Set();

	for (const i of TriangleGridCandidates(solid.grid, pieceAabb)) {
		if (!AabbOverlap(solid.triangleAabbs[i], pieceAabb)) continue;

		const normal = solid.triangles[i].normal, offset = solid.planeOffsets[i];
		if (!planeCrossesPolygon(normal, offset, polygon)) continue;

		const calc = (n) => Math.round(n * 1e4);
		const key = `${calc(normal.x)}|${calc(normal.y)}|${calc(normal.z)}|${calc(offset)}`;
		if (planeKeys.has(key)) continue;

		planeKeys.add(key);
		planes.push({ normal, offset });
	}

	return planes;
}

// Check if a point just behind the piece's center is inside the solid (works even for pieces flush with its surface).
function pieceInsideSolid(polygon, normal, solid) {
	const center = ScaleVector3(polygon.reduce((sum, vertex) => AddVector3(sum, vertex)), 1 / polygon.length);
	return PointInsideTriangleGrid(SubtractVector3(center, ScaleVector3(normal, interiorSampleDepth.value)), solid.grid);
}

// Split a piece by every solid plane that crosses it, dropping parts outside the solid's box.
function splitPolygonBySolid(solid, polygon, pieceAabb) {
	let pieces = [polygon];

	for (const plane of collectCrossingPlanes(solid, pieceAabb, polygon)) {
		const survivors = [];
		for (const piece of pieces) {
			for (const split of SplitPolygonByPlane(piece, plane.normal, plane.offset) ?? [piece]) {
				if (AabbOverlap(PointsAabb(split), solid.aabb)) survivors.push(split);
			}
		}
		pieces = survivors;
	}

	return pieces;
}

// Cut the host's surface down to the parts inside the void, giving the exact shape of the opening.
function clipHostSurfaceToVoid(voidSolid, hostSolid) {
	const openFaces = [];
	const toUnit    = (vertex) => new UnitVector3(vertex.x, vertex.y, vertex.z, "cnu");

	for (let i = 0; i < hostSolid.triangles.length; i++) {
		const { a, b, c, normal } = hostSolid.triangles[i];
		const hostAabb = hostSolid.triangleAabbs[i];
		if (!AabbOverlap(hostAabb, voidSolid.aabb)) continue;

		for (const piece of splitPolygonBySolid(voidSolid, [a, b, c], hostAabb)) {
			if (!pieceInsideSolid(piece, normal, voidSolid)) continue;

			for (let corner = 2; corner < piece.length; corner++) {
				if (TriangleArea(piece[0], piece[corner - 1], piece[corner]) < EPSILON) continue;
				openFaces.push({ a: toUnit(piece[0]), b: toUnit(piece[corner - 1]), c: toUnit(piece[corner]), normal: toUnit(normal) });
			}
		}
	}

	return openFaces;
}

// Cut away the parts of a polygon inside one void and append what's left to `output`.
function carvePolygonByVoid(polygon, normal, voidSolid, output) {
	const hostAabb = PointsAabb(polygon);
	if (!AabbOverlap(hostAabb, voidSolid.aabb)) return output.push(polygon);

	const stack = [{ piece: polygon, candidates: TriangleGridCandidates(voidSolid.grid, hostAabb) }];

	while (stack.length > 0) {
		const { piece, candidates } = stack.pop();
		const pieceAabb = PointsAabb(piece);
		if (!AabbOverlap(pieceAabb, voidSolid.aabb)) {
			output.push(piece);
			continue;
		}

		const near = [];
		for (const index of candidates) if (AabbOverlap(voidSolid.triangleAabbs[index], pieceAabb)) near.push(index);

		// Keep the piece whole if a nearby void triangle shows it's outside. Triangles with an empty side are tried first.
		near.sort((first, second) => Math.abs(clearSideOf(voidSolid, second)) - Math.abs(clearSideOf(voidSolid, first)));
		if (near.some((index) => outsideByWall(voidSolid, index, piece))) {
			output.push(piece);
			continue;
		}

		// Only accept a split that actually cuts the piece in two; otherwise the loop could repeat forever.
		let parts = null;
		for (const index of near) {
			parts = SplitPolygonByPlane(piece, voidSolid.triangles[index].normal, voidSolid.planeOffsets[index]);
			if (parts !== null) break;
		}

		if (parts !== null) {
			for (const part of parts) stack.push({ piece: part, candidates: near });
			continue;
		}

		if (polygonArea(piece) >= EPSILON && pieceInsideSolid(piece, normal, voidSolid)) continue;
		output.push(piece);
	}
}

// Precompute values for locating a point within a triangle, used to rebuild split vertices.
function barycentricBasis(a, b, c) {
	const edge0 = SubtractVector3(b, a), edge1 = SubtractVector3(c, a);
	const d00   = DotVector3(edge0, edge0), d01   = DotVector3(edge0, edge1), d11   = DotVector3(edge1, edge1);
	return { edge0, edge1, d00, d01, d11, origin: a, denominator: d00 * d11 - d01 * d01 };
}

function barycentricWeights(basis, point) {
	const offset = SubtractVector3(point, basis.origin);
	const d20    = DotVector3(offset, basis.edge0), d21    = DotVector3(offset, basis.edge1);
	return {
		v: (basis.d11 * d20 - basis.d01 * d21) / basis.denominator,
		w: (basis.d00 * d21 - basis.d01 * d20) / basis.denominator,
	};
}

// Blend one coordinate across a triangle's corners, clamped to their range to never grow the bounds.
function blendAxis(a0, a1, a2, v, w) {
	return Math.min(Math.max(a0 + v * (a1 - a0) + w * (a2 - a0), Math.min(a0, a1, a2)), Math.max(a0, a1, a2));
}

// Return a lining vertex id. Reuse original corner ids; give new cut points a local-space vertex shared within the face.
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

// Build the void's lining inside one host, skipping parts that a neighbouring void already opens up.
function buildHostLining(voidFaces, hostSolid, neighbours) {
	const lining = { positions: [], triples: [], normals: [], worldTriangles: [], vertexIds: new Map() };

	for (const face of voidFaces) {
		if (!AabbOverlap(face.aabb, hostSolid.aabb)) continue;

		const { a, b, c, normal } = face.world;

		let pieces = [];
		for (const piece of splitPolygonBySolid(hostSolid, [a, b, c], face.aabb)) {
			if (polygonArea(piece) < EPSILON) continue;
			if (pieceInsideSolid(piece, normal, hostSolid)) pieces.push(piece);
		}

		for (const solid of neighbours) {
			if (pieces.length === 0) break;
			if (!AabbOverlap(face.aabb, solid.aabb)) continue;

			const kept = [];
			for (const piece of pieces) carvePolygonByVoid(piece, normal, solid, kept);
			pieces = kept;
		}

		for (const piece of pieces) {
			const ids = piece.map((vertex) => appendLiningVertex(lining, face, vertex));

			for (let corner = 2; corner < piece.length; corner++) {
				if (TriangleArea(piece[0], piece[corner - 1], piece[corner]) < EPSILON) continue;

				if (face.flipWinding) lining.triples.push(ids[0], ids[corner], ids[corner - 1]);
				else lining.triples.push(ids[0], ids[corner - 1], ids[corner]);

				lining.normals.push(face.localNormal);
				lining.worldTriangles.push({ w0: piece[0], w1: piece[corner - 1], w2: piece[corner], normal });
			}
		}
	}

	return lining;
}

// Cut the voids out of the host's triangles. Existing vertices never move, keeping the host's bounds valid.
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

			// Keep zero-area triangles (sphere and cone tips) as they are; there's nothing to cut.
			const basis = barycentricBasis(a, b, c);
			if (basis.denominator === 0) {
				newIndices.push(i0, i1, i2);
				continue;
			}

			const source = [a, b, c];
			const normal = TriangleNormal(a, b, c);

			let pieces = [source];
			for (const solid of voidSolids) {
				const kept = [];
				for (const piece of pieces) carvePolygonByVoid(piece, normal, solid, kept);
				pieces = kept;
				if (pieces.length === 0) break;
			}

			if (pieces.length === 1 && pieces[0] === source) {
				newIndices.push(i0, i1, i2);
				continue;
			}

			// Reuse original corner indices; give new cut points a blended vertex shared within this triangle.
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

			for (const piece of pieces) {
				const ids = piece.map(resolveVertex);
				for (let corner = 2; corner < ids.length; corner++) newIndices.push(ids[0], ids[corner - 1], ids[corner]);
			}
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

// Build collision bounds for a lining. Keep floor and walls apart so a wall contact can't hide the floor contact.
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
	const material  = defaultMesh.material;
	const collision = buildVoidCollision(lining.worldTriangles);
	const textureBlueprint = VISUAL_TEMPLATES.textures[defaultMesh.detail.texture.id];

	if (textureBlueprint.pattern === "noise") {
		const normalGroups = groupCoplanarPieces(lining.triples, lining.normals);

		const newPositions = [], newIndices = [], faceGroupData = [];
		const indexMap      = new Map();

		for (const group of normalGroups) {
			const indexStart = newIndices.length;

			for (const origIdx of group.triples) {
				if (!indexMap.has(origIdx)) {
					indexMap.set(origIdx, newPositions.length / 3);
					newPositions.push(...Vector3ToArray(ArrayToVector3(lining.positions, origIdx, true)));
				}
				newIndices.push(indexMap.get(origIdx));
			}

			const indexCount    = newIndices.length - indexStart;
			const vertexIndices = [...new Set(newIndices.slice(indexStart, indexStart + indexCount))];
			faceGroupData.push({ normal: group.normal, vertexIndices, indexStart, indexCount });
		}

		const positionArray = new Float32Array(newPositions);

		// Scale position-based UVs to the texture's tile size, instead of fitting the whole texture onto each small curved face.
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
			// Give every lining its host's texture so the registry can resolve its id.
			detail           : { texture: defaultMesh.detail.texture },
			geometry: {
				positions       : positionArray,
				uvs             : new Float32Array(uvs),
				indices         : new Uint16Array(newIndices),
			},
			worldAabb  : collision.worldAabb,
			floorBounds: collision.floorBounds,
			wallBounds : collision.wallBounds,
			occluded   : false,
		};

		return mesh;
	}

	// Other textures: use one face group per triangle, with tiling UVs.
	const indexMap     = new Map();
	const newPositions = [], newIndices = [], faceGroups = [];

	for (const origIdx of lining.triples) {
		if (!indexMap.has(origIdx)) {
			indexMap.set(origIdx, newPositions.length / 3);
			newPositions.push(...Vector3ToArray(ArrayToVector3(lining.positions, origIdx, true)));
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
		occluded   : false,
	};

	return mesh;
}

// Record a void and host to process later, once every void touching that host is known.
function queuePairing(pairings, carveQueue, relations, host, voidMesh, voidFaces, voidSolid) {
	if (!relations[host.recordId]) {
		relations[host.recordId] = { suppressed: true, openFaces: [], voidWallMeshes: [] };
	}
	pairings.push({ relation: relations[host.recordId], host, voidMesh, voidFaces, voidSolid });
	queueCarve(carveQueue, host.mesh, voidSolid);
}

// Build each pairing's lining mesh and the opening it cuts in its host.
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
