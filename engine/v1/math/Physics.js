// Physics math helpers — acceleration, swept AABB, ray intersection, projection.

// Used by physics/ modules and handlers/game/Physics.js.
// Uses math/Vector3.js for vector operations.

import { EPSILON } from "../core/meta.js";
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
} from "./Vector3.js";
import { Clamp01 } from "./Utilities.js";

function NoContact() {
	return { hit: false, normal: { x: 0, y: 1, z: 0 }, depth: 0, point: null };
}

function makeContact(normal, depth, point = null) {
	return {
		hit: depth >= 0,
		normal: normal,
		depth: Math.max(0, depth),
		point,
	};
}

function InvertContact(contact) {
	if (!contact.hit) return contact;
	return {
		hit: true,
		normal: ScaleVector3(contact.normal, -1),
		depth: contact.depth,
		point: contact.point,
	};
}

function resolveUnitDirection(vector) {
	const lengthSq = Vector3Sq(vector);
	if (lengthSq <= EPSILON) return null;
	return ScaleVector3(vector, 1 / Math.sqrt(lengthSq));
}

function resolveInsideAabbContact(center, radius, aabb) {
	const distances = [
		{ depth: (center.x - aabb.min.x) + radius, normal: { x: -1, y: 0, z: 0 } },
		{ depth: (aabb.max.x - center.x) + radius, normal: { x: 1, y: 0, z: 0 } },
		{ depth: (center.y - aabb.min.y) + radius, normal: { x: 0, y: -1, z: 0 } },
		{ depth: (aabb.max.y - center.y) + radius, normal: { x: 0, y: 1, z: 0 } },
		{ depth: (center.z - aabb.min.z) + radius, normal: { x: 0, y: 0, z: -1 } },
		{ depth: (aabb.max.z - center.z) + radius, normal: { x: 0, y: 0, z: 1 } },
	];

	let best = distances[0];
	for (let index = 1; index < distances.length; index++) {
		if (distances[index].depth < best.depth) best = distances[index];
	}

	return makeContact(best.normal, best.depth, CloneVector3(center));
}

function resolveInsideObbContact(localPoint, radius, obb) {
	const distances = [
		{ depth: (localPoint.x + obb.halfExtents.x) + radius, normal: ScaleVector3(obb.axes[0], -1) },
		{ depth: (obb.halfExtents.x - localPoint.x) + radius, normal: CloneVector3(obb.axes[0]) },
		{ depth: (localPoint.y + obb.halfExtents.y) + radius, normal: ScaleVector3(obb.axes[1], -1) },
		{ depth: (obb.halfExtents.y - localPoint.y) + radius, normal: CloneVector3(obb.axes[1]) },
		{ depth: (localPoint.z + obb.halfExtents.z) + radius, normal: ScaleVector3(obb.axes[2], -1) },
		{ depth: (obb.halfExtents.z - localPoint.z) + radius, normal: CloneVector3(obb.axes[2]) },
	];

	let best = distances[0];
	for (let index = 1; index < distances.length; index++) {
		if (distances[index].depth < best.depth) best = distances[index];
	}

	return makeContact(best.normal, best.depth, null);
}

function projectToObbLocal(point, obb) {
	const delta = SubtractVector3(point, obb.center);
	return {
		x: DotVector3(delta, obb.axes[0]),
		y: DotVector3(delta, obb.axes[1]),
		z: DotVector3(delta, obb.axes[2]),
	};
}

function projectDirectionToObbLocal(vector, obb) {
	return {
		x: DotVector3(vector, obb.axes[0]),
		y: DotVector3(vector, obb.axes[1]),
		z: DotVector3(vector, obb.axes[2]),
	};
}

function projectObbNormalToWorld(localNormal, obb) {
	return AddVector3(
		ScaleVector3(obb.axes[0], localNormal.x),
		AddVector3(
			ScaleVector3(obb.axes[1], localNormal.y),
			ScaleVector3(obb.axes[2], localNormal.z)
		)
	);
}

