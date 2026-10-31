// Groups touching terrain into chunks, linking every pair of touching triangles along the way.

// Used by builder/NewLevel.js to group a level's terrain into chunks.
// Uses math/Geometry.js to measure triangles, fit boxes to collision shapes and group linked pieces.
// Uses math/Collision.js to find touching triangles.
// Uses physics/Collision.js to leave out triangles inside voids.

import { EPSILON, Log } from "../../core/meta.js";
import { AabbOverlap, TriangleDistanceSq } from "../../math/Collision.js";
import { FindRoot, JoinRoots, MakeRoots, ObbFromAabb, TriangleAabb, TriangleCentroid } from "../../math/Geometry.js";
import { AddVector3, AngleBetweenVector3, DotVector3, ScaleVector3, SubtractVector3, ToVector3, Vector3ToArray } from "../../math/Vector3.js";
import { IsCutByVoid } from "../../physics/Collision.js";

// Split a box into 12 triangles facing outward.
function boxFacets({ center, axes, halfExtents }) {
	const facets = [], extents = Vector3ToArray(halfExtents);
	for (let axis = 0; axis < 3; axis++) {
		const u = (axis + 1) % 3, v = (axis + 2) % 3;
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

// Group touching terrain and void linings into chunks. Return the linked triangles with them.
function AssembleTerrainChunks(terrain, voidTerrain) {
	const started = performance.now();

	// Make one piece per surface: its triangles outside voids, plus each void's wall lining.
	const pieces = [];
	const centroid = (f) => TriangleCentroid(f.a, f.b, f.c);
	for (const mesh of terrain) {
		// List the mesh's collision triangles. Shapes without flat faces give none.
		let facets = [];
		switch (mesh.detailedBounds?.type) {
			case "triangle-soup": facets = mesh.detailedBounds.triangles;               break;
			case "obb"          : facets = boxFacets(mesh.detailedBounds);              break;
			case "aabb"         : facets = boxFacets(ObbFromAabb(mesh.detailedBounds)); break;
		}

		const { id, worldAabb, meta } = mesh;
		pieces.push({ 
			id, worldAabb, 
			facets: facets.filter((f) => !(meta.nullable !== false && IsCutByVoid(centroid(f), id, voidTerrain)))
		});
	}
	for (const voidMesh of voidTerrain) {
		const lining = [];
		for (const hostId in voidMesh.relations) {
			for (const wall of voidMesh.relations[hostId].voidWallMeshes) {
				for (const triangle of wall.floorBounds.triangles) lining.push(triangle);
				for (const triangle of wall.wallBounds.triangles)  lining.push(triangle);
			}
		}
		if (lining.length > 0) pieces.push({ id: voidMesh.id, worldAabb: voidMesh.worldAabb, facets: lining });
	}

	// Grow bounds by an EPSILON for accurate touching.
	const expand = (aabb) => ({ min: SubtractVector3(aabb.min, ToVector3(EPSILON)), max: AddVector3(aabb.max, ToVector3(EPSILON)) });
	const facets = [], owner = [], links = [];

	// Link two facets, marking how they bend (inward like a loop, or outward like a crest).
	const link = (a, b) => {
		const across = SubtractVector3(centroid(facets[b]), centroid(facets[a]));
		links.push({
			a, b,
			concave: DotVector3(facets[a].normal, across) - DotVector3(facets[b].normal, across) >= -EPSILON,
			fold   : AngleBetweenVector3(facets[a].normal, facets[b].normal)
		});
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
	const pieceRoots = MakeRoots(pieces.length);
	const reach      = pieces.map((piece) => expand(piece.worldAabb));
	const facetReach = facets.map((facet) => expand(TriangleAabb(facet)));

	function nearFacets(piece, bounds) {
		return piece.facets.map((_, offset) => piece.first + offset).filter((index) => AabbOverlap(facetReach[index], bounds));
	}

	for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
		if (!AabbOverlap(reach[i], reach[j])) continue;
		if (pieces[i].facets.length === 0 || pieces[j].facets.length === 0) {
			JoinRoots(pieceRoots, i, j);
			continue;
		}

		for (const a of nearFacets(pieces[i], reach[j])) for (const b of nearFacets(pieces[j], reach[i])) {
			if (AabbOverlap(facetReach[a], facetReach[b]) && TriangleDistanceSq(facets[a], facets[b]) <= EPSILON ** 2) link(a, b);
		}
	}

	// Join pieces linked by any facet into one chunk.
	links.forEach(({ a, b }) => JoinRoots(pieceRoots, owner[a], owner[b]));
	const chunkByRoot = new Map();
	pieces.forEach((piece, index) => {
		const root = FindRoot(pieceRoots, index);
		if (!chunkByRoot.has(root)) chunkByRoot.set(root, { id: `chunk-${chunkByRoot.size}`, surfaceIds: [] });
		chunkByRoot.get(root).surfaceIds.push(piece.id);
	});

	const chunks = [...chunkByRoot.values()];
	Log(
		"ENGINE",
		`
			Terrain chunks:
			- Chunks=${chunks.length}
			- Links=${links.length}
			- Ms=${(performance.now() - started).toFixed(1)}
		`,
		"log",
		"Level"
	);

	return { chunks, pieces, owner, facets, links };
}

export { AssembleTerrainChunks };
