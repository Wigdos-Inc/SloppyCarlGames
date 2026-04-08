// NewScatter.js
// Responsibilities:
// - Generate per-object scatter instances and instance batches
// - Preserve Unit/UnitVector3 instances (do not re-instance downstream)
// - Assume payload is canonical (normalized at the boundary); avoid defensive checks
// - Centralize sampling logic in `iterateScatterInstances`

import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { BuildObject, CreateModelMatrix, BuildGeometry, GenerateUVs } from "./NewObject.js";
import { UnitVector3 } from "../math/Utilities.js";
import { RotateByEuler, MultiplyVector3, ScaleVector3, AddVector3, SubtractVector3 } from "../math/Vector3.js";
import visualTemplates from "./templates/textures.json" with { type: "json" };

// Normalize JSON template vectors into UnitVector3 instances
// NO OTHER TYPE OF NORMALISATION IS ALLOWED HERE
(function normalizeVisualTemplates() {
  	const types = visualTemplates.scatterTypes;
  	for (const key in types) {
  	  	types[key].parts.forEach((part) => {
  	  	  	part.dimensions = new UnitVector3(
				part.dimensions.x, 
				part.dimensions.y, 
				part.dimensions.z, 
				"cnu"
			);
  	  	  	part.localPosition = new UnitVector3(
				part.localPosition.x, 
				part.localPosition.y, 
				part.localPosition.z, 
				"cnu"
			);
  	  	  	part.localRotation = new UnitVector3(
				part.localRotation.x, 
				part.localRotation.y, 
				part.localRotation.z, 
				"degrees"
			).toRadians(true);
  	  	});
  	}
})();

function GetPerformanceScatterMultiplier() {
	const level = CONFIG.PERFORMANCE.TerrainScatter;
	if (level === "High") return 1;
	if (level === "Low") return 0;
	return 0.5;
}

function hashNoise(x, z, seed) {
	const value = Math.sin(x * 12.9898 + z * 78.233 + seed * 37.719) * 43758.5453;
	return value - Math.floor(value);
}

function primitiveGeometryKey(primitive, dimensions, complexity, primitiveOptions) {
	const prm = primitive;
	const dim = dimensions;
	return `${prm}_${dim.x}_${dim.y}_${dim.z}_${complexity}_${primitiveOptions}`;
}

function scatterBatchKey(primitive, dimensions, textureID, complexity, primitiveOptions) {
	const prm = primitive;
	const dim = dimensions;
	return `${prm}_${dim.x}_${dim.y}_${dim.z}_${textureID}_${complexity}_${primitiveOptions}`;
}

function mergeAabb(accumulator, bounds) {
	if (!accumulator) {
		return {
			min: bounds.min.clone(),
			max: bounds.max.clone(),
		};
	}

    accumulator.min.set({
        x: Math.min(accumulator.min.x, bounds.min.x),
        y: Math.min(accumulator.min.y, bounds.min.y),
        z: Math.min(accumulator.min.z, bounds.min.z),
    });

    accumulator.max.set({
        x: Math.max(accumulator.max.x, bounds.max.x),
        y: Math.max(accumulator.max.y, bounds.max.y),
        z: Math.max(accumulator.max.z, bounds.max.z),
    });

	return accumulator;
}

// Use shared RotateByEuler from math/Vector3.js for Euler rotation (Y -> X -> Z)

// Compute the half-height (vertical extent / 2) of the part after localRotation is applied.
// Returns value in the same units as `part.dimensions` (CNU) so callers can multiply by uniformScale
function getPartHalfHeight(part, uniformScale) {
	if (part.primitive === "plane") return 0;


	// Columns of rotation matrix = R * basis vectors. We want the Y-row contributions, which
	// are the y components of those columns. Use shared RotateByEuler (Y->X->Z) to rotate basis.
	const colX = RotateByEuler({ x: 1, y: 0, z: 0 }, part.localRotation);
	const colY = RotateByEuler({ x: 0, y: 1, z: 0 }, part.localRotation);
	const colZ = RotateByEuler({ x: 0, y: 0, z: 1 }, part.localRotation);

	const h = ScaleVector3(MultiplyVector3(part.dimensions, part.localScale), uniformScale * 0.5);
	const halfHeight = Math.abs(colX.y) * h.x + Math.abs(colY.y) * h.y + Math.abs(colZ.y) * h.z;
	return Math.max(0, halfHeight);
}

