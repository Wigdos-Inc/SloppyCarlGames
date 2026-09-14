import { CloneVector3, ScaleVector3 } from "./Vector3.js";
import { Clamp, CNU_SCALE } from "./Utilities.js";

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
	return buildModelMatrix(
		transform.position,
		transform.pivot,
		transform.rotation,
		transform.scale,
		transform.pivot,
	);
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
	return {
		matrix  : new Float32Array(CreateRenderMatrix(transform)),
		position: transform.position.clone(),
		pivot   : transform.pivot.clone(),
		rotation: transform.rotation.clone(),
		scale   : CloneVector3(transform.scale),
	};
}

export {
	ComposeEulerRotations,
	EulerFromBasis,
	CreateIdentityMatrix,
	CreateModelMatrix,
	CreateRenderMatrix,
	CreateRenderMatrixCache,
	MultiplyMatrix4,
};