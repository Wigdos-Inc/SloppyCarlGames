// Derives terrain blockers: solid boxes inside terrain shapes that hide whatever sits fully behind them.

// Used by builder/NewLevel.js to give level terrain its blockers once its voids are cut.
// Used by handlers/game/Level.js to give spawned terrain its blockers.
// Uses math/Geometry.js to fit boxes around points.
// Uses math/Matrix.js to move points between a mesh's own space and the world.
// Uses builder/NewTexture.js to leave see-through terrain without blockers.

import { PERFORMANCE_SCALING } from "../../core/config.js";
import { Log } from "../../core/meta.js";
import { IsTextureTransparent } from "../NewTexture.js";
import { BoxCorners, ClosestPointOnSegment, PointsAabb } from "../../math/Geometry.js";
import { CreateModelMatrix, InvertAffineMatrix, TransformPointByMatrix } from "../../math/Matrix.js";
import { UnitVector3 } from "../../math/Utilities.js";
import { CompareVector3, MaxVector3, MinVector3, MultiplyVector3, ScaleVector3, SubtractVector3, Vector3Sq } from "../../math/Vector3.js";

// Find the biggest box that fits inside a shape.
function inscribedBox(primitive, dimensions, primitiveOptions) {
	const r = ScaleVector3(dimensions, 0.5);
	if (primitive === "plane") r.z = 0;
	
	function box(x0, x1, y0, y1, z0, z1) {
		const v = [{ x: x0, y: y0, z: z0 }, { x: x1, y: y1, z: z1 }];
		return { min: MultiplyVector3(v[0], r), max: MultiplyVector3(v[1], r) };
	}

	// Keep boxes belonging to round shapes inside flat sides by shrinking them.
	const round = 0.92 / Math.SQRT2, faceted = 0.88;
	const ball = faceted / Math.sqrt(3), coneHalf = round * 2 / 3;
	switch (primitive) {
		case "cube"       : return box(-1, 1, -1, 1, -1, 1);
		case "plane"      : return primitiveOptions.crossed || primitiveOptions.sprite !== null ? null : box(-1, 1, -1, 1, -1, 1); // Crossed and sprite planes keep no flat side.
		case "cylinder"   : return box(-round, round, -1, 1, -round, round);
		case "sphere"     : return box(-ball, ball, -ball, ball, -ball, ball);
		case "cone"       : return box(-coneHalf, coneHalf, -1, -1 / 3, -coneHalf, coneHalf);
		case "pyramid"    : return box(-2 / 3, 2 / 3, -1, -1 / 3, -2 / 3, 2 / 3);
		case "ramp-simple": return box(-1, 1, -1, 0, 0, 1);
		case "capsule": {
			// Find the widest box that still reaches into the capsule's rounded ends.
			const cap = primitiveOptions.rounding, straight = 1 - cap;
			if (cap <= 0) return box(-round, round, -1, 1, -round, round);

			const s = straight / cap, e = (Math.sqrt(s**2 + 3) - s) / 3, a = faceted * Math.sqrt((1 - e**2) / 2);
			const reach = straight + faceted * e * cap;
			return box(-a, a, -reach, reach, -a, a);
		}
		default: return null;
	}
}

// Cover a void with boxes in the host's own space.
function voidCutBoxes(solidTriangles, centerline, inverse) {
	const points = solidTriangles.flatMap((triangle) => [triangle.a, triangle.b, triangle.c]);
	const local  = points.map((point) => TransformPointByMatrix(point, inverse));

	// Find the tube stretch closest to a point.
	function nearestStretch(point) {
		let best = 0, bestSq = Infinity;
		for (let i = 0; i < centerline.length - 1; i++) {
			const distanceSq = Vector3Sq(SubtractVector3(point, ClosestPointOnSegment(point, centerline[i], centerline[i + 1])));
			if (distanceSq >= bestSq) continue;
			bestSq = distanceSq;
			best = i;
		}
		return best;
	}

	if (centerline === null || centerline.length < 3) return [PointsAabb(local)];
	const nearest = points.map(nearestStretch);
	return centerline.slice(1).map((_, i) => PointsAabb(local.filter((_, k) => Math.abs(nearest[k] - i) <= 1)));
}

// Cut one box out of another, leaving up to 6 solid slabs around the cut.
function subtractBox(box, cut) {
	if (CompareVector3(cut.max, box.min, "lesser-loose", true) || CompareVector3(cut.min, box.max, "greater-loose", true)) return [box];

	const out = [], lo = { ...box.min }, hi = { ...box.max };
	for (const axis of ["x", "y", "z"]) {
		if (cut.min[axis] > lo[axis]) out.push({ min: { ...lo }, max: { ...hi, [axis]: cut.min[axis] } });
		if (cut.max[axis] < hi[axis]) out.push({ min: { ...lo, [axis]: cut.max[axis] }, max: { ...hi } });
		lo[axis] = Math.max(lo[axis], cut.min[axis]);
		hi[axis] = Math.min(hi[axis], cut.max[axis]);
	}
	return out;
}

