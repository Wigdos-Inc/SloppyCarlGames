// Assembly layer: engine-shaped per-force functions that call math/Forces.js and return complete results.

import { ComputeGravity, ComputeBuoyancy, ComputeResistance, ComputeDeceleration, ComputeSubmergence } from "../math/Forces.js";
import { ProjectOntoPlane, ScaleVector3, SubtractVector3, WORLD_NORMALS } from "../math/Vector3.js";

// Water level as a plain number for math/, or null when the level has no water.
const waterLevelOf = (waterLevel) => waterLevel === null ? null : waterLevel.value;

// Velocity after gravity, at the entity's share of it.
function GetGravity(entity, physics) {
	const pulled = ComputeGravity(entity.velocity, physics.deltaSeconds);
	return { x: pulled.x, y: entity.velocity.y + (pulled.y - entity.velocity.y) * entity.gravityScale, z: pulled.z };
}

function GetBuoyancy(entityState, physicsState) {
	const { waterLevel, submergence, deltaSeconds } = physicsState;
	return ComputeBuoyancy(entityState.transform.position, waterLevelOf(waterLevel), submergence, deltaSeconds);
}

const GetResistance = (entity, physics) => ComputeResistance(entity.velocity, physics.deltaSeconds, physics.submergence);

function GetSubmergence(entity, waterLevel) {
	const { min, max } = entity.fullAabb;
	if (entity.type === "player") {
		const d = SubtractVector3(max, min);
		return ComputeSubmergence(min.y, Math.max(d.x, d.y, d.z), waterLevelOf(waterLevel));
	}
	return ComputeSubmergence(min.y, max.y - min.y, waterLevelOf(waterLevel));
}

// Vertical speed with this step's vertical change slowed by the character's floatiness.
function GetFloatiness(entity, yBefore) {
	const { waterFloatiness, airFloatiness } = entity.character.meta;
	return yBefore + (entity.velocity.y - yBefore) / (entity.medium === "Water" ? waterFloatiness : airFloatiness);
}

// Static friction cancels the pull along the footing.
function GetStaticFriction(entity, physics, yBefore) {
	const pull = ProjectOntoPlane(ScaleVector3(WORLD_NORMALS.Up, entity.velocity.y - yBefore), entity.alignedUp);
	return SubtractVector3(entity.velocity, SubtractVector3(pull, ComputeDeceleration(pull, entity.staticFriction, physics.deltaSeconds)));
}

/* === EXPORTS === */

export { GetGravity, GetBuoyancy, GetResistance, GetSubmergence, GetFloatiness, GetStaticFriction };
