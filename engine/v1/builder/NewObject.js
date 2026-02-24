// Single Object (shape) Generator

// Called by anything that wants any 3D object or wants to build models.

import { normalizeVector3 } from "../math/Vector3.js";
import { Log } from "../core/meta.js";

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

function generateLegacyUvFromPositions(positions) {
	if (!Array.isArray(positions) || positions.length < 3) {
		return [];
	}

	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;

	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index + 0];
		const y = positions[index + 1];
		const z = positions[index + 2];
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (z < minZ) minZ = z;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
		if (z > maxZ) maxZ = z;
	}

	const spanX = Math.max(0.0001, maxX - minX);
	const spanY = Math.max(0.0001, maxY - minY);
	const spanZ = Math.max(0.0001, maxZ - minZ);

	const uvs = [];
	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index + 0];
		const y = positions[index + 1];
		const z = positions[index + 2];

		const absX = Math.abs(x);
		const absY = Math.abs(y);
		const absZ = Math.abs(z);

		let u = 0;
		let v = 0;
		if (absY >= absX && absY >= absZ) {
			u = (x - minX) / spanX;
			v = (z - minZ) / spanZ;
		} else if (absX >= absZ) {
			u = (z - minZ) / spanZ;
			v = (y - minY) / spanY;
		} else {
			u = (x - minX) / spanX;
			v = (y - minY) / spanY;
		}

		uvs.push(u, v);
	}

	return uvs;
}

function getProjectedAxesFromNormal(normal) {
	const nx = Math.abs(normal.x);
	const ny = Math.abs(normal.y);
	const nz = Math.abs(normal.z);

	if (nx >= ny && nx >= nz) {
		return ["y", "z"];
	}

	if (ny >= nx && ny >= nz) {
		return ["x", "z"];
	}

	return ["x", "y"];
}

function getVertexVector(positions, vertexIndex) {
	const offset = vertexIndex * 3;
	return {
		x: positions[offset + 0],
		y: positions[offset + 1],
		z: positions[offset + 2],
	};
}

function generateFaceProjectedUvs(positions, faceGroups) {
	if (!Array.isArray(positions) || positions.length < 3) {
		return [];
	}

	const vertexCount = positions.length / 3;
	const uvs = new Array(vertexCount * 2).fill(0);

	for (let groupIndex = 0; groupIndex < faceGroups.length; groupIndex += 1) {
		const group = faceGroups[groupIndex];
		if (!group || !Array.isArray(group.vertexIndices) || group.vertexIndices.length === 0) {
			continue;
		}

		// Face-based projection: choose UV plane from known face normal.
		const normal = group.normal || { x: 0, y: 0, z: 1 };
		const [uAxis, vAxis] = getProjectedAxesFromNormal(normal);

		let minU = Infinity;
		let maxU = -Infinity;
		let minV = Infinity;
		let maxV = -Infinity;

		for (let index = 0; index < group.vertexIndices.length; index += 1) {
			const vertexIndex = group.vertexIndices[index];
			const vertex = getVertexVector(positions, vertexIndex);
			const u = vertex[uAxis];
			const v = vertex[vAxis];
			if (u < minU) minU = u;
			if (u > maxU) maxU = u;
			if (v < minV) minV = v;
			if (v > maxV) maxV = v;
		}

		const rawSpanU = maxU - minU;
		const rawSpanV = maxV - minV;
		const spanU = rawSpanU === 0 ? 1 : rawSpanU;
		const spanV = rawSpanV === 0 ? 1 : rawSpanV;

		for (let index = 0; index < group.vertexIndices.length; index += 1) {
			const vertexIndex = group.vertexIndices[index];
			const vertex = getVertexVector(positions, vertexIndex);
			const normalizedU = (vertex[uAxis] - minU) / spanU;
			const normalizedV = (vertex[vAxis] - minV) / spanV;
			const uvOffset = vertexIndex * 2;
			uvs[uvOffset + 0] = normalizedU;
			uvs[uvOffset + 1] = normalizedV;
		}
	}

	return uvs;
}

