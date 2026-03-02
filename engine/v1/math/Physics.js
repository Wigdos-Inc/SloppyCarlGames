// Physics math helpers — acceleration, swept AABB, ray intersection, projection.

// Used by physics/ modules and handlers/game/Physics.js.
// Uses math/Vector3.js for vector operations.

import {
	NormalizeVector3,
	AddVector3,
	SubtractVector3,
	scaleVector3,
	DotVector3,
	vector3Length,
	NormalizeUnitVector3,
} from "./Vector3.js";

/* === HELPERS === */

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/* === ACCELERATION & VELOCITY === */

function ApplyAcceleration(velocity, direction, acceleration, dt) {
	const vel = NormalizeVector3(velocity);
	const dir = NormalizeVector3(direction);
	const accel = toNumber(acceleration, 0);
	const delta = toNumber(dt, 0);
	return AddVector3(vel, scaleVector3(dir, accel * delta));
}

function ApplyDeceleration(velocity, deceleration, dt) {
	const vel = NormalizeVector3(velocity);
	const speed = vector3Length(vel);
	if (speed <= 0.0001) {
		return { x: 0, y: 0, z: 0 };
	}
	const reduction = toNumber(deceleration, 0) * toNumber(dt, 0);
	const newSpeed = Math.max(0, speed - reduction);
	if (newSpeed <= 0.0001) {
		return { x: 0, y: 0, z: 0 };
	}
	return scaleVector3(NormalizeUnitVector3(vel), newSpeed);
}

function ClampVelocity(velocity, maxSpeed) {
	const vel = NormalizeVector3(velocity);
	const speed = vector3Length(vel);
	const cap = toNumber(maxSpeed, Infinity);
	if (speed <= cap || speed <= 0.0001) {
		return vel;
	}
	return scaleVector3(NormalizeUnitVector3(vel), cap);
}

function ApplyImpulse(velocity, impulse) {
	return AddVector3(NormalizeVector3(velocity), NormalizeVector3(impulse));
}

/* === PROJECTION & REFLECTION === */

function ProjectOntoPlane(vector, normal) {
	const v = NormalizeVector3(vector);
	const n = NormalizeUnitVector3(NormalizeVector3(normal));
	const d = DotVector3(v, n);
	return SubtractVector3(v, scaleVector3(n, d));
}

function ReflectVector3(velocity, normal) {
	const v = NormalizeVector3(velocity);
	const n = NormalizeUnitVector3(NormalizeVector3(normal));
	const d = DotVector3(v, n);
	return SubtractVector3(v, scaleVector3(n, 2 * d));
}

/* === AABB OVERLAP === */

function AABBOverlap(aabbA, aabbB) {
	if (!aabbA || !aabbB || !aabbA.min || !aabbA.max || !aabbB.min || !aabbB.max) {
		return false;
	}
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
	const result = { hit: false, tEntry: 1, tExit: 1, normal: { x: 0, y: 0, z: 0 } };

	if (!staticAabb || !staticAabb.min || !staticAabb.max) {
		return result;
	}

	const pos = NormalizeVector3(position);
	const vel = NormalizeVector3(velocity);
	const half = NormalizeVector3(halfExtents, { x: 0.5, y: 0.5, z: 0.5 });

	// Expand static AABB by moving entity half-extents (Minkowski sum).
	const expandedMin = {
		x: staticAabb.min.x - half.x,
		y: staticAabb.min.y - half.y,
		z: staticAabb.min.z - half.z,
	};
	const expandedMax = {
		x: staticAabb.max.x + half.x,
		y: staticAabb.max.y + half.y,
		z: staticAabb.max.z + half.z,
	};

	let tEntryMax = -Infinity;
	let tExitMin = Infinity;
	const entryNormal = { x: 0, y: 0, z: 0 };
	const axes = ["x", "y", "z"];

	for (let i = 0; i < 3; i++) {
		const axis = axes[i];
		const p = pos[axis];
		const v = vel[axis];
		const bMin = expandedMin[axis];
		const bMax = expandedMax[axis];

		if (Math.abs(v) < 0.000001) {
			// Ray is parallel to slab — check if inside.
			if (p < bMin || p > bMax) {
				return result; // No collision possible.
			}
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
	const result = { hit: false, t: Infinity, normal: { x: 0, y: 0, z: 0 } };

	if (!aabb || !aabb.min || !aabb.max) {
		return result;
	}

	const o = NormalizeVector3(origin);
	const d = NormalizeVector3(direction);
	const axes = ["x", "y", "z"];

	let tMin = -Infinity;
	let tMax = Infinity;
	const hitNormal = { x: 0, y: 0, z: 0 };

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

/* === EXPORTS === */

export {
	ApplyAcceleration,
	ApplyDeceleration,
	ClampVelocity,
	ApplyImpulse,
	ProjectOntoPlane,
	ReflectVector3,
	AABBOverlap,
	SweptAABB,
	RayAABBIntersect,
};
