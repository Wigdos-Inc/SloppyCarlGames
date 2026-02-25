import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";
import { normalizeVector3 } from "../math/Vector3.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function GetPerformanceScatterMultiplier() {
	const level = CONFIG && CONFIG.PERFORMANCE ? CONFIG.PERFORMANCE.TerrainScatter : "Medium";
	if (level === "High") {
		return 1;
	}
	if (level === "Low") {
		return 0;
	}
	return 0.5;
}

function hashNoise(x, z, seed) {
	const value = Math.sin(x * 12.9898 + z * 78.233 + seed * 37.719) * 43758.5453;
	return value - Math.floor(value);
}

function mergeAabb(accumulator, bounds) {
	if (!bounds || !bounds.min || !bounds.max) {
		return accumulator;
	}

	if (!accumulator) {
		return {
			min: { ...bounds.min },
			max: { ...bounds.max },
		};
	}

	return {
		min: {
			x: Math.min(accumulator.min.x, bounds.min.x),
			y: Math.min(accumulator.min.y, bounds.min.y),
			z: Math.min(accumulator.min.z, bounds.min.z),
		},
		max: {
			x: Math.max(accumulator.max.x, bounds.max.x),
			y: Math.max(accumulator.max.y, bounds.max.y),
			z: Math.max(accumulator.max.z, bounds.max.z),
		},
	};
}

function getPartHalfHeight(part) {
	const primitive = typeof part.primitive === "string" ? part.primitive.toLowerCase() : "cube";
	if (primitive === "plane") {
		return 0;
	}

	return Math.max(0, part.dimensions.y * part.localScale.y * 0.5);
}

