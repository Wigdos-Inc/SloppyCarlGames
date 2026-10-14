// Resolves per-instance performance flags once per tick.

// Used by Level.js to prepare distance-gating.
// Consumers read instance.performance.* directly; they never recompute distance themselves.

import { PERFORMANCE_SCALING } from "../../core/config.js";
import { GetSimDistanceValue, IsBeyondSimDistance } from "../../physics/Collision.js";
import { Vector3SqDistanceToAabb } from "../../math/Vector3.js";

// Updates each instance's physics, rendering and texture animation flags by distance from the camera.
function UpdatePerformanceFlags(sceneGraph) {
	const { cameraConfig, terrain, obstacles, entities } = sceneGraph;
	const { WorldInstances, TextureAnimation } = PERFORMANCE_SCALING.SimDistance.Fractions;
	const simDistance = GetSimDistanceValue().value;

	const renderReachSq = (simDistance * WorldInstances.Cull) ** 2;
	const bakeReachSq   = (simDistance * TextureAnimation.StopBake) ** 2;

	// Point-to-AABB — bounds, not center.
	const withinRender = (aabb) => Vector3SqDistanceToAabb(cameraConfig.state.position, aabb) <= renderReachSq;

	terrain.forEach((mesh) => mesh.performance.rendering = withinRender(mesh.worldAabb));
	obstacles.forEach((obstacle) => obstacle.performance.rendering = withinRender(obstacle.worldAabb));

	entities.forEach((entity) => {
		const distanceSq = Vector3SqDistanceToAabb(cameraConfig.state.position, entity.collision.aabb);
		entity.performance.rendering       = distanceSq <= renderReachSq;
		entity.performance.animatedTexture = distanceSq <= bakeReachSq;

		// Particles keep moving as far as they draw.
		entity.performance.physics = entity.particle !== null
			? entity.performance.rendering
			: !IsBeyondSimDistance(cameraConfig.state.position, entity.transform.position);
	});
}

/* === EXPORTS === */

export { UpdatePerformanceFlags };
