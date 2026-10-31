// Shape math: triangles, boxes, shapes fitted to boxes, polygon cuts and closest points.

// Used by math/Collision.js for box measures and closest points.
// Used by physics/Collision.js to measure boxes, move collider shapes and find the nearest point on ground triangles.
// Used by physics/Correction.js and camera/Modes.js to find a box's center.
// Used by builder/NewEntity.js, builder/NewObstacle.js and builder/NewObject.js to fit collision shapes to bounds.
// Used by builder/NewObject.js and builder/NewVoid.js to place a mesh's triangles in the world.
// Used by builder/NewObject.js, builder/NewEntity.js and builder/NewTerrain.js to list a box's corners.
// Used by builder/NewLevel.js, builder/NewVoid.js, builder/NewPrimitive.js, handlers/Render.js and handlers/game/Simulator.js to measure triangles.
// Used by builder/NewVoid.js to cut polygons along planes.
// Used by builder/subProcesses/Chunks.js and Loops.js to group linked triangles.
// Uses math/Vector3.js for vector operations 
// Uses math/Matrix.js to place points.

import { EPSILON } from "../core/meta.js";
import { TransformPointByMatrix } from "./Matrix.js";
import {
	AddVector3,
	ArrayToVector3,
	CloneVector3,
	CrossVector3,
	DotVector3,
	MaxVector3,
	MinVector3,
	ResolveVector3Axis,
	ScaleVector3,
	SubtractVector3,
	ToVector3,
	Vector3Length,
	Vector3Sq,
	WORLD_NORMALS,
} from "./Vector3.js";
import { Clamp01, Unit } from "./Utilities.js";

const worldBoxAxes = Object.freeze([WORLD_NORMALS.Right, WORLD_NORMALS.Up, WORLD_NORMALS.Forward]);

/* === TRIANGLES === */

// Measure a triangle's facing direction, area and center. The facing follows the corner order.
const TriangleNormal   = (a, b, c) => ResolveVector3Axis(CrossVector3(SubtractVector3(b, a), SubtractVector3(c, a)));
const TriangleArea     = (a, b, c) => 0.5 * Vector3Length(CrossVector3(SubtractVector3(b, a), SubtractVector3(c, a)));
const TriangleCentroid = (a, b, c) => ScaleVector3(AddVector3(AddVector3(a, b), c), 1 / 3);

function TriangleAabb(triangle) {
	return {
		min: MinVector3(triangle.a, MinVector3(triangle.b, triangle.c)),
		max: MaxVector3(triangle.a, MaxVector3(triangle.b, triangle.c)),
	};
}

// Place a mesh's triangles with a matrix, placing each shared corner only once.
function MeshTriangles(positions, indices, matrix) {
	const vertices = [];
	for (let i = 0; i < positions.length / 3; i++) {
		vertices.push(TransformPointByMatrix(ArrayToVector3(positions, i, true), matrix));
	}

	const triangles = [];
	for (let i = 0; i < indices.length; i += 3) {
		const a = vertices[indices[i]], b = vertices[indices[i + 1]], c = vertices[indices[i + 2]];
		triangles.push({ a, b, c, normal: TriangleNormal(a, b, c) });
	}
	return triangles;
}

/* === BOXES === */

// Measure a box's center and half-size as plain vectors, not UnitVector3.
const AabbCenter      = (aabb) => ScaleVector3(AddVector3(aabb.min, aabb.max), 0.5);
const AabbHalfExtents = (aabb) => ScaleVector3(SubtractVector3(aabb.max, aabb.min), 0.5);

// Fit a box around a list of points. It can grow a starting box, move each point or skip some.
function PointsAabb(points, min = ToVector3(Infinity), max = ToVector3(-Infinity), transform = null, skip = null) {
	for (const entry of points) {
		if (skip !== null && skip(entry)) continue;

		const point = transform === null ? entry : transform(entry);
		min = MinVector3(min, point);
		max = MaxVector3(max, point);
	}
	return { min, max };
}

// List a box's 8 corners, with x changing fastest, then y, then z.
function BoxCorners({ min, max }) {
	return Array.from({ length: 8 }, (_, corner) => ({
		x: (corner & 1) === 0 ? min.x : max.x,
		y: (corner & 2) === 0 ? min.y : max.y,
		z: (corner & 4) === 0 ? min.z : max.z,
	}));
}

/* === SHAPES FROM AABB === */
// Fit collider shapes to a box.

// Fit a sphere inside the box, or out to its corners.
function SphereFromAabb(aabb, inscribed) {
	const half   = AabbHalfExtents(aabb);
	const radius = inscribed ? Math.min(half.x, half.y, half.z) : Vector3Length(half);
	return {
		type  : "sphere",
		center: aabb.min.clone().set(AabbCenter(aabb)),
		radius: new Unit(Math.max(0.0001, radius), "cnu"),
	};
}

// Fit an upright capsule as wide as the box's wider horizontal side.
function CapsuleFromAabb(aabb) {
	const dim          = SubtractVector3(aabb.max, aabb.min);
	const radius       = Math.max(0.0001, Math.max(dim.x, dim.z) * 0.5);
	const halfHeight   = Math.max(0, (dim.y * 0.5) - radius);

	const segmentStart = aabb.min.clone().set(AabbCenter(aabb));
	const segmentEnd   = segmentStart.clone();
	segmentStart.y -= halfHeight;
	segmentEnd.y   += halfHeight;

	return {
		type      : "capsule",
		radius    : new Unit(radius, "cnu"),
		halfHeight: new Unit(halfHeight, "cnu"),
		segmentStart, segmentEnd,
	};
}