function generateUvs(positions, geometry) {
	const faceGroups = geometry && Array.isArray(geometry.faceGroups) ? geometry.faceGroups : null;
	if (faceGroups && faceGroups.length > 0) {
		return generateFaceProjectedUvs(positions, faceGroups);
	}

	// Keep shared fallback behavior for primitives without explicit face groups.
	return generateLegacyUvFromPositions(positions);
}

function computeBounds(positions) {
	if (!Array.isArray(positions) || positions.length < 3) {
		return {
			min: { x: -0.5, y: -0.5, z: -0.5 },
			max: { x: 0.5, y: 0.5, z: 0.5 },
		};
	}

	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;

	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index + 0];
		const y = positions[index + 1];
		const z = positions[index + 2];
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (z < minZ) minZ = z;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
		if (z > maxZ) maxZ = z;
	}

	return {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
	};
}

function rotateX(vector, radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return {
		x: vector.x,
		y: vector.y * c - vector.z * s,
		z: vector.y * s + vector.z * c,
	};
}

function rotateY(vector, radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return {
		x: vector.x * c + vector.z * s,
		y: vector.y,
		z: -vector.x * s + vector.z * c,
	};
}

function rotateZ(vector, radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return {
		x: vector.x * c - vector.y * s,
		y: vector.x * s + vector.y * c,
		z: vector.z,
	};
}

function createIdentityMatrix() {
	return [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	];
}

function multiplyMatrix4(a, b) {
	const out = new Array(16);
	for (let col = 0; col < 4; col += 1) {
		for (let row = 0; row < 4; row += 1) {
			out[col * 4 + row] =
				a[0 * 4 + row] * b[col * 4 + 0] +
				a[1 * 4 + row] * b[col * 4 + 1] +
				a[2 * 4 + row] * b[col * 4 + 2] +
				a[3 * 4 + row] * b[col * 4 + 3];
		}
	}
	return out;
}

function createTranslationMatrix(position) {
	return [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		position.x, position.y, position.z, 1,
	];
}

function createScaleMatrix(scale) {
	return [
		scale.x, 0, 0, 0,
		0, scale.y, 0, 0,
		0, 0, scale.z, 0,
		0, 0, 0, 1,
	];
}

function createRotationX(radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return [
		1, 0, 0, 0,
		0, c, s, 0,
		0, -s, c, 0,
		0, 0, 0, 1,
	];
}

function createRotationY(radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return [
		c, 0, -s, 0,
		0, 1, 0, 0,
		s, 0, c, 0,
		0, 0, 0, 1,
	];
}

function createRotationZ(radians) {
	const c = Math.cos(radians);
	const s = Math.sin(radians);
	return [
		c, s, 0, 0,
		-s, c, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	];
}

function createModelMatrix(transform) {
	const source = transform && typeof transform === "object" ? transform : {};
	const position = normalizeVector3(source.position, { x: 0, y: 0, z: 0 });
	const rotation = normalizeVector3(source.rotation, { x: 0, y: 0, z: 0 });
	const scale = normalizeVector3(source.scale, { x: 1, y: 1, z: 1 });
	const pivot = normalizeVector3(source.pivot, { x: 0, y: 0, z: 0 });

	let matrix = createIdentityMatrix();
	matrix = multiplyMatrix4(matrix, createTranslationMatrix(position));
	matrix = multiplyMatrix4(matrix, createTranslationMatrix(pivot));
	matrix = multiplyMatrix4(matrix, createRotationY(rotation.y || 0));
	matrix = multiplyMatrix4(matrix, createRotationX(rotation.x || 0));
	matrix = multiplyMatrix4(matrix, createRotationZ(rotation.z || 0));
	matrix = multiplyMatrix4(matrix, createScaleMatrix(scale));
	matrix = multiplyMatrix4(matrix, createTranslationMatrix({ x: -pivot.x, y: -pivot.y, z: -pivot.z }));
	return matrix;
}

