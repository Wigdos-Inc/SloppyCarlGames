// Advanced Math Stuff

/* === NORMALIZERS === */
// Convert incoming values into consistent vector objects.

function toNumber(value, fallback) {
	const resolved = Number(value);
	return Number.isFinite(resolved) ? resolved : fallback;
}

function normalizeVector3(value, fallback) {
	const resolvedFallback = fallback || { x: 0, y: 0, z: 0 };
	if (!value) {
		return { ...resolvedFallback };
	}

	if (Array.isArray(value)) {
		return {
			x: toNumber(value[0], resolvedFallback.x),
			y: toNumber(value[1], resolvedFallback.y),
			z: toNumber(value[2], resolvedFallback.z),
		};
	}

	if (typeof value === "object") {
		return {
			x: toNumber(value.x, resolvedFallback.x),
			y: toNumber(value.y, resolvedFallback.y),
			z: toNumber(value.z, resolvedFallback.z),
		};
	}

	return { ...resolvedFallback };
}

function addVector3(a, b) {
	const left = normalizeVector3(a);
	const right = normalizeVector3(b);
	return {
		x: left.x + right.x,
		y: left.y + right.y,
		z: left.z + right.z,
	};
}

function subtractVector3(a, b) {
	const left = normalizeVector3(a);
	const right = normalizeVector3(b);
	return {
		x: left.x - right.x,
		y: left.y - right.y,
		z: left.z - right.z,
	};
}

function scaleVector3(vector, scalar) {
	const resolved = normalizeVector3(vector);
	const factor = toNumber(scalar, 1);
	return {
		x: resolved.x * factor,
		y: resolved.y * factor,
		z: resolved.z * factor,
	};
}

function dotVector3(a, b) {
	const left = normalizeVector3(a);
	const right = normalizeVector3(b);
	return left.x * right.x + left.y * right.y + left.z * right.z;
}

function crossVector3(a, b) {
	const left = normalizeVector3(a);
	const right = normalizeVector3(b);
	return {
		x: left.y * right.z - left.z * right.y,
		y: left.z * right.x - left.x * right.z,
		z: left.x * right.y - left.y * right.x,
	};
}

function vector3Length(vector) {
	const resolved = normalizeVector3(vector);
	return Math.hypot(resolved.x, resolved.y, resolved.z);
}

function distanceVector3(a, b) {
	return vector3Length(subtractVector3(a, b));
}

function normalizeUnitVector3(vector) {
	const resolved = normalizeVector3(vector);
	const length = vector3Length(resolved);
	if (length <= 0.000001) {
		return { x: 0, y: 0, z: 0 };
	}
	return {
		x: resolved.x / length,
		y: resolved.y / length,
		z: resolved.z / length,
	};
}

function lerpVector3(start, end, t) {
	const from = normalizeVector3(start);
	const to = normalizeVector3(end);
	const alpha = Math.max(0, Math.min(1, toNumber(t, 0)));
	return {
		x: from.x + (to.x - from.x) * alpha,
		y: from.y + (to.y - from.y) * alpha,
		z: from.z + (to.z - from.z) * alpha,
	};
}

/* === EXPORTS === */
// Public math helpers.

export {
	normalizeVector3,
	addVector3,
	subtractVector3,
	scaleVector3,
	dotVector3,
	crossVector3,
	vector3Length,
	distanceVector3,
	normalizeUnitVector3,
	lerpVector3,
};