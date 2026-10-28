// Generates scatter instances on objects and batches them for instanced drawing.

// Used by NewObject.js to add scatter to an object.
// Used by NewLevel.js to build scatter batches and their visual resources.
// Uses NewObject.js and NewPrimitive.js to build scatter geometry
// Uses NewTexture.js to key scatter's textures.

import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { CreateRenderMatrix } from "../math/Matrix.js";
import { BuildObject, GenerateUVs } from "./NewObject.js";
import { BuildGeometry } from "./NewPrimitive.js";
import { ComputeGeneratedTextureID, ComputeCustomTextureSignature, InitializeDecalDisplay } from "./NewTexture.js";
import { RotateByEuler, MultiplyVector3, ScaleVector3, CloneVector3, WORLD_NORMALS, DotVector3, AbsoluteVector3 } from "../math/Vector3.js";
import visualTemplates from "./templates/textures.json" with { type: "json" };

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

function primitiveGeometryKey(prim, dim, comp, primOptions) {
	return `${prim}_${dim.x}_${dim.y}_${dim.z}_${comp}_${JSON.stringify(primOptions)}`;
}

// A quality-tiered field is an object keyed low/medium/high; anything else is a constant.
const resolveTier = (value, tier) => (value.low === undefined ? value : value[tier]);

// Field-wise decal clone, mirroring cloneTexture in NewTemplate.js
function cloneScatterDecal(decal) {
	return {
		...decal,
		localTransform: {
			position: decal.localTransform.position.clone(),
			rotation: decal.localTransform.rotation.clone(),
			scale   : CloneVector3(decal.localTransform.scale),
		},
	};
}

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

// Half the part's height after localRotation, scaled by uniformScale.
function getPartHalfHeight(part, uniformScale) {
	// How much each rotated axis points up.
	const col = {
		x: RotateByEuler(WORLD_NORMALS.Right, part.localRotation).y,
		y: RotateByEuler(WORLD_NORMALS.Up, part.localRotation).y,
		z: RotateByEuler(WORLD_NORMALS.Forward, part.localRotation).y
	}

	const h = ScaleVector3(MultiplyVector3(part.dimensions, part.localScale), uniformScale * 0.5);
	return Math.max(0, DotVector3(AbsoluteVector3(col), h));
}

function resolveRootPart(parts, uniformScale) {
	const roots = parts.filter((part) => part.level === 0);
	if (roots.length === 0) return null;

	let selected = roots[0];
	roots.forEach(candidate => {
		if (candidate.stackY < selected.stackY) {
			selected = candidate;
			return;
		}
		if (candidate.stackY === selected.stackY) {
			if (getPartHalfHeight(candidate, uniformScale) > getPartHalfHeight(selected, uniformScale)) selected = candidate;
		}
	});

	return selected;
}

// Compute stack positions from part levels. localPosition is added afterwards as a per-part offset.
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

// Rotated XZ footprint box of a root part around the sample center. Shared by the parent-bounds and opening checks.
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

// Reject scatter samples that intersect an opening.
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

// Place each scatter instance and hand its per-part placements to handler, one call per instance.
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

	// Open faces reaching topY, projected to XZ AABBs (slope-agnostic overlap test).
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

	const qualityTier = CONFIG.Performance.Scatter.Quality.toLowerCase();

	scatterRequests.forEach((request, scatterTypeIndex) => {
		const scatterType = visualTemplates.scatterTypes[request.typeID];
		const canonicalParts = scatterType.parts.map((part) => {
			return {
				...part,
				primitive: resolveTier(part.primitive, qualityTier),
				dimensions: resolveTier(part.dimensions, qualityTier).clone(),
				localPosition: resolveTier(part.localPosition, qualityTier).clone(),
				localRotation: resolveTier(part.localRotation, qualityTier).clone(),
				localScale: resolveTier(part.localScale, qualityTier),
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
	if (scatterRequests.length === 0) return [];

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

	// Log a summary of the generated scatter.
	Log(
		"ENGINE",
		`
			Scatter diagnostics: 
			- Source=${objectMesh.id}
			- Models=${stats.modelCounts}
			- Parts=${stats.typeCounts}
		`,
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
				const textureID = ComputeGeneratedTextureID(part.texture.generated);
				const primitiveKey = primitiveGeometryKey(part.primitive, part.dimensions, part.complexity, part.primitiveOptions);
				const batchKey = `${primitiveKey}_${textureID}_${ComputeCustomTextureSignature(part.texture.custom)}`;
				if (!batchMap.has(batchKey)) {
					const customTextures = part.texture.custom.map(cloneScatterDecal);
					InitializeDecalDisplay(customTextures, part.dimensions);
					batchMap.set(batchKey, {
						primitive: part.primitive.toLowerCase(),
						dimensions: part.dimensions.clone(),
						complexity: part.complexity, primitiveOptions: part.primitiveOptions, primitiveKey, textureID,
						texture: part.texture.generated,
						customTextures,
						instances: [],
						instanceCount: 0,
						instanceData: null,
					});
				}

				const modelMatrix = CreateRenderMatrix({ position, rotation, scale, pivot: objectMesh.transform.pivot });
				batchMap.get(batchKey).instances.push({ modelMatrix, tint: [1, 1, 1, 1] });
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

	Log(
		"ENGINE",
		`
			Scatter batch diagnostics: 
			- Source=${objectMesh.id}
			- RequestedParts=${stats.typeCounts}
			- CreatedParts=${totalParts}`,
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
		for (let add = 0; add < 20; add++) data[offset + add] = add <= 15 ? instance.modelMatrix[add] : instance.tint[add - 16];
	}

	batch.instanceCount = batch.instances.length;
	batch.instanceData  = data;
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

export { BuildScatter, BuildScatterBatches, BuildScatterVisualResources };
