// Creates Obstacles the player has to avoid or use an ability on (can be destrucible)

// Used by NewLevel.js and handlers/Cutscene.js
// Uses NewObject.js for 3D objects

import { BuildObject } from "./NewObject.js";
import { Log } from "../core/meta.js";
import { addVector3, normalizeVector3 } from "../math/Vector3.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mergeAabb(accumulator, bounds) {
	if (!bounds) {
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

function buildObstacleParts(source, index) {
	if (!Array.isArray(source.parts) || source.parts.length === 0) {
		const single = BuildObject(
			{
				...source,
				id: source.id || `obstacle-${index}`,
				primitive: source.primitive || source.shape || "cube",
				textureID: source.textureID || "stone-block",
				textureColor: source.textureColor || { r: 1, g: 1, b: 1, a: 1 },
				textureOpacity: typeof source.textureOpacity === "number" ? source.textureOpacity : 1,
				role: "obstacle",
			},
			{ role: "obstacle", textureID: "stone-block" }
		);
		return [single];
	}

	const rootPosition = normalizeVector3(source.position, { x: 0, y: 0, z: 0 });
	const rootRotation = normalizeVector3(source.rotation, { x: 0, y: 0, z: 0 });
	const rootScale = normalizeVector3(source.scale, { x: 1, y: 1, z: 1 });

	return source.parts.map((part, partIndex) => {
		const partSource = part && typeof part === "object" ? part : {};
		return BuildObject(
			{
				...partSource,
				id: partSource.id || `${source.id || `obstacle-${index}`}-part-${partIndex}`,
				primitive: partSource.primitive || partSource.shape || "cube",
				position: addVector3(rootPosition, normalizeVector3(partSource.localPosition, { x: 0, y: 0, z: 0 })),
				rotation: addVector3(rootRotation, normalizeVector3(partSource.localRotation, { x: 0, y: 0, z: 0 })),
				scale: {
					x: rootScale.x * normalizeVector3(partSource.localScale, { x: 1, y: 1, z: 1 }).x,
					y: rootScale.y * normalizeVector3(partSource.localScale, { x: 1, y: 1, z: 1 }).y,
					z: rootScale.z * normalizeVector3(partSource.localScale, { x: 1, y: 1, z: 1 }).z,
				},
				textureID: partSource.textureID || source.textureID || "stone-block",
				textureColor: partSource.textureColor || source.textureColor || { r: 1, g: 1, b: 1, a: 1 },
				textureOpacity: typeof partSource.textureOpacity === "number"
					? partSource.textureOpacity
					: (typeof source.textureOpacity === "number" ? source.textureOpacity : 1),
				role: "obstacle",
			},
			{ role: "obstacle", textureID: "stone-block" }
		);
	});
}

function BuildObstacle(definition, index) {
	const source = definition && typeof definition === "object" ? definition : {};
	const parts = buildObstacleParts(source, index);
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
		scatterTypeIDs: Array.isArray(source.scatterTypeIDs) ? source.scatterTypeIDs : [],
		baseDensity: Math.max(0, toNumber(source.baseDensity, 0)),
		state: {
			destroyed: false,
		},
	};
}

function BuildObstacles(definitions) {
	const source = Array.isArray(definitions) ? definitions : [];
	const built = source.map((definition, index) => BuildObstacle(definition, index));
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