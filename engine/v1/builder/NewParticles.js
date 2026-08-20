// Resolves a particle template plus per-call overrides into randomized particle groups.
// Each group is an ordinary multi-part entity, so it reuses BuildEntity, the geometry cache
// and — for physics mode "full" — the real physics pipeline.

// Called by NewLevel.js for level-authored generators and by handlers/game/Level.js for reseeding.
// Owns the group lifetime classes; Level.js owns the frame loop that drives them.
// Uses NewEntity.js for the groups and NewTemplate.js for part cloning.

import particleTemplates from "./templates/particles.json" with { type: "json" };
import { BuildEntity, UpdateEntityModelFromTransform } from "./NewEntity.js";
import { CloneTemplatePart } from "./NewTemplate.js";
import { AddVector3, CrossVector3, MultiplyVector3, RotateByEuler, ScaleVector3, ToVector3, Vector3Length, WORLD_NORMALS } from "../math/Vector3.js";
import { Clamp01, Lerp, Unit, UnitVector3 } from "../math/Utilities.js";
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

const maxGroupSize = 10;

// Dimensionless multipliers of the part's own dimensions — proportional at any size, never unit space.
const tunedLayouts = {
	1: [{ x:  0,   y:  0,   z:  0   }],
	2: [{ x: -0.8, y:  0.3, z:  0.2 }, { x:  0.8, y: -0.3, z: -0.2 }],
	3: [{ x:  0,   y:  0.9, z:  0   }, { x: -0.9, y: -0.5, z:  0.5 }, { x:  0.9, y: -0.5, z: -0.5 }],
	4: [{ x: -0.8, y:  0.7, z:  0.4 }, { x:  0.9, y:  0.5, z: -0.5 }, { x: -0.6, y: -0.7, z: -0.8 }, { x:  0.7, y: -0.6, z:  0.7 }],
	5: [{ x:  0,   y:  1.1, z:  0   }, { x: -1,   y:  0.2, z:  0.9 }, { x:  1,   y:  0.3, z: -0.8 }, { x: -0.9, y: -0.8, z: -0.7 }, { x:  0.8, y: -0.9, z:  0.6 }],
};

// Golden-angle sphere: even coverage at any size, and identical every run.
const goldenAngle = Math.PI * (3 - Math.sqrt(5));
const sphereLayout = (size) => Array.from({ length: size }, (_, index) => {
	const y      = 1 - ((index + 0.5) / size) * 2;
	const radius = Math.sqrt(1 - y * y);
	const angle  = index * goldenAngle;
	return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
});

// Built once at import; sizes past the tuned set are generated, then read by plain index like the rest.
const groupLayouts = {};
for (let size = 1; size <= maxGroupSize; size++) {
	groupLayouts[size] = size <= Object.keys(tunedLayouts).length ? tunedLayouts[size] : sphereLayout(size);
}

// Burst cone half-angles. Feel values; "max" is a full sphere, not a cone.
const spreadHalfAngles = {
	narrow: new Unit(10, "degrees").toRadians(true),
	medium: new Unit(30, "degrees").toRadians(true),
	wide  : new Unit(60, "degrees").toRadians(true),
	max   : new Unit(180, "degrees").toRadians(true),
};

// Downward acceleration the tick applies in "simple" mode. Feel value.
const arcRate = new Unit(9, "cnu");

// Bigger emissions consolidate into chunkier groups; small ones keep their fine-grained spray.
function minGroupSizeFor(count) {
	if (count > 20) return 5;
	if (count > 10) return 3;
	return 2;
}

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

// One offset shared by r/g/b — a per-channel roll would drift the hue, so grey could never stay grey.
const randomVariance = (variance) => randomRange(-variance, variance);