function resolveRootPart(parts, uniformScale) {
	const roots = parts.filter((part) => part.level === 0);
	if (roots.length === 0) return null;

	let selected = roots[0];
	for (let index = 1; index < roots.length; index++) {
		const candidate = roots[index];
		if (candidate.stackY < selected.stackY) {
			selected = candidate;
			continue;
		}

		if (candidate.stackY === selected.stackY) {
			const candidateHeight = getPartHalfHeight(candidate, uniformScale);
			const selectedHeight = getPartHalfHeight(selected, uniformScale);
			if (candidateHeight > selectedHeight) selected = candidate;
		}
	}

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
		const levelParts = partsByLevel.get(level);
		const adjustedParts = levelParts.map((part) => {
			const halfHeight = getPartHalfHeight(part, uniformScale);
			let stackY = halfHeight;

			if (level > 0 && cumulativeTop !== null) stackY += cumulativeTop;

			return {
				...part,
				stackY,
			};
		});

		adjustedByLevel.set(level, adjustedParts);

		let levelTop = null;
		adjustedParts.forEach((part) => {
			const halfHeight = getPartHalfHeight(part, uniformScale);
			const partTop = part.stackY + halfHeight;
			levelTop = levelTop === null ? partTop : Math.max(levelTop, partTop);
		});

		if (levelTop !== null) cumulativeTop = cumulativeTop === null 
			? levelTop 
			: Math.max(cumulativeTop, levelTop);
	});

	return levels.flatMap((level) => adjustedByLevel.get(level));
}

function areRootPartsWithinParentBounds(parts, worldX, worldZ, uniformScale, seed, minX, maxX, minZ, maxZ) {
	if (parts.length === 0) return true;

	for (let partIndex = 0; partIndex < parts.length; partIndex++) {
		const part = parts[partIndex];
		if (part.level !== 0) continue;

		const scaledWidth = part.dimensions.x * part.localScale.x * uniformScale;
		const scaledDepth = part.dimensions.z * part.localScale.z * uniformScale;
		const yawJitter = hashNoise(worldX, worldZ, seed + partIndex) * Math.PI * 2;
		const yaw = part.localRotation.y + yawJitter;
		const cosYaw = Math.abs(Math.cos(yaw));
		const sinYaw = Math.abs(Math.sin(yaw));

		const halfWidth = (scaledWidth * cosYaw + scaledDepth * sinYaw) * 0.5;
		const halfDepth = (scaledWidth * sinYaw + scaledDepth * cosYaw) * 0.5;
		const centerX = worldX + part.localPosition.x;
		const centerZ = worldZ + part.localPosition.z;
		const partMinX = centerX - halfWidth;
		const partMaxX = centerX + halfWidth;
		const partMinZ = centerZ - halfDepth;
		const partMaxZ = centerZ + halfDepth;

		if (partMinX < minX || partMaxX > maxX || partMinZ < minZ || partMaxZ > maxZ) return false;
	}

	return true;
}

