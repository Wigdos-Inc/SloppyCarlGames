// Renderer and displayer of all visual elements.

// End of any visual pipeline to display contents to Game (document.body)

/* === IMPORTS === */
// UI element builder.

import { UIElement } from "../builder/NewUI.js";
import { CONFIG, DEBUG_COLORS, FILTER_TUNING, PERFORMANCE_SCALING, SKY_STOP_LIMIT } from "../core/config.js";
import { Log } from "../core/meta.js";
import { CreateIdentityMatrix, CreateRenderMatrix, FrustumPlanes, MultiplyMatrix4, TransformPointByMatrix } from "../math/Matrix.js";
import { 
	AabbOutsideFrustum, 
	BeyondFrontFaces, 
	ConvexHull2D, 
	CornersInsideHull, 
	PointsAabb, 
	ProjectBoxCorners, 
	TriangleArea 
} from "../math/Collision.js";
import { 
	AddVector3, 
	AngleBetweenVector3, 
	ArrayToVector3, 
	CloneVector3, 
	CompareVector3, 
	CrossVector3, 
	DivideVector3, 
	DotVector3, 
	MaxVector3, 
	MinVector3, 
	ResolveVector3Axis, 
	ScaleVector3, 
	SubtractVector3, 
	ToVector3, 
	Vector3Length, 
	Vector3Sq, 
	Vector3SqDistanceToAabb, 
	Vector3ToArray 
} from "../math/Vector3.js";
import { Clamp } from "../math/Utilities.js";
import CreateShader from "./utilities/Shaders.js";

/* === INTERNALS === */
// DOM helpers for rendering payloads.

function ensureRoot(rootId, rootStyles) {
	let root = document.getElementById(rootId);
	if (!root) {
		root = document.createElement("div");
		root.id = rootId;
		root.style.userSelect = "none";
		root.style.webkitUserSelect = "none";
		root.style.msUserSelect = "none";
		document.body.appendChild(root);
	}

	// Apply root styles when provided (rootStyles normalized by upstream validation).
	Object.assign(root.style, rootStyles);

	return root;
}

// One engine-owned <style> tag per root; null clears it.
function ApplyRootStylesheet(rootId, stylesheet) {
	const tagId = `engine-ui-style-${rootId}`;
	let tag = document.getElementById(tagId);

	if (stylesheet === null) {
		if (tag) tag.parentNode.removeChild(tag);
		return;
	}

	if (!tag) {
		tag = document.createElement("style");
		tag.id = tagId;
		document.head.appendChild(tag);
	}

	tag.textContent = stylesheet;
}


/* === PAYLOADS === */
// Renders payloads built by the UI builder.

// Replace existing contents by default, then append the pre-built elements.
function RenderPayload(payload) {
	const root = ensureRoot(payload.rootId, payload.rootStyles);
	if (payload.replace !== false) root.innerHTML = "";
	root.appendChild(payload.elements);
}

/* === LEVEL === */
// WebGL level renderer for fully constructed 3D scene graphs.

const levelRendererCache = new Map();
const identityRenderMatrix = new Float32Array(CreateIdentityMatrix());

function createPerspectiveMatrix(fovDegrees, aspect, near, far) {
	const f = 1 / Math.tan(((fovDegrees * Math.PI) / 180) * 0.5), nf = 1 / (near - far);
	return [
		f / aspect, 0, 0, 0,
		0, f, 0, 0,
		0, 0, (far + near) * nf, -1,
		0, 0, (2 * far * near) * nf, 0,
	];
}

function createLookAtMatrix(eye, target, up) {
	const zAxis = ResolveVector3Axis(SubtractVector3(eye, target));
	const xAxis = ResolveVector3Axis(CrossVector3(up, zAxis));
	const yAxis = CrossVector3(zAxis, xAxis);
	return [
		xAxis.x, yAxis.x, zAxis.x, 0,
		xAxis.y, yAxis.y, zAxis.y, 0,
		xAxis.z, yAxis.z, zAxis.z, 0,
		-DotVector3(xAxis, eye), -DotVector3(yAxis, eye), -DotVector3(zAxis, eye), 1,
	];
}

// Decal shape enum; keep in sync with decalSurfaceUvGLSL in Shaders.js and builder/NewPrimitive.js.
const DECAL_SHAPE_CODES = {
	Flat    : 0, // any non-curved primitive — no projection
	Sphere  : 1, // buildSphere
	Cylinder: 2, // buildCylinder
	Capsule : 3, // buildCapsule
};

// Cylinder caps are flat disks (unlike capsule ends) — decals there skip radial projection.
function ResolveDecalShapeCode(shape, side) {
	const key = shape.charAt(0).toUpperCase() + shape.slice(1), codes = DECAL_SHAPE_CODES;
	if (key === "Cylinder") return side === "top" || side === "bottom" ? codes.Flat : codes.Cylinder;
	return typeof codes[key] === "number" ? codes[key] : codes.Flat;
}

/* === DECAL GEOMETRY === */
// Capsule cap share; every other shape ignores it.
const DecalRounding = (shape, primitiveOptions) => shape === "capsule" ? primitiveOptions.rounding : 0;

// Capsule ray origin: on the axis within the band, cap center beyond it.
function CapsuleBand(halfExtents, rounding, pointY) {
	const capRadius    = halfExtents.y * rounding;
	const cylinderHalf = halfExtents.y - capRadius;
	return { 
		capRadius, cylinderHalf, 
		originY: Math.abs(pointY) <= cylinderHalf ? pointY : Math.sign(pointY) * cylinderHalf 
	};
}

// The decal's right and up directions, laid flat on the surface at its center.
function decalSurfaceFrame(centerDir, u, v) {
	const right = ResolveVector3Axis(SubtractVector3(u, ScaleVector3(centerDir, DotVector3(u, centerDir))));
	const up    = CrossVector3(centerDir, right);
	return { right, up: DotVector3(up, v) < 0 ? ScaleVector3(up, -1) : up };
}

// Angle around the vertical axis. A point on the axis itself uses the fallback angle.
const decalAxisAngle = (z, x, fallback) => (x === 0 && z === 0 ? fallback : Math.atan2(z, x));

// Tube height, continued onto the cap.
function decalMeridianArc(point, capRadius, cylinderHalf, shapeCode) {
	if (shapeCode === DECAL_SHAPE_CODES.Cylinder || Math.abs(point.y) <= cylinderHalf) return point.y;
	const normal = ResolveVector3Axis(SubtractVector3(point, { x: 0, y: Math.sign(point.y) * cylinderHalf, z: 0 }));
	return Math.sign(point.y) * cylinderHalf + capRadius * Math.asin(Clamp(normal.y, -1, 1));
}

// Mirrored by decalSurfaceUvGLSL. referenceArc: seam branch to unwrap into; 0 for none.
function DecalSurfaceUv(point, placement, shapeCode, halfExtents, rounding, referenceArc) {

	const center = ArrayToVector3(placement, 12);
	const width = Math.max(Vector3Length(ArrayToVector3(placement, 0)), 1e-6);
	const height = Math.max(Vector3Length(ArrayToVector3(placement, 4)), 1e-6);
	const u = DivideVector3(ArrayToVector3(placement, 0), ToVector3(width));
	const v = DivideVector3(ArrayToVector3(placement, 4), ToVector3(height));

	if (shapeCode === DECAL_SHAPE_CODES.Flat) {
		const offset = SubtractVector3(point, center);
		const along  = DotVector3(offset, u);
		return { u: along / width, v: DotVector3(offset, v) / height, arc: along };
	}

	const band  = CapsuleBand(halfExtents, rounding, center.y);
	const onCap = shapeCode === DECAL_SHAPE_CODES.Capsule && Math.abs(center.y) > band.cylinderHalf;

	// Sphere or capsule cap: unrolls the surface outward from the decal's center.
	if (shapeCode === DECAL_SHAPE_CODES.Sphere || onCap) {
		const origin    = { x: 0, y: onCap ? band.originY : 0, z: 0 };
		const radius    = onCap ? band.capRadius : Vector3Length(center);
		const centerDir = ResolveVector3Axis(SubtractVector3(center, origin));
		const normal    = ResolveVector3Axis(SubtractVector3(point, origin));
		const frame     = decalSurfaceFrame(centerDir, u, v);
		const bearingU  = DotVector3(normal, frame.right), bearingV = DotVector3(normal, frame.up);
		const bearing   = Math.hypot(bearingU, bearingV);
		const geodesic  = radius * AngleBetweenVector3(normal, centerDir);
		const arc  = bearing > 1e-12 ? geodesic * bearingU / bearing : 0;
		const turn = 2 * Math.PI * radius;

		return { 
			u: arc / Math.min(width, turn), 
			v: (bearing > 1e-12 ? geodesic * bearingV / bearing : 0) / Math.min(height, turn), 
			arc 
		};
	}

	// Tube side: unrolls the surface flat, distance around by distance along.
	const centerDir   = ResolveVector3Axis(SubtractVector3(center, { x: 0, y: center.y, z: 0 }));
	const meridian    = ResolveVector3Axis(SubtractVector3({ x: 0, y: 1, z: 0 }, ScaleVector3(centerDir, centerDir.y)));
	const azimuth     = CrossVector3(centerDir, meridian);
	const frame       = decalSurfaceFrame(centerDir, u, v);
	const rho         = Math.max(Math.hypot(center.x, center.z), 1e-6);
	const centerAngle = decalAxisAngle(center.z, center.x, 0);
	let dTheta = decalAxisAngle(point.z, point.x, centerAngle) - centerAngle;
	if (dTheta >  Math.PI) dTheta -= 2 * Math.PI;
	if (dTheta < -Math.PI) dTheta += 2 * Math.PI;
	
	// Points behind the tube wrap to stay next to referenceArc instead of jumping across the seam.
	const piArc = Math.PI * rho;
	let arc = rho * dTheta;
	while (arc - referenceArc >  piArc) arc -= 2 * piArc;
	while (arc - referenceArc < -piArc) arc += 2 * piArc;
	const rise = decalMeridianArc(point, band.capRadius, band.cylinderHalf, shapeCode) - decalMeridianArc(center, band.capRadius, band.cylinderHalf, shapeCode);
	
	return {
		u: (arc * DotVector3(frame.right, azimuth) + rise * DotVector3(frame.right, meridian)) / Math.min(width, 2 * piArc),
		v: (arc * DotVector3(frame.up, azimuth)    + rise * DotVector3(frame.up, meridian))    / height,
		arc,
	};
}

// Flat host: the placed quad is exact.
const flatDecalCorners = [
	{ x: -0.5, y: -0.5, z: 0 }, 
	{ x: -0.5, y: 0.5, z: 0 }, 
	{ x: 0.5, y: -0.5, z: 0 }, 
	{ x: 0.5, y: 0.5, z: 0 }
];
const flatDecalOrder   = [0, 2, 1, 1, 2, 3];

