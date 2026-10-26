// Collision & Geometry math helpers.

// Used by physics/Collision.js to detect, resolve and slide along contacts.
// Used by physics/Correction.js to align bodies to the ground.
// Used by physics/Forces.js, player/Movement.js and camera/Modes.js to accelerate, slow and cap velocity.
// Used by camera/Master.js to raycast for camera blockers.
// Used by handlers/Render.js to cull hidden objects.
// Used by handlers/game/Collectible.js to detect pickups.
// Used by builder/NewPrimitive.js and handlers/game/Simulator.js to find which way triangles face.
// Used by builder/NewEntity.js, builder/NewObstacle.js and builder/NewObject.js to fit collision shapes to bounds.
// Used by builder/NewLevel.js to join touching surfaces into chunks.
// Used by builder/NewTerrain.js for the solid blocker boxes inside each mesh.
// Used by builder/NewVoid.js to cut voids out of host meshes.
// Uses math/Vector3.js for vector operations.
// Uses math/Matrix.js to move points into a mesh's own space and build surface rotations.

import { EPSILON } from "../core/meta.js";
import { CARVE_GRID_TRIANGLES_PER_CELL } from "../core/config.js";
import { TransformPointByMatrix, EulerFromBasis } from "./Matrix.js";
import {
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	DotVector3,
	CrossVector3,
	CloneVector3,
	Vector3Sq,
	Vector3Length,
	ResolveVector3Axis,
	ToVector3,
	AbsoluteVector3,
	MultiplyVector3,
	ClampVector3,
	WORLD_NORMALS,
	MinVector3,
	MaxVector3,
	MinAxisVector3,
	CompareVector3,
	TransportVector3,
} from "./Vector3.js";
import { Clamp, Clamp01, BestMatchOf, Unit } from "./Utilities.js";

const noContact = () => { return { hit: false, normal: CloneVector3(WORLD_NORMALS.Up), depth: 0, point: null } };

const makeContact = (normal, depth, point = null) => { return { hit: depth >= 0, normal: normal, depth: Math.max(0, depth), point } };

const worldBoxAxes = Object.freeze([WORLD_NORMALS.Right, WORLD_NORMALS.Up, WORLD_NORMALS.Forward]);

// Each box axis's two face normals, negative side first.
const worldBoxFaces = Object.freeze([
	[WORLD_NORMALS.Left, WORLD_NORMALS.Right],
	[WORLD_NORMALS.Down, WORLD_NORMALS.Up],
	[WORLD_NORMALS.Backward, WORLD_NORMALS.Forward],
]);
const obbFaces = (obb) => obb.axes.map((axis) => [ScaleVector3(axis, -1), axis]);

function resolveUnitDirection(vector) {
	const lengthSq = Vector3Sq(vector);
	return lengthSq <= EPSILON ? null : ScaleVector3(vector, 1 / Math.sqrt(lengthSq));
}

// Shallowest exit from a box for a point inside it; `local` is the point relative to the box center.
function resolveInsideBoxContact(local, radius, halfExtents, faces, point) {
	const gap = SubtractVector3(halfExtents, AbsoluteVector3(local));
	const axis = MinAxisVector3(gap), key = "xyz"[axis];
	return makeContact(CloneVector3(faces[axis][local[key] > 0 ? 1 : 0]), gap[key] + radius, point);
}

// A point is measured from the box center; a direction is not.
function projectToObbLocal(vector, obb, isPoint = false) {
	const delta = isPoint ? SubtractVector3(vector, obb.center) : vector;
	return {
		x: DotVector3(delta, obb.axes[0]),
		y: DotVector3(delta, obb.axes[1]),
		z: DotVector3(delta, obb.axes[2]),
	};
}

function projectObbNormalToWorld(localNormal, obb) {
	return AddVector3(
		ScaleVector3(obb.axes[0], localNormal.x),
		AddVector3(ScaleVector3(obb.axes[1], localNormal.y), ScaleVector3(obb.axes[2], localNormal.z))
	);
}

function projectAabbRadiusOntoAxis(halfExtents, axis) {
	const vector = MultiplyVector3(AbsoluteVector3(axis), halfExtents);
	return (vector.x + vector.y + vector.z);
}

const projectObbRadiusOntoAxis = (obb, axis) => projectAabbRadiusOntoAxis(obb.halfExtents, projectToObbLocal(axis, obb));

function chooseAabbObbSatAxis(best, rawAxis, centerDelta, halfExtents, obb) {
	const axis = resolveUnitDirection(rawAxis);
	if (!axis) return best;

	const overlap = (projectAabbRadiusOntoAxis(halfExtents, axis) + projectObbRadiusOntoAxis(obb, axis)) - Math.abs(DotVector3(centerDelta, axis));
	if (overlap < 0) return { separated: true };

	const normal = DotVector3(centerDelta, axis) >= 0 ? CloneVector3(axis) : ScaleVector3(axis, -1);
	if (!best || overlap < best.depth) return { separated: false, normal, depth: overlap };
	return best;
}

function closestPointOnSegment(point, segStart, segEnd) {
	const segment = SubtractVector3(segEnd, segStart);
	const segmentLengthSq = Vector3Sq(segment);
	if (segmentLengthSq <= EPSILON) return CloneVector3(segStart);

	return AddVector3(segStart, ScaleVector3(segment, Clamp01(DotVector3(SubtractVector3(point, segStart), segment) / segmentLengthSq)));
}

function closestPointsOnSegments(p1, q1, p2, q2) {
	const d1 = SubtractVector3(q1, p1), d2 = SubtractVector3(q2, p2), r = SubtractVector3(p1, p2);
	const a = Vector3Sq(d1), e = Vector3Sq(d2), f = DotVector3(d2, r);
	let s = 0, t = 0;

	if (a <= EPSILON && e <= EPSILON) {
		return {
			pointA: CloneVector3(p1),
			pointB: CloneVector3(p2),
			s: 0,
			t: 0,
			distanceSq: Vector3Sq(SubtractVector3(p1, p2)),
		};
	}

	if (a <= EPSILON) t = Clamp01(f / e);
	else {
		const c = DotVector3(d1, r);
		if (e <= EPSILON) s = Clamp01(-c / a);
		else {
			const b = DotVector3(d1, d2);
			const denom = a * e - b * b;
			if (Math.abs(denom) > EPSILON) s = Clamp01((b * f - c * e) / denom);
			t = (b * s + f) / e;
			if (t < 0) {
				t = 0;
				s = Clamp01(-c / a);
			} 
			else if (t > 1) {
				t = 1;
				s = Clamp01((b - c) / a);
			}
		}
	}

	const pointA = AddVector3(p1, ScaleVector3(d1, s));
	const pointB = AddVector3(p2, ScaleVector3(d2, t));
	return {
		pointA, pointB, s, t,
		distanceSq: Vector3Sq(SubtractVector3(pointA, pointB)),
	};
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

// Normal from the corner order; zero for a triangle with no area.
const TriangleNormal   = (a, b, c) => ResolveVector3Axis(CrossVector3(SubtractVector3(b, a), SubtractVector3(c, a)));
const TriangleArea     = (a, b, c) => 0.5 * Vector3Length(CrossVector3(SubtractVector3(b, a), SubtractVector3(c, a)));
const TriangleCentroid = (a, b, c) => ScaleVector3(AddVector3(AddVector3(a, b), c), 1 / 3);

function closestPointsSegmentTriangle(segStart, segEnd, a, b, c, triangleNormal) {
	const segment = SubtractVector3(segEnd, segStart), denom = DotVector3(triangleNormal, segment);
	const candidates = [];

	if (Math.abs(denom) > EPSILON) {
		const t = DotVector3(triangleNormal, SubtractVector3(a, segStart)) / denom;
		if (t >= 0 && t <= 1) {
			const segmentPoint = AddVector3(segStart, ScaleVector3(segment, t));
			const trianglePoint = ClosestPointOnTriangle(segmentPoint, a, b, c);
			if (Vector3Sq(SubtractVector3(segmentPoint, trianglePoint)) <= EPSILON) {
				return { segmentPoint, trianglePoint, distanceSq: 0 };
			}
		}
	}

	const planeT = Math.abs(denom) > EPSILON ? Clamp01(DotVector3(triangleNormal, SubtractVector3(a, segStart)) / denom) : 0.5;
	const planePoint = AddVector3(segStart, ScaleVector3(segment, planeT));
	candidates.push({
		segmentPoint: CloneVector3(segStart),
		trianglePoint: ClosestPointOnTriangle(segStart, a, b, c),
	});
	candidates.push({
		segmentPoint: CloneVector3(segEnd),
		trianglePoint: ClosestPointOnTriangle(segEnd, a, b, c),
	});
	candidates.push({
		segmentPoint: planePoint,
		trianglePoint: ClosestPointOnTriangle(planePoint, a, b, c),
	});

	[[a, b], [b, c], [c, a]].forEach(edge => {
		const segmentPair = closestPointsOnSegments(segStart, segEnd, edge[0], edge[1]);
		candidates.push({
			segmentPoint: segmentPair.pointA,
			trianglePoint: segmentPair.pointB,
		});
	});

	let best = null;
	candidates.forEach(candidate => {
		const distanceSq = Vector3Sq(SubtractVector3(candidate.segmentPoint, candidate.trianglePoint));
		if (!best || distanceSq < best.distanceSq) best = { ...candidate, distanceSq };
	});

	return best;
}

const chooseDeepestContact = (best, next) => !next.hit ? best : !best.hit || next.depth > best.depth ? next : best;

function sphereSphereContact(centerA, radiusA, centerB, radiusB) {
	const delta = SubtractVector3(centerA, centerB);
	const distSq = Vector3Sq(delta);
	const radiusSum = radiusA.value + radiusB.value;

	if (distSq > radiusSum ** 2) return noContact();
	if (distSq <= EPSILON)       return makeContact(CloneVector3(WORLD_NORMALS.Up), radiusSum, CloneVector3(centerA));

	const distance = Math.sqrt(distSq);
	const normal = ScaleVector3(delta, 1 / distance);
	return makeContact(normal, radiusSum - distance, SubtractVector3(centerA, ScaleVector3(normal, radiusA.value)));
}

function sphereAABBContact(center, radius, aabb) {
	const closest = ClampVector3(center, aabb.min, aabb.max);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > radius.value * radius.value) return noContact();
	if (distSq <= EPSILON) return resolveInsideBoxContact(SubtractVector3(center, AabbCenter(aabb)), radius.value, AabbHalfExtents(aabb), worldBoxFaces, CloneVector3(center));

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radius.value - distance, closest);
}

