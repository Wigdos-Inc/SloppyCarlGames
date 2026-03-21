// Single Object (shape) Generator

// Called by anything that wants any 3D object or wants to build models.

import { Log } from "../core/meta.js";
import { BuildScatter, GetPerformanceScatterMultiplier } from "./NewScatter.js";
import { ToNumber, UnitVector3 } from "../math/Utilities.js";

function resolveCylinderSegments(complexity) {
	switch (complexity) {
		case "low": return 8;
		case "high": return 16;
		default: return 12;
	}
}

function resolveSphereResolution(complexity) {
	switch(complexity) {
		case "low": return { stacks: 6, slices: 8 };
		case "high": return { stacks: 18, slices: 24 };
		default: return { stacks: 12, slices: 16 };
	}
}

function resolveCapsuleCapStacks(complexity) {
	switch(complexity) {
		case "low": return 4;
		case "high": return 8;
		default: return 6;
	}
}

function resolveTorusResolution(complexity) {
	switch(complexity) {
		case "low": return { majorSegments: 12, minorSegments: 8 };
		case "high": return { majorSegments: 32, minorSegments: 16 };
		default: return { majorSegments: 20, minorSegments: 12 };
	}
}

function generateLegacyUvFromPositions(positions) {
	if (positions.length < 3) return [];

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
		const [uAxis, vAxis] = getProjectedAxesFromNormal(group.normal);

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

function GenerateUVs(positions, geometry) {
	const faceGroups = Array.isArray(geometry.faceGroups) ? geometry.faceGroups : null;
	if (faceGroups && faceGroups.length > 0) {
		return generateFaceProjectedUvs(positions, faceGroups);
	}

	// Keep shared fallback behavior for primitives without explicit face groups.
	return generateLegacyUvFromPositions(positions);
}

function computeBounds(positions) {
	if (positions.length < 3) {
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

function CreateModelMatrix(transform) {
	// transform positions/pivots may be UnitVector3 (CNU) — convert to world units for matrix math.
	const pivot = transform.pivot.toWorldUnit();

	let matrix = createIdentityMatrix();
	matrix = multiplyMatrix4(matrix, createTranslationMatrix(transform.position.toWorldUnit()));
	matrix = multiplyMatrix4(matrix, createTranslationMatrix(pivot));
	matrix = multiplyMatrix4(matrix, createRotationY(transform.rotation.y));
	matrix = multiplyMatrix4(matrix, createRotationX(transform.rotation.x));
	matrix = multiplyMatrix4(matrix, createRotationZ(transform.rotation.z));
	matrix = multiplyMatrix4(matrix, createScaleMatrix(transform.scale));
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
	const modelMatrix = CreateModelMatrix(transform);
	return transformPointByMatrix(localPoint, modelMatrix);
}

function computeWorldAabbFromGeometry(positions, transform) {
	if (positions.length < 3) return { min: transform.position.clone(), max: transform.position.clone() };

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
		min: new UnitVector3(minX, minY, minZ, "cnu"),
		max: new UnitVector3(maxX, maxY, maxZ, "cnu"),
	};
}

function buildCube(size) {
	const sx = Math.max(0.0001, ToNumber(size.x, 1)) / 2;
	const sy = Math.max(0.0001, ToNumber(size.y, 1)) / 2;
	const sz = Math.max(0.0001, ToNumber(size.z, 1)) / 2;

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
	const sx = Math.max(0.0001, ToNumber(size.x, 1)) / 2;
	const sy = Math.max(0.0001, ToNumber(size.y, 1));
	const sz = Math.max(0.0001, ToNumber(size.z, 1)) / 2;

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
	const sx = Math.max(0.0001, ToNumber(size.x, 1)) / 2;
	const sz = Math.max(0.0001, ToNumber(size.z, 1)) / 2;

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

function buildCylinder(size, complexity) {
	const radiusX = Math.max(0.0001, ToNumber(size.x, 1)) / 2;
	const radiusZ = Math.max(0.0001, ToNumber(size.z, 1)) / 2;
	const height = Math.max(0.0001, ToNumber(size.y, 1));
	const halfHeight = height / 2;
	const segments = resolveCylinderSegments(complexity);

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

function buildSphere(size, complexity) {
	const radiusX = Math.max(0.0001, ToNumber(size.x, 1)) / 2;
	const radiusY = Math.max(0.0001, ToNumber(size.y, 1)) / 2;
	const radiusZ = Math.max(0.0001, ToNumber(size.z, 1)) / 2;
	const resolution = resolveSphereResolution(complexity);
	const stacks = resolution.stacks;
	const slices = resolution.slices;

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

function buildCone(size, complexity) {
	const radiusX = Math.max(0.0001, ToNumber(size.x, 1)) / 2;
	const radiusZ = Math.max(0.0001, ToNumber(size.z, 1)) / 2;
	const height = Math.max(0.0001, ToNumber(size.y, 1));
	const halfHeight = height / 2;
	const segments = resolveCylinderSegments(complexity);

	const positions = [];
	const indices = [];
	const sideVertexIndices = [];
	const baseVertexIndices = [];

	const apexIndex = positions.length / 3;
	positions.push(0, halfHeight, 0);
	sideVertexIndices.push(apexIndex);

	const sideStart = positions.length / 3;
	for (let index = 0; index <= segments; index += 1) {
		const ratio = index / segments;
		const angle = ratio * Math.PI * 2;
		const x = Math.cos(angle) * radiusX;
		const z = Math.sin(angle) * radiusZ;
		positions.push(x, -halfHeight, z);
		sideVertexIndices.push(sideStart + index);
	}

	for (let index = 0; index < segments; index += 1) {
		const current = sideStart + index;
		const next = sideStart + index + 1;
		indices.push(apexIndex, current, next);
	}

	const baseCenter = positions.length / 3;
	positions.push(0, -halfHeight, 0);
	baseVertexIndices.push(baseCenter);

	const baseStart = positions.length / 3;
	for (let index = 0; index <= segments; index += 1) {
		const ratio = index / segments;
		const angle = ratio * Math.PI * 2;
		const x = Math.cos(angle) * radiusX;
		const z = Math.sin(angle) * radiusZ;
		positions.push(x, -halfHeight, z);
		baseVertexIndices.push(baseStart + index);
	}

	for (let index = 0; index < segments; index += 1) {
		const current = baseStart + index;
		const next = baseStart + index + 1;
		indices.push(baseCenter, next, current);
	}

	return {
		positions: positions,
		indices: indices,
		faceGroups: [
			{ normal: { x: 0, y: 1, z: 0 }, vertexIndices: sideVertexIndices },
			{ normal: { x: 0, y: -1, z: 0 }, vertexIndices: baseVertexIndices },
		],
	};
}

function buildCapsule(size, complexity) {
	const radiusX = Math.max(0.0001, ToNumber(size.x, 1)) / 2;
	const radiusZ = Math.max(0.0001, ToNumber(size.z, 1)) / 2;
	const capRadius = Math.max(0.0001, Math.min(radiusX, radiusZ));
	const totalHeight = Math.max(0.0001, ToNumber(size.y, 1));
	const halfHeight = totalHeight / 2;
	const cylinderHalf = Math.max(0, halfHeight - capRadius);
	const segments = resolveCylinderSegments(complexity);
	const capStacks = resolveCapsuleCapStacks(complexity);

	const positions = [];
	const indices = [];
	const rings = [];

	const pushRing = (y, ringScaleX, ringScaleZ, groupName) => {
		const start = positions.length / 3;
		for (let index = 0; index <= segments; index += 1) {
			const ratio = index / segments;
			const angle = ratio * Math.PI * 2;
			positions.push(Math.cos(angle) * ringScaleX, y, Math.sin(angle) * ringScaleZ);
		}
		rings.push({ start: start, group: groupName });
	};

	for (let stack = 0; stack <= capStacks; stack += 1) {
		const ratio = stack / capStacks;
		const angle = ratio * Math.PI * 0.5;
		const ringScale = Math.sin(angle);
		const y = cylinderHalf + Math.cos(angle) * capRadius;
		pushRing(y, radiusX * ringScale, radiusZ * ringScale, "top");
	}

	pushRing(-cylinderHalf, radiusX, radiusZ, "body");

	for (let stack = 1; stack <= capStacks; stack += 1) {
		const ratio = stack / capStacks;
		const angle = ratio * Math.PI * 0.5;
		const ringScale = Math.cos(angle);
		const y = -cylinderHalf - Math.sin(angle) * capRadius;
		pushRing(y, radiusX * ringScale, radiusZ * ringScale, "bottom");
	}

	const topVertices = [];
	const bodyVertices = [];
	const bottomVertices = [];

	for (let ring = 0; ring < rings.length - 1; ring += 1) {
		const current = rings[ring];
		const next = rings[ring + 1];
		for (let index = 0; index < segments; index += 1) {
			const a = current.start + index;
			const b = current.start + index + 1;
			const c = next.start + index;
			const d = next.start + index + 1;

			indices.push(a, c, b);
			indices.push(b, c, d);

			if (current.group === "top" && next.group === "top") {
				topVertices.push(a, b, c, d);
			} else if (current.group === "bottom" && next.group === "bottom") {
				bottomVertices.push(a, b, c, d);
			} else {
				bodyVertices.push(a, b, c, d);
			}
		}
	}

	return {
		positions: positions,
		indices: indices,
		faceGroups: [
			{ normal: { x: 0, y: 1, z: 0 }, vertexIndices: topVertices },
			{ normal: { x: 1, y: 0, z: 0 }, vertexIndices: bodyVertices },
			{ normal: { x: 0, y: -1, z: 0 }, vertexIndices: bottomVertices },
		],
	};
}

function buildTube(size, complexity, options) {
	const outerRadiusX = Math.max(0.0002, ToNumber(size.x, 1)) / 2;
	const outerRadiusZ = Math.max(0.0002, ToNumber(size.z, 1)) / 2;
	const height = Math.max(0.0001, ToNumber(size.y, 1));
	const halfHeight = height / 2;
	const thickness = Math.max(0.00005, ToNumber(options.thickness, Math.min(outerRadiusX, outerRadiusZ) * 0.25));
	const innerRadiusX = Math.max(0.00005, outerRadiusX - Math.min(thickness, outerRadiusX * 0.95));
	const innerRadiusZ = Math.max(0.00005, outerRadiusZ - Math.min(thickness, outerRadiusZ * 0.95));
	const segments = resolveCylinderSegments(complexity);

	const positions = [];
	const indices = [];

	const outerBottomStart = positions.length / 3;
	for (let index = 0; index <= segments; index += 1) {
		const ratio = index / segments;
		const angle = ratio * Math.PI * 2;
		positions.push(Math.cos(angle) * outerRadiusX, -halfHeight, Math.sin(angle) * outerRadiusZ);
	}

	const outerTopStart = positions.length / 3;
	for (let index = 0; index <= segments; index += 1) {
		const ratio = index / segments;
		const angle = ratio * Math.PI * 2;
		positions.push(Math.cos(angle) * outerRadiusX, halfHeight, Math.sin(angle) * outerRadiusZ);
	}

	const innerBottomStart = positions.length / 3;
	for (let index = 0; index <= segments; index += 1) {
		const ratio = index / segments;
		const angle = ratio * Math.PI * 2;
		positions.push(Math.cos(angle) * innerRadiusX, -halfHeight, Math.sin(angle) * innerRadiusZ);
	}

	const innerTopStart = positions.length / 3;
	for (let index = 0; index <= segments; index += 1) {
		const ratio = index / segments;
		const angle = ratio * Math.PI * 2;
		positions.push(Math.cos(angle) * innerRadiusX, halfHeight, Math.sin(angle) * innerRadiusZ);
	}

	for (let index = 0; index < segments; index += 1) {
		const ob0 = outerBottomStart + index;
		const ob1 = outerBottomStart + index + 1;
		const ot0 = outerTopStart + index;
		const ot1 = outerTopStart + index + 1;
		indices.push(ob0, ot0, ot1);
		indices.push(ob0, ot1, ob1);

		const ib0 = innerBottomStart + index;
		const ib1 = innerBottomStart + index + 1;
		const it0 = innerTopStart + index;
		const it1 = innerTopStart + index + 1;
		indices.push(ib0, it1, it0);
		indices.push(ib0, ib1, it1);

		indices.push(ot0, ot1, it1);
		indices.push(ot0, it1, it0);

		indices.push(ob0, ib1, ob1);
		indices.push(ob0, ib0, ib1);
	}

	const outerVertices = [];
	const innerVertices = [];
	const topVertices = [];
	const bottomVertices = [];

	for (let index = 0; index <= segments; index += 1) {
		outerVertices.push(outerBottomStart + index, outerTopStart + index);
		innerVertices.push(innerBottomStart + index, innerTopStart + index);
		topVertices.push(outerTopStart + index, innerTopStart + index);
		bottomVertices.push(outerBottomStart + index, innerBottomStart + index);
	}

	return {
		positions: positions,
		indices: indices,
		faceGroups: [
			{ normal: { x: 1, y: 0, z: 0 }, vertexIndices: outerVertices },
			{ normal: { x: -1, y: 0, z: 0 }, vertexIndices: innerVertices },
			{ normal: { x: 0, y: 1, z: 0 }, vertexIndices: topVertices },
			{ normal: { x: 0, y: -1, z: 0 }, vertexIndices: bottomVertices },
		],
	};
}

function buildTorus(size, complexity, options) {
	const fallbackRadius = Math.max(0.0002, ToNumber(size.x, 1)) / 2;
	const fallbackThickness = Math.max(0.0001, ToNumber(size.y, 1)) / 4;
	const majorRadius = Math.max(0.0002, ToNumber(options.radius, fallbackRadius));
	const minorRadius = Math.max(0.0001, Math.min(ToNumber(options.thickness, fallbackThickness), majorRadius * 0.95));
	const resolution = resolveTorusResolution(complexity);
	const majorSegments = resolution.majorSegments;
	const minorSegments = resolution.minorSegments;

	const positions = [];
	const indices = [];

	for (let major = 0; major <= majorSegments; major += 1) {
		const u = (major / majorSegments) * Math.PI * 2;
		const cosU = Math.cos(u);
		const sinU = Math.sin(u);

		for (let minor = 0; minor <= minorSegments; minor += 1) {
			const v = (minor / minorSegments) * Math.PI * 2;
			const cosV = Math.cos(v);
			const sinV = Math.sin(v);
			const ringRadius = majorRadius + (minorRadius * cosV);
			positions.push(ringRadius * cosU, minorRadius * sinV, ringRadius * sinU);
		}
	}

	const stride = minorSegments + 1;
	for (let major = 0; major < majorSegments; major += 1) {
		for (let minor = 0; minor < minorSegments; minor += 1) {
			const a = major * stride + minor;
			const b = (major + 1) * stride + minor;
			const c = a + 1;
			const d = b + 1;
			indices.push(a, b, c);
			indices.push(c, b, d);
		}
	}

	const sectorCount = Math.min(8, majorSegments);
	const faceGroups = [];
	for (let sector = 0; sector < sectorCount; sector += 1) {
		const startMajor = Math.floor((sector / sectorCount) * majorSegments);
		const endMajor = Math.floor(((sector + 1) / sectorCount) * majorSegments);
		const vertexIndices = [];
		for (let major = startMajor; major <= endMajor + 1; major += 1) {
			const wrappedMajor = Math.min(major, majorSegments);
			for (let minor = 0; minor <= minorSegments; minor += 1) {
				vertexIndices.push((wrappedMajor * stride) + minor);
			}
		}

		const sectorMid = ((startMajor + endMajor) * 0.5 / majorSegments) * Math.PI * 2;
		faceGroups.push({
			normal: { x: Math.cos(sectorMid), y: 0, z: Math.sin(sectorMid) },
			vertexIndices: vertexIndices,
		});
	}

	return { positions: positions, indices: indices, faceGroups: faceGroups };
}

function buildGrid(size, complexity, options) {
	const sx = Math.max(0.0001, ToNumber(size.x, 1));
	const sz = Math.max(0.0001, ToNumber(size.z, 1));
	const complexitySubdivisions = complexity === "low"
		? 4
		: complexity === "high"
			? 16
			: 8;
	const subdivisionsX = Math.max(1, Math.floor(ToNumber(options.subdivisionsX, complexitySubdivisions)));
	const subdivisionsZ = Math.max(1, Math.floor(ToNumber(options.subdivisionsZ, complexitySubdivisions)));

	const positions = [];
	const indices = [];
	const faceVertices = [];

	for (let z = 0; z <= subdivisionsZ; z += 1) {
		const zRatio = z / subdivisionsZ;
		const zPosition = (zRatio - 0.5) * sz;
		for (let x = 0; x <= subdivisionsX; x += 1) {
			const xRatio = x / subdivisionsX;
			const xPosition = (xRatio - 0.5) * sx;
			const vertexIndex = positions.length / 3;
			positions.push(xPosition, 0, zPosition);
			faceVertices.push(vertexIndex);
		}
	}

	const stride = subdivisionsX + 1;
	for (let z = 0; z < subdivisionsZ; z += 1) {
		for (let x = 0; x < subdivisionsX; x += 1) {
			const topLeft = (z * stride) + x;
			const topRight = topLeft + 1;
			const bottomLeft = ((z + 1) * stride) + x;
			const bottomRight = bottomLeft + 1;
			indices.push(topLeft, bottomLeft, topRight);
			indices.push(topRight, bottomLeft, bottomRight);
		}
	}

	return {
		positions: positions,
		indices: indices,
		faceGroups: [{ normal: { x: 0, y: 1, z: 0 }, vertexIndices: faceVertices }],
	};
}

function buildRamp(size, options) {
	const sx = size.x / 2;
	const sy = size.y;
	const sz = size.z / 2;

	const baseY = -sy / 2;
	const desiredRise = Math.tan(options.angle) * (sz * 2);
	const rise = Math.max(0.0001, Math.min(sy, Math.abs(desiredRise) > 0 ? desiredRise : sy));
	const backY = baseY + rise;

	const positions = [
		-sx, baseY, -sz,
		sx, baseY, -sz,
		sx, baseY, sz,
		-sx, baseY, sz,
		sx, backY, sz,
		-sx, backY, sz,
	];

	const indices = [
		0, 1, 2,
		0, 2, 3,
		3, 2, 4,
		3, 4, 5,
		0, 5, 4,
		0, 4, 1,
		0, 3, 5,
		1, 4, 2,
	];

	const slopeNormalY = Math.cos(Math.atan2(rise, sz * 2));
	const slopeNormalZ = -Math.sin(Math.atan2(rise, sz * 2));

	return {
		positions: positions,
		indices: indices,
		faceGroups: [
			{ normal: { x: 0, y: -1, z: 0 }, vertexIndices: [0, 1, 2, 3] },
			{ normal: { x: 0, y: 0, z: 1 }, vertexIndices: [2, 3, 4, 5] },
			{ normal: { x: 0, y: slopeNormalY, z: slopeNormalZ }, vertexIndices: [0, 1, 4, 5] },
			{ normal: { x: -1, y: 0, z: 0 }, vertexIndices: [0, 3, 5] },
			{ normal: { x: 1, y: 0, z: 0 }, vertexIndices: [1, 2, 4] },
		],
	};
}

function BuildGeometry(shape, size, complexity, primitiveOptions = {}) {
	switch (shape) {
		case "cylinder": return buildCylinder(size, complexity);
		case "sphere"  : return buildSphere(size, complexity);
		case "capsule" : return buildCapsule(size, complexity);
		case "cone"    : return buildCone(size, complexity);
		case "grid"    : return buildGrid(size, complexity, primitiveOptions);
		case "ramp"    : return buildRamp(size, primitiveOptions);
		case "tube"    : return buildTube(size, complexity, primitiveOptions);
		case "torus"   : return buildTorus(size, complexity, primitiveOptions);
		case "pyramid" : return buildPyramid(size);
		case "plane"   : return buildPlane(size);
		default        : return buildCube(size);
	}
}

function BuildObject(source, options) {
	// Upstream must supply normalized/canonical objects (UnitVector3 for world-space values).
	// Mandatory fields are used directly; optional fields are assumed normalized.
	const shape = source.shape.toLowerCase();
	const complexity = source.complexity;

	// Upstream must provide normalized texture, scatter and primitive option objects.
	// Expect world-space values to be provided as UnitVector3 instances already.
	const primitiveOptions = source.primitiveOptions;
	const geometry = BuildGeometry(shape, source.dimensions, complexity, primitiveOptions);
	const uvs = GenerateUVs(geometry.positions, geometry);
	const bounds = computeBounds(geometry.positions);
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
		position: source.position,         // UnitVector3
		rotation: source.rotation,         // UnitVector3
		scale: source.scale,               // Vector3
		pivot: source.pivot,               // UnitVector3
	};
	const worldAabb = computeWorldAabbFromGeometry(geometry.positions, transform);
	const texture = source.texture;

	const mesh = {
		id: source.id,
		type: "mesh3d",
		shape: shape,
		primitive: shape,
		complexity: complexity,
		role: source.role,
		transform: transform,
		geometry: {
			positions: geometry.positions,
			indices: geometry.indices,
			uvs: uvs,
			bounds: bounds,
		},
		material: {
			textureID: texture.materialTextureID,
			color: texture.color,
			opacity: texture.opacity,
			transparent: texture.opacity < 1,
		},
		meta: {
			trigger: source.trigger,
			platform: source.platform,
			parentId: source.parentId,
		},
		detail: {
			texture: texture,
			scatter: source.detail.scatter,
			complexity: complexity,
			primitiveOptions: primitiveOptions,
		},
		localBounds: bounds,
		worldAabb: worldAabb,
		dimensions: source.dimensions,
	};

	const scatterContext = options.scatterContext;
	if (scatterContext && mesh.detail.scatter.length > 0) {
		const generatedScatter = BuildScatter({
			objectMesh: mesh,
			scatterMultiplier: ToNumber(scatterContext.scatterMultiplier, GetPerformanceScatterMultiplier()),
			world: scatterContext.world,
			indexSeed: ToNumber(scatterContext.indexSeed, 1),
			explicitScatter: mesh.detail.scatter,
		});

		if (generatedScatter.length > 0) {
			mesh.meta.scatter = { count: generatedScatter.length };
			scatterContext.scatterAccumulator?.push(...generatedScatter);
			scatterContext.onScatterGenerated?.(mesh, generatedScatter);
		}
	}

	return mesh;
}

function UpdateObjectWorldAabb(mesh) {
	mesh.worldAabb = computeWorldAabbFromGeometry(mesh.geometry.positions, mesh.transform);
	return mesh.worldAabb;
}

export { BuildObject, UpdateObjectWorldAabb, BuildGeometry, GenerateUVs, CreateModelMatrix };