function flatDecalFacets(placement) {
	const positions = new Float32Array(flatDecalOrder.length * 3);
	const uvs       = new Float32Array(flatDecalOrder.length * 2);
	flatDecalOrder.forEach((corner, slot) => {
		const point = TransformPointByMatrix(flatDecalCorners[corner], placement);
		positions[slot * 3] = point.x; positions[slot * 3 + 1] = point.y; positions[slot * 3 + 2] = point.z;
		uvs[slot * 2] = flatDecalCorners[corner].x; 
		uvs[slot * 2 + 1] = flatDecalCorners[corner].y;
	});
	return { positions, uvs };
}

// Whole facets, each padded by its own uv extent; the fragment shader does the exact cut.
function SelectDecalFacets(geometry, placement, shapeCode, halfExtents, rounding, margin) {
	if (shapeCode === DECAL_SHAPE_CODES.Flat) return flatDecalFacets(placement);

	const half = 0.5 * margin;
	const { positions, indices } = geometry;
	const vertexCount = positions.length / 3;
	const points  = new Array(vertexCount), baseUvs = new Array(vertexCount);
	const pointAt = (index) => points[index] || (points[index] = ArrayToVector3(positions, index, true));
	
	// First vertices map with referenceArc 0, so they cache per index.
	const baseUvAt = (index) => baseUvs[index] || (baseUvs[index] = DecalSurfaceUv(pointAt(index), placement, shapeCode, halfExtents, rounding, 0));

	const keptPoints = [], keptUvs = [];
	const tri = [null, null, null], us = [0, 0, 0], vs = [0, 0, 0];
	for (let offset = 0; offset < indices.length; offset += 3) {
		tri[0] = pointAt(indices[offset]);
		tri[1] = pointAt(indices[offset + 1]);
		tri[2] = pointAt(indices[offset + 2]);
		
		// Degenerate capsule pole triangles.
		if (TriangleArea(tri[0], tri[1], tri[2]) < 5e-15) continue;

		// Unwrap into the first vertex's branch.
		const base = baseUvAt(indices[offset]);
		us[0] = base.u; vs[0] = base.v;
		for (let corner = 1; corner < 3; corner++) {
			const mapped = DecalSurfaceUv(tri[corner], placement, shapeCode, halfExtents, rounding, base.arc);
			us[corner] = mapped.u; vs[corner] = mapped.v;
		}

		const minU = Math.min(us[0], us[1], us[2]), maxU = Math.max(us[0], us[1], us[2]);
		const minV = Math.min(vs[0], vs[1], vs[2]), maxV = Math.max(vs[0], vs[1], vs[2]);
		const extentU = maxU - minU, extentV = maxV - minV;
		if (minU > half + extentU || maxU < -half - extentU) continue;
		if (minV > half + extentV || maxV < -half - extentV) continue;

		for (let corner = 0; corner < 3; corner++) {
			keptPoints.push(tri[corner].x, tri[corner].y, tri[corner].z);
			keptUvs.push(us[corner], vs[corner]);
		}
	}
	return { positions: new Float32Array(keptPoints), uvs: new Float32Array(keptUvs) };
}

/* === GEOMETRY REGISTRY === */
// Shared geometry pool: one set of GPU buffers per unique (primitive, dimensions) combo.

function ensureSharedGeometry(renderer, sceneGraph, primitiveKey) {
	if (renderer.geometryRegistry.has(primitiveKey)) return renderer.geometryRegistry.get(primitiveKey);

	const gl = renderer.gl;
	const geometry = sceneGraph.visualResources.primitiveGeometry[primitiveKey];

	const positionBuffer = gl.createBuffer();
	const uvBuffer = gl.createBuffer();
	const indexBuffer = gl.createBuffer();
	if (!positionBuffer || !uvBuffer || !indexBuffer) return null;

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.positions), gl.STATIC_DRAW);

	gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(geometry.uvs), gl.STATIC_DRAW);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geometry.indices), gl.STATIC_DRAW);

	const entry = {
		positionBuffer, uvBuffer, indexBuffer,
		indexCount: geometry.indices.length,
	};

	renderer.geometryRegistry.set(primitiveKey, entry);
	return entry;
}

/* === SCATTER INSTANCE BUFFERS === */
// Builds per-batch VAOs and instance buffers from scatterBatches on the sceneGraph.

// Shared position/uv/index + per-instance model-matrix rows, optional trailing tint.
function buildInstancedVao(gl, positionBuffer, uvBuffer, indexBuffer, instanceBuffer, includeTint, instanceOffset = 0) {
	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

	// Null for de-indexed decal geometry.
	if (uvBuffer !== null) {
		gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
		gl.enableVertexAttribArray(1);
		gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
	}
	if (indexBuffer !== null) gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);

	gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
	const stride = 80;
	const rowCount = includeTint ? 5 : 4;
	for (let row = 0; row < rowCount; row++) {
		const location = 2 + row;
		gl.enableVertexAttribArray(location);
		gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, instanceOffset + row * 16);
		gl.vertexAttribDivisor(location, 1);
	}

	gl.bindVertexArray(null);
	return vao;
}

// Reorder instances so each ground square's instances sit together, and boxes each square for culling.
function groupInstancesIntoCells(instanceData, instanceCount, instanceReach) {
	const byCell = new Map();

	const cellSize = PERFORMANCE_SCALING.Culling.ScatterCellSize.value;
	for (let i = 0; i < instanceCount; i++) {
		const key = `
			${Math.floor(instanceData[i * 20 + 12] / cellSize)}|
			${Math.floor(instanceData[i * 20 + 14] / cellSize)}
		`;
		if (!byCell.has(key)) byCell.set(key, []);
		byCell.get(key).push(i);
	}

	const sorted = new Float32Array(instanceData.length);
	const cells  = [];
	let written  = 0;
	for (const indices of byCell.values()) {
		let min = ToVector3(Infinity), max = ToVector3(-Infinity);
		for (const i of indices) {
			const row = instanceData.subarray(i * 20, i * 20 + 20);
			sorted.set(row, written * 20);

			// How far this instance's farthest vertex can sit from its position, after its scale.
			const rows  = [row[0], row[1], row[2], row[4], row[5], row[6], row[8], row[9], row[10]];
			const reach = instanceReach * Math.hypot(...rows);
			min = MinVector3(min, SubtractVector3(ArrayToVector3(row, 12), ToVector3(reach)));
			max = MaxVector3(max, AddVector3(ArrayToVector3(row, 12), ToVector3(reach)));
			written++;
		}
		cells.push({ start: written - indices.length, count: indices.length, aabb: { min, max }, occluded: false });
	}

	return { sorted, cells };
}

function buildScatterInstanceBuffers(renderer, sceneGraph) {
	if (sceneGraph.scatterBatches.size === 0) {
		renderer.scatterInstances = [];
		renderer.scatterDecalBatches = [];
		renderer.scatterInstancesBuilt = true;
		return;
	}

	const gl = renderer.gl;
	const results = [];
	let totalInstances = 0, totalCells = 0;

	sceneGraph.scatterBatches.forEach((batch, batchKey) => {
		if (batch.instanceCount === 0) return;

		const geo = ensureSharedGeometry(renderer, sceneGraph, batch.primitiveKey);
		if (!geo) return;

		const instanceCount = batch.instanceCount;
		const primitiveGeometry = sceneGraph.visualResources.primitiveGeometry[batch.primitiveKey];

		// Farthest vertex of the shared shape from its own origin, before any instance scaling.
		let instanceReach = 0;
		for (let i = 0; i < primitiveGeometry.positions.length / 3; i++) {
			instanceReach = Math.max(instanceReach, Vector3Length(ArrayToVector3(primitiveGeometry.positions, i, true)));
		}
		const { sorted, cells } = groupInstancesIntoCells(batch.instanceData, instanceCount, instanceReach);

		const instanceBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, sorted, gl.STATIC_DRAW);

		// One vertex array per ground square, starting at that square's first instance.
		const { positionBuffer, uvBuffer, indexBuffer } = geo
		for (const cell of cells) {
			cell.vao = buildInstancedVao(gl, positionBuffer, uvBuffer, indexBuffer, instanceBuffer, true, cell.start * 80);
		}

		// Scatter decals are static: built once, shared by every instance.
		const { dimensions, primitive, primitiveOptions, customTextures, textureID } = batch;
		const rounding = DecalRounding(primitive, primitiveOptions);
		const decalDraws = customTextures.map((decalEntry, index) => {
			const shapeCode = ResolveDecalShapeCode(primitive, decalEntry.side);
			const placement = BuildDecalPlacementMatrix(dimensions, decalEntry.displayTransform, decalEntry.side);
			const facets    = SelectDecalFacets(primitiveGeometry, placement, shapeCode, ScaleVector3(dimensions, 0.5), rounding, 1);

			const positionBuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
			gl.bufferData(gl.ARRAY_BUFFER, facets.positions, gl.STATIC_DRAW);

			return {
				shapeCode,
				placement  : new Float32Array(placement),
				cellVaos   : cells.map((cell) => buildInstancedVao(gl, positionBuffer, null, null, instanceBuffer, false, cell.start * 80)),
				vertexCount: facets.positions.length / 3,
				textureKey : `${batchKey}::customTexture::${index}`,
			};
		});

		totalInstances += instanceCount;
		totalCells     += cells.length;
		results.push({
			key: batchKey, cells, indexCount: geo.indexCount,
			instanceCount, textureID: textureID, decalDraws,
			primitive : primitive, dimensions: dimensions, rounding,
		});
	});

	renderer.scatterInstances = results;
	renderer.scatterDecalBatches = results.filter((batch) => batch.decalDraws.length > 0);
	renderer.scatterInstancesBuilt = true;
	Log(
		"ENGINE",
		`Scatter instancing ready: 
			${results.length} batch(es), 
			${totalInstances} total instance(s), 
			${totalCells} cell(s) of ${PERFORMANCE_SCALING.Culling.ScatterCellSize.value} cnu`,
		"log",
		"Level"
	);
}

const isBoundingBoxDebugEnabled = (type) => !!(CONFIG.Debug.All && CONFIG.Debug.Levels.BoundingBox[type]);

function bindDebugLinePass(renderer, gl, projection, view) {
	gl.useProgram(renderer.debugLineShader.program);
	gl.uniformMatrix4fv(renderer.debugLineShader.uniforms.projection, false, projection);
	gl.uniformMatrix4fv(renderer.debugLineShader.uniforms.view, false, view);
	gl.uniformMatrix4fv(renderer.debugLineShader.uniforms.model, false, identityRenderMatrix);
	gl.bindBuffer(gl.ARRAY_BUFFER, renderer.debugLineBuffer);
	gl.enableVertexAttribArray(renderer.debugLineShader.attributes.position);
	gl.vertexAttribPointer(renderer.debugLineShader.attributes.position, 3, gl.FLOAT, false, 0, 0);
}

function buildBoxWireframe(p000, p001, p010, p011, p100, p101, p110, p111) {
	return new Float32Array([
		...p000, ...p001, ...p001, ...p011, ...p011, ...p010, ...p010, ...p000,
		...p100, ...p101, ...p101, ...p111, ...p111, ...p110, ...p110, ...p100,
		...p000, ...p100, ...p001, ...p101, ...p010, ...p110, ...p011, ...p111,
	]);
}

