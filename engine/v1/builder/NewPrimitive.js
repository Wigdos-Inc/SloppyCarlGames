// Contains all available different primitives and returns those to NewObject.js

import { EPSILON } from "../core/meta.js";
import { CreateIdentityMatrix, CreateModelMatrix, MultiplyMatrix4, TransformPointByMatrix } from "../math/Matrix.js";
import { TriangleNormal } from "../math/Collision.js";
import { SampleConnectorCenterline, ParallelTransportFrames } from "../math/Curves.js";
import { ToNumber } from "../math/Utilities.js";
import {
	AddVector3, ArrayToVector3, CrossVector3, DotVector3, ResolveVector3Axis, ScaleVector3, SubtractVector3,
	ToVector3, Vector3Distance, Vector3ToArray, WORLD_NORMALS
} from "../math/Vector3.js";

// Multiples of 4 so a flat side faces each 90° direction.
function resolveCylinderSegments(complexity) {
	switch (complexity) {
		case "low" : return 8;
		case "high": return 16;
		default    : return 12;
	}
}

// Odd stacks put a flat band across the equator; slices are multiples of 4 like cylinder segments.
function resolveSphereResolution(complexity) {
	switch(complexity) {
		case "low" : return { stacks: 7, slices: 8 };
		case "high": return { stacks: 19, slices: 24 };
		default    : return { stacks: 13, slices: 16 };
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

// Divide segmentCount into angular sectors: start/end column + mid-angle (radians). Shared by torus/tube face groups.
function resolveSectorRange(sector, sectorCount, segmentCount) {
	const start = Math.floor((sector / sectorCount) * segmentCount);
	const end = Math.floor(((sector + 1) / sectorCount) * segmentCount);
	return { start, end, midAngle: ((start + end) * 0.5 / segmentCount) * Math.PI * 2 };
}

function appendRadialVertices(positions, radiusX, y, radiusZ, segments, angleOffset = 0) {
	const start = positions.length / 3;
	const vertexIndices = [];
	for (let index = 0; index <= segments; index++) {
		const angle = ((index / segments) * Math.PI * 2) + angleOffset;
		positions.push(Math.cos(angle) * radiusX, y, Math.sin(angle) * radiusZ);
		vertexIndices.push((start) - 1);
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

function buildCube(size) {
	const s = size.clone().max(ToVector3(0.0001)).scale(0.5);

	const positions = [
		-s.x, -s.y,  s.z,  s.x, -s.y,  s.z,  s.x,  s.y,  s.z, -s.x,  s.y,  s.z,
		 s.x, -s.y, -s.z, -s.x, -s.y, -s.z, -s.x,  s.y, -s.z,  s.x,  s.y, -s.z,
		-s.x, -s.y, -s.z, -s.x, -s.y,  s.z, -s.x,  s.y,  s.z, -s.x,  s.y, -s.z,
		 s.x, -s.y,  s.z,  s.x, -s.y, -s.z,  s.x,  s.y, -s.z,  s.x,  s.y,  s.z,
		-s.x,  s.y,  s.z,  s.x,  s.y,  s.z,  s.x,  s.y, -s.z, -s.x,  s.y, -s.z,
		-s.x, -s.y, -s.z,  s.x, -s.y, -s.z,  s.x, -s.y,  s.z, -s.x, -s.y,  s.z,
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
		{ normal: WORLD_NORMALS.Forward,  vertexIndices: [0,  1,  2,  3],  indexStart: 0,  indexCount: 6 },
		{ normal: WORLD_NORMALS.Backward, vertexIndices: [4,  5,  6,  7],  indexStart: 6,  indexCount: 6 },
		{ normal: WORLD_NORMALS.Left,     vertexIndices: [8,  9,  10, 11], indexStart: 12, indexCount: 6 },
		{ normal: WORLD_NORMALS.Right,    vertexIndices: [12, 13, 14, 15], indexStart: 18, indexCount: 6 },
		{ normal: WORLD_NORMALS.Up,       vertexIndices: [16, 17, 18, 19], indexStart: 24, indexCount: 6 },
		{ normal: WORLD_NORMALS.Down,     vertexIndices: [20, 21, 22, 23], indexStart: 30, indexCount: 6 },
	];

	return { positions, indices, faceGroups };
}

function buildPyramid(size) {
	const s = size.clone().scale(0.5);
	const baseFrontLeft  = { x: -s.x, y: -s.y, z:  s.z };
	const baseFrontRight = { x:  s.x, y: -s.y, z:  s.z };
	const baseBackRight  = { x:  s.x, y: -s.y, z: -s.z };
	const baseBackLeft   = { x: -s.x, y: -s.y, z: -s.z };
	const apex = { x: 0, y: s.y, z: 0 };

	const positions = [];
	const indices = [];
	const faceGroups = [];

	const pushVertex = (vertex) => {
		positions.push(...Vector3ToArray(vertex));
		return (positions.length / 3) - 1;
	};

	const addQuadFace = (a, b, c, d, normal) => {
		const indexStart = indices.length;
		const start = pushVertex(a);
		pushVertex(b);
		pushVertex(c);
		pushVertex(d);
		indices.push(start, start + 1, start + 2);
		indices.push(start, start + 2, start + 3);
		faceGroups.push({ normal, vertexIndices: [start, start + 1, start + 2, start + 3], indexStart, indexCount: 6 });
	};

	const addTriangleFace = (a, b, c) => {
		const indexStart = indices.length;
		const start = pushVertex(a);
		pushVertex(b);
		pushVertex(c);
		indices.push(start, start + 1, start + 2);
		faceGroups.push({ normal: TriangleNormal(a, b, c), vertexIndices: [start, start + 1, start + 2], indexStart, indexCount: 3 });
	};

	addQuadFace(baseBackLeft, baseBackRight, baseFrontRight, baseFrontLeft, WORLD_NORMALS.Down);
	addTriangleFace(baseFrontLeft, baseFrontRight, apex);
	addTriangleFace(baseFrontRight, baseBackRight, apex);
	addTriangleFace(baseBackRight, baseBackLeft, apex);
	addTriangleFace(baseBackLeft, baseFrontLeft, apex);

	return { positions, indices, faceGroups };
}

function buildPlane(size) {
	const sx = size.x * 0.5;
	const sz = size.z * 0.5;

	return {
		positions: [
			-sx, 0, sz,
			sx, 0, sz,
			sx, 0, -sz,
			-sx, 0, -sz,
		],
		indices: [0, 1, 2, 0, 2, 3],
		faceGroups: [{ normal: WORLD_NORMALS.Up, vertexIndices: [0, 1, 2, 3], indexStart: 0, indexCount: 6 }],
	};
}

function buildCylinder(size, complexity) {
	const radius = size.clone().scale(0.5);
	const segments = resolveCylinderSegments(complexity);

	// Half-segment turn so the cylinder lies on a flat side when rotated 90°.
	const angleOffset = Math.PI / segments;

	const positions = [];
	const indices = [];
	const faceGroups = [];

	const pushVertex = (x, y, z) => {
		positions.push(x, y, z);
		return (positions.length / 3) - 1;
	};

	for (let index = 0; index < segments; index++) {
		const startAngle = ((index / segments) * Math.PI * 2) + angleOffset;
		const endAngle = (((index + 1) / segments) * Math.PI * 2) + angleOffset;
		const startX = Math.cos(startAngle) * radius.x;
		const startZ = Math.sin(startAngle) * radius.z;
		const endX = Math.cos(endAngle) * radius.x;
		const endZ = Math.sin(endAngle) * radius.z;
		const start = pushVertex(startX, -radius.y, startZ);
		pushVertex(startX, radius.y, startZ);
		pushVertex(endX, radius.y, endZ);
		pushVertex(endX, -radius.y, endZ);

		const indexStart = indices.length;
		indices.push(start, start + 1, start + 2);
		indices.push(start, start + 2, start + 3);
		const midAngle = startAngle + ((endAngle - startAngle) * 0.5);
		faceGroups.push({
			normal: { x: Math.cos(midAngle), y: 0, z: Math.sin(midAngle) },
			vertexIndices: [start, start + 1, start + 2, start + 3],
			indexStart,
			indexCount: 6,
		});
	}

	const topCenter = pushVertex(0, radius.y, 0);
	const topRing = appendRadialVertices(positions, radius.x, radius.y, radius.z, segments, angleOffset);
	const topIndexStart = indices.length;
	appendTriangleFanIndices(indices, topCenter, topRing.start, segments, true);
	faceGroups.push({ normal: WORLD_NORMALS.Up, vertexIndices: [topCenter, ...topRing.vertexIndices], indexStart: topIndexStart, indexCount: indices.length - topIndexStart });

	const bottomCenter = pushVertex(0, -radius.y, 0);
	const bottomRing = appendRadialVertices(positions, radius.x, -radius.y, radius.z, segments, angleOffset);
	const bottomIndexStart = indices.length;
	appendTriangleFanIndices(indices, bottomCenter, bottomRing.start, segments);
	faceGroups.push({ normal: WORLD_NORMALS.Down, vertexIndices: [bottomCenter, ...bottomRing.vertexIndices], indexStart: bottomIndexStart, indexCount: indices.length - bottomIndexStart });

	return { positions, indices, faceGroups };
}

function buildSphere(size, complexity) {
	const radius = size.clone().scale(0.5);
	const resolution = resolveSphereResolution(complexity);

	const positions = [];
	const indices = [];
	const uvs = [];

	for (let stack = 0; stack <= resolution.stacks; stack++) {
		const v = stack / resolution.stacks;
		const phi = v * Math.PI;
		for (let slice = 0; slice <= resolution.slices; slice++) {
			const u = slice / resolution.slices;

			// Half-slice turn so the sphere lies on a flat face when rotated 90°.
			const theta = (u * Math.PI * 2) + (Math.PI / resolution.slices);
			const x = Math.cos(theta) * Math.sin(phi) * radius.x;
			const y = Math.cos(phi) * radius.y;
			const z = Math.sin(theta) * Math.sin(phi) * radius.z;
			positions.push(x, y, z);
			uvs.push(u, v);
		}
	}

	for (let stack = 0; stack < resolution.stacks; stack++) {
		for (let slice = 0; slice < resolution.slices; slice++) {
			const first = stack * (resolution.slices + 1) + slice;
			const second = first + resolution.slices + 1;

			// Squares touching a pole only need one of their two triangles.
			if (stack !== 0) indices.push(first, first + 1, second);
			if (stack !== resolution.stacks - 1) indices.push(second, first + 1, second + 1);
		}
	}

	return { positions, indices, uvs, uvMode: "sphere" };
}

function buildCone(size, complexity) {
	const radius = size.clone().scale(0.5);
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

	const sideIndexStart = indices.length;
	for (let index = 0; index < segments; index++) indices.push(apexIndex, sideRing.start + index + 1, sideRing.start + index);
	const sideIndexCount = indices.length - sideIndexStart;

	const baseCenter = positions.length / 3;
	positions.push(0, -radius.y, 0);
	baseVertexIndices.push(baseCenter);

	const baseRing = appendRadialVertices(positions, radius.x, -radius.y, radius.z, segments);
	baseVertexIndices.push(...baseRing.vertexIndices);
	const baseIndexStart = indices.length;
	appendTriangleFanIndices(indices, baseCenter, baseRing.start, segments);

	return {
		positions, indices,
		faceGroups: [
			{ normal: WORLD_NORMALS.Up,   vertexIndices: sideVertexIndices, indexStart: sideIndexStart, indexCount: sideIndexCount },
			{ normal: WORLD_NORMALS.Down, vertexIndices: baseVertexIndices, indexStart: baseIndexStart, indexCount: indices.length - baseIndexStart },
		],
	};
}

// rounding: share of each half-height taken by its cap.
function buildCapsule(size, complexity, options) {
	const radius = size.clone().scale(0.5);
	const capHeight = radius.y * options.rounding;
	const cylinderHalf = radius.y - capHeight;
	const segments = resolveCylinderSegments(complexity);
	const capStacks = resolveCapsuleCapStacks(complexity);

	// Half-segment turn so the capsule lies on a flat side when rotated 90°.
	const angleOffset = Math.PI / segments;

	const positions = [];
	const indices = [];
	const rings = [];

	const pushRing = (y, ringScaleX, ringScaleZ, groupName) => {
		rings.push({ start: appendRadialVertices(positions, ringScaleX, y, ringScaleZ, segments, angleOffset).start, group: groupName });
	};

	for (let stack = 0; stack <= capStacks; stack++) {
		const angle = (stack / capStacks) * Math.PI * 0.5;
		const ringScale = Math.sin(angle);
		pushRing(cylinderHalf + Math.cos(angle) * capHeight, radius.x * ringScale, radius.z * ringScale, "top");
	}

	pushRing(-cylinderHalf, radius.x, radius.z, "body");

	for (let stack = 1; stack <= capStacks; stack++) {
		const angle = (stack / capStacks) * Math.PI * 0.5;
		const ringScale = Math.cos(angle);
		pushRing(-cylinderHalf - Math.sin(angle) * capHeight, radius.x * ringScale, radius.z * ringScale, "bottom");
	}

	const topVertices = [];
	const bodyVertices = [];
	const bottomVertices = [];

	for (let ring = 0; ring < rings.length - 1; ring++) {
		for (let index = 0; index < segments; index++) {
			const a = rings[ring].start + index;
			const b = rings[ring].start + index + 1;
			const c = rings[ring + 1].start + index;
			const d = rings[ring + 1].start + index + 1;

			indices.push(a, b, c);
			indices.push(b, d, c);

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

// Reads a tube node's center, axes and ring radii from its frame matrix (Y is the forward axis).
function makeTubeNode(frame, dimensionX, dimensionZ, thickness, curved, smoothness) {
	return {
		frame,
		center:  ArrayToVector3(frame, 12), forward: ArrayToVector3(frame, 4),
		xAxis:   ArrayToVector3(frame, 0), zAxis:   ArrayToVector3(frame, 8),
		radiusX: dimensionX * 0.5, radiusZ: dimensionZ * 0.5,
		thickness, curved, smoothness,
	};
}

// Walks the bone chain from an identity root frame, applying each node's transform on top of the previous frame.
function resolveTubeNodes(size, options) {
	const nodes = [makeTubeNode(CreateIdentityMatrix(), size.x, size.z, options.thickness.value, options.curved, options.smoothness)];
	let frame = nodes[0].frame;
	for (const node of options.nodes) {
		frame = MultiplyMatrix4(frame, CreateModelMatrix({
			position: node.localPosition,
			rotation: node.localRotation,
			scale: ToVector3(1),
			pivot: ToVector3(0),
		}));
		nodes.push(makeTubeNode(frame, node.dimensions.x, node.dimensions.z, node.thickness.value, node.curved, node.smoothness));
	}
	return nodes;
}

// One cross-section in local X-Z, placed by the frame matrix. Solid omits the inner ring.
function appendTubeRing(positions, matrix, radiusX, radiusZ, thickness, segments, solid) {
	const pushRing = (ringRadiusX, ringRadiusZ) => {
		const local = [];

		// Half-segment turn so the tube lies on a flat side when rotated 90°.
		appendRadialVertices(local, ringRadiusX, 0, ringRadiusZ, segments, Math.PI / segments);
		const vertexIndices = [];
		for (let i = 0; i < local.length / 3; i++) {
			positions.push(...Vector3ToArray(TransformPointByMatrix(ArrayToVector3(local, i, true), matrix)));
			vertexIndices.push((positions.length / 3) - 1);
		}
		return vertexIndices;
	};

	const outerIndices = pushRing(radiusX, radiusZ);
	if (solid) return { outerIndices, innerIndices: null };

	const innerX = Math.max(0.00005, radiusX - Math.min(thickness, radiusX * 0.95));
	const innerZ = Math.max(0.00005, radiusZ - Math.min(thickness, radiusZ * 0.95));
	return { outerIndices, innerIndices: pushRing(innerX, innerZ) };
}

function frameToTubeMatrix(frame, position) {
	return [
		...Vector3ToArray(frame.normal), 0, 
		...Vector3ToArray(frame.tangent), 0, 
		...Vector3ToArray(CrossVector3(frame.normal, frame.tangent)), 0, 
		...Vector3ToArray(position), 1
	];
}

function rollTubeFrame(frame, angle) {
	const normal = AddVector3(ScaleVector3(frame.normal, Math.cos(angle)), ScaleVector3(frame.binormal, Math.sin(angle)));
	return { tangent: frame.tangent, normal, binormal: CrossVector3(frame.tangent, normal) };
}

// Carries the cross-section along the connector, then spreads a roll so the end lines up with the target node's axis.
function orientConnectorFrames(points, startAxis, targetAxis) {
	const frames = ParallelTransportFrames(points, startAxis);
	const last = frames.length - 1;
	const endTangent = frames[last].tangent;
	const target = ResolveVector3Axis(SubtractVector3(targetAxis, ScaleVector3(endTangent, DotVector3(targetAxis, endTangent))));
	const residual = Math.atan2(
		DotVector3(CrossVector3(frames[last].normal, target), endTangent),
		DotVector3(frames[last].normal, target)
	);
	for (let i = 0; i <= last; i++) frames[i] = rollTubeFrame(frames[i], residual * (i / last));
	return frames;
}

function stitchTubeRings(indices, ringA, ringB, segments, solid) {
	for (let i = 0; i < segments; i++) {
		const oa0 = ringA.outerIndices[i], oa1 = ringA.outerIndices[i + 1];
		const ob0 = ringB.outerIndices[i], ob1 = ringB.outerIndices[i + 1];
		indices.push(oa0, ob0, ob1);
		indices.push(oa0, ob1, oa1);

		if (solid) continue;

		const ia0 = ringA.innerIndices[i], ia1 = ringA.innerIndices[i + 1];
		const ib0 = ringB.innerIndices[i], ib1 = ringB.innerIndices[i + 1];
		indices.push(ia0, ib1, ib0);
		indices.push(ia0, ia1, ib1);
	}
}

// Solid caps with a disc instead of an annulus.
function capTubeRing(indices, ring, segments, forward, solid) {
	if (solid) {
		const apex = ring.outerIndices[0];
		for (let i = 1; i < segments - 1; i++) {
			const o0 = ring.outerIndices[i], o1 = ring.outerIndices[i + 1];
			if (forward) indices.push(apex, o1, o0);
			else indices.push(apex, o0, o1);
		}
		return;
	}

	for (let i = 0; i < segments; i++) {
		const o0 = ring.outerIndices[i], o1 = ring.outerIndices[i + 1];
		const in0 = ring.innerIndices[i], in1 = ring.innerIndices[i + 1];
		if (forward) {
			indices.push(o0, in1, o1);
			indices.push(o0, in0, in1);
		} 
		else {
			indices.push(o0, o1, in1);
			indices.push(o0, in1, in0);
		}
	}
}

// Face groups per connector: angular sectors with radial normals, like buildTorus.
function appendTubeConnectorFaceGroups(faceGroups, rings, node, segments, solid) {
	const sectorCount = Math.min(8, segments);
	for (let sector = 0; sector < sectorCount; sector++) {
		const { start: startColumn, end: endColumn, midAngle } = resolveSectorRange(sector, sectorCount, segments);
		const outerVertices = [], innerVertices = [];
		for (const ring of rings) {
			for (let column = startColumn; column <= endColumn; column++) {
				outerVertices.push(ring.outerIndices[column]);
				if (!solid) innerVertices.push(ring.innerIndices[column]);
			}
		}

		// Matches the ring's half-segment turn.
		const angle = midAngle + (Math.PI / segments);
		const radial = AddVector3(ScaleVector3(node.xAxis, Math.cos(angle)), ScaleVector3(node.zAxis, Math.sin(angle)));
		faceGroups.push({ normal: radial, vertexIndices: outerVertices });
		if (!solid) faceGroups.push({ normal: ScaleVector3(radial, -1), vertexIndices: innerVertices });
	}
}

function buildTube(size, complexity, options) {
	const segments = resolveCylinderSegments(complexity);
	const nodes = resolveTubeNodes(size, options);
	const solid = options.solid;

	const positions = [], indices = [], faceGroups = [];

	const nodeRings = nodes.map((node) => 
		appendTubeRing(positions, node.frame, node.radiusX, node.radiusZ, node.thickness, segments, solid)
	);
	const centerline = [nodes[0].center];
	const lerp = (a, b, t) => a + ((b - a) * t);

	for (let i = 0; i < nodes.length - 1; i++) {
		const nodeA = nodes[i];
		const nodeB = nodes[i + 1];
		const rings = [nodeRings[i]];

		// Zero-length segments have no centerline to curve; their end rings stitch directly.
		if (nodeA.curved && Vector3Distance(nodeA.center, nodeB.center) > EPSILON) {
			const points = SampleConnectorCenterline(nodeA.center, nodeA.forward, nodeB.center, ScaleVector3(nodeB.forward, -1), nodeA.smoothness, segments);
			const frames = orientConnectorFrames(points, nodeA.xAxis, nodeB.xAxis);
			for (let j = 1; j < points.length - 1; j++) {
				const t = j / (points.length - 1);
				centerline.push(points[j]);
				rings.push(appendTubeRing(
					positions,
					frameToTubeMatrix(frames[j], points[j]),
					lerp(nodeA.radiusX, nodeB.radiusX, t),
					lerp(nodeA.radiusZ, nodeB.radiusZ, t),
					lerp(nodeA.thickness, nodeB.thickness, t),
					segments,
					solid
				));
			}
		}

		rings.push(nodeRings[i + 1]);
		centerline.push(nodeB.center);

		for (let r = 0; r < rings.length - 1; r++) stitchTubeRings(indices, rings[r], rings[r + 1], segments, solid);
		appendTubeConnectorFaceGroups(faceGroups, rings, nodeA, segments, solid);
	}

	const firstRing = nodeRings[0];
	const lastRing = nodeRings[nodeRings.length - 1];
	const capVertices = (ring) => solid ? [...ring.outerIndices] : [...ring.outerIndices, ...ring.innerIndices];
	capTubeRing(indices, firstRing, segments, false, solid);
	capTubeRing(indices, lastRing, segments, true, solid);
	faceGroups.push({ normal: ScaleVector3(nodes[0].forward, -1), vertexIndices: capVertices(firstRing) });
	faceGroups.push({ normal: nodes[nodes.length - 1].forward, vertexIndices: capVertices(lastRing) });

	return { positions, indices, faceGroups, centerline };
}

function buildTorus(size, complexity, options) {
	const majorRadius = Math.max(0.0002, ToNumber(options.radius, size.x * 0.5));
	const minorRadius = Math.max(0.0001, Math.min(ToNumber(options.thickness, size.y * 0.25), majorRadius * 0.95));
	const resolution = resolveTorusResolution(complexity);
	const majorSegments = resolution.majorSegments;
	const minorSegments = resolution.minorSegments;

	const positions = [];
	const indices = [];

	for (let major = 0; major <= majorSegments; major++) {
		const u = (major / majorSegments) * Math.PI * 2;
		for (let minor = 0; minor <= minorSegments; minor++) {
			const v = (minor / minorSegments) * Math.PI * 2;
			const ringRadius = majorRadius + (minorRadius * Math.cos(v));
			positions.push(ringRadius * Math.cos(u), minorRadius * Math.sin(v), ringRadius * Math.sin(u));
		}
	}

	const stride = minorSegments + 1;
	for (let major = 0; major < majorSegments; major++) {
		for (let minor = 0; minor < minorSegments; minor++) {
			const a = major * stride + minor;
			const b = (major + 1) * stride + minor;
			const c = a + 1;
			const d = b + 1;
			indices.push(a, c, b);
			indices.push(c, d, b);
		}
	}

	const sectorCount = Math.min(8, majorSegments);
	const faceGroups = [];
	for (let sector = 0; sector < sectorCount; sector++) {
		const { start: startMajor, end: endMajor, midAngle: sectorMid } = resolveSectorRange(sector, sectorCount, majorSegments);
		const vertexIndices = [];
		for (let major = startMajor; major <= endMajor + 1; major++) {
			const wrappedMajor = Math.min(major, majorSegments);
			for (let minor = 0; minor <= minorSegments; minor++) vertexIndices.push((wrappedMajor * stride) + minor);
		}

		faceGroups.push({ normal: { x: Math.cos(sectorMid), y: 0, z: Math.sin(sectorMid) }, vertexIndices });
	}

	return { positions, indices, faceGroups };
}

function resolveRampShape(size) {
	const halfDepth = size.z * 0.5;
	const baseY = -size.y * 0.5;
	const slopeAngle = Math.atan2(size.y, halfDepth * 2);
	const slopeNormal = { x: 0, y: Math.cos(slopeAngle), z: -Math.sin(slopeAngle) };
	return { halfWidth: size.x * 0.5, halfDepth, baseY, rise: size.y, backY: baseY + size.y, slopeNormal };
}

function buildRampSimple(size) {
	const ramp = resolveRampShape(size);
	const positions = [
		-ramp.halfWidth, ramp.baseY, -ramp.halfDepth,
		 ramp.halfWidth, ramp.baseY, -ramp.halfDepth,
		 ramp.halfWidth, ramp.baseY,  ramp.halfDepth,
		-ramp.halfWidth, ramp.baseY,  ramp.halfDepth,
		 ramp.halfWidth, ramp.backY,  ramp.halfDepth,
		-ramp.halfWidth, ramp.backY,  ramp.halfDepth,
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

	return {
		positions, indices,
		faceGroups: [
			{ normal: WORLD_NORMALS.Down,    vertexIndices: [0, 1, 2, 3], indexStart: 0,  indexCount: 6 },
			{ normal: WORLD_NORMALS.Forward, vertexIndices: [2, 3, 4, 5], indexStart: 6,  indexCount: 6 },
			{ normal: ramp.slopeNormal,      vertexIndices: [0, 1, 4, 5], indexStart: 12, indexCount: 6 },
			{ normal: WORLD_NORMALS.Left,    vertexIndices: [0, 3, 5],    indexStart: 18, indexCount: 3 },
			{ normal: WORLD_NORMALS.Right,   vertexIndices: [1, 2, 4],    indexStart: 21, indexCount: 3 },
		],
	};
}

function buildRampComplex(size, complexity, options) {
	const ramp = resolveRampShape(size);
	const segments = resolveRampCurveSegments(complexity);
	const depth = options.depth;
	const positions = [], indices = [];
	const topLeftIndices = [], topRightIndices = [], bottomLeftIndices = [], bottomRightIndices = [];

	// Quadratic Bezier toe-to-crest; depth slides the control point toward the bottom-back corner.
	const curveZ = (t) => ramp.halfDepth * (((2 * t) - 1) + (2 * depth * t * (1 - t)));

	for (let index = 0; index <= segments; index++) {
		const t = index / segments;
		const y = ramp.baseY + (ramp.rise * (((1 - t) * t * (1 - depth)) + (t * t)));
		const z = curveZ(t);
		
		topLeftIndices.push(positions.length / 3);
		positions.push(-ramp.halfWidth, y, z);
		topRightIndices.push(positions.length / 3);
		positions.push(ramp.halfWidth, y, z);
		bottomLeftIndices.push(positions.length / 3);
		positions.push(-ramp.halfWidth, ramp.baseY, z);
		bottomRightIndices.push(positions.length / 3);
		positions.push(ramp.halfWidth, ramp.baseY, z);
	}

	for (let index = 0; index < segments; index++) {
		const topLeft         = topLeftIndices[index];
		const topRight        = topRightIndices[index];
		const nextTopLeft     = topLeftIndices[index + 1];
		const nextTopRight    = topRightIndices[index + 1];
		const bottomLeft      = bottomLeftIndices[index];
		const bottomRight     = bottomRightIndices[index];
		const nextBottomLeft  = bottomLeftIndices[index + 1];
		const nextBottomRight = bottomRightIndices[index + 1];

		indices.push(topLeft, nextTopLeft, nextTopRight);
		indices.push(topLeft, nextTopRight, topRight);

		indices.push(bottomLeft, bottomRight, nextBottomRight);
		indices.push(bottomLeft, nextBottomRight, nextBottomLeft);

		// Toe column has no thickness — one triangle closes each side wall.
		indices.push(bottomLeft, nextBottomLeft, nextTopLeft);
		if (index > 0) indices.push(bottomLeft, nextTopLeft, topLeft);

		indices.push(bottomRight, nextTopRight, nextBottomRight);
		if (index > 0) indices.push(bottomRight, topRight, nextTopRight);
	}

	const backTopLeft     = topLeftIndices[topLeftIndices.length - 1];
	const backTopRight    = topRightIndices[topRightIndices.length - 1];
	const backBottomLeft  = bottomLeftIndices[bottomLeftIndices.length - 1];
	const backBottomRight = bottomRightIndices[bottomRightIndices.length - 1];
	indices.push(backBottomLeft, backBottomRight, backTopRight);
	indices.push(backBottomLeft, backTopRight, backTopLeft);

	const topVertexIndices = [], bottomVertexIndices = [], leftVertexIndices = [], rightVertexIndices = [];
	for (let index = 0; index <= segments; index++) {
		topVertexIndices.push(topLeftIndices[index], topRightIndices[index]);
		bottomVertexIndices.push(bottomLeftIndices[index], bottomRightIndices[index]);
		leftVertexIndices.push(bottomLeftIndices[index], topLeftIndices[index]);
		rightVertexIndices.push(bottomRightIndices[index], topRightIndices[index]);
	}

	return {
		positions, indices,
		faceGroups: [
			{ normal: WORLD_NORMALS.Down, vertexIndices: bottomVertexIndices },
			{ normal: WORLD_NORMALS.Forward, vertexIndices: [backBottomLeft, backBottomRight, backTopRight, backTopLeft] },
			{ normal: ramp.slopeNormal, vertexIndices: topVertexIndices },
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
		case "capsule"     : return buildCapsule(size, complexity, primitiveOptions);
		case "cone"        : return buildCone(size, complexity);
		case "ramp-simple" : return buildRampSimple(size);
		case "ramp-complex": return buildRampComplex(size, complexity, primitiveOptions);
		case "tube"        : return buildTube(size, complexity, primitiveOptions);
		case "torus"       : return buildTorus(size, complexity, primitiveOptions);
		case "pyramid"     : return buildPyramid(size);
		case "plane"       : return buildPlane(size);
	}
}

export { BuildGeometry };
