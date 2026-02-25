// Creates Models for anything that should support being animated.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

import { BuildObject, UpdateObjectWorldAabb } from "./NewObject.js";
import { AddVector3, LerpVector3, NormalizeVector3 } from "../math/Vector3.js";
import { DegreesToRadians } from "../math/Utilities.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function multiplyVector3(a, b) {
	const left = NormalizeVector3(a, { x: 1, y: 1, z: 1 });
	const right = NormalizeVector3(b, { x: 1, y: 1, z: 1 });
	return {
		x: left.x * right.x,
		y: left.y * right.y,
		z: left.z * right.z,
	};
}

function cloneTransform(transform, fallback) {
	const source = transform && typeof transform === "object" ? transform : {};
	const resolvedFallback = fallback && typeof fallback === "object" ? fallback : {};
	const position = NormalizeVector3(source.position, resolvedFallback.position || { x: 0, y: 0, z: 0 });
	const rotation = NormalizeVector3(source.rotation, resolvedFallback.rotation || { x: 0, y: 0, z: 0 });
	const rotationRad = {
		x: DegreesToRadians(rotation.x),
		y: DegreesToRadians(rotation.y),
		z: DegreesToRadians(rotation.z),
	};
	const scale = NormalizeVector3(source.scale, resolvedFallback.scale || { x: 1, y: 1, z: 1 });
	const pivot = NormalizeVector3(source.pivot, resolvedFallback.pivot || { x: 0, y: 0, z: 0 });
	return {
		position: position,
		rotation: rotationRad,
		scale: scale,
		pivot: pivot,
	};
}

function composeTransform(parentTransform, localTransform) {
	const parent = cloneTransform(parentTransform);
	const local = cloneTransform(localTransform);
	return {
		position: AddVector3(parent.position, local.position),
		rotation: AddVector3(parent.rotation, local.rotation),
		scale: multiplyVector3(parent.scale, local.scale),
		pivot: local.pivot,
	};
}