function createMinMaxBoxLineVertices(bounds) {
	const min = bounds.min.toWorldUnit(), max = bounds.max.toWorldUnit();
	return buildBoxWireframe(
		[min.x, min.y, min.z], [min.x, min.y, max.z],
		[min.x, max.y, min.z], [min.x, max.y, max.z],
		[max.x, min.y, min.z], [max.x, min.y, max.z],
		[max.x, max.y, min.z], [max.x, max.y, max.z]
	);
}

function createGridLineVertices(bounds, step) {
	const min = Vector3ToArray(bounds.min.toWorldUnit());
	const max = Vector3ToArray(bounds.max.toWorldUnit());
	const a = [0, 0, 0], b = [0, 0, 0];
	const lines = [];

	// Sweep axis s over faces of axis k; lines run along axis l.
	for (let s = 0; s < 3; s++) {
		for (let k = 0; k < 3; k++) {
			if (k === s) continue;

			const l = 3 - s - k;
			a[l] = min[l];
			b[l] = max[l];

			for (const side of [min[k], max[k]]) {
				a[k] = b[k] = side;
				for (let v = min[s]; v <= max[s] + step * 0.001; v += step) {
					a[s] = b[s] = v;
					lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
				}
			}
		}
	}

	return lines.length === 0 ? null : new Float32Array(lines);
}

function drawBoundingBoxes(renderer, sceneGraph, projection, view) {
	if (sceneGraph.debugBoundingBoxes.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader) return renderer.debugLineShader = CreateShader.LineProgram(gl);
	if (!renderer.debugLineBuffer) return renderer.debugLineBuffer = gl.createBuffer();

	bindDebugLinePass(renderer, gl, projection, view);

	sceneGraph.debugBoundingBoxes.forEach((record) => {
		if (!isBoundingBoxDebugEnabled(record.type)) return;

		const vertices = createMinMaxBoxLineVertices(record);
		if (!vertices) return;

		const color = DEBUG_COLORS.BoundingBoxes[record.type];
		gl.uniform4f(renderer.debugLineShader.uniforms.color, color.r, color.g, color.b, color.a);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, vertices.length / 3);
	});
}

function drawGridOverlay(renderer, sceneGraph, projection, view) {
	if (!(CONFIG.Debug.All && CONFIG.Debug.Levels.BoundingBox.Grid.Visible)) return;
	if (sceneGraph.debugBoundingBoxes.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader || !renderer.debugLineBuffer) return;

	bindDebugLinePass(renderer, gl, projection, view);
	gl.uniform4f(renderer.debugLineShader.uniforms.color, 0.5, 0.5, 0.5, 0.6);

	sceneGraph.debugBoundingBoxes.forEach((record) => {
		if (!isBoundingBoxDebugEnabled(record.type)) return;

		const vertices = createGridLineVertices(record, CONFIG.Debug.Levels.BoundingBox.Grid.Size.toWorldUnit());
		if (!vertices) return;

		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, vertices.length / 3);
	});
}

function createObbLineVertices(bounds) {
	const c = bounds.center.toWorldUnit();
	const half = bounds.halfExtents.toWorldUnit();
	const s = { x: ScaleVector3(bounds.axes[0], half.x), y: ScaleVector3(bounds.axes[1], half.y), z: ScaleVector3(bounds.axes[2], half.z) };

	const sign = (v, on) => on ? v : ScaleVector3(v, -1);

	// Bits of i pick each axis side: 4 = x, 2 = y, 1 = z.
	const corners = [];
	for (let i = 0; i < 8; i++) {
		corners.push(Vector3ToArray(AddVector3(AddVector3(AddVector3(c, sign(s.x, i & 4)), sign(s.y, i & 2)), sign(s.z, i & 1))));
	}
	return buildBoxWireframe(...corners);
}

function createCapsuleLineVertices(bounds, longitudinalSegments = 8) {
	const start = bounds.segmentStart.toWorldUnit();
	const end = bounds.segmentEnd.toWorldUnit();
	const radius = bounds.radius.toWorldUnit();

	const lines = [];
	const ringOffset = radius * Math.SQRT1_2, ringRadius = radius * Math.SQRT1_2;
	const bottomPole = [start.x, start.y - radius, start.z];
	const topPole = [end.x, end.y + radius, end.z];

	for (let i = 0; i < longitudinalSegments; i++) {
		const t0 = (i / longitudinalSegments) * Math.PI * 2;
		const t1 = ((i + 1) / longitudinalSegments) * Math.PI * 2;
		const c0 = Math.cos(t0), c1 = Math.cos(t1);
		const s0 = Math.sin(t0), s1 = Math.sin(t1);
		const bottomBase = [start.x + c0 * radius, start.y, start.z + s0 * radius];
		const topBase = [end.x + c0 * radius, end.y, end.z + s0 * radius];
		const bottomMid = [start.x + c0 * ringRadius, start.y - ringOffset, start.z + s0 * ringRadius];
		const topMid = [end.x + c0 * ringRadius, end.y + ringOffset, end.z + s0 * ringRadius];

		lines.push(...bottomBase, ...topBase);
		lines.push(...bottomBase, start.x + c1 * radius, start.y, start.z + s1 * radius);
		lines.push(...topBase, end.x + c1 * radius, end.y, end.z + s1 * radius);
		lines.push(...bottomBase, ...bottomMid);
		lines.push(...bottomMid, ...bottomPole);
		lines.push(...topBase, ...topMid);
		lines.push(...topMid, ...topPole);
		lines.push(...bottomMid, ...[start.x + c1 * ringRadius, start.y - ringOffset, start.z + s1 * ringRadius]);
		lines.push(...topMid, ...[end.x + c1 * ringRadius, end.y + ringOffset, end.z + s1 * ringRadius]);
	}

	return new Float32Array(lines);
}

function createSphereLineVertices(bounds, radialSegments = 16) {
	const center = bounds.center.toWorldUnit();
	const r = bounds.radius.toWorldUnit();
	const lines = [];

	// Three orthogonal circle rings (XY, XZ, YZ planes).
	for (let i = 0; i < radialSegments; i++) {
		const t0 = (i / radialSegments) * Math.PI * 2;
		const t1 = ((i + 1) / radialSegments) * Math.PI * 2;
		const c0 = Math.cos(t0), s0 = Math.sin(t0);
		const c1 = Math.cos(t1), s1 = Math.sin(t1);

		// XZ ring (horizontal).
		lines.push(center.x + c0 * r, center.y, center.z + s0 * r, center.x + c1 * r, center.y, center.z + s1 * r);
		// XY ring (front).
		lines.push(center.x + c0 * r, center.y + s0 * r, center.z, center.x + c1 * r, center.y + s1 * r, center.z);
		// YZ ring (side).
		lines.push(center.x, center.y + c0 * r, center.z + s0 * r, center.x, center.y + c1 * r, center.z + s1 * r);
	}

	return new Float32Array(lines);
}

function createTriangleSoupLineVertices(bounds) {
	const lines = [];
	bounds.triangles.forEach((triangle) => {
		const a = Vector3ToArray(triangle.a.toWorldUnit());
		const b = Vector3ToArray(triangle.b.toWorldUnit());
		const c = Vector3ToArray(triangle.c.toWorldUnit());
		lines.push(...a, ...b, ...b, ...c, ...c, ...a);
	});
	return new Float32Array(lines);
}

function drawDetailedBoundsShape(gl, shader, bounds) {
	let vertices = null;
	switch(bounds.type) {
		case "capsule"        : vertices = createCapsuleLineVertices(bounds);      break;
		case "obb"            : vertices = createObbLineVertices(bounds);          break;
		case "sphere"         : vertices = createSphereLineVertices(bounds);       break;
		case "aabb"           : vertices = createMinMaxBoxLineVertices(bounds);    break;
		case "triangle-soup"  :
		case "voidWall"       : vertices = createTriangleSoupLineVertices(bounds); break;
		case "compound"       : bounds.parts.forEach((part) => drawDetailedBoundsShape(gl, shader, part));       return;
		case "compound-sphere": bounds.spheres.forEach((sphere) => drawDetailedBoundsShape(gl, shader, sphere)); return;
		default: return;
	}

	gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
	gl.drawArrays(gl.LINES, 0, vertices.length / 3);
}

function drawDetailedBounds(renderer, sceneGraph, projection, view) {
	if (sceneGraph.debug.detailedBounds.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader) return renderer.debugLineShader = CreateShader.LineProgram(gl);
	if (!renderer.debugLineBuffer) return renderer.debugLineBuffer = gl.createBuffer();

	bindDebugLinePass(renderer, gl, projection, view);

	sceneGraph.debug.detailedBounds.forEach((record) => {
		if (!(CONFIG.Debug.All && CONFIG.Debug.Levels.DetailedBounds[record.toggle])) return;

		const color = DEBUG_COLORS.DetailedBounds[record.type];
		gl.uniform4f(renderer.debugLineShader.uniforms.color, color.r, color.g, color.b, color.a);
		drawDetailedBoundsShape(gl, renderer.debugLineShader, record.bounds);
	});
}

function classifyEntityTrailType(entity) {
	if (entity.type.includes("player"))      return "Player";
	if (entity.type.includes("boss"))        return "Boss";
	if (entity.type.includes("collectible")) return "Collectible";
	if (entity.type.includes("projectile"))  return "Projectile";
	if (entity.type.includes("particle"))    return "Particle";
	return "Enemies";
}

function drawVelocityTrails(renderer, sceneGraph, projection, view) {
	if (!CONFIG.Debug.All) return;
	if (!Object.values(CONFIG.Debug.Levels.Trails).some(Boolean)) return;
	if (sceneGraph.entities.length === 0) return;

	const gl = renderer.gl;
	if (!renderer.debugLineShader || !renderer.debugLineBuffer) return;

	bindDebugLinePass(renderer, gl, projection, view);
	const trailScale = 0.15;

	sceneGraph.entities.forEach(entity => {
		const { velocity, transform } = entity;
		const trailType = classifyEntityTrailType(entity);

		if (!(CONFIG.Debug.All && CONFIG.Debug.Levels.Trails[trailType])) return;
		if (Vector3Sq(velocity) < 0.01) return;


		// Convert CNU positions to world units for rendering.
		const position = transform.position.toWorldUnit();
		const end = AddVector3(position, ScaleVector3(velocity, trailScale));
		const vertices = new Float32Array([...Vector3ToArray(position), ...Vector3ToArray(end)]);
		const color = DEBUG_COLORS.Trails[trailType];

		gl.uniform4f(renderer.debugLineShader.uniforms.color, color.r, color.g, color.b, color.a);
		gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
		gl.drawArrays(gl.LINES, 0, 2);
	});
}