// Measure the area of a box's largest side.
function aabbLargestFace(box) {
	const v = SubtractVector3(box.max, box.min);
	return Math.max(v.x * v.y, v.y * v.z, v.x * v.z);
}

// Join any two pieces that share a whole side into one.
function mergeTouching(pieces) {
	const axes = ["x", "y", "z"];
	function touching(a, b, axis) {
		return (
			axes.every((other) => other === axis || (a.min[other] === b.min[other] && a.max[other] === b.max[other])) && 
			(a.max[axis] === b.min[axis] || b.max[axis] === a.min[axis])
		);
	}

	for (let i = 0; i < pieces.length; i++) {
		for (let j = i + 1; j < pieces.length; j++) {
			if (!axes.some((axis) => touching(pieces[i], pieces[j], axis))) continue;
			pieces[i] = { min: MinVector3(pieces[i].min, pieces[j].min), max: MaxVector3(pieces[i].max, pieces[j].max) };
			pieces.splice(j, 1);
			j = i;
		}
	}
	return pieces;
}

// Find the solid boxes left after cutting every void out of a shape's box.
function solidBoxes(inner, cuts, scale, minSize) {
	let pieces = [inner];
	for (const cut of cuts) pieces = pieces.flatMap((piece) => subtractBox(piece, cut));

	// Measure the shorter side of a piece's largest face, at its true scaled size.
	function largestFaceWidth(piece) {
		return ["x", "y", "z"].map((axis) => (piece.max[axis] - piece.min[axis]) * Math.abs(scale[axis])).sort((a, b) => a - b)[1];
	}

	// Keep the largest 8 pieces, dropping scraps and narrow ones.
	return mergeTouching(pieces)
		.filter((piece) => aabbLargestFace(piece) >= 0.01 * aabbLargestFace(inner) && largestFaceWidth(piece) >= minSize.value)
		.sort((a, b) => aabbLargestFace(b) - aabbLargestFace(a))
		.slice(0, 8);
}

// Pack a solid piece for rendering.
function occluderPiece(piece, matrix) {
	const corners = BoxCorners(piece).map((local) => {
		const world = TransformPointByMatrix(local, matrix);
		return new UnitVector3(world.x, world.y, world.z, "cnu");
	});

	const { min, max } = PointsAabb(corners);
	const worldAabb = { min: corners[0].clone().set(min), max: corners[0].clone().set(max) };

	return {
		min : new UnitVector3(piece.min.x, piece.min.y, piece.min.z, "cnu"),
		max : new UnitVector3(piece.max.x, piece.max.y, piece.max.z, "cnu"),
		face: aabbLargestFace(worldAabb),
		corners, worldAabb,
	};
}

// Build one terrain mesh's blockers.
// Note: Built once from the build transform.
function buildOccluder(mesh, carvingVoids) {
	const matrix  = CreateModelMatrix(mesh.transform);
	const inverse = InvertAffineMatrix(matrix);

	// Skip shapes that can't hold a box or can be seen through.
	const inner = mesh.meta.mode === "default" ? inscribedBox(mesh.primitive, mesh.dimensions, mesh.detail.primitiveOptions) : null;
	if (inner === null || IsTextureTransparent(mesh.detail.texture.base)) return { inverse, pieces: [] };

	const cuts   = carvingVoids.flatMap((voidMesh) => voidCutBoxes(voidMesh.solidGrid.triangles, voidMesh.meta.centerline, inverse));
	const pieces = solidBoxes(inner, cuts, mesh.transform.scale, PERFORMANCE_SCALING.Culling.MinBlockerSize);
	return { inverse, pieces: pieces.map((piece) => occluderPiece(piece, matrix)) };
}

// Give each terrain mesh its blockers.
function BuildOccluders(terrain, voidTerrain) {
	const voidsByHost = new Map();
	for (const voidMesh of voidTerrain) {
		for (const hostId in voidMesh.relations) {
			if (!voidsByHost.has(hostId)) voidsByHost.set(hostId, []);
			voidsByHost.get(hostId).push(voidMesh);
		}
	}

	for (const mesh of terrain) mesh.performance.occluder = buildOccluder(mesh, voidsByHost.get(mesh.id) ?? []);
	Log("ENGINE", `Terrain blockers built: meshes=${terrain.length}, carved=${voidsByHost.size}`, "log", "Level");
}

export { BuildOccluders };
