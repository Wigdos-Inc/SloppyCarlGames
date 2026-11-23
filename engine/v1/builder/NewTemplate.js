// Resolves template references into ordinary fully-resolved definitions.
// Non-references pass through unchanged. Never constructs geometry.

// Used by NewTerrain.js, NewObstacle.js, NewEntity.js and NewLevel.js to resolve template sources.
// Used by NewParticles.js to clone template parts.
// Template ids are validated at the normalize boundary — lookups here are guaranteed.

import terrainTemplates from "./templates/terrain.json" with { type: "json" };
import obstacleTemplates from "./templates/obstacles.json" with { type: "json" };
import characterTemplates from "./templates/characters.json" with { type: "json" };
import enemyTemplates from "./templates/enemies.json" with { type: "json" };
import projectileTemplates from "./templates/projectiles.json" with { type: "json" };
import { CloneTransform, CloneVector3, MultiplyVector3, ScaleVector3, ToVector3 } from "../math/Vector3.js";

/* === TEMPLATE CLONING === */
// Field-wise clones keep the instanced template singletons pristine across placements.

function clonePrimitiveOptions(part) {
	switch (part.shape) {
		case "tube": return {
			...part.primitiveOptions,
			thickness: part.primitiveOptions.thickness.clone(),
			nodes: part.primitiveOptions.nodes.map((node) => ({
				...node,
				dimensions   : node.dimensions.clone(),
				localPosition: node.localPosition.clone(),
				localRotation: node.localRotation.clone(),
				thickness    : node.thickness.clone(),
			})),
		};
		case "plane": {
			const { crossed, sprite } = part.primitiveOptions;
			if (sprite === null) return { crossed, sprite };
			return {
				crossed,
				sprite: {
					...sprite,
					range        : sprite.range === null ? null : sprite.range.clone(),
					occludedRange: sprite.occludedRange === null ? null : sprite.occludedRange.clone(),
				},
			};
		}
		default: return structuredClone(part.primitiveOptions);
	}
}

function cloneTexture(texture) {
	return {
		base: structuredClone(texture.base),
		custom: texture.custom.map((decal) => ({
			...decal,
			localTransform: CloneTransform(decal.localTransform),
		})),
	};
}

// Repeat copies must not share the ref override's generator instance.
function cloneParticle(particle) {
	if (particle === null) return null;
	return {
		...particle,
		position : particle.position.clone(),
		area     : particle.area.clone(),
		overrides: particle.overrides === null ? null
			: { ...particle.overrides, velocity: particle.overrides.velocity === null ? null : particle.overrides.velocity.clone() },
	};
}

function CloneTemplatePart(part) {
	return {
		...part,
		dimensions      : part.dimensions.clone(),
		localPosition   : part.localPosition.clone(),
		localRotation   : part.localRotation.clone(),
		localScale      : CloneVector3(part.localScale),
		pivot           : part.pivot.clone(),
		primitiveOptions: clonePrimitiveOptions(part),
		texture         : cloneTexture(part.texture),
		detail          : structuredClone(part.detail),
		particle        : cloneParticle(part.particle),
	};
}

function cloneMovement(movement) {
	return {
		...movement,
		start: movement.start.clone(),
		end  : movement.end.clone(),
		speed: movement.speed.clone(),
	};
}

/* === OVERRIDES & REPEAT EXPANSION === */

// Apply a part's override over the template. The override already holds the ref's texture and color.
function applyPartOverride(part, override) {
	if (override === undefined) return;
	if (override.texture !== null)  part.texture.base         = structuredClone(override.texture.base);
	if (override.color !== null)    part.texture.base.primary = { ...override.color };
	if (override.scale !== null)    part.localScale           = CloneVector3(override.scale);
	if (override.particle !== null) part.particle             = cloneParticle(override.particle);
}

// Turn each part's repeats into numbered sibling copies. Child parts stay on the original.
function expandRepeats(parts) {
	const expanded = [];
	parts.forEach((part) => {
		const repeat = part.repeat;
		delete part.repeat;
		expanded.push(part);
		if (repeat === null) return;

		// Move each copy one offset further than the last. Scale multiplies instead of adding.
		let scaleMultiplier = ToVector3(1);
		for (let i = 1; i <= repeat.count; i++) {
			const copy = CloneTemplatePart(part);
			copy.id = `${part.id}-r${i}`;
			copy.localPosition.add(ScaleVector3(repeat.offset.position, i));
			copy.localRotation.add(ScaleVector3(repeat.offset.rotation, i));

			scaleMultiplier = MultiplyVector3(scaleMultiplier, repeat.offset.scale);
			copy.localScale = MultiplyVector3(part.localScale, scaleMultiplier);
			
			expanded.push(copy);
		}
	});
	return expanded;
}

// Overrides apply to the authored part before expansion so repeat copies inherit them.
function resolveParts(templateParts, overrides) {
	const overridesById = {};
	overrides.forEach((entry) => overridesById[entry.id] = entry);

	const parts = templateParts.map((templatePart) => {
		const part = CloneTemplatePart(templatePart);
		applyPartOverride(part, overridesById[part.id]);
		return part;
	});

	return expandRepeats(parts);
}

/* === PUBLIC API === */

function ResolveObjectSource(source, role) {
	if (source.shape !== "template") return source;

	const template = { terrain: terrainTemplates, obstacle: obstacleTemplates }[role][source.template];
	const { id, position, rotation, sticky, particle } = source;
	const { dimensions, pivot, nullable, detail } = template.shared;

	const resolved = {
		id,
		dimensions    : dimensions.clone(),
		position, rotation,
		scale         : source.scale ?? CloneVector3(template.shared.scale),
		pivot         : pivot.clone(),
		detail        : structuredClone(detail),
		collisionShape: source.collisionShape ?? template.shared.collisionShape,
		mode          : source.mode ?? template.shared.mode,
		nullable, sticky, particle,
		parts         : resolveParts(template.parts, source.parts),
	};

	// Only obstacles can break, take damage or move.
	if (role === "obstacle") {
		const { destructible, hp } = template.shared;
		Object.assign(resolved, { destructible, hp });
	}
	return resolved;
}

function ResolveEntitySource(source) {
	if (source.shape !== "template") return source;

	const template = { character: characterTemplates, enemy: enemyTemplates, projectile: projectileTemplates }[source.type][source.template];
	const { id, blueprintId, dialogue } = source;
	const { attacks, animations, customEvents, type } = template;

	// Take each root transform field from the ref, or from the template where the ref leaves it null.
	const templateTransform = template.model.rootTransform, rootTransform = {};
	for (const key in templateTransform) rootTransform[key] = source.model.rootTransform[key] ?? templateTransform[key];

	// Now take each meta field.
	const meta = { hp: source.meta.hp ?? template.meta.hp };
	if (type === "enemy") meta.aggroRange = (source.meta.aggroRange ?? template.meta.aggroRange).clone();

	return {
		id, blueprintId, dialogue,
		...structuredClone({ attacks, animations, customEvents }),
		type, meta,
		movement         : cloneMovement(template.movement),
		velocity         : template.velocity.clone(),
		collisionOverride: { ...(source.collisionOverride ?? template.collisionOverride) },
		model: {
			spawnSurfaceId: source.model.spawnSurfaceId,
			rootTransform : CloneTransform(rootTransform),
			parts         : resolveParts(template.model.parts, source.model.parts),
		},
	};
}

export { ResolveObjectSource, ResolveEntitySource, CloneTemplatePart };