function sphereOBBContact(center, radius, obb) {
	const localPoint = projectToObbLocal(center, obb, true);
	const clampedLocal = ClampVector3(localPoint, ScaleVector3(obb.halfExtents, -1), obb.halfExtents);
	const closest = AddVector3(
		obb.center,
		AddVector3(
			ScaleVector3(obb.axes[0], clampedLocal.x),
			AddVector3(ScaleVector3(obb.axes[1], clampedLocal.y), ScaleVector3(obb.axes[2], clampedLocal.z))
		)
	);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > radius.value * radius.value) return noContact();
	if (distSq <= EPSILON) return resolveInsideBoxContact(localPoint, radius.value, obb.halfExtents, obbFaces(obb), null);

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radius.value - distance, closest);
}

function sphereCapsuleContact(center, radius, capsule) {
	const closest = closestPointOnSegment(center, capsule.segmentStart, capsule.segmentEnd);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	const radiusSum = radius.value + capsule.radius.value;
	if (distSq > radiusSum ** 2) return noContact();
	if (distSq <= EPSILON) {
		const segmentMid = ScaleVector3(AddVector3(capsule.segmentStart, capsule.segmentEnd), 0.5);
		const normal = resolveUnitDirection(SubtractVector3(center, segmentMid)) || CloneVector3(WORLD_NORMALS.Up);
		return makeContact(normal, radiusSum, closest);
	}

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radiusSum - distance, closest);
}

function sphereTriangleContact(center, radius, triangle) {
	const closest = ClosestPointOnTriangle(center, triangle.a, triangle.b, triangle.c);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > radius.value * radius.value) return noContact();
	if (distSq <= EPSILON) {
		const triangleNormal = triangle.normal;
		const oriented = DotVector3(triangleNormal, SubtractVector3(center, triangle.a)) >= 0
			? triangleNormal
			: ScaleVector3(triangleNormal, -1);
		return makeContact(oriented, radius.value, closest);
	}

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radius.value - distance, closest);
}

// Soup prefilter — the shape's extent grown by its radius; a triangle outside it can't reach.
const SegmentQueryBox = (start, end, radius) => ({
	min: SubtractVector3(MinVector3(start, end), ToVector3(radius)),
	max: AddVector3(MaxVector3(start, end), ToVector3(radius)),
});

const sphereQueryBox  = (center, radius) => SegmentQueryBox(center, center, radius.value);
const capsuleQueryBox = (capsule) => SegmentQueryBox(capsule.segmentStart, capsule.segmentEnd, capsule.radius.value);

// Whether a triangle's box touches the query box, compared without allocating per triangle.
function TriangleInQueryBox(triangle, box) {
	const { a, b, c } = triangle;
	return (
		Math.max(a.x, b.x, c.x) >= box.min.x && Math.max(a.y, b.y, c.y) >= box.min.y && Math.max(a.z, b.z, c.z) >= box.min.z &&
		Math.min(a.x, b.x, c.x) <= box.max.x && Math.min(a.y, b.y, c.y) <= box.max.y && Math.min(a.z, b.z, c.z) <= box.max.z
	);
}

// Deepest contact among the triangles inside the query box.
function deepestContactInBox(triangles, box, contactWith) {

	let best = noContact();
	for (const triangle of triangles) {
		if (!TriangleInQueryBox(triangle, box)) continue;
		best = chooseDeepestContact(best, contactWith(triangle));
	}
	return best;
}

const sphereTriangleSoupContact = (center, radius, soup) => deepestContactInBox(soup.triangles, sphereQueryBox(center, radius), (triangle) => sphereTriangleContact(center, radius, triangle));

function capsuleCapsuleContact(capsuleA, capsuleB) {
	const closest = closestPointsOnSegments(
		capsuleA.segmentStart,
		capsuleA.segmentEnd,
		capsuleB.segmentStart,
		capsuleB.segmentEnd
	);
	const radiusSum = capsuleA.radius.value + capsuleB.radius.value;
	if (closest.distanceSq > radiusSum ** 2) return noContact();
	if (closest.distanceSq <= EPSILON) {
		const midpointA = ScaleVector3(AddVector3(capsuleA.segmentStart, capsuleA.segmentEnd), 0.5);
		const midpointB = ScaleVector3(AddVector3(capsuleB.segmentStart, capsuleB.segmentEnd), 0.5);
		const normal = resolveUnitDirection(SubtractVector3(midpointA, midpointB)) || CloneVector3(WORLD_NORMALS.Up);
		return makeContact(normal, radiusSum, closest.pointB);
	}

	const distance = Math.sqrt(closest.distanceSq);
	return makeContact(ScaleVector3(SubtractVector3(closest.pointA, closest.pointB), 1 / distance), radiusSum - distance, closest.pointB);
}

// Points along a capsule's core to test as spheres: both ends, the middle, and the point nearest a box's center.
function capsuleSamples(capsule, center) {
	const axis = SubtractVector3(capsule.segmentEnd, capsule.segmentStart);
	const axisLengthSq = Vector3Sq(axis);
	const centerT = axisLengthSq <= EPSILON ? 0.5 : Clamp01(DotVector3(SubtractVector3(center, capsule.segmentStart), axis) / axisLengthSq);
	return [
		CloneVector3(capsule.segmentStart), CloneVector3(capsule.segmentEnd),
		AddVector3(capsule.segmentStart, ScaleVector3(axis, 0.5)),
		AddVector3(capsule.segmentStart, ScaleVector3(axis, centerT)),
	];
}

function capsuleAABBContact(capsule, aabb) {
	let best = noContact();
	capsuleSamples(capsule, AabbCenter(aabb)).forEach(sample => best = chooseDeepestContact(best, sphereAABBContact(sample, capsule.radius, aabb)));
	return best;
}

function capsuleOBBContact(capsule, obb) {
	let best = noContact();
	capsuleSamples(capsule, obb.center).forEach(sample => best = chooseDeepestContact(best, sphereOBBContact(sample, capsule.radius, obb)));
	return best;
}

function aabbObbContact(aabb, obb) {
	const halfExtentsA = AabbHalfExtents(aabb);
	const centerDelta = SubtractVector3(AabbCenter(aabb), obb.center);

	let best = null;
	for (const axes of [worldBoxAxes, obb.axes]) for (const axis of axes) {
		best = chooseAabbObbSatAxis(best, axis, centerDelta, halfExtentsA, obb);
		if (best && best.separated) return noContact();
	}

	for (const aabbAxis of worldBoxAxes) for (const obbAxis of obb.axes) {
		best = chooseAabbObbSatAxis(best, CrossVector3(aabbAxis, obbAxis), centerDelta, halfExtentsA, obb);
		if (best && best.separated) return noContact();
	}

	return !best ? noContact : makeContact(best.normal, best.depth, null);
}

function aabbAabbContact(aabbA, aabbB) {
	if (!AabbOverlap(aabbA, aabbB)) return noContact();

	const pushNegative = SubtractVector3(aabbA.max, aabbB.min), pushPositive = SubtractVector3(aabbB.max, aabbA.min);
	const axis = MinAxisVector3(MinVector3(pushNegative, pushPositive)), key = "xyz"[axis];
	const negative = pushNegative[key] <= pushPositive[key];
	return makeContact(CloneVector3(worldBoxFaces[axis][negative ? 0 : 1]), negative ? pushNegative[key] : pushPositive[key], null);
}