function resolveRootPart(parts) {
	if (!Array.isArray(parts) || parts.length === 0) {
		return null;
	}

	const roots = parts.filter((part) => part && part.level === 0);
	if (roots.length === 0) {
		return null;
	}

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

function ResolveScatterType(templateRegistry, scatterTypeID) {
	if (!templateRegistry || !templateRegistry.scatterTypes || !scatterTypeID) {
		return null;
	}

	const definition = templateRegistry.scatterTypes[scatterTypeID];
	if (!definition || typeof definition !== "object") {
		return null;
	}

	const scaleRange = definition.scaleRange && typeof definition.scaleRange === "object"
		? definition.scaleRange
		: { min: 1, max: 1 };

	 return {
		...definition,
		noiseScale: Number.isFinite(definition.noiseScale) ? definition.noiseScale : 0.1,
		heightMin: Number.isFinite(definition.heightMin) ? definition.heightMin : -Infinity,
		heightMax: Number.isFinite(definition.heightMax) ? definition.heightMax : Infinity,
		slopeMax: Number.isFinite(definition.slopeMax) ? definition.slopeMax : 1,
		scaleRange: {
			min: Number.isFinite(scaleRange.min) ? scaleRange.min : 1,
			max: Number.isFinite(scaleRange.max) ? scaleRange.max : 1,
		},
		parts: Array.isArray(definition.parts)
			? definition.parts.map((part) => {
				const texture = part && part.texture && typeof part.texture === "object" ? part.texture : null;
				return {
					...part,
					dimensions: normalizeVector3(part.dimensions, { x: 0.5, y: 0.5, z: 0.5 }),
					localPosition: normalizeVector3(part.localPosition, { x: 0, y: 0, z: 0 }),
					localRotation: normalizeVector3(part.localRotation, { x: 0, y: 0, z: 0 }),
					localScale: normalizeVector3(part.localScale, { x: 1, y: 1, z: 1 }),
					texture: texture,
					textureID: texture && texture.textureID ? texture.textureID : part.textureID,
					textureColor: texture && texture.color ? texture.color : part.textureColor,
					textureOpacity: texture && typeof texture.opacity === "number" ? texture.opacity : part.textureOpacity,
				};
			})
			: [],
	};
}

function normalizeScatterRequests(entries) {
	if (!Array.isArray(entries)) {
		return [];
	}

	return entries
		.map((entry) => {
			if (!entry || typeof entry.typeID !== "string" || entry.typeID.length === 0) {
				return null;
			}
			return {
				typeID: entry.typeID,
				density: Math.max(0, toNumber(entry.density, 0)),
			};
		})
		.filter(Boolean);
}

function resolveObjectScatterRequests(mesh, explicitRequests) {
	const explicit = normalizeScatterRequests(explicitRequests);
	if (explicit.length > 0) {
		return explicit;
	}

	if (!mesh || !mesh.detail || !Array.isArray(mesh.detail.scatter)) {
		return [];
	}

	return normalizeScatterRequests(mesh.detail.scatter);
}

// Applies hierarchical Y-offsets to scatter model parts based on their level and scaling
function applyHierarchicalOffsets(parts, uniformScale) {
	if (!Array.isArray(parts) || parts.length === 0) return parts;

	// Sort parts by level ascending
	const sortedParts = [...parts].sort((a, b) => a.level - b.level);
	let offsetTally = 0;

	// Clone parts to avoid mutating originals
	const updatedParts = sortedParts.map((part) => {
		const oldY = part.dimensions.y * part.localScale.y;
		const newY = oldY * uniformScale;
		let offset = (newY - oldY) / 2;

		// Apply offset to non-root parts
		let newLocalPosition = { ...part.localPosition };
		if (part.level > 0) newLocalPosition.y = part.localPosition.y + offset + offsetTally;
		else newLocalPosition.y = part.localPosition.y;
		
		offsetTally += offset;
		return {
			...part,
			localPosition: newLocalPosition
		};
	});
	return updatedParts;
}

function generateObjectScatter(objectMesh, scatterDefinitions, scatterMultiplier, world, indexSeed, explicitRequests, buildObject) {
	if (scatterMultiplier <= 0) {
		return [];
	}

	if (typeof buildObject !== "function") {
		return [];
	}

	if (!objectMesh || !objectMesh.transform || !objectMesh.dimensions) {
		return [];
	}

	const scatterRequests = resolveObjectScatterRequests(objectMesh, explicitRequests);
	if (scatterRequests.length === 0) {
		return [];
	}

	const topY = objectMesh.transform.position.y + (objectMesh.dimensions.y * objectMesh.transform.scale.y) * 0.5;
	const width = Math.max(1, objectMesh.dimensions.x * objectMesh.transform.scale.x);
	const depth = Math.max(1, objectMesh.dimensions.z * objectMesh.transform.scale.z);
	const approxArea = width * depth;
	const minX = (objectMesh.transform.position.x - width * 0.5);
	const maxX = (objectMesh.transform.position.x + width * 0.5);
	const minZ = (objectMesh.transform.position.z - depth * 0.5);
	const maxZ = (objectMesh.transform.position.z + depth * 0.5);
	const positionThreshold = 100000;
	const scatterScale = Math.max(0.05, toNumber(world && world.scatterScale, 1));

	Log(
		"ENGINE",
		`Scatter bounds: source=${objectMesh.id}, minX=${minX.toFixed(2)}, maxX=${maxX.toFixed(2)}, minZ=${minZ.toFixed(2)}, maxZ=${maxZ.toFixed(2)}`,
		"log",
		"Level"
	);

	const scatterMeshes = [];
	scatterRequests.forEach((request, scatterTypeIndex) => {
		const scatterType = ResolveScatterType(scatterDefinitions, request.typeID);
		if (!scatterType || !Array.isArray(scatterType.parts) || scatterType.parts.length === 0) {
			return;
		}

		const maxCount = Math.max(0, Math.floor((approxArea / 18) * request.density * scatterMultiplier));
		let typeCount = 0;
		let samplePosition = null;
		let sampleDimensions = null;
		let modelCount = 0;

		for (let instanceIndex = 0; instanceIndex < maxCount; instanceIndex += 1) {
			const seed = indexSeed * 97 + scatterTypeIndex * 59 + instanceIndex * 17;
			const nx = hashNoise(instanceIndex + 1, seed + 2, seed + 11);
			const nz = hashNoise(seed + 3, instanceIndex + 5, seed + 13);
			const clusterThreshold = typeof scatterType.clusterThreshold === "number" ? scatterType.clusterThreshold : 0.4;
			const cluster = hashNoise(nx * 64, nz * 64, seed + 7);
			if (cluster < clusterThreshold) {
				continue;
			}

			const worldX = objectMesh.transform.position.x - width * 0.5 + nx * width;
			const worldZ = objectMesh.transform.position.z - depth * 0.5 + nz * depth;
			const worldY = topY;

			if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)) {
				Log("ENGINE", `Scatter position invalid (NaN/Infinity): type=${scatterType.id}`, "warn", "Level");
				continue;
			}

			if (Math.abs(worldX) > positionThreshold || Math.abs(worldY) > positionThreshold || Math.abs(worldZ) > positionThreshold) {
				Log("ENGINE", `Scatter position out of range: type=${scatterType.id} pos=(${worldX}, ${worldY}, ${worldZ})`, "warn", "Level");
				continue;
			}

			if (worldX < minX || worldX > maxX || worldZ < minZ || worldZ > maxZ) {
				Log("ENGINE", `Scatter position outside mesh bounds: type=${scatterType.id}`, "warn", "Level");
				continue;
			}

			if (worldY < scatterType.heightMin || worldY > scatterType.heightMax) {
				continue;
			}

			const slopeEstimate = Math.abs(Math.sin((worldX + worldZ) * scatterType.noiseScale)) * 0.25;
			if (slopeEstimate > scatterType.slopeMax) {
				continue;
			}

			const scaleNoise = hashNoise(worldX * 0.5, worldZ * 0.5, seed + 19);
			const uniformScale = (scatterType.scaleRange.min + (scatterType.scaleRange.max - scatterType.scaleRange.min) * scaleNoise) * scatterScale;
			const rootPart = resolveRootPart(scatterType.parts);
			const modelRootY = rootPart
				? worldY + getPartHalfHeight(rootPart) * uniformScale - rootPart.localPosition.y
				: worldY;
			let modelAabb = null;

			// Apply hierarchical offsets to parts for this instance
			const offsetParts = applyHierarchicalOffsets(scatterType.parts, uniformScale);

			offsetParts.forEach((part, partIndex) => {
				typeCount += 1;
				const finalScaleBoost = 1;
				const finalY = modelRootY + part.localPosition.y;

				if (!samplePosition) {
					samplePosition = { x: worldX, y: finalY, z: worldZ };
					sampleDimensions = {
						x: part.dimensions.x * uniformScale * finalScaleBoost,
						y: part.dimensions.y * uniformScale * finalScaleBoost,
						z: part.dimensions.z * uniformScale * finalScaleBoost,
					};
				}

				const scatterMesh = buildObject(
					{
						id: `${objectMesh.id}-scatter-${scatterType.id}-${instanceIndex}-${partIndex}`,
						primitive: part.primitive,
						dimensions: part.dimensions,
						position: {
							x: worldX + part.localPosition.x,
							y: finalY,
							z: worldZ + part.localPosition.z,
						},
						rotation: {
							x: part.localRotation.x,
							y: part.localRotation.y + hashNoise(worldX, worldZ, seed + partIndex) * Math.PI * 2,
							z: part.localRotation.z,
						},
						scale: {
							x: part.localScale.x * uniformScale * finalScaleBoost,
							y: part.localScale.y * uniformScale * finalScaleBoost,
							z: part.localScale.z * uniformScale * finalScaleBoost,
						},
						texture: part.texture,
						textureID: part.textureID,
						textureColor: part.textureColor,
						textureOpacity: part.textureOpacity,
						role: "scatter",
					},
					{ role: "scatter" }
				);

				modelAabb = mergeAabb(modelAabb, scatterMesh.worldAabb || null);
				scatterMeshes.push(scatterMesh);
			});

			if (modelAabb) {
				for (let partIndex = scatterMeshes.length - scatterType.parts.length; partIndex < scatterMeshes.length; partIndex += 1) {
					const mesh = scatterMeshes[partIndex];
					mesh.meta = mesh.meta || {};
					mesh.meta.scatterModelAabb = {
						min: { ...modelAabb.min },
						max: { ...modelAabb.max },
					};
				}
			}

			modelCount += 1;
		}

		if (typeCount > 0) {
			Log(
				"ENGINE",
				`Scatter diagnostics: type=${scatterType.id}, models=${modelCount}, parts=${typeCount}, samplePos=${samplePosition ? `${samplePosition.x.toFixed(2)},${samplePosition.y.toFixed(2)},${samplePosition.z.toFixed(2)}` : "n/a"}, sampleDim=${sampleDimensions ? `${sampleDimensions.x.toFixed(2)},${sampleDimensions.y.toFixed(2)},${sampleDimensions.z.toFixed(2)}` : "n/a"}`,
				"log",
				"Level"
			);
		}
	});

	return scatterMeshes;
}

function BuildScatter(payload) {
	const source = payload && typeof payload === "object" ? payload : {};
	return generateObjectScatter(
		source.objectMesh,
		source.scatterDefinitions,
		toNumber(source.scatterMultiplier, GetPerformanceScatterMultiplier()),
		source.world && typeof source.world === "object" ? source.world : {},
		toNumber(source.indexSeed, 1),
		Array.isArray(source.explicitScatter) ? source.explicitScatter : null,
		source.buildObject
	);
}

export { BuildScatter, GetPerformanceScatterMultiplier };