function projectAabbRadiusOntoAxis(halfExtents, axis) {
	const vector = MultiplyVector3(AbsoluteVector3(axis), halfExtents);
	return (vector.x + vector.y + vector.z);
}

function projectObbRadiusOntoAxis(obb, axis) {
	return (
		Math.abs(DotVector3(obb.axes[0], axis)) * obb.halfExtents.x +
		Math.abs(DotVector3(obb.axes[1], axis)) * obb.halfExtents.y +
		Math.abs(DotVector3(obb.axes[2], axis)) * obb.halfExtents.z
	);
}

function chooseAabbObbSatAxis(best, rawAxis, centerDelta, halfExtents, obb) {
	const axis = resolveUnitDirection(rawAxis);
	if (!axis) return best;

	const radiusA = projectAabbRadiusOntoAxis(halfExtents, axis);
	const radiusB = projectObbRadiusOntoAxis(obb, axis);
	const distance = Math.abs(DotVector3(centerDelta, axis));
	const overlap = (radiusA + radiusB) - distance;
	if (overlap < 0) return { separated: true };

	const normal = DotVector3(centerDelta, axis) >= 0 ? CloneVector3(axis) : ScaleVector3(axis, -1);

	if (!best || overlap < best.depth) return { separated: false, normal, depth: overlap };
	return best;
}

function closestPointOnSegment(point, segStart, segEnd) {
	const segment = SubtractVector3(segEnd, segStart);
	const segmentLengthSq = Vector3Sq(segment);
	if (segmentLengthSq <= EPSILON) return CloneVector3(segStart);

	const delta = SubtractVector3(point, segStart);
	const t = Clamp01(DotVector3(delta, segment) / segmentLengthSq);
	return AddVector3(segStart, ScaleVector3(segment, t));
}

function closestPointsOnSegments(p1, q1, p2, q2) {
	const d1 = SubtractVector3(q1, p1);
	const d2 = SubtractVector3(q2, p2);
	const r = SubtractVector3(p1, p2);
	const a = DotVector3(d1, d1);
	const e = DotVector3(d2, d2);
	const f = DotVector3(d2, r);

	let s = 0;
	let t = 0;

	if (a <= EPSILON && e <= EPSILON) {
		return {
			pointA: CloneVector3(p1),
			pointB: CloneVector3(p2),
			s: 0,
			t: 0,
			distanceSq: Vector3Sq(SubtractVector3(p1, p2)),
		};
	}

	if (a <= EPSILON) {
		t = Clamp01(f / e);
	} else {
		const c = DotVector3(d1, r);
		if (e <= EPSILON) {
			s = Clamp01(-c / a);
		} else {
			const b = DotVector3(d1, d2);
			const denom = a * e - b * b;
			if (Math.abs(denom) > EPSILON) {
				s = Clamp01((b * f - c * e) / denom);
			}
			t = (b * s + f) / e;
			if (t < 0) {
				t = 0;
				s = Clamp01(-c / a);
			} else if (t > 1) {
				t = 1;
				s = Clamp01((b - c) / a);
			}
		}
	}

	const pointA = AddVector3(p1, ScaleVector3(d1, s));
	const pointB = AddVector3(p2, ScaleVector3(d2, t));
	return {
		pointA,
		pointB,
		s,
		t,
		distanceSq: Vector3Sq(SubtractVector3(pointA, pointB)),
	};
}

