// NewScatter.js
// Responsibilities:
// - Generate per-object scatter instances and instance batches
// - Preserve Unit/UnitVector3 instances (do not re-instance downstream)
// - Assume payload is canonical (normalized at the boundary); avoid defensive checks
// - Centralize sampling logic in `iterateScatterInstances`

import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { CreateRenderMatrix } from "../math/Matrix.js";
import { BuildObject, BuildGeometry, GenerateUVs } from "./NewObject.js";
import { UnitVector3 } from "../math/Utilities.js";
import { RotateByEuler, MultiplyVector3, ScaleVector3, AddVector3, SubtractVector3, WORLD_NORMALS } from "../math/Vector3.js";
import visualTemplates from "./templates/textures.json" with { type: "json" };

// Normalize JSON template vectors into UnitVector3 instances
// NO OTHER TYPE OF NORMALISATION IS ALLOWED HERE
(function normalizeVisualTemplates() {
	const toUnitVector3 = (v, t) => new UnitVector3(v.x, v.y, v.z, t)
  	for (const key in visualTemplates.scatterTypes) {
  	  	visualTemplates.scatterTypes[key].parts.forEach((part) => {
  	  	  	part.dimensions    = toUnitVector3(part.dimensions, "cnu");
  	  	  	part.localPosition = toUnitVector3(part.localPosition, "cnu");
  	  	  	part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
  	  	});
  	}
})();

function GetPerformanceScatterMultiplier() {
	if (CONFIG.PERFORMANCE.TerrainScatter === "High") return 1;
	if (CONFIG.PERFORMANCE.TerrainScatter === "Low") return 0;
	return 0.5;
}

function isPointInDetailedBoundsXZ(worldX, worldZ, detailedBounds) {
	if (detailedBounds.type === "aabb") return (
		worldX >= detailedBounds.min.x && worldX <= detailedBounds.max.x &&
		worldZ >= detailedBounds.min.z && worldZ <= detailedBounds.max.z
	);
	if (detailedBounds.type === "obb") {
		const dx = worldX - detailedBounds.center.x;
		const dz = worldZ - detailedBounds.center.z;
		return (
			Math.abs(dx * detailedBounds.axes[0].x + dz * detailedBounds.axes[0].z) <= detailedBounds.halfExtents.x &&
		    Math.abs(dx * detailedBounds.axes[1].x + dz * detailedBounds.axes[1].z) <= detailedBounds.halfExtents.y &&
		    Math.abs(dx * detailedBounds.axes[2].x + dz * detailedBounds.axes[2].z) <= detailedBounds.halfExtents.z
		);
	}
	return true;
}

function hashNoise(x, z, seed) {
	const value = Math.sin(x * 12.9898 + z * 78.233 + seed * 37.719) * 43758.5453;
	return value - Math.floor(value);
}

const primitiveGeometryKey = (prim, dim, comp, primOptions) => `${prim}_${dim.x}_${dim.y}_${dim.z}_${comp}_${primOptions}`;

function logScatterBounds(message, objectMesh) {
	Log(
		"ENGINE",
		`
			${message}: \n
			- source=${objectMesh.id}, \n
			- minX=${objectMesh.worldAabb.min.x.toFixed(2)}, \n
			- maxX=${objectMesh.worldAabb.max.x.toFixed(2)}, \n
			- minZ=${objectMesh.worldAabb.min.z.toFixed(2)}, \n
			- maxZ=${objectMesh.worldAabb.max.z.toFixed(2)}
		`,
		"log",
		"Level"
	);
}

