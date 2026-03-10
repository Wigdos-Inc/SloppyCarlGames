// Creates Models for anything that should support being animated.
// Builds entity models from the ground up with automatic grounding and
// anchor/attachment-point–based part positioning.

// Called by NewBoss.js, player/Model.js, helpers/game/Level.js and helpers/Cutscene.js for Entity Models
// Uses NewObject.js for Model Parts

import { BuildObject, UpdateObjectWorldAabb } from "./NewObject.js";
import { AddVector3, LerpVector3, MultiplyVector3, NormalizeVector3, RotateByEuler } from "../math/Vector3.js";
import { ToNumber, UnitVector3 } from "../math/Utilities.js";

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
	const fbPos = resolvedFallback.position || { x: 0, y: 0, z: 0 };
	const fbRot = resolvedFallback.rotation || { x: 0, y: 0, z: 0 };
	const fbScale = resolvedFallback.scale || { x: 1, y: 1, z: 1 };
	const fbPivot = resolvedFallback.pivot || { x: 0, y: 0, z: 0 };

	const srcPos = source.position || fbPos;
	const srcRot = source.rotation || fbRot;
	const srcScale = source.scale || fbScale;
	const srcPivot = source.pivot || fbPivot;

	const position = new UnitVector3(ToNumber(srcPos.x, fbPos.x), ToNumber(srcPos.y, fbPos.y), ToNumber(srcPos.z, fbPos.z), "cnu");
	const scale = {
		x: ToNumber(srcScale.x, fbScale.x),
		y: ToNumber(srcScale.y, fbScale.y),
		z: ToNumber(srcScale.z, fbScale.z),
	};
	const pivot = new UnitVector3(ToNumber(srcPivot.x, fbPivot.x), ToNumber(srcPivot.y, fbPivot.y), ToNumber(srcPivot.z, fbPivot.z), "cnu");

	let rotation;
	if (rotationInRadians) {
		rotation = new UnitVector3(ToNumber(srcRot.x, fbRot.x), ToNumber(srcRot.y, fbRot.y), ToNumber(srcRot.z, fbRot.z), "radians");
	} else {
		const rotDeg = new UnitVector3(ToNumber(srcRot.x, fbRot.x), ToNumber(srcRot.y, fbRot.y), ToNumber(srcRot.z, fbRot.z), "degrees");
		rotDeg.toRadians(true);
		rotation = rotDeg;
	}

	return { position, rotation, scale, pivot };
}

function composeTransform(parentTransform, localTransform) {
	const parent = cloneTransform(parentTransform, null, true);
	const local = cloneTransform(localTransform, null, true);
	const rotatedChildPos = RotateByEuler(local.position, parent.rotation);
	const composedPos = AddVector3(parent.position, rotatedChildPos);
	const composedRot = AddVector3(parent.rotation, local.rotation);
	const composedScale = MultiplyVector3(parent.scale, local.scale);
	return {
		position: new UnitVector3(composedPos.x, composedPos.y, composedPos.z, "cnu"),
		rotation: new UnitVector3(composedRot.x, composedRot.y, composedRot.z, "radians"),
		scale: composedScale,
	};
}

/* === MOVEMENT === */

function normalizeMovement(movement, surface) {
	const source = movement && typeof movement === "object" ? movement : {};
	const surfacePos = NormalizeVector3(surface && surface.position, { x: 0, y: 0, z: 0 });
	const surfaceTopY = ToNumber(surface && surface.topY, 0);
	const localStart = NormalizeVector3(source.start, { x: 0, y: 0, z: 0 });
	const localEnd = NormalizeVector3(source.end, { x: 0, y: 0, z: 0 });

	// Movement start/end are local to the spawn surface — resolve to world space.
	// Y uses surfaceTopY (top of the surface) instead of surfacePos.y (center of the surface).
	const worldStart = { x: surfacePos.x + localStart.x, y: surfaceTopY + localStart.y, z: surfacePos.z + localStart.z };
	const worldEnd = { x: surfacePos.x + localEnd.x, y: surfaceTopY + localEnd.y, z: surfacePos.z + localEnd.z };

	return {
		start: new UnitVector3(worldStart.x, worldStart.y, worldStart.z, "CNU"),
		end: new UnitVector3(worldEnd.x, worldEnd.y, worldEnd.z, "CNU"),
		repeat: source.repeat !== false,
		backAndForth: source.backAndForth !== false,
		speed: Math.max(0, ToNumber(source.speed, 0)),
		jump: Math.max(0, ToNumber(source.jump, 0)),
		jumpInterval: Math.max(0, ToNumber(source.jumpInterval, 0)),
		jumpOnSight: source.jumpOnSight === true,
		disappear: source.disappear === true,
		chase: source.chase === true,
		physics: source.physics === true,
	};
}

