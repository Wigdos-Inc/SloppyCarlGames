// Groups touching terrain and obstacles into chunks, linking every pair of touching triangles along the way.

// Used by builder/NewLevel.js to group a level's terrain and obstacles into chunks.
// Used by handlers/game/Level.js to give spawned terrain and obstacles a chunk, and take despawned ones out.
// Used by handlers/game/Simulator.js to rechunk an obstacle after moving it onto the platform.
// Used by physics/Collision.js, whose broadphase walks the chunks built here.
// Uses math/Geometry.js to measure triangles, fit boxes to collision shapes and group linked pieces.
// Uses math/Collision.js to find touching triangles.
// Uses math/Vector3.js to fit chunk boxes.
// Uses physics/Collision.js to leave out triangles inside voids.

import { EPSILON, Log } from "../../core/meta.js";
import { AabbOverlap, TriangleDistanceSq } from "../../math/Collision.js";
import { FindRoot, JoinRoots, MakeRoots, ObbFromAabb, TriangleAabb, TriangleCentroid } from "../../math/Geometry.js";
import {
	AddVector3,
	AngleBetweenVector3,
	DotVector3,
	MaxVector3,
	MinVector3,
	ScaleVector3,
	SubtractVector3,
	ToVector3,
	Vector3ToArray
} from "../../math/Vector3.js";
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

// List a collision shape's flat triangles.
function boundsFacets(bounds) {
	if (bounds === null) return [];
	switch (bounds.type) {
		case "triangle-soup": return bounds.triangles;
		case "obb"          : return boxFacets(bounds);
		case "aabb"         : return boxFacets(ObbFromAabb(bounds));
	}
	return [];
}

// Grow bounds by EPSILON for accurate touching.
const expand = (aabb) => ({ min: SubtractVector3(aabb.min, ToVector3(EPSILON)), max: AddVector3(aabb.max, ToVector3(EPSILON)) });