// RGB only; duration.mode owns alpha. Writes in place — recycle runs every interval and must not allocate.
function writeParticleRgb(target, start, end, factor, offset) {
	target.r = Clamp01(Lerp(start.r, end.r, factor) + offset);
	target.g = Clamp01(Lerp(start.g, end.g, factor) + offset);
	target.b = Clamp01(Lerp(start.b, end.b, factor) + offset);
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

// The six overridable keys — the sole authority both resolution and single-key replacement read.
const overrideKeys = ["count", "spread", "physics", "color", "velocity", "duration"];

// null (whole object or per key) = use the template. Only these six keys are overridable.
function resolveRequest(template, overrides) {
	const resolved = { amount: template.amount, part: template.part };
	overrideKeys.forEach((key) => { resolved[key] = overrides === null || overrides[key] === null ? template[key] : overrides[key]; });
	return resolved;
}

// Returns a complete override set with one key replaced, so a caller need not know the other five.
function WithParticleOverride(overrides, key, value) {
	const merged = {};
	overrideKeys.forEach((name) => { merged[name] = overrides === null ? null : overrides[name]; });
	merged[key] = value;
	return merged;
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

// <3 → singles. 3–7 → three near-equal groups. ≥8 → a random group count, sized by minGroupSizeFor.
function resolveGroupSizes(count) {
	if (count < 3) return new Array(count).fill(1);
	if (count <= 7) return balancedSplit(count, 3);

	const minSize = minGroupSizeFor(count);
	const groups = randomInt(Math.max(3, Math.ceil(count / maxGroupSize)), Math.floor(count / minSize));
	return jitterGroupSizes(balancedSplit(count, groups), minSize);
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

// Sole authority on the key format every producer and consumer of a target resolves through.
const particleTargetKey = (target) => `${target.type}::${target.id}::${target.partId}`;

// One built group's runtime state. Lifetime is frame-tracked: `total` accumulates deltaMs.
class particleGroup {
	constructor(entity, request, resolved, halfAngle) {
		this.entity      = entity;
		// Reseeded siblings must never seed in turn, and the stored position outlives the caller's.
		this.request     = { ...request, position: request.position.clone(), mode: "sibling" };
		this.duration    = resolved.duration;
		this.physicsMode = resolved.physics;
		this.startColor  = resolved.color.start;
		// null end = constant colour, resolved here so the per-frame write never branches.
		this.endColor    = resolved.color.end === null ? resolved.color.start : resolved.color.end;
		this.variance    = resolved.color.variance;
		this.offsets     = entity.model.parts.map(() => randomVariance(this.variance));
		this.halfAngle   = halfAngle;
		// A key, not a scene reference — a despawned target must not stay pinned.
		this.target      = request.target;
		this.targetKey   = request.target === null ? null : particleTargetKey(request.target);
		this.offset      = request.offset === null ? null : request.offset.clone();
		this.orphaned    = false;
		this.spawnOrigin = entity.transform.position.clone();
		// BuildEntity re-seats the group on the spawn plane, so the origin is not the request position.
		this.originCorrection = this.spawnOrigin.clone().subtract(request.position);
		this.spawnAxis   = resolved.velocity.clone();
		// intervalMs is a recycle cadence; a one-shot ends when its decay does.
		this.lifespan    = resolved.duration.intervalMs;
		this.total       = 0;
		this.decayStart  = null;
		this.finished    = false;

		// Tint rides on displayColor: baking it into texture.generated would key a canvas per particle.
		entity.model.parts.forEach((part, index) => {
			part.mesh.displayColor = writeParticleRgb({ a: this.startColor.a }, this.startColor, this.endColor, 0, this.offsets[index]);
		});
	}

	// Re-seats the origin on the live target each frame; `targets` is rebuilt by the driver.
	follow(targets) {
		const transform = targets[this.targetKey];
		// Existence check in case of target death/deletion.
		if (transform === undefined) { this.orphan(); return; }

		// The stored request seeds siblings, so it tracks too — they spawn where the target is now.
		this.request.position.set(transform.position).add(RotateByEuler(this.offset, transform.rotation));
		this.spawnOrigin.set(this.request.position).add(this.originCorrection);
	}

	// Ends the loop on the authored decay instead of the recycle cadence.
	orphan() {
		this.orphaned = true;
		this.lifespan = this.duration.endTimeMs;
	}

	advance(deltaMs, deltaSeconds) {
		this.total += deltaMs;

		// "none" never enters the pipeline, so the tick integrates it; "simple" only bends the arc.
		if (this.physicsMode === "none")   this.entity.transform.position.add(ScaleVector3(this.entity.velocity, deltaSeconds));
		if (this.physicsMode === "simple") this.entity.velocity.y -= arcRate.value * deltaSeconds;

		if (this.total >= this.lifespan) { this.expire(); return; }
		if (this.total < this.duration.holdTimeMs) return;

		if (this.decayStart === null) this.decayStart = this.total;
		const decay = 1 - Clamp01((this.total - this.decayStart) / (this.duration.endTimeMs - this.decayStart));

		// Always resolved from the stored start — multiplying compounds and never recovers on recycle.
		const fadeAlpha = this.duration.mode === "fade" ? this.startColor.a * decay : this.startColor.a;
		this.entity.model.parts.forEach((part, index) => {
			writeParticleRgb(part.mesh.displayColor, this.startColor, this.endColor, 1 - decay, this.offsets[index]).a = fadeAlpha;
		});

		// Group scale shrinks each particle in place; local offsets are unscaled, so spread holds.
		if (this.duration.mode === "shrink") this.entity.transform.scale = ToVector3(Math.max(0.05, decay));
	}

	recycle() {
		this.total      = 0;
		this.decayStart = null;

		this.entity.transform.position.set(this.spawnOrigin);
		this.entity.transform.scale = ToVector3(1);
		this.entity.velocity.set(randomInCone(this.spawnAxis, this.halfAngle));

		// A fresh life is entitled to its own first collision event.
		this.entity.physicsRuntime.lastPhysicsCollisionKey = "";

		// Re-roll the jitter and restore the spawn alpha a fade has decayed.
		this.entity.model.parts.forEach((part, index) => {
			this.offsets[index] = randomVariance(this.variance);
			writeParticleRgb(part.mesh.displayColor, this.startColor, this.endColor, 0, this.offsets[index]).a = this.startColor.a;
		});
	}

	// End of one emission: looping by default, so the burst subclass overrides instead.
	expire() {
		if (this.orphaned) { this.finished = true; return; }
		this.recycle();
	}

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
		if (this.orphaned) return false;
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
 * @param {object} request — { templateId, position (absolute UnitVector3 cnu), offset (target-local, un-rotated), overrides, mode, target }.
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

// Sole authority on how a built carrier becomes generator requests — target keys must match `follow`.
function ParticleGeneratorRequests(carrier, kind) {
	const sources =
		kind === "terrain"  ? [{ particle: carrier.meta.particle, transform: carrier.transform, target: { type: "terrain", id: carrier.id, partId: null } }] :
		kind === "obstacle" ? carrier.parts.map((mesh) => ({ particle: mesh.meta.particle, transform: mesh.transform, target: { type: "obstacle", id: carrier.id, partId: mesh.id } })) :
		                      carrier.model.parts.map((part) => ({ particle: part.mesh.meta.particle, transform: part.mesh.transform, target: { type: carrier.type, id: carrier.id, partId: part.id } }));

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
