// Resolves per-instance performance flags once per tick.

// Used by Level.js to prepare distance-gating.
// Consumers read instance.performance.* directly; they never recompute distance themselves.

import { PERFORMANCE_SCALING } from "../../core/config.js";
import { GetSimDistanceValue, IsBeyondSimDistance } from "../../physics/Collision.js";
import { Vector3SqDistanceToAabb } from "../../math/Vector3.js";

// Updates each instance's physics and rendering flags by distance from the camera.
function UpdatePerformanceFlags(sceneGraph) {
	const { cameraConfig, terrain, obstacles, entities } = sceneGraph;
	const renderReachSq  = (GetSimDistanceValue().value * PERFORMANCE_SCALING.SimDistance.Fractions.WorldInstances.Cull) ** 2;

	// Point-to-AABB — bounds, not center.
	const withinRender = (aabb) => Vector3SqDistanceToAabb(cameraConfig.state.position, aabb) <= renderReachSq;

	terrain.forEach((mesh) => mesh.performance.rendering = withinRender(mesh.worldAabb));
	obstacles.forEach((obstacle) => obstacle.performance.rendering = withinRender(obstacle.worldAabb));

	entities.forEach((entity) => {
		entity.performance.physics   = !IsBeyondSimDistance(cameraConfig.state.position, entity.transform.position);
		entity.performance.rendering = withinRender(entity.collision.aabb);
	});
}

/* === EXPORTS === */

export { UpdatePerformanceFlags };