function createMeshBuffers(gl, mesh, shader) {
	const positionBuffer = gl.createBuffer(), uvBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer();
	if (!positionBuffer || !uvBuffer || !indexBuffer) {
		Log("ENGINE", "WebGL buffer creation failed", "error", "Render");
		return null;
	}

	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.geometry.positions), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 3, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ARRAY_BUFFER, uvBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.geometry.uvs), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(shader.attributes.uv);
	gl.vertexAttribPointer(shader.attributes.uv, 2, gl.FLOAT, false, 0, 0);

	// 32-bit: a carved host can exceed the 65535-index ceiling, and a wrap would be silent.
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(mesh.geometry.indices), gl.STATIC_DRAW);

	gl.bindVertexArray(null);

	return {
		position: positionBuffer,
		uv: uvBuffer,
		index: indexBuffer,
		indexCount: mesh.geometry.indices.length,
		vao,
	};
}

// Snapshot covers every field CreateRenderMatrix reads.
function renderMatrixFor(mesh) {
	const cache     = mesh.renderMatrixCache;
	const transform = mesh.displayTransform;
	if (CompareVector3(cache.position, transform.position) &&
		CompareVector3(cache.pivot,    transform.pivot)    &&
		CompareVector3(cache.rotation, transform.rotation) &&
		CompareVector3(cache.scale,    transform.scale)
	) {
		return cache.matrix;
	}

	cache.matrix.set(CreateRenderMatrix(transform));
	cache.position.set(transform.position);
	cache.pivot.set(transform.pivot);
	cache.rotation.set(transform.rotation);
	cache.scale = CloneVector3(transform.scale);
	return cache.matrix;
}

function createFallbackTexture(gl) {
	const texture = gl.createTexture();
	if (!texture) return null;

	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	return texture;
}

// Decals specifically upload premultiplied; reallocate=false reuses storage via texSubImage2D.
function uploadTextureImage(gl, textureID, source, reallocate) {
	const isDecal = textureID.includes("::customTexture::");
	if (isDecal) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

	if (reallocate) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
	else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);

	if (isDecal) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
}

function ensureSceneTexture(renderer, sceneGraph, textureID) {
	const gl = renderer.gl;
	renderer.drawnTextures.add(textureID);
	if (renderer.textures.has(textureID)) return renderer.textures.get(textureID);

	const texture = gl.createTexture();
	if (!texture) return renderer.fallbackTexture;

	const wrapMode = (textureID.includes("::face=") || textureID.includes("::customTexture::"))
		? gl.CLAMP_TO_EDGE
		: gl.REPEAT;
	gl.bindTexture(gl.TEXTURE_2D, texture);
	uploadTextureImage(gl, textureID, sceneGraph.visualResources.textureRegistry[textureID].source, true);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMode);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMode);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	renderer.textures.set(textureID, texture);
	return texture;
}

function ensureFullscreenQuad(renderer, cacheKey, shader, label) {
	if (renderer[cacheKey]) return renderer[cacheKey];

	const gl = renderer.gl;
	const positionBuffer = gl.createBuffer(), indexBuffer = gl.createBuffer();
	if (!positionBuffer || !indexBuffer) {
		Log("ENGINE", `${label} quad buffer creation failed`, "error", "Render");
		return null;
	}

	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);

	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(shader.attributes.position);
	gl.vertexAttribPointer(shader.attributes.position, 2, gl.FLOAT, false, 0, 0);

	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
	gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);

	gl.bindVertexArray(null);

	renderer[cacheKey] = { vao, position: positionBuffer, index: indexBuffer, indexCount: 6 };
	return renderer[cacheKey];
}

const ensureBlendQuad  = (renderer) => ensureFullscreenQuad(renderer, "blendQuad",  renderer.blendShader,  "Blend");
const ensureSkyQuad    = (renderer) => ensureFullscreenQuad(renderer, "skyQuad",    renderer.skyShader,    "Sky");
const ensureFilterQuad = (renderer) => ensureFullscreenQuad(renderer, "filterQuad", renderer.filterShader, "Filter");
const ensureInkQuad    = (renderer) => ensureFullscreenQuad(renderer, "inkQuad",    renderer.inkShader,    "Ink");

// A texture the filters read pixel for pixel, with no smoothing.
function createTargetTexture(gl) {
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	return texture;
}

// Antialiased off-screen scene and the plain copies the filters read, resized with the canvas.
function ensureSceneTarget(renderer) {
	const { gl, canvas } = renderer;
	if (renderer.sceneTarget === null) {
		renderer.sceneTarget = {
			framebuffer       : gl.createFramebuffer(),
			resolveFramebuffer: gl.createFramebuffer(),
			edgeFramebuffer   : gl.createFramebuffer(),
			colorSamples      : gl.createRenderbuffer(),
			depthSamples      : gl.createRenderbuffer(),
			color             : createTargetTexture(gl),
			depth             : createTargetTexture(gl),
			edgeDepth         : createTargetTexture(gl),
			width: 0, height: 0,
		};
	}

	const target = renderer.sceneTarget;
	if (target.width === canvas.width && target.height === canvas.height) return target;

	target.width  = canvas.width;
	target.height = canvas.height;
	const samples = renderer.msaa ? FILTER_TUNING.Samples : 0;
	gl.bindRenderbuffer(gl.RENDERBUFFER, target.colorSamples);
	gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA8, target.width, target.height);
	gl.bindRenderbuffer(gl.RENDERBUFFER, target.depthSamples);
	gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, target.width, target.height);
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);

	gl.bindTexture(gl.TEXTURE_2D, target.color);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, target.width, target.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	for (const depth of [target.depth, target.edgeDepth]) {
		gl.bindTexture(gl.TEXTURE_2D, depth);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, target.width, target.height, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
	}
	gl.bindTexture(gl.TEXTURE_2D, null);

	gl.bindFramebuffer(gl.FRAMEBUFFER, target.edgeFramebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, target.edgeDepth, 0);
	gl.bindFramebuffer(gl.FRAMEBUFFER, target.resolveFramebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.color, 0);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, target.depth, 0);
	gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
	gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, target.colorSamples);
	gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.depthSamples);
	return target;
}

// Averages the antialiased scene down into a plain framebuffer the filters can read.
function resolveSceneTarget(gl, target, drawFramebuffer, mask) {
	gl.bindFramebuffer(gl.READ_FRAMEBUFFER, target.framebuffer);
	gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawFramebuffer);
	gl.blitFramebuffer(0, 0, target.width, target.height, 0, 0, target.width, target.height, mask, gl.NEAREST);
}

// Entries past u_skyStopCount are never sampled, so only the live stops are written.
function fillSkyStops(renderer, stops) {
	const data = renderer.skyStopData;
	for (let index = 0; index < stops.length; index++) {
		const stop = stops[index];
		const offset = index * 4;
		data[offset]     = stop.r;
		data[offset + 1] = stop.g;
		data[offset + 2] = stop.b;
		data[offset + 3] = stop.a;
	}
	return data;
}

// Both surfaces upload here, so a rollover queued before first draw is consumed too.
function ensureAnimatedSources(renderer, textureID, stateEntry) {
	const existing = renderer.animatedSources.get(textureID);
	if (existing !== undefined) return existing;

	const gl = renderer.gl;
	const createFrom = (source) => {
		const texture = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, texture);
		uploadTextureImage(gl, textureID, source, true);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		return texture;
	};

	const sources = { from: createFrom(stateEntry.fromSurface), to: createFrom(stateEntry.toSurface) };
	stateEntry.pendingSurface = null;
	renderer.animatedSources.set(textureID, sources);
	return sources;
}

function blendAnimatedTextures(renderer, sceneGraph) {
	const gl = renderer.gl;
	const byTextureID = sceneGraph.visualResources.textureAnimation.byTextureID;
	const quad = ensureBlendQuad(renderer);
	if (!quad) return;

	gl.disable(gl.DEPTH_TEST);
	gl.disable(gl.BLEND);
	gl.bindFramebuffer(gl.FRAMEBUFFER, renderer.blendFramebuffer);
	gl.useProgram(renderer.blendShader.program);
	gl.uniform1i(renderer.blendShader.uniforms.from, 0);
	gl.uniform1i(renderer.blendShader.uniforms.to, 1);
	gl.bindVertexArray(quad.vao);

	for (const textureID in byTextureID) {
		// Skip textures that were never drawn (not in the cache).
		const target = renderer.textures.get(textureID);
		if (target === undefined) continue;

		// Skip textures that weren't on screen last frame.
		if (!renderer.drawnTextures.has(textureID)) continue;

		const stateEntry = byTextureID[textureID];
		if (stateEntry.toSurface === null) continue;

		const sources = ensureAnimatedSources(renderer, textureID, stateEntry);

		// Outgoing "from" becomes the new "to"; same dimensions, so storage is reused.
		if (stateEntry.pendingSurface !== null) {
			const recycled = sources.from;
			sources.from = sources.to;
			sources.to = recycled;
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, sources.to);
			uploadTextureImage(gl, textureID, stateEntry.pendingSurface, false);
			stateEntry.pendingSurface = null;
		}

		if (stateEntry.phase !== "blend") continue;

		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target, 0);
		gl.viewport(0, 0, stateEntry.toSurface.width, stateEntry.toSurface.height);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, sources.from);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, sources.to);
		gl.uniform1f(renderer.blendShader.uniforms.ratio, stateEntry.blendRatio);
		gl.drawElements(gl.TRIANGLES, quad.indexCount, gl.UNSIGNED_SHORT, 0);
	}

	gl.bindVertexArray(null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.activeTexture(gl.TEXTURE0);
}

