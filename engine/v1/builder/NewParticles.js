// Builds randomized particle groups from a particle template plus per-call overrides.
// Each group is a normal multi-part entity that shares the entity build, geometry cache and ("full" mode) physics.

// Used by NewLevel.js for level-authored generators and by handlers/game/Level.js for reseeding.
// Owns the group lifetime classes. Level.js runs the frame loop that drives them.
// Uses NewEntity.js to build groups and NewTemplate.js to clone parts.

import particleTemplates from "./templates/particles.json" with { type: "json" };
import { BuildEntity, UpdateEntityModelFromTransform } from "./NewEntity.js";
import { CloneTemplatePart } from "./NewTemplate.js";
import { AddVector3, CrossVector3, MultiplyVector3, RotateByEuler, ScaleVector3, ToVector3, Vector3Length, WORLD_NORMALS } from "../math/Vector3.js";
import { Clamp01, Lerp, Unit, UnitVector3 } from "../math/Utilities.js";
import { CONFIG, PERFORMANCE_SCALING } from "../core/config.js";
import { Log } from "../core/meta.js";

/* === SPAWN SURFACE === */

// Spawn surface at the world origin to keep particle positions absolute.

const particleSurfaceId = "particle-origin";

const particleSurfaceMap = {
	[particleSurfaceId]: {
		position: new UnitVector3(0, 0, 0, "cnu"),
		topY    : 0,
	},
};

/* === LAYOUT & SPREAD === */

const maxGroupSize = 10;

// Hand-tuned particle offsets for small groups, in multiples of the part's size.
const tunedLayouts = {
	1: [{ x:  0,   y:  0,   z:  0   }],
	2: [{ x: -0.8, y:  0.3, z:  0.2 }, { x:  0.8, y: -0.3, z: -0.2 }],
	3: [{ x:  0,   y:  0.9, z:  0   }, { x: -0.9, y: -0.5, z:  0.5 }, { x:  0.9, y: -0.5, z: -0.5 }],
	4: [{ x: -0.8, y:  0.7, z:  0.4 }, { x:  0.9, y:  0.5, z: -0.5 }, { x: -0.6, y: -0.7, z: -0.8 }, { x:  0.7, y: -0.6, z:  0.7 }],
	5: [{ x:  0,   y:  1.1, z:  0   }, { x: -1,   y:  0.2, z:  0.9 }, { x:  1,   y:  0.3, z: -0.8 }, { x: -0.9, y: -0.8, z: -0.7 }, { x:  0.8, y: -0.9, z:  0.6 }],
};

// Offsets spread evenly over a sphere for larger groups, the same every run.
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const sphereLayout = (size) => Array.from({ length: size }, (_, index) => {
	const y      = 1 - ((index + 0.5) / size) * 2;
	const radius = Math.sqrt(1 - y ** 2);
	const angle  = index * goldenAngle;
	return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
});

// Layout per group size, built once at import. Sizes past the tuned set use the sphere.
const groupLayouts = {};
for (let size = 1; size <= maxGroupSize; size++) {
	groupLayouts[size] = size <= Object.keys(tunedLayouts).length ? tunedLayouts[size] : sphereLayout(size);
}

const spreadHalfAngles = {
	narrow: new Unit( 10, "degrees").toRadians(true),
	medium: new Unit( 30, "degrees").toRadians(true),
	wide  : new Unit( 60, "degrees").toRadians(true),
	max   : new Unit(180, "degrees").toRadians(true),
};

/* === RANDOMIZATION === */

const randomRange = (min, max) => min + Math.random() * (max - min);
const randomInt =(min, max) => min + Math.floor(Math.random() * (max - min + 1));

// One offset shared by r/g/b to keep the hue (grey stays grey).
const randomVariance = (variance) => randomRange(-variance, variance);

// Write RGB in place to avoid allocating every frame. The caller sets alpha.
function writeParticleRgb(target, start, end, factor, offset) {
	target.r = Clamp01(Lerp(start.r, end.r, factor) + offset);
	target.g = Clamp01(Lerp(start.g, end.g, factor) + offset);
	target.b = Clamp01(Lerp(start.b, end.b, factor) + offset);
	return target;
}

// Random velocity within halfAngle of axis, at 0.8–1.2× its length. A zero axis gives zero.
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

// Template keys a request may override.
const overrideKeys = ["count", "spread", "physics", "color", "velocity", "duration"];

// Merge overrides onto the template.
function resolveRequest(template, overrides) {
	const resolved = { amount: template.amount, part: template.part };
	overrideKeys.forEach((key) => resolved[key] = overrides === null || overrides[key] === null ? template[key] : overrides[key]);
	return resolved;
}

// Copy overrides with one key replaced, keeping the rest without the caller listing them.
function WithParticleOverride(overrides, key, value) {
	const merged = {};
	overrideKeys.forEach((name) => { merged[name] = overrides === null ? null : overrides[name]; });
	merged[key] = value;
	return merged;
}

// Split total into near-equal group sizes, largest first.
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