function capsuleTriangleContact(capsule, triangle) {
	const closest = closestPointsSegmentTriangle(
		capsule.segmentStart, capsule.segmentEnd,
		triangle.a, triangle.b, triangle.c,
		triangle.normal
	);
	if (closest.distanceSq > capsule.radius.value * capsule.radius.value) return noContact();
	if (closest.distanceSq <= EPSILON) {
		const segmentMid = ScaleVector3(AddVector3(capsule.segmentStart, capsule.segmentEnd), 0.5);
		const oriented = DotVector3(triangle.normal, SubtractVector3(segmentMid, closest.trianglePoint)) >= 0
			? triangle.normal
			: ScaleVector3(triangle.normal, -1);
		return makeContact(oriented, capsule.radius.value, closest.trianglePoint);
	}

	const distance = Math.sqrt(closest.distanceSq);
	return makeContact(
		ScaleVector3(SubtractVector3(closest.segmentPoint, closest.trianglePoint), 1 / distance), 
		capsule.radius.value - distance, 
		closest.trianglePoint
	);
}

const capsuleTriangleSoupContact = (capsule, soup) => deepestContactInBox(soup.triangles, capsuleQueryBox(capsule), (triangle) => capsuleTriangleContact(capsule, triangle));

// One-sided: only the cavity-facing approach blocks, and the authored normal is never flipped.
function sphereVoidWallTriangleContact(center, radius, triangle) {
	const closest = ClosestPointOnTriangle(center, triangle.a, triangle.b, triangle.c);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > radius.value * radius.value) return noContact();
	if (distSq <= EPSILON) return makeContact(triangle.normal, radius.value, closest);
	if (DotVector3(triangle.normal, delta) < 0) return noContact();

	// Contact normal is triangle-point-to-shape, not the face plane.
	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radius.value - distance, closest);
}

function sphereVoidWallContact(center, radius, voidWall) {
	return deepestContactInBox(
		voidWall.triangles, 
		sphereQueryBox(center, radius), 
		(triangle) => sphereVoidWallTriangleContact(center, radius, triangle)
	);
}

// One-sided capsule-vs-triangle: same one-sided gate as the sphere variant.
function capsuleVoidWallTriangleContact(capsule, triangle) {
	const closest = closestPointsSegmentTriangle(
		capsule.segmentStart, capsule.segmentEnd,
		triangle.a, triangle.b, triangle.c,
		triangle.normal
	);
	if (closest.distanceSq > capsule.radius.value * capsule.radius.value) return noContact();
	if (closest.distanceSq <= EPSILON) return makeContact(triangle.normal, capsule.radius.value, closest.trianglePoint);
	if (DotVector3(triangle.normal, SubtractVector3(closest.segmentPoint, closest.trianglePoint)) < 0) return noContact();

	// Contact normal is triangle-point-to-shape, not the face plane.
	const distance = Math.sqrt(closest.distanceSq);
	return makeContact(ScaleVector3(SubtractVector3(closest.segmentPoint, closest.trianglePoint), 1 / distance), capsule.radius.value - distance, closest.trianglePoint);
}

const capsuleVoidWallContact = (capsule, voidWall) => deepestContactInBox(voidWall.triangles, capsuleQueryBox(capsule), (triangle) => capsuleVoidWallTriangleContact(capsule, triangle));

const axisDuplicateDot = 0.9999;

// SAT of the box against the overlapping triangles taken as one hull — smallest overlap wins.
function aabbTriangleSetContact(aabb, soup, oneSided) {
	const center = AabbCenter(aabb);

	const cluster = [];
	for (const triangle of soup.triangles) {
		if (!TriangleInQueryBox(triangle, aabb)) continue;

		// One-sided: only front faces that see the center participate.
		if (oneSided && DotVector3(triangle.normal, SubtractVector3(center, triangle.a)) < 0) continue;
		cluster.push(triangle);
	}
	if (cluster.length === 0) return noContact();

	const axes = [...worldBoxAxes];
	for (const triangle of cluster) {
		let duplicate = false;
		// Anti-parallel normals dedupe to one axis.
		for (const axis of axes) if (Math.abs(DotVector3(triangle.normal, axis)) > axisDuplicateDot) { 
			duplicate = true; 
			break; 
		}
		if (!duplicate) axes.push(triangle.normal);
	}

	let best = null;
	for (const axis of axes) {
		let triMin = Infinity, triMax = -Infinity;
		for (const triangle of cluster) {
			const pa = DotVector3(triangle.a, axis);
			const pb = DotVector3(triangle.b, axis);
			const pc = DotVector3(triangle.c, axis);
			triMin = Math.min(triMin, pa, pb, pc);
			triMax = Math.max(triMax, pa, pb, pc);
		}

		const radius        = projectAabbRadiusOntoAxis(AabbHalfExtents(aabb), axis);
		const centerProject = DotVector3(center, axis);
		const overlap       = Math.min(centerProject + radius, triMax) - Math.max(centerProject - radius, triMin);
		if (overlap <= 0) return noContact();
		if (!best || overlap < best.depth) {
			best = { unit: axis, depth: overlap, centerProject, hullCenter: (triMin + triMax) * 0.5 };
		}
	}

	const normal = best.centerProject - best.hullCenter >= 0 ? best.unit : ScaleVector3(best.unit, -1);

	const facesNormal = (triangle, best) => DotVector3(triangle.normal, normal) > DotVector3(best.normal, normal);
	const contactTriangle = BestMatchOf(cluster, facesNormal, cluster[0]);
	
	// One-sided: reject a normal no front face backs.
	if (oneSided && DotVector3(contactTriangle.normal, normal) <= 0) return noContact();

	return makeContact(normal, best.depth, ClosestPointOnTriangle(center, contactTriangle.a, contactTriangle.b, contactTriangle.c));
}

const aabbTriangleSoupContact = (aabb, triangleSoup) => aabbTriangleSetContact(aabb, triangleSoup, false);
const aabbVoidWallContact     = (aabb, voidWall)     => aabbTriangleSetContact(aabb, voidWall, true);

/* === NARROWPHASE === */
// Contact between any two collider shapes.

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

function iterateCompoundSpheres(compound, contactFn) {
	let best = noContact();
	compound.spheres.forEach(sphere => best = chooseDeepestContact(best, contactFn(sphere)));
	return best;
}

// The same contact seen from the other shape: its normal flipped.
function invertContact(contact) {
	if (!contact.hit) return contact;
	return { hit: true, normal: ScaleVector3(contact.normal, -1), depth: contact.depth, point: contact.point };
}

function NarrowphaseContact(boundsA, boundsB) {
	switch (boundsA.type.substring(0, 2) + boundsB.type.substring(0, 2)) {
		case "spsp": return sphereSphereContact(boundsA.center, boundsA.radius, boundsB.center, boundsB.radius);
		case "spaa": return sphereAABBContact(boundsA.center, boundsA.radius, boundsB);
		case "aasp": return invertContact(sphereAABBContact(boundsB.center, boundsB.radius, boundsA));
		case "spob": return sphereOBBContact(boundsA.center, boundsA.radius, boundsB);
		case "obsp": return invertContact(sphereOBBContact(boundsB.center, boundsB.radius, boundsA));
		case "spca": return sphereCapsuleContact(boundsA.center, boundsA.radius, boundsB);
		case "casp": return invertContact(sphereCapsuleContact(boundsB.center, boundsB.radius, boundsA));
		case "caaa": return capsuleAABBContact(boundsA, boundsB);
		case "aaca": return invertContact(capsuleAABBContact(boundsB, boundsA));
		case "caca": return capsuleCapsuleContact(boundsA, boundsB);
		case "caob": return capsuleOBBContact(boundsA, boundsB);
		case "obca": return invertContact(capsuleOBBContact(boundsB, boundsA));
		case "sptr": return sphereTriangleSoupContact(boundsA.center, boundsA.radius, boundsB);
		case "trsp": return invertContact(sphereTriangleSoupContact(boundsB.center, boundsB.radius, boundsA));
		case "catr": return capsuleTriangleSoupContact(boundsA, boundsB);
		case "trca": return invertContact(capsuleTriangleSoupContact(boundsB, boundsA));
		case "spvo": return sphereVoidWallContact(boundsA.center, boundsA.radius, boundsB);
		case "vosp": return invertContact(sphereVoidWallContact(boundsB.center, boundsB.radius, boundsA));
		case "cavo": return capsuleVoidWallContact(boundsA, boundsB);
		case "voca": return invertContact(capsuleVoidWallContact(boundsB, boundsA));
		case "aatr": return aabbTriangleSoupContact(boundsA, boundsB);
		case "traa": return invertContact(aabbTriangleSoupContact(boundsB, boundsA));
		case "aavo": return aabbVoidWallContact(boundsA, boundsB);
		case "voaa": return invertContact(aabbVoidWallContact(boundsB, boundsA));
		case "aaaa": return aabbAabbContact(boundsA, boundsB);
		case "aaob": return aabbObbContact(boundsA, boundsB);
		case "obaa": return invertContact(aabbObbContact(boundsB, boundsA));

		case "spco": return iterateCompoundSpheres(boundsB, s => sphereSphereContact(boundsA.center, boundsA.radius, s.center, s.radius));
		case "cosp": return iterateCompoundSpheres(boundsA, s => invertContact(sphereSphereContact(boundsB.center, boundsB.radius, s.center, s.radius)));
		case "caco": return iterateCompoundSpheres(boundsB, s => invertContact(sphereCapsuleContact(s.center, s.radius, boundsA)));
		case "coca": return iterateCompoundSpheres(boundsA, s => sphereCapsuleContact(s.center, s.radius, boundsB));
	}

	if (boundsA.type === "compound-sphere") return iterateCompoundSpheres(boundsA, s => NarrowphaseContact({ type: "sphere", center: s.center, radius: s.radius }, boundsB));
	if (boundsB.type === "compound-sphere") return iterateCompoundSpheres(boundsB, s => NarrowphaseContact(boundsA, { type: "sphere", center: s.center, radius: s.radius }));

	return noContact();
}