function ensureLevelRenderer(rootId, rootStyles) {
	const existing = levelRendererCache.get(rootId);
	if (existing) return existing;

	const root = ensureRoot(rootId, {
		position: "fixed",
		inset: "0",
		zIndex: "0",
		...rootStyles,
	});

	const canvas = document.createElement("canvas");
	canvas.id = `${rootId}-canvas`;
	canvas.style.width = "100%";
	canvas.style.height = "100%";
	canvas.style.display = "block";
	root.innerHTML = "";
	root.appendChild(canvas);

	// alpha: false — stops the white page bleeding through via framebuffer alpha.
	const msaa = !CONFIG.Debug.All || CONFIG.Debug.Levels.Performance.MSAA;
	const flatShading = CONFIG.Debug.All && CONFIG.Debug.Levels.Performance.FlatShading;
	const gl = canvas.getContext("webgl2", { alpha: false, antialias: msaa });
	if (!gl) {
		Log("ENGINE", "WebGL2 is not supported by this browser.", "error", "Render");
		return null;
	}

	const shader = CreateShader.Program(gl);
	if (!shader) return null;

	const scatterShader = CreateShader.ScatterProgram(gl);
	if (!scatterShader) {
		Log("ENGINE", "Failed to create instanced scatter shader.", "error", "Render");
		return null;
	}

	const decalShader = CreateShader.DecalProgram(gl);
	if (!decalShader) {
		Log("ENGINE", "Failed to create decal shader.", "error", "Render");
		return null;
	}

	const scatterDecalShader = CreateShader.ScatterDecalProgram(gl);
	if (!scatterDecalShader) {
		Log("ENGINE", "Failed to create scatter decal shader.", "error", "Render");
		return null;
	}

	const entityTriplanarShader = CreateShader.EntityTriplanarProgram(gl);
	if (!entityTriplanarShader) {
		Log("ENGINE", "Failed to create entity triplanar shader.", "error", "Render");
		return null;
	}

	const skyShader = CreateShader.SkyProgram(gl);
	if (!skyShader) {
		Log("ENGINE", "Failed to create sky shader.", "error", "Render");
		return null;
	}

	const blendShader = CreateShader.BlendProgram(gl);
	if (!blendShader) {
		Log("ENGINE", "Failed to create texture blend shader.", "error", "Render");
		return null;
	}

	const blendFramebuffer = gl.createFramebuffer();
	if (!blendFramebuffer) {
		Log("ENGINE", "Failed to create texture blend framebuffer.", "error", "Render");
		return null;
	}

	const filterShader = CreateShader.FilterProgram(gl);
	if (!filterShader) {
		Log("ENGINE", "Failed to create filter shader.", "error", "Render");
		return null;
	}

	const inkShader = CreateShader.InkProgram(gl);
	if (!inkShader) {
		Log("ENGINE", "Failed to create ink shader.", "error", "Render");
		return null;
	}

	const renderer = {
		rootId, root, canvas, gl, msaa, flatShading, shader, scatterShader, decalShader, scatterDecalShader, entityTriplanarShader, 
		skyShader, blendShader, blendFramebuffer, filterShader, inkShader,
		blendQuad              : null,
		skyQuad                : null,
		filterQuad             : null,
		inkQuad                : null,
		sceneTarget            : null,
		skyStopData            : new Float32Array(SKY_STOP_LIMIT * 4),
		animatedSources        : new Map(),
		drawnTextures          : new Set(),
		meshBuffers            : new Map(),
		textures               : new Map(),
		geometryRegistry       : new Map(),
		scatterInstances       : null,
		scatterDecalBatches    : null,
		scatterInstancesBuilt  : false,
		voidWallMeshes         : null,
		voidWallUvMeshes       : null,
		voidWallTriplanarMeshes: null,
		voidWallMeshesBuilt    : false,
		occlusion              : {
			hidden      : new Set(),                // Objects hidden this run
			lastHidden  : new Set(),                // Objects hidden last run, re-tested while they stay off
			useful      : new Set(),                // Blocker pieces that hid something this run
			lastUseful  : new Set(),                // Blocker pieces that hid something last run, ranked first
			flagged     : [],                       // Scatter squares and void walls hidden this run
			scratch     : {                         // Reused for every object tested: world corners, screen corners, screen rectangle
				wx: new Float64Array(8), wy: new Float64Array(8), wz: new Float64Array(8),
				sx: new Float64Array(8), sy: new Float64Array(8), rect: new Float64Array(4),
			},
			idleWindow  : 1,                        // Frames the next idle pause lasts
			pauseFrames : 0,                        // Frames left in the current idle pause
			idleSince   : 0,                        // When the current idle pause began
			lastPosition: ToVector3(Infinity),      // Camera at the last run; unset so the first frame counts as a jump
			lastForward : ToVector3(0),             // Camera direction at the last run
			lastMode    : null,                     // Camera mode at the last run
		},
		fallbackTexture        : createFallbackTexture(gl),
		loggedScatterSubmission: false,
		debugLineShader        : null,
		debugLineBuffer        : null,
		decalGeometry          : new WeakMap(),
	};

	levelRendererCache.set(rootId, renderer);
	return renderer;
}

// Scaled target, not client size to prevent per-frame re-allocation.
function syncCanvasSize(renderer) {
	const scale = CONFIG.Performance.Resolution / 100;
	const width  = Math.round(renderer.canvas.clientWidth  * scale);
	const height = Math.round(renderer.canvas.clientHeight * scale);

	if (renderer.canvas.width === width && renderer.canvas.height === height) return;
	renderer.canvas.width  = width;
	renderer.canvas.height = height;
}

// displayColor.a is authoritative when present — particle texture opacity is always 1.
const isTranslucentMesh = (mesh) => mesh.displayColor !== null ? mesh.displayColor.a < 1 : mesh.material.transparent;

// Triplanar only when the mesh is flagged. Unflagged meshes use UVs.
const meshUsesTriplanar = (mesh) => mesh.geometry.triplanar === true;

// Box around everything an entity draws: all its parts, or its single mesh.
function entityRenderBounds(entity) {
	return !entity.model ? entity.mesh.worldAabb : PointsAabb(entity.model.parts.flatMap((part) => [part.mesh.worldAabb.min, part.mesh.worldAabb.max]));
	return 
}

// Hides anything fully off screen until the next distance check turns it back on.
function hideOffscreen(sceneGraph, frustum) {
	const hide = (target, aabb, padding = 0) => {
		if (target.performance.rendering && AabbOutsideFrustum(frustum, aabb, padding)) target.performance.rendering = false;
	};

	sceneGraph.terrain.forEach((mesh) => hide(mesh, mesh.worldAabb));
	sceneGraph.obstacles.forEach((record) => hide(record, record.worldAabb));
	sceneGraph.entities.forEach((entity) => hide(entity, entityRenderBounds(entity), PERFORMANCE_SCALING.Culling.EntityPadding.value));
}

function collectRenderableMeshes(sceneGraph) {
	const terrain = [], obstacles = [];
	const entitiesUv = [], entitiesTriplanar = [], entitiesTranslucent = [];

	const collectEntityPart = (mesh) => {
		if (isTranslucentMesh(mesh)) { 
			entitiesTranslucent.push(mesh); 
			return; 
		}
		(meshUsesTriplanar(mesh) ? entitiesTriplanar : entitiesUv).push(mesh);
	};

	// Scatter and triggers are excluded — scatter via instanced path, triggers via post-scatter pass.
	sceneGraph.terrain.forEach((mesh) => {
		if (mesh.meta.mode !== "default" || !mesh.performance.rendering) return;
		terrain.push(mesh);
	});
	sceneGraph.obstacles.forEach((record) => {
		if (record.mode !== "default" || !record.performance.rendering) return;
		record.parts.forEach((part) => obstacles.push(part));
	});
	sceneGraph.entities.forEach((entity) => {
		if (!entity.performance.rendering) return;
		if (entity.model) return entity.model.parts.forEach((part) => collectEntityPart(part.mesh));
		collectEntityPart(entity.mesh);
	});

	return { terrain, obstacles, entitiesUv, entitiesTriplanar, entitiesTranslucent };
}

// Sorts meshes far-to-near from the camera, measuring each distance only once.
function sortBackToFront(meshes, cameraPosition) {
	const distancesSq = new Map();
	for (const mesh of meshes) distancesSq.set(mesh, Vector3Sq(SubtractVector3(mesh.displayTransform.position, cameraPosition)));
	meshes.sort((a, b) => distancesSq.get(b) - distancesSq.get(a));
}

function applySkyUniforms(gl, shader, passState) {
	gl.uniform4fv(shader.uniforms.skyStops, passState.skyStops);
	gl.uniform1i(shader.uniforms.skyStopCount, passState.skyStopCount);
	gl.uniform3f(shader.uniforms.waterTint, passState.waterTint.r, passState.waterTint.g, passState.waterTint.b);
	gl.uniform1f(shader.uniforms.underwater, passState.underwaterValue);
}

function configureTexturedMeshPass(gl, shader, passState) {
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.projection, false, passState.projection);
	gl.uniformMatrix4fv(shader.uniforms.view, false, passState.view);
	gl.uniform1f(shader.uniforms.fogFull, passState.fogFull);
	gl.uniform3f(shader.uniforms.colorShift, passState.colorShift.r, passState.colorShift.g, passState.colorShift.b);
	gl.uniform1f(shader.uniforms.comic, passState.comic);
	applySkyUniforms(gl, shader, passState);
}

// Draws the sky with depth test off so it never blocks later geometry.
function drawSkyPass(renderer, passState) {
	const gl = renderer.gl;
	const quad = ensureSkyQuad(renderer);
	if (!quad) return;

	const shader = renderer.skyShader;
	gl.disable(gl.DEPTH_TEST);
	gl.useProgram(shader.program);
	gl.uniformMatrix4fv(shader.uniforms.view, false, passState.view);
	gl.uniform2f(shader.uniforms.rayScale, 1 / passState.projection[0], 1 / passState.projection[5]);
	applySkyUniforms(gl, shader, passState);
	gl.bindVertexArray(quad.vao);
	gl.drawElements(gl.TRIANGLES, quad.indexCount, gl.UNSIGNED_SHORT, 0);
	gl.bindVertexArray(null);
	gl.enable(gl.DEPTH_TEST);
}

function ensureMeshBuffer(renderer, mesh, shader) {
	const { id, primitive, dimensions, complexity, geometry } = mesh;
	const meshBufferKey = `${id}|${primitive}|${dimensions.x}|${dimensions.y}|${dimensions.z}|${complexity}|${geometry.indices.length}`;
	let meshBuffer = renderer.meshBuffers.get(meshBufferKey);
	if (!meshBuffer) {
		meshBuffer = createMeshBuffers(renderer.gl, mesh, shader);
		if (!meshBuffer) return null;
		renderer.meshBuffers.set(meshBufferKey, meshBuffer);
	}

	return meshBuffer;
}

// Don't cull planes.
function setFaceCulling(gl, cull) {
	return cull && (!CONFIG.Debug.All || CONFIG.Debug.Levels.Performance.BackfaceCulling) ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE);
}

const keepWholeMesh = { level: 0, side: 0 };

function drawMeshList(renderer, sceneGraph, meshes, passState, options = {}) {
	if (meshes.length === 0) return;

	const gl = renderer.gl;
	const disableDepthWriteForPass = options.depthMask === false;

	const shader = options.triplanar ? renderer.entityTriplanarShader : renderer.shader;

	configureTexturedMeshPass(gl, shader, passState);
	if (disableDepthWriteForPass) gl.depthMask(false);
	if (!options.triplanar) {
		const waterClip = options.waterClip === undefined ? keepWholeMesh : options.waterClip;
		gl.uniform2f(shader.uniforms.waterClip, waterClip.level, waterClip.side);
	}

	for (const mesh of meshes) {
		const meshBuffer = ensureMeshBuffer(renderer, mesh, shader);
		if (!meshBuffer) continue;

		setFaceCulling(gl, options.cull !== false && mesh.primitive !== "plane");
		gl.bindVertexArray(meshBuffer.vao);
		gl.uniform1i(shader.uniforms.texture, 0);
		gl.uniformMatrix4fv(shader.uniforms.model, false, renderMatrixFor(mesh));
		gl.uniform4f(shader.uniforms.tint,
			mesh.displayColor !== null ? mesh.displayColor.r : mesh.material.color.r,
			mesh.displayColor !== null ? mesh.displayColor.g : mesh.material.color.g,
			mesh.displayColor !== null ? mesh.displayColor.b : mesh.material.color.b,
			mesh.displayColor !== null ? mesh.displayColor.a : mesh.material.opacity
		);
		if (options.triplanar) gl.uniform1f(shader.uniforms.texScale, mesh.material.textureScale);

		if (mesh.geometry.faceTextureGroups) {
			for (const group of mesh.geometry.faceTextureGroups) {
				const faceTex = ensureSceneTexture(renderer, sceneGraph, group.textureID);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, faceTex);
				gl.drawElements(gl.TRIANGLES, group.indexCount, gl.UNSIGNED_INT, group.indexStart * 4);
			}
			gl.bindVertexArray(null);
			continue;
		}

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, ensureSceneTexture(renderer, sceneGraph, mesh.material.textureID));
		gl.drawElements(gl.TRIANGLES, meshBuffer.indexCount, gl.UNSIGNED_INT, 0);
		gl.bindVertexArray(null);
	}

	if (disableDepthWriteForPass) gl.depthMask(true);
}