// Move single particles between groups to break up the even split, within size limits.
function jitterGroupSizes(sizes, minSize) {
	for (let i = 0; i < sizes.length; i++) {
		const from = randomInt(0, sizes.length - 1);
		const to   = randomInt(0, sizes.length - 1);
		if (from === to || sizes[from] - 1 < minSize || sizes[to] + 1 > maxGroupSize) continue;
		sizes[from] -= 1;
		sizes[to]   += 1;
	}
	return sizes;
}

// Under 3 particles stay single, up to 7 form three groups, and more form a random number of groups.
function resolveGroupSizes(count) {
	if (count < 3)  return new Array(count).fill(1);
	if (count <= 7) return balancedSplit(count, 3);

	const minSize = count > 20 ? 5 : count > 10 ? 3 : 2;
	const groups = randomInt(Math.max(3, Math.ceil(count / maxGroupSize)), Math.floor(count / minSize));
	return jitterGroupSizes(balancedSplit(count, groups), minSize);
}

/* === DEFINITION SYNTHESIS === */

// Make one root part per particle, centered on its layout offset.
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

// Build the entity definition for a particle group.
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
			physics     : {
				gravity   : resolved.physics === "full",
				buoyancy  : false,
				resistance: resolved.physics === "full",
				correction: false,
				collision : resolved.physics !== "none",
			},
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

// Hold the runtime state for one particle group. `total` counts its age in ms.
class particleGroup {
	constructor(entity, request, resolved, halfAngle) {
		this.entity      = entity;
		this.request     = { ...request, position: request.position.clone(), mode: "sibling" };
		this.duration    = resolved.duration;
		this.physicsMode = resolved.physics;
		this.startColor  = resolved.color.start;
		this.endColor    = resolved.color.end === null ? resolved.color.start : resolved.color.end;
		this.variance    = resolved.color.variance;
		this.offsets     = entity.model.parts.map(() => randomVariance(this.variance));
		this.halfAngle   = halfAngle;
		this.target      = request.target;
		this.targetKey   = request.target === null ? null : `${request.target.type}::${request.target.id}::${request.target.partId}`;
		this.offset      = request.offset === null ? null : request.offset.clone();
		this.orphaned    = false;
		this.spawnOrigin = entity.transform.position.clone();
		this.originCorrection = this.spawnOrigin.clone().subtract(request.position);
		this.spawnAxis   = resolved.velocity.clone();
		this.lifespan    = resolved.duration.intervalMs;
		this.total       = 0;
		this.decayStart  = null;
		this.finished    = false;

		// Tint through displayColor to avoid baking a texture per particle.
		entity.model.parts.forEach((part, index) => {
			part.mesh.displayColor = writeParticleRgb({ a: this.startColor.a }, this.startColor, this.endColor, 0, this.offsets[index]);
		});
	}

	// Move the spawn origin to the target's current transform.
	follow(targets) {
		const transform = targets[this.targetKey];

		// Orphan the group if the target died or got removed.
		if (transform === undefined) { 
			this.orphan(); 
			return; 
		}

		// Move the request position and spawn origin with the target. New siblings spawn there too.
		this.request.position.set(transform.position).add(RotateByEuler(this.offset, transform.rotation));
		this.spawnOrigin.set(this.request.position).add(this.originCorrection);
	}

	// Stop recycling and end the group when its decay finishes.
	orphan() {
		this.orphaned = true;
		this.lifespan = this.duration.endTimeMs;
	}

	// Age, move and fade the group by one frame.
	advance(deltaMs, deltaSeconds) {
		this.total += deltaMs;

		// "none" moves itself by velocity. "simple" only adds a light gravity arc.
		if (this.physicsMode === "none")   this.entity.transform.position.add(ScaleVector3(this.entity.velocity, deltaSeconds));
		if (this.physicsMode === "simple") this.entity.velocity.y -= CONFIG.Physics.Gravity.Strength * deltaSeconds;

		// Expire at end of life, and hold full color until the decay begins.
		if (this.total >= this.lifespan)           return this.expire();
		if (this.total < this.duration.holdTimeMs) return;

		if (this.decayStart === null) this.decayStart = this.total;
		const decay = 1 - Clamp01((this.total - this.decayStart) / (this.duration.endTimeMs - this.decayStart));

		// Blend toward the end color and fade from the start alpha.
		const fadeAlpha = this.duration.mode === "fade" ? this.startColor.a * decay : this.startColor.a;
		this.entity.model.parts.forEach((part, index) => {
			writeParticleRgb(part.mesh.displayColor, this.startColor, this.endColor, 1 - decay, this.offsets[index]).a = fadeAlpha;
		});

		// Shrink each particle in place. The spread between them stays the same.
		if (this.duration.mode === "shrink") this.entity.transform.scale = ToVector3(Math.max(0.05, decay));
	}

	// Restart the group at its spawn origin with a fresh direction.
	recycle() {
		this.total      = 0;
		this.decayStart = null;

		this.entity.transform.position.set(this.spawnOrigin);
		this.entity.transform.scale = ToVector3(1);
		this.entity.velocity.set(randomInCone(this.spawnAxis, this.halfAngle));

		// Clear the last collision key to let the new life fire its own collision event.
		this.entity.physicsRuntime.lastPhysicsCollisionKey = "";

		// Re-roll each particle's color offset and restore the start color and alpha.
		this.entity.model.parts.forEach((part, index) => {
			this.offsets[index] = randomVariance(this.variance);
			writeParticleRgb(part.mesh.displayColor, this.startColor, this.endColor, 0, this.offsets[index]).a = this.startColor.a;
		});
	}