// Group touching terrain and void linings into chunks. Return the linked triangles with them.
function AssembleTerrainChunks(terrain, voidTerrain) {
	const started = performance.now();

	// Make one piece per surface: its triangles outside voids, plus each void's wall lining.
	const pieces = [];
	const centroid = (f) => TriangleCentroid(f.a, f.b, f.c);
	for (const mesh of terrain) {
		const { id, worldAabb, meta } = mesh;
		pieces.push({ 
			id, worldAabb, 
			facets: boundsFacets(mesh.detailedBounds).filter((f) => !(meta.nullable !== false && IsCutByVoid(centroid(f), id, voidTerrain)))
		});
	}
	for (const voidMesh of voidTerrain) {
		const lining = [];
		for (const hostId in voidMesh.relations) {
			for (const wall of voidMesh.relations[hostId].voidWallMeshes) {
				if (wall.floorBounds !== null) for (const triangle of wall.floorBounds.triangles) lining.push(triangle);
				if (wall.wallBounds !== null)  for (const triangle of wall.wallBounds.triangles)  lining.push(triangle);
			}
		}
		if (lining.length > 0) pieces.push({ id: voidMesh.id, worldAabb: voidMesh.worldAabb, facets: lining });
	}

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

// Prepare a surface for touch tests, with its boxes slightly grown.
const touchSurface = (facets, worldAabb) => ({ facets, reach: expand(worldAabb), facetReach: facets.map((f) => expand(TriangleAabb(f))) });

// Check whether two surfaces touch.
function facetsTouch(a, b) {
	if (a.facets.length === 0 || b.facets.length === 0) return true;

	// Pair only the facets that reach the other surface's bounds.
	for (const i of [...a.facets.keys()].filter((i) => AabbOverlap(a.facetReach[i], b.reach)))  {
		for (const j of [...b.facets.keys()].filter((j) => AabbOverlap(b.facetReach[j], a.reach))) {
			if (AabbOverlap(a.facetReach[i], b.facetReach[j]) && TriangleDistanceSq(a.facets[i], b.facets[j]) <= EPSILON ** 2) return true;
		}
	}
	return false;
}

// Fit a member's box around its surface and void linings.
function fitMember(member) {
	const boxes = [member.ref.worldAabb, ...member.linings.map((lining) => lining.voidWall.worldAabb)];
	member.aabb = { min: MinVector3(...boxes.map((box) => box.min)), max: MaxVector3(...boxes.map((box) => box.max)) };
}

// Fit a chunk's box around its members' boxes.
function fitChunk(chunk) {
	chunk.worldAabb = {
		min: MinVector3(...chunk.members.map((member) => member.aabb.min)),
		max: MaxVector3(...chunk.members.map((member) => member.aabb.max)),
	};
}

// Group the level's terrain and obstacles into collision chunks.
function AssembleCollisionChunks(assembled, terrain, obstacles, voids) {
	const chunkCount = assembled.chunks.length;

	// One root per terrain and obstacle chunk.
	const roots   = MakeRoots(chunkCount + obstacles.length);
	const chunkOf = new Map();
	assembled.chunks.forEach((chunk, index) => chunk.surfaceIds.forEach((id) => chunkOf.set(id, index)));

	// Join each obstacle to the chunks they touch. 
	// Note: One touching two chunks merges them.
	const pieceSurfaces    = assembled.pieces.map((piece) => touchSurface(piece.facets, piece.worldAabb));
	const obstacleSurfaces = obstacles.map((record) => touchSurface(boundsFacets(record.detailedBounds), record.worldAabb));
	obstacleSurfaces.forEach((surface, i) => {
		const root = chunkCount + i;
		pieceSurfaces.forEach((piece, p) => {
			if (AabbOverlap(surface.reach, piece.reach) && facetsTouch(surface, piece)) JoinRoots(roots, root, chunkOf.get(assembled.pieces[p].id));
		});
		for (let j = 0; j < i; j++) {
			const other = obstacleSurfaces[j];
			if (AabbOverlap(surface.reach, other.reach) && facetsTouch(surface, other)) JoinRoots(roots, root, chunkCount + j);
		}
	});

	// Number members in authored order to let the broadphase restore it.
	let seq = 0;
	const newMember = (ref, type, rank) => ({ ref, type, rank, seq: seq++, aabb: null, linings: [] });
	const terrainMembers  = terrain.map((mesh)     => newMember(mesh, "terrain", 0));
	const obstacleMembers = obstacles.map((record) => newMember(record, "obstacle", 1));

	// List each void lining under its host.
	function addLinings(entries, members, sourceType, rank) {
		const hostById = new Map(members.map((host) => [host.ref.id, host]));
		for (const entry of entries) for (const id in entry.relations) {
			for (const voidWall of entry.relations[id].voidWallMeshes) {
				hostById.get(id).linings.push({ voidWall, sourceType, rank, seq });
				seq += 2;
			}
		}
	}
	addLinings(voids.terrain, terrainMembers, "terrain", 2);
	addLinings(voids.obstacles, obstacleMembers, "obstacle", 3);

	// Gather each member into its chunk.
	const chunkByRoot = new Map();
	function join(member, index) {
		const root = FindRoot(roots, index);
		if (!chunkByRoot.has(root)) chunkByRoot.set(root, { id: `chunk-${chunkByRoot.size}`, worldAabb: null, members: [] });
		chunkByRoot.get(root).members.push(member);
	}
	terrainMembers.forEach((member) => join(member, chunkOf.get(member.ref.id)));
	obstacleMembers.forEach((member, i) => join(member, chunkCount + i));

	// Fit each chunk's boxes.
	const chunks = [...chunkByRoot.values()];
	for (const chunk of chunks) {
		chunk.members.forEach(fitMember);
		fitChunk(chunk);
	}
	Log("ENGINE", `Collision chunks: ${chunks.length}`, "log", "Level");

	return { chunks, seq };
}

// Give a spawned terrain mesh/obstacle its own chunk.
function AddChunk(sceneGraph, ref, type) {
	const seq    = sceneGraph.collisionSeq++;
	const member = { ref, type, rank: type === "terrain" ? 0 : 1, seq, aabb: null, linings: [] };
	const chunk  = { id: `chunk-${seq}`, worldAabb: null, members: [member] };
	fitMember(member);
	fitChunk(chunk);
	sceneGraph.chunks.push(chunk);
}

// Take a despawned terrain/obstacle mesh out of its chunk.
function RemoveChunkMember(sceneGraph, ref) {
	for (const [chunkIndex, chunk] of sceneGraph.chunks.entries()) {
		const index = chunk.members.findIndex((member) => member.ref === ref);
		if (index < 0) continue;

		chunk.members.splice(index, 1);
		chunk.members.length === 0 ? sceneGraph.chunks.splice(chunkIndex, 1) : fitChunk(chunk);
		return;
	}
}

export { AssembleTerrainChunks, AssembleCollisionChunks, AddChunk, RemoveChunkMember };
