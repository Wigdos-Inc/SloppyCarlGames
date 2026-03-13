// Creates Models for anything that should support being animated.
// Builds entity models from the ground up with automatic grounding and
// anchor/attachment-point–based part positioning.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

import { BuildObject, UpdateObjectWorldAabb } from "./NewObject.js";
import { AddVector3, LerpVector3, MultiplyVector3, NormalizeVector3, RotateByEuler } from "../math/Vector3.js";
import { DegreesToRadians, ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";

/* === FACE / ANCHOR UTILITIES === */

const VALID_FACES = ["front", "back", "left", "right", "top", "bottom", "center"];

function normalizeFace(value, fallback) {
	if (typeof value === "string") {
		const lower = value.trim().toLowerCase();
		if (VALID_FACES.includes(lower)) return lower;
	}
	return fallback;
}

// Canonical face normal directions (unit vectors for each face).
const FACE_NORMALS = {
	top:    { x:  0, y:  1, z:  0 },
	bottom: { x:  0, y: -1, z:  0 },
	front:  { x:  0, y:  0, z:  1 },
	back:   { x:  0, y:  0, z: -1 },
	left:   { x: -1, y:  0, z:  0 },
	right:  { x:  1, y:  0, z:  0 },
};

/**
 * Get the center position offset for a given face of a box with the given dimensions.
 * Returns {x,y,z} offset from the box center.
 */
function getFaceCenterOffset(dimensions, faceType) {
	const dims = NormalizeVector3(dimensions, { x: 1, y: 1, z: 1 });
	switch (faceType) {
		case "top":    return { x: 0, y:  dims.y * 0.5, z: 0 };
		case "bottom": return { x: 0, y: -dims.y * 0.5, z: 0 };
		case "front":  return { x: 0, y: 0, z:  dims.z * 0.5 };
		case "back":   return { x: 0, y: 0, z: -dims.z * 0.5 };
		case "left":   return { x: -dims.x * 0.5, y: 0, z: 0 };
		case "right":  return { x:  dims.x * 0.5, y: 0, z: 0 };
		case "center":
		default:       return { x: 0, y: 0, z: 0 };
	}
}

/**
 * After applying a rotation to a part, the logical face labels may no longer match
 * their original axes. This function rotates each canonical face normal by the given
 * euler rotation (radians), then reassigns face labels based on which world-axis
 * direction each rotated normal most closely aligns with.
 * Returns an object mapping original face names to new face names.
 */
function remapFacesAfterRotation(rotation) {
	const rot = NormalizeVector3(rotation);
	const isNearZero = Math.abs(rot.x) < 1e-6 && Math.abs(rot.y) < 1e-6 && Math.abs(rot.z) < 1e-6;
	if (isNearZero) {
		return { top: "top", bottom: "bottom", front: "front", back: "back", left: "left", right: "right" };
	}

	// World-axis directions and the face label they correspond to.
	const worldAxes = [
		{ label: "right",  dir: { x:  1, y:  0, z:  0 } },
		{ label: "left",   dir: { x: -1, y:  0, z:  0 } },
		{ label: "top",    dir: { x:  0, y:  1, z:  0 } },
		{ label: "bottom", dir: { x:  0, y: -1, z:  0 } },
		{ label: "front",  dir: { x:  0, y:  0, z:  1 } },
		{ label: "back",   dir: { x:  0, y:  0, z: -1 } },
	];

	const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
	const remap = {};
	const faceNames = Object.keys(FACE_NORMALS);
	const claimed = new Set();

	// Rotate each canonical face normal → find the world axis it best aligns with.
	const rotatedEntries = faceNames.map((name) => {
		const rotated = RotateByEuler(FACE_NORMALS[name], rot);
		return { name, rotated };
	});

	// Sort by best alignment (highest dot product first) to prevent ties from producing duplicates.
	const assignments = [];
	for (const entry of rotatedEntries) {
		let bestDot = -Infinity;
		let bestLabel = "top";
		for (const axis of worldAxes) {
			const d = dot(entry.rotated, axis.dir);
			if (d > bestDot) {
				bestDot = d;
				bestLabel = axis.label;
			}
		}
		assignments.push({ name: entry.name, bestLabel, bestDot });
	}

	// Greedy assignment: highest alignment first.
	assignments.sort((a, b) => b.bestDot - a.bestDot);
	for (const a of assignments) {
		if (!claimed.has(a.bestLabel)) {
			remap[a.name] = a.bestLabel;
			claimed.add(a.bestLabel);
		} else {
			// Fallback: assign first unclaimed axis by dot product.
			let fallbackLabel = a.name;
			let fallbackDot = -Infinity;
			for (const axis of worldAxes) {
				if (!claimed.has(axis.label)) {
					const d = a.bestDot; // approximate
					if (d > fallbackDot) {
						fallbackDot = d;
						fallbackLabel = axis.label;
					}
				}
			}
			remap[a.name] = fallbackLabel;
			claimed.add(fallbackLabel);
		}
	}

	return remap;
}

/**
 * Get face center offset using a face remap.
 * The logical faceType is remapped through the faceMap before computing the offset.
 */
function getRemappedFaceOffset(dimensions, faceType, faceMap) {
	const resolvedFace = faceMap && faceMap[faceType] ? faceMap[faceType] : faceType;
	return getFaceCenterOffset(dimensions, resolvedFace);
}

/* === TRANSFORM UTILITIES === */

function cloneTransform(transform, fallback, rotationInRadians) {
	const source = transform && typeof transform === "object" ? transform : {};
	const resolvedFallback = fallback && typeof fallback === "object" ? fallback : {};
	const position = NormalizeVector3(source.position, resolvedFallback.position || { x: 0, y: 0, z: 0 });
	const rotation = NormalizeVector3(source.rotation, resolvedFallback.rotation || { x: 0, y: 0, z: 0 });
	const rotationRad = rotationInRadians
		? { x: rotation.x, y: rotation.y, z: rotation.z }
		: {
			x: DegreesToRadians(rotation.x),
			y: DegreesToRadians(rotation.y),
			z: DegreesToRadians(rotation.z),
		};
	const scale = NormalizeVector3(source.scale, resolvedFallback.scale || { x: 1, y: 1, z: 1 });
	const pivot = NormalizeVector3(source.pivot, resolvedFallback.pivot || { x: 0, y: 0, z: 0 });
	return { position, rotation: rotationRad, scale, pivot };
}

function composeTransform(parentTransform, localTransform) {
	const parent = cloneTransform(parentTransform, null, true);
	const local = cloneTransform(localTransform, null, true);
	const rotatedChildPos = RotateByEuler(local.position, parent.rotation);
	return {
		position: AddVector3(parent.position, rotatedChildPos),
		rotation: AddVector3(parent.rotation, local.rotation),
		scale: MultiplyVector3(parent.scale, local.scale),
	};
}

/* === MOVEMENT === */

function normalizeMovement(movement, surface) {
	const surfacePos = NormalizeVector3(surface && surface.position, { x: 0, y: 0, z: 0 });
	const surfaceTopY = ToNumber(surface && surface.topY, 0);
	const localStart = NormalizeVector3(movement.start, { x: 0, y: 0, z: 0 });
	const localEnd = NormalizeVector3(movement.end, { x: 0, y: 0, z: 0 });

	// Movement start/end are local to the spawn surface — resolve to world space.
	// Y uses surfaceTopY (top of the surface) instead of surfacePos.y (center of the surface).
	const worldStart = { x: surfacePos.x + localStart.x, y: surfaceTopY + localStart.y, z: surfacePos.z + localStart.z };
	const worldEnd = { x: surfacePos.x + localEnd.x, y: surfaceTopY + localEnd.y, z: surfacePos.z + localEnd.z };

	return {
		start: new UnitVector3(worldStart.x, worldStart.y, worldStart.z, "CNU"),
		end: new UnitVector3(worldEnd.x, worldEnd.y, worldEnd.z, "CNU"),
		repeat: movement.repeat !== false,
		backAndForth: movement.backAndForth !== false,
		speed: Math.max(0, ToNumber(movement.speed, 0)),
		jump: Math.max(0, ToNumber(movement.jump, 0)),
		jumpInterval: Math.max(0, ToNumber(movement.jumpInterval, 0)),
		jumpOnSight: movement.jumpOnSight === true,
		disappear: movement.disappear === true,
		chase: movement.chase === true,
		physics: movement.physics === true,
	};
}

/* === BLUEPRINT MERGE === */

function mergeEntityBlueprint(baseBlueprint, levelOverrides) {
	const base = baseBlueprint;
	const overrides = levelOverrides;

	return {
		...base,
		...overrides,
		attacks: Array.isArray(overrides.attacks)
			? overrides.attacks
			: Array.isArray(base.attacks)
				? base.attacks
				: [],
		model: {
			...base.model,
			...overrides.model,
			parts: Array.isArray(overrides.model && overrides.model.parts)
				? overrides.model.parts
				: Array.isArray(base.model && base.model.parts)
					? base.model.parts
					: [],
		},
	};
}

/* === PART BUILDING === */

function buildPart(partDefinition, entityId, index) {
	const source = partDefinition && typeof partDefinition === "object" ? partDefinition : {};

	const mesh = BuildObject(
		{
			id: source.id || `${entityId}-part-${index}`,
			primitive: source.primitive || source.shape || "cube",
			dimensions: NormalizeVector3(source.dimensions, { x: 1, y: 1, z: 1 }),
			textureID: source.textureID || "default-grid",
			textureColor: source.textureColor || { r: 1, g: 1, b: 1, a: 1 },
			textureOpacity: ToNumber(source.textureOpacity, 1),
			role: "entity-part",
			parentId: source.parentId || null,
		},
		{ role: "entity-part" }
	);

	// Normalize source values into Unit/UnitVector3 instances.
	const localPosition = new UnitVector3(
		ToNumber(source.localPosition && source.localPosition.x, 0),
		ToNumber(source.localPosition && source.localPosition.y, 0),
		ToNumber(source.localPosition && source.localPosition.z, 0),
		"CNU"
	);
	const localRotationDeg = new UnitVector3(
		ToNumber(source.localRotation && source.localRotation.x, 0),
		ToNumber(source.localRotation && source.localRotation.y, 0),
		ToNumber(source.localRotation && source.localRotation.z, 0),
		"degrees"
	);
	// Step 1 (partial): convert degrees to radians.
	localRotationDeg.toRadians(true);

	const localScale = new UnitVector3(
		ToNumber(source.localScale && source.localScale.x, 1),
		ToNumber(source.localScale && source.localScale.y, 1),
		ToNumber(source.localScale && source.localScale.z, 1),
		"CNU"
	);
	const dimensions = new UnitVector3(
		ToNumber(source.dimensions && source.dimensions.x, 1),
		ToNumber(source.dimensions && source.dimensions.y, 1),
		ToNumber(source.dimensions && source.dimensions.z, 1),
		"CNU"
	);

	const resolvedParentId = source.parentId || null;
	const anchorPoint = normalizeFace(source.anchorPoint, resolvedParentId === "root" ? "bottom" : "center");
	const attachmentPoint = normalizeFace(source.attachmentPoint, "top");

	return {
		id: mesh.id,
		label: source.label || null,
		parentId: resolvedParentId,
		anchorPoint: anchorPoint,
		attachmentPoint: attachmentPoint,
		children: [],
		// Source values preserved for animation (localTransform used at pose-time).
		localTransform: {
			position: localPosition,
			rotation: localRotationDeg, // now in radians despite variable name
			scale: localScale,
		},
		defaultLocalTransform: {
			position: new UnitVector3(localPosition.x, localPosition.y, localPosition.z, "CNU"),
			rotation: new UnitVector3(localRotationDeg.x, localRotationDeg.y, localRotationDeg.z, "radians"),
			scale: new UnitVector3(localScale.x, localScale.y, localScale.z, "CNU"),
		},
		dimensions: dimensions,
		// World-space built position/rotation/scale — computed by the pipeline, used for mesh output.
		builtPosition: new UnitVector3(0, 0, 0, "CNU"),
		builtRotation: new UnitVector3(0, 0, 0, "radians"),
		builtScale: new UnitVector3(1, 1, 1, "CNU"),
		builtDimensions: new UnitVector3(dimensions.x, dimensions.y, dimensions.z, "CNU"),
		faceMap: null,
		mesh: mesh,
	};
}

/* === SURFACE RESOLUTION === */

/**
 * Resolve spawn surface data from the surface map.
 * Returns { position, dimensions, scale, topY } or a zero-default if not found.
 */
function resolveSpawnSurface(spawnSurfaceId, surfaceMap) {
	if (!spawnSurfaceId || !surfaceMap || typeof surfaceMap !== "object") {
		return { position: { x: 0, y: 0, z: 0 }, dimensions: { x: 1, y: 1, z: 1 }, scale: { x: 1, y: 1, z: 1 }, topY: 0 };
	}
	const surface = surfaceMap[spawnSurfaceId];
	if (!surface) {
		return { position: { x: 0, y: 0, z: 0 }, dimensions: { x: 1, y: 1, z: 1 }, scale: { x: 1, y: 1, z: 1 }, topY: 0 };
	}
	return surface;
}

/* === 14-STEP MODEL BUILD PIPELINE === */

function buildModel(entityDefinition, surfaceMap) {
	const sourceModel = entityDefinition.model && typeof entityDefinition.model === "object"
		? entityDefinition.model
		: null;

	if (!sourceModel) {
		// Fallback: build a single-part default model.
		return buildDefaultModel(entityDefinition, surfaceMap);
	}

	const entityId = entityDefinition.id || "entity";

	// --- Step 1: Resolve rootTransform from data ---
	const rtSource = entityDefinition.rootTransform && typeof entityDefinition.rootTransform === "object"
		? entityDefinition.rootTransform
		: sourceModel.rootTransform && typeof sourceModel.rootTransform === "object"
			? sourceModel.rootTransform
			: {};
	const rtPosition = new UnitVector3(
		ToNumber(rtSource.position && rtSource.position.x, 0),
		ToNumber(rtSource.position && rtSource.position.y, 0),
		ToNumber(rtSource.position && rtSource.position.z, 0),
		"CNU"
	);
	const rtRotation = new UnitVector3(
		ToNumber(rtSource.rotation && rtSource.rotation.x, 0),
		ToNumber(rtSource.rotation && rtSource.rotation.y, 0),
		ToNumber(rtSource.rotation && rtSource.rotation.z, 0),
		"degrees"
	);
	rtRotation.toRadians(true);
	const rtScale = new UnitVector3(
		ToNumber(rtSource.scale && rtSource.scale.x, 1),
		ToNumber(rtSource.scale && rtSource.scale.y, 1),
		ToNumber(rtSource.scale && rtSource.scale.z, 1),
		"CNU"
	);

	// Build all parts (each part wraps its own values in Unit/UnitVector3).
	const parts = Array.isArray(sourceModel.parts)
		? sourceModel.parts.map((part, index) => buildPart(part, entityId, index))
		: [];

	// Build index and parent-child links.
	const index = {};
	parts.forEach((part) => { index[part.id] = part; });
	parts.forEach((part) => {
		if (part.parentId && part.parentId !== "root" && index[part.parentId]) {
			index[part.parentId].children.push(part.id);
		}
	});

	// Identify root parts and non-root parts.
	const rootPartIds = parts.filter((p) => p.parentId === "root").map((p) => p.id);

	// Resolve spawn surface.
	const spawnSurfaceId = entityDefinition.spawnSurfaceId || sourceModel.spawnSurfaceId || null;
	const surface = resolveSpawnSurface(spawnSurfaceId, surfaceMap);
	const surfaceTopY = surface.topY;
	const surfacePosition = NormalizeVector3(surface.position, { x: 0, y: 0, z: 0 });

	// --- Process root parts: build localTransform in model-local space ---
	// Root part localTransform.position is relative to rootTransform (the group origin).
	// Factor 4 (grounding): Y = scaledHalfHeight so bottom face sits at rootTransform.position.y
	// Factor 3 (localPosition): added on top of grounding
	// Factor 6 (scale offset): accounted for in scaledHalfHeight
	for (const rootPartId of rootPartIds) {
		const rootPart = index[rootPartId];
		if (!rootPart) continue;

		const dims = rootPart.dimensions;
		const localRot = rootPart.localTransform.rotation;
		const localPos = rootPart.localTransform.position;
		const localScale = rootPart.localTransform.scale;

		// Face remapping after rotation.
		rootPart.faceMap = remapFacesAfterRotation(localRot);

		// Combined scale for dimensions computation.
		const combinedScale = {
			x: rtScale.x * localScale.x,
			y: rtScale.y * localScale.y,
			z: rtScale.z * localScale.z,
		};

		// Grounding: half-height of scaled part so bottom face sits at Y=0 in model-local space.
		const scaledHalfHeight = dims.y * combinedScale.y * 0.5;

		// Set localTransform.position: grounding + localPosition (model-local, relative to rootTransform).
		rootPart.localTransform.position = new UnitVector3(
			localPos.x,
			scaledHalfHeight + localPos.y,
			localPos.z,
			"CNU"
		);

		// localTransform.rotation and localTransform.scale stay as-is from buildPart.

		// Store builtDimensions (scaled) for child attachment offset computation.
		rootPart.builtDimensions = new UnitVector3(
			dims.x * combinedScale.x,
			dims.y * combinedScale.y,
			dims.z * combinedScale.z,
			"CNU"
		);
	}

	// --- Process non-root parts in BFS order ---
	// Non-root part localTransform.position is relative to parent.
	// Factor 5 (attachment): attach part's anchorPoint to parent's attachmentPoint
	// Factor 3 (localPosition): added on top
	// Factor 6 (scale offset): anchor offset scaled
	const processQueue = [];
	for (const rootPartId of rootPartIds) {
		const rootPart = index[rootPartId];
		if (!rootPart) continue;
		for (const childId of rootPart.children) {
			processQueue.push(childId);
		}
	}

	const processed = new Set(rootPartIds);
	while (processQueue.length > 0) {
		const partId = processQueue.shift();
		if (processed.has(partId)) continue;
		processed.add(partId);

		const part = index[partId];
		if (!part) continue;

		const parentPart = part.parentId === "root" ? null : index[part.parentId];
		if (!parentPart) continue;

		const partDims = part.dimensions;
		const localPos = part.localTransform.position;
		const localScale = part.localTransform.scale;

		// Combined scale.
		const combinedScale = {
			x: rtScale.x * localScale.x,
			y: rtScale.y * localScale.y,
			z: rtScale.z * localScale.z,
		};

		// Parent's attachment point offset (in parent's scaled dimensions).
		const attachOffset = getFaceCenterOffset(parentPart.builtDimensions, part.attachmentPoint);

		// Part's anchor point offset (in part's unscaled dimensions), then scaled.
		const anchorOffset = getFaceCenterOffset(partDims, part.anchorPoint);
		const scaledAnchorOffset = {
			x: anchorOffset.x * combinedScale.x,
			y: anchorOffset.y * combinedScale.y,
			z: anchorOffset.z * combinedScale.z,
		};

		// Position: attachment offset on parent - scaled anchor offset on part + localPosition.
		part.localTransform.position = new UnitVector3(
			attachOffset.x - scaledAnchorOffset.x + localPos.x,
			attachOffset.y - scaledAnchorOffset.y + localPos.y,
			attachOffset.z - scaledAnchorOffset.z + localPos.z,
			"CNU"
		);

		// localTransform.rotation and localTransform.scale stay as-is from buildPart.

		// Store builtDimensions (scaled) for child attachment offset computation.
		part.builtDimensions = new UnitVector3(
			partDims.x * combinedScale.x,
			partDims.y * combinedScale.y,
			partDims.z * combinedScale.z,
			"CNU"
		);
		part.faceMap = remapFacesAfterRotation(part.localTransform.rotation);

		// Enqueue children.
		for (const childId of part.children) {
			processQueue.push(childId);
		}
	}

	// --- Assemble model with world-space rootTransform ---
	// Factor 1 (spawn surface position) + Factor 2 (rootTransform.position) = world position.
	const model = {
		rootTransform: {
			position: new UnitVector3(
				surfacePosition.x + rtPosition.x,
				surfaceTopY + rtPosition.y,
				surfacePosition.z + rtPosition.z,
				"CNU"
			),
			rotation: { x: rtRotation.x, y: rtRotation.y, z: rtRotation.z },
			scale: { x: rtScale.x, y: rtScale.y, z: rtScale.z },
		},
		spawnSurfaceId: spawnSurfaceId,
		surfacePosition: surfacePosition,
		parts: parts,
		index: index,
		roots: rootPartIds,
	};

	// Apply initial pose to set mesh transforms (like player Model.js).
	applyModelPose(model);

	// Snapshot default pose for ResetEntityToDefaultPose.
	model.defaultPose = {
		rootTransform: cloneTransform(model.rootTransform, null, true),
		parts: parts.map((part) => ({
			id: part.id,
			localTransform: cloneTransform(part.localTransform, null, true),
		})),
	};

	return model;
}

function buildDefaultModel(entityDefinition, surfaceMap) {
	// Minimal single-part model for entities that don't provide a model object.
	const defaultModelDef = {
		spawnSurfaceId: entityDefinition.spawnSurfaceId || null,
		rootTransform: {
			position: { x: 0, y: 0, z: 0 },
			rotation: NormalizeVector3(entityDefinition.rotation, { x: 0, y: 0, z: 0 }),
			scale: NormalizeVector3(entityDefinition.scale, { x: 1, y: 1, z: 1 }),
		},
		parts: [
			{
				id: `${entityDefinition.id || "entity"}-core`,
				parentId: "root",
				anchorPoint: "bottom",
				primitive: entityDefinition.shape || "cube",
				dimensions: entityDefinition.size || { x: 1, y: 1, z: 1 },
				textureID: entityDefinition.textureID || "default-grid",
				textureColor: entityDefinition.textureColor || entityDefinition.color || { r: 0.9, g: 0.35, b: 0.35, a: 1 },
				textureOpacity: ToNumber(entityDefinition.textureOpacity, 1),
			},
		],
	};

	return buildModel({ ...entityDefinition, model: defaultModelDef }, surfaceMap);
}

/* === RUNTIME POSE APPLICATION === */

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
		part.mesh.transform.position.set(worldTransform.position);
		part.mesh.transform.rotation.set(worldTransform.rotation);
		part.mesh.transform.scale = worldTransform.scale;
		UpdateObjectWorldAabb(part.mesh);

		part.children.forEach((childId) => applyPart(childId, worldTransform));
	};

	const rootTransform = cloneTransform(model.rootTransform, null, true);
	model.roots.forEach((rootId) => applyPart(rootId, rootTransform));
}

