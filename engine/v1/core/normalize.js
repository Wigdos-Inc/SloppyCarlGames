import { NormalizeVector3 } from "../math/Vector3.js";
import { ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";

function resolveWaterLevel(source, deathBarrierY, worldHeight) {
	if (!source || typeof source !== "object" || !Object.prototype.hasOwnProperty.call(source, "waterLevel")) {
		return -9999;
	}

	const level = ToNumber(source.waterLevel, -9999);
	if (level <= -9000) {
		return -9999;
	}

	if (level < deathBarrierY || level > worldHeight) {
		return -9999;
	}

	return level;
}

function NormalizeWorldConfig(world) {
	const source = world && typeof world === "object" ? world : {};
	const length = Math.max(1, ToNumber(source.length, 100));
	const width = Math.max(1, ToNumber(source.width, 100));
	const height = Math.max(1, ToNumber(source.height, 40));
	const deathBarrierY = ToNumber(source.deathBarrierY, -25);

	return {
		length: new Unit(length, "cnu"),
		width: new Unit(width, "cnu"),
		height: new Unit(height, "cnu"),
		deathBarrierY: new Unit(deathBarrierY, "cnu"),
		waterLevel: new Unit(resolveWaterLevel(source, deathBarrierY, height), "cnu"),
		textureScale: Math.max(0.05, ToNumber(source.textureScale, 1)),
		scatterScale: Math.max(0.05, ToNumber(source.scatterScale, 1)),
	};
}

function NormalizeCameraConfig(camera) {
	const source = camera && typeof camera === "object" ? camera : {};
	const openStart = NormalizeVector3(
		source.levelOpening && source.levelOpening.startPosition,
		{ x: 0, y: 40, z: 80 }
	);
	const openEnd = NormalizeVector3(
		source.levelOpening && source.levelOpening.endPosition,
		{ x: 0, y: 40, z: 80 }
	);

	return {
		mode: "stationary",
		levelOpening: {
			startPosition: new UnitVector3(openStart.x, openStart.y, openStart.z, "cnu"),
			endPosition: new UnitVector3(openEnd.x, openEnd.y, openEnd.z, "cnu"),
		},
		distance: new Unit(ToNumber(source.distance, 10), "cnu"),
		sensitivity: ToNumber(source.sensitivity, 0.12),
		heightOffset: new Unit(ToNumber(source.heightOffset, 3), "cnu"),
	};
}

function NormalizePlayerConfig(player) {
	const fallback = {
		character: "carl",
		spawnPosition: { x: 0, y: 0, z: 0 },
		scale: { x: 0, y: 0, z: 0 }
	}

	const source = player && typeof player === "object" ? player : fallback;
	const spawnPos = source.spawnPosition;

	return {
		character: source.character.toLowerCase() || "carl",
		spawnPosition: new UnitVector3(spawnPos.x, spawnPos.y, spawnPos.z, "cnu"),
		scale: NormalizeVector3(source.scale, { x: 1, y: 1, z: 1 })
	}
}

export { NormalizeWorldConfig, NormalizeCameraConfig, NormalizePlayerConfig };
