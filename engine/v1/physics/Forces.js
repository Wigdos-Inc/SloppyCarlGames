// Assembly layer: engine-shaped per-force functions that call math/Forces.js and return complete results.

import { ComputeGravity, ComputeBuoyancy, ComputeResistance, ComputeSubmergence } from "../math/Forces.js";
import { ApplyDeceleration, ProjectOntoPlane } from "../math/Collision.js";
import { ScaleVector3, SubtractVector3, WORLD_NORMALS } from "../math/Vector3.js";

// Velocity after gravity, at the entity's share of it.
function GetGravity(entity, physics) {
	const pulled = ComputeGravity(entity.velocity, physics.deltaSeconds);
	return { x: pulled.x, y: entity.velocity.y + (pulled.y - entity.velocity.y) * entity.gravityScale, z: pulled.z };
}

function GetBuoyancy(entityState, physicsState) {
	return ComputeBuoyancy(
		entityState.transform.position,
		physicsState.waterLevel,
		physicsState.submergence,
		physicsState.deltaSeconds
	);
}

const GetResistance = (entity, physics) => ComputeResistance(entity.velocity, physics.deltaSeconds, physics.submergence);

function GetSubmergence(entity, waterLevel) {
	if (entity.type === "player") {
		const d = SubtractVector3(entity.collision.aabb.max, entity.collision.aabb.min);
		return ComputeSubmergence(entity.collision.aabb.min.y, Math.max(d.x, d.y, d.z), waterLevel);
	}
	return ComputeSubmergence(entity.collision.aabb.min.y, entity.collision.aabb.max.y -  entity.collision.aabb.min.y, waterLevel);
}

// Vertical speed with this step's vertical change slowed by the character's floatiness.
function GetFloatiness(entity, yBefore) {
	const { waterFloatiness, airFloatiness } = entity.character.meta;
	return yBefore + (entity.velocity.y - yBefore) / (entity.underwater ? waterFloatiness : airFloatiness);
}

// Static friction cancels the pull along the footing.
function GetStaticFriction(entity, physics, yBefore) {
	const pull = ProjectOntoPlane(ScaleVector3(WORLD_NORMALS.Up, entity.velocity.y - yBefore), entity.alignedUp);
	return SubtractVector3(entity.velocity, SubtractVector3(pull, ApplyDeceleration(pull, entity.staticFriction, physics.deltaSeconds)));
}

/* === EXPORTS === */

export { GetGravity, GetBuoyancy, GetResistance, GetSubmergence, GetFloatiness, GetStaticFriction };
