// Normalize raw JSON payload values into Unit/UnitVector3 instances.
// Called by validate.js after structural validation passes.

import { Unit, UnitVector3, ToNumber } from "../math/Utilities.js";

function toNum(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeVector3(source, fallback, type) {
	const fb = fallback || { x: 0, y: 0, z: 0 };
	if (!source || typeof source !== "object") {
		return new UnitVector3(fb.x, fb.y, fb.z, type);
	}
	return new UnitVector3(
		toNum(source.x, fb.x),
		toNum(source.y, fb.y),
		toNum(source.z, fb.z),
		type
	);
}

function normalizeScalar(value, fallback, type) {
	return new Unit(toNum(value, fallback), type);
}

function normalizeScale3(source, fallback) {
	const fb = fallback || { x: 1, y: 1, z: 1 };
	if (!source || typeof source !== "object") {
		return { x: fb.x, y: fb.y, z: fb.z };
	}
	return {
		x: toNum(source.x, fb.x),
		y: toNum(source.y, fb.y),
		z: toNum(source.z, fb.z),
	};
}

function normalizePartTransforms(part) {
	if (!part || typeof part !== "object") return;
	part.localPosition = normalizeVector3(part.localPosition, { x: 0, y: 0, z: 0 }, "cnu");
	part.localRotation = normalizeVector3(part.localRotation, { x: 0, y: 0, z: 0 }, "degrees");
	part.localScale = normalizeScale3(part.localScale, { x: 1, y: 1, z: 1 });
	if (part.dimensions && typeof part.dimensions === "object") {
		part.dimensions = normalizeVector3(part.dimensions, { x: 1, y: 1, z: 1 }, "cnu");
	}
}

function normalizeModelParts(model) {
	if (!model || typeof model !== "object") return;
	if (Array.isArray(model.parts)) {
		model.parts.forEach(normalizePartTransforms);
	}
	if (model.rootTransform && typeof model.rootTransform === "object") {
		const rt = model.rootTransform;
		rt.position = normalizeVector3(rt.position, { x: 0, y: 0, z: 0 }, "cnu");
		rt.rotation = normalizeVector3(rt.rotation, { x: 0, y: 0, z: 0 }, "degrees");
		rt.scale = normalizeScale3(rt.scale, { x: 1, y: 1, z: 1 });
	}
}

function normalizeEntityBlueprint(blueprint) {
	if (!blueprint || typeof blueprint !== "object") return;
	if (blueprint.velocity && typeof blueprint.velocity === "object") {
		blueprint.velocity = normalizeVector3(blueprint.velocity, { x: 0, y: 0, z: 0 }, "cnu");
	}
	normalizeModelParts(blueprint.model);
}

function normalizeEntityDefinition(entity) {
	if (!entity || typeof entity !== "object") return;
	if (entity.transform && typeof entity.transform === "object") {
		entity.transform.position = normalizeVector3(entity.transform.position, { x: 0, y: 0, z: 0 }, "cnu");
		entity.transform.rotation = normalizeVector3(entity.transform.rotation, { x: 0, y: 0, z: 0 }, "degrees");
		entity.transform.scale = normalizeScale3(entity.transform.scale, { x: 1, y: 1, z: 1 });
	}
	if (entity.velocity && typeof entity.velocity === "object") {
		entity.velocity = normalizeVector3(entity.velocity, { x: 0, y: 0, z: 0 }, "cnu");
	}
	normalizeModelParts(entity.model);
	if (entity.rootTransform && typeof entity.rootTransform === "object") {
		const rt = entity.rootTransform;
		rt.position = normalizeVector3(rt.position, { x: 0, y: 0, z: 0 }, "cnu");
		rt.rotation = normalizeVector3(rt.rotation, { x: 0, y: 0, z: 0 }, "degrees");
		rt.scale = normalizeScale3(rt.scale, { x: 1, y: 1, z: 1 });
	}
}

function normalizeObstacleDefinition(obstacle) {
	if (!obstacle || typeof obstacle !== "object") return;
	obstacle.position = normalizeVector3(obstacle.position, { x: 0, y: 0, z: 0 }, "cnu");
	obstacle.rotation = normalizeVector3(obstacle.rotation, { x: 0, y: 0, z: 0 }, "degrees");
	obstacle.scale = normalizeScale3(obstacle.scale, { x: 1, y: 1, z: 1 });
	if (obstacle.dimensions && typeof obstacle.dimensions === "object") {
		obstacle.dimensions = normalizeVector3(obstacle.dimensions, { x: 1, y: 1, z: 1 }, "cnu");
	}
	if (Array.isArray(obstacle.parts)) {
		obstacle.parts.forEach((part) => {
			if (!part || typeof part !== "object") return;
			part.localPosition = normalizeVector3(part.localPosition, { x: 0, y: 0, z: 0 }, "cnu");
			part.localRotation = normalizeVector3(part.localRotation, { x: 0, y: 0, z: 0 }, "degrees");
			part.localScale = normalizeScale3(part.localScale, { x: 1, y: 1, z: 1 });
			if (part.dimensions && typeof part.dimensions === "object") {
				part.dimensions = normalizeVector3(part.dimensions, { x: 1, y: 1, z: 1 }, "cnu");
			}
		});
	}
}

function NormalizeLevelPayload(payload) {
	if (!payload || typeof payload !== "object") return payload;

	// World scalars.
	if (payload.world && typeof payload.world === "object") {
		const w = payload.world;
		w.length = normalizeScalar(w.length, 100, "cnu");
		w.width = normalizeScalar(w.width, 100, "cnu");
		w.height = normalizeScalar(w.height, 40, "cnu");
		w.deathBarrierY = normalizeScalar(w.deathBarrierY, -25, "cnu");
		if (w.waterLevel !== undefined) {
			w.waterLevel = normalizeScalar(w.waterLevel, -9999, "cnu");
		}
	}

	// Camera config.
	if (payload.camera && typeof payload.camera === "object") {
		const cam = payload.camera;
		if (cam.distance !== undefined) cam.distance = normalizeScalar(cam.distance, 10, "cnu");
		if (cam.heightOffset !== undefined) cam.heightOffset = normalizeScalar(cam.heightOffset, 3, "cnu");
		if (cam.levelOpening && typeof cam.levelOpening === "object") {
			cam.levelOpening.startPosition = normalizeVector3(
				cam.levelOpening.startPosition, { x: 0, y: 40, z: 80 }, "cnu"
			);
			cam.levelOpening.endPosition = normalizeVector3(
				cam.levelOpening.endPosition, { x: 0, y: 40, z: 80 }, "cnu"
			);
		}
	}

	// Obstacles.
	if (Array.isArray(payload.obstacles)) {
		payload.obstacles.forEach(normalizeObstacleDefinition);
	}

	// Entities.
	if (Array.isArray(payload.entities)) {
		payload.entities.forEach(normalizeEntityDefinition);
	}

	// Entity blueprints.
	if (payload.entityBlueprints && typeof payload.entityBlueprints === "object") {
		const bp = payload.entityBlueprints;
		const normList = (list) => {
			if (!Array.isArray(list)) return;
			list.forEach(normalizeEntityBlueprint);
		};
		normList(bp.enemies);
		normList(bp.npcs);
		normList(bp.collectibles);
		normList(bp.projectiles);
		normList(bp.entities);
	}

	// Terrain objects (positions/dimensions/rotations).
	if (payload.terrain && typeof payload.terrain === "object") {
		if (Array.isArray(payload.terrain.objects)) {
			payload.terrain.objects.forEach((obj) => {
				if (!obj || typeof obj !== "object") return;
				obj.position = normalizeVector3(obj.position, { x: 0, y: 0, z: 0 }, "cnu");
				if (obj.dimensions && typeof obj.dimensions === "object") {
					obj.dimensions = normalizeVector3(obj.dimensions, { x: 1, y: 1, z: 1 }, "cnu");
				}
				if (obj.rotation && typeof obj.rotation === "object") {
					obj.rotation = normalizeVector3(obj.rotation, { x: 0, y: 0, z: 0 }, "degrees");
				}
				if (obj.scale && typeof obj.scale === "object") {
					obj.scale = normalizeScale3(obj.scale, { x: 1, y: 1, z: 1 });
				}
			});
		}
	}

	return payload;
}

export { NormalizeLevelPayload };