/* === BLUEPRINT MERGE === */

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

	// Data arrives as UnitVector3 from normalize.js.
	const localPosition = source.localPosition;
	const localRotationDeg = source.localRotation;
	// Step 1 (partial): convert degrees to radians.
	if (localRotationDeg.type === "degrees") {
		localRotationDeg.toRadians(true);
	}

	const localScale = NormalizeVector3(source.localScale, { x: 1, y: 1, z: 1 });
	const dimensions = source.dimensions;

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
			scale: { x: localScale.x, y: localScale.y, z: localScale.z },
		},
		dimensions: dimensions,
		// World-space built position/rotation/scale — computed by the pipeline, used for mesh output.
		builtPosition: new UnitVector3(0, 0, 0, "CNU"),
		builtRotation: new UnitVector3(0, 0, 0, "radians"),
		builtScale: { x: 1, y: 1, z: 1 },
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
	const rtPosition = rtSource.position;
	const rtRotation = rtSource.rotation;
	if (rtRotation.type === "degrees") {
		rtRotation.toRadians(true);
	}
	const rtScale = NormalizeVector3(rtSource.scale, { x: 1, y: 1, z: 1 });

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
		rootPart.localTransform.position.set({
			x: localPos.x,
			y: scaledHalfHeight + localPos.y,
			z: localPos.z,
		});

		// localTransform.rotation and localTransform.scale stay as-is from buildPart.

		// Store builtDimensions (scaled) for child attachment offset computation.
		rootPart.builtDimensions.set({
			x: dims.x * combinedScale.x,
			y: dims.y * combinedScale.y,
			z: dims.z * combinedScale.z,
		});
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
		part.localTransform.position.set({
			x: attachOffset.x - scaledAnchorOffset.x + localPos.x,
			y: attachOffset.y - scaledAnchorOffset.y + localPos.y,
			z: attachOffset.z - scaledAnchorOffset.z + localPos.z,
		});

		// localTransform.rotation and localTransform.scale stay as-is from buildPart.

		// Store builtDimensions (scaled) for child attachment offset computation.
		part.builtDimensions.set({
			x: partDims.x * combinedScale.x,
			y: partDims.y * combinedScale.y,
			z: partDims.z * combinedScale.z,
		});
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
			rotation: new UnitVector3(rtRotation.x, rtRotation.y, rtRotation.z, "radians"),
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
	const source = definition && typeof definition === "object" ? definition : {};
	const merged = mergeEntityBlueprint(source.baseBlueprint, source);

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
			position: model.rootTransform.position,
			rotation: model.rootTransform.rotation,
			scale: NormalizeVector3(model.rootTransform.scale, { x: 1, y: 1, z: 1 }),
		},
		velocity: merged.velocity,
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

	entity.model.rootTransform.position.set(entity.transform && entity.transform.position ? entity.transform.position : { x: 0, y: 0, z: 0 });
	entity.model.rootTransform.rotation.set(entity.transform && entity.transform.rotation ? entity.transform.rotation : { x: 0, y: 0, z: 0 });
	entity.model.rootTransform.scale = NormalizeVector3(
		entity.transform && entity.transform.scale ? entity.transform.scale : null,
		{ x: 1, y: 1, z: 1 }
	);

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