/* === ACCELERATION & VELOCITY === */

const ApplyAcceleration = (vel, dir, acc, dt) => AddVector3(vel, ScaleVector3(dir, acc * dt));

function ApplyDeceleration(velocity, deceleration, dt) {
	const speed = Vector3Length(velocity);
	if (speed <= 0.0001) return ToVector3(0);

	const newSpeed = Math.max(0, speed - deceleration * dt);
	return newSpeed <= 0.0001 ? ToVector3(0) : ScaleVector3(ResolveVector3Axis(velocity), newSpeed);
}

function ClampVelocity(velocity, maxSpeed) {
	const speed = Vector3Length(velocity);
	return (speed <= maxSpeed || speed <= 0.0001) ? velocity : ScaleVector3(ResolveVector3Axis(velocity), maxSpeed);
}

/* === PROJECTION & REFLECTION === */

const ProjectOntoPlane = (v, n) => SubtractVector3(v, ScaleVector3(n, DotVector3(v, n)));

/* === CONTACT RESPONSE === */

// How head-on a velocity meets a wall, measured on the ground plane: 1 is straight in, 0 is along it or no horizontal part.
function HorizontalApproach(velocity, normal) {
	const horizontalVelocity = { x: velocity.x, y: 0, z: velocity.z };
	const horizontalNormal = { x: normal.x, y: 0, z: normal.z };
	const velocityLengthSq = Vector3Sq(horizontalVelocity);
	const normalLengthSq = Vector3Sq(horizontalNormal);
	if (velocityLengthSq <= EPSILON || normalLengthSq <= EPSILON) return 0;
	return -DotVector3(horizontalVelocity, horizontalNormal) / Math.sqrt(velocityLengthSq * normalLengthSq);
}

/**
 * Pushes out of and slides along each contact in order.
 * @param {{ x, y, z }} velocity — per-second velocity.
 * @param {{ x, y, z }} displacement — velocity * dt.
 * @param {{ items, count }} contacts — sorted collision results.
 * @param {{ normal, minCos }|null} fold — kept footing's surface and walkable fold limit; null slides plainly.
 * @returns {{ velocity, displacement, changedPosition, changedVelocity }}
 */
function SlideAlongContacts(velocity, displacement, contacts, fold) {
	let vel = CloneVector3(velocity);
	let footing = fold === null ? null : fold.normal;
	let disp = CloneVector3(displacement);
	let changedPosition = false, changedVelocity = false;

	for (let i = 0; i < contacts.count; i++) {
		const collision = contacts.items[i];
		if (collision.pushDepth > 0) {
			disp = AddVector3(disp, ScaleVector3(collision.normal, collision.pushDepth));
			changedPosition = changedPosition || collision.pushDepth > EPSILON;
		}

		// Slide along the hit surface; across a walkable fold, first turn velocity onto the new surface, keeping its speed.
		let velDotN = DotVector3(vel, collision.normal);
		if (velDotN < -EPSILON && footing !== null && DotVector3(footing, collision.normal) >= fold.minCos) {
			vel = TransportVector3(vel, footing, collision.normal);
			footing = collision.normal;
			velDotN = DotVector3(vel, collision.normal);
			changedVelocity = true;
		}
		if (velDotN < 0) {
			vel = SubtractVector3(vel, ScaleVector3(collision.normal, velDotN));
			changedVelocity = changedVelocity || Math.abs(velDotN) > EPSILON;
		}

		// Swept hits move to the impact point first, then clip only the travel left over; overlap hits were already pushed out above.
		if (collision.pushDepth <= EPSILON && collision.tEntry > 0) {
			const entryDisplacement = ScaleVector3(disp, collision.tEntry);
			let remainingDisplacement = SubtractVector3(disp, entryDisplacement);
			const remainingDotN = DotVector3(remainingDisplacement, collision.normal);
			if (remainingDotN < 0) {
				remainingDisplacement = SubtractVector3(remainingDisplacement, ScaleVector3(collision.normal, remainingDotN));
				changedPosition = changedPosition || Math.abs(remainingDotN) > EPSILON;
			}
			disp = AddVector3(entryDisplacement, remainingDisplacement);
		}
		else {
			const dispDotN = DotVector3(disp, collision.normal);
			if (dispDotN < 0) {
				disp = SubtractVector3(disp, ScaleVector3(collision.normal, dispDotN));
				changedPosition = changedPosition || Math.abs(dispDotN) > EPSILON;
			}
		}
	}

	return { velocity: vel, displacement: disp, changedPosition, changedVelocity };
}

/* === GROUND PROBE === */
// Boxes ground only through a face the point is directly over: inside is embedded, past an edge or corner is nothing underfoot.

// Gap from a point to the box face below it, with that face's normal; null when there is no such face within maxDist.
function PointAabbFaceGap(point, aabb, maxDist) {
	const closest = ClampVector3(point, aabb.min, aabb.max);
	const offset  = SubtractVector3(point, closest);
	if ((offset.x !== 0) + (offset.y !== 0) + (offset.z !== 0) !== 1) return null;

	const t = Math.abs(offset.x + offset.y + offset.z);
	if (t > maxDist) return null;
	return { t, normal: { x: Math.sign(offset.x), y: Math.sign(offset.y), z: Math.sign(offset.z) }, point: closest };
}

// The same face gap for a rotated box.
function PointObbFaceGap(point, obb, maxDist) {
	let closest = CloneVector3(obb.center);
	let faceAxis = 0, faceSign = 1;
	let t = 0;
	let outsideAxes = 0;
	const local = projectToObbLocal(point, obb, true);
	for (let axis = 0; axis < 3; axis++) {
		const key = "xyz"[axis];
		const extent = obb.halfExtents[key];
		const along = local[key];

		closest = AddVector3(closest, ScaleVector3(obb.axes[axis], Clamp(along, -extent, extent)));

		if (Math.abs(along) <= extent) continue;
		outsideAxes++;
		faceAxis = axis;
		faceSign = along >= 0 ? 1 : -1;
		t = Math.abs(along) - extent;
	}

	return (outsideAxes !== 1 || t > maxDist) ? null : { t, normal: ScaleVector3(obb.axes[faceAxis], faceSign), point: closest };
}

// Offset to the nearest point; null when behind the face.
function reachesTriangle(from, triangle) {
	const offset = SubtractVector3(from, ClosestPointOnTriangle(from, triangle.a, triangle.b, triangle.c));
	return DotVector3(offset, triangle.normal) < 0 ? null : offset;
}

// Triangle closest to the point by true distance, among those within maxDist that face it; null when none do.
function NearestFrontTriangle(point, soup, maxDist) {
	let soupDistanceSq = maxDist ** 2, soupTriangle = null, soupOffset = null;
	for (const triangle of soup.triangles) {
		const { a,b,c } = triangle;

		// Skips triangles whose box, grown by maxDist, doesn't hold the point.
		if (!(point.x >= Math.min(a.x, b.x, c.x) - maxDist && point.x <= Math.max(a.x, b.x, c.x) + maxDist)) continue;
		if (!(point.y >= Math.min(a.y, b.y, c.y) - maxDist && point.y <= Math.max(a.y, b.y, c.y) + maxDist)) continue;
		if (!(point.z >= Math.min(a.z, b.z, c.z) - maxDist && point.z <= Math.max(a.z, b.z, c.z) + maxDist)) continue;

		const offset = reachesTriangle(point, triangle);
		if (offset === null) continue;

		const distanceSq = Vector3Sq(offset);
		if (distanceSq >= soupDistanceSq) continue;

		soupDistanceSq = distanceSq;
		soupTriangle = triangle;
		soupOffset = offset;
	}
	if (soupTriangle === null) return null;

	return {
		t: Math.sqrt(soupDistanceSq),
		normal: CloneVector3(soupTriangle.normal),
		point: SubtractVector3(point, soupOffset),
	};
}