function processScatterModels(params, handlers) {
	const { objectMesh, scatterMultiplier, world, indexSeed, explicitRequests, openFaces } = params;
	return iterateScatterInstances(
		{ objectMesh, scatterMultiplier, world, indexSeed, explicitRequests, openFaces },
		(ctx) => {
			const modelState = handlers.beginModel ? handlers.beginModel(ctx) : null;
			let modelAabb = null;

			ctx.partContexts.forEach((partContext, partIndex) => {
				const bounds = handlers.processPart(ctx, partContext, partIndex, modelState);
				if (bounds) {
					if (!modelAabb) modelAabb = { min: bounds.min.clone(), max: bounds.max.clone() }
					else {
						modelAabb.min.min(bounds.min);
						modelAabb.max.max(bounds.max);
					}
				}
			});

			if (modelAabb) handlers.finishModel(ctx, modelAabb, modelState);
		}
	);
}

// Use shared RotateByEuler from math/Vector3.js for Euler rotation (Y -> X -> Z)

// Compute the half-height (vertical extent / 2) of the part after localRotation is applied.
// Returns value in the same units as `part.dimensions` (CNU) so callers can multiply by uniformScale
function getPartHalfHeight(part, uniformScale) {
	if (part.primitive === "plane") return 0;

	// Columns of rotation matrix = R * basis vectors. We want the Y-row contributions, which
	// are the y components of those columns. Use shared RotateByEuler (Y->X->Z) to rotate basis.
	const colX = RotateByEuler(WORLD_NORMALS.Right, part.localRotation);
	const colY = RotateByEuler(WORLD_NORMALS.Up, part.localRotation);
	const colZ = RotateByEuler(WORLD_NORMALS.Forward, part.localRotation);

	const h = ScaleVector3(MultiplyVector3(part.dimensions, part.localScale), uniformScale * 0.5);
	const halfHeight = Math.abs(colX.y) * h.x + Math.abs(colY.y) * h.y + Math.abs(colZ.y) * h.z;
	return Math.max(0, halfHeight);
}

function resolveRootPart(parts, uniformScale) {
	const roots = parts.filter((part) => part.level === 0);
	if (roots.length === 0) return null;

	let selected = roots[0];
	roots.forEach(candidate => {
		if (candidate.stackY < selected.stackY) { selected = candidate; return; }
		if (candidate.stackY === selected.stackY) {
			if (getPartHalfHeight(candidate, uniformScale) > getPartHalfHeight(selected, uniformScale)) selected = candidate;
		}
	});

	return selected;
}

// Computes hierarchical stack positions independently from authored localPosition.
// localPosition is applied later as a final per-part post-offset.
function applyHierarchicalOffsets(parts, uniformScale) {
	if (parts.length === 0) return parts;

	// Build level-wise stacks so higher levels sit on lower levels deterministically.
	const partsByLevel = new Map();
	parts.forEach((part) => {
		if (!partsByLevel.has(part.level)) partsByLevel.set(part.level, []);
		partsByLevel.get(part.level).push(part);
	});

	const levels = [...partsByLevel.keys()].sort((a, b) => a - b);
	const adjustedByLevel = new Map();
	let cumulativeTop = null;

	levels.forEach((level) => {
		const adjustedParts = partsByLevel.get(level).map((part) => {
			let stackY = getPartHalfHeight(part, uniformScale);
			if (level > 0 && cumulativeTop !== null) stackY += cumulativeTop;
			return { ...part, stackY };
		});

		adjustedByLevel.set(level, adjustedParts);

		let levelTop = null;
		adjustedParts.forEach((part) => {
			const partTop = part.stackY + getPartHalfHeight(part, uniformScale);
			levelTop = levelTop === null ? partTop : Math.max(levelTop, partTop);
		});

		if (levelTop !== null) cumulativeTop = cumulativeTop === null ? levelTop : Math.max(cumulativeTop, levelTop);
	});

	return levels.flatMap((level) => adjustedByLevel.get(level));
}