function closestPointOnTriangle(point, a, b, c) {
	const ab = SubtractVector3(b, a);
	const ac = SubtractVector3(c, a);
	const ap = SubtractVector3(point, a);
	const d1 = DotVector3(ab, ap);
	const d2 = DotVector3(ac, ap);
	if (d1 <= 0 && d2 <= 0) return CloneVector3(a);

	const bp = SubtractVector3(point, b);
	const d3 = DotVector3(ab, bp);
	const d4 = DotVector3(ac, bp);
	if (d3 >= 0 && d4 <= d3) return CloneVector3(b);

	const vc = d1 * d4 - d3 * d2;
	if (vc <= 0 && d1 >= 0 && d3 <= 0) {
		const v = d1 / (d1 - d3);
		return AddVector3(a, ScaleVector3(ab, v));
	}

	const cp = SubtractVector3(point, c);
	const d5 = DotVector3(ab, cp);
	const d6 = DotVector3(ac, cp);
	if (d6 >= 0 && d5 <= d6) return CloneVector3(c);

	const vb = d5 * d2 - d1 * d6;
	if (vb <= 0 && d2 >= 0 && d6 <= 0) {
		const w = d2 / (d2 - d6);
		return AddVector3(a, ScaleVector3(ac, w));
	}

	const va = d3 * d6 - d5 * d4;
	if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
		const edge = SubtractVector3(c, b);
		const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
		return AddVector3(b, ScaleVector3(edge, w));
	}

	const denom = 1 / (va + vb + vc);
	const v = vb * denom;
	const w = vc * denom;
	return AddVector3(a, AddVector3(ScaleVector3(ab, v), ScaleVector3(ac, w)));
}

function triangleNormal(a, b, c) {
	const normal = resolveUnitDirection(CrossVector3(SubtractVector3(b, a), SubtractVector3(c, a)));
	if (normal) return normal;
	return { x: 0, y: 1, z: 0 };
}

function closestPointsSegmentTriangle(segStart, segEnd, a, b, c, triangleNormal) {
	const segment = SubtractVector3(segEnd, segStart);
	const candidates = [];
	const denom = DotVector3(triangleNormal, segment);

	if (Math.abs(denom) > EPSILON) {
		const t = DotVector3(triangleNormal, SubtractVector3(a, segStart)) / denom;
		if (t >= 0 && t <= 1) {
			const segmentPoint = AddVector3(segStart, ScaleVector3(segment, t));
			const trianglePoint = closestPointOnTriangle(segmentPoint, a, b, c);
			if (Vector3Sq(SubtractVector3(segmentPoint, trianglePoint)) <= EPSILON) {
				return {
					segmentPoint,
					trianglePoint,
					distanceSq: 0,
				};
			}
		}
	}

	const planeT = Math.abs(denom) > EPSILON
		? Clamp01(DotVector3(triangleNormal, SubtractVector3(a, segStart)) / denom)
		: 0.5;
	const planePoint = AddVector3(segStart, ScaleVector3(segment, planeT));
	candidates.push({
		segmentPoint: CloneVector3(segStart),
		trianglePoint: closestPointOnTriangle(segStart, a, b, c),
	});
	candidates.push({
		segmentPoint: CloneVector3(segEnd),
		trianglePoint: closestPointOnTriangle(segEnd, a, b, c),
	});
	candidates.push({
		segmentPoint: planePoint,
		trianglePoint: closestPointOnTriangle(planePoint, a, b, c),
	});

	const edges = [
		[a, b],
		[b, c],
		[c, a],
	];
	for (let index = 0; index < edges.length; index += 1) {
		const segmentPair = closestPointsOnSegments(segStart, segEnd, edges[index][0], edges[index][1]);
		candidates.push({
			segmentPoint: segmentPair.pointA,
			trianglePoint: segmentPair.pointB,
		});
	}

	let best = null;
	for (let index = 0; index < candidates.length; index += 1) {
		const delta = SubtractVector3(candidates[index].segmentPoint, candidates[index].trianglePoint);
		const distanceSq = Vector3Sq(delta);
		if (!best || distanceSq < best.distanceSq) {
			best = { ...candidates[index], distanceSq };
		}
	}

	return best;
}

function chooseDeepestContact(best, next) {
	if (!next.hit) return best;
	if (!best.hit || next.depth > best.depth) return next;
	return best;
}

