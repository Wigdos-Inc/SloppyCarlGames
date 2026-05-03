// Advanced Math Stuff

import { EPSILON } from "../core/meta.js";
import { Clamp, Clamp01 } from "./Utilities.js";

/* === MATH === */
// Perform math operations on canonized vectors.

function Vector3ChainMath(a, b = [], chainDefinition = "") {
	const math = (vector, target) => {
		switch (target) {
			case "+": return AddVector3(a, vector);
			case "-": return SubtractVector3(a, vector);
			case "*": return MultiplyVector3(a, vector);
			case "/": return DivideVector3(a, vector);
			case ".": return DotVector3(a, vector);
		}
	}

	for (let i=0; i < chainDefinition.length; i++) a = math(b[i], chainDefinition[i]);
	return a;
}

function ToVector3(value) {
	return {
		x: value,
		y: value,
		z: value,
	};
}

function AddVector3(a, b) {
	return {
		x: a.x + b.x,
		y: a.y + b.y,
		z: a.z + b.z,
	};
}

function SubtractVector3(a, b) {
	return {
		x: a.x - b.x,
		y: a.y - b.y,
		z: a.z - b.z,
	};
}

function DivideVector3(a, b) {
	return {
		x: a.x / b.x,
		y: a.y / b.y,
		z: a.z / b.z,
	};
}

function MultiplyVector3(a, b) {
	return { 
		x: a.x * b.x, 
		y: a.y * b.y, 
		z: a.z * b.z 
	};
}

function ScaleVector3(vector, scalar) {
	return MultiplyVector3(vector, ToVector3(scalar));
}

function AbsoluteVector3(vector) {
	return {
		x: Math.abs(vector.x),
		y: Math.abs(vector.y),
		z: Math.abs(vector.z),
	};
}

function ClampVector3(valV, minV, maxV) {
	return {
		x: Clamp(valV.x, minV.x, maxV.x),
		y: Clamp(valV.y, minV.y, maxV.y),
		z: Clamp(valV.z, minV.z, maxV.z),
	};
}

function DotVector3(a, b) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

function CrossVector3(a, b) {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x,
	};
}

function LerpVector3(start, end, t) {
	return AddVector3(start, ScaleVector3(SubtractVector3(end, start), Clamp01(t)));
}

function Vector3Sq(vector) {
	return (vector.x * vector.x) + (vector.y * vector.y) + (vector.z * vector.z);
}

function Vector3Length(vector) {
	return Math.hypot(vector.x, vector.y, vector.z);
}

function Vector3Distance(a, b) {
	return Vector3Length(SubtractVector3(a, b));
}

function ResolveVector3Axis(vector) {
	const length = Vector3Length(vector);
	if (length <= EPSILON) return ToVector3(0);
	return DivideVector3(vector, ToVector3(length));
}

function CloneVector3(vector) {
	return { x: vector.x, y: vector.y, z: vector.z };
}

/**
 * Rotate a point by Euler angles in Y → X → Z order (matches CreateModelMatrix).
 * All rotation values must be in radians.
 */
function RotateByEuler(point, rotation) {
	// Y rotation
	const cy = Math.cos(rotation.y);
	const sy = Math.sin(rotation.y);
	const p1 = { x: point.x * cy + point.z * sy, y: point.y, z: -point.x * sy + point.z * cy };

	// X rotation
	const cx = Math.cos(rotation.x);
	const sx = Math.sin(rotation.x);
	const p2 = { x: p1.x, y: p1.y * cx - p1.z * sx, z: p1.y * sx + p1.z * cx };

	// Z rotation
	const cz = Math.cos(rotation.z);
	const sz = Math.sin(rotation.z);
	return { x: p2.x * cz - p2.y * sz, y: p2.x * sz + p2.y * cz, z: p2.z };
}

/* === ENGINE VARIABLES === */

const WORLD_NORMALS = Object.freeze({
	Up      : Object.freeze({ x:  0, y:  1, z:  0 }),
	Down    : Object.freeze({ x:  0, y: -1, z:  0 }),
	Left    : Object.freeze({ x: -1, y:  0, z:  0 }),
	Right   : Object.freeze({ x:  1, y:  0, z:  0 }),
	Forward : Object.freeze({ x:  0, y:  0, z:  1 }),
	Backward: Object.freeze({ x:  0, y:  0, z: -1 }),
});

/* === EXPORTS === */

export {
	AddVector3,
	SubtractVector3,
	DivideVector3,
	ScaleVector3,
	MultiplyVector3,
	AbsoluteVector3,
	ClampVector3,
	DotVector3,
	CrossVector3,
	CloneVector3,
	Vector3Sq,
	Vector3Length,
	Vector3Distance,
	ResolveVector3Axis,
	LerpVector3,
	RotateByEuler,
	ToVector3,
	Vector3ChainMath,
	WORLD_NORMALS,
};