// Rotated XZ footprint AABB for a single root part (half-width/half-depth swept around the
// sample center). Shared between the parent-bounds check and the opening-rejection check.
function rootPartFootprintAabbXZ(part, worldX, worldZ, uniformScale, yaw) {
	const cosYaw = Math.abs(Math.cos(yaw));
	const sinYaw = Math.abs(Math.sin(yaw));

	const scaledWidth = part.dimensions.x * part.localScale.x * uniformScale;
	const scaledDepth = part.dimensions.z * part.localScale.z * uniformScale;
	const halfWidth   = (scaledWidth * cosYaw + scaledDepth * sinYaw) * 0.5;
	const halfDepth   = (scaledWidth * sinYaw + scaledDepth * cosYaw) * 0.5;

	const centerX = worldX + part.localPosition.x;
	const centerZ = worldZ + part.localPosition.z;
	return {
		minX: centerX - halfWidth, maxX: centerX + halfWidth,
		minZ: centerZ - halfDepth, maxZ: centerZ + halfDepth,
	};
}

function areRootPartsWithinParentBounds(parts, worldX, worldZ, uniformScale, seed, minX, maxX, minZ, maxZ) {
	if (parts.length === 0) return true;

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex];
		if (part.level !== 0) continue;

		const yaw = part.localRotation.y + hashNoise(worldX, worldZ, seed + partIndex) * Math.PI * 2;
		const fp = rootPartFootprintAabbXZ(part, worldX, worldZ, uniformScale, yaw);

		if (fp.minX < minX || fp.maxX > maxX || fp.minZ < minZ || fp.maxZ > maxZ) return false;
	}

	return true;
}

// Rejects a scatter sample whose root-part XZ footprint overlaps any opening's XZ footprint.
// openingAabbsXZ: pre-filtered top-relevant open faces, each projected to an XZ AABB.
// Conservative AABB-vs-AABB (over-exclusion at a rim is barely visible; under-exclusion shows).
function isFootprintOverOpening(parts, worldX, worldZ, uniformScale, seed, openingAabbsXZ) {
	if (openingAabbsXZ.length === 0) return false;

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex];
		if (part.level !== 0) continue;

		const yaw = part.localRotation.y + hashNoise(worldX, worldZ, seed + partIndex) * Math.PI * 2;
		const fp = rootPartFootprintAabbXZ(part, worldX, worldZ, uniformScale, yaw);

		for (const o of openingAabbsXZ) {
			if (fp.minX <= o.maxX && fp.maxX >= o.minX && fp.minZ <= o.maxZ && fp.maxZ >= o.minZ) return true;
		}
	}

	return false;
}

