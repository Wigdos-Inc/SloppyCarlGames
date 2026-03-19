import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { AddVector3 } from "../math/Vector3.js";
import { CreateModelMatrix } from "./NewObject.js";
import { Unit, UnitVector3 } from "../math/Utilities.js";
import visualTemplates from "./templates/textures.json" with { type: "json" };

// NewScatter.js
// Responsibilities:
// - Generate per-object scatter instances and instance batches
// - Preserve Unit/UnitVector3 instances (do not re-instance downstream)
// - Assume payload is canonical (normalized at the boundary); avoid defensive checks
// - Centralize sampling logic in `iterateScatterInstances`

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

function getPartHalfHeight(part) {
	if (part.primitive.toLowerCase() === "plane") return 0;
	return Math.max(0, part.dimensions.y * part.localScale.y * 0.5);
}

function resolveRootPart(parts) {
	if (parts.length === 0) return null;

	const roots = parts.filter((part) => part.level === 0);
	if (roots.length === 0) return null;

	let selected = roots[0];
	for (let index = 1; index < roots.length; index += 1) {
		const candidate = roots[index];
		if (candidate.localPosition.y < selected.localPosition.y) {
			selected = candidate;
			continue;
		}

		if (candidate.localPosition.y === selected.localPosition.y) {
			const candidateHeight = getPartHalfHeight(candidate);
			const selectedHeight = getPartHalfHeight(selected);
			if (candidateHeight > selectedHeight) {
				selected = candidate;
			}
		}
	}

	return selected;
}

// Applies hierarchical Y-offsets to scatter model parts based on their level and scaling.
function applyHierarchicalOffsets(parts, uniformScale) {
	if (parts.length === 0) return parts;

	// Sort parts by level ascending
	const sortedParts = [...parts].sort((a, b) => a.level - b.level);
	let offsetTally = 0;

	return sortedParts.map((part) => {
		const oldY = part.dimensions.y * part.localScale.y;
		const newY = oldY * uniformScale;
		const offset = (newY - oldY) / 2;
		const newLocalPosition = part.localPosition.clone();
        if (part.level > 0) newLocalPosition.y += offset + offsetTally;

		offsetTally += offset;
		return {
			...part,
			localPosition: newLocalPosition,
		};
	});
}

function areRootPartsWithinParentBounds(parts, worldX, worldZ, uniformScale, seed, minX, maxX, minZ, maxZ) {
	if (parts.length === 0) return true;

	for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
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
	const scatterRequests = (explicitRequests && explicitRequests.length > 0) ? explicitRequests : objectMesh.detail.scatter;
	
    // If there are no requests, nothing to do
	if (scatterRequests.length === 0) return { totalParts: 0, typeCounts: 0, modelCounts: 0 };

	const topY = objectMesh.transform.position.y + (objectMesh.dimensions.y * objectMesh.transform.scale.y) * 0.5;
	const width = Math.max(1, objectMesh.dimensions.x * objectMesh.transform.scale.x);
	const depth = Math.max(1, objectMesh.dimensions.z * objectMesh.transform.scale.z);
	const approxArea = width * depth;
	const minX = objectMesh.transform.position.x - width * 0.5;
	const maxX = objectMesh.transform.position.x + width * 0.5;
	const minZ = objectMesh.transform.position.z - depth * 0.5;
	const maxZ = objectMesh.transform.position.z + depth * 0.5;
	const scatterScale = Math.max(0.05, world.scatterScale);

	let totalParts = 0;
	let globalTypeCount = 0;
	let globalModelCount = 0;

	scatterRequests.forEach((request, scatterTypeIndex) => {
		const scatterType = visualTemplates.scatterTypes[request.typeID];

		// Create Unit/UnitVector3 Instances
		scatterType.parts.forEach(part => {
			const dim = part.dimensions;
			const pos = part.localPosition;
			const rot = part.localRotation;
			part.dimensions    = new UnitVector3(dim.x, dim.y, dim.z, "cnu");
			part.localPosition = new UnitVector3(pos.x, pos.y, pos.z, "cnu");
			part.localRotation = new UnitVector3(rot.x, rot.y, rot.z, "cnu")
		});

		const maxCount = Math.max(0, Math.floor((approxArea / 18) * request.density * scatterMultiplier));
		let typeCount = 0;
		let modelCount = 0;

		for (let instanceIndex = 0; instanceIndex < maxCount; instanceIndex += 1) {
			const seed = indexSeed * 97 + scatterTypeIndex * 59 + instanceIndex * 17;
			const nx = hashNoise(instanceIndex + 1, seed + 2, seed + 11);
			const nz = hashNoise(seed + 3, instanceIndex + 5, seed + 13);

			// Cluster sampling to create natural clumping
			const cluster = hashNoise(nx * 64, nz * 64, seed + 7);
			if (cluster < scatterType.clusterThreshold) continue;

			const worldX = objectMesh.transform.position.x - width * 0.5 + nx * width;
			const worldZ = objectMesh.transform.position.z - depth * 0.5 + nz * depth;
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
			const offsetParts = applyHierarchicalOffsets(scatterType.parts, uniformScale);
			if (!areRootPartsWithinParentBounds(offsetParts, worldX, worldZ, uniformScale, seed, minX, maxX, minZ, maxZ)) continue;

			const rootPart = resolveRootPart(offsetParts);
			const modelRootY = rootPart
				? worldY + getPartHalfHeight(rootPart) * uniformScale - rootPart.localPosition.y
				: worldY;

			const partContexts = [];
			let samplePosition = null;
			let sampleDimensions = null;

			offsetParts.forEach((part, partIndex) => {
				typeCount += 1;
				const finalY = modelRootY + part.localPosition.y;

                // Calculate World Position, Rotation & Scale
                const pos = part.localPosition.clone();
				pos.set(AddVector3(pos, { x: worldX, y: finalY, z: worldZ }));

				const rot = part.localRotation.clone();
				rot.y += hashNoise(worldX, worldZ, seed + partIndex) * Math.PI * 2;

				const scale = {
					x: part.localScale.x * uniformScale,
					y: part.localScale.y * uniformScale,
					z: part.localScale.z * uniformScale,
				};

				if (!samplePosition) {
					samplePosition = pos.clone();
					sampleDimensions = {
						x: part.dimensions.x * uniformScale,
						y: part.dimensions.y * uniformScale,
						z: part.dimensions.z * uniformScale,
					};
				}

				partContexts.push({ part, partIndex, pos, rot, scale });
			});

			if (partContexts.length === 0) continue;

			handler({ scatterType, request, scatterTypeIndex, instanceIndex, partContexts, samplePosition, sampleDimensions });

			modelCount += 1;
			totalParts += partContexts.length;
		}

		globalTypeCount += typeCount;
		globalModelCount += modelCount;
	});

	return { totalParts, typeCounts: globalTypeCount, modelCounts: globalModelCount };
}