function transformPointByMatrix(localPoint, matrix) {
	return {
		x: matrix[0] * localPoint.x + matrix[4] * localPoint.y + matrix[8] * localPoint.z + matrix[12],
		y: matrix[1] * localPoint.x + matrix[5] * localPoint.y + matrix[9] * localPoint.z + matrix[13],
		z: matrix[2] * localPoint.x + matrix[6] * localPoint.y + matrix[10] * localPoint.z + matrix[14],
	};
}

function transformPoint(localPoint, transform) {
	const modelMatrix = createModelMatrix(transform);
	return transformPointByMatrix(localPoint, modelMatrix);
}

function computeWorldAabbFromGeometry(positions, transform) {
	if (!Array.isArray(positions) || positions.length < 3) {
		const p = normalizeVector3(transform && transform.position, { x: 0, y: 0, z: 0 });
		return { min: { ...p }, max: { ...p } };
	}

	let minX = Infinity;
	let minY = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	let maxZ = -Infinity;

	for (let index = 0; index < positions.length; index += 3) {
		const world = transformPoint({ x: positions[index], y: positions[index + 1], z: positions[index + 2] }, transform);
		if (world.x < minX) minX = world.x;
		if (world.y < minY) minY = world.y;
		if (world.z < minZ) minZ = world.z;
		if (world.x > maxX) maxX = world.x;
		if (world.y > maxY) maxY = world.y;
		if (world.z > maxZ) maxZ = world.z;
	}

	return {
		min: { x: minX, y: minY, z: minZ },
		max: { x: maxX, y: maxY, z: maxZ },
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

	const faceGroups = [
		{ normal: { x: 0, y: 0, z: 1 }, vertexIndices: [0, 1, 2, 3] },
		{ normal: { x: 0, y: 0, z: -1 }, vertexIndices: [4, 5, 6, 7] },
		{ normal: { x: -1, y: 0, z: 0 }, vertexIndices: [8, 9, 10, 11] },
		{ normal: { x: 1, y: 0, z: 0 }, vertexIndices: [12, 13, 14, 15] },
		{ normal: { x: 0, y: 1, z: 0 }, vertexIndices: [16, 17, 18, 19] },
		{ normal: { x: 0, y: -1, z: 0 }, vertexIndices: [20, 21, 22, 23] },
	];

	return { positions: positions, indices: indices, faceGroups: faceGroups };
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
		faceGroups: [{ normal: { x: 0, y: 1, z: 0 }, vertexIndices: [0, 1, 2, 3] }],
	};
}

function buildCylinder(size) {
	const radiusX = Math.max(0.0001, toNumber(size.x, 1)) / 2;
	const radiusZ = Math.max(0.0001, toNumber(size.z, 1)) / 2;
	const height = Math.max(0.0001, toNumber(size.y, 1));
	const halfHeight = height / 2;
	const segments = 16;

	const positions = [];
	const indices = [];

	for (let index = 0; index <= segments; index += 1) {
		const ratio = index / segments;
		const angle = ratio * Math.PI * 2;
		const x = Math.cos(angle) * radiusX;
		const z = Math.sin(angle) * radiusZ;
		positions.push(x, -halfHeight, z);
		positions.push(x, halfHeight, z);
	}

	for (let index = 0; index < segments; index += 1) {
		const base = index * 2;
		indices.push(base, base + 1, base + 3);
		indices.push(base, base + 3, base + 2);
	}

	const bottomCenter = positions.length / 3;
	positions.push(0, -halfHeight, 0);
	const topCenter = positions.length / 3;
	positions.push(0, halfHeight, 0);

	for (let index = 0; index < segments; index += 1) {
		const next = ((index + 1) % segments) * 2;
		const current = index * 2;
		indices.push(bottomCenter, next, current);
		indices.push(topCenter, current + 1, next + 1);
	}

	return { positions: positions, indices: indices };
}

