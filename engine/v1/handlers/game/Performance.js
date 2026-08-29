// Resolves per-instance performance flags once per tick.

// Used by Level.js to prepare distance-gating.
// Consumers read instance.performance.* directly; they never recompute distance themselves.

import { PERFORMANCE_SCALING } from "../../core/config.js";
import { GetSimDistanceValue, IsBeyondSimDistance } from "../../physics/Collision.js";
import { Vector3SqDistanceToAabb } from "../../math/Vector3.js";
import { Squared } from "../../math/Utilities.js";

/**
 * Writes `performance.physics` (entities) and `performance.rendering` (all world instances).
 * Builders attach the flag block, so every instance here carries it from construction.
 *
 * @param {object} sceneGraph — active scene graph.
 */
function UpdatePerformanceFlags(sceneGraph) {
	const cameraPosition = sceneGraph.cameraConfig.state.position;
	const renderReachSq  = Squared(GetSimDistanceValue().value * PERFORMANCE_SCALING.SimDistance.Fractions.WorldInstances.Cull);

	// Point-to-AABB — bounds, not centre.
	const withinRender = (aabb) => Vector3SqDistanceToAabb(cameraPosition, aabb) <= renderReachSq;

	sceneGraph.terrain.forEach((mesh) => mesh.performance.rendering = withinRender(mesh.worldAabb));
	sceneGraph.obstacles.forEach((obstacle) => obstacle.performance.rendering = withinRender(obstacle.worldAabb));

	sceneGraph.entities.forEach((entity) => {
		entity.performance.physics   = !IsBeyondSimDistance(cameraPosition, entity.transform.position);
		entity.performance.rendering = withinRender(entity.collision.aabb);
	});
}

/* === EXPORTS === */

export { UpdatePerformanceFlags };