/* === SURFACE ALIGNMENT === */

/**
 * Orientation whose local up matches `alignedUp`, steered by the entity's current heading.
 * @param {{ x, y, z }} alignedUp — unit target up-vector.
 * @param {{ x, y, z }} facing — unit world-space heading.
 * @param {{ x, y, z }} rotation — the entity's current rotation, radians; roll seed and last-resort heading.
 * @param {boolean} onBack — sliding pose; lays the body on its back.
 * @returns {{ x: number, y: number, z: number }}
 */
function SurfaceAlignedRotation(alignedUp, facing, rotation, onBack) {
	let planar = ProjectOntoPlane(facing, alignedUp);
	if (Vector3Length(planar) <= 0.05) {
		// Aim uphill instead, or keep the flat heading when the surface has no uphill.
		const uphill = ProjectOntoPlane(WORLD_NORMALS.Up, alignedUp);
		planar = Vector3Length(uphill) > EPSILON ? uphill : { x: Math.sin(rotation.y), y: 0, z: Math.cos(rotation.y) };
	}

	const right = ResolveVector3Axis(CrossVector3(alignedUp, planar));
	const forward = CrossVector3(right, alignedUp);

	// Sliding lays the body on its back, its front facing away from the surface.
	return onBack
		? EulerFromBasis(right, ScaleVector3(forward, -1), alignedUp, rotation.z)
		: EulerFromBasis(right, alignedUp, forward, rotation.z);
}

/* === AABB OVERLAP === */

function AabbOverlap(aabbA, aabbB, strict = false) {
	return strict 
		? CompareVector3(aabbA.min, aabbB.max, "lesser")       && CompareVector3(aabbA.max, aabbB.min, "greater")
		: CompareVector3(aabbA.min, aabbB.max, "lesser-loose") && CompareVector3(aabbA.max, aabbB.min, "greater-loose");
}

// Returns a copy of an AABB expanded by epsilon on the y axis only (x/z untouched).
function ExpandAabbY(aabb, epsilon) {
	return {
		min: { x: aabb.min.x, y: aabb.min.y - epsilon, z: aabb.min.z },
		max: { x: aabb.max.x, y: aabb.max.y + epsilon, z: aabb.max.z },
	};
}

// True when the box, grown by `padding` on every side, is fully behind one of the view's walls.
function AabbOutsideFrustum(planes, aabb, padding = 0) {
	for (const [x, y, z, offset] of planes) {
		const reach = 
		 	  x * (x >= 0 ? aabb.max.x + padding : aabb.min.x - padding)
			+ y * (y >= 0 ? aabb.max.y + padding : aabb.min.y - padding)
			+ z * (z >= 0 ? aabb.max.z + padding : aabb.min.z - padding);
		if (reach + offset < 0) return true;
	}
	return false;
}

/* === BOUNDS FROM AABB === */
// Collider shapes fitted to a box.

// Center and half-size of a box, as plain vectors rather than UnitVector3.
const AabbCenter      = (aabb) => ScaleVector3(AddVector3(aabb.min, aabb.max), 0.5);
const AabbHalfExtents = (aabb) => ScaleVector3(SubtractVector3(aabb.max, aabb.min), 0.5);

// Inscribed fits inside the box; otherwise the sphere reaches the box's corners.
function SphereFromAabb(aabb, inscribed) {
	const half   = AabbHalfExtents(aabb);
	const radius = inscribed ? Math.min(half.x, half.y, half.z) : Vector3Length(half);
	return {
		type  : "sphere",
		center: aabb.min.clone().set(AabbCenter(aabb)),
		radius: new Unit(Math.max(0.0001, radius), "cnu"),
	};
}

// Upright capsule as wide as the box's wider horizontal side.
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

/* === SOLID QUERIES === */
// Build-time inside/outside checks for closed meshes of any shape.

// Note: Tilted ray direction for inside/outside tests. Straight rays can run along box edges and miscount.
const parityRayDirection = ResolveVector3Axis({ x: 0.4371383, y: 0.7218935, z: 0.5364271 });
const planeCrossEpsilon  = 0.000001;

function TriangleAabb(triangle) {
	return {
		min: MinVector3(triangle.a, MinVector3(triangle.b, triangle.c)),
		max: MaxVector3(triangle.a, MaxVector3(triangle.b, triangle.c)),
	};
}

// Box around a list of points, optionally grown from a starting box.
function PointsAabb(points, min = ToVector3(Infinity), max = ToVector3(-Infinity), transform = null, skip = null) {
	for (const entry of points) {
		if (skip !== null && skip(entry)) continue;

		const point = transform === null ? entry : transform(entry);
		min = MinVector3(min, point);
		max = MaxVector3(max, point);
	}
	return { min, max };
}

// Min over each triangle's edges against the other; 0 when they cross.
function TriangleDistanceSq(t1, t2) {
	let best = Infinity;
	for (const [from, to] of [[t1, t2], [t2, t1]]) {
		for (const [start, end] of [[from.a, from.b], [from.b, from.c], [from.c, from.a]]) {
			best = Math.min(best, closestPointsSegmentTriangle(start, end, to.a, to.b, to.c, to.normal).distanceSq);
		}
	}
	return best;
}

// Whether the fixed tilted ray from the point crosses the triangle.
function insideRayCrosses(point, triangle) {
	// Skip triangles wholly below the point on any axis; the ray only heads toward +x, +y and +z.
	const { a, b, c } = triangle;
	if (!(Math.max(a.x, b.x, c.x) >= point.x && Math.max(a.y, b.y, c.y) >= point.y && Math.max(a.z, b.z, c.z) >= point.z)) return false;
	return RayTriangleIntersect(point, parityRayDirection, triangle).hit;
}

// Odd crossing count along a fixed ray means the point is enclosed.
function PointInsideMesh(point, triangles) {
	let crossings = 0;
	for (const triangle of triangles) if (insideRayCrosses(point, triangle)) crossings++;
	return (crossings & 1) === 1;
}

// Padding (share of a cell) that stops rounding from dropping a triangle out of a cell.
const gridCellPadding = 0.01;

// Grid cell along one axis that holds a coordinate, kept inside the grid.
const gridAxisCell = (value, start, cellSize, count) => Math.min(count - 1, Math.max(0, Math.floor((value - start) / cellSize)));

// Splits a mesh's bounds into equal cubes, each listing the triangles whose bounds touch it.
function BuildTriangleGrid(triangles, triangleAabbs) {
	let min = ToVector3(Infinity), max = ToVector3(-Infinity);
	let area = 0;

	for (let i = 0; i < triangles.length; i++) {
		const triangle = triangles[i];
		min = MinVector3(min, triangleAabbs[i].min);
		max = MaxVector3(max, triangleAabbs[i].max);
		area += TriangleArea(triangle.a, triangle.b, triangle.c);
	}

	// Cell size chosen so a cell holds about CARVE_GRID_TRIANGLES_PER_CELL average triangles.
	const cellSize = Math.sqrt(CARVE_GRID_TRIANGLES_PER_CELL * area / triangles.length);
	const pad      = cellSize * gridCellPadding;
	const nx       = Math.max(1, Math.ceil((max.x - min.x) / cellSize));
	const ny       = Math.max(1, Math.ceil((max.y - min.y) / cellSize));
	const nz       = Math.max(1, Math.ceil((max.z - min.z) / cellSize));

	// Each cell lists its triangles in ascending order.
	const cells = new Map();
	for (let i = 0; i < triangles.length; i++) {
		const bounds = triangleAabbs[i];
		const x0 = gridAxisCell(bounds.min.x - pad, min.x, cellSize, nx), x1 = gridAxisCell(bounds.max.x + pad, min.x, cellSize, nx);
		const y0 = gridAxisCell(bounds.min.y - pad, min.y, cellSize, ny), y1 = gridAxisCell(bounds.max.y + pad, min.y, cellSize, ny);
		const z0 = gridAxisCell(bounds.min.z - pad, min.z, cellSize, nz), z1 = gridAxisCell(bounds.max.z + pad, min.z, cellSize, nz);

		for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
			const key = x + nx * (y + ny * z);
			if (!cells.has(key)) cells.set(key, []);
			cells.get(key).push(i);
		}
	}

	return {
		triangles, min, cellSize, pad, nx, ny, nz, cells,
		allIndices: triangles.map((_, index) => index),
		stamps    : new Uint32Array(triangles.length),          // Last query that saw each triangle, to skip repeats across cells.
		stamp     : 0,
	};
}

