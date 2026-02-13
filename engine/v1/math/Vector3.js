// Advanced Math Stuff

/* === NORMALIZERS === */
// Convert incoming values into consistent vector objects.

function normalizeVector3(value, fallback) {
	const resolvedFallback = fallback || { x: 0, y: 0, z: 0 };
	if (!value) {
		return { ...resolvedFallback };
	}

	if (Array.isArray(value)) {
		return {
			x: Number(value[0] ?? resolvedFallback.x),
			y: Number(value[1] ?? resolvedFallback.y),
			z: Number(value[2] ?? resolvedFallback.z),
		};
	}

	if (typeof value === "object") {
		return {
			x: Number(value.x ?? resolvedFallback.x),
			y: Number(value.y ?? resolvedFallback.y),
			z: Number(value.z ?? resolvedFallback.z),
		};
	}

	return { ...resolvedFallback };
}

/* === EXPORTS === */
// Public math helpers.

export { normalizeVector3 };