// Iterate scatter instances and invoke a handler with pre-computed per-part contexts.
// Handler receives an object: { scatterType, request, scatterTypeIndex, instanceIndex, partContexts, samplePosition, sampleDimensions }
function iterateScatterInstances(params, handler) {
	const { objectMesh, scatterMultiplier, world, indexSeed, explicitRequests, openFaces } = params;
	if (scatterMultiplier <= 0) return { totalParts: 0, typeCounts: 0, modelCounts: 0 };

	// Choose explicit requests if provided, otherwise use the canonicalized scatter list
	const scatterRequests = explicitRequests.length > 0 ? explicitRequests : objectMesh.detail.scatter;
	
    // If there are no requests, nothing to do
	if (scatterRequests.length === 0) return { totalParts: 0, typeCounts: 0, modelCounts: 0 };

	const minX = objectMesh.worldAabb.min.x;
	const maxX = objectMesh.worldAabb.max.x;
	const minZ = objectMesh.worldAabb.min.z;
	const maxZ = objectMesh.worldAabb.max.z;
	const topY = objectMesh.worldAabb.max.y;
	const width = Math.max(1, maxX - minX);
	const depth = Math.max(1, maxZ - minZ);
	const approxArea = width * depth;
	const scatterScale = Math.max(0.05, world.scatterScale);

	// Pre-filter open faces to those reaching the placement surface (topY), then project each
	// to an XZ AABB. Projecting to XZ makes the overlap test slope-agnostic (crater rim faces
	// are angled, so a vertical ray would under-detect them).
	const openingEpsilon = 0.5;
	const openingAabbsXZ = [];
	for (const face of openFaces) {
		const faceMinY = Math.min(face.a.y, face.b.y, face.c.y);
		const faceMaxY = Math.max(face.a.y, face.b.y, face.c.y);
		if (faceMaxY < topY - openingEpsilon || faceMinY > topY + openingEpsilon) continue;
		openingAabbsXZ.push({
			minX: Math.min(face.a.x, face.b.x, face.c.x), maxX: Math.max(face.a.x, face.b.x, face.c.x),
			minZ: Math.min(face.a.z, face.b.z, face.c.z), maxZ: Math.max(face.a.z, face.b.z, face.c.z),
		});
	}

	let totalParts = 0;
	let globalTypeCount = 0;
	let globalModelCount = 0;

	scatterRequests.forEach((request, scatterTypeIndex) => {
		const scatterType = visualTemplates.scatterTypes[request.typeID];
		const canonicalParts = scatterType.parts.map((part) => {
			return {
				...part,
				dimensions: part.dimensions.clone(),
				localPosition: part.localPosition.clone(),
				localRotation: part.localRotation.clone(),
			};
		});

		const maxCount = Math.max(0, Math.floor((approxArea / 18) * request.density * scatterMultiplier));
		let typeCount = 0;
		let modelCount = 0;

		for (let instanceIndex = 0; instanceIndex < maxCount; instanceIndex++) {
			const seed = indexSeed * 97 + scatterTypeIndex * 59 + instanceIndex * 17;
			const nx = hashNoise(instanceIndex + 1, seed + 2, seed + 11);
			const nz = hashNoise(seed + 3, instanceIndex + 5, seed + 13);

			// Cluster sampling to create natural clumping
			if (hashNoise(nx * 64, nz * 64, seed + 7) < scatterType.clusterThreshold) continue;

			const worldX = minX + nx * width;
			const worldZ = minZ + nz * depth;
			const worldY = topY;

			// Bounds and height checks keep instances inside the parent and within allowed heights
			if (worldX < minX || worldX > maxX || worldZ < minZ || worldZ > maxZ) continue;
			if (worldY < scatterType.heightMin || worldY > scatterType.heightMax) continue;
			if (objectMesh.detailedBounds && !isPointInDetailedBoundsXZ(worldX, worldZ, objectMesh.detailedBounds)) continue;

			// Simple slope estimate filter based on noise to avoid steep placements
			if (Math.abs(Math.sin((worldX + worldZ) * scatterType.noiseScale)) * 0.25 > scatterType.slopeMax) continue;

			const scaleNoise = hashNoise(worldX * 0.5, worldZ * 0.5, seed + 19);
			const uniformScale = (scatterType.scaleRange.min + (scatterType.scaleRange.max - scatterType.scaleRange.min) * scaleNoise) * scatterScale;

			// Compute per-part offsets for stacking / levels and validate spatial fit
			const offsetParts = applyHierarchicalOffsets(canonicalParts, uniformScale);
			if (!areRootPartsWithinParentBounds(offsetParts, worldX, worldZ, uniformScale, seed, minX, maxX, minZ, maxZ)) continue;
			if (isFootprintOverOpening(offsetParts, worldX, worldZ, uniformScale, seed, openingAabbsXZ)) continue;

			const rootPart = resolveRootPart(offsetParts, uniformScale);
			const modelRootY = rootPart ? worldY + getPartHalfHeight(rootPart, uniformScale) - rootPart.stackY : worldY;

			const partContexts = [];
			let samplePosition = null;
			let sampleDimensions = null;

			offsetParts.forEach((part, partIndex) => {
				typeCount++;

				// Calculate World Position
				const position = part.localPosition.clone().add({ x: worldX, y: modelRootY + part.stackY, z: worldZ });

				// Calculate World Rotation
				const rotation = part.localRotation.clone();
				rotation.y += hashNoise(worldX, worldZ, seed + partIndex) * Math.PI * 2;

				// Calculate World Scale
				const scale = ScaleVector3(part.localScale, uniformScale);

				if (!samplePosition) {
					samplePosition = position.clone();
					sampleDimensions = part.dimensions.clone();
					sampleDimensions.set(ScaleVector3(part.dimensions, uniformScale));
				}

				partContexts.push({ part, partIndex, position, rotation, scale });
			});

			if (partContexts.length === 0) continue;

			handler({ scatterType, request, scatterTypeIndex, instanceIndex, partContexts, samplePosition, sampleDimensions });

			modelCount++;
			totalParts += partContexts.length;
		}

		globalTypeCount += typeCount;
		globalModelCount += modelCount;
	});

	return { totalParts, typeCounts: globalTypeCount, modelCounts: globalModelCount };
}

