// Physics math helpers — acceleration, swept AABB, ray intersection, projection.
// Solid queries on closed triangle meshes — point containment, triangle grids, triangle/plane splitting, mesh overlap.

// Used by physics/ modules and physics/Master.js.
// Uses math/Vector3.js for vector operations.

import { EPSILON } from "../core/meta.js";
import { CARVE_GRID_TRIANGLES_PER_CELL } from "../core/config.js";
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
	Vector3ToArray,
	DivideVector3,
} from "./Vector3.js";
import { Clamp01, BestMatchOf, Unit } from "./Utilities.js";

const NoContact = () => { return { hit: false, normal: CloneVector3(WORLD_NORMALS.Up), depth: 0, point: null } };

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

const ChooseDeepestContact = (best, next) => !next.hit ? best : !best.hit || next.depth > best.depth ? next : best;

function SphereSphereContact(centerA, radiusA, centerB, radiusB) {
	const delta = SubtractVector3(centerA, centerB);
	const distSq = Vector3Sq(delta);
	const radiusSum = radiusA.value + radiusB.value;

	if (distSq > radiusSum ** 2) return NoContact();
	if (distSq <= EPSILON) return makeContact(CloneVector3(WORLD_NORMALS.Up), radiusSum, CloneVector3(centerA));

	const distance = Math.sqrt(distSq);
	const normal = ScaleVector3(delta, 1 / distance);
	return makeContact(normal, radiusSum - distance, SubtractVector3(centerA, ScaleVector3(normal, radiusA.value)));
}

function SphereAABBContact(center, radius, aabb) {
	const closest = ClampVector3(center, aabb.min, aabb.max);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > radius.value * radius.value) return NoContact();
	if (distSq <= EPSILON) return resolveInsideBoxContact(SubtractVector3(center, AabbCenter(aabb)), radius.value, AabbHalfExtents(aabb), worldBoxFaces, CloneVector3(center));

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radius.value - distance, closest);
}

function SphereOBBContact(center, radius, obb) {
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
	if (distSq > radius.value * radius.value) return NoContact();
	if (distSq <= EPSILON) return resolveInsideBoxContact(localPoint, radius.value, obb.halfExtents, obbFaces(obb), null);

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radius.value - distance, closest);
}

