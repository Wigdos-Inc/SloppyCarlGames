// Converts radians to degrees
function RadiansToDegrees(radians) {
	return radians * (180 / Math.PI);
}

// Converts degrees to radians
function DegreesToRadians(degrees) {
	return degrees * (Math.PI / 180);
}

export { RadiansToDegrees, DegreesToRadians };