// Iterate scatter instances and invoke a handler with pre-computed per-part contexts.
// Handler receives an object: { scatterType, request, scatterTypeIndex, instanceIndex, partContexts, samplePosition, sampleDimensions }
function iterateScatterInstances(params, handler) {
	const { objectMesh, scatterMultiplier, world, indexSeed, explicitRequests } = params;
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

	let totalParts = 0;
	let globalTypeCount = 0;
	let globalModelCount = 0;

	scatterRequests.forEach((request, scatterTypeIndex) => {
		const scatterType = visualTemplates.scatterTypes[request.typeID];
		const canonicalParts = scatterType.parts.map((part) => {
			const dim = part.dimensions.clone();
			const pos = part.localPosition.clone();
			const rot = part.localRotation.clone();

			return {
				...part,
				dimensions: dim,
				localPosition: pos,
				localRotation: rot,
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
			const cluster = hashNoise(nx * 64, nz * 64, seed + 7);
			if (cluster < scatterType.clusterThreshold) continue;

			const worldX = minX + nx * width;
			const worldZ = minZ + nz * depth;
			const worldY = topY;

			// Bounds and height checks keep instances inside the parent and within allowed heights
			if (worldX < minX || worldX > maxX || worldZ < minZ || worldZ > maxZ) continue;
			if (worldY < scatterType.heightMin || worldY > scatterType.heightMax) continue;

			// Simple slope estimate filter based on noise to avoid steep placements
			const slopeEstimate = Math.abs(Math.sin((worldX + worldZ) * scatterType.noiseScale)) * 0.25;
			if (slopeEstimate > scatterType.slopeMax) continue;

			const scaleNoise = hashNoise(worldX * 0.5, worldZ * 0.5, seed + 19);
			const uniformScale = (scatterType.scaleRange.min + (scatterType.scaleRange.max - scatterType.scaleRange.min) * scaleNoise) * scatterScale;

			// Compute per-part offsets for stacking / levels and validate spatial fit
			const offsetParts = applyHierarchicalOffsets(canonicalParts, uniformScale);
			if (!areRootPartsWithinParentBounds(offsetParts, worldX, worldZ, uniformScale, seed, minX, maxX, minZ, maxZ)) continue;

			const rootPart = resolveRootPart(offsetParts, uniformScale);
			const modelRootY = rootPart
				? worldY + getPartHalfHeight(rootPart, uniformScale) - rootPart.stackY
				: worldY;

			const partContexts = [];
			let samplePosition = null;
			let sampleDimensions = null;

			offsetParts.forEach((part, partIndex) => {
				typeCount++;

				// Calculate World Position
				const addPos = { x: worldX, y: modelRootY + part.stackY, z: worldZ };
				const pos = part.localPosition.clone().add(addPos);

				// Calculate World Rotation
				const rot = part.localRotation.clone();
				rot.y += hashNoise(worldX, worldZ, seed + partIndex) * Math.PI * 2;

				// Calculate World Scale
				const scale = ScaleVector3(part.localScale, uniformScale);

				if (!samplePosition) {
					samplePosition = pos.clone();
					sampleDimensions = part.dimensions.clone();
					sampleDimensions.set(ScaleVector3(part.dimensions, uniformScale));
				}

				partContexts.push({ part, partIndex, pos, rot, scale });
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

function generateObjectScatter(objectMesh, scatterMultiplier, world, indexSeed, explicitRequests) {
	if (scatterMultiplier <= 0) return [];

	const scatterRequests = explicitRequests.length > 0 ? explicitRequests : objectMesh.detail.scatter;
	if (scatterRequests.length === 0) return [];

	// Engine diagnostic: report scatter bounds for this source object
	const minX = objectMesh.worldAabb.min.x;
	const maxX = objectMesh.worldAabb.max.x;
	const minZ = objectMesh.worldAabb.min.z;
	const maxZ = objectMesh.worldAabb.max.z;
	Log(
		"ENGINE",
		`Scatter bounds: source=${objectMesh.id}, minX=${minX.toFixed(2)}, maxX=${maxX.toFixed(2)}, minZ=${minZ.toFixed(2)}, maxZ=${maxZ.toFixed(2)}`,
		"log",
		"Level"
	);

	const meshes = [];

	const stats = iterateScatterInstances({ objectMesh, scatterMultiplier, world, indexSeed, explicitRequests }, (ctx) => {
		const { scatterType, instanceIndex, partContexts } = ctx;
		let modelAabb = null;
		const startIndex = meshes.length;

		partContexts.forEach(({ part, pos, rot, scale }, partIndex) => {
			const scatterMesh = BuildObject(
				{
					id: `${objectMesh.id}-scatter-${scatterType.id}-${instanceIndex}-${partIndex}`,
					shape: part.primitive,
					complexity: part.complexity,
					dimensions: part.dimensions,
					position: pos,
					rotation: rot,
					scale: scale,
					pivot: objectMesh.transform.pivot,
					primitiveOptions: part.primitiveOptions,
					texture: part.texture,
					detail: { scatter: [] },
					role: "scatter",
				},
				{ role: "scatter" }
			);

			modelAabb = mergeAabb(modelAabb, scatterMesh.worldAabb);
			meshes.push(scatterMesh);
		});

		if (modelAabb) {
			for (let i = startIndex; i < meshes.length; i++) {
				const mesh = meshes[i];
				mesh.meta.scatterModelAabb = { min: { ...modelAabb.min }, max: { ...modelAabb.max } };
			}
		}
	});

	// Engine diagnostic: summary of generated scatter
	Log(
		"ENGINE",
		`Scatter diagnostics: source=${objectMesh.id}, models=${stats.modelCounts}, parts=${stats.typeCounts}`,
		"log",
		"Level"
	);

	return meshes;
}

function generateObjectScatterBatches(objectMesh, scatterMultiplier, world, indexSeed, explicitRequests, batchMap, debugBboxAccumulator) {
	// Engine diagnostic: report scatter bounds for batching
	const minX = objectMesh.worldAabb.min.x;
	const maxX = objectMesh.worldAabb.max.x;
	const minZ = objectMesh.worldAabb.min.z;
	const maxZ = objectMesh.worldAabb.max.z;

	Log(
		"ENGINE",
		`Scatter batch bounds: source=${objectMesh.id}, minX=${minX.toFixed(2)}, maxX=${maxX.toFixed(2)}, minZ=${minZ.toFixed(2)}, maxZ=${maxZ.toFixed(2)}`,
		"log",
		"Level"
	);

	let totalParts = 0;

	const stats = iterateScatterInstances({ objectMesh, scatterMultiplier, world, indexSeed, explicitRequests }, (ctx) => {
		const { scatterType, instanceIndex, partContexts } = ctx;
		let modelAabbMin = null;
		let modelAabbMax = null;

		partContexts.forEach(({ part, pos, rot, scale }) => {
			const modelMatrix = CreateModelMatrix({ position: pos, rotation: rot, scale: scale, pivot: objectMesh.transform.pivot });
			const color = part.textureColor;
			const opacity = part.textureOpacity;
			const textureID = part.textureID;
			const complexity = part.complexity;
			const primitiveOptions = part.primitiveOptions;
			const primitiveKey = primitiveGeometryKey(part.primitive, part.dimensions, complexity, primitiveOptions);

			const batchKey = scatterBatchKey(part.primitive, part.dimensions, textureID, complexity, primitiveOptions);
			if (!batchMap.has(batchKey)) {
				batchMap.set(batchKey, {
					primitive: part.primitive.toLowerCase(),
					dimensions: { ...part.dimensions },
					complexity: complexity,
					primitiveOptions: primitiveOptions,
					primitiveKey: primitiveKey,
					textureID: textureID,
					instances: [],
					instanceCount: 0,
					instanceData: null,
				});
			}

			batchMap.get(batchKey).instances.push({ modelMatrix: modelMatrix, tint: [color.r, color.g, color.b, opacity] });
			totalParts += 1;

			const half = ScaleVector3(MultiplyVector3(part.dimensions, scale), 0.5);
			const pMin = SubtractVector3(pos, half);
			const pMax = AddVector3(pos, half);
			if (!modelAabbMin) {
				modelAabbMin = { ...pMin };
				modelAabbMax = { ...pMax };
			} 
			else {
				modelAabbMin.x = Math.min(modelAabbMin.x, pMin.x);
				modelAabbMin.y = Math.min(modelAabbMin.y, pMin.y);
				modelAabbMin.z = Math.min(modelAabbMin.z, pMin.z);
				modelAabbMax.x = Math.max(modelAabbMax.x, pMax.x);
				modelAabbMax.y = Math.max(modelAabbMax.y, pMax.y);
				modelAabbMax.z = Math.max(modelAabbMax.z, pMax.z);
			}
		});

		if (modelAabbMin) {
			debugBboxAccumulator.push({ 
				type: "Scatter", 
				id: `${objectMesh.id}-scatter-${scatterType.id}-${instanceIndex}`,
				min: { ...modelAabbMin }, 
				max: { ...modelAabbMax } 
			});
		}
	});

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
	const instanceCount = batch.instances.length;
	const data = new Float32Array(instanceCount * 20);

	for (let i = 0; i < instanceCount; i++) {
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

	batch.instanceCount = instanceCount;
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

function BuildScatter(payload) {
	return generateObjectScatter(payload.objectMesh, payload.scatterMultiplier, payload.world, payload.indexSeed, payload.explicitScatter);
}

function BuildScatterBatches(payload) {
	generateObjectScatterBatches(payload.objectMesh, payload.scatterMultiplier, payload.world, payload.indexSeed, payload.explicitScatter, payload.batchMap, payload.debugBboxAccumulator);
	return payload.batchMap;
}

export { BuildScatter, BuildScatterBatches, BuildScatterVisualResources, GetPerformanceScatterMultiplier };
