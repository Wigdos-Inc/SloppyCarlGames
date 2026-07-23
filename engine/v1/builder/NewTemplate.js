// Resolves template references into ordinary fully-resolved definitions.
// Non-references pass through unchanged. Never constructs geometry.

// Used by NewTerrain.js, NewObstacle.js and NewEntity.js
// Template ids are validated at the normalize boundary — lookups here are guaranteed.

import terrainTemplates from "./templates/terrain.json" with { type: "json" };
import obstacleTemplates from "./templates/obstacles.json" with { type: "json" };
import characterTemplates from "./templates/characters.json" with { type: "json" };
import enemyTemplates from "./templates/enemies.json" with { type: "json" };
import projectileTemplates from "./templates/projectiles.json" with { type: "json" };
import { CloneVector3, ScaleVector3 } from "../math/Vector3.js";

/* === TEMPLATE CLONING === */
// Field-wise clones keep the instanced template singletons pristine across placements.

function clonePrimitiveOptions(part) {
	if (part.shape !== "tube") return structuredClone(part.primitiveOptions);
	return {
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
}

function cloneTexture(texture) {
	return {
		generated: structuredClone(texture.generated),
		custom: texture.custom.map((decal) => ({
			...decal,
			localTransform: {
				position: decal.localTransform.position.clone(),
				rotation: decal.localTransform.rotation.clone(),
				scale   : CloneVector3(decal.localTransform.scale),
			},
		})),
	};
}

function cloneTemplatePart(part) {
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
	};
}

function cloneMovement(movement) {
	return {
		...movement,
		start: movement.start.clone(),
		end  : movement.end.clone(),
		speed: movement.speed.clone(),
		jump : movement.jump.clone(),
	};
}

/* === OVERRIDES & REPEAT EXPANSION === */

// Payload precedence: part override > ref-level override > template value.
function applyPartOverride(part, override) {
	if (override === undefined) return;
	if (override.texture !== null) part.texture.generated = structuredClone(override.texture.generated);
	if (override.color !== null) part.texture.generated.primary = { ...override.color };
	if (override.scale !== null) part.localScale = CloneVector3(override.scale);
}

// count = additional copies. Copy i: position/rotation offset by i steps, scale multiplicative.
// parentId copies verbatim — copies are siblings; children attach to the authored instance.
function expandRepeats(parts) {
	const expanded = [];
	parts.forEach((part) => {
		const repeat = part.repeat;
		delete part.repeat;
		expanded.push(part);
		if (repeat === null) return;

		const offset = repeat.offset;
		for (let i = 1; i <= repeat.count; i++) {
			const copy = cloneTemplatePart(part);
			copy.id = `${part.id}-r${i}`;
			copy.localPosition.add(ScaleVector3(offset.position, i));
			copy.localRotation.add(ScaleVector3(offset.rotation, i));
			copy.localScale = {
				x: part.localScale.x * Math.pow(offset.scale.x, i),
				y: part.localScale.y * Math.pow(offset.scale.y, i),
				z: part.localScale.z * Math.pow(offset.scale.z, i),
			};
			expanded.push(copy);
		}
	});
	return expanded;
}

// Overrides apply to the authored part before expansion so repeat copies inherit them.
function resolveParts(templateParts, overrides, refColor, refTexture) {
	const overridesById = {};
	overrides.forEach((entry) => { overridesById[entry.id] = entry; });

	const parts = templateParts.map((templatePart) => {
		const part = cloneTemplatePart(templatePart);
		if (refTexture !== null) part.texture.generated = structuredClone(refTexture.generated);
		if (refColor !== null) part.texture.generated.primary = { ...refColor };
		applyPartOverride(part, overridesById[part.id]);
		return part;
	});

	return expandRepeats(parts);
}

/* === PUBLIC API === */

function ResolveObjectSource(source, role) {
	if (source.shape !== "template") return source;

	const template = { terrain: terrainTemplates, obstacle: obstacleTemplates }[role][source.template];
	const shared = template.shared;

	return {
		id            : source.id,
		dimensions    : shared.dimensions.clone(),
		position      : source.position,
		rotation      : source.rotation,
		scale         : source.scale !== null ? source.scale : CloneVector3(shared.scale),
		pivot         : shared.pivot.clone(),
		detail        : structuredClone(shared.detail),
		collisionShape: source.collisionShape !== null ? source.collisionShape : shared.collisionShape,
		destructible  : shared.destructible,
		hp            : shared.hp,
		static        : shared.static,
		mode          : source.mode !== null ? source.mode : shared.mode,
		nullable      : shared.nullable,
		parts         : resolveParts(template.parts, source.parts, source.color, source.texture),
	};
}

function ResolveEntitySource(source) {
	if (source.shape !== "template") return source;

	const template = { character: characterTemplates, enemy: enemyTemplates, projectile: projectileTemplates }[source.type][source.template];
	const templateTransform = template.model.rootTransform;
	const refTransform = source.model.rootTransform;

	return {
		id               : source.id,
		blueprintId      : source.blueprintId,
		type             : template.type,
		hp               : source.hp !== null ? source.hp : template.hp,
		movement         : cloneMovement(template.movement),
		velocity         : template.velocity.clone(),
		platform         : structuredClone(template.platform),
		attacks          : structuredClone(template.attacks),
		hardcoded        : structuredClone(template.hardcoded),
		animations       : structuredClone(template.animations),
		collisionOverride: source.collisionOverride !== null ? { ...source.collisionOverride } : { ...template.collisionOverride },
		customEvents     : structuredClone(template.customEvents),
		dialogue         : source.dialogue,
		model: {
			spawnSurfaceId: source.model.spawnSurfaceId,
			rootTransform: {
				position: refTransform.position !== null ? refTransform.position.clone() : templateTransform.position.clone(),
				rotation: refTransform.rotation !== null ? refTransform.rotation.clone() : templateTransform.rotation.clone(),
				scale   : refTransform.scale    !== null ? CloneVector3(refTransform.scale) : CloneVector3(templateTransform.scale),
				pivot   : refTransform.pivot    !== null ? refTransform.pivot.clone() : templateTransform.pivot.clone(),
			},
			parts: resolveParts(template.model.parts, source.model.parts, null, null),
		},
	};
}

export { ResolveObjectSource, ResolveEntitySource };