// Don't cull the water mesh's faces as you're meant to be inside them.
function drawWaterPass(renderer, sceneGraph, passState) {
	// Skip water under flat shading, where it would be an opaque slab hiding everything below it.
	if (renderer.flatShading) return;
	const meshes = sceneGraph.waterVisual === null ? [] : [sceneGraph.waterVisual.body, sceneGraph.waterVisual.top];
	drawMeshList(renderer, sceneGraph, meshes, passState, { depthMask: false, cull: false });
}

// Issued as runs of consecutive same-shader meshes so global sort order survives.
function drawSortedRuns(renderer, sceneGraph, meshes, passState) {
	let start = 0;
	while (start < meshes.length) {
		const triplanar = meshUsesTriplanar(meshes[start]);
		let end = start + 1;
		while (end < meshes.length && meshUsesTriplanar(meshes[end]) === triplanar) end++;
		const run = start === 0 && end === meshes.length ? meshes : meshes.slice(start, end);
		drawMeshList(renderer, sceneGraph, run, passState, { depthMask: false, triplanar });
		start = end;
	}
}

// Color filter over solid geometry. No depth-write and never culled.
function drawTriggerOverlay(renderer, sceneGraph, passState, waterClip = keepWholeMesh) {
	if (!sceneGraph.debug.showTriggerVolumes) return;
	drawMeshList(renderer, sceneGraph, sceneGraph.triggers, passState, { depthMask: false, cull: false, waterClip });
}

// Water is a fixed anchor: far side of the camera draws first, near side last.
function drawTranslucentPass(renderer, sceneGraph, meshes, passState, cameraPosition, waterLevelCnu, underwater) {
	sortBackToFront(meshes, cameraPosition);

	if (waterLevelCnu === null) {
		// Triggers are split to prevent depth-fighting with the water top.
		drawTriggerOverlay(renderer, sceneGraph, passState);
		drawSortedRuns(renderer, sceneGraph, meshes, passState);
		return;
	}

	const above = [], below = [];
	for (const mesh of meshes) (mesh.displayTransform.position.y > waterLevelCnu ? above : below).push(mesh);

	const { level, side } = passState.nearWaterClip;
	drawSortedRuns(renderer, sceneGraph, underwater ? above : below, passState);
	drawTriggerOverlay(renderer, sceneGraph, passState, { level, side: -side });
	drawWaterPass(renderer, sceneGraph, passState);
	drawTriggerOverlay(renderer, sceneGraph, passState, passState.nearWaterClip);
	drawSortedRuns(renderer, sceneGraph, underwater ? below : above, passState);
}

// Widest animated footprint in rest-footprint units; 1 when untracked.
function decalAnimationMargin(entity, partId, decalEntry) {
	if (entity === null) return 1;

	let scale = 1, offset = 0;
	for (const setName in entity.animations) {
		const partTrack = entity.animations[setName].parts[partId];
		if (partTrack === undefined) continue;

		const target = partTrack.decals[decalEntry.id];
		if (target === undefined || target.transform === undefined) continue;

		for (const keyframe of target.transform.keyframes) {
			const value = keyframe.value;
			if (value.scale !== undefined)    scale  = Math.max(scale, Math.abs(value.scale.x), Math.abs(value.scale.y));
			if (value.position !== undefined) offset = Math.max(offset, Vector3Length(value.position));
		}
	}
	if (scale === 1 && offset === 0) return 1;

	// Position offset in rest half-extents.
	const rest = decalEntry.localTransform.scale;
	return (scale + offset / (Math.min(Math.abs(rest.x), Math.abs(rest.y)) * 0.5)) * 1.15;
}

// One VAO per (mesh, decal), never rebuilt.
function ensureDecalGeometry(renderer, mesh, decalEntry, index, entity, partId) {
	let meshDecals = renderer.decalGeometry.get(mesh);
	if (meshDecals === undefined) {
		meshDecals = [];
		renderer.decalGeometry.set(mesh, meshDecals);
	}
	if (meshDecals[index] !== undefined) return meshDecals[index];

	const gl = renderer.gl;
	const positionBuffer = gl.createBuffer();
	if (!positionBuffer) {
		Log("ENGINE", "Decal geometry buffer creation failed", "error", "Render");
		return null;
	}

	const facets = SelectDecalFacets(
		mesh.geometry,
		BuildDecalPlacementMatrix(mesh.dimensions, decalEntry.localTransform, decalEntry.side),
		ResolveDecalShapeCode(mesh.shape, decalEntry.side),
		mesh.dimensions.clone().scale(0.5),
		DecalRounding(mesh.shape, mesh.detail.primitiveOptions),
		decalAnimationMargin(entity, partId, decalEntry)
	);

	const vao = gl.createVertexArray();
	gl.bindVertexArray(vao);
	gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, facets.positions, gl.STATIC_DRAW);
	gl.enableVertexAttribArray(renderer.decalShader.attributes.position);
	gl.vertexAttribPointer(renderer.decalShader.attributes.position, 3, gl.FLOAT, false, 0, 0);
	gl.bindVertexArray(null);

	meshDecals[index] = { vao, position: positionBuffer, vertexCount: facets.positions.length / 3 };
	return meshDecals[index];
}

// Rotations that turn a decal to face each side of a part.
const DECAL_FACE_ROTATIONS = {
	front:  [1, 0,  0, 0,  0, 1,  0, 0,  0,  0, 1, 0,  0, 0, 0, 1], // identity
	back:   [-1, 0, 0, 0,  0, 1,  0, 0,  0,  0,-1, 0,  0, 0, 0, 1], // 180° Y
	top:    [1, 0,  0, 0,  0, 0, -1, 0,  0,  1, 0, 0,  0, 0, 0, 1], // −90° X
	bottom: [1, 0,  0, 0,  0, 0,  1, 0,  0, -1, 0, 0,  0, 0, 0, 1], // +90° X
	right:  [0, 0, -1, 0,  0, 1,  0, 0,  1,  0, 0, 0,  0, 0, 0, 1], // +90° Y
	left:   [0, 0,  1, 0,  0, 1,  0, 0, -1,  0, 0, 0,  0, 0, 0, 1], // −90° Y
};

// Decal drawing state: blends over the surface and is pulled toward the camera to avoid flicker.
function beginDecalState(gl, shader, passState) {
	configureTexturedMeshPass(gl, shader, passState);
	gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
	gl.enable(gl.POLYGON_OFFSET_FILL);
	gl.polygonOffset(-1, -1);
	gl.depthMask(false);
}

function endDecalState(gl) {
	gl.depthMask(true);
	gl.disable(gl.POLYGON_OFFSET_FILL);
	
	// Restore the frame-init straight-alpha blend.
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
}

// displayTransform to render, localTransform to export.
export function BuildDecalPlacementMatrix(dim, transform, side) {
	const pos = transform.position, sc  = transform.scale;

	// Face center + local offset combined into a single translation in part-local CNU space.
	const faceTranslations = {
		front:  [pos.x,               pos.y,               pos.z + dim.z * 0.5],
		back:   [pos.x,               pos.y,               pos.z - dim.z * 0.5],
		top:    [pos.x,               pos.y + dim.y * 0.5, pos.z              ],
		bottom: [pos.x,               pos.y - dim.y * 0.5, pos.z              ],
		right:  [pos.x + dim.x * 0.5, pos.y,               pos.z              ],
		left:   [pos.x - dim.x * 0.5, pos.y,               pos.z              ],
	};


	// Moves the decal onto its face, turns it outward, spins and scales it. The part's transform is applied later in the shader.
	const [tx, ty, tz] = faceTranslations[side];
	const c = Math.cos(transform.rotation.value), s = Math.sin(transform.rotation.value);
	
	return MultiplyMatrix4(
		[1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  tx, ty, tz, 1], 
		MultiplyMatrix4(DECAL_FACE_ROTATIONS[side], 
			MultiplyMatrix4(
				[c, s, 0, 0,  -s, c, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1], 
				[sc.x, 0, 0, 0,  0, sc.y, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]
			)
		)
	);
}

function drawDecalPass(renderer, sceneGraph, passState) {
	const gl = renderer.gl;
	const uniforms = renderer.decalShader.uniforms;

	beginDecalState(gl, renderer.decalShader, passState);

	const drawDecalsForMesh = (mesh, entity = null, partId = null) => {
		if (mesh.customTextures.length === 0) return;

		setFaceCulling(gl, mesh.primitive !== "plane");
		
		// Mesh-level uniforms: identical for every decal on this mesh — set once.
		const dim = mesh.dimensions;
		gl.uniformMatrix4fv(uniforms.partWorld, false, renderMatrixFor(mesh));
		gl.uniform3f(uniforms.halfExtents, ...Vector3ToArray(dim.clone().scale(0.5)));
		gl.uniform1f(uniforms.rounding, DecalRounding(mesh.shape, mesh.detail.primitiveOptions));
		gl.uniform1i(uniforms.texture, 0);

		mesh.customTextures.forEach((decalEntry, index) => {
			const geometry = ensureDecalGeometry(renderer, mesh, decalEntry, index, entity, partId);
			gl.bindVertexArray(geometry.vao);
			gl.uniform1i(uniforms.shape, ResolveDecalShapeCode(mesh.shape, decalEntry.side));
			gl.uniformMatrix4fv(
				uniforms.placement, false, 
				new Float32Array(BuildDecalPlacementMatrix(dim, decalEntry.displayTransform, decalEntry.side))
			);
			if (decalEntry.mutable === true && decalEntry.activeSourceKey === null) {
				const tint = decalEntry.displayColor !== null ? decalEntry.displayColor : decalEntry.texture.primary;
				gl.uniform4f(uniforms.tint, tint.r, tint.g, tint.b, tint.a);
			}
			else gl.uniform4f(uniforms.tint, 1, 1, 1, 1);

			const baseKey = `${mesh.id}::customTexture::${index}`;
			const textureKey = decalEntry.activeSourceKey !== null ? `${baseKey}::${decalEntry.activeSourceKey}` : baseKey;
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, ensureSceneTexture(renderer, sceneGraph, textureKey));
			gl.drawArrays(gl.TRIANGLES, 0, geometry.vertexCount);
		});
	};

	sceneGraph.entities.forEach((entity) => {
		if (!entity.model || !entity.performance.rendering) return;
		entity.model.parts.forEach((part) => drawDecalsForMesh(part.mesh, entity, part.id));
	});
	sceneGraph.obstacles.forEach((obstacle) => {
		if (!obstacle.performance.rendering) return;
		obstacle.parts.forEach((part) => drawDecalsForMesh(part));
	});
	sceneGraph.terrain.forEach((mesh) => { if (mesh.performance.rendering) drawDecalsForMesh(mesh); });

	gl.bindVertexArray(null);
	endDecalState(gl);
}