function buildSphere(size) {
	const radiusX = Math.max(0.0001, toNumber(size.x, 1)) / 2;
	const radiusY = Math.max(0.0001, toNumber(size.y, 1)) / 2;
	const radiusZ = Math.max(0.0001, toNumber(size.z, 1)) / 2;
	const stacks = 12;
	const slices = 16;

	const positions = [];
	const indices = [];

	for (let stack = 0; stack <= stacks; stack += 1) {
		const v = stack / stacks;
		const phi = v * Math.PI;
		for (let slice = 0; slice <= slices; slice += 1) {
			const u = slice / slices;
			const theta = u * Math.PI * 2;
			const x = Math.cos(theta) * Math.sin(phi) * radiusX;
			const y = Math.cos(phi) * radiusY;
			const z = Math.sin(theta) * Math.sin(phi) * radiusZ;
			positions.push(x, y, z);
		}
	}

	for (let stack = 0; stack < stacks; stack += 1) {
		for (let slice = 0; slice < slices; slice += 1) {
			const first = stack * (slices + 1) + slice;
			const second = first + slices + 1;
			indices.push(first, second, first + 1);
			indices.push(second, second + 1, first + 1);
		}
	}

	return { positions: positions, indices: indices };
}

function buildGeometry(shape, size) {
	if (shape === "cylinder") {
		return buildCylinder(size);
	}

	if (shape === "sphere") {
		return buildSphere(size);
	}

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
	const shapeSource = typeof source.shape === "string" ? source.shape : source.primitive;
	const shape = typeof shapeSource === "string" ? shapeSource.toLowerCase() : "cube";

	const size = normalizeVector3(source.dimensions || source.size, { x: 1, y: 1, z: 1 });
	const position = normalizeVector3(source.position, { x: 0, y: 0, z: 0 });
	const rotation = normalizeVector3(source.rotation, { x: 0, y: 0, z: 0 });
	const scale = normalizeVector3(source.scale, { x: 1, y: 1, z: 1 });
	const pivot = normalizeVector3(source.pivot, { x: 0, y: 0, z: 0 });
	const geometry = buildGeometry(shape, size);
	const uvs = generateUvs(geometry.positions, geometry);
	const bounds = computeBounds(geometry.positions);
	const opacity = Math.max(0, Math.min(1, toNumber(source.textureOpacity, 1)));
	const vertexCount = geometry.positions.length / 3;
	if (uvs.length !== vertexCount * 2) {
		Log(
			"ENGINE",
			`UV buffer mismatch: object=${source.id || "unknown"}, primitive=${shape}, uvLength=${uvs.length}, expected=${vertexCount * 2}`,
			"error",
			"Level"
		);
	}
	const transform = {
		position: position,
		rotation: rotation,
		scale: scale,
		pivot: pivot,
	};
	const worldAabb = computeWorldAabbFromGeometry(geometry.positions, transform);

	return {
		id: source.id || `object-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		type: "mesh3d",
		shape: shape,
		primitive: shape,
		role: source.role || resolvedOptions.role || "terrain",
		transform: transform,
		geometry: {
			positions: geometry.positions,
			indices: geometry.indices,
			uvs: uvs,
			bounds: bounds,
		},
		material: {
			textureID: source.textureID || resolvedOptions.textureID || "default-grid",
			color: normalizeColor(source.textureColor || source.color || resolvedOptions.defaultColor),
			opacity: opacity,
			transparent: opacity < 1,
		},
		meta: {
			trigger: source.trigger || null,
			platform: source.platform || null,
			parentId: source.parentId || null,
		},
		localBounds: bounds,
		worldAabb: worldAabb,
		dimensions: size,
	};
}

function UpdateObjectWorldAabb(mesh) {
	if (!mesh || !mesh.geometry || !Array.isArray(mesh.geometry.positions)) {
		return null;
	}

	mesh.worldAabb = computeWorldAabbFromGeometry(mesh.geometry.positions, mesh.transform || null);
	return mesh.worldAabb;
}

export { BuildObject, UpdateObjectWorldAabb };