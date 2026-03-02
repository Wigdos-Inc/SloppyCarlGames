// Converts radians to degrees
function RadiansToDegrees(radians) {
	return radians * (180 / Math.PI);
}

// Converts degrees to radians
function DegreesToRadians(degrees) {
	return degrees * (Math.PI / 180);
}

function ToNumber(value, fallback) {
	const resolved = Number(value);
	return Number.isFinite(resolved) ? resolved : fallback;
}

// Clamp a number between min and max (inclusive)
function Clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

// Linear interpolation between two scalar values
function Lerp(a, b, t) {
	return a + (b - a) * Clamp(t, 0, 1);
}

// Hermite smoothstep interpolation between two scalar values
function SmoothStep(a, b, t) {
	const clamped = Clamp((t - a) / (b - a), 0, 1);
	return clamped * clamped * (3 - 2 * clamped);
}

export { RadiansToDegrees, DegreesToRadians, ToNumber, Clamp, Lerp, SmoothStep };
