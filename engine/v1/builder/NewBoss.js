// Boss Initialization

// Used by handlers/game/Boss.js
// Build Boss Model using NewEntity.js
// Boss' Attacks created in NewProjectile.js

/* === IMPORTS === */
// Logging and entity builders.

import { Log } from "../core/meta.js";
import { BuildEntity } from "./NewEntity.js";

/* === INTERNALS === */
// Local ids for boss definitions.

let bossCounter = 0;

function nextBossId(prefix) {
	bossCounter += 1;
	return `${prefix}-${bossCounter}`;
}

/* === BUILDERS === */
// Public builders for boss payloads.

function BuildBoss(definition, options) {
	if (!definition || typeof definition !== "object") {
		return null;
	}

	const prefix = options && options.defaultPrefix ? options.defaultPrefix : "boss";
	const id = definition.id || nextBossId(prefix);

	const entityDefinition = {
		...definition,
		id: id,
		type: definition.type || "boss",
	};

	const bossEntity = BuildEntity(entityDefinition, { defaultPrefix: prefix });
	if (!bossEntity) {
		return null;
	}

	const bossData = {
		id: id,
		name: definition.name || id,
		entity: bossEntity,
		phases: Array.isArray(definition.phases) ? definition.phases : [],
		attacks: Array.isArray(definition.attacks) ? definition.attacks : [],
		arena: definition.arena || null,
		meta: definition.meta && typeof definition.meta === "object" ? definition.meta : {},
	};

	Log("ENGINE", `Built boss ${id}.`, "log", "Builder");
	return bossData;
}

/* === EXPORTS === */
// Public boss pipeline surface.

export { BuildBoss };