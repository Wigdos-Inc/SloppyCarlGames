// Single Object (shape) Generator

// Called by anything that wants any 3D object or wants to build models.

import { normalizeVector3 } from "../math/Vector3.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeColor(color) {
	if (!color || typeof color !== "object") {
		return { r: 0.7, g: 0.75, b: 0.85, a: 1 };
	}

	const clamp = (value) => Math.max(0, Math.min(1, toNumber(value, 1)));
	return {
		r: clamp(color.r),
		g: clamp(color.g),
		b: clamp(color.b),
		a: clamp(color.a),
	};
}

function buildCube(size) {
	const sx = Math.max(0.0001, toNumber(size.x, 1)) / 2;
	const sy = Math.max(0.0001, toNumber(size.y, 1)) / 2;
	const sz = Math.max(0.0001, toNumber(size.z, 1)) / 2;

	const positions = [
		-sx, -sy, sz, sx, -sy, sz, sx, sy, sz, -sx, sy, sz,
		sx, -sy, -sz, -sx, -sy, -sz, -sx, sy, -sz, sx, sy, -sz,
		-sx, -sy, -sz, -sx, -sy, sz, -sx, sy, sz, -sx, sy, -sz,
		sx, -sy, sz, sx, -sy, -sz, sx, sy, -sz, sx, sy, sz,
		-sx, sy, sz, sx, sy, sz, sx, sy, -sz, -sx, sy, -sz,
		-sx, -sy, -sz, sx, -sy, -sz, sx, -sy, sz, -sx, -sy, sz,
	];

	const indices = [
		0, 1, 2, 0, 2, 3,
		4, 5, 6, 4, 6, 7,
		8, 9, 10, 8, 10, 11,
		12, 13, 14, 12, 14, 15,
		16, 17, 18, 16, 18, 19,
		20, 21, 22, 20, 22, 23,
	];

	return { positions: positions, indices: indices };
}

function buildPyramid(size) {
	const sx = Math.max(0.0001, toNumber(size.x, 1)) / 2;
	const sy = Math.max(0.0001, toNumber(size.y, 1));
	const sz = Math.max(0.0001, toNumber(size.z, 1)) / 2;

	const positions = [
		-sx, 0, sz,
		sx, 0, sz,
		sx, 0, -sz,
		-sx, 0, -sz,
		0, sy, 0,
	];

	const indices = [
		0, 1, 2,
		0, 2, 3,
		0, 1, 4,
		1, 2, 4,
		2, 3, 4,
		3, 0, 4,
	];

	return { positions: positions, indices: indices };
}

function buildPlane(size) {
	const sx = Math.max(0.0001, toNumber(size.x, 1)) / 2;
	const sz = Math.max(0.0001, toNumber(size.z, 1)) / 2;

	return {
		positions: [
			-sx, 0, sz,
			sx, 0, sz,
			sx, 0, -sz,
			-sx, 0, -sz,
		],
		indices: [0, 1, 2, 0, 2, 3],
	};
}

function buildGeometry(shape, size) {
	if (shape === "pyramid") {
		return buildPyramid(size);
	}

	if (shape === "plane") {
		return buildPlane(size);
	}

	return buildCube(size);
}

function BuildObject(definition, options) {
	const source = definition && typeof definition === "object" ? definition : {};
	const resolvedOptions = options && typeof options === "object" ? options : {};
	const shape = typeof source.shape === "string" ? source.shape.toLowerCase() : "cube";

	const size = normalizeVector3(source.size, { x: 1, y: 1, z: 1 });
	const position = normalizeVector3(source.position, { x: 0, y: 0, z: 0 });
	const rotation = normalizeVector3(source.rotation, { x: 0, y: 0, z: 0 });
	const scale = normalizeVector3(source.scale, { x: 1, y: 1, z: 1 });
	const geometry = buildGeometry(shape, size);

	return {
		id: source.id || `object-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		type: "mesh3d",
		shape: shape,
		role: source.role || resolvedOptions.role || "terrain",
		transform: {
			position: position,
			rotation: rotation,
			scale: scale,
		},
		geometry: {
			positions: geometry.positions,
			indices: geometry.indices,
		},
		material: {
			color: normalizeColor(source.color || resolvedOptions.defaultColor),
			transparent: false,
		},
		meta: {
			trigger: source.trigger || null,
			platform: source.platform || null,
		},
	};
}

export { BuildObject };