function generateObjectScatter(objectMesh, scatterMultiplier, world, indexSeed, explicitRequests, openFaces) {
	if (scatterMultiplier <= 0) return [];

	const scatterRequests = explicitRequests.length > 0 ? explicitRequests : objectMesh.detail.scatter;
	if ((explicitRequests.length > 0 ? explicitRequests : objectMesh.detail.scatter).length === 0) return [];

	logScatterBounds("Scatter bounds", objectMesh);

	const meshes = [];

	const stats = processScatterModels(
		{ objectMesh, scatterMultiplier, world, indexSeed, explicitRequests, openFaces },
		{
			beginModel: () => meshes.length,
			processPart: (ctx, partContext, partIndex) => {
				const { scatterType, instanceIndex } = ctx;
				const { part, position, rotation, scale } = partContext;
				const { mesh: scatterMesh } = BuildObject(
					{
						id: `${objectMesh.id}-scatter-${scatterType.id}-${instanceIndex}-${partIndex}`,
						shape: part.primitive,
						complexity: part.complexity,
						dimensions: part.dimensions,
						position, rotation, scale,
						pivot: objectMesh.transform.pivot,
						primitiveOptions: part.primitiveOptions,
						texture       : part.texture,
						detail        : { scatter: [] },
						role          : "scatter",
						customTextures: [],
					}
				);

				meshes.push(scatterMesh);
				return scatterMesh.worldAabb;
			},
			finishModel: (ctx, modelAabb, startIndex) => {
				meshes.slice(startIndex).forEach((mesh) => {
					mesh.meta.scatterModelAabb = { min: modelAabb.min.clone(), max: modelAabb.max.clone() };
				});
			},
		}
	);

	// Engine diagnostic: summary of generated scatter
	Log(
		"ENGINE",
		`Scatter diagnostics: source=${objectMesh.id}, models=${stats.modelCounts}, parts=${stats.typeCounts}`,
		"log",
		"Level"
	);

	return meshes;
}