/* === AABB === */

function computeEntityAabb(model) {
	if (!model || !Array.isArray(model.parts) || model.parts.length === 0) {
		return {
			min: new UnitVector3(0, 0, 0, "CNU"),
			max: new UnitVector3(0, 0, 0, "CNU"),
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
		min: new UnitVector3(minX, minY, minZ, "CNU"),
		max: new UnitVector3(maxX, maxY, maxZ, "CNU"),
	};
}

function computeExpandedAabb(aabb, padding) {
	if (!aabb || !aabb.min || !aabb.max) {
		return null;
	}
	const pad = Math.max(0, ToNumber(padding, 8));
	return {
		min: new UnitVector3(aabb.min.x - pad, aabb.min.y - pad, aabb.min.z - pad, "CNU"),
		max: new UnitVector3(aabb.max.x + pad, aabb.max.y + pad, aabb.max.z + pad, "CNU"),
	};
}

/* === PUBLIC API === */

/**
 * Build an entity from a merged definition.
 * @param {object} definition — merged blueprint + level overrides.
 * @param {object} [surfaceMap] — { [surfaceId]: { position, dimensions, scale, topY } }
 */
function BuildEntity(definition, surfaceMap) {
	const merged = mergeEntityBlueprint(definition.baseBlueprint, definition);

	// Resolve spawn surface for movement localization.
	const spawnSurfaceId = (merged.model && merged.model.spawnSurfaceId) || merged.spawnSurfaceId || null;
	const surface = resolveSpawnSurface(spawnSurfaceId, surfaceMap);

	const movement = normalizeMovement(merged.movement, surface);

	const model = buildModel(merged, surfaceMap || {});

	const aabb = computeEntityAabb(model);
	const simRadiusPadding = ToNumber(merged.simRadiusPadding, 8);

	return {
		id: merged.id || `entity-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		type: merged.type || "entity",
		hp: Math.max(0, ToNumber(merged.hp, 1)),
		attacks: Array.isArray(merged.attacks) ? merged.attacks : [],
		hardcoded: merged.hardcoded && typeof merged.hardcoded === "object" ? merged.hardcoded : {},
		platform: merged.platform || null,
		movement: movement,
		transform: {
			position: new UnitVector3(
				model.rootTransform.position.x,
				model.rootTransform.position.y,
				model.rootTransform.position.z,
				"CNU"
			),
			rotation: new UnitVector3(
				model.rootTransform.rotation.x,
				model.rootTransform.rotation.y,
				model.rootTransform.rotation.z,
				"radians"
			),
			scale: new UnitVector3(
				model.rootTransform.scale.x,
				model.rootTransform.scale.y,
				model.rootTransform.scale.z,
				"CNU"
			),
		},
		velocity: new UnitVector3(
			ToNumber(merged.velocity && merged.velocity.x, 0),
			ToNumber(merged.velocity && merged.velocity.y, 0),
			ToNumber(merged.velocity && merged.velocity.z, 0),
			"CNU"
		),
		model: model,
		mesh: model.parts.length > 0 ? model.parts[0].mesh : null,
		collision: {
			aabb: aabb,
			simRadiusPadding: simRadiusPadding,
			simRadiusAabb: computeExpandedAabb(aabb, simRadiusPadding),
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
	entity.collision.simRadiusPadding = ToNumber(entity.collision.simRadiusPadding, 8);
	entity.collision.simRadiusAabb = computeExpandedAabb(
		entity.collision.aabb,
		entity.collision.simRadiusPadding
	);
}

function ResetEntityToDefaultPose(entity) {
	if (!entity || !entity.model || !entity.model.defaultPose) {
		return;
	}

	entity.model.rootTransform = cloneTransform(entity.model.defaultPose.rootTransform, null, true);
	const byId = entity.model.index || {};
	entity.model.defaultPose.parts.forEach((posePart) => {
		const part = byId[posePart.id];
		if (part) {
			part.localTransform = cloneTransform(posePart.localTransform, null, true);
		}
	});

	applyModelPose(entity.model);
	entity.collision = entity.collision || {};
	entity.collision.aabb = computeEntityAabb(entity.model);
	entity.collision.simRadiusPadding = ToNumber(entity.collision.simRadiusPadding, 8);
	entity.collision.simRadiusAabb = computeExpandedAabb(
		entity.collision.aabb,
		entity.collision.simRadiusPadding
	);
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