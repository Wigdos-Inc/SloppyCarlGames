import { CNU_SCALE } from "../core/meta.js";

class Unit {
	constructor(value, type) {
		this.value = ToNumber(value, 1);
		this.type = typeof type === "string"
			&& ["radians", "degrees", "cnu", "worldunit"].includes(type.toLowerCase())
			? type.toLowerCase()
			: null;
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
		this.x = ToNumber(x, 0);
		this.y = ToNumber(y, 0);
		this.z = ToNumber(z, 0);
		this.type = typeof type === "string"
			&& ["radians", "degrees", "cnu", "worldunit"].includes(type.toLowerCase())
			? type.toLowerCase()
			: null;
	}

	set(vector) {
		if (vector && typeof vector === "object") {
			this.x = ToNumber(vector.x, this.x);
			this.y = ToNumber(vector.y, this.y);
			this.z = ToNumber(vector.z, this.z);
		}
		return this;
	}

 	toWorldUnit(replace = false) {
		if (this.type === "cnu") {
			const converted = { x: CNUtoWorldUnit(this.x), y: CNUtoWorldUnit(this.y), z: CNUtoWorldUnit(this.z) };
			if (replace === true) {
				this.x = converted.x;
				this.y = converted.y;
				this.z = converted.z;
				this.type = "worldunit";
				return this;
			}
			return converted;
		}
		return { x: this.x, y: this.y, z: this.z };
	}

	toCNU(replace = false) {
		if (this.type === "worldunit") {
			const converted = { x: WorldUnitToCNU(this.x), y: WorldUnitToCNU(this.y), z: WorldUnitToCNU(this.z) };
			if (replace === true) {
				this.x = converted.x;
				this.y = converted.y;
				this.z = converted.z;
				this.type = "cnu";
				return this;
			}
			return converted;
		}
		return { x: this.x, y: this.y, z: this.z };
	}

	toRadians(replace = false) {
		if (this.type === "degrees") {
			const converted = { x: DegreesToRadians(this.x), y: DegreesToRadians(this.y), z: DegreesToRadians(this.z) };
			if (replace === true) {
				this.x = converted.x;
				this.y = converted.y;
				this.z = converted.z;
				this.type = "radians";
				return this;
			}
			return converted;
		}
		return { x: this.x, y: this.y, z: this.z };
	}

	toDegrees(replace = false) {
		if (this.type === "radians") {
			const converted = { x: RadiansToDegrees(this.x), y: RadiansToDegrees(this.y), z: RadiansToDegrees(this.z) };
			if (replace === true) {
				this.x = converted.x;
				this.y = converted.y;
				this.z = converted.z;
				this.type = "degrees";
				return this;
			}
			return converted;
		}
		return { x: this.x, y: this.y, z: this.z };
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

// Linear interpolation between two scalar values
function Lerp(a, b, t) {
	return a + (b - a) * Clamp(t, 0, 1);
}

// Hermite smoothstep interpolation between two scalar values
function SmoothStep(a, b, t) {
	const clamped = Clamp((t - a) / (b - a), 0, 1);
	return clamped * clamped * (3 - 2 * clamped);
}

export { RadiansToDegrees, DegreesToRadians, WorldUnitToCNU, CNUtoWorldUnit, ToNumber, Clamp, Lerp, SmoothStep, Unit, UnitVector3 };