function SphereSphereContact(centerA, radiusA, centerB, radiusB) {
	const resolvedRadiusA = radiusA.value;
	const resolvedRadiusB = radiusB.value;
	const delta = SubtractVector3(centerA, centerB);
	const distSq = Vector3Sq(delta);
	const radiusSum = resolvedRadiusA + resolvedRadiusB;
	if (distSq > radiusSum * radiusSum) return NoContact();

	if (distSq <= EPSILON) {
		return makeContact({ x: 0, y: 1, z: 0 }, radiusSum, CloneVector3(centerA));
	}

	const distance = Math.sqrt(distSq);
	const normal = ScaleVector3(delta, 1 / distance);
	return makeContact(normal, radiusSum - distance, SubtractVector3(centerA, ScaleVector3(normal, resolvedRadiusA)));
}

function SphereAABBContact(center, radius, aabb) {
	const resolvedRadius = radius.value;
	const closest = ClampVector3(center, aabb.min, aabb.max);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > resolvedRadius * resolvedRadius) return NoContact();
	if (distSq <= EPSILON) return resolveInsideAabbContact(center, resolvedRadius, aabb);

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), resolvedRadius - distance, closest);
}

function SphereOBBContact(center, radius, obb) {
	const resolvedRadius = radius.value;
	const localPoint = projectToObbLocal(center, obb);
	const clampedLocal = ClampVector3(localPoint, ScaleVector3(obb.halfExtents, -1), obb.halfExtents);
	const closest = AddVector3(
		obb.center,
		AddVector3(
			ScaleVector3(obb.axes[0], clampedLocal.x),
			AddVector3(
				ScaleVector3(obb.axes[1], clampedLocal.y),
				ScaleVector3(obb.axes[2], clampedLocal.z)
			)
		)
	);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > resolvedRadius * resolvedRadius) return NoContact();
	if (distSq <= EPSILON) return resolveInsideObbContact(localPoint, resolvedRadius, obb);

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), resolvedRadius - distance, closest);
}

function SphereCapsuleContact(center, radius, capsule) {
	const resolvedSphereRadius = radius.value;
	const resolvedCapsuleRadius = capsule.radius.value;
	const closest = closestPointOnSegment(center, capsule.segmentStart, capsule.segmentEnd);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	const radiusSum = resolvedSphereRadius + resolvedCapsuleRadius;
	if (distSq > radiusSum * radiusSum) return NoContact();
	if (distSq <= EPSILON) {
		const segmentMid = ScaleVector3(AddVector3(capsule.segmentStart, capsule.segmentEnd), 0.5);
		const normal = resolveUnitDirection(SubtractVector3(center, segmentMid)) || { x: 0, y: 1, z: 0 };
		return makeContact(normal, radiusSum, closest);
	}

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radiusSum - distance, closest);
}

function sphereTriangleContact(center, radius, triangle) {
	const resolvedRadius = radius.value;
	const closest = closestPointOnTriangle(center, triangle.a, triangle.b, triangle.c);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > resolvedRadius * resolvedRadius) return NoContact();
	if (distSq <= EPSILON) {
		const triangleNormal = triangle.normal;
		const oriented = DotVector3(triangleNormal, SubtractVector3(center, triangle.a)) >= 0
			? triangleNormal
			: ScaleVector3(triangleNormal, -1);
		return makeContact(oriented, resolvedRadius, closest);
	}

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), resolvedRadius - distance, closest);
}

function SphereTriangleSoupContact(center, radius, triangleSoup) {
	let best = NoContact();
	for (let index = 0; index < triangleSoup.triangles.length; index++) {
		best = chooseDeepestContact(best, sphereTriangleContact(center, radius, triangleSoup.triangles[index]));
	}
	return best;
}

