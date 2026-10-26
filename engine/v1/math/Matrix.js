import { ScaleVector3 } from "./Vector3.js";
import { Clamp, CloneTransform, CNU_SCALE } from "./Utilities.js";

function CreateIdentityMatrix() {
	return [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	];
}

function MultiplyMatrix4(a, b) {
	const out = new Array(16);
	for (let col = 0; col < 4; col++) {
		for (let row = 0; row < 4; row++) {
			out[col * 4 + row] =
				a[0 * 4 + row] * b[col * 4 + 0] +
				a[1 * 4 + row] * b[col * 4 + 1] +
				a[2 * 4 + row] * b[col * 4 + 2] +
				a[3 * 4 + row] * b[col * 4 + 3];
		}
	}
	return out;
}

function TransformPointByMatrix(localPoint, matrix) {
	return {
		x: matrix[0] * localPoint.x + matrix[4] * localPoint.y + matrix[8] * localPoint.z + matrix[12],
		y: matrix[1] * localPoint.x + matrix[5] * localPoint.y + matrix[9] * localPoint.z + matrix[13],
		z: matrix[2] * localPoint.x + matrix[6] * localPoint.y + matrix[10] * localPoint.z + matrix[14],
	};
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
	const c = Math.cos(radians), s = Math.sin(radians);
	return [
		1, 0, 0, 0,
		0, c, s, 0,
		0, -s, c, 0,
		0, 0, 0, 1,
	];
}

function createRotationY(radians) {
	const c = Math.cos(radians), s = Math.sin(radians);
	return [
		c, 0, -s, 0,
		0, 1, 0, 0,
		s, 0, c, 0,
		0, 0, 0, 1,
	];
}

function createRotationZ(radians) {
	const c = Math.cos(radians), s = Math.sin(radians);
	return [
		c, s, 0, 0,
		-s, c, 0, 0,
		0, 0, 1, 0,
		0, 0, 0, 1,
	];
}

// Row-major 3x3 of Ry·Rx·Rz for one Euler triple.
function eulerRotationRows(rotation) {
	const cx = Math.cos(rotation.x), sx = Math.sin(rotation.x);
	const cy = Math.cos(rotation.y), sy = Math.sin(rotation.y);
	const cz = Math.cos(rotation.z), sz = Math.sin(rotation.z);
	return [
		(cy * cz) + (sy * sx * sz), (sy * sx * cz) - (cy * sz), sy * cx,
		cx * sz,                    cx * cz,                    -sx,
		(cy * sx * sz) - (sy * cz), (sy * sz) + (cy * sx * cz), cy * cx,
	];
}

// Inverse of eulerRotationRows; at the ±90° pitch pole degenerateRoll seeds the free angle.
function decomposeEulerRows(m, degenerateRoll) {
	const pitch = Math.asin(Clamp(-m[5], -1, 1));
	if (Math.abs(m[5]) > 0.999999) {
		const free = Math.atan2(-m[6], m[0]);
		return { x: pitch, y: m[5] < 0 ? free + degenerateRoll : free - degenerateRoll, z: degenerateRoll };
	}
	return { x: pitch, y: Math.atan2(m[2], m[8]), z: Math.atan2(m[3], m[4]) };
}

/**
 * Euler triple for the orthonormal basis whose columns are (right, up, forward).
 * @param {{ x, y, z }} right
 * @param {{ x, y, z }} up
 * @param {{ x, y, z }} forward
 * @param {number} degenerateRoll — roll seed, used only at the pitch pole.
 * @returns {{ x: number, y: number, z: number }}
 */
function EulerFromBasis(right, up, forward, degenerateRoll) {
	return decomposeEulerRows([
		right.x, up.x, forward.x,
		right.y, up.y, forward.y,
		right.z, up.z, forward.z,
	], degenerateRoll);
}

