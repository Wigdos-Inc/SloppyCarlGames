// Builds randomized particle groups from a particle template plus per-call overrides.
// Each group is a normal multi-part entity that shares the entity build, geometry cache and ("full" mode) physics.

// Used by NewLevel.js for level-authored generators.
// Used by handlers/game/Level.js for game requests and reseeding.
// Used by handlers/game/Level.js to place generators on their target.
// Used by handlers/game/Simulator.js for the loaded object's generators.
// Uses NewEntity.js to build groups.
// Uses NewTemplate.js to clone parts.
// Uses templates/particles.json for the presets.

import particleTemplates from "./templates/particles.json" with { type: "json" };
import { BuildEntity, GetFaceCenterOffset, UpdateEntityModel } from "./NewEntity.js";
import { CloneTemplatePart } from "./NewTemplate.js";
import { 
	AddVector3, 
	CompareVector3, 
	CrossVector3, 
	MultiplyVector3, 
	RotateByEuler, 
	ScaleVector3, 
	ToVector3, 
	Vector3Length, 
	WORLD_NORMALS 
} from "../math/Vector3.js";
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
function sphereLayout(size) {
	return Array.from({ length: size }, (_, index) => {
		const y      = 1 - ((index + 0.5) / size) * 2;
		const radius = Math.sqrt(1 - y ** 2);
		const angle  = index * goldenAngle;
		return { x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius };
	});
}

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

// Turn a velocity into the carrier's axes. Bursts have no carrier and keep world axes.
const carrierAxis = (velocity, rotation) => rotation === null ? velocity : RotateByEuler(velocity, rotation);

// Pick a point in the area box, turned into the carrier's axes. Bursts and zero areas spawn at the center.
function randomInArea(area, rotation) {
	return area === null || Vector3Length(area) === 0
		? ToVector3(0)
		: RotateByEuler(MultiplyVector3(area, { x: randomRange(-0.5, 0.5), y: randomRange(-0.5, 0.5), z: randomRange(-0.5, 0.5) }), rotation);
}

/* === REQUEST RESOLUTION === */

// Template keys a request may override.
const PARTICLE_OVERRIDE_KEYS = ["count", "spread", "physics", "color", "velocity", "duration"];