function CapsuleCapsuleContact(capsuleA, capsuleB) {
	const resolvedRadiusA = capsuleA.radius.value;
	const resolvedRadiusB = capsuleB.radius.value;
	const closest = closestPointsOnSegments(
		capsuleA.segmentStart,
		capsuleA.segmentEnd,
		capsuleB.segmentStart,
		capsuleB.segmentEnd
	);
	const radiusSum = resolvedRadiusA + resolvedRadiusB;
	if (closest.distanceSq > radiusSum * radiusSum) return NoContact();
	if (closest.distanceSq <= EPSILON) {
		const midpointA = ScaleVector3(AddVector3(capsuleA.segmentStart, capsuleA.segmentEnd), 0.5);
		const midpointB = ScaleVector3(AddVector3(capsuleB.segmentStart, capsuleB.segmentEnd), 0.5);
		const normal = resolveUnitDirection(SubtractVector3(midpointA, midpointB)) || { x: 0, y: 1, z: 0 };
		return makeContact(normal, radiusSum, closest.pointB);
	}

	const distance = Math.sqrt(closest.distanceSq);
	return makeContact(ScaleVector3(SubtractVector3(closest.pointA, closest.pointB), 1 / distance), radiusSum - distance, closest.pointB);
}

function CapsuleAABBContact(capsule, aabb) {
	const center = ScaleVector3(AddVector3(aabb.min, aabb.max), 0.5);
	const axis = SubtractVector3(capsule.segmentEnd, capsule.segmentStart);
	const axisLengthSq = Vector3Sq(axis);
	const centerT = axisLengthSq <= EPSILON 
		? 0.5 
		: Clamp01(DotVector3(SubtractVector3(center, capsule.segmentStart), axis) / axisLengthSq);
	const samples = [
		CloneVector3(capsule.segmentStart),
		CloneVector3(capsule.segmentEnd),
		AddVector3(capsule.segmentStart, ScaleVector3(axis, 0.5)),
		AddVector3(capsule.segmentStart, ScaleVector3(axis, centerT)),
	];

	let best = NoContact();
	for (let index = 0; index < samples.length; index++) {
		best = chooseDeepestContact(best, SphereAABBContact(samples[index], capsule.radius, aabb));
	}
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
	for (let index = 0; index < samples.length; index += 1) {
		best = chooseDeepestContact(best, SphereOBBContact(samples[index], capsule.radius, obb));
	}
	return best;
}

function AabbObbContact(aabb, obb) {
	const halfExtentsA = ScaleVector3(SubtractVector3(aabb.max, aabb.min), 0.5);
	const centerDelta = SubtractVector3(ScaleVector3(AddVector3(aabb.min, aabb.max), 0.5), obb.center);
	const aabbAxes = [
		{ x: 1, y: 0, z: 0 },
		{ x: 0, y: 1, z: 0 },
		{ x: 0, y: 0, z: 1 },
	];

	let best = null;
	for (let index = 0; index < aabbAxes.length; index++) {
		best = chooseAabbObbSatAxis(best, aabbAxes[index], centerDelta, halfExtentsA, obb);
		if (best && best.separated) return NoContact();
	}

	for (let index = 0; index < obb.axes.length; index++) {
		best = chooseAabbObbSatAxis(best, obb.axes[index], centerDelta, halfExtentsA, obb);
		if (best && best.separated) return NoContact();
	}

	for (let aabbIndex = 0; aabbIndex < aabbAxes.length; aabbIndex++) {
		for (let obbIndex = 0; obbIndex < obb.axes.length; obbIndex++) {
			best = chooseAabbObbSatAxis(
				best,
				CrossVector3(aabbAxes[aabbIndex], obb.axes[obbIndex]),
				centerDelta,
				halfExtentsA,
				obb
			);
			if (best && best.separated) return NoContact();
		}
	}

	if (!best) return NoContact();
	return makeContact(best.normal, best.depth, null);
}

