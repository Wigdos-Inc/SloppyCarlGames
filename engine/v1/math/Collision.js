// Collision math: contacts between shapes, overlap and inside tests, rays and sweeps.

// Used by physics/Collision.js to detect contacts and test voids.
// Used by physics/Master.js to wake a resting entity when a mover touches it.
// Used by camera/Master.js to raycast for camera blockers.
// Used by handlers/Render.js to cull boxes outside the view.
// Used by handlers/game/Collectible.js to detect pickups.
// Used by builder/subProcesses/Chunks.js to join touching surfaces into chunks.
// Used by builder/NewVoid.js to cut voids out of host meshes and grid their linings.
// Used by builder/NewObject.js to grid triangle-soup collision.
// Uses math/Vector3.js for vector operations.
// Uses math/Geometry.js for box measures, triangle boxes and closest points.

import { EPSILON } from "../core/meta.js";
import {
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	DotVector3,
	CrossVector3,
	CloneVector3,
	Vector3Sq,
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
	DivideVector3,
} from "./Vector3.js";
import { AabbCenter, AabbHalfExtents, ClosestPointOnSegment, ClosestPointOnTriangle, TriangleAabb, TriangleArea } from "./Geometry.js";
import { Clamp01, BestMatchOf } from "./Utilities.js";

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

function closestPointsOnSegments(p1, q1, p2, q2) {
	const d1 = SubtractVector3(q1, p1), d2 = SubtractVector3(q2, p2), r = SubtractVector3(p1, p2);
	const a  = Vector3Sq(d1), e = Vector3Sq(d2), f = DotVector3(d2, r);
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
			const denom = a * e - b**2;
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

	const pointA     = AddVector3(p1, ScaleVector3(d1, s));
	const pointB     = AddVector3(p2, ScaleVector3(d2, t));
	const distanceSq = Vector3Sq(SubtractVector3(pointA, pointB));
	return { pointA, pointB, s, t, distanceSq };
}

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
	const delta  = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	if (distSq > radius.value**2) return noContact();
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
	if (distSq > radius.value**2) return noContact();
	if (distSq <= EPSILON) return resolveInsideBoxContact(localPoint, radius.value, obb.halfExtents, obbFaces(obb), null);

	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radius.value - distance, closest);
}