// Merge overrides onto the template.
function resolveRequest(template, overrides) {
	const resolved = { amount: template.amount, part: template.part };
	PARTICLE_OVERRIDE_KEYS.forEach((key) => resolved[key] = overrides === null || overrides[key] === null ? template[key] : overrides[key]);
	return resolved;
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
		animations       : {},
		customEvents     : {
			spawn          : false,
			despawn        : false,
			actionChange   : false,
			collision      : false,
			groundedChange : false,
			damageReceived : false,
			damageInflicted: false,
		},
		collisionOverride: { physics: "aabb", hurtbox: null, hitbox: null },
		velocity,
		movement: {
			start       : position.clone(),
			end         : position.clone(),
			speed       : new Unit(0, "cnu"),
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

// Hold the runtime state for one particle group.
class particleGroup {
	constructor(entity, request, resolved, halfAngle) {
		const variance = resolved.color.variance;
		this.entity           = entity;
		this.request          = { ...request, position: request.position.clone(), mode: "sibling" };
		this.physicsMode      = resolved.physics;
		this.display          = {
			color: {
				start     : resolved.color.start,
				end       : resolved.color.end === null ? resolved.color.start : resolved.color.end,
				brightness: { variance, partOffsets: entity.model.parts.map(() => randomVariance(variance)) },
			},
		};
		this.halfAngle        = halfAngle;
		this.target           = request.target;
		this.targetKey        = request.target === null ? null : `${request.target.type}::${request.target.id}::${request.target.partId}`;
		this.parent           = {               // The carrier this group follows
			rotation    : request.rotation,     // The carrier's live rotation
			lastRotation: null,                 // The rotation offset.world was last turned by
			offset      : { local: request.offset === null ? null : request.offset.clone(), world: null },
		};
		this.orphaned         = false;

		const origin = entity.transform.position.clone();
		this.lifecycle = {
			duration  : resolved.duration,
			lifespanMs: resolved.duration.intervalMs,
			ageMs     : 0,
			decayStart: null,
			finished  : false,
			spawn     : {
				origin: { position: origin, correction: origin.clone().subtract(request.position) },
				axis  : resolved.velocity.clone(),
			},
		};

		// Tint through the display color to avoid baking a texture per particle.
		const color = this.display.color;
		entity.model.parts.forEach((part, index) => {
			part.mesh.display.color = writeParticleRgb({ a: color.start.a }, color.start, color.end, 0, color.brightness.partOffsets[index]);
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

		// Only turn the offset when the carrier has turned.
		const parent = this.parent;
		parent.rotation = transform.rotation;
		if (parent.lastRotation === null || !CompareVector3(parent.lastRotation, parent.rotation)) {
			parent.lastRotation = parent.rotation.clone();
			parent.offset.world = RotateByEuler(parent.offset.local, parent.rotation);
		}

		// Move the request position, rotation and spawn origin with the target. New siblings spawn there too.
		this.request.position.set(transform.position).add(parent.offset.world);
		this.request.rotation = parent.rotation;
		this.lifecycle.spawn.origin.position.set(this.request.position).add(this.lifecycle.spawn.origin.correction);
	}

	// Stop recycling and end the group when its decay finishes.
	orphan() {
		this.orphaned             = true;
		this.lifecycle.lifespanMs = this.lifecycle.duration.endTimeMs;
	}

	// Age, move and fade the group by one frame.
	advance(deltaMs, deltaSeconds) {
		const { lifecycle, display: { color } } = this;
		lifecycle.ageMs += deltaMs;

		// "none" moves itself by velocity. "simple" only adds a light gravity arc.
		if (this.physicsMode === "none")   this.entity.transform.position.add(ScaleVector3(this.entity.velocity, deltaSeconds));
		if (this.physicsMode === "simple") this.entity.velocity.y -= CONFIG.Physics.Gravity.Strength * deltaSeconds;

		// Expire at end of life, and hold full color until the decay begins.
		if (lifecycle.ageMs >= lifecycle.lifespanMs)          return this.expire();
		if (lifecycle.ageMs < lifecycle.duration.holdTimeMs) return;

		if (lifecycle.decayStart === null) lifecycle.decayStart = lifecycle.ageMs;
		const decay = 1 - Clamp01((lifecycle.ageMs - lifecycle.decayStart) / (lifecycle.duration.endTimeMs - lifecycle.decayStart));

		// Blend toward the end color and fade from the start alpha.
		const fadeAlpha = lifecycle.duration.mode === "fade" ? color.start.a * decay : color.start.a;
		this.entity.model.parts.forEach((part, index) => {
			writeParticleRgb(part.mesh.display.color, color.start, color.end, 1 - decay, color.brightness.partOffsets[index]).a = fadeAlpha;
		});

		// Shrink each particle in place. The spread between them stays the same.
		if (lifecycle.duration.mode === "shrink") this.entity.transform.scale = ToVector3(Math.max(0.05, decay));
	}

	// Restart the group within it's authored area with a fresh direction.
	recycle() {
		const { lifecycle, display: { color }, parent } = this;
		lifecycle.ageMs      = 0;
		lifecycle.decayStart = null;

		this.entity.transform.position.set(lifecycle.spawn.origin.position).add(randomInArea(this.request.area, parent.rotation));
		this.entity.transform.scale = ToVector3(1);
		this.entity.velocity.set(randomInCone(carrierAxis(lifecycle.spawn.axis, parent.rotation), this.halfAngle));

		// Clear the last collision key to let the new life fire its own collision event.
		this.entity.physics.lastFrame.collisionKey = "";

		// Re-roll each particle's brightness offset and restore the start color and alpha.
		this.entity.model.parts.forEach((part, index) => {
			color.brightness.partOffsets[index] = randomVariance(color.brightness.variance);
			writeParticleRgb(part.mesh.display.color, color.start, color.end, 0, color.brightness.partOffsets[index]).a = color.start.a;
		});
	}

	// Recycle at end of life, or finish once orphaned. Bursts override this to always finish.
	expire() {
		if (this.orphaned) return this.lifecycle.finished = true;
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
		if (this.seedClock < (this.seeded + 1) * (this.lifecycle.duration.intervalMs / this.amount)) return false;

		this.seeded += 1;
		return true;
	}
}

// Run a one-shot group that finishes after its decay and never seeds.
class burstParticleGroup extends particleGroup {
	constructor(entity, request, resolved, halfAngle) {
		super(entity, request, resolved, halfAngle);
		this.lifecycle.lifespanMs = resolved.duration.endTimeMs;
	}

	expire() {
		this.lifecycle.finished = true;
	}
}

/* === PUBLIC API === */

// Generate the particle group for an incoming request.
function GenerateParticles(request, textureScale, faceTextureStore) {
	const multiplier = PERFORMANCE_SCALING.Density.Particles[CONFIG.Performance.Particles];
	if (multiplier === 0) {
		Log("ENGINE", "Particles disabled: PERFORMANCE.Particles is Disabled.", "warn", "Level");
		return { groups: [] };
	}

	const resolved  = resolveRequest(particleTemplates[request.templateId], request.overrides);
	const halfAngle = spreadHalfAngles[resolved.spread].value;
	const axis      = carrierAxis(resolved.velocity, request.rotation);

	// Open an emitter on a request's first build. 
	// Note: Sibling copies share it, letting it count every live group.
	if (request.mode !== "sibling") request.emitter = { mode: request.mode, groups: 0 };

	const groups = resolveGroupSizes(Math.max(1, Math.round(resolved.count * multiplier))).map((size, index) => {
		const cone     = randomInCone(axis, halfAngle);
		const velocity = new UnitVector3(cone.x, cone.y, cone.z, "cnu"); // Per second

		const entity = BuildEntity(
			synthesizeGroupDefinition(request.templateId, resolved, request.position, size, index, velocity),
			particleSurfaceMap,
			textureScale, faceTextureStore
		).entity;

		// Center the group vertically on the request position instead of standing on it.
		entity.transform.position.y += request.position.y - (entity.fullAabb.min.y + entity.fullAabb.max.y) * 0.5;

		// Bursts expire. Generators recycle.
		entity.particle = request.mode === "burst"
			? new burstParticleGroup(entity, request, resolved, halfAngle)
			: request.mode === "generator" && index === 0
				? new seedingParticleGroup(entity, request, resolved, halfAngle)
				: new particleGroup(entity, request, resolved, halfAngle);

		// Spawn randomly within it's authored area.
		entity.transform.position.add(randomInArea(request.area, request.rotation));
		UpdateEntityModel(entity);

		return entity;
	});

	request.emitter.groups += groups.length;
	return { groups };
}

// Place a generator on its carrier.
function GeneratorPlacement(generator, mesh, transform) {
	const offset = generator.position.clone().add(GetFaceCenterOffset(MultiplyVector3(mesh.dimensions, mesh.transform.scale), generator.side));
	return {
		offset,
		position: transform.position.clone().add(RotateByEuler(offset, transform.rotation)),
		rotation: transform.rotation,
	};
}

// Collect generator requests for every particle a built terrain mesh, obstacle part or entity carries.
// Note: target type and partId must match what Level.js resolves for following.
function ParticleGeneratorRequests(carrier, kind) {
	const sources = kind === "terrain"
		? [{ particle: carrier.meta.particle, mesh: carrier, target: { type: "terrain", id: carrier.id, partId: null } }]
		: kind === "obstacle"
			? [{ particle: carrier.meta.particle, mesh: carrier, target: { type: "obstacle", id: carrier.meta.group, partId: carrier.id } }]
			: carrier.model.parts.map((part) => (
				{ particle: part.mesh.meta.particle, mesh: part.mesh, target: { type: carrier.type, id: carrier.id, partId: part.id } }
			));

	return sources.filter((source) => source.particle !== null).map((source) => {
		const { offset, position, rotation } = GeneratorPlacement(source.particle, source.mesh, source.mesh.transform);
		return {
			templateId: source.particle.id,
			position, offset, rotation,
			area      : source.particle.area,
			overrides : source.particle.overrides,
			mode      : "generator",
			target    : source.target,
			customEvents: source.particle.customEvents,
		};
	});
}

export { GenerateParticles, GeneratorPlacement, ParticleGeneratorRequests, PARTICLE_OVERRIDE_KEYS };