function SphereCapsuleContact(center, radius, capsule) {
	const closest = closestPointOnSegment(center, capsule.segmentStart, capsule.segmentEnd);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	const radiusSum = radius.value + capsule.radius.value;
	if (distSq > radiusSum ** 2) return NoContact();
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
	if (distSq > radius.value * radius.value) return NoContact();
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

// Note: Inlined to prevent over-allocation per triangle.
function TriangleInQueryBox (t, box) {
	const min = MinVector3(t.a, MinVector3(t.b, t.c)), max = MaxVector3(t.a, MaxVector3(t.b, t.c));
	return CompareVector3(max, box.min, "greater-loose") && CompareVector3(min, box.max, "lesser-loose");
}

// Deepest contact among the triangles inside the query box.
function deepestContactInBox(triangles, box, contactWith) {

	let best = NoContact();
	for (const triangle of triangles) {
		if (!TriangleInQueryBox(triangle, box)) continue;
		best = ChooseDeepestContact(best, contactWith(triangle));
	}
	return best;
}

const SphereTriangleSoupContact = (center, radius, soup) => deepestContactInBox(soup.triangles, sphereQueryBox(center, radius), (triangle) => sphereTriangleContact(center, radius, triangle));

function CapsuleCapsuleContact(capsuleA, capsuleB) {
	const closest = closestPointsOnSegments(
		capsuleA.segmentStart,
		capsuleA.segmentEnd,
		capsuleB.segmentStart,
		capsuleB.segmentEnd
	);
	const radiusSum = capsuleA.radius.value + capsuleB.radius.value;
	if (closest.distanceSq > radiusSum * radiusSum) return NoContact();
	if (closest.distanceSq <= EPSILON) {
		const midpointA = ScaleVector3(AddVector3(capsuleA.segmentStart, capsuleA.segmentEnd), 0.5);
		const midpointB = ScaleVector3(AddVector3(capsuleB.segmentStart, capsuleB.segmentEnd), 0.5);
		const normal = resolveUnitDirection(SubtractVector3(midpointA, midpointB)) || CloneVector3(WORLD_NORMALS.Up);
		return makeContact(normal, radiusSum, closest.pointB);
	}

	const distance = Math.sqrt(closest.distanceSq);
	return makeContact(ScaleVector3(SubtractVector3(closest.pointA, closest.pointB), 1 / distance), radiusSum - distance, closest.pointB);
}

function CapsuleAABBContact(capsule, aabb) {
	const axis = SubtractVector3(capsule.segmentEnd, capsule.segmentStart);
	const axisLengthSq = Vector3Sq(axis);
	const centerT = axisLengthSq <= EPSILON ? 0.5 : Clamp01(
		DotVector3(SubtractVector3(AabbCenter(aabb), capsule.segmentStart), axis) / axisLengthSq
	);
	const samples = [
		CloneVector3(capsule.segmentStart),
		CloneVector3(capsule.segmentEnd),
		AddVector3(capsule.segmentStart, ScaleVector3(axis, 0.5)),
		AddVector3(capsule.segmentStart, ScaleVector3(axis, centerT)),
	];

	let best = NoContact();
	samples.forEach(sample => best = ChooseDeepestContact(best, SphereAABBContact(sample, capsule.radius, aabb)));
	return best;
}

function CapsuleOBBContact(capsule, obb) {
	const axis = SubtractVector3(capsule.segmentEnd, capsule.segmentStart);
	const axisLengthSq = Vector3Sq(axis);
	const centerT = axisLengthSq <= EPSILON ? 0.5 : Clamp01(DotVector3(SubtractVector3(obb.center, capsule.segmentStart), axis) / axisLengthSq);
	const samples = [
		CloneVector3(capsule.segmentStart),
		CloneVector3(capsule.segmentEnd),
		AddVector3(capsule.segmentStart, ScaleVector3(axis, 0.5)),
		AddVector3(capsule.segmentStart, ScaleVector3(axis, centerT)),
	];

	let best = NoContact();
	samples.forEach(sample => best = ChooseDeepestContact(best, SphereOBBContact(sample, capsule.radius, obb)));
	return best;
}

function AabbObbContact(aabb, obb) {
	const halfExtentsA = AabbHalfExtents(aabb);
	const centerDelta = SubtractVector3(AabbCenter(aabb), obb.center);

	let best = null;
	for (const axes of [worldBoxAxes, obb.axes]) for (const axis of axes) {
		best = chooseAabbObbSatAxis(best, axis, centerDelta, halfExtentsA, obb);
		if (best && best.separated) return NoContact();
	}

	for (const aabbAxis of worldBoxAxes) for (const obbAxis of obb.axes) {
		best = chooseAabbObbSatAxis(best, CrossVector3(aabbAxis, obbAxis), centerDelta, halfExtentsA, obb);
		if (best && best.separated) return NoContact();
	}

	if (!best) return NoContact();
	return makeContact(best.normal, best.depth, null);
}

function AabbAabbContact(aabbA, aabbB) {
	if (!AabbOverlap(aabbA, aabbB)) return NoContact();
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
	if (closest.distanceSq > capsule.radius.value * capsule.radius.value) return NoContact();
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

const CapsuleTriangleSoupContact = (capsule, soup) => deepestContactInBox(soup.triangles, capsuleQueryBox(capsule), (triangle) => capsuleTriangleContact(capsule, triangle));

// One-sided: only the cavity-facing approach blocks, and the authored normal is never flipped.
function sphereVoidWallTriangleContact(center, radius, triangle) {
	const closest = ClosestPointOnTriangle(center, triangle.a, triangle.b, triangle.c);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > radius.value * radius.value) return NoContact();
	if (distSq <= EPSILON) return makeContact(triangle.normal, radius.value, closest);
	if (DotVector3(triangle.normal, delta) < 0) return NoContact();

	// Contact normal is triangle-point-to-shape, not the face plane.
	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radius.value - distance, closest);
}

const SphereVoidWallContact = (center, radius, voidWall) => deepestContactInBox(voidWall.triangles, sphereQueryBox(center, radius), (triangle) => sphereVoidWallTriangleContact(center, radius, triangle));

