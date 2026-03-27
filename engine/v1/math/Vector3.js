// Advanced Math Stuff

import { EPSILON } from "../core/meta.js";
import { ToNumber } from "./Utilities.js";

/* === NORMALIZERS === */
// Convert incoming values into consistent vector objects.

function NormalizeVector3(value, fallback) {
	const resolvedFallback = fallback || { x: 0, y: 0, z: 0 };
	if (!value) {
		return { ...resolvedFallback };
	}

	if (Array.isArray(value)) {
		return {
			x: ToNumber(value[0], resolvedFallback.x),
			y: ToNumber(value[1], resolvedFallback.y),
			z: ToNumber(value[2], resolvedFallback.z),
		};
	}

	if (typeof value === "object") {
		return {
			x: ToNumber(value.x, resolvedFallback.x),
			y: ToNumber(value.y, resolvedFallback.y),
			z: ToNumber(value.z, resolvedFallback.z),
		};
	}

	return { ...resolvedFallback };
}

function AddVector3(a, b) {
	const left = NormalizeVector3(a);
	const right = NormalizeVector3(b);
	return {
		x: left.x + right.x,
		y: left.y + right.y,
		z: left.z + right.z,
	};
}

function SubtractVector3(a, b) {
	const left = NormalizeVector3(a);
	const right = NormalizeVector3(b);
	return {
		x: left.x - right.x,
		y: left.y - right.y,
		z: left.z - right.z,
	};
}

function ScaleVector3(vector, scalar) {
	const resolved = NormalizeVector3(vector);
	const factor = ToNumber(scalar, 1);
	return {
		x: resolved.x * factor,
		y: resolved.y * factor,
		z: resolved.z * factor,
	};
}

function DotVector3(a, b) {
	const left = NormalizeVector3(a);
	const right = NormalizeVector3(b);
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function CrossVector3(a, b) {
	const left = NormalizeVector3(a);
	const right = NormalizeVector3(b);
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function CloneVector3(vector) {
	return { x: vector.x, y: vector.y, z: vector.z };
}

function Vector3LengthSq(vector) {
	const resolved = NormalizeVector3(vector);
	return (resolved.x * resolved.x) + (resolved.y * resolved.y) + (resolved.z * resolved.z);
}

function Vector3Length(vector) {
	const resolved = NormalizeVector3(vector);
	return Math.hypot(resolved.x, resolved.y, resolved.z);
}

function DistanceVector3(a, b) {
	return Vector3Length(SubtractVector3(a, b));
}

function NormalizeUnitVector3(vector) {
	const resolved = NormalizeVector3(vector);
	const length = Vector3Length(resolved);
	if (length <= EPSILON) {
		return { x: 0, y: 0, z: 0 };
	}
	return {
		x: resolved.x / length,
		y: resolved.y / length,
		z: resolved.z / length,
	};
}

function LerpVector3(start, end, t) {
	const from = NormalizeVector3(start);
	const to = NormalizeVector3(end);
	const alpha = Math.max(0, Math.min(1, ToNumber(t, 0)));
	return {
		x: from.x + (to.x - from.x) * alpha,
		y: from.y + (to.y - from.y) * alpha,
		z: from.z + (to.z - from.z) * alpha,
	};
}

function MultiplyVector3(a, b) {
	const left = NormalizeVector3(a, { x: 1, y: 1, z: 1 });
	const right = NormalizeVector3(b, { x: 1, y: 1, z: 1 });
	return { x: left.x * right.x, y: left.y * right.y, z: left.z * right.z };
}

/**
 * Rotate a point by Euler angles in Y → X → Z order (matches CreateModelMatrix).
 * All rotation values must be in radians.
 */
function RotateByEuler(point, rotation) {
	const p0 = NormalizeVector3(point);
	const r = NormalizeVector3(rotation);

	// Y rotation
	const cy = Math.cos(r.y);
	const sy = Math.sin(r.y);
	const p1 = { x: p0.x * cy + p0.z * sy, y: p0.y, z: -p0.x * sy + p0.z * cy };

	// X rotation
	const cx = Math.cos(r.x);
	const sx = Math.sin(r.x);
	const p2 = { x: p1.x, y: p1.y * cx - p1.z * sx, z: p1.y * sx + p1.z * cx };

	// Z rotation
	const cz = Math.cos(r.z);
	const sz = Math.sin(r.z);
	return { x: p2.x * cz - p2.y * sz, y: p2.x * sz + p2.y * cz, z: p2.z };
}

/* === EXPORTS === */
// Public math helpers.

export {
	NormalizeVector3,
	AddVector3,
	SubtractVector3,
	ScaleVector3,
	MultiplyVector3,
	DotVector3,
	CrossVector3,
	CloneVector3,
	Vector3LengthSq,
	Vector3Length,
	DistanceVector3,
	NormalizeUnitVector3,
	LerpVector3,
	RotateByEuler,
};