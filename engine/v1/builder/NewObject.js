// Single Object (shape) Generator

// Called by anything that wants any 3D object or wants to build models.

import { BuildScatter } from "./NewScatter.js";
import { CreateModelMatrix } from "../math/Matrix.js";
import { Clamp, ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";
import { 
	AbsoluteVector3, 
	AddVector3, 
	CloneVector3, 
	CrossVector3, 
	DivideVector3, 
	ResolveVector3Axis, 
	ScaleVector3, 
	SubtractVector3, 
	ToVector3, 
	Vector3Length, 
	Vector3Sq, 
	WORLD_NORMALS 
} from "../math/Vector3.js";

function computeObbFromMesh(mesh) {
	const modelMatrix = CreateModelMatrix(mesh.transform);
	return {
		type: "obb",
		center: mesh.worldAabb.min.clone().add(mesh.worldAabb.max).scale(0.5),
		halfExtents: mesh.localBounds.max
			.clone()
			.subtract(mesh.localBounds.min)
			.scale(0.5)
			.multiply(AbsoluteVector3(mesh.transform.scale)),
		axes: [
			ResolveVector3Axis({ x: modelMatrix[0], y: modelMatrix[1], z: modelMatrix[2] }), 
			ResolveVector3Axis({ x: modelMatrix[4], y: modelMatrix[5], z: modelMatrix[6] }), 
			ResolveVector3Axis({ x: modelMatrix[8], y: modelMatrix[9], z: modelMatrix[10] })
		],
	};
}

function computeAabbFromMesh(mesh) {
	return {
		type: "aabb",
		min: mesh.worldAabb.min.clone(),
		max: mesh.worldAabb.max.clone(),
	};
}

function computeSphereFromMesh(mesh) {
	const half = mesh.worldAabb.max.clone().subtract(mesh.worldAabb.min).scale(0.5);
	const radius = Math.sqrt(Vector3Sq(half));
	return {
		type: "sphere",
		center: mesh.worldAabb.min.clone().add(mesh.worldAabb.max).scale(0.5),
		radius: new Unit(Math.max(0.0001, radius), "cnu"),
	};
}

function computeCapsuleFromMesh(mesh) {
	const dim = mesh.worldAabb.max.clone().subtract(mesh.worldAabb.min);
	const radius = Math.max(0.0001, Math.max(dim.x, dim.z) * 0.5);
	const halfHeight = Math.max(0, (dim.y * 0.5) - radius);
	const start = mesh.worldAabb.min.clone().add(mesh.worldAabb.max).scale(0.5);
	const end = start.clone();
	start.y -= halfHeight;
	end.y += halfHeight;
	return {
		type: "capsule",
		radius: new Unit(radius, "cnu"),
		halfHeight: new Unit(halfHeight, "cnu"),
		segmentStart: start,
		segmentEnd: end,
	};
}

function computeTriangleSoupFromMesh(mesh) {
	const matrix = CreateModelMatrix(mesh.transform);
	const positions = mesh.geometry.positions;
	const readVertex = (vertexIndex) => {
		const vertex = transformPointByMatrix({
			x: positions[vertexIndex * 3],
			y: positions[(vertexIndex * 3) + 1],
			z: positions[(vertexIndex * 3) + 2],
		}, matrix);
		return new UnitVector3(vertex.x, vertex.y, vertex.z, "cnu");
	};

	const triangles = [];
	const indices = mesh.geometry.indices;
	for (let index = 0; index < indices.length; index += 3) {
		const a = readVertex(indices[index]);
		const b = readVertex(indices[index + 1]);
		const c = readVertex(indices[index + 2]);
		const ab = SubtractVector3(b, a);
		const ac = SubtractVector3(c, a);
		const n = CrossVector3(ab, ac);
		triangles.push({ a, b, c, normal: ResolveVector3Axis(n) });
	}

	return { type: "triangle-soup", triangles };
}

function computeDetailedBounds(mesh) {
	switch(mesh.collisionShape) {
		case "none"         : return null;
		case "sphere"       : return computeSphereFromMesh(mesh);
		case "capsule"      : return computeCapsuleFromMesh(mesh);
		case "triangle-soup": return computeTriangleSoupFromMesh(mesh);
		case "aabb"         : return computeAabbFromMesh(mesh);
		case "obb"          : return computeObbFromMesh(mesh);
	}
}

function resolveCylinderSegments(complexity) {
	switch (complexity) {
		case "low" : return 8;
		case "high": return 16;
		default    : return 12;
	}
}

function resolveSphereResolution(complexity) {
	switch(complexity) {
		case "low" : return { stacks: 6, slices: 8 };
		case "high": return { stacks: 18, slices: 24 };
		default    : return { stacks: 12, slices: 16 };
	}
}

function resolveCapsuleCapStacks(complexity) {
	switch(complexity) {
		case "low" : return 4;
		case "high": return 8;
		default    : return 6;
	}
}

function resolveTorusResolution(complexity) {
	switch(complexity) {
		case "low" : return { majorSegments: 12, minorSegments: 8 };
		case "high": return { majorSegments: 32, minorSegments: 16 };
		default    : return { majorSegments: 20, minorSegments: 12 };
	}
}

function resolveRampCurveSegments(complexity) {
	switch (complexity) {
		case "low" : return 4;
		case "high": return 12;
		default    : return 8;
	}
}

function appendRadialVertices(positions, radiusX, y, radiusZ, segments) {
	const start = positions.length / 3;
	const vertexIndices = [];

	for (let index = 0; index <= segments; index++) {
		const angle = (index / segments) * Math.PI * 2;
		positions.push(Math.cos(angle) * radiusX, y, Math.sin(angle) * radiusZ);
		vertexIndices.push((positions.length / 3) - 1);
	}

	return { start, vertexIndices };
}

function appendTriangleFanIndices(indices, centerIndex, ringStart, segments, reverseWinding = false) {
	for (let index = 0; index < segments; index++) {
		const current = ringStart + index;
		const next = ringStart + index + 1;
		if (reverseWinding) indices.push(centerIndex, next, current);
		else indices.push(centerIndex, current, next);
	}
}


function generateSphereUvs(positions) {
	const min = ToVector3(Infinity);
	const max = ToVector3(-Infinity);

	for (let index = 0; index < positions.length; index += 3) {
		const x = positions[index + 0];
		const y = positions[index + 1];
		const z = positions[index + 2];
		if (x < min.x) min.x = x;
		if (y < min.y) min.y = y;
		if (z < min.z) min.z = z;
		if (x > max.x) max.x = x;
		if (y > max.y) max.y = y;
		if (z > max.z) max.z = z;
	}

	const center = ScaleVector3(AddVector3(min, max), 0.5);
	const radius = ScaleVector3(SubtractVector3(max, min), 0.5);
	radius.x = Math.max(0.0001, radius.x);
	radius.y = Math.max(0.0001, radius.y);
	radius.z = Math.max(0.0001, radius.z);

	const uvs = [];
	for (let index = 0; index < positions.length; index += 3) {
		const x = (positions[index + 0] - center.x) / radius.x;
		const y = Clamp((positions[index + 1] - center.y) / radius.y, -1, 1);
		const z = (positions[index + 2] - center.z) / radius.z;
		const theta = Math.atan2(z, x);
		const phi = Math.acos(y);
		const u = (theta + Math.PI) / (Math.PI * 2);
		const v = phi / Math.PI;
		uvs.push(u, v);
	}

	return uvs;
}

function generateFaceProjectedUvs(positions, faceGroups) {
	function getProjectedAxesFromNormal(normal) {
		const n = AbsoluteVector3(normal);
		if (n.x >= n.y && n.x >= n.z) return ["z", "y"];
		if (n.y >= n.x && n.y >= n.z) return ["x", "z"];
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
	
	const vertexCount = positions.length / 3;
	const uvs = new Array(vertexCount * 2).fill(0);

	for (let groupIndex = 0; groupIndex < faceGroups.length; groupIndex++) {
		const group = faceGroups[groupIndex];
		const [uAxis, vAxis] = getProjectedAxesFromNormal(group.normal);

		let minU = Infinity;
		let maxU = -Infinity;
		let minV = Infinity;
		let maxV = -Infinity;

		for (let index = 0; index < group.vertexIndices.length; index++) {
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

		for (let index = 0; index < group.vertexIndices.length; index++) {
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
	if (geometry.uvMode === "sphere") return generateSphereUvs(positions);
	return generateFaceProjectedUvs(positions, geometry.faceGroups);
}

function computeBounds(positions) {
	const bounds = {
		min: new UnitVector3(positions[0], positions[1], positions[2], "cnu"),
		max: new UnitVector3(positions[0], positions[1], positions[2], "cnu")
	};

	for (let index = 3; index < positions.length; index += 3) {
		const x = positions[index + 0];
		const y = positions[index + 1];
		const z = positions[index + 2];
		if (x < bounds.min.x) bounds.min.x = x;
		if (y < bounds.min.y) bounds.min.y = y;
		if (z < bounds.min.z) bounds.min.z = z;
		if (x > bounds.max.x) bounds.max.x = x;
		if (y > bounds.max.y) bounds.max.y = y;
		if (z > bounds.max.z) bounds.max.z = z;
	}

	return bounds;
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
	const firstWorld = transformPoint({ x: positions[0], y: positions[1], z: positions[2] }, transform);
	const min = CloneVector3(firstWorld);
	const max = CloneVector3(firstWorld);

	for (let index = 3; index < positions.length; index += 3) {
		const world = transformPoint({ x: positions[index], y: positions[index + 1], z: positions[index + 2] }, transform);
		if (world.x < min.x) min.x = world.x;
		if (world.y < min.y) min.y = world.y;
		if (world.z < min.z) min.z = world.z;
		if (world.x > max.x) max.x = world.x;
		if (world.y > max.y) max.y = world.y;
		if (world.z > max.z) max.z = world.z;
	}

	return {
		min: new UnitVector3(min.x, min.y, min.z, "cnu"),
		max: new UnitVector3(max.x, max.y, max.z, "cnu"),
	};
}

function buildCube(size) {
	const sx = Math.max(0.0001, size.x) / 2;
	const sy = Math.max(0.0001, size.y) / 2;
	const sz = Math.max(0.0001, size.z) / 2;

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
		{ normal: WORLD_NORMALS.Forward, vertexIndices: [0, 1, 2, 3] },
		{ normal: WORLD_NORMALS.Backward, vertexIndices: [4, 5, 6, 7] },
		{ normal: WORLD_NORMALS.Left, vertexIndices: [8, 9, 10, 11] },
		{ normal: WORLD_NORMALS.Right, vertexIndices: [12, 13, 14, 15] },
		{ normal: WORLD_NORMALS.Up, vertexIndices: [16, 17, 18, 19] },
		{ normal: WORLD_NORMALS.Down, vertexIndices: [20, 21, 22, 23] },
	];

	return { positions, indices, faceGroups };
}

function buildPyramid(size) {
	const sx = size.x / 2;
	const sy = size.y;
	const sz = size.z / 2;
	const baseFrontLeft = { x: -sx, y: 0, z: sz };
	const baseFrontRight = { x: sx, y: 0, z: sz };
	const baseBackRight = { x: sx, y: 0, z: -sz };
	const baseBackLeft = { x: -sx, y: 0, z: -sz };
	const apex = { x: 0, y: sy, z: 0 };

	const positions = [];
	const indices = [];
	const faceGroups = [];

	const pushVertex = (vertex) => {
		const vertexIndex = positions.length / 3;
		positions.push(vertex.x, vertex.y, vertex.z);
		return vertexIndex;
	};

	const addQuadFace = (a, b, c, d, normal) => {
		const start = pushVertex(a);
		pushVertex(b);
		pushVertex(c);
		pushVertex(d);
		indices.push(start, start + 1, start + 2);
		indices.push(start, start + 2, start + 3);
		faceGroups.push({ normal: normal, vertexIndices: [start, start + 1, start + 2, start + 3] });
	};

	const addTriangleFace = (a, b, c) => {
		const start = pushVertex(a);
		pushVertex(b);
		pushVertex(c);
		indices.push(start, start + 1, start + 2);
		const normal = ResolveVector3Axis(CrossVector3(SubtractVector3(b, a), SubtractVector3(c, a)));
		faceGroups.push({ normal: normal, vertexIndices: [start, start + 1, start + 2] });
	};

	addQuadFace(baseFrontLeft, baseFrontRight, baseBackRight, baseBackLeft, WORLD_NORMALS.Up);
	addTriangleFace(baseFrontLeft, baseFrontRight, apex);
	addTriangleFace(baseFrontRight, baseBackRight, apex);
	addTriangleFace(baseBackRight, baseBackLeft, apex);
	addTriangleFace(baseBackLeft, baseFrontLeft, apex);

	return { positions: positions, indices: indices, faceGroups: faceGroups };
}

function buildPlane(size) {
	const sx = size.x / 2;
	const sz = size.z / 2;

	return {
		positions: [
			-sx, 0, sz,
			sx, 0, sz,
			sx, 0, -sz,
			-sx, 0, -sz,
		],
		indices: [0, 1, 2, 0, 2, 3],
		faceGroups: [{ normal: WORLD_NORMALS.Up, vertexIndices: [0, 1, 2, 3] }],
	};
}

function buildCylinder(size, complexity) {
	const radius = DivideVector3(size, ToVector3(2));
	const segments = resolveCylinderSegments(complexity);

	const positions = [];
	const indices = [];
	const faceGroups = [];

	const pushVertex = (x, y, z) => {
		const vertexIndex = positions.length / 3;
		positions.push(x, y, z);
		return vertexIndex;
	};

	for (let index = 0; index < segments; index++) {
		const startAngle = (index / segments) * Math.PI * 2;
		const endAngle = ((index + 1) / segments) * Math.PI * 2;
		const startX = Math.cos(startAngle) * radius.x;
		const startZ = Math.sin(startAngle) * radius.z;
		const endX = Math.cos(endAngle) * radius.x;
		const endZ = Math.sin(endAngle) * radius.z;
		const start = pushVertex(startX, -radius.y, startZ);
		pushVertex(startX, radius.y, startZ);
		pushVertex(endX, radius.y, endZ);
		pushVertex(endX, -radius.y, endZ);
		indices.push(start, start + 1, start + 2);
		indices.push(start, start + 2, start + 3);
		const midAngle = startAngle + ((endAngle - startAngle) * 0.5);
		faceGroups.push({
			normal: { x: Math.cos(midAngle), y: 0, z: Math.sin(midAngle) },
			vertexIndices: [start, start + 1, start + 2, start + 3],
		});
	}

	const topCenter = pushVertex(0, radius.y, 0);
	const topRing = appendRadialVertices(positions, radius.x, radius.y, radius.z, segments);
	const topVertices = [topCenter, ...topRing.vertexIndices];
	appendTriangleFanIndices(indices, topCenter, topRing.start, segments);

	faceGroups.push({ normal: WORLD_NORMALS.Up, vertexIndices: topVertices });

	const bottomCenter = pushVertex(0, -radius.y, 0);
	const bottomRing = appendRadialVertices(positions, radius.x, -radius.y, radius.z, segments);
	const bottomVertices = [bottomCenter, ...bottomRing.vertexIndices];
	appendTriangleFanIndices(indices, bottomCenter, bottomRing.start, segments, true);

	faceGroups.push({ normal: WORLD_NORMALS.Down, vertexIndices: bottomVertices });

	return { positions: positions, indices: indices, faceGroups: faceGroups };
}

function buildSphere(size, complexity) {
	const radius = DivideVector3(size, ToVector3(2));
	const resolution = resolveSphereResolution(complexity);
	const stacks = resolution.stacks;
	const slices = resolution.slices;

	const positions = [];
	const indices = [];

	for (let stack = 0; stack <= stacks; stack++) {
		const v = stack / stacks;
		const phi = v * Math.PI;
		for (let slice = 0; slice <= slices; slice++) {
			const u = slice / slices;
			const theta = u * Math.PI * 2;
			const x = Math.cos(theta) * Math.sin(phi) * radius.x;
			const y = Math.cos(phi) * radius.y;
			const z = Math.sin(theta) * Math.sin(phi) * radius.z;
			positions.push(x, y, z);
		}
	}

	for (let stack = 0; stack < stacks; stack++) {
		for (let slice = 0; slice < slices; slice++) {
			const first = stack * (slices + 1) + slice;
			const second = first + slices + 1;
			indices.push(first, second, first + 1);
			indices.push(second, second + 1, first + 1);
		}
	}

	return { positions: positions, indices: indices, uvMode: "sphere" };
}

function buildCone(size, complexity) {
	const radius = DivideVector3(size, ToVector3(2));
	const segments = resolveCylinderSegments(complexity);

	const positions = [];
	const indices = [];
	const sideVertexIndices = [];
	const baseVertexIndices = [];

	const apexIndex = positions.length / 3;
	positions.push(0, radius.y, 0);
	sideVertexIndices.push(apexIndex);

	const sideRing = appendRadialVertices(positions, radius.x, -radius.y, radius.z, segments);
	sideVertexIndices.push(...sideRing.vertexIndices);

	for (let index = 0; index < segments; index++) indices.push(apexIndex, sideRing.start + index, sideRing.start + index + 1);

	const baseCenter = positions.length / 3;
	positions.push(0, -radius.y, 0);
	baseVertexIndices.push(baseCenter);

	const baseRing = appendRadialVertices(positions, radius.x, -radius.y, radius.z, segments);
	baseVertexIndices.push(...baseRing.vertexIndices);
	appendTriangleFanIndices(indices, baseCenter, baseRing.start, segments, true);

	return {
		positions: positions,
		indices: indices,
		faceGroups: [
			{ normal: WORLD_NORMALS.Up, vertexIndices: sideVertexIndices },
			{ normal: WORLD_NORMALS.Down, vertexIndices: baseVertexIndices },
		],
	};
}

function buildCapsule(size, complexity) {
	const radius = DivideVector3(size, ToVector3(2));
	const capRadius = Clamp(radius.z, 0.0001, radius.x);
	const cylinderHalf = Math.max(0, radius.y - capRadius);
	const segments = resolveCylinderSegments(complexity);
	const capStacks = resolveCapsuleCapStacks(complexity);

	const positions = [];
	const indices = [];
	const rings = [];

	const pushRing = (y, ringScaleX, ringScaleZ, groupName) => {
		const ring = appendRadialVertices(positions, ringScaleX, y, ringScaleZ, segments);
		rings.push({ start: ring.start, group: groupName });
	};

	for (let stack = 0; stack <= capStacks; stack++) {
		const angle = (stack / capStacks) * Math.PI * 0.5;
		const ringScale = Math.sin(angle);
		const y = cylinderHalf + Math.cos(angle) * capRadius;
		pushRing(y, radius.x * ringScale, radius.z * ringScale, "top");
	}

	pushRing(-cylinderHalf, radius.x, radius.z, "body");

	for (let stack = 1; stack <= capStacks; stack++) {
		const angle = (stack / capStacks) * Math.PI * 0.5;
		const ringScale = Math.cos(angle);
		const y = -cylinderHalf - Math.sin(angle) * capRadius;
		pushRing(y, radius.x * ringScale, radius.z * ringScale, "bottom");
	}

	const topVertices = [];
	const bodyVertices = [];
	const bottomVertices = [];

	for (let ring = 0; ring < rings.length - 1; ring++) {
		for (let index = 0; index < segments; index++) {
			const a = rings[ring].start + index;
			const b = rings[ring].start + index++;
			const c = rings[ring + 1].start + index;
			const d = rings[ring + 1].start + index + 1;

			indices.push(a, c, b);
			indices.push(b, c, d);

			if (rings[ring].group === "top" && rings[ring + 1].group === "top") topVertices.push(a, b, c, d);
			else if (rings[ring].group === "bottom" && rings[ring + 1].group === "bottom") bottomVertices.push(a, b, c, d);
			else bodyVertices.push(a, b, c, d);
		}
	}

	return {
		positions, indices,
		faceGroups: [
			{ normal: WORLD_NORMALS.Up, vertexIndices: topVertices },
			{ normal: WORLD_NORMALS.Right, vertexIndices: bodyVertices },
			{ normal: WORLD_NORMALS.Down, vertexIndices: bottomVertices },
		],
	};
}

function buildTube(size, complexity, options) {
	const outerRadius = DivideVector3(size, ToVector3(2));
	const thickness = options.thickness ?? Clamp(outerRadius.z, 0.00005, outerRadius.x) * 0.25;
	const innerRadiusX = Math.max(0.00005, outerRadius.x - Math.min(thickness, outerRadius.x * 0.95));
	const innerRadiusZ = Math.max(0.00005, outerRadius.z - Math.min(thickness, outerRadius.z * 0.95));
	const segments = resolveCylinderSegments(complexity);

	const positions = [];
	const indices = [];

	const outerBottomStart = appendRadialVertices(positions, outerRadius.x, -outerRadius.y, outerRadius.z, segments).start;
	const outerTopStart = appendRadialVertices(positions, outerRadius.x, outerRadius.y, outerRadius.z, segments).start;
	const innerBottomStart = appendRadialVertices(positions, innerRadiusX, -outerRadius.y, innerRadiusZ, segments).start;
	const innerTopStart = appendRadialVertices(positions, innerRadiusX, outerRadius.y, innerRadiusZ, segments).start;

	for (let index = 0; index < segments; index++) {
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

	for (let index = 0; index <= segments; index++) {
		outerVertices.push(outerBottomStart + index, outerTopStart + index);
		innerVertices.push(innerBottomStart + index, innerTopStart + index);
		topVertices.push(outerTopStart + index, innerTopStart + index);
		bottomVertices.push(outerBottomStart + index, innerBottomStart + index);
	}

	return {
		positions, indices,
		faceGroups: [
			{ normal: WORLD_NORMALS.Right, vertexIndices: outerVertices },
			{ normal: WORLD_NORMALS.Left, vertexIndices: innerVertices },
			{ normal: WORLD_NORMALS.Up, vertexIndices: topVertices },
			{ normal: WORLD_NORMALS.Down, vertexIndices: bottomVertices },
		],
	};
}

function buildTorus(size, complexity, options) {
	const majorRadius = Math.max(0.0002, ToNumber(options.radius, size.x / 2));
	const minorRadius = Math.max(0.0001, Math.min(ToNumber(options.thickness, size.y / 4), majorRadius * 0.95));
	const resolution = resolveTorusResolution(complexity);
	const majorSegments = resolution.majorSegments;
	const minorSegments = resolution.minorSegments;

	const positions = [];
	const indices = [];

	for (let major = 0; major <= majorSegments; major++) {
		const u = (major / majorSegments) * Math.PI * 2;
		const cosU = Math.cos(u);
		const sinU = Math.sin(u);

		for (let minor = 0; minor <= minorSegments; minor++) {
			const v = (minor / minorSegments) * Math.PI * 2;
			const cosV = Math.cos(v);
			const sinV = Math.sin(v);
			const ringRadius = majorRadius + (minorRadius * cosV);
			positions.push(ringRadius * cosU, minorRadius * sinV, ringRadius * sinU);
		}
	}

	const stride = minorSegments + 1;
	for (let major = 0; major < majorSegments; major++) {
		for (let minor = 0; minor < minorSegments; minor++) {
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
	for (let sector = 0; sector < sectorCount; sector++) {
		const startMajor = Math.floor((sector / sectorCount) * majorSegments);
		const endMajor = Math.floor(((sector + 1) / sectorCount) * majorSegments);
		const vertexIndices = [];
		for (let major = startMajor; major <= endMajor + 1; major++) {
			const wrappedMajor = Math.min(major, majorSegments);
			for (let minor = 0; minor <= minorSegments; minor++) {
				vertexIndices.push((wrappedMajor * stride) + minor);
			}
		}

		const sectorMid = ((startMajor + endMajor) * 0.5 / majorSegments) * Math.PI * 2;
		faceGroups.push({ normal: { x: Math.cos(sectorMid), y: 0, z: Math.sin(sectorMid) }, vertexIndices });
	}

	return { positions, indices, faceGroups };
}

function resolveRampShape(size, options) {
	const halfDepth = size.z / 2;
	const baseY = -size.y / 2;
	const desiredRise = Math.tan(options.angle) * (halfDepth * 2);
	const rise = Clamp(Math.abs(desiredRise) > 0 ? desiredRise : size.y, 0.0001, size.y);
	return { halfWidth: size.x / 2, halfDepth, baseY, rise, backY: baseY + rise };
}

function buildRampSimple(size, options) {
	const ramp = resolveRampShape(size, options);
	const positions = [
		-ramp.halfWidth, ramp.baseY, -ramp.halfDepth,
		ramp.halfWidth, ramp.baseY, -ramp.halfDepth,
		ramp.halfWidth, ramp.baseY, ramp.halfDepth,
		-ramp.halfWidth, ramp.baseY, ramp.halfDepth,
		ramp.halfWidth, ramp.backY, ramp.halfDepth,
		-ramp.halfWidth, ramp.backY, ramp.halfDepth,
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

	const slopeAngle = Math.atan2(ramp.rise, ramp.halfDepth * 2);
	return {
		positions: positions,
		indices: indices,
		faceGroups: [
			{ normal: WORLD_NORMALS.Down, vertexIndices: [0, 1, 2, 3] },
			{ normal: WORLD_NORMALS.Forward, vertexIndices: [2, 3, 4, 5] },
			{ normal: { x: 0, y: Math.cos(slopeAngle), z: -Math.sin(slopeAngle) }, vertexIndices: [0, 1, 4, 5] },
			{ normal: WORLD_NORMALS.Left, vertexIndices: [0, 3, 5] },
			{ normal: WORLD_NORMALS.Right, vertexIndices: [1, 2, 4] },
		],
	};
}

function buildRampComplex(size, complexity, options) {
	const ramp = resolveRampShape(size, options);
	const segments = resolveRampCurveSegments(complexity);
	const positions = [];
	const indices = [];
	const topLeftIndices = [];
	const topRightIndices = [];
	const bottomLeftIndices = [];
	const bottomRightIndices = [];

	for (let index = 0; index <= segments; index++) {
		const t = index / segments;
		const z = -ramp.halfDepth + ((ramp.halfDepth * 2) * t);
		const y = ramp.baseY + (ramp.rise * (1 - Math.cos(t * Math.PI * 0.5)));
		topLeftIndices.push(positions.length / 3);
		positions.push(-ramp.halfWidth, y, z);
		topRightIndices.push(positions.length / 3);
		positions.push(ramp.halfWidth, y, z);
	}

	for (let index = 0; index <= segments; index++) {
		const t = index / segments;
		const z = -ramp.halfDepth + ((ramp.halfDepth * 2) * t);
		bottomLeftIndices.push(positions.length / 3);
		positions.push(-ramp.halfWidth, ramp.baseY, z);
		bottomRightIndices.push(positions.length / 3);
		positions.push(ramp.halfWidth, ramp.baseY, z);
	}

	for (let index = 0; index < segments; index++) {
		const topLeft = topLeftIndices[index];
		const topRight = topRightIndices[index];
		const nextTopLeft = topLeftIndices[index + 1];
		const nextTopRight = topRightIndices[index + 1];
		const bottomLeft = bottomLeftIndices[index];
		const bottomRight = bottomRightIndices[index];
		const nextBottomLeft = bottomLeftIndices[index + 1];
		const nextBottomRight = bottomRightIndices[index + 1];

		indices.push(topLeft, nextTopLeft, nextTopRight);
		indices.push(topLeft, nextTopRight, topRight);

		indices.push(bottomLeft, bottomRight, nextBottomRight);
		indices.push(bottomLeft, nextBottomRight, nextBottomLeft);

		indices.push(bottomLeft, nextBottomLeft, nextTopLeft);
		indices.push(bottomLeft, nextTopLeft, topLeft);

		indices.push(bottomRight, nextTopRight, nextBottomRight);
		indices.push(bottomRight, topRight, nextTopRight);
	}

	const backTopLeft = topLeftIndices[topLeftIndices.length - 1];
	const backTopRight = topRightIndices[topRightIndices.length - 1];
	const backBottomLeft = bottomLeftIndices[bottomLeftIndices.length - 1];
	const backBottomRight = bottomRightIndices[bottomRightIndices.length - 1];
	indices.push(backBottomLeft, backBottomRight, backTopRight);
	indices.push(backBottomLeft, backTopRight, backTopLeft);

	const topVertexIndices = [];
	const bottomVertexIndices = [];
	const leftVertexIndices = [];
	const rightVertexIndices = [];
	for (let index = 0; index <= segments; index++) {
		topVertexIndices.push(topLeftIndices[index], topRightIndices[index]);
		bottomVertexIndices.push(bottomLeftIndices[index], bottomRightIndices[index]);
		leftVertexIndices.push(bottomLeftIndices[index], topLeftIndices[index]);
		rightVertexIndices.push(bottomRightIndices[index], topRightIndices[index]);
	}

	const slopeAngle = Math.atan2(ramp.rise, ramp.halfDepth * 2);
	return {
		positions: positions,
		indices: indices,
		faceGroups: [
			{ normal: WORLD_NORMALS.Down, vertexIndices: bottomVertexIndices },
			{ normal: WORLD_NORMALS.Forward, vertexIndices: [backBottomLeft, backBottomRight, backTopRight, backTopLeft] },
			{ normal: { x: 0, y: Math.cos(slopeAngle), z: -Math.sin(slopeAngle) }, vertexIndices: topVertexIndices },
			{ normal: WORLD_NORMALS.Left, vertexIndices: leftVertexIndices },
			{ normal: WORLD_NORMALS.Right, vertexIndices: rightVertexIndices },
		],
	};
}

function BuildGeometry(shape, size, complexity, primitiveOptions = {}) {
	switch (shape) {
		case "cube"        : return buildCube(size);
		case "cylinder"    : return buildCylinder(size, complexity);
		case "sphere"      : return buildSphere(size, complexity);
		case "capsule"     : return buildCapsule(size, complexity);
		case "cone"        : return buildCone(size, complexity);
		case "ramp-simple" : return buildRampSimple(size, primitiveOptions);
		case "ramp-complex": return buildRampComplex(size, complexity, primitiveOptions);
		case "tube"        : return buildTube(size, complexity, primitiveOptions);
		case "torus"       : return buildTorus(size, complexity, primitiveOptions);
		case "pyramid"     : return buildPyramid(size);
		case "plane"       : return buildPlane(size);
	}
}

function BuildObject(source) {
	// Upstream must supply normalized/canonical objects (UnitVector3 for world-space values).
	// Mandatory fields are used directly; optional fields are assumed normalized.
	const shape = source.shape.toLowerCase();
	const complexity = source.complexity;

	// Upstream must provide normalized texture, scatter and primitive option objects.
	// Expect world-space values to be provided as UnitVector3 instances already.
	const primitiveOptions = source.primitiveOptions;
	const geometry = BuildGeometry(shape, source.dimensions, complexity, primitiveOptions);
	const bounds = computeBounds(geometry.positions);
	const transform = {
		position: source.position,         // UnitVector3
		rotation: source.rotation,         // UnitVector3
		scale   : source.scale,            // Vector3
		pivot   : source.pivot,            // UnitVector3
	};
	const texture = source.texture;

	const mesh = {
		id        : source.id,
		type      : "mesh3d",
		shape,
		primitive : shape,
		complexity,
		role      : source.role,
		transform,
		geometry  : {
			positions: geometry.positions,
			indices  : geometry.indices,
			uvs      : GenerateUVs(geometry.positions, geometry),
			bounds,
		},
		material: {
			textureID  : texture.materialTextureID,
			color      : texture.color,
			opacity    : texture.opacity,
			transparent: texture.opacity < 1,
		},
		meta: {
			trigger  : source.trigger,
			platform : source.platform,
			parentId : source.parentId,
			nullSpace: source.nullSpace,
			sticky   : source.sticky,
		},
		detail: {
			texture,
			scatter: source.detail.scatter,
			complexity, primitiveOptions,
		},
		localBounds   : bounds,
		worldAabb     : computeWorldAabbFromGeometry(geometry.positions, transform),
		dimensions    : source.dimensions,
		collisionShape: source.collisionShape,
		detailedBounds: null,
	};
	mesh.detailedBounds = computeDetailedBounds(mesh);

	const scatterContext = source.scatterContext;
	if (scatterContext && mesh.detail.scatter.length > 0) {
		const generatedScatter = BuildScatter({
			objectMesh       : mesh,
			scatterMultiplier: scatterContext.scatterMultiplier,
			world            : scatterContext.world,
			indexSeed        : scatterContext.indexSeed,
			explicitScatter  : mesh.detail.scatter,
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
	mesh.detailedBounds = computeDetailedBounds(mesh);
	return mesh.worldAabb;
}

export { BuildObject, UpdateObjectWorldAabb, BuildGeometry, GenerateUVs };