// Triangle indices from the cells the box touches, ascending to match a full scan's order.
function TriangleGridCandidates(grid, aabb) {
	const { min, cellSize, nx, ny, nz } = grid;
	const x0 = gridAxisCell(aabb.min.x, min.x, cellSize, nx), x1 = gridAxisCell(aabb.max.x, min.x, cellSize, nx);
	const y0 = gridAxisCell(aabb.min.y, min.y, cellSize, ny), y1 = gridAxisCell(aabb.max.y, min.y, cellSize, ny);
	const z0 = gridAxisCell(aabb.min.z, min.z, cellSize, nz), z1 = gridAxisCell(aabb.max.z, min.z, cellSize, nz);

	// A box spanning more cells than there are triangles is cheaper to answer with every triangle.
	if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > grid.triangles.length) return grid.allIndices;

	const stamp = ++grid.stamp;
	const found = [];
	for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
		const cell = grid.cells.get(x + nx * (y + ny * z));
		if (cell === undefined) continue;
		for (const index of cell) {
			if (grid.stamps[index] === stamp) continue;
			grid.stamps[index] = stamp;
			found.push(index);
		}
	}
	return found.sort((a, b) => a - b);
}

// Same answer as PointInsideMesh, testing only triangles in the grid cells the ray passes through.
function PointInsideTriangleGrid(point, grid) {
	const { min, cellSize, pad, nx, ny, nz } = grid;
	const ray = parityRayDirection;

	// Where the ray enters and leaves the padded grid box.
	const tEnter = Math.max(0, (min.x - pad - point.x) / ray.x, (min.y - pad - point.y) / ray.y, (min.z - pad - point.z) / ray.z);
	const tLeave = Math.min(
		(min.x + nx * cellSize + pad - point.x) / ray.x,
		(min.y + ny * cellSize + pad - point.y) / ray.y,
		(min.z + nz * cellSize + pad - point.z) / ray.z
	);
	if (tEnter > tLeave) return false;

	let x = gridAxisCell(point.x + ray.x * tEnter, min.x, cellSize, nx);
	let y = gridAxisCell(point.y + ray.y * tEnter, min.y, cellSize, ny);
	let z = gridAxisCell(point.z + ray.z * tEnter, min.z, cellSize, nz);

	const stamp = ++grid.stamp;
	let crossings = 0;

	while (true) {
		const cell = grid.cells.get(x + nx * (y + ny * z));
		if (cell !== undefined) {
			for (const index of cell) {
				if (grid.stamps[index] === stamp) continue;
				grid.stamps[index] = stamp;
				if (insideRayCrosses(point, grid.triangles[index])) crossings++;
			}
		}

		// Step into whichever next cell the ray reaches first; stop once it leaves the grid.
		const tx = (min.x + (x + 1) * cellSize - point.x) / ray.x;
		const ty = (min.y + (y + 1) * cellSize - point.y) / ray.y;
		const tz = (min.z + (z + 1) * cellSize - point.z) / ray.z;
		if (tx <= ty && tx <= tz) { 
			if (++x === nx) break; 
		}
		else if (ty <= tz) { 
			if (++y === ny) break; 
		}
		else if (++z === nz) break;
	}

	return (crossings & 1) === 1;
}