function generateObjectScatterBatches(objectMesh, scatterMultiplier, world, indexSeed, explicitRequests, batchMap, debugBboxAccumulator, openFaces) {
	logScatterBounds("Scatter batch bounds", objectMesh);

	let totalParts = 0;

	const stats = processScatterModels(
		{ objectMesh, scatterMultiplier, world, indexSeed, explicitRequests, openFaces },
		{
			processPart: (ctx, partContext) => {
				const { part, position, rotation, scale } = partContext;
				const modelMatrix = CreateRenderMatrix({ position, rotation, scale, pivot: objectMesh.transform.pivot });
				const color = part.textureColor;
				const textureID = part.textureID;
				const complexity = part.complexity;
				const primitiveOptions = part.primitiveOptions;
				const primitiveKey = primitiveGeometryKey(part.primitive, part.dimensions, complexity, primitiveOptions);

				const scatterBatchKey = (prim, dim, tId, comp, pOptions) => `${prim}_${dim.x}_${dim.y}_${dim.z}_${tId}_${comp}_${pOptions}`;
				const batchKey = scatterBatchKey(part.primitive, part.dimensions, textureID, complexity, primitiveOptions);
				if (!batchMap.has(batchKey)) {
					batchMap.set(batchKey, {
						primitive: part.primitive.toLowerCase(),
						dimensions: part.dimensions.clone(),
						complexity, primitiveOptions, primitiveKey, textureID,
						instances: [],
						instanceCount: 0,
						instanceData: null,
					});
				}

				batchMap.get(batchKey).instances.push({ modelMatrix, tint: [color.r, color.g, color.b, part.textureOpacity] });
				totalParts++;

				const half = part.dimensions.clone().multiply(scale).scale(0.5);
				return {
					min: position.clone().subtract(half),
					max: position.clone().add(half),
				};
			},
			finishModel: (ctx, modelAabb) => {
				debugBboxAccumulator.push({
					type: "Scatter",
					id: `${objectMesh.id}-scatter-${ctx.scatterType.id}-${ctx.instanceIndex}`,
					min: modelAabb.min.clone(),
					max: modelAabb.max.clone(),
				});
			},
		}
	);

	// Engine diagnostic: summary of batch creation
	Log(
		"ENGINE",
		`Scatter batch diagnostics: source=${objectMesh.id}, requestedParts=${stats.typeCounts}, createdParts=${totalParts}`,
		"log",
		"Level"
	);

	return totalParts;
}

function packScatterBatchInstances(batch) {
	const data = new Float32Array(batch.instances.length * 20);

	for (let i = 0; i < batch.instances.length; i++) {
		const instance = batch.instances[i];
		const offset = i * 20;
		const matrix = instance.modelMatrix;

		data[offset + 0] = matrix[0];
		data[offset + 1] = matrix[1];
		data[offset + 2] = matrix[2];
		data[offset + 3] = matrix[3];
		data[offset + 4] = matrix[4];
		data[offset + 5] = matrix[5];
		data[offset + 6] = matrix[6];
		data[offset + 7] = matrix[7];
		data[offset + 8] = matrix[8];
		data[offset + 9] = matrix[9];
		data[offset + 10] = matrix[10];
		data[offset + 11] = matrix[11];
		data[offset + 12] = matrix[12];
		data[offset + 13] = matrix[13];
		data[offset + 14] = matrix[14];
		data[offset + 15] = matrix[15];
		data[offset + 16] = instance.tint[0];
		data[offset + 17] = instance.tint[1];
		data[offset + 18] = instance.tint[2];
		data[offset + 19] = instance.tint[3];
	}

	batch.instanceCount = batch.instances.length;
	batch.instanceData = data;
}

function BuildScatterVisualResources(scatterBatches) {
	const primitiveGeometry = {};

	scatterBatches.forEach((batch) => {
		packScatterBatchInstances(batch);

		if (!primitiveGeometry[batch.primitiveKey]) {
			const geometry = BuildGeometry(batch.primitive, batch.dimensions, batch.complexity, batch.primitiveOptions);
			primitiveGeometry[batch.primitiveKey] = {
				positions: geometry.positions,
				indices: geometry.indices,
				uvs: GenerateUVs(geometry.positions, geometry),
			};
		}
	});

	return primitiveGeometry;
}

const BuildScatter = (p) => generateObjectScatter(p.objectMesh, p.scatterMultiplier, p.world, p.indexSeed, p.explicitScatter, p.openFaces);
const BuildScatterBatches = (p) => generateObjectScatterBatches(p.objectMesh, p.scatterMultiplier, p.world, p.indexSeed, p.explicitScatter, p.batchMap, p.debugBboxAccumulator, p.openFaces);

export { BuildScatter, BuildScatterBatches, BuildScatterVisualResources, GetPerformanceScatterMultiplier };