function sphereCapsuleContact(center, radius, capsule) {
	const closest = ClosestPointOnSegment(center, capsule.segmentStart, capsule.segmentEnd);
	const delta = SubtractVector3(center, closest);
	const distSq = Vector3Sq(delta);
	const radiusSum = radius.value + capsule.radius.value;
	if (distSq > radiusSum**2) return noContact();
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
	if (distSq > radius.value**2) return noContact();
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

// Box around a shape's path (grown by it's radius). 
// Note: Triangles outside it can't be touched.
function SegmentQueryBox(start, end, radius) {
	return {
		min: SubtractVector3(MinVector3(start, end), ToVector3(radius)),
		max: AddVector3(MaxVector3(start, end), ToVector3(radius)),
	};
}

const sphereQueryBox  = (center, radius) => SegmentQueryBox(center, center, radius.value);
const capsuleQueryBox = (capsule) => SegmentQueryBox(capsule.segmentStart, capsule.segmentEnd, capsule.radius.value);

// Check whether a triangle's box touches the query box.
function TriangleInQueryBox(triangle, box) {
	const { a, b, c } = triangle;
	return (
		CompareVector3(MaxVector3(a, b, c), box.min, "greater-loose") &&
		CompareVector3(MinVector3(a, b, c), box.max, "lesser-loose")
	);
}

// Deepest contact among the soup's triangles inside the query box.
function deepestInBox(soup, box, contactWith) {
	let best = noContact();
	for (const index of TriangleGridCandidates(soup.grid, box)) {
		const triangle = soup.triangles[index];
		if (!TriangleInQueryBox(triangle, box)) continue;
		best = chooseDeepestContact(best, contactWith(triangle));
	}
	return best;
}

function sphereTriangleSoupContact(center, radius, soup) {
	return deepestInBox(soup, sphereQueryBox(center, radius), (triangle) => sphereTriangleContact(center, radius, triangle));
}

function capsuleCapsuleContact(capsuleA, capsuleB) {
	const closest   = closestPointsOnSegments(capsuleA.segmentStart, capsuleA.segmentEnd, capsuleB.segmentStart, capsuleB.segmentEnd);
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
	const axis         = SubtractVector3(capsule.segmentEnd, capsule.segmentStart);
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
	const centerDelta  = SubtractVector3(AabbCenter(aabb), obb.center);

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
	const axis         = MinAxisVector3(MinVector3(pushNegative, pushPositive)), key = "xyz"[axis];
	const negative     = pushNegative[key] <= pushPositive[key];
	return makeContact(CloneVector3(worldBoxFaces[axis][negative ? 0 : 1]), negative ? pushNegative[key] : pushPositive[key], null);
}

function capsuleTriangleContact(capsule, triangle) {
	const { segmentStart, segmentEnd, radius } = capsule;
	const { distanceSq, trianglePoint, segmentPoint } = closestPointsSegmentTriangle(
		segmentStart, segmentEnd, triangle.a, triangle.b, triangle.c, triangle.normal
	);

	if (distanceSq > radius.value**2) return noContact();
	if (distanceSq <= EPSILON) {
		const segmentMid = ScaleVector3(AddVector3(segmentStart, segmentEnd), 0.5);
		const oriented   = DotVector3(triangle.normal, SubtractVector3(segmentMid, trianglePoint)) >= 0
			? triangle.normal
			: ScaleVector3(triangle.normal, -1);
		return makeContact(oriented, radius.value, trianglePoint);
	}

	const distance = Math.sqrt(distanceSq);
	return makeContact(
		ScaleVector3(SubtractVector3(segmentPoint, trianglePoint), 1 / distance), 
		radius.value - distance, 
		trianglePoint
	);
}

const capsuleTriangleSoupContact = (capsule, soup) => deepestInBox(soup, capsuleQueryBox(capsule), (triangle) => capsuleTriangleContact(capsule, triangle));

// One-sided: only the cavity-facing approach blocks, and the authored normal is never flipped.
function sphereVoidWallTriangleContact(center, radius, triangle) {
	const closest = ClosestPointOnTriangle(center, triangle.a, triangle.b, triangle.c);
	const delta   = SubtractVector3(center, closest);
	const distSq  = Vector3Sq(delta);
	if (distSq > radius.value**2) return noContact();
	if (distSq <= EPSILON) return makeContact(triangle.normal, radius.value, closest);
	if (DotVector3(triangle.normal, delta) < 0) return noContact();

	// Contact normal is triangle-point-to-shape, not the face plane.
	const distance = Math.sqrt(distSq);
	return makeContact(ScaleVector3(delta, 1 / distance), radius.value - distance, closest);
}

function sphereVoidWallContact(center, radius, voidWall) {
	return deepestInBox(
		voidWall,
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

function capsuleVoidWallContact(capsule, voidWall) {
	return deepestInBox(voidWall, capsuleQueryBox(capsule), (triangle) => capsuleVoidWallTriangleContact(capsule, triangle));
}

const axisDuplicateDot = 0.9999;

// SAT of the box against the overlapping triangles taken as one hull — smallest overlap wins.
function aabbTriangleSetContact(aabb, soup, oneSided) {
	const center = AabbCenter(aabb);

	const cluster = [];
	for (const index of TriangleGridCandidates(soup.grid, aabb)) {
		const triangle = soup.triangles[index];
		if (!TriangleInQueryBox(triangle, aabb)) continue;

		// One-sided: only front faces that see the center participate.
		if (oneSided && DotVector3(triangle.normal, SubtractVector3(center, triangle.a)) < 0) continue;
		cluster.push(triangle);
	}
	if (cluster.length === 0) return noContact();

	const axes = [...worldBoxAxes];
	for (const triangle of cluster) {
		let duplicate = false;
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

/* === AABB OVERLAP === */

function AabbOverlap(aabbA, aabbB, strict = false) {
	return strict 
		? CompareVector3(aabbA.min, aabbB.max, "lesser")       && CompareVector3(aabbA.max, aabbB.min, "greater")
		: CompareVector3(aabbA.min, aabbB.max, "lesser-loose") && CompareVector3(aabbA.max, aabbB.min, "greater-loose");
}

// Check whether the box, grown by padding on every side, is fully behind one of the view's walls.
function AabbOutsideFrustum(planes, aabb, padding = 0) {
	const { min, max } = aabb;
	for (const [x, y, z, offset] of planes) {
		// Note: Pick the corner furthest toward the wall's inside on each axis separately. One choice for all three picks the wrong corner.
		const reach =
			x * (x >= 0 ? max.x + padding : min.x - padding) +
			y * (y >= 0 ? max.y + padding : min.y - padding) +
			z * (z >= 0 ? max.z + padding : min.z - padding);
		if (reach + offset < 0) return true;
	}
	return false;
}

/* === SOLID QUERIES === */
// Build-time inside/outside checks for closed meshes of any shape.

// Note: Tilted ray direction for inside/outside tests. Straight rays can run along box edges and miscount.
const parityRayDirection = ResolveVector3Axis({ x: 0.4371383, y: 0.7218935, z: 0.5364271 });
const planeCrossEpsilon  = 0.000001;

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

// Check whether the fixed tilted ray from the point crosses the triangle.
function insideRayCrosses(point, triangle) {
	// Skip triangles wholly below the point on any axis; the ray only heads toward +x, +y and +z.
	const { a, b, c } = triangle;
	if (!(Math.max(a.x, b.x, c.x) >= point.x && Math.max(a.y, b.y, c.y) >= point.y && Math.max(a.z, b.z, c.z) >= point.z)) return false;
	return RayTriangleIntersect(point, parityRayDirection, triangle).hit;
}

// Padding (share of a cell) that stops rounding from dropping a triangle out of a cell.
const gridCellPadding = 0.01;

// Grid cell along one axis that holds a coordinate, kept inside the grid.
const gridAxisCell = (value, start, cellSize, count) => Math.min(count - 1, Math.max(0, Math.floor((value - start) / cellSize)));

// Split a mesh's bounds into equal cubes, each listing the triangles whose bounds touch it.
function BuildTriangleGrid(triangles, triangleAabbs) {
	let min = ToVector3(Infinity), max = ToVector3(-Infinity);
	let area = 0;

	for (let i = 0; i < triangles.length; i++) {
		const triangle = triangles[i];
		min = MinVector3(min, triangleAabbs[i].min);
		max = MaxVector3(max, triangleAabbs[i].max);
		area += TriangleArea(triangle.a, triangle.b, triangle.c);
	}

	// Size cells to hold about two triangles each.
	const cellSize = Math.sqrt(2 * area / triangles.length);
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

	// Answer with every triangle when that's cheaper than visiting each cell.
	if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > grid.triangles.length) return grid.allIndices;

	// Use a single cell's list as is.
	if (x0 === x1 && y0 === y1 && z0 === z1) {
		const cell = grid.cells.get(x0 + nx * (y0 + ny * z0));
		return cell === undefined ? [] : cell;
	}

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

// Grid collision triangles to let queries test only nearby ones.
const SoupBounds = (type, triangles) => ({ type, triangles, grid: BuildTriangleGrid(triangles, triangles.map(TriangleAabb)) });

// Check whether a point is inside the closed mesh formed by the grid's triangles.
function PointInsideGrid(point, grid) {
	const { min, cellSize, pad, nx, ny, nz } = grid;
	const n = { x: nx, y: ny, z: nz }, ray = parityRayDirection;

	// Where the ray enters and leaves the padded grid box.
	const maxV = DivideVector3(SubtractVector3(SubtractVector3(min, ToVector3(pad)), point), ray);
	const minV = DivideVector3(SubtractVector3(AddVector3(AddVector3(min, ScaleVector3(n, cellSize)), ToVector3(pad)), point), ray);
	const tEnter = Math.max(0, maxV.x, maxV.y, maxV.z), tLeave = Math.min(minV.x, minV.y, minV.z);
	if (tEnter > tLeave) return false;
	
	const v = {
		x: gridAxisCell(point.x + ray.x * tEnter, min.x, cellSize, nx),
		y: gridAxisCell(point.y + ray.y * tEnter, min.y, cellSize, ny),
		z: gridAxisCell(point.z + ray.z * tEnter, min.z, cellSize, nz)
	}

	const stamp = ++grid.stamp;
	let crossings = 0;

	while (true) {
		const cell = grid.cells.get(v.x + n.x * (v.y + n.y * v.z));
		if (cell !== undefined) {
			for (const index of cell) {
				if (grid.stamps[index] === stamp) continue;
				grid.stamps[index] = stamp;
				if (insideRayCrosses(point, grid.triangles[index])) crossings++;
			}
		}

		// Step into whichever next cell the ray reaches first; stop once it leaves the grid.
		const t = DivideVector3(SubtractVector3(AddVector3(min, ScaleVector3(AddVector3(v, ToVector3(1)), cellSize)), point), ray);
		if (t.x <= t.y && t.x <= t.z) { 
			if (++v.x === nx) break; 
		}
		else if (t.y <= t.z) { 
			if (++v.y === n.y) break; 
		}
		else if (++v.z === n.z) break;
	}

	return (crossings & 1) === 1;
}

// Test each edge only against the target triangles in the grid cells the edge's box touches.
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
	for (const solid of [solidA, solidB]) for (const triangle of solid.triangles) if (PointInsideGrid(triangle.a, solid.grid)) return true;
	return edgesCrossMesh(solidA.triangles, solidB.grid) ? true : edgesCrossMesh(solidB.triangles, solidA.grid);
}

/* === SWEPT AABB === */
// Sweep a moving box against a still one, returning { hit, tEntry, tExit, normal }.

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
			tNear      = tFar;
			tFar       = temp;
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
	return !candidate.hit ? best : !best.hit || candidate.t > best.t ? candidate : best;
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
			t1         = t2;
			t2         = temp;
			nearSign   = 1;
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
		result.hit    = true;
		result.t      = tMax;
		result.normal = hitNormal;
		result.inside = true;
		return result;
	}

	result.hit    = true;
	result.t      = tMin;
	result.normal = hitNormal;
	return result;
}

function raySphereIntersect(origin, direction, sphere, maxDistance = Infinity) {
	const offset = SubtractVector3(origin, sphere.center);
	const b      = DotVector3(offset, direction);
	const c      = DotVector3(offset, offset) - (sphere.radius.value**2);
	if (c > 0 && b > 0) return noRayHit();

	const discriminant = (b**2) - c;
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

function rayOBBIntersect(origin, direction, obb, maxDistance = Infinity) {
	const result = limitRayHit(RayAABBIntersect(
		projectToObbLocal(origin, obb, true), 
		projectToObbLocal(direction, obb), 
		{ min: ScaleVector3(obb.halfExtents, -1), max: CloneVector3(obb.halfExtents) }
	), maxDistance);
	if (!result.hit) return result;
	return {
		hit   : true,
		t     : result.t,
		inside: result.inside,
		normal: projectObbNormalToWorld(result.normal, obb),
	};
}

function rayCapsuleIntersect(origin, direction, capsule, maxDistance = Infinity) {
	const segment         = SubtractVector3(capsule.segmentEnd, capsule.segmentStart);
	const segmentLengthSq = Vector3Sq(segment);
	if (segmentLengthSq <= EPSILON) {
		return raySphereIntersect(origin, direction, { center: capsule.segmentStart, radius: capsule.radius }, maxDistance);
	}

	const originOffset        = SubtractVector3(origin, capsule.segmentStart);
	const segmentDotDirection = DotVector3(segment, direction);
	const segmentDotOrigin    = DotVector3(segment, originOffset);
	const originLengthSq      = Vector3Sq(originOffset);
	const a = segmentLengthSq  - (segmentDotDirection**2);
	const b = (segmentLengthSq * DotVector3(direction, originOffset)) - (segmentDotOrigin * segmentDotDirection);
	const c = (segmentLengthSq * originLengthSq) - (segmentDotOrigin**2) - (capsule.radius.value**2 * segmentLengthSq);

	let best = noRayHit();

	if (Math.abs(a) > EPSILON) {
		const discriminant = (b**2) - (a * c);
		if (discriminant >= 0) {
			const root  = Math.sqrt(discriminant);
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
		best = chooseClosestRayHit(best, raySphereIntersect(origin, direction, {
			center: capsule[t], radius: capsule.radius,
		}, maxDistance));
	});

	return best;
}

function RayTriangleIntersect(origin, direction, triangle, maxDistance = Infinity) {
	const edgeAB      = SubtractVector3(triangle.b, triangle.a);
	const edgeAC      = SubtractVector3(triangle.c, triangle.a);
	const p           = CrossVector3(direction, edgeAC);
	const determinant = DotVector3(edgeAB, p);
	if (Math.abs(determinant) <= EPSILON) return noRayHit();

	const invDet = 1 / determinant;
	const tvec   = SubtractVector3(origin, triangle.a);
	const u      = DotVector3(tvec, p) * invDet;
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

function rayTriangleSoupIntersect(origin, direction, triangleSoup, maxDistance = Infinity) {
	// A ray with a length only reaches triangles inside its own box.
	const reach   = maxDistance === Infinity ? null : SegmentQueryBox(origin, AddVector3(origin, ScaleVector3(direction, maxDistance)), 0);
	let best      = noRayHit();
	for (const index of reach === null ? triangleSoup.grid.allIndices : TriangleGridCandidates(triangleSoup.grid, reach)) {
		const triangle = triangleSoup.triangles[index];
		if (reach !== null && !TriangleInQueryBox(triangle, reach)) continue;
		best = chooseClosestRayHit(best, RayTriangleIntersect(origin, direction, triangle, Math.min(best.t, maxDistance)));
	}
	return best;
}

function rayCompoundSphereIntersect(origin, direction, compound, maxDistance = Infinity) {
	let best = noRayHit();
	compound.spheres.forEach(sphere => best = chooseClosestRayHit(
		best, raySphereIntersect(origin, direction, sphere, Math.min(best.t, maxDistance))
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
	aabb             : (bounds, origin, direction, maxDistance) => limitRayHit(RayAABBIntersect(origin, direction, bounds), maxDistance),
	obb              : (bounds, origin, direction, maxDistance) => rayOBBIntersect(origin, direction, bounds, maxDistance),
	sphere           : (bounds, origin, direction, maxDistance) => raySphereIntersect(origin, direction, bounds, maxDistance),
	capsule          : (bounds, origin, direction, maxDistance) => rayCapsuleIntersect(origin, direction, bounds, maxDistance),
	"triangle-soup"  : (bounds, origin, direction, maxDistance) => rayTriangleSoupIntersect(origin, direction, bounds, maxDistance),
	"voidWall"       : (bounds, origin, direction, maxDistance) => rayTriangleSoupIntersect(origin, direction, bounds, maxDistance),
	"compound-sphere": (bounds, origin, direction, maxDistance) => rayCompoundSphereIntersect(origin, direction, bounds, maxDistance),
};

function RayDetailedBoundsIntersect(bounds, origin, direction, maxDistance = Infinity) {
	return bounds === null ? noRayHit() : rayDetailedBoundsIntersectors[bounds.type](bounds, origin, direction, maxDistance);
}

/* === SWEPT SPHERE-AABB === */
// Sweep a sphere against a box by growing the box by its radius, returning { hit, tEntry, normal }.

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
	AabbOverlap,
	AabbOutsideFrustum,
	TriangleDistanceSq,
	BuildTriangleGrid,
	TriangleGridCandidates,
	SoupBounds,
	PointInsideGrid,
	MeshesIntersect,
	SweptAABB,
	RayAABBIntersect,
	RayAABBDetailedBoundsIntersect,
	RayTriangleIntersect,
	SegmentQueryBox,
	TriangleInQueryBox,
	RayDetailedBoundsIntersect,
	SweptSphereBounds,
	NarrowphaseContact,
};
