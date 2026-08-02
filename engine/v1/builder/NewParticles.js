// Resolves a particle template plus per-call overrides into randomized particle groups.
// Each group is an ordinary multi-part entity, so it reuses BuildEntity, the geometry cache
// and — for physics mode "full" — the real physics pipeline.

// Called by NewLevel.js for level-authored generators and by handlers/game/Level.js for reseeding.
// Owns the group lifetime classes; Level.js owns the frame loop that drives them.
// Uses NewEntity.js for the groups and NewTemplate.js for part cloning.

import particleTemplates from "./templates/particles.json" with { type: "json" };
import { BuildEntity, UpdateEntityModelFromTransform } from "./NewEntity.js";
import { CloneTemplatePart } from "./NewTemplate.js";
import { AddVector3, CrossVector3, MultiplyVector3, ScaleVector3, ToVector3, Vector3Length, WORLD_NORMALS } from "../math/Vector3.js";
import { Clamp01, Unit, UnitVector3 } from "../math/Utilities.js";
import { IsBeyondSimDistance } from "../physics/Collision.js";
import { CONFIG } from "../core/config.js";
import { Log } from "../core/meta.js";

/* === SPAWN SURFACE === */

// Particle spawn is absolute, so hand the builder a zero-origin surface (world pos = rootTransform pos).

const particleSurfaceId = "particle-origin";

const particleSurfaceMap = {
	[particleSurfaceId]: {
		position: new UnitVector3(0, 0, 0, "cnu"),
		topY    : 0,
	},
};

/* === LAYOUT & SPREAD === */

// Dimensionless multipliers of the part's own dimensions — proportional at any size, never unit space.
const groupLayouts = {
	1: [{ x:  0,   y:  0,   z:  0   }],
	2: [{ x: -0.8, y:  0.3, z:  0.2 }, { x:  0.8, y: -0.3, z: -0.2 }],
	3: [{ x:  0,   y:  0.9, z:  0   }, { x: -0.9, y: -0.5, z:  0.5 }, { x:  0.9, y: -0.5, z: -0.5 }],
	4: [{ x: -0.8, y:  0.7, z:  0.4 }, { x:  0.9, y:  0.5, z: -0.5 }, { x: -0.6, y: -0.7, z: -0.8 }, { x:  0.7, y: -0.6, z:  0.7 }],
	5: [{ x:  0,   y:  1.1, z:  0   }, { x: -1,   y:  0.2, z:  0.9 }, { x:  1,   y:  0.3, z: -0.8 }, { x: -0.9, y: -0.8, z: -0.7 }, { x:  0.8, y: -0.9, z:  0.6 }],
};

// Burst cone half-angles. Feel values; "max" is a full sphere, not a cone.
const spreadHalfAngles = {
	narrow: new Unit(10, "degrees").toRadians(true),
	medium: new Unit(30, "degrees").toRadians(true),
	wide  : new Unit(60, "degrees").toRadians(true),
	max   : new Unit(180, "degrees").toRadians(true),
};

// Downward acceleration the tick applies in "simple" mode. Feel value.
const arcRate = new Unit(9, "cnu");

// Shrink stops short of zero: a degenerate collider radius breaks the swept test.
const shrinkFloor = 0.05;

const minGroupSize = 2;
const maxGroupSize = 5;

/* === PERFORMANCE === */

// Same shape as GetPerformanceScatterMultiplier; Low blocks generation outright.
function performanceParticleMultiplier() {
	if (CONFIG.PERFORMANCE.Particles === "High") return 1;
	if (CONFIG.PERFORMANCE.Particles === "Low") return 0;
	return 0.5;
}

/* === RANDOMIZATION === */

const randomRange = (min, max) => min + Math.random() * (max - min);
const randomInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

// Writes in place — recycle runs every interval and must not allocate.
function randomizeColor(target, color) {
	target.r = randomRange(color.min.r, color.max.r);
	target.g = randomRange(color.min.g, color.max.g);
	target.b = randomRange(color.min.b, color.max.b);
	target.a = randomRange(color.min.a, color.max.a);
	return target;
}