// A scatter square is drawn only when part of it is within the scatter cull radius and on screen.
function scatterCellVisible(cell, passState) {
	return Vector3SqDistanceToAabb(passState.cameraPosition, cell.aabb) <= passState.cullRadius * passState.cullRadius
		&& !AabbOutsideFrustum(passState.frustum, cell.aabb);
}

// Instanced counterpart of drawDecalPass — placement/shape are precomputed in buildScatterInstanceBuffers.
function drawScatterDecalPass(renderer, sceneGraph, passState) {
	if (renderer.scatterDecalBatches.length === 0) return;

	const gl = renderer.gl;
	const uniforms = renderer.scatterDecalShader.uniforms;

	beginDecalState(gl, renderer.scatterDecalShader, passState);
	gl.uniform1f(uniforms.cullRadius, passState.cullRadius);
	gl.uniform1i(uniforms.texture, 0);
	gl.uniform4f(uniforms.tint, 1, 1, 1, 1);
	gl.activeTexture(gl.TEXTURE0);

	renderer.scatterDecalBatches.forEach((batch) => {
		setFaceCulling(gl, batch.primitive !== "plane");
		gl.uniform3f(uniforms.halfExtents, ...Vector3ToArray(batch.dimensions.clone().scale(0.5)));
		gl.uniform1f(uniforms.rounding, batch.rounding);

		batch.decalDraws.forEach((draw) => {
			gl.uniform1i(uniforms.shape, draw.shapeCode);
			gl.uniformMatrix4fv(uniforms.placement, false, draw.placement);
			gl.bindTexture(gl.TEXTURE_2D, ensureSceneTexture(renderer, sceneGraph, draw.textureKey));
			batch.cells.forEach((cell, index) => {
				if (!scatterCellVisible(cell, passState) || cell.occluded) return;
				gl.bindVertexArray(draw.cellVaos[index]);
				gl.drawArraysInstanced(gl.TRIANGLES, 0, draw.vertexCount, cell.count);
			});
		});
	});

	gl.bindVertexArray(null);
	endDecalState(gl);
}

// Flatten every void entry's relation voidWallMeshes into one list (used for textured draws).
function gatherVoidWallMeshes(entries) {
	const meshes = [];
	for (const entry of entries) {
		for (const id in entry.relations) meshes.push(...entry.relations[id].voidWallMeshes);
	}
	return meshes;
}

// Void walls are fixed at level build, so the shader split is resolved once.
function ensureVoidWallMeshes(renderer, sceneGraph) {
	if (renderer.voidWallMeshesBuilt) return;
	const meshes = gatherVoidWallMeshes(sceneGraph.voids.terrain);
	meshes.push(...gatherVoidWallMeshes(sceneGraph.voids.obstacles));
	renderer.voidWallMeshes          = meshes;
	renderer.voidWallUvMeshes       = meshes.filter((mesh) => !meshUsesTriplanar(mesh));
	renderer.voidWallTriplanarMeshes = meshes.filter(meshUsesTriplanar);
	renderer.voidWallMeshesBuilt     = true;
}

function drawVoidWalls(renderer, sceneGraph, passState) {
	const onScreen = (mesh) => !AabbOutsideFrustum(passState.frustum, mesh.worldAabb) && !mesh.occluded;
	drawMeshList(renderer, sceneGraph, renderer.voidWallUvMeshes.filter(onScreen),        passState);
	drawMeshList(renderer, sceneGraph, renderer.voidWallTriplanarMeshes.filter(onScreen), passState, { triplanar: true });
}

/* === OCCLUSION === */
// Hides what sits fully behind solid terrain, testing only what the distance and view checks left on.

// Left on by the distance and view checks. Last run's hidden objects stay on until the next update.
function stillOn(target, lastHidden) {
	return target.performance.rendering || lastHidden.has(target);
}

// The terrain pieces most likely to hide things this frame, put on screen. Pieces that hid something last run go first.
function chooseBlockers(sceneGraph, passState, near, occlusion) {
	const { frustum, viewProjection, cameraPosition: camera } = passState;
	const { scratch, lastUseful, lastHidden } = occlusion;

	// Pieces in view, scored by size over distance without putting them on screen.
	const candidates = [];
	for (const mesh of sceneGraph.terrain) {
		if (mesh.meta.mode !== "default" || !stillOn(mesh, lastHidden)) continue;
		for (const piece of mesh.occluder.pieces) {
			if (AabbOutsideFrustum(frustum, piece.worldAabb)) continue;
			const score = lastUseful.has(piece) ? Infinity : piece.face / Math.max(Vector3SqDistanceToAabb(camera, piece.worldAabb), 1e-6);
			candidates.push({ piece, occluder: mesh.occluder, score });
		}
	}
	candidates.sort((a, b) => b.score - a.score);

	// Only the best few go on screen; a piece crossing the camera's near limit is left out.
	const blockers = [];
	for (const { piece, occluder } of candidates) {
		if (blockers.length >= PERFORMANCE_SCALING.Culling.BlockerBudget) break;
		for (let k = 0; k < 8; k++) {
			scratch.wx[k] = piece.corners[k].x;
			scratch.wy[k] = piece.corners[k].y;
			scratch.wz[k] = piece.corners[k].z;
		}
		if (!ProjectBoxCorners(viewProjection, near, scratch)) continue;

		const hull = ConvexHull2D(scratch.sx, scratch.sy);
		if (hull.length < 3) continue;
		blockers.push({ 
			piece, hull, 
			inverse: occluder.inverse,
			 cameraLocal: TransformPointByMatrix(camera, occluder.inverse), 
			 rect: scratch.rect.slice() 
		});
	}
	return blockers;
}

// Turns off objects fully behind the chosen terrain pieces, then sets the next idle pause.
function hideOccluded(renderer, sceneGraph, passState, cameraState) {
	const occlusion = renderer.occlusion;

	// Last run's hidden scatter squares and void walls draw again unless this run hides them.
	for (const surface of occlusion.flagged) surface.occluded = false;
	occlusion.flagged.length = 0;

	// This run's results start empty; the previous run's become last run's.
	[occlusion.hidden, occlusion.lastHidden] = [occlusion.lastHidden, occlusion.hidden];
	[occlusion.useful, occlusion.lastUseful] = [occlusion.lastUseful, occlusion.useful];
	occlusion.hidden.clear();
	occlusion.useful.clear();

	if (CONFIG.Debug.All && !CONFIG.Debug.Levels.Performance.OcclusionCulling) return;

	// A big camera move, turn or mode change ends any pause and drops last run's blocker ranking.
	const { ResumeDistance, ResumeTurn, IdleBackoffMs, EntityPadding } = PERFORMANCE_SCALING.Culling;
	const forward = ResolveVector3Axis(SubtractVector3(cameraState.target, cameraState.position));
	const moved   = Vector3Sq(SubtractVector3(cameraState.position, occlusion.lastPosition)) > ResumeDistance.value ** 2;
	const turned  = AngleBetweenVector3(forward, occlusion.lastForward) > ResumeTurn.toRadians();
	if (moved || turned || cameraState.activeMode !== occlusion.lastMode) {
		occlusion.pauseFrames = 0;
		occlusion.lastUseful.clear();
	}

	// While paused, nothing is hidden.
	if (occlusion.pauseFrames > 0 && performance.now() - occlusion.idleSince < IdleBackoffMs) {
		occlusion.pauseFrames--;
		return;
	}
	occlusion.lastPosition = CloneVector3(cameraState.position);
	occlusion.lastForward  = forward;
	occlusion.lastMode     = cameraState.activeMode;

	const { lastHidden } = occlusion;
	const near     = cameraState.near.value;
	const blockers = chooseBlockers(sceneGraph, passState, near, occlusion);
	const { viewProjection, frustum, cameraPosition: camera } = passState;
	const { wx, wy, wz, sx, sy, rect } = occlusion.scratch;

	// Grows a box by its pad plus a margin that widens with distance, then checks it against each blocker, cheapest test first.
	function behindBlocker(aabb, pad) {
		const d = MaxVector3(SubtractVector3(aabb.min, camera), MaxVector3(ToVector3(0), SubtractVector3(camera, aabb.max)));
		const grow = pad + 0.05 + Math.sqrt(DotVector3(d)) * 0.002;
		for (let k = 0; k < 8; k++) {
			wx[k] = k & 1 ? aabb.max.x + grow : aabb.min.x - grow;
			wy[k] = k & 2 ? aabb.max.y + grow : aabb.min.y - grow;
			wz[k] = k & 4 ? aabb.max.z + grow : aabb.min.z - grow;
		}
		if (!ProjectBoxCorners(viewProjection, near, occlusion.scratch)) return false;

		for (const blocker of blockers) {
			const outer = blocker.rect;
			if (rect[0] < outer[0] || rect[1] < outer[1] || rect[2] > outer[2] || rect[3] > outer[3]) continue;
			if (!CornersInsideHull(blocker.hull, sx, sy)) continue;
			if (!BeyondFrontFaces(blocker.piece.min, blocker.piece.max, blocker.inverse, blocker.cameraLocal, wx, wy, wz)) continue;
			occlusion.useful.add(blocker.piece);
			return true;
		}
		return false;
	}

	// Objects turn off until the next distance check; scatter squares and void walls are flagged until the next run.
	function hideTarget(target) {
		target.performance.rendering = false;
		occlusion.hidden.add(target);
	}
	function flagSurface(surface) {
		surface.occluded = true;
		occlusion.flagged.push(surface);
	}

	if (blockers.length > 0) {
		for (const mesh of sceneGraph.terrain) {
			if (mesh.meta.mode === "default" && stillOn(mesh, lastHidden) && behindBlocker(mesh.worldAabb, 0)) hideTarget(mesh);
		}
		for (const record of sceneGraph.obstacles) {
			if (record.mode === "default" && stillOn(record, lastHidden) && behindBlocker(record.worldAabb, 0)) hideTarget(record);
		}
		for (const entity of sceneGraph.entities) {
			if (stillOn(entity, lastHidden) && behindBlocker(entityRenderBounds(entity), EntityPadding.value)) hideTarget(entity);
		}
		for (const mesh of renderer.voidWallMeshes) {
			if (!AabbOutsideFrustum(frustum, mesh.worldAabb) && behindBlocker(mesh.worldAabb, 0)) flagSurface(mesh);
		}
		for (const batch of renderer.scatterInstances) {
			for (const cell of batch.cells) if (scatterCellVisible(cell, passState) && behindBlocker(cell.aabb, 0)) flagSurface(cell);
		}
	}

	// Something hidden keeps checks running every frame; nothing hidden pauses them for a window that doubles each time.
	if (occlusion.hidden.size > 0 || occlusion.flagged.length > 0) {
		occlusion.idleWindow  = 1;
		occlusion.pauseFrames = 0;
		return;
	}
	occlusion.pauseFrames = occlusion.idleWindow;
	occlusion.idleWindow *= 2;
	occlusion.idleSince   = performance.now();
}