// Splits a polygon in two along a plane, given by its normal and distance from the origin; null when the plane doesn't cut through it.
function SplitPolygonByPlane(polygon, planeNormal, planeOffset) {
	const distances = polygon.map((vertex) => DotVector3(planeNormal, vertex) - planeOffset);

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

// Tests each edge only against the target triangles in the grid cells the edge's box touches.
function edgesCrossMesh(triangles, targetGrid) {
	for (const triangle of triangles) {
		for (const edge of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
			const delta  = SubtractVector3(edge[1], edge[0]);
			const length = Math.sqrt(Vector3Sq(delta));
			if (length <= planeCrossEpsilon) continue;

			const direction = ScaleVector3(delta, 1 / length);
			const edgeAabb  = { min: MinVector3(edge[0], edge[1]), max: MaxVector3(edge[0], edge[1]) };
			for (const index of TriangleGridCandidates(targetGrid, edgeAabb)) {
				if (RayTriangleIntersect(edge[0], direction, targetGrid.triangles[index], length).hit) return true;
			}
		}
	}
	return false;
}

// Meshes overlap if either holds a corner of the other, or any edge of either crosses the other.
function MeshesIntersect(solidA, solidB) {
	for (const triangle of solidA.triangles) if (PointInsideTriangleGrid(triangle.a, solidB.grid)) return true;
	for (const triangle of solidB.triangles) if (PointInsideTriangleGrid(triangle.a, solidA.grid)) return true;
	if (edgesCrossMesh(solidA.triangles, solidB.grid)) return true;
	return edgesCrossMesh(solidB.triangles, solidA.grid);
}

/* === BLOCKERS === */
// Solid boxes inside terrain shapes, with every void cut out, hide whatever sits fully behind them.

// Largest box that fits inside a shape, centred and before scale, sized to the flat sides a round shape is built from.
function InscribedBox(primitive, dimensions, primitiveOptions) {
	const r = { x: dimensions.x / 2, y: primitive === "plane" ? 0 : dimensions.y / 2, z: dimensions.z / 2 };
	function box(x0, x1, y0, y1, z0, z1) {
		return { min: { x: x0 * r.x, y: y0 * r.y, z: z0 * r.z }, max: { x: x1 * r.x, y: y1 * r.y, z: z1 * r.z } };
	}

	const round = 0.92 / Math.SQRT2, faceted = 0.88;
	const ball = faceted / Math.sqrt(3), coneHalf = round * 2 / 3;
	switch (primitive) {
		case "cube": case "plane": return box(-1, 1, -1, 1, -1, 1);
		case "cylinder"   : return box(-round, round, -1, 1, -round, round);
		case "sphere"     : return box(-ball, ball, -ball, ball, -ball, ball);
		case "cone"       : return box(-coneHalf, coneHalf, -1, -1 / 3, -coneHalf, coneHalf);
		case "pyramid"    : return box(-2 / 3, 2 / 3, -1, -1 / 3, -2 / 3, 2 / 3);
		case "ramp-simple": return box(-1, 1, -1, 0, 0, 1);
		case "capsule": {
			// Widest box that still reaches into the capsule's rounded ends.
			const cap = primitiveOptions.rounding, straight = 1 - cap;
			if (cap <= 0) return box(-round, round, -1, 1, -round, round);
			const s = straight / cap, e = (Math.sqrt(s * s + 3) - s) / 3, a = faceted * Math.sqrt((1 - e * e) / 2);
			const reach = straight + faceted * e * cap;
			return box(-a, a, -reach, reach, -a, a);
		}
		default: return null;
	}
}

// Boxes in the host's own space that together hold a whole void. A tube gets one per stretch, overlapping its neighbours.
function VoidCutBoxes(solidTriangles, centerline, inverse) {
	const points = solidTriangles.flatMap((triangle) => [triangle.a, triangle.b, triangle.c]);
	const local  = points.map((point) => TransformPointByMatrix(point, inverse));

	// Index of the tube stretch closest to a point.
	function nearestStretch(point) {
		let best = 0, bestSq = Infinity;
		for (let i = 0; i < centerline.length - 1; i++) {
			const distanceSq = Vector3Sq(SubtractVector3(point, closestPointOnSegment(point, centerline[i], centerline[i + 1])));
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

// What's left of a box once a cut is removed: up to 6 solid slabs around it.
function subtractBox(box, cut) {
	const apartX = cut.max.x <= box.min.x || cut.min.x >= box.max.x;
	const apartY = cut.max.y <= box.min.y || cut.min.y >= box.max.y;
	const apartZ = cut.max.z <= box.min.z || cut.min.z >= box.max.z;
	if (apartX || apartY || apartZ) return [box];

	const out = [], lo = { ...box.min }, hi = { ...box.max };
	for (const axis of ["x", "y", "z"]) {
		if (cut.min[axis] > lo[axis]) out.push({ min: { ...lo }, max: { ...hi, [axis]: cut.min[axis] } });
		if (cut.max[axis] < hi[axis]) out.push({ min: { ...lo, [axis]: cut.max[axis] }, max: { ...hi } });
		lo[axis] = Math.max(lo[axis], cut.min[axis]);
		hi[axis] = Math.min(hi[axis], cut.max[axis]);
	}
	return out;
}

// Area of a box's largest side.
function AabbLargestFace(box) {
	const v = SubtractVector3(box.max, box.min);
	return Math.max(v.x * v.y, v.y * v.z, v.x * v.z);
}

// Joins any two pieces that share a whole side into one.
function mergeTouching(pieces) {
	const axes = ["x", "y", "z"];
	function touching(a, b, axis) {
		const sameSpan = axes.every((other) => other === axis || (a.min[other] === b.min[other] && a.max[other] === b.max[other]));
		return sameSpan && (a.max[axis] === b.min[axis] || b.max[axis] === a.min[axis]);
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

// Solid pieces left once every cut is removed: joined, scraps and narrow pieces dropped, the largest 8 kept.
function SolidBoxes(inner, cuts, scale, minSize) {
	let pieces = [inner];
	for (const cut of cuts) pieces = pieces.flatMap((piece) => subtractBox(piece, cut));

	// The shorter side of a piece's largest face, at its true scaled size.
	function largestFaceWidth(piece) {
		const sides = ["x", "y", "z"].map((axis) => (piece.max[axis] - piece.min[axis]) * Math.abs(scale[axis]));
		return sides.sort((a, b) => a - b)[1];
	}

	const scrap = 0.01 * AabbLargestFace(inner);
	return mergeTouching(pieces)
		.filter((piece) => AabbLargestFace(piece) >= scrap && largestFaceWidth(piece) >= minSize.value)
		.sort((a, b) => AabbLargestFace(b) - AabbLargestFace(a))
		.slice(0, 8);
}

// Puts the 8 points in scratch on screen and records the rectangle around them. False when one is at or behind the camera's near limit.
function ProjectBoxCorners(viewProjection, near, scratch) {
	const m = viewProjection, { wx, wy, wz, sx, sy, rect } = scratch;
	rect.fill(Infinity, 0, 2);
	rect.fill(-Infinity, 2);
	for (let k = 0; k < 8; k++) {
		const w = m[3] * wx[k] + m[7] * wy[k] + m[11] * wz[k] + m[15];
		if (w <= near) return false;
		sx[k] = (m[0] * wx[k] + m[4] * wy[k] + m[8] * wz[k] + m[12]) / w;
		sy[k] = (m[1] * wx[k] + m[5] * wy[k] + m[9] * wz[k] + m[13]) / w;
		rect[0] = Math.min(rect[0], sx[k]);
		rect[1] = Math.min(rect[1], sy[k]);
		rect[2] = Math.max(rect[2], sx[k]);
		rect[3] = Math.max(rect[3], sy[k]);
	}
	return true;
}

// Counter-clockwise outline around 8 screen points.
function ConvexHull2D(xs, ys) {
	const sorted = Array.from({ length: 8 }, (_, k) => ({ x: xs[k], y: ys[k] })).sort((a, b) => a.x - b.x || a.y - b.y);
	const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
	function half(list) {
		return list.reduce((chain, p) => {
			while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0) chain.pop();
			chain.push(p);
			return chain;
		}, []);
	}
	return half(sorted).slice(0, -1).concat(half([...sorted].reverse()).slice(0, -1));
}

// True when all 8 screen points sit inside a counter-clockwise outline.
function CornersInsideHull(hull, xs, ys) {
	for (let i = 0; i < hull.length; i++) {
		const a = hull[i], b = hull[(i + 1) % hull.length];
		for (let k = 0; k < 8; k++) if ((b.x - a.x) * (ys[k] - a.y) - (b.y - a.y) * (xs[k] - a.x) < 0) return false;
	}
	return true;
}

// True when the box hides all 8 world points: each lies past every side of the box that faces the camera.
function BeyondFrontFaces(min, max, inverse, cameraLocal, wx, wy, wz) {
	const m = inverse, c = cameraLocal;
	for (let k = 0; k < 8; k++) {
		const x = m[0] * wx[k] + m[4] * wy[k] + m[8] * wz[k] + m[12];
		const y = m[1] * wx[k] + m[5] * wy[k] + m[9] * wz[k] + m[13];
		const z = m[2] * wx[k] + m[6] * wy[k] + m[10] * wz[k] + m[14];
		if ((c.x < min.x && x <= min.x) || (c.x > max.x && x >= max.x)) return false;
		if ((c.y < min.y && y <= min.y) || (c.y > max.y && y >= max.y)) return false;
		if ((c.z < min.z && z <= min.z) || (c.z > max.z && z >= max.z)) return false;
	}
	return true;
}

/* === SWEPT AABB === */
// Continuous collision detection for moving AABB against static AABB.
// Returns { hit, tEntry, tExit, normal }.

// A swept box that hits nothing.
const noSweptHit = Object.freeze({ hit: false, tEntry: 1, tExit: 1, normal: Object.freeze(ToVector3(0)) });

function SweptAABB(position, velocity, halfExtents, staticAabb) {
	let tEntryMax = -Infinity, tExitMin = Infinity, entryAxis = null, entrySign = -1;

	for (const axis of ["x", "y", "z"]) {
		const p = position[axis], v = velocity[axis];
		const bMin = staticAabb.min[axis] - halfExtents[axis];
		const bMax = staticAabb.max[axis] + halfExtents[axis];

			// Ray is parallel to slab — no collision possible unless already inside.
		if (Math.abs(v) < EPSILON) {
			if (p < bMin || p > bMax) return noSweptHit;
			continue;
		}

		let tNear = (bMin - p) / v, tFar = (bMax - p) / v;
		let nearNormalValue = -1;

		if (tNear > tFar) {
			const temp = tNear;
			tNear = tFar;
			tFar = temp;
			nearNormalValue = 1;
		}

		if (tNear > tEntryMax) {
			tEntryMax = tNear;
			entryAxis = axis;
			entrySign = nearNormalValue;
		}
		if (tFar < tExitMin) tExitMin = tFar;

		if (tEntryMax > tExitMin || tExitMin < 0) return noSweptHit;
	}

	if (tEntryMax < 0 || tEntryMax > 1) return noSweptHit;

	const normal = ToVector3(0);
	normal[entryAxis] = entrySign;
	return { hit: true, tEntry: tEntryMax, tExit: tExitMin, normal };
}

/* === RAY-AABB INTERSECTION === */
// Used by camera obstruction detection.
// Returns { hit, t, normal }.

// `inside`: exit hit — no surface faces the origin.
const noRayHit = () => { return { hit: false, t: Infinity, normal: ToVector3(0), inside: false } };

function chooseClosestRayHit(best, candidate) {
	if (!candidate.hit) return best;
	if (!best.hit || candidate.t < best.t) return candidate;
	return best;
}

const limitRayHit = (result, maxDistance) => !result.hit || result.t > maxDistance ? noRayHit() : result;

function RayAABBIntersect(origin, direction, aabb) {
	const result = { hit: false, t: Infinity, normal: ToVector3(0), inside: false };
	let tMin = -Infinity, tMax = Infinity;
	const hitNormal = ToVector3(0);

	for (let i = 0; i < 3; i++) {
		const axis = ["x", "y", "z"][i];
		const invD = Math.abs(direction[axis]) > 0.000001 ? 1 / direction[axis] : (direction[axis] >= 0 ? 1e12 : -1e12);
		let t1 = (aabb.min[axis] - origin[axis]) * invD, t2 = (aabb.max[axis] - origin[axis]) * invD;
		let nearSign = -1;

		if (t1 > t2) {
			const temp = t1;
			t1 = t2;
			t2 = temp;
			nearSign = 1;
		}

		if (t1 > tMin) {
			tMin = t1;
			hitNormal.x = 0; hitNormal.y = 0; hitNormal.z = 0;
			hitNormal[axis] = nearSign;
		}
		if (t2 < tMax) tMax = t2;

		if (tMin > tMax) return result;
	}

	if (tMin < 0) {
		if (tMax < 0) return result;

		// Origin inside the box — t is the exit.
		result.hit = true;
		result.t = tMax;
		result.normal = hitNormal;
		result.inside = true;
		return result;
	}

	result.hit = true;
	result.t = tMin;
	result.normal = hitNormal;
	return result;
}

function RaySphereIntersect(origin, direction, sphere, maxDistance = Infinity) {
	const offset = SubtractVector3(origin, sphere.center);
	const b = DotVector3(offset, direction);
	const c = DotVector3(offset, offset) - (sphere.radius.value * sphere.radius.value);
	if (c > 0 && b > 0) return noRayHit();

	const discriminant = (b * b) - c;
	if (discriminant < 0) return noRayHit();

	const root = Math.sqrt(discriminant);
	let t = -b - root;

	// Near root behind us — inside, so take the exit root.
	const inside = t < 0;
	if (inside) t = -b + root;
	if (t < 0 || t > maxDistance) return noRayHit();

	return {
		hit: true, t, inside,
		normal: ResolveVector3Axis(SubtractVector3(AddVector3(origin, ScaleVector3(direction, t)), sphere.center)),
	};
}

function RayOBBIntersect(origin, direction, obb, maxDistance = Infinity) {
	const result = limitRayHit(RayAABBIntersect(
		projectToObbLocal(origin, obb, true), 
		projectToObbLocal(direction, obb), 
		{ min: ScaleVector3(obb.halfExtents, -1), max: CloneVector3(obb.halfExtents) }
	), maxDistance);
	if (!result.hit) return result;
	return {
		hit: true,
		t: result.t,
		inside: result.inside,
		normal: projectObbNormalToWorld(result.normal, obb),
	};
}

function RayCapsuleIntersect(origin, direction, capsule, maxDistance = Infinity) {
	const segment = SubtractVector3(capsule.segmentEnd, capsule.segmentStart);
	const segmentLengthSq = Vector3Sq(segment);
	if (segmentLengthSq <= EPSILON) {
		return RaySphereIntersect(origin, direction, { center: capsule.segmentStart, radius: capsule.radius }, maxDistance);
	}

	const originOffset        = SubtractVector3(origin, capsule.segmentStart);
	const segmentDotDirection = DotVector3(segment, direction);
	const segmentDotOrigin    = DotVector3(segment, originOffset);
	const originLengthSq      = Vector3Sq(originOffset);
	const a = segmentLengthSq - (segmentDotDirection ** 2);
	const b = (segmentLengthSq * DotVector3(direction, originOffset)) - (segmentDotOrigin * segmentDotDirection);
	const c = 
		(segmentLengthSq * originLengthSq) - 
		(segmentDotOrigin * segmentDotOrigin) - 
		(capsule.radius.value * capsule.radius.value * segmentLengthSq);

	let best = noRayHit();

	if (Math.abs(a) > EPSILON) {
		const discriminant = (b * b) - (a * c);
		if (discriminant >= 0) {
			const root = Math.sqrt(discriminant);
			const roots = [(-b - root) / a, (-b + root) / a];

			roots.forEach((t, rootIndex) => {
				if (t < 0 || t > maxDistance) return;

				const y = segmentDotOrigin + (t * segmentDotDirection);
				if (y <= 0 || y >= segmentLengthSq) return;

				const axisPoint = AddVector3(capsule.segmentStart, ScaleVector3(segment, y / segmentLengthSq));
				best = chooseClosestRayHit(best, {
					hit: true, t,
					inside: rootIndex === 1 && roots[0] < 0,
					normal: ResolveVector3Axis(SubtractVector3(AddVector3(origin, ScaleVector3(direction, t)), axisPoint)),
				});
			});
		}
	}

	["segmentStart", "segmentEnd"].forEach(t => {
		best = chooseClosestRayHit(best, RaySphereIntersect(origin, direction, {
			center: capsule[t], radius: capsule.radius,
		}, maxDistance));
	});

	return best;
}

function RayTriangleIntersect(origin, direction, triangle, maxDistance = Infinity) {
	const edgeAB = SubtractVector3(triangle.b, triangle.a);
	const edgeAC = SubtractVector3(triangle.c, triangle.a);
	const p = CrossVector3(direction, edgeAC);
	const determinant = DotVector3(edgeAB, p);
	if (Math.abs(determinant) <= EPSILON) return noRayHit();

	const invDet = 1 / determinant;
	const tvec = SubtractVector3(origin, triangle.a);
	const u = DotVector3(tvec, p) * invDet;
	if (u < 0 || u > 1) return noRayHit();

	const q = CrossVector3(tvec, edgeAB);
	const v = DotVector3(direction, q) * invDet;
	if (v < 0 || (u + v) > 1) return noRayHit();

	const t = DotVector3(edgeAC, q) * invDet;
	if (t < 0 || t > maxDistance) return noRayHit();

	return {
		hit: true, t, inside: false,
		normal: DotVector3(triangle.normal, direction) <= 0 ? CloneVector3(triangle.normal) : ScaleVector3(triangle.normal, -1),
	};
}

function RayTriangleSoupIntersect(origin, direction, triangleSoup, maxDistance = Infinity) {
	// A ray with a length only reaches triangles inside its own box.
	const reach = maxDistance === Infinity ? null : SegmentQueryBox(origin, AddVector3(origin, ScaleVector3(direction, maxDistance)), 0);
	let best = noRayHit();
	for (const triangle of triangleSoup.triangles) {
		if (reach !== null && !TriangleInQueryBox(triangle, reach)) continue;
		best = chooseClosestRayHit(best, RayTriangleIntersect(origin, direction, triangle, Math.min(best.t, maxDistance)));
	}
	return best;
}

function rayCompoundSphereIntersect(origin, direction, compound, maxDistance = Infinity) {
	let best = noRayHit();
	compound.spheres.forEach(sphere => best = chooseClosestRayHit(
		best, RaySphereIntersect(origin, direction, sphere, Math.min(best.t, maxDistance))
	));
	return best;
}

function RayAABBDetailedBoundsIntersect(origin, direction, aabb, detailedBounds, maxDistance = Infinity) {
	const broadHit = limitRayHit(RayAABBIntersect(origin, direction, aabb), maxDistance);
	if (!broadHit.hit)                  return broadHit;
	if (detailedBounds.type === "aabb") return broadHit;

	// Ray's own limit, not broadHit.t — an entry-t cap rejects every real hit.
	const hit = RayDetailedBoundsIntersect(detailedBounds, origin, direction, maxDistance);
	
	// Soups can't determine containment; inherit the broad answer.
	if (detailedBounds.type === "triangle-soup") hit.inside = broadHit.inside;
	return hit;
}

const rayDetailedBoundsIntersectors = {
	aabb: (bounds, origin, direction, maxDistance) => limitRayHit(RayAABBIntersect(origin, direction, bounds), maxDistance),
	obb: (bounds, origin, direction, maxDistance) => RayOBBIntersect(origin, direction, bounds, maxDistance),
	sphere: (bounds, origin, direction, maxDistance) => RaySphereIntersect(origin, direction, bounds, maxDistance),
	capsule: (bounds, origin, direction, maxDistance) => RayCapsuleIntersect(origin, direction, bounds, maxDistance),
	"triangle-soup": (bounds, origin, direction, maxDistance) => RayTriangleSoupIntersect(origin, direction, bounds, maxDistance),
	"voidWall"      : (bounds, origin, direction, maxDistance) => RayTriangleSoupIntersect(origin, direction, bounds, maxDistance),
	"compound-sphere": (bounds, origin, direction, maxDistance) => rayCompoundSphereIntersect(origin, direction, bounds, maxDistance),
};

function RayDetailedBoundsIntersect(bounds, origin, direction, maxDistance = Infinity) {
	return bounds === null ? noRayHit() : rayDetailedBoundsIntersectors[bounds.type](bounds, origin, direction, maxDistance);
}

/* === SWEPT SPHERE-AABB === */
// Expand AABB by sphere radius, ray-march center.
// Returns { hit, tEntry, normal }.

function sweptSphereAABB(center, velocity, radius, aabb) {
	const grow = ToVector3(radius);
	return RayAABBIntersect(center, velocity, { min: SubtractVector3(aabb.min, grow), max: AddVector3(aabb.max, grow) });
}

function sweptSphereOBB(center, velocity, radius, obb) {
	const result = sweptSphereAABB(
		projectToObbLocal(center, obb, true), 
		projectToObbLocal(velocity, obb), 
		radius, 
		{ min: ScaleVector3(CloneVector3(obb.halfExtents), -1), max: CloneVector3(obb.halfExtents) }
	);
	if (!result.hit) return result;
	return {
		hit: true, t: result.t,
		normal: projectObbNormalToWorld(result.normal, obb),
	};
}

// Sphere sweep against an OBB collider, or against the box around any other collider.
function SweptSphereBounds(center, displacement, radius, detailedBounds, aabb) {
	const result = detailedBounds.type === "obb"
		? sweptSphereOBB(center, displacement, radius, detailedBounds)
		: sweptSphereAABB(center, displacement, radius, aabb);
	return { hit: result.hit, tEntry: result.t, normal: result.normal };
}

/* === EXPORTS === */

export {
	ApplyAcceleration,
	ApplyDeceleration,
	ClampVelocity,
	ProjectOntoPlane,
	HorizontalApproach,
	SlideAlongContacts,
	PointAabbFaceGap,
	PointObbFaceGap,
	NearestFrontTriangle,
	SurfaceAlignedRotation,
	AabbOverlap,
	ExpandAabbY,
	AabbOutsideFrustum,
	AabbCenter,
	AabbHalfExtents,
	SphereFromAabb,
	CapsuleFromAabb,
	ObbFromAabb,
	ClosestPointOnTriangle,
	TriangleNormal,
	TriangleArea,
	TriangleCentroid,
	TriangleAabb,
	PointsAabb,
	TriangleDistanceSq,
	PointInsideMesh,
	BuildTriangleGrid,
	TriangleGridCandidates,
	PointInsideTriangleGrid,
	SplitPolygonByPlane,
	MeshesIntersect,
	InscribedBox,
	VoidCutBoxes,
	AabbLargestFace,
	SolidBoxes,
	ProjectBoxCorners,
	ConvexHull2D,
	CornersInsideHull,
	BeyondFrontFaces,
	SweptAABB,
	RayAABBIntersect,
	RayAABBDetailedBoundsIntersect,
	RaySphereIntersect,
	RayOBBIntersect,
	RayCapsuleIntersect,
	RayTriangleIntersect,
	RayTriangleSoupIntersect,
	SegmentQueryBox,
	TriangleInQueryBox,
	RayDetailedBoundsIntersect,
	SweptSphereBounds,
	OffsetDetailedBounds,
	NarrowphaseContact,
};