// Random direction inside a cone about `axis`, magnitude 0.8–1.2x its length. A zero axis has no cone.
function randomInCone(axis, halfAngle) {
	const length = Vector3Length(axis);
	if (length === 0) return ToVector3(0);

	const magnitude = length * randomRange(0.8, 1.2);
	const direction = ScaleVector3(axis, 1 / length);
	const tangent   = CrossVector3(direction, Math.abs(direction.y) > 0.99 ? WORLD_NORMALS.Right : WORLD_NORMALS.Up);
	const right     = ScaleVector3(tangent, 1 / Vector3Length(tangent));
	const up        = CrossVector3(right, direction);

	const theta  = Math.acos(randomRange(Math.cos(halfAngle), 1));
	const phi    = randomRange(0, Math.PI * 2);
	const radial = AddVector3(ScaleVector3(right, Math.cos(phi)), ScaleVector3(up, Math.sin(phi)));

	return AddVector3(ScaleVector3(direction, Math.cos(theta) * magnitude), ScaleVector3(radial, Math.sin(theta) * magnitude));
}

/* === REQUEST RESOLUTION === */

// null (whole object or per key) = use the template. Only these six keys are overridable.
function resolveRequest(template, overrides) {
	const pick = overrides === null ? (key) => template[key] : (key) => (overrides[key] !== null ? overrides[key] : template[key]);
	return {
		count   : pick("count"),
		spread  : pick("spread"),
		physics : pick("physics"),
		color   : pick("color"),
		velocity: pick("velocity"),
		duration: pick("duration"),
		amount  : template.amount,
		part    : template.part,
	};
}

// physicsMode is the sole authority for the flag bag.
function physicsFlagsFor(mode) {
	return {
		gravity   : mode === "full",
		buoyancy  : false,
		resistance: mode === "full",
		correction: false,
		collision : mode !== "none",
	};
}

// Sizes as equal as possible, largest first.
function balancedSplit(total, groups) {
	const sizes = [];
	let remaining = total;
	for (let slots = groups; slots > 0; slots--) {
		const size = Math.ceil(remaining / slots);
		sizes.push(size);
		remaining -= size;
	}
	return sizes;
}

// Break up the even split with ±1 transfers that keep both ends in range.
function jitterGroupSizes(sizes) {
	for (let i = 0; i < sizes.length; i++) {
		const from = randomInt(0, sizes.length - 1);
		const to   = randomInt(0, sizes.length - 1);
		if (from === to || sizes[from] - 1 < minGroupSize || sizes[to] + 1 > maxGroupSize) continue;
		sizes[from] -= 1;
		sizes[to]   += 1;
	}
	return sizes;
}

// <3 → singles. 3–7 → three near-equal groups. ≥8 → a random group count, each group 2–5 parts.
function resolveGroupSizes(count) {
	if (count < 3) return new Array(count).fill(1);
	if (count <= 7) return balancedSplit(count, 3);

	const groups = randomInt(Math.max(3, Math.ceil(count / maxGroupSize)), Math.floor(count / minGroupSize));
	return jitterGroupSizes(balancedSplit(count, groups));
}

/* === DEFINITION SYNTHESIS === */

// All parts are roots; center anchor + center attachment makes localPosition verbatim.
function synthesizeParts(templatePart, size) {
	return groupLayouts[size].map((offset, index) => {
		const part = CloneTemplatePart(templatePart);
		part.id              = `p${index}`;
		part.parentId        = "root";
		part.anchorPoint     = "center";
		part.attachmentPoint = "center";
		part.localPosition.set(MultiplyVector3(part.dimensions, MultiplyVector3(offset, part.localScale)));
		return part;
	});
}