function generateObjectScatter(objectMesh, scatterMultiplier, world, indexSeed, explicitRequests, buildObject) {
	if (scatterMultiplier <= 0) return [];

	const scatterRequests = (explicitRequests.length > 0) ? explicitRequests : objectMesh.detail.scatter;
	if (scatterRequests.length === 0) return [];

	// Engine diagnostic: report scatter bounds for this source object
	const width = Math.max(1, objectMesh.dimensions.x * objectMesh.transform.scale.x);
	const depth = Math.max(1, objectMesh.dimensions.z * objectMesh.transform.scale.z);
	const minX = objectMesh.transform.position.x - width * 0.5;
	const maxX = objectMesh.transform.position.x + width * 0.5;
	const minZ = objectMesh.transform.position.z - depth * 0.5;
	const maxZ = objectMesh.transform.position.z + depth * 0.5;
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
			const scatterMesh = buildObject(
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
			for (let i = startIndex; i < meshes.length; i += 1) {
				const mesh = meshes[i];
				mesh.meta = mesh.meta || {};
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
	const topY = objectMesh.transform.position.y + (objectMesh.dimensions.y * objectMesh.transform.scale.y) * 0.5;
	const width = Math.max(1, objectMesh.dimensions.x * objectMesh.transform.scale.x);
	const depth = Math.max(1, objectMesh.dimensions.z * objectMesh.transform.scale.z);
	const minX = objectMesh.transform.position.x - width * 0.5;
	const maxX = objectMesh.transform.position.x + width * 0.5;
	const minZ = objectMesh.transform.position.z - depth * 0.5;
	const maxZ = objectMesh.transform.position.z + depth * 0.5;

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

			const batchKey = `${part.primitive.toLowerCase()}_${part.dimensions.x}_${part.dimensions.y}_${part.dimensions.z}_${textureID}_${complexity}`;
			if (!batchMap.has(batchKey)) {
				batchMap.set(batchKey, {
					primitive: part.primitive.toLowerCase(),
					dimensions: { ...part.dimensions },
					complexity: complexity,
					textureID: textureID,
					instances: [],
				});
			}

			batchMap.get(batchKey).instances.push({ modelMatrix: modelMatrix, tint: [color.r, color.g, color.b, opacity] });
			totalParts += 1;

			const hx = (part.dimensions.x * scale.x) * 0.5;
			const hy = (part.dimensions.y * scale.y) * 0.5;
			const hz = (part.dimensions.z * scale.z) * 0.5;
			const pMin = { x: pos.x - hx, y: pos.y - hy, z: pos.z - hz };
			const pMax = { x: pos.x + hx, y: pos.y + hy, z: pos.z + hz };
			if (!modelAabbMin) {
				modelAabbMin = { ...pMin };
				modelAabbMax = { ...pMax };
			} else {
				modelAabbMin.x = Math.min(modelAabbMin.x, pMin.x);
				modelAabbMin.y = Math.min(modelAabbMin.y, pMin.y);
				modelAabbMin.z = Math.min(modelAabbMin.z, pMin.z);
				modelAabbMax.x = Math.max(modelAabbMax.x, pMax.x);
				modelAabbMax.y = Math.max(modelAabbMax.y, pMax.y);
				modelAabbMax.z = Math.max(modelAabbMax.z, pMax.z);
			}
		});

		if (modelAabbMin) {
			debugBboxAccumulator.push({ type: "Scatter", id: `${objectMesh.id}-scatter-${scatterType.id}-${instanceIndex}`, min: { ...modelAabbMin }, max: { ...modelAabbMax } });
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

function BuildScatter(payload) {
	return generateObjectScatter(payload.objectMesh, payload.scatterMultiplier, payload.world, payload.indexSeed, payload.explicitScatter, payload.buildObject);
}

function BuildScatterBatches(payload) {
	generateObjectScatterBatches(payload.objectMesh, payload.scatterMultiplier, payload.world, payload.indexSeed, payload.explicitScatter, payload.batchMap, payload.debugBboxAccumulator);
	return payload.batchMap;
}

export { BuildScatter, BuildScatterBatches, GetPerformanceScatterMultiplier };
