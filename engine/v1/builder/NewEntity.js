// Creates Models for anything that should support being animated.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

import { BuildObject } from "./NewObject.js";
import { normalizeVector3 } from "../math/Vector3.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeMovement(movement) {
	const source = movement && typeof movement === "object" ? movement : {};
	return {
		start: normalizeVector3(source.start, { x: 0, y: 0, z: 0 }),
		end: normalizeVector3(source.end, { x: 0, y: 0, z: 0 }),
		repeat: source.repeat !== false,
		backAndForth: source.backAndForth !== false,
		speed: Math.max(0, toNumber(source.speed, 0)),
		jump: Math.max(0, toNumber(source.jump, 0)),
		jumpInterval: Math.max(0, toNumber(source.jumpInterval, 0)),
		jumpOnSight: source.jumpOnSight === true,
		disappear: source.disappear === true,
		chase: source.chase === true,
		physics: source.physics === true,
	};
}

function createDefaultMesh(entityDefinition) {
	return BuildObject(
		{
			id: `${entityDefinition.id || "entity"}-mesh`,
			shape: entityDefinition.shape || "cube",
			size: entityDefinition.size || { x: 1, y: 1, z: 1 },
			position: entityDefinition.position || { x: 0, y: 0, z: 0 },
			color: entityDefinition.color || { r: 0.9, g: 0.35, b: 0.35, a: 1 },
			role: "entity",
		},
		{ role: "entity" }
	);
}

function BuildEntity(definition) {
	const source = definition && typeof definition === "object" ? definition : {};
	const movement = normalizeMovement(source.movement);
	const startPosition = normalizeVector3(source.position || movement.start, { x: 0, y: 0, z: 0 });

	const mesh = source.mesh && typeof source.mesh === "object"
		? BuildObject({ ...source.mesh, role: "entity" }, { role: "entity" })
		: createDefaultMesh(source);

	mesh.transform.position = {
		x: startPosition.x,
		y: startPosition.y,
		z: startPosition.z,
	};

	return {
		id: source.id || `entity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		type: source.type || "entity",
		hp: Math.max(0, toNumber(source.hp, 1)),
		platform: source.platform || null,
		movement: movement,
		transform: {
			position: { ...startPosition },
			rotation: normalizeVector3(source.rotation, { x: 0, y: 0, z: 0 }),
			scale: normalizeVector3(source.scale, { x: 1, y: 1, z: 1 }),
		},
		velocity: normalizeVector3(source.velocity, { x: 0, y: 0, z: 0 }),
		mesh: mesh,
		state: {
			movementProgress: 0,
			direction: 1,
			lastJumpMs: 0,
		},
	};
}

export { BuildEntity };