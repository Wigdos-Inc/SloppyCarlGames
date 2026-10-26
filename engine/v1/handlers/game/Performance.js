// Improves performance of runtime processes by preparing reusable data early in a frame.

// Used by Level.js.
// Consumers read the prepared data.

import { CONFIG, PERFORMANCE_SCALING } from "../../core/config.js";
import { BroadphaseCollectCandidates, GetEntityPhysicsFlags } from "../../physics/Collision.js";
import { UpdateEntityModelFromTransform } from "../../builder/NewEntity.js";
import { Vector3Distance, Vector3SqDistanceToAabb } from "../../math/Vector3.js";

// Update each instance's physics, rendering and texture animation flags by distance from the camera.
function UpdatePerformanceFlags(sceneGraph) {
	const { cameraConfig, terrain, obstacles, entities } = sceneGraph;
	const { Tiers, Fractions } = PERFORMANCE_SCALING.SimDistance;
	const simDistance = Tiers[CONFIG.Performance.SimDistance].value;

	const renderReachSq = (simDistance * Fractions.WorldInstances.Cull) ** 2;
	const bakeReachSq   = (simDistance * Fractions.TextureAnimation.StopBake) ** 2;

	// Measure to the nearest edge of the bounds, not the center.
	const withinRender = (aabb) => Vector3SqDistanceToAabb(cameraConfig.state.position, aabb) <= renderReachSq;

	terrain.forEach((mesh)       => mesh.performance.rendering     = withinRender(mesh.worldAabb));
	obstacles.forEach((obstacle) => obstacle.performance.rendering = withinRender(obstacle.worldAabb));

	entities.forEach((entity) => {
		const distanceSq = Vector3SqDistanceToAabb(cameraConfig.state.position, entity.collision.aabb);
		entity.performance.rendering       = distanceSq <= renderReachSq;
		entity.performance.animatedTexture = distanceSq <= bakeReachSq;

		// Simulate particles as far out as they're drawn.
		entity.performance.physics = entity.particle !== null
			? entity.performance.rendering
			: !(Vector3Distance(cameraConfig.state.position, entity.transform.position) > simDistance);
	});
}

// Gather collidables within an entity's SimRadius, or false when there's nothing in range.
function UpdateCollisionCandidates(entity, sceneGraph) {
	const isPlayer = entity.type === "player";
	if (
		!(isPlayer || entity.performance.physics) ||
		CONFIG.Physics.Collision.Enabled === false ||
		!GetEntityPhysicsFlags(entity).collision
	) {
		return entity.performance.collision = false;
	}

	// Ensure model and bounds data is up-to-date before collection.
	UpdateEntityModelFromTransform(entity);
	const candidates = BroadphaseCollectCandidates(sceneGraph, entity.collision.simRadiusAabb, isPlayer, entity.type !== "particle");
	entity.performance.collision = candidates.length > 0 ? candidates : false;
}

/* === REFRESH RATE === */
// Measure the display's refresh rate before each level build.

// Measure the rate by finding the shortest gap between frames. A gap must appear 4 more times before it's considered.
function fastestRepeatedRate(sorted) {
	for (let i = 0; i + 4 < sorted.length; i++) {
		const cluster = sorted.filter((gap) => gap >= sorted[i] && gap <= sorted[i] * 1.05);
		if (cluster.length < 5) continue;

		// Accept nothing under 30 fps as the refresh rate.
		const rate = Math.round(1000 / (cluster.reduce((sum, gap) => sum + gap, 0) / cluster.length));
		return rate >= 30 ? rate : null;
	}
	return null;
}

// Measure the refresh rate based on the gaps within 30 browser frames.
function MeasureRefreshRate() {
	return new Promise((resolve) => {
		const gaps = [];
		let lastTime = null;

		const tick = (now) => {
			if (lastTime !== null) gaps.push(now - lastTime);

			lastTime = now;
			if (gaps.length < 30) return requestAnimationFrame(tick);

			// Under 2ms means the browser is uncapped.
			const sorted = gaps.sort((a, b) => a - b);
			CONFIG.Performance.RefreshRate = sorted[4] < 2 ? Infinity : fastestRepeatedRate(sorted);
			resolve();
		};
		requestAnimationFrame(tick);
	});
}

/* === EXPORTS === */

export { UpdatePerformanceFlags, UpdateCollisionCandidates, MeasureRefreshRate };