function ObbFromAabb(aabb) {
	return {
		type       : "obb",
		center     : aabb.min.clone().set(AabbCenter(aabb)),
		halfExtents: aabb.max.clone().set(AabbHalfExtents(aabb)),
		axes       : worldBoxAxes,
	};
}

// Move any collider shape by an offset.
function OffsetDetailedBounds(bounds, offset) {
	switch (bounds.type) {
		case "capsule":
			return {
				type        : "capsule",
				radius      : bounds.radius,
				halfHeight  : bounds.halfHeight,
				segmentStart: AddVector3(bounds.segmentStart, offset),
				segmentEnd  : AddVector3(bounds.segmentEnd, offset),
			};
		case "obb":
			return {
				type       : "obb",
				center     : AddVector3(bounds.center, offset),
				halfExtents: bounds.halfExtents,
				axes       : bounds.axes,
			};
		case "sphere":
			return {
				type  : "sphere",
				center: AddVector3(bounds.center, offset),
				radius: bounds.radius,
			};
		case "aabb":
			return {
				type: "aabb",
				min : AddVector3(bounds.min, offset),
				max : AddVector3(bounds.max, offset),
			};
		case "compound-sphere":
			return {
				type   : "compound-sphere",
				spheres: bounds.spheres.map((sphere) => ({
					center: AddVector3(sphere.center, offset),
					radius: sphere.radius,
					partId: sphere.partId,
				})),
			};
		default: return bounds;
	}
}

/* === POLYGONS === */

// Split a polygon in two along a plane. Return null when the plane doesn't cut through it.
function SplitPolygonByPlane(polygon, planeNormal, planeOffset) {
	const distances         = polygon.map((vertex) => DotVector3(planeNormal, vertex) - planeOffset);
	const planeCrossEpsilon = 0.000001;

	let frontCount = 0, backCount = 0;
	for (const distance of distances) {
		if (distance >  planeCrossEpsilon) frontCount++;
		if (distance < -planeCrossEpsilon) backCount++;
	}
	if (frontCount === 0 || backCount === 0) return null;

	const frontPolygon = [], backPolygon = [];
	for (let index = 0; index < polygon.length; index++) {
		const next = (index + 1) % polygon.length;
		const here = distances[index], there = distances[next];

		if (here >= -planeCrossEpsilon) frontPolygon.push(polygon[index]);
		if (here <=  planeCrossEpsilon) backPolygon.push(polygon[index]);
		if ((here > planeCrossEpsilon && there < -planeCrossEpsilon) || (here < -planeCrossEpsilon && there > planeCrossEpsilon)) {
			const crossing = AddVector3(polygon[index], ScaleVector3(SubtractVector3(polygon[next], polygon[index]), here / (here - there)));
			frontPolygon.push(crossing);
			backPolygon.push(crossing);
		}
	}

	return [frontPolygon, backPolygon];
}

/* === CLOSEST POINTS === */

function ClosestPointOnSegment(point, segStart, segEnd) {
	const segment         = SubtractVector3(segEnd, segStart);
	const segmentLengthSq = Vector3Sq(segment);
	if (segmentLengthSq <= EPSILON) return CloneVector3(segStart);

	return AddVector3(segStart, ScaleVector3(segment, Clamp01(DotVector3(SubtractVector3(point, segStart), segment) / segmentLengthSq)));
}

function ClosestPointOnTriangle(point, a, b, c) {
	const ab = SubtractVector3(b, a), ac = SubtractVector3(c, a), ap = SubtractVector3(point, a);
	const d1 = DotVector3(ab, ap), d2 = DotVector3(ac, ap);
	if (d1 <= 0 && d2 <= 0) return CloneVector3(a);

	const bp = SubtractVector3(point, b);
	const d3 = DotVector3(ab, bp), d4 = DotVector3(ac, bp);
	if (d3 >= 0 && d4 <= d3) return CloneVector3(b);

	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) return AddVector3(a, ScaleVector3(ab, d1 / (d1 - d3)));

	const cp = SubtractVector3(point, c);
	const d5 = DotVector3(ab, cp), d6 = DotVector3(ac, cp);
	if (d6 >= 0 && d5 <= d6) return CloneVector3(c);

	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) return AddVector3(a, ScaleVector3(ac, d2 / (d2 - d6)));

	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
		return AddVector3(b, ScaleVector3(SubtractVector3(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
	}

	const denom = 1 / (va + vb + vc);
	return AddVector3(a, AddVector3(ScaleVector3(ab, vb * denom), ScaleVector3(ac, vc * denom)));
}

/* === LINKED GROUPS === */

// Merge linked triangles or pieces into groups and find the group each one belongs to.
const MakeRoots = (count) => Array.from({ length: count }, (_, index) => index);
function FindRoot(roots, index) {
	while (roots[index] !== index) index = roots[index] = roots[roots[index]];
	return index;
}
const JoinRoots = (roots, a, b) => roots[FindRoot(roots, a)] = FindRoot(roots, b);

/* === EXPORTS === */

export {
	TriangleNormal,
	TriangleArea,
	TriangleCentroid,
	TriangleAabb,
	MeshTriangles,
	AabbCenter,
	AabbHalfExtents,
	PointsAabb,
	BoxCorners,
	SphereFromAabb,
	CapsuleFromAabb,
	ObbFromAabb,
	OffsetDetailedBounds,
	SplitPolygonByPlane,
	ClosestPointOnSegment,
	ClosestPointOnTriangle,
	MakeRoots,
	FindRoot,
	JoinRoots,
};
