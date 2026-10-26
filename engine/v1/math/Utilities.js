import { AddVector3, CloneVector3, DivideVector3, MaxVector3, MinVector3, MultiplyVector3, ScaleVector3, SubtractVector3 } from "./Vector3.js";

// 1 CNU = CNU_SCALE World Units (WebGL coordinate space). Set once during development.
export const CNU_SCALE = 1;

class Unit {
	constructor(value, type) {
		this.value = value;
		this.type = ["radians", "degrees", "cnu", "worldunit"].includes(type.toLowerCase())
			? type.toLowerCase()
			: null;
	}

	clone() {
		return new Unit(this.value, this.type);
	}

	math(f, ...args) {
		this.value = f(this.value, ...args);
		return this;
	}

	toRadians(replace = false) {
		if (this.type === "degrees") {
			const converted = DegreesToRadians(this.value);
			if (replace === true) {
				this.value = converted;
				this.type = "radians";
				return this;
			}
			return converted;
		}
		return this.value;
	}

	toDegrees(replace = false) {
		if (this.type === "radians") {
			const converted = RadiansToDegrees(this.value);
			if (replace === true) {
				this.value = converted;
				this.type = "degrees";
				return this;
			}
			return converted;
		}
		return this.value;
	}

	toCNU(replace = false) {
		if (this.type === "worldunit") {
			const converted = WorldUnitToCNU(this.value);
			if (replace === true) {
				this.value = converted;
				this.type = "cnu";
				return this;
			}
			return converted;
		}
		return this.value;
	}

	toWorldUnit(replace = false) {
		if (this.type === "cnu") {
			const converted = CNUtoWorldUnit(this.value);
			if (replace === true) {
				this.value = converted;
				this.type = "worldunit";
				return this;
			}
			return converted;
		}
		return this.value;
	}
}

class UnitVector3 {
	constructor(x, y, z, type) {
		this.x = x;
		this.y = y;
		this.z = z;
		this.type = type.toLowerCase();
	}

	set(vector) {
		this.x = vector.x;
		this.y = vector.y;
		this.z = vector.z;
		return this;
	}

	add(vector) {      return this.set(AddVector3(this, vector)) }
	subtract(vector) { return this.set(SubtractVector3(this, vector)) }
	multiply(vector) { return this.set(MultiplyVector3(this, vector)) }
	divide(vector) {   return this.set(DivideVector3(this, vector)) }
	scale(scalar) {    return this.set(ScaleVector3(this, scalar)) }

	min(vector) { return this.set(MinVector3(this, vector)) }
	max(vector) { return this.set(MaxVector3(this, vector)) }

 	toWorldUnit(replace = false) {
		if (this.type === "cnu") {
			const converted = { x: CNUtoWorldUnit(this.x), y: CNUtoWorldUnit(this.y), z: CNUtoWorldUnit(this.z) };
			if (replace === true) {
				this.type = "worldunit";
				return this.set(converted);
			}
			return converted;
		}
		return replace === true ? this : CloneVector3(this);
	}

	toCNU(replace = false) {
		if (this.type === "worldunit") {
			const converted = { x: WorldUnitToCNU(this.x), y: WorldUnitToCNU(this.y), z: WorldUnitToCNU(this.z) };
			if (replace === true) {
				this.type = "cnu";
				return this.set(converted);
			}
			return converted;
		}
		return replace === true ? this : CloneVector3(this);
	}

	toRadians(replace = false) {
		if (this.type === "degrees") {
			const converted = { x: DegreesToRadians(this.x), y: DegreesToRadians(this.y), z: DegreesToRadians(this.z) };
			if (replace === true) {
				this.type = "radians";
				return this.set(converted);
			}
			return converted;
		}
		return replace === true ? this : CloneVector3(this);
	}

	toDegrees(replace = false) {
		if (this.type === "radians") {
			const converted = { x: RadiansToDegrees(this.x), y: RadiansToDegrees(this.y), z: RadiansToDegrees(this.z) };
			if (replace === true) {
				this.type = "degrees";
				return this.set(converted);
			}
			return converted;
		}
		return replace === true ? this : CloneVector3(this);
	}

	clone() {
		return new UnitVector3(this.x, this.y, this.z, this.type);
	}
}

const RadiansToDegrees = (radians) => radians * (180 / Math.PI);
const DegreesToRadians = (degrees) => degrees * (Math.PI / 180);

const CNUtoWorldUnit = (cnu) => cnu * CNU_SCALE;
const WorldUnitToCNU = (worldUnit) => worldUnit / CNU_SCALE;

const ToNumber = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const Clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const Clamp01 = (value) => Clamp(value, 0, 1);

const Lerp = (a, b, t) => a + (b - a) * Clamp01(t);

// Hermite smoothstep interpolation between two scalar values
function SmoothStep(a, b, t) {
	const clamped = Clamp01((t - a) / (b - a));
	return (clamped ** 2) * (3 - 2 * clamped);
}

function BestMatchOf(
	array       = [],                                         // Array of items to find the "best" entry of.
	condition   = (entry, best, storage) => entry === best,   // The exact check made to determine what counts as "best".
	currentBest = null,                                       // The optional first "best" to check against.
	storage     = {}                                          // An optional object to mutate in the handler for storage.
) {
	// Store the first/fallback "best".
	let bestMatch = currentBest;

	// Go through each entry. Overwrite bestMatch on a better match against the condition.
	for (const item of array) {
		const result = condition(item, bestMatch, storage);
		if (result === null) return null;
		if (result === true) bestMatch = item;
	}

	return bestMatch;
}

// BestMatchOf([2, 3, 4], ((v, b) => Math.max(v, b) === v), 0); Returns 4.

// Copy a transform. Engine vectors stay instanced and game vectors stay plain.
function CloneTransform(transform) {
	const copy = (vector) => vector instanceof UnitVector3 ? vector.clone() : CloneVector3(vector);
	const clone = { position: copy(transform.position), rotation: copy(transform.rotation), scale: CloneVector3(transform.scale) };
	if ("pivot" in transform) clone.pivot = copy(transform.pivot);
	return clone;
}

export {
	RadiansToDegrees, 
	DegreesToRadians, 
	WorldUnitToCNU, 
	CNUtoWorldUnit, 
	ToNumber, 
	Clamp, 
	Clamp01,
	Lerp,
	SmoothStep,
	BestMatchOf,
	CloneTransform,
	Unit,
	UnitVector3 
};