function normalizeMovement(movement) {
	const source = movement && typeof movement === "object" ? movement : {};
	return {
		start: NormalizeVector3(source.start, { x: 0, y: 0, z: 0 }),
		end: NormalizeVector3(source.end, { x: 0, y: 0, z: 0 }),
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

function mergeEntityBlueprint(baseBlueprint, levelOverrides) {
	const base = baseBlueprint && typeof baseBlueprint === "object" ? baseBlueprint : {};
	const overrides = levelOverrides && typeof levelOverrides === "object" ? levelOverrides : {};

	return {
		...base,
		...overrides,
		attacks: Array.isArray(overrides.attacks)
			? overrides.attacks
			: Array.isArray(base.attacks)
				? base.attacks
				: [],
		model: {
			...(base.model && typeof base.model === "object" ? base.model : {}),
			...(overrides.model && typeof overrides.model === "object" ? overrides.model : {}),
			parts: Array.isArray(overrides.model && overrides.model.parts)
				? overrides.model.parts
				: Array.isArray(base.model && base.model.parts)
					? base.model.parts
					: [],
		},
	};
}

function buildPart(partDefinition, entityId, index) {
	const source = partDefinition && typeof partDefinition === "object" ? partDefinition : {};
	const localTransform = {
		position: NormalizeVector3(source.localPosition, { x: 0, y: 0, z: 0 }),
		rotation: NormalizeVector3(source.localRotation, { x: 0, y: 0, z: 0 }),
		scale: NormalizeVector3(source.localScale, { x: 1, y: 1, z: 1 }),
		pivot: NormalizeVector3(source.pivot, { x: 0, y: 0, z: 0 }),
	};

	const mesh = BuildObject(
		{
			id: source.id || `${entityId}-part-${index}`,
			primitive: source.primitive || source.shape || "cube",
			dimensions: NormalizeVector3(source.dimensions, { x: 1, y: 1, z: 1 }),
			textureID: source.textureID || "default-grid",
			textureColor: source.textureColor || { r: 1, g: 1, b: 1, a: 1 },
			textureOpacity: toNumber(source.textureOpacity, 1),
			pivot: localTransform.pivot,
			role: "entity-part",
			parentId: source.parentId || null,
		},
		{ role: "entity-part" }
	);

	return {
		id: mesh.id,
		parentId: source.parentId || null,
		children: [],
		localTransform: cloneTransform(localTransform),
		defaultLocalTransform: cloneTransform(localTransform),
		mesh: mesh,
	};
}

function buildDefaultModel(entityDefinition) {
	return {
		rootTransform: {
			position: NormalizeVector3(entityDefinition.position, { x: 0, y: 0, z: 0 }),
			rotation: NormalizeVector3(entityDefinition.rotation, { x: 0, y: 0, z: 0 }),
			scale: NormalizeVector3(entityDefinition.scale, { x: 1, y: 1, z: 1 }),
			pivot: NormalizeVector3(entityDefinition.pivot, { x: 0, y: 0, z: 0 }),
		},
		parts: [
			buildPart(
				{
					id: `${entityDefinition.id || "entity"}-core`,
					primitive: entityDefinition.shape || "cube",
					dimensions: entityDefinition.size || { x: 1, y: 1, z: 1 },
					textureID: entityDefinition.textureID || "default-grid",
					textureColor: entityDefinition.textureColor || entityDefinition.color || { r: 0.9, g: 0.35, b: 0.35, a: 1 },
					textureOpacity: toNumber(entityDefinition.textureOpacity, 1),
				},
				entityDefinition.id || "entity",
				0
			),
		],
	};
}

function buildModel(entityDefinition) {
	const sourceModel = entityDefinition.model && typeof entityDefinition.model === "object"
		? entityDefinition.model
		: null;

	const model = sourceModel
		? {
			rootTransform: {
				position: NormalizeVector3(sourceModel.rootTransform && sourceModel.rootTransform.position, entityDefinition.position || { x: 0, y: 0, z: 0 }),
				rotation: NormalizeVector3(sourceModel.rootTransform && sourceModel.rootTransform.rotation, entityDefinition.rotation || { x: 0, y: 0, z: 0 }),
				scale: NormalizeVector3(sourceModel.rootTransform && sourceModel.rootTransform.scale, entityDefinition.scale || { x: 1, y: 1, z: 1 }),
				pivot: NormalizeVector3(sourceModel.rootTransform && sourceModel.rootTransform.pivot, { x: 0, y: 0, z: 0 }),
			},
			parts: Array.isArray(sourceModel.parts)
				? sourceModel.parts.map((part, index) => buildPart(part, entityDefinition.id || "entity", index))
				: [],
		}
		: buildDefaultModel(entityDefinition);

	const index = {};
	model.parts.forEach((part) => {
		index[part.id] = part;
	});

	model.parts.forEach((part) => {
		if (!part.parentId || !index[part.parentId]) {
			return;
		}
		index[part.parentId].children.push(part.id);
	});

	model.defaultPose = {
		rootTransform: cloneTransform(model.rootTransform),
		parts: model.parts.map((part) => ({ id: part.id, localTransform: cloneTransform(part.localTransform) })),
	};

	model.index = index;
	model.roots = model.parts.filter((part) => !part.parentId).map((part) => part.id);
	return model;
}

function applyModelPose(model) {
	if (!model || !Array.isArray(model.parts)) {
		return;
	}

	const byId = model.index || {};
	const applyPart = (partId, parentTransform) => {
		const part = byId[partId];
		if (!part) {
			return;
		}

		const worldTransform = composeTransform(parentTransform, part.localTransform);
		part.mesh.transform = {
			position: worldTransform.position,
			rotation: worldTransform.rotation,
			scale: worldTransform.scale,
			pivot: worldTransform.pivot,
		};
		UpdateObjectWorldAabb(part.mesh);

		part.children.forEach((childId) => applyPart(childId, worldTransform));
	};

	const rootTransform = cloneTransform(model.rootTransform);
	model.roots.forEach((rootId) => applyPart(rootId, rootTransform));
}

function computeEntityAabb(model) {
	if (!model || !Array.isArray(model.parts) || model.parts.length === 0) {
		return {
			min: { x: 0, y: 0, z: 0 },
			max: { x: 0, y: 0, z: 0 },
		};
	}

	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;

	model.parts.forEach((part) => {
		const mesh = part.mesh;
		const bounds = mesh && mesh.worldAabb ? mesh.worldAabb : null;
		if (!bounds) {
			return;
		}

		if (bounds.min.x < minX) minX = bounds.min.x;
		if (bounds.min.y < minY) minY = bounds.min.y;
		if (bounds.min.z < minZ) minZ = bounds.min.z;
		if (bounds.max.x > maxX) maxX = bounds.max.x;
		if (bounds.max.y > maxY) maxY = bounds.max.y;
		if (bounds.max.z > maxZ) maxZ = bounds.max.z;
	});

	return {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
	};
}

function BuildEntity(definition) {
	const source = definition && typeof definition === "object" ? definition : {};
	const merged = mergeEntityBlueprint(source.baseBlueprint, source);
	const movement = normalizeMovement(merged.movement);
	const startPosition = NormalizeVector3(merged.position || movement.start, { x: 0, y: 0, z: 0 });

	const model = buildModel({
		...merged,
		position: startPosition,
	});
	applyModelPose(model);

	const aabb = computeEntityAabb(model);

	return {
		id: merged.id || `entity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		type: merged.type || "entity",
		hp: Math.max(0, toNumber(merged.hp, 1)),
		attacks: Array.isArray(merged.attacks) ? merged.attacks : [],
		hardcoded: merged.hardcoded && typeof merged.hardcoded === "object" ? merged.hardcoded : {},
		platform: merged.platform || null,
		movement: movement,
		transform: (function() {
			const pos = { ...startPosition };
			const r = NormalizeVector3(merged.rotation, { x: 0, y: 0, z: 0 });
			return {
				position: pos,
				rotation: {
					x: DegreesToRadians(r.x),
					y: DegreesToRadians(r.y),
					z: DegreesToRadians(r.z),
				},
				scale: NormalizeVector3(merged.scale, { x: 1, y: 1, z: 1 }),
			};
		})(),
		velocity: NormalizeVector3(merged.velocity, { x: 0, y: 0, z: 0 }),
		model: model,
		mesh: model.parts.length > 0 ? model.parts[0].mesh : null,
		collision: {
			aabb: aabb,
		},
		animations: merged.animations && typeof merged.animations === "object" ? merged.animations : {},
		state: {
			movementProgress: 0,
			direction: 1,
			lastJumpMs: 0,
			activeAnimation: "idle",
		},
	};
}

function UpdateEntityModelFromTransform(entity) {
	if (!entity || !entity.model) {
		return;
	}

	entity.model.rootTransform.position = NormalizeVector3(entity.transform && entity.transform.position, { x: 0, y: 0, z: 0 });
	entity.model.rootTransform.rotation = NormalizeVector3(entity.transform && entity.transform.rotation, { x: 0, y: 0, z: 0 });
	entity.model.rootTransform.scale = NormalizeVector3(entity.transform && entity.transform.scale, { x: 1, y: 1, z: 1 });

	applyModelPose(entity.model);
	entity.collision = entity.collision || {};
	entity.collision.aabb = computeEntityAabb(entity.model);
}

function ResetEntityToDefaultPose(entity) {
	if (!entity || !entity.model || !entity.model.defaultPose) {
		return;
	}

	entity.model.rootTransform = cloneTransform(entity.model.defaultPose.rootTransform);
	const byId = entity.model.index || {};
	entity.model.defaultPose.parts.forEach((posePart) => {
		const part = byId[posePart.id];
		if (part) {
			part.localTransform = cloneTransform(posePart.localTransform);
		}
	});

	applyModelPose(entity.model);
	entity.collision = entity.collision || {};
	entity.collision.aabb = computeEntityAabb(entity.model);
}

function SampleMovementPoint(entity, normalizedTime) {
	if (!entity || !entity.movement) {
		return { x: 0, y: 0, z: 0 };
	}

	const start = NormalizeVector3(entity.movement.start, { x: 0, y: 0, z: 0 });
	const end = NormalizeVector3(entity.movement.end, start);
	return LerpVector3(start, end, normalizedTime);
}

export {
	BuildEntity,
	UpdateEntityModelFromTransform,
	ResetEntityToDefaultPose,
	SampleMovementPoint,
};