function capsuleTriangleContact(capsule, triangle) {
	const resolvedRadius = capsule.radius.value;
	const triangleNormal = triangle.normal;
	const closest = closestPointsSegmentTriangle(
		capsule.segmentStart,
		capsule.segmentEnd,
		triangle.a,
		triangle.b,
		triangle.c,
		triangleNormal
	);
	if (closest.distanceSq > resolvedRadius * resolvedRadius) return NoContact();
	if (closest.distanceSq <= EPSILON) {
		const segmentMid = ScaleVector3(AddVector3(capsule.segmentStart, capsule.segmentEnd), 0.5);
		const oriented = DotVector3(triangleNormal, SubtractVector3(segmentMid, closest.trianglePoint)) >= 0
			? triangleNormal
			: ScaleVector3(triangleNormal, -1);
		return makeContact(oriented, resolvedRadius, closest.trianglePoint);
	}

	const distance = Math.sqrt(closest.distanceSq);
	return makeContact(ScaleVector3(SubtractVector3(closest.segmentPoint, closest.trianglePoint), 1 / distance), resolvedRadius - distance, closest.trianglePoint);
}

function CapsuleTriangleSoupContact(capsule, triangleSoup) {
	let best = NoContact();
	for (let index = 0; index < triangleSoup.triangles.length; index++) {
		best = chooseDeepestContact(best, capsuleTriangleContact(capsule, triangleSoup.triangles[index]));
	}
	return best;
}

/* === ACCELERATION & VELOCITY === */

function ApplyAcceleration(velocity, direction, acceleration, dt) {
	const vel = velocity;
	const dir = direction;
	const accel = acceleration;
	const delta = dt;
	return AddVector3(vel, ScaleVector3(dir, accel * delta));
}

function ApplyDeceleration(velocity, deceleration, dt) {
	const speed = Vector3Length(velocity);
	if (speed <= 0.0001) return ToVector3(0);

	const newSpeed = Math.max(0, speed - deceleration * dt);
	if (newSpeed <= 0.0001) return ToVector3(0);
	return ScaleVector3(ResolveVector3Axis(velocity), newSpeed);
}

function ClampVelocity(velocity, maxSpeed) {
	const speed = Vector3Length(velocity);
	if (speed <= maxSpeed || speed <= 0.0001) return velocity;
	return ScaleVector3(ResolveVector3Axis(velocity), maxSpeed);
}

/* === PROJECTION & REFLECTION === */

function ProjectOntoPlane(vector, normal) {
	return SubtractVector3(vector, ScaleVector3(normal, DotVector3(vector, normal)));
}

function ReflectVector3(velocity, normal) {
	return SubtractVector3(velocity, ScaleVector3(normal, 2 * DotVector3(velocity, normal)));
}

/* === AABB OVERLAP === */

function AabbOverlap(aabbA, aabbB) {
	return (
		aabbA.min.x <= aabbB.max.x && aabbA.max.x >= aabbB.min.x &&
		aabbA.min.y <= aabbB.max.y && aabbA.max.y >= aabbB.min.y &&
		aabbA.min.z <= aabbB.max.z && aabbA.max.z >= aabbB.min.z
	);
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
	// Expand static AABB by moving entity half-extents (Minkowski sum).
	const expandedMin = SubtractVector3(staticAabb.min, halfExtents);
	const expandedMax = AddVector3(staticAabb.max, halfExtents);

	let tEntryMax = -Infinity;
	let tExitMin = Infinity;
	const entryNormal = ToVector3(0);
	const axes = ["x", "y", "z"];

	for (let i = 0; i < 3; i++) {
		const axis = axes[i];
		const p = position[axis];
		const v = velocity[axis];
		const bMin = expandedMin[axis];
		const bMax = expandedMax[axis];

		if (Math.abs(v) < EPSILON) {
			// Ray is parallel to slab — check if inside.
			if (p < bMin || p > bMax) return result; // No collision possible.
			continue;
		}

		let tNear = (bMin - p) / v;
		let tFar = (bMax - p) / v;
		let nearNormalValue = -1;

		if (tNear > tFar) {
			const temp = tNear;
			tNear = tFar;
			tFar = temp;
			nearNormalValue = 1;
		}

		if (tNear > tEntryMax) {
			tEntryMax = tNear;
			entryNormal.x = 0;
			entryNormal.y = 0;
			entryNormal.z = 0;
			entryNormal[axis] = nearNormalValue;
		}
		if (tFar < tExitMin) {
			tExitMin = tFar;
		}

		if (tEntryMax > tExitMin || tExitMin < 0) {
			return result;
		}
	}

	if (tEntryMax < 0 || tEntryMax > 1) {
		return result;
	}

	result.hit = true;
	result.tEntry = tEntryMax;
	result.tExit = tExitMin;
	result.normal = entryNormal;
	return result;
}