// Runs before scatter and translucents, so they cover the lines and add none of their own.
function drawInkPass(renderer, passState, cameraState) {
	const gl = renderer.gl, quad = ensureInkQuad(renderer);
	if (!quad) return;

	const uniforms = renderer.inkShader.uniforms;
	const target = renderer.sceneTarget;

	// The depth the lines are found in.
	resolveSceneTarget(gl, target, target.edgeFramebuffer, gl.DEPTH_BUFFER_BIT);
	gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);

	gl.disable(gl.DEPTH_TEST);
	gl.useProgram(renderer.inkShader.program);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, target.edgeDepth);
	gl.uniform1i(uniforms.depth, 0);
	gl.uniformMatrix4fv(uniforms.view, false, passState.view);
	gl.uniform2f(uniforms.rayScale, 1 / passState.projection[0], 1 / passState.projection[5]);
	gl.uniform1f(uniforms.near, cameraState.near.value);
	gl.uniform1f(uniforms.far, cameraState.far.value);
	gl.uniform1f(uniforms.fogFull, passState.fogFull);
	gl.uniform1f(uniforms.cameraY, cameraState.position.y);
	gl.uniform2f(uniforms.waterClip, passState.nearWaterClip.level, passState.nearWaterClip.side);
	gl.bindVertexArray(quad.vao);
	gl.drawElements(gl.TRIANGLES, quad.indexCount, gl.UNSIGNED_SHORT, 0);
	gl.bindVertexArray(null);
	gl.enable(gl.DEPTH_TEST);
}

// Draws the filtered scene to the screen, writing its depth too so the debug overlays still hide behind geometry.
function drawFilterPass(renderer, passState) {
	const gl = renderer.gl;
	const quad = ensureFilterQuad(renderer);
	if (!quad) return;

	const target = renderer.sceneTarget;
	resolveSceneTarget(gl, target, target.resolveFramebuffer, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.disable(gl.BLEND);
	gl.depthFunc(gl.ALWAYS);
	gl.useProgram(renderer.filterShader.program);
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, renderer.sceneTarget.color);
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, renderer.sceneTarget.depth);
	gl.uniform1i(renderer.filterShader.uniforms.color, 0);
	gl.uniform1i(renderer.filterShader.uniforms.depth, 1);
	gl.uniform1f(renderer.filterShader.uniforms.comic, passState.comic);
	gl.bindVertexArray(quad.vao);
	gl.drawElements(gl.TRIANGLES, quad.indexCount, gl.UNSIGNED_SHORT, 0);
	gl.bindVertexArray(null);
	gl.activeTexture(gl.TEXTURE0);

	gl.depthFunc(gl.LESS);
	gl.enable(gl.BLEND);
}

function drawScene(renderer, sceneGraph) {
	const gl = renderer.gl;
	const filters = CONFIG.Rendering.Filters;
	const filtered = filters.ToonLines || filters.Comic;

	syncCanvasSize(renderer);

	// Writes animated textures off-screen; viewport/depth/blend below restore what it touched.
	blendAnimatedTextures(renderer, sceneGraph);

	// Reset after the blend: it only updates animated textures drawn last frame.
	renderer.drawnTextures.clear();

	// Filters draw the scene off-screen first, then onto the canvas in drawFilterPass.
	gl.bindFramebuffer(gl.FRAMEBUFFER, filtered ? ensureSceneTarget(renderer).framebuffer : null);
	gl.viewport(0, 0, renderer.canvas.width, renderer.canvas.height);
	gl.enable(gl.DEPTH_TEST);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	setFaceCulling(gl, true);
	gl.clearColor(0.04, 0.05, 0.08, 1);
	gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

	const cameraState = sceneGraph.cameraConfig.state;

	const projection = new Float32Array(createPerspectiveMatrix(
		cameraState.fov,
		renderer.canvas.width / renderer.canvas.height,
		cameraState.near.value,
		cameraState.far.value
	));
	const view = new Float32Array(createLookAtMatrix(cameraState.position, cameraState.target, cameraState.up));
	const viewProjection = MultiplyMatrix4(projection, view);
	const frustum = FrustumPlanes(viewProjection);

	const waterLevelCnu = sceneGraph.world.water.level === null ? null : sceneGraph.world.water.level.value;
	const underwater = waterLevelCnu !== null && cameraState.position.y < waterLevelCnu;
	const colorShift = underwater ? { r: -0.06, g: 0.02, b: 0.08 } : { r: 0, g: 0, b: 0 };
	const underwaterValue = underwater ? 1 : 0;
	const simDistance = PERFORMANCE_SCALING.SimDistance.Tiers[CONFIG.Performance.SimDistance].toWorldUnit();
	const worldInstances = PERFORMANCE_SCALING.SimDistance.Fractions.WorldInstances;
	const fogPercent = underwater ? CONFIG.Rendering.Fog.Water : CONFIG.Rendering.Fog.Air;
	const fogFull = simDistance * worldInstances.Cull * worldInstances.Fog * (fogPercent / 100);
	const cullRadius = simDistance * PERFORMANCE_SCALING.SimDistance.Fractions.Scatter.Cull;
	const skyStops = sceneGraph.world.skybox.stops;

	// Keeps only what's on the camera's side of the water surface.
	const nearWaterClip = waterLevelCnu === null
		? keepWholeMesh
		: { level: sceneGraph.world.water.level.toWorldUnit(), side: underwater ? -1 : 1 };

	const passState = {
		projection, view, viewProjection, frustum, fogFull, colorShift, underwaterValue, cullRadius, nearWaterClip,
		cameraPosition: cameraState.position,
		comic       : filters.Comic ? 1 : 0,
		skyStops    : fillSkyStops(renderer, skyStops),
		skyStopCount: skyStops.length,
		waterTint   : sceneGraph.world.water.tint,
	};

	drawSkyPass(renderer, passState);

	if (
		underwater &&
		sceneGraph.effects.underwater &&
		typeof sceneGraph.effects.underwater.particleHook === "function"
	) {
		sceneGraph.effects.underwater.particleHook(cameraState, sceneGraph);
	}

	hideOffscreen(sceneGraph, frustum);

	// Scatter squares and void walls must exist before the occlusion step can test them.
	if (!renderer.scatterInstancesBuilt) buildScatterInstanceBuffers(renderer, sceneGraph);
	ensureVoidWallMeshes(renderer, sceneGraph);
	hideOccluded(renderer, sceneGraph, passState, cameraState);
	const { terrain, obstacles, entitiesUv, entitiesTriplanar, entitiesTranslucent } = collectRenderableMeshes(sceneGraph);

	// === PASS 2.5: Void walls (textured interior surfaces inside void holes) ===
	drawVoidWalls(renderer, sceneGraph, passState);

	// === PASS A: hosts ship pre-carved from the builder; entities unaffected ===
	drawMeshList(renderer, sceneGraph, terrain,           passState);
	drawMeshList(renderer, sceneGraph, obstacles,         passState);
	drawMeshList(renderer, sceneGraph, entitiesUv,        passState);
	drawMeshList(renderer, sceneGraph, entitiesTriplanar, passState, { triplanar: true });

	// === PASS E: Decal quads (custom textures, alpha-blended on top of geometry) ===
	drawDecalPass(renderer, sceneGraph, passState);

	// === PASS E2: Toon lines, under scatter and translucents ===
	if (filters.ToonLines) drawInkPass(renderer, passState, cameraState);

	// === PASS B: Instanced scatter rendering ===
	if (renderer.scatterInstances.length > 0) {
		configureTexturedMeshPass(gl, renderer.scatterShader, passState);
		gl.uniform1f(renderer.scatterShader.uniforms.cullRadius, passState.cullRadius);

		renderer.scatterInstances.forEach(batch => {
			setFaceCulling(gl, batch.primitive !== "plane");
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, ensureSceneTexture(renderer, sceneGraph, batch.textureID));
			gl.uniform1i(renderer.scatterShader.uniforms.texture, 0);
			for (const cell of batch.cells) {
				if (!scatterCellVisible(cell, passState) || cell.occluded) continue;
				gl.bindVertexArray(cell.vao);
				gl.drawElementsInstanced(gl.TRIANGLES, batch.indexCount, gl.UNSIGNED_SHORT, 0, cell.count);
			}
			gl.bindVertexArray(null);
		});
	}

	// === PASS B2: Instanced scatter decals (custom textures baked per batch) ===
	drawScatterDecalPass(renderer, sceneGraph, passState);

	// === PASS D: Translucent meshes and trigger overlay, water-anchored (sorted back-to-front, no depth write) ===
	drawTranslucentPass(renderer, sceneGraph, entitiesTranslucent, passState, cameraState.position, waterLevelCnu, underwater);

	// === PASS F: Comic color, onto the canvas ===
	if (filtered) drawFilterPass(renderer, passState);

	drawBoundingBoxes(renderer, sceneGraph, projection, view);
	drawGridOverlay(renderer, sceneGraph, projection, view);
	drawDetailedBounds(renderer, sceneGraph, projection, view);
	drawVelocityTrails(renderer, sceneGraph, projection, view);
}

function RenderLevel(sceneGraph, options) {
	const renderer = ensureLevelRenderer(options.rootId, options.rootStyles);
	if (!renderer) return;
	drawScene(renderer, sceneGraph);
}

/* === ELEMENTS === */
// Utility helpers for updating rendered elements.

const GetElement = (elementId) => UIElement.get(elementId).element;
const SetElementText = (elementId, text) => UIElement.get(elementId).setText(text, true);
const SetElementSource = (elementId, src) => UIElement.get(elementId).setSource(src, true);
const SetElementStyle = (elementId, styles) => UIElement.get(elementId).setStyle(styles, true);
const FadeElement = (elementId, targetOpacity, durationSeconds) => UIElement.get(elementId).fadeTo(targetOpacity, durationSeconds);
const RemoveRoot = (rootId) => UIElement.removeRoot(rootId);
const ClearLevelRenderer = (rootId) => levelRendererCache.delete(rootId);

/* === EXPORTS === */
// Public render helpers for engine modules.

export {
	RenderPayload,
	ApplyRootStylesheet,
	RenderLevel,
	GetElement,
	SetElementText,
	SetElementSource,
	SetElementStyle,
	FadeElement,
	RemoveRoot,
	ClearLevelRenderer,
	DECAL_SHAPE_CODES,
	DECAL_FACE_ROTATIONS,
	ResolveDecalShapeCode,
	DecalSurfaceUv,
	SelectDecalFacets,
	CapsuleBand,
	DecalRounding
};