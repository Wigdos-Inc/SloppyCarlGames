import { ScaleVector3 } from "./Vector3.js";
import { CNU_SCALE } from "./Utilities.js";

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

export {
	CreateIdentityMatrix,
	CreateModelMatrix,
	CreateRenderMatrix,
	MultiplyMatrix4,
};