// One-sided capsule-vs-triangle: same one-sided gate as the sphere variant.
function capsuleVoidWallTriangleContact(capsule, triangle) {
	const closest = closestPointsSegmentTriangle(
		capsule.segmentStart, capsule.segmentEnd,
		triangle.a, triangle.b, triangle.c,
		triangle.normal
	);
	if (closest.distanceSq > capsule.radius.value * capsule.radius.value) return NoContact();
	if (closest.distanceSq <= EPSILON) return makeContact(triangle.normal, capsule.radius.value, closest.trianglePoint);
	if (DotVector3(triangle.normal, SubtractVector3(closest.segmentPoint, closest.trianglePoint)) < 0) return NoContact();

	// Contact normal is triangle-point-to-shape, not the face plane.
	const distance = Math.sqrt(closest.distanceSq);
	return makeContact(ScaleVector3(SubtractVector3(closest.segmentPoint, closest.trianglePoint), 1 / distance), capsule.radius.value - distance, closest.trianglePoint);
}

const CapsuleVoidWallContact = (capsule, voidWall) => deepestContactInBox(voidWall.triangles, capsuleQueryBox(capsule), (triangle) => capsuleVoidWallTriangleContact(capsule, triangle));

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
	if (cluster.length === 0) return NoContact();

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
		let triMin = Infinity;
		let triMax = -Infinity;
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
		if (overlap <= 0) return NoContact();
		if (!best || overlap < best.depth) {
			best = { unit: axis, depth: overlap, centerProject, hullCenter: (triMin + triMax) * 0.5 };
		}
	}

	const normal = best.centerProject - best.hullCenter >= 0 ? best.unit : ScaleVector3(best.unit, -1);

	const facesNormal = (triangle, best) => DotVector3(triangle.normal, normal) > DotVector3(best.normal, normal);
	const contactTriangle = BestMatchOf(cluster, facesNormal, cluster[0]);
	// One-sided: reject a normal no front face backs.
	if (oneSided && DotVector3(contactTriangle.normal, normal) <= 0) return NoContact();

	return makeContact(normal, best.depth, ClosestPointOnTriangle(center, contactTriangle.a, contactTriangle.b, contactTriangle.c));
}

const AabbTriangleSoupContact = (aabb, triangleSoup) => aabbTriangleSetContact(aabb, triangleSoup, false);
const AabbVoidWallContact     = (aabb, voidWall)     => aabbTriangleSetContact(aabb, voidWall, true);

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
const ReflectVector3   = (v, n) => SubtractVector3(v, ScaleVector3(n, 2 * DotVector3(v, n)));

/* === AABB OVERLAP === */

function AabbOverlap(aabbA, aabbB, strict = false) {
	return strict 
		? CompareVector3(aabbA.min, aabbB.max, "lesser")       && CompareVector3(aabbA.max, aabbB.min, "greater")
		: CompareVector3(aabbA.min, aabbB.max, "lesser-loose") && CompareVector3(aabbA.max, aabbB.min, "greater-loose");
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
	if (!CompareVector3(MaxVector3(triangle.a, MaxVector3(triangle.b, triangle.c)), point, "greater-loose")) return false;
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
		if (tx <= ty && tx <= tz) { if (++x === nx) break; }
		else if (ty <= tz)        { if (++y === ny) break; }
		else if (++z === nz) break;
	}

	return (crossings & 1) === 1;
}

function fanTriangulate(polygon, normal, output) {
	for (let index = 2; index < polygon.length; index++) {
		output.push({ a: polygon[0], b: polygon[index - 1], c: polygon[index], normal });
	}
}