function synthesizeGroupDefinition(templateId, resolved, position, size, index, velocity) {
	return {
		id               : `${templateId}@${position.x.toFixed(2)},${position.y.toFixed(2)},${position.z.toFixed(2)}#${index}`,
		type             : "particle",
		blueprintId      : templateId,
		hp               : 1,
		attacks          : [],
		hardcoded        : {},
		platform         : null,
		animations       : {},
		customEvents     : {},
		collisionOverride: { physics: "aabb", hurtbox: null, hitbox: null },
		velocity,

		// Zero speed keeps the builder's movement lerp inert, so the spawn position survives.
		movement: {
			start       : position.clone(),
			end         : position.clone(),
			speed       : new Unit(0, "cnu"),
			jump        : new Unit(0, "cnu"),
			repeat      : false,
			backAndForth: false,
			jumpInterval: 0,
			jumpOnSight : false,
			disappear   : false,
			chase       : false,
			physics     : physicsFlagsFor(resolved.physics),
		},

		model: {
			spawnSurfaceId: particleSurfaceId,
			rootTransform : {
				position: position.clone(),
				rotation: new UnitVector3(0, 0, 0, "radians"),
				scale   : ToVector3(1),
				pivot   : new UnitVector3(0, 0, 0, "cnu"),
			},
			parts: synthesizeParts(resolved.part, size),
		},
	};
}

/* === GROUP LIFETIME === */

// One built group's runtime state. Lifetime is frame-tracked: `total` accumulates deltaMs.
class particleGroup {
	constructor(entity, request, resolved, halfAngle) {
		this.entity      = entity;
		// Reseeded siblings must never seed in turn, and the stored position outlives the caller's.
		this.request     = { ...request, position: request.position.clone(), mode: "sibling" };
		this.duration    = resolved.duration;
		this.physicsMode = resolved.physics;
		this.colorRange  = resolved.color;
		this.halfAngle   = halfAngle;
		// Id, not a reference — a despawned target must not stay pinned.
		this.targetId    = request.target === null ? null : request.target.id;
		this.spawnOrigin = entity.transform.position.clone();
		this.spawnAxis   = resolved.velocity.clone();
		// intervalMs is a recycle cadence; a one-shot ends when its decay does.
		this.lifespan    = resolved.duration.intervalMs;
		this.total       = 0;
		this.decayStart  = null;
		this.finished    = false;
		this.baseAlpha   = entity.model.parts.map((part) => part.mesh.displayColor.a);
	}

	advance(deltaMs, deltaSeconds) {
		this.total += deltaMs;

		// "none" never enters the pipeline, so the tick integrates it; "simple" only bends the arc.
		if (this.physicsMode === "none")   this.entity.transform.position.add(ScaleVector3(this.entity.velocity, deltaSeconds));
		if (this.physicsMode === "simple") this.entity.velocity.y -= arcRate.value * deltaSeconds;

		if (this.total >= this.lifespan) {
			this.expire();
			return;
		}
		if (this.total < this.duration.holdTimeMs) return;

		if (this.decayStart === null) this.decayStart = this.total;
		const decay = 1 - Clamp01((this.total - this.decayStart) / (this.duration.endTimeMs - this.decayStart));

		// Always resolved from a stored base — multiplying compounds and never recovers on recycle.
		if (this.duration.mode === "fade") {
			this.entity.model.parts.forEach((part, index) => { part.mesh.displayColor.a = this.baseAlpha[index] * decay; });
			return;
		}

		// Group scale shrinks each particle in place; local offsets are unscaled, so spread holds.
		this.entity.transform.scale = ToVector3(Math.max(shrinkFloor, decay));
	}

	recycle() {
		this.total      = 0;
		this.decayStart = null;

		this.entity.transform.position.set(this.spawnOrigin);
		this.entity.transform.scale = ToVector3(1);
		this.entity.velocity.set(randomInCone(this.spawnAxis, this.halfAngle));

		// A fresh life is entitled to its own first collision event.
		this.entity.physicsRuntime.lastPhysicsCollisionKey = "";

		this.entity.model.parts.forEach((part, index) => {
			this.baseAlpha[index] = randomizeColor(part.mesh.displayColor, this.colorRange).a;
		});
	}

