import { AddVector3, MultiplyVector3, ScaleVector3, SubtractVector3 } from "./Vector3.js";

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

	add(vector) {
		return this.set(AddVector3(this, vector));
	}
	subtract(vector) {
		return this.set(SubtractVector3(this, vector));
	}
	multiply(vector) {
		return this.set(MultiplyVector3(this, vector));
	}
	scale(scalar) {
		return this.set(ScaleVector3(this, scalar));
	}

	min(vector) {
		return this.set({
			x: Math.min(this.x, vector.x),
			y: Math.min(this.y, vector.y),
			z: Math.min(this.z, vector.z)
		});
	}
	max(vector) {
		return this.set({
			x: Math.max(this.x, vector.x),
			y: Math.max(this.y, vector.y),
			z: Math.max(this.z, vector.z)
		});
	}

 	toWorldUnit(replace = false) {
		if (this.type === "cnu") {
			const converted = { x: CNUtoWorldUnit(this.x), y: CNUtoWorldUnit(this.y), z: CNUtoWorldUnit(this.z) };
			if (replace === true) {
				this.type = "worldunit";
				return this.set(converted);
			}
			return converted;
		}
		if (replace === true) return this;
		return { x: this.x, y: this.y, z: this.z };
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
		if (replace === true) return this;
		return { x: this.x, y: this.y, z: this.z };
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
		if (replace === true) return this;
		return { x: this.x, y: this.y, z: this.z };
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
		if (replace === true) return this;
		return { x: this.x, y: this.y, z: this.z };
	}

	clone() {
		return new UnitVector3(this.x, this.y, this.z, this.type);
	}
}

// Converts radians to degrees
function RadiansToDegrees(radians) {
	return radians * (180 / Math.PI);
}

// Converts degrees to radians
function DegreesToRadians(degrees) {
	return degrees * (Math.PI / 180);
}

// Converts CNU to WebGL Unit (World Units)
function CNUtoWorldUnit(CNU) {
	return CNU * CNU_SCALE;
}

// Converts WebGL Unit to CNU
function WorldUnitToCNU(worldUnit) {
	return worldUnit / CNU_SCALE;
}

function ToNumber(value, fallback) {
	const resolved = Number(value);
	return Number.isFinite(resolved) ? resolved : fallback;
}

// Clamp a number between min and max (inclusive)
function Clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function Clamp01(value) {
	return Clamp(value, 0, 1);
}

// Linear interpolation between two scalar values
function Lerp(a, b, t) {
	return a + (b - a) * Clamp(t, 0, 1);
}

// Hermite smoothstep interpolation between two scalar values
function SmoothStep(a, b, t) {
	const clamped = Clamp((t - a) / (b - a), 0, 1);
	return clamped * clamped * (3 - 2 * clamped);
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
	Unit, 
	UnitVector3 
};