// Plane is (normal, offset) with offset = dot(normal, pointOnPlane). Yields 1-3 triangles.
function SplitTriangleByPlane(triangle, planeNormal, planeOffset) {
	const vertices  = [triangle.a, triangle.b, triangle.c];
	const distances = vertices.map((vertex) => DotVector3(planeNormal, vertex) - planeOffset);

	let frontCount = 0, backCount = 0;
	for (const distance of distances) {
		if (distance >  planeCrossEpsilon) frontCount++;
		if (distance < -planeCrossEpsilon) backCount++;
	}
	if (frontCount === 0 || backCount === 0) return [triangle];

	const frontPolygon = [], backPolygon = [];
	for (let index = 0; index < 3; index++) {
		const next  = (index + 1) % 3;
		const here  = distances[index];
		const there = distances[next];

		if (here >= -planeCrossEpsilon) frontPolygon.push(vertices[index]);
		if (here <=  planeCrossEpsilon) backPolygon.push(vertices[index]);
		if ((here > planeCrossEpsilon && there < -planeCrossEpsilon) || (here < -planeCrossEpsilon && there > planeCrossEpsilon)) {
			const crossing = AddVector3(vertices[index], ScaleVector3(SubtractVector3(vertices[next], vertices[index]), here / (here - there)));
			frontPolygon.push(crossing);
			backPolygon.push(crossing);
		}
	}

	const pieces = [];
	fanTriangulate(frontPolygon, triangle.normal, pieces);
	fanTriangulate(backPolygon, triangle.normal, pieces);
	return pieces;
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

/* === SWEPT AABB === */
// Continuous collision detection for moving AABB against static AABB.
// Returns { hit, tEntry, tExit, normal }.

function SweptAABB(position, velocity, halfExtents, staticAabb) {
	const result = { 
		hit: false, 
		tEntry: 1, 
		tExit: 1, 
		normal: ToVector3(0) 
	};

	let tEntryMax = -Infinity, tExitMin = Infinity, entryNormal = ToVector3(0);

	for (let i = 0; i < 3; i++) {
		const axis = ["x", "y", "z"][i];
		const p = position[axis], v = velocity[axis];
		const bMin = SubtractVector3(staticAabb.min, halfExtents)[axis];
		const bMax = AddVector3(staticAabb.max, halfExtents)[axis];

		if (Math.abs(v) < EPSILON) {
			// Ray is parallel to slab — no collision possible unless already inside.
			if (p < bMin || p > bMax) return result;
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
			entryNormal = ToVector3(0);
			entryNormal[axis] = nearNormalValue;
		}
		if (tFar < tExitMin) tExitMin = tFar;

		if (tEntryMax > tExitMin || tExitMin < 0) return result;
	}

	if (tEntryMax < 0 || tEntryMax > 1) return result;

	result.hit = true;
	result.tEntry = tEntryMax;
	result.tExit = tExitMin;
	result.normal = entryNormal;
	return result;
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
	const a = segmentLengthSq - (segmentDotDirection * segmentDotDirection);
	const b = (segmentLengthSq * DotVector3(direction, originOffset)) - (segmentDotOrigin * segmentDotDirection);
	const c = (segmentLengthSq * originLengthSq) - (segmentDotOrigin * segmentDotOrigin) - (capsule.radius.value * capsule.radius.value * segmentLengthSq);

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
	let best = noRayHit();
	triangleSoup.triangles.forEach(triangle => best = chooseClosestRayHit(
		best, RayTriangleIntersect(origin, direction, triangle, Math.min(best.t, maxDistance))
	));
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

const SweptSphereAABB = (c, v, r, aabb) => RayAABBIntersect(c, v, { min: SubtractVector3(aabb.min, ToVector3(r)), max: AddVector3(aabb.max, ToVector3(r)) });

function SweptSphereOBB(center, velocity, radius, obb) {
	const result = SweptSphereAABB(
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

/* === EXPORTS === */

export {
	ApplyAcceleration,
	ApplyDeceleration,
	ClampVelocity,
	ProjectOntoPlane,
	ReflectVector3,
	AabbOverlap,
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
	TriangleDistanceSq,
	PointInsideMesh,
	BuildTriangleGrid,
	TriangleGridCandidates,
	PointInsideTriangleGrid,
	SplitTriangleByPlane,
	MeshesIntersect,
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
	SweptSphereAABB,
	SweptSphereOBB,
	SphereSphereContact,
	SphereAABBContact,
	SphereOBBContact,
	SphereCapsuleContact,
	AabbObbContact,
	AabbAabbContact,
	CapsuleAABBContact,
	CapsuleCapsuleContact,
	CapsuleOBBContact,
	SphereTriangleSoupContact,
	CapsuleTriangleSoupContact,
	SphereVoidWallContact,
	CapsuleVoidWallContact,
	AabbTriangleSoupContact,
	AabbVoidWallContact,
	NoContact,
	ChooseDeepestContact,
};