	// End of one emission: looping by default, so the burst subclass overrides instead.
	expire() { this.recycle(); }

	// Only the seeding subclass emits siblings; a base method keeps the driver's call guaranteed.
	seedDue() { return false; }
}

// The generator's first group. Seeds phase-offset siblings on a clock recycle does not reset.
class seedingParticleGroup extends particleGroup {
	constructor(entity, request, resolved, halfAngle) {
		super(entity, request, resolved, halfAngle);
		this.amount    = resolved.amount;
		this.seedClock = 0;
		this.seeded    = 0;
	}

	// `amount - 1` siblings: an `amount`th would land in phase with this group's own recycle.
	seedDue(deltaMs) {
		this.seedClock += deltaMs;
		if (this.seeded >= this.amount - 1) return false;
		if (this.seedClock < (this.seeded + 1) * (this.duration.intervalMs / this.amount)) return false;
		this.seeded += 1;
		return true;
	}
}

// A one-shot request. Extends the base, never the seeding class, so base seedDue() keeps it silent.
class burstParticleGroup extends particleGroup {
	constructor(entity, request, resolved, halfAngle) {
		super(entity, request, resolved, halfAngle);
		this.lifespan = resolved.duration.endTimeMs;
	}

	expire() { this.finished = true; }
}

/* === PUBLIC API === */

/**
 * Generate the particle groups for one request.
 * @param {object} request — { templateId, position (UnitVector3 cnu), overrides, mode, target }.
 * @param {object} viewerPosition — camera/spawn reference for the sim-distance gate; null skips it.
 * @param {number} textureScale — world texture scale (px per CNU); opts into the geometry cache.
 * @param {object} faceTextureStore — content-signature-keyed store the per-face bake dedups against.
 * @param {Map} geometryCache — (blueprintId::partId)-keyed frozen part geometry templates.
 * @returns {object} — { groups } — built entities, one per group.
 */
function GenerateParticles(request, viewerPosition, textureScale, faceTextureStore, geometryCache) {
	const multiplier = performanceParticleMultiplier();
	if (multiplier === 0) {
		Log("ENGINE", "Particles disabled: PERFORMANCE.Particles is Low.", "warn", "Level");
		return { groups: [] };
	}
	if (IsBeyondSimDistance(viewerPosition, request.position)) return { groups: [] };

	const resolved  = resolveRequest(particleTemplates[request.templateId], request.overrides);
	const halfAngle = spreadHalfAngles[resolved.spread].value;

	const groups = resolveGroupSizes(Math.max(1, Math.round(resolved.count * multiplier))).map((size, index) => {
		const cone     = randomInCone(resolved.velocity, halfAngle);
		const velocity = new UnitVector3(cone.x, cone.y, cone.z, "cnu");

		const { entity } = BuildEntity(
			synthesizeGroupDefinition(request.templateId, resolved, request.position, size, index, velocity),
			particleSurfaceMap,
			textureScale, faceTextureStore, geometryCache
		);

		// Tint rides on displayColor: baking it into texture.generated would key a canvas per particle.
		entity.model.parts.forEach((part) => { part.mesh.displayColor = randomizeColor({}, resolved.color); });

		// BuildEntity seats the model's AABB floor on the spawn plane; a burst is centered on it.
		entity.transform.position.y += request.position.y - (entity.collision.aabb.min.y + entity.collision.aabb.max.y) * 0.5;
		UpdateEntityModelFromTransform(entity);

		// Every group of a burst expires; only the first group of a generator sustains the effect.
		if (request.mode === "burst") entity.particle = new burstParticleGroup(entity, request, resolved, halfAngle);
		else if (request.mode === "generator" && index === 0) entity.particle = new seedingParticleGroup(entity, request, resolved, halfAngle);
		else entity.particle = new particleGroup(entity, request, resolved, halfAngle);

		return entity;
	});

	return { groups };
}

export { GenerateParticles };