/**
 * Euler triple equivalent to applying parentRotation after localRotation.
 * Adding the two triples is only correct while the parent is yaw-only.
 * @param {{ x, y, z }} parentRotation — radians.
 * @param {{ x, y, z }} localRotation — radians.
 * @returns {{ x: number, y: number, z: number }}
 */
function ComposeEulerRotations(parentRotation, localRotation) {
	const parent = eulerRotationRows(parentRotation);
	const local = eulerRotationRows(localRotation);
	const m = new Array(9);
	for (let row = 0; row < 3; row++) {
		for (let col = 0; col < 3; col++) {
			m[(row * 3) + col] =
				(parent[row * 3] * local[col]) +
				(parent[(row * 3) + 1] * local[3 + col]) +
				(parent[(row * 3) + 2] * local[6 + col]);
		}
	}

	// Yaw-only parent: no prior roll to carry at the pole.
	return decomposeEulerRows(m, 0);
}

function buildModelMatrix(position, pivotPost, rotation, scale, pivotPre) {
	let matrix = CreateIdentityMatrix();
	matrix = MultiplyMatrix4(matrix, createTranslationMatrix(position));
	matrix = MultiplyMatrix4(matrix, createTranslationMatrix(pivotPost));
	matrix = MultiplyMatrix4(matrix, createRotationY(rotation.y));
	matrix = MultiplyMatrix4(matrix, createRotationX(rotation.x));
	matrix = MultiplyMatrix4(matrix, createRotationZ(rotation.z));
	matrix = MultiplyMatrix4(matrix, createScaleMatrix(scale));
	matrix = MultiplyMatrix4(matrix, createTranslationMatrix(ScaleVector3(pivotPre, -1)));
	return matrix;
}

function CreateModelMatrix(transform) {
	const { position, pivot, rotation, scale } = transform;
	return buildModelMatrix(position, pivot, rotation, scale, pivot);
}

function CreateRenderMatrix(transform) {
	return buildModelMatrix(
		transform.position.toWorldUnit(),
		transform.pivot.toWorldUnit(),
		transform.rotation,
		ScaleVector3(transform.scale, CNU_SCALE),
		transform.pivot,
	);
}

// Matrix plus a by-value snapshot of its source fields; always fully populated.
function CreateRenderMatrixCache(transform) {
	return { matrix: new Float32Array(CreateRenderMatrix(transform)), ...CloneTransform(transform) };
}

// Undoes a rotate/scale/move matrix laid out like the render matrices.
function InvertAffineMatrix(m) {
	const [a, b, c, d, e, f, g, h, i] = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
	const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
	const r = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
		(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
		(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
	const [tx, ty, tz] = [m[12], m[13], m[14]];
	return [r[0], r[3], r[6], 0, r[1], r[4], r[7], 0, r[2], r[5], r[8], 0,
		-(r[0] * tx + r[1] * ty + r[2] * tz), -(r[3] * tx + r[4] * ty + r[5] * tz), -(r[6] * tx + r[7] * ty + r[8] * tz), 1];
}

// The six walls of what a projection × view matrix can see, each as [x, y, z, offset] facing inward.
function FrustumPlanes(matrix) {
	const row = (r) => [matrix[r], matrix[4 + r], matrix[8 + r], matrix[12 + r]];
	const [r0, r1, r2, r3] = [row(0), row(1), row(2), row(3)];
	const plus  = (r) => r3.map((value, i) => value + r[i]);
	const minus = (r) => r3.map((value, i) => value - r[i]);
	return [plus(r0), minus(r0), plus(r1), minus(r1), plus(r2), minus(r2)];
}

export {
	ComposeEulerRotations,
	EulerFromBasis,
	CreateIdentityMatrix,
	CreateModelMatrix,
	CreateRenderMatrix,
	CreateRenderMatrixCache,
	FrustumPlanes,
	InvertAffineMatrix,
	MultiplyMatrix4,
	TransformPointByMatrix,
};