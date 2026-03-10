// Creates Obstacles the player has to avoid or use an ability on (can be destrucible)

// Used by NewLevel.js and handlers/Cutscene.js
// Uses NewObject.js for 3D objects

import { BuildObject } from "./NewObject.js";
import { Log } from "../core/meta.js";
import { AddVector3, NormalizeVector3 } from "../math/Vector3.js";
import { UnitVector3 } from "../math/Utilities.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mergeAabb(accumulator, bounds) {
	if (!bounds) {
		return accumulator;
	}

	if (!accumulator) {
		return {
			min: new UnitVector3(bounds.min.x, bounds.min.y, bounds.min.z, "CNU"),
			max: new UnitVector3(bounds.max.x, bounds.max.y, bounds.max.z, "CNU"),
		};
	}

	return {
		min: new UnitVector3(
			Math.min(accumulator.min.x, bounds.min.x),
			Math.min(accumulator.min.y, bounds.min.y),
			Math.min(accumulator.min.z, bounds.min.z),
			"CNU"
		),
		max: new UnitVector3(
			Math.max(accumulator.max.x, bounds.max.x),
			Math.max(accumulator.max.y, bounds.max.y),
			Math.max(accumulator.max.z, bounds.max.z),
			"CNU"
		),
	};
}

function buildObstacleParts(source, index, options) {
	const resolvedOptions = options && typeof options === "object" ? options : {};
	if (!Array.isArray(source.parts) || source.parts.length === 0) {
		const single = BuildObject(
			{
				...source,
				id: source.id || `obstacle-${index}`,
				primitive: source.primitive || source.shape || "cube",
				texture: source.texture || {
					textureID: source.textureID || "stone-block",
					color: source.textureColor || { r: 1, g: 1, b: 1, a: 1 },
					opacity: typeof source.textureOpacity === "number" ? source.textureOpacity : 1,
				},
				role: "obstacle",
			},
			{
				role: "obstacle",
				textureID: "stone-block",
				scatterContext: resolvedOptions.scatterContext
					? {
						...resolvedOptions.scatterContext,
						indexSeed: 500 + index,
					}
					: null,
			}
		);
		return [single];
	}

	const rootPosition = source.position;
	const rootRotation = source.rotation.toRadians();
	const rootScale = NormalizeVector3(source.scale, { x: 1, y: 1, z: 1 });

	return source.parts.map((part, partIndex) => {
		const partSource = part && typeof part === "object" ? part : {};
		const inheritedTexture = source.texture || null;
		const inheritedScatter = Array.isArray(source.scatter) ? source.scatter : [];
		const partScatterContext = resolvedOptions.scatterContext
			? {
				...resolvedOptions.scatterContext,
				indexSeed: 700 + (index * 100) + partIndex,
			}
			: null;
		const localRotRad = partSource.localRotation.toRadians();
		const localScale = NormalizeVector3(partSource.localScale, { x: 1, y: 1, z: 1 });
		return BuildObject(
			{
				...partSource,
				id: partSource.id || `${source.id || `obstacle-${index}`}-part-${partIndex}`,
				primitive: partSource.primitive || partSource.shape || "cube",
				position: AddVector3(rootPosition, partSource.localPosition || NormalizeVector3(partSource.localPosition, { x: 0, y: 0, z: 0 })),
				rotation: AddVector3(rootRotation, localRotRad),
				scale: {
					x: rootScale.x * localScale.x,
					y: rootScale.y * localScale.y,
					z: rootScale.z * localScale.z,
				},
				texture: partSource.texture || inheritedTexture || {
					textureID: partSource.textureID || source.textureID || "stone-block",
					color: partSource.textureColor || source.textureColor || { r: 1, g: 1, b: 1, a: 1 },
					opacity: typeof partSource.textureOpacity === "number"
						? partSource.textureOpacity
						: (typeof source.textureOpacity === "number" ? source.textureOpacity : 1),
				},
				scatter: Array.isArray(partSource.scatter)
					? partSource.scatter
					: (partIndex === 0 ? inheritedScatter : []),
				role: "obstacle",
			},
			{
				role: "obstacle",
				textureID: "stone-block",
				scatterContext: partScatterContext,
			}
		);
	});
}

function BuildObstacle(definition, index, options) {
	const source = definition && typeof definition === "object" ? definition : {};
	const parts = buildObstacleParts(source, index, options);
	let bounds = null;
	parts.forEach((part) => {
		bounds = mergeAabb(bounds, part.worldAabb || null);
	});

	const mesh = parts[0] || null;

	return {
		id: source.id || (mesh ? mesh.id : `obstacle-${index}`),
		mesh: mesh,
		parts: parts,
		bounds: bounds,
		destructible: source.destructible === true,
		hp: Math.max(1, toNumber(source.hp, 1)),
		static: source.static !== false,
		scatter: Array.isArray(source.scatter) ? source.scatter : [],
		state: {
			destroyed: false,
		},
	};
}

function BuildObstacles(definitions, options) {
	const source = Array.isArray(definitions) ? definitions : [];
	const built = source.map((definition, index) => BuildObstacle(definition, index, options));
	if (built.length > 0) {
		const destructibleCount = built.filter((entry) => entry.destructible === true).length;
		Log(
			"ENGINE",
			`Obstacle group created: total=${built.length}, destructible=${destructibleCount}, static=${built.length - destructibleCount}`,
			"log",
			"Level"
		);
	}
	return built;
}

export { BuildObstacle, BuildObstacles };