/* === RAY-AABB INTERSECTION === */
// Used by camera obstruction detection.
// Returns { hit, t, normal }.

function RayAABBIntersect(origin, direction, aabb) {
	const result = { hit: false, t: Infinity, normal: ToVector3(0) };
	const o = origin;
	const d = direction;
	const axes = ["x", "y", "z"];

	let tMin = -Infinity;
	let tMax = Infinity;
	const hitNormal = ToVector3(0);

	for (let i = 0; i < 3; i++) {
		const axis = axes[i];
		const invD = Math.abs(d[axis]) > 0.000001 ? 1 / d[axis] : (d[axis] >= 0 ? 1e12 : -1e12);
		let t1 = (aabb.min[axis] - o[axis]) * invD;
		let t2 = (aabb.max[axis] - o[axis]) * invD;
		let nearSign = -1;

		if (t1 > t2) {
			const temp = t1;
			t1 = t2;
			t2 = temp;
			nearSign = 1;
		}

		if (t1 > tMin) {
			tMin = t1;
			hitNormal.x = 0;
			hitNormal.y = 0;
			hitNormal.z = 0;
			hitNormal[axis] = nearSign;
		}
		if (t2 < tMax) {
			tMax = t2;
		}

		if (tMin > tMax) {
			return result;
		}
	}

	if (tMin < 0) {
		if (tMax < 0) {
			return result;
		}
		// Origin is inside the box.
		result.hit = true;
		result.t = tMax;
		result.normal = hitNormal;
		return result;
	}

	result.hit = true;
	result.t = tMin;
	result.normal = hitNormal;
	return result;
}

/* === SWEPT SPHERE-AABB === */
// Expand AABB by sphere radius, ray-march center.
// Returns { hit, tEntry, normal }.

function SweptSphereAABB(center, velocity, radius, aabb) {
	const expandedMin = SubtractVector3(aabb.min, ToVector3(radius));
	const expandedMax = AddVector3(aabb.max, ToVector3(radius));
	return RayAABBIntersect(center, velocity, { min: expandedMin, max: expandedMax });
}

function SweptSphereOBB(center, velocity, radius, obb) {
	const localCenter = projectToObbLocal(center, obb);
	const localVelocity = projectDirectionToObbLocal(velocity, obb);
	const localAabb = {
		min: {
			x: -obb.halfExtents.x,
			y: -obb.halfExtents.y,
			z: -obb.halfExtents.z,
		},
		max: {
			x: obb.halfExtents.x,
			y: obb.halfExtents.y,
			z: obb.halfExtents.z,
		},
	};
	const result = SweptSphereAABB(localCenter, localVelocity, radius, localAabb);
	if (!result.hit) return result;
	return {
		hit: true,
		t: result.t,
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
	SweptAABB,
	RayAABBIntersect,
	SweptSphereAABB,
	SweptSphereOBB,
	SphereSphereContact,
	SphereAABBContact,
	SphereOBBContact,
	SphereCapsuleContact,
	AabbObbContact,
	CapsuleAABBContact,
	CapsuleCapsuleContact,
	CapsuleOBBContact,
	SphereTriangleSoupContact,
	CapsuleTriangleSoupContact,
	InvertContact,
	NoContact,
};