	// Recycle at end of life, or finish once orphaned. Bursts override this to always finish.
	expire() {
		if (this.orphaned) return this.finished = true;
		this.recycle();
	}

	// Never seed by default. Only the seeding subclass emits siblings.
	seedDue() { 
		return false; 
	}
}

// Run a generator's first group, seeding staggered siblings on its own clock. Recycling doesn't reset that clock.
class seedingParticleGroup extends particleGroup {
	constructor(entity, request, resolved, halfAngle) {
		super(entity, request, resolved, halfAngle);
		this.amount    = resolved.amount;
		this.seedClock = 0;
		this.seeded    = 0;
	}

	// Seed siblings spaced over the interval. One more would line up with this group.
	seedDue(deltaMs) {
		if (this.orphaned) return false;

		this.seedClock += deltaMs;
		if (this.seeded >= this.amount - 1) return false;
		if (this.seedClock < (this.seeded + 1) * (this.duration.intervalMs / this.amount)) return false;

		this.seeded += 1;
		return true;
	}
}

// Run a one-shot group that finishes after its decay and never seeds.
class burstParticleGroup extends particleGroup {
	constructor(entity, request, resolved, halfAngle) {
		super(entity, request, resolved, halfAngle);
		this.lifespan = resolved.duration.endTimeMs;
	}

	expire() { 
		this.finished = true; 
	}
}

/* === PUBLIC API === */

/**
 * Generate the particle groups for one request.
 * @param {object} request — { templateId, position (absolute UnitVector3 cnu), offset (target-local, un-rotated), overrides, mode, target }.
 * @param {number} textureScale — world texture scale (px per CNU).
 * @param {object} faceTextureStore — content-signature-keyed store the per-face bake dedups against.
 * @param {Map} geometryCache — (blueprintId::partId)-keyed frozen part geometry templates.
 * @returns {object} — { groups } — built entities, one per group.
 */
function GenerateParticles(request, textureScale, faceTextureStore, geometryCache) {
	const multiplier = PERFORMANCE_SCALING.Density.Particles[CONFIG.Performance.Particles];
	if (multiplier === 0) {
		Log("ENGINE", "Particles disabled: PERFORMANCE.Particles is Disabled.", "warn", "Level");
		return { groups: [] };
	}

	const resolved  = resolveRequest(particleTemplates[request.templateId], request.overrides);
	const halfAngle = spreadHalfAngles[resolved.spread].value;

	const groups = resolveGroupSizes(Math.max(1, Math.round(resolved.count * multiplier))).map((size, index) => {
		const cone     = randomInCone(resolved.velocity, halfAngle);
		const velocity = new UnitVector3(cone.x, cone.y, cone.z, "cnu"); // Per second

		const { entity } = BuildEntity(
			synthesizeGroupDefinition(request.templateId, resolved, request.position, size, index, velocity),
			particleSurfaceMap,
			textureScale, faceTextureStore, geometryCache
		);

		// Center the group vertically on the request position instead of standing on it.
		entity.transform.position.y += request.position.y - (entity.fullAabb.min.y + entity.fullAabb.max.y) * 0.5;
		UpdateEntityModelFromTransform(entity);

		// Bursts expire. Generators recycle.
		entity.particle = request.mode === "burst"
			? new burstParticleGroup(entity, request, resolved, halfAngle)
			: request.mode === "generator" && index === 0
				? new seedingParticleGroup(entity, request, resolved, halfAngle)
				: new particleGroup(entity, request, resolved, halfAngle);

		return entity;
	});

	return { groups };
}

// Collect generator requests for every particle a built terrain, obstacle or entity carries.
// Note: target type and partId must match what Level.js resolves for following.
function ParticleGeneratorRequests(carrier, kind) {
	const sources = kind === "terrain"
		? [{ particle: carrier.meta.particle, transform: carrier.transform, target: { type: "terrain", id: carrier.id, partId: null } }] 
		: kind === "obstacle" 
			? carrier.parts.map((mesh) => (
				{ particle: mesh.meta.particle, transform: mesh.transform, target: { type: "obstacle", id: carrier.id, partId: mesh.id } }
			)) 
			: carrier.model.parts.map((part) => (
				{ particle: part.mesh.meta.particle, transform: part.mesh.transform, target: { type: carrier.type, id: carrier.id, partId: part.id } }
			));

	return sources.filter((source) => source.particle !== null).map((source) => ({
		templateId: source.particle.id,
		position  : source.transform.position.clone().add(RotateByEuler(source.particle.position, source.transform.rotation)),
		offset    : source.particle.position,
		overrides : source.particle.overrides,
		mode      : "generator",
		target    : source.target,
	}));
}

export { GenerateParticles, ParticleGeneratorRequests, WithParticleOverride };
