// playerMode.js — Simulator App player-character validation & rendering support.
//
// This is APP code (carlGames/simulator), not an engine module. Player characters
// (engine/v1/player/characters.json, exposed as ENGINE.Blueprints.PlayerCharacters)
// bypass the engine's validate.js/normalize.js entirely — player/Model.js instances
// the raw JSON with no fallback-filling and no color->primary hoist. So authored
// player data must already match the canonical shape or it breaks at port time.
//
// The canonical shape is derived at runtime from ENGINE.Blueprints.PlayerCharacters
// (a live deep clone of characters.json): "required" fields are those present in
// EVERY canonical entry, "optional" fields appear in some. This ties validation to
// the real data — if the engine adds a field to every character, it flows through
// automatically. On top of the derived shape we hard-reject the entity-schema
// fields that cause silent drift (part-level `color`, `texture.generated.color`,
// entity-only top-level keys).

const SIM_PLAYER_PREFIX = "__player__";

// Simulator player-definition tag. characters.json entries carry no `type` (the map key
// is the id); the Simulator stamps `type: "player"` so authored drafts can live in
// entities.json alongside entities and be partitioned by mode. It is an app-side tag only
// — the engine has no "player" objectType — and is stripped on export to characters.json.
export const PLAYER_TYPE = "player";
export const isPlayerDef = (def) => def?.type === PLAYER_TYPE;

// Top-level keys the entity schema uses but the player schema must never carry.
// (`type` is intentionally absent — "player" is the allowed Simulator tag, checked below.)
const FORBIDDEN_TOP_KEYS = ["hp", "movement", "velocity", "attacks", "hardcoded", "customEvents", "platform", "animations"];
const FORBIDDEN_MODEL_KEYS = ["rootTransform", "spawnSurfaceId"];

// Part sub-objects that must be {x,y,z} numeric vectors.
const VEC3_PART_KEYS = ["dimensions", "localPosition", "localRotation", "localScale", "pivot"];

// ── Reference-shape derivation (memoized) ────────────────────────────────────

let reference = null;

const characters = () => ENGINE.Blueprints.PlayerCharacters;

// Intersection of own-key names across a list of objects (= keys present in ALL).
function commonKeys(objects) {
    let common = null;
    for (const obj of objects) {
        const keys = new Set(Object.keys(obj));
        common = common === null ? keys : new Set([...common].filter((k) => keys.has(k)));
    }
    return common ?? new Set();
}

// Build the canonical descriptor once from the live character data.
function getReference() {
    if (reference) return reference;

    const defs = Object.values(characters());
    const allParts = defs.flatMap((d) => d.model.parts);
    const sample = characters().chara ?? defs[0];

    reference = {
        top: commonKeys(defs),
        meta: commonKeys(defs.map((d) => d.meta)),
        physics: commonKeys(defs.map((d) => d.physics)),
        collisionOverride: commonKeys(defs.map((d) => d.collisionOverride)),
        name: commonKeys(defs.map((d) => d.name)),
        part: commonKeys(allParts),
        generated: commonKeys(allParts.map((p) => p.texture.generated)),
        sample,
    };
    return reference;
}

// ── Type helpers ─────────────────────────────────────────────────────────────

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isVec3 = (v) => isObject(v) && typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number";

// ── Validation ───────────────────────────────────────────────────────────────

// Returns an array of human-readable error strings (empty = valid).
export function validatePlayerEntry(v) {
    const errors = [];

    if (!isObject(v)) {
        errors.push("Root must be a JSON object.");
        return errors;
    }

    const ref = getReference();

    // `id` is the one field the Simulator adds beyond canonical shape — it becomes
    // the characters.json map key on export. Required here, stripped on export.
    if (typeof v.id !== "string" || v.id.trim() === "") errors.push("id: must be a non-empty string.");

    // `type`, if present, must be the player tag — any entity type is drift.
    if ("type" in v && v.type !== PLAYER_TYPE) errors.push(`type: must be "${PLAYER_TYPE}" (got ${JSON.stringify(v.type)}); entity types are not valid player definitions.`);

    // Reject entity-schema top-level keys that would silently break at port time.
    for (const key of FORBIDDEN_TOP_KEYS) {
        if (key in v) errors.push(`${key}: entity-only field is not allowed on a player character.`);
    }

    // Required top-level keys (present in every canonical character).
    for (const key of ref.top) {
        if (!(key in v)) errors.push(`${key}: required.`);
    }

    if (isObject(v.name)) {
        for (const key of ref.name) {
            if (typeof v.name[key] !== "string") errors.push(`name.${key}: must be a string.`);
        }
    } else if ("name" in v) errors.push("name: must be an object.");

    if (isObject(v.meta)) {
        for (const key of ref.meta) {
            if (typeof v.meta[key] !== "number") errors.push(`meta.${key}: must be a number.`);
        }
    } else if ("meta" in v) errors.push("meta: must be an object.");

    if (isObject(v.physics)) {
        for (const key of ref.physics) {
            if (typeof v.physics[key] !== "boolean") errors.push(`physics.${key}: must be a boolean.`);
        }
    } else if ("physics" in v) errors.push("physics: must be an object.");

    if (isObject(v.collisionOverride)) {
        for (const key of ref.collisionOverride) {
            if (!(key in v.collisionOverride)) errors.push(`collisionOverride.${key}: required.`);
        }
    } else if ("collisionOverride" in v) errors.push("collisionOverride: must be an object.");

    validateModel(v.model, ref, errors);

    return errors;
}

function validateModel(model, ref, errors) {
    if (model === undefined) return; // absence already reported by the top-key loop
    if (!isObject(model)) {
        errors.push("model: must be an object.");
        return;
    }

    for (const key of FORBIDDEN_MODEL_KEYS) {
        if (key in model) errors.push(`model.${key}: entity-only field is not allowed on a player character.`);
    }

    if (!Array.isArray(model.parts) || model.parts.length === 0) {
        errors.push("model.parts: must be a non-empty array.");
        return;
    }

    const ids = new Set();
    let rootCount = 0;
    model.parts.forEach((part, i) => {
        if (typeof part?.id === "string") ids.add(part.id);
        if (isObject(part) && part.parentId === "root") rootCount++;
        validatePart(part, i, ref, errors);
    });

    if (rootCount !== 1) errors.push(`model.parts: exactly one part must have parentId "root" (found ${rootCount}).`);

    // Every non-root parentId must reference a part that exists.
    model.parts.forEach((part, i) => {
        if (isObject(part) && part.parentId !== "root" && typeof part.parentId === "string" && !ids.has(part.parentId)) {
            errors.push(`model.parts[${i}] (${part.id}): parentId "${part.parentId}" does not match any part id.`);
        }
    });
}

function validatePart(part, i, ref, errors) {
    const at = `model.parts[${i}]${isObject(part) && part.id ? ` (${part.id})` : ""}`;

    if (!isObject(part)) {
        errors.push(`${at}: must be an object.`);
        return;
    }

    // Entity-ism: a part-level `color`. In an entity payload normalize hoists this
    // into texture.generated.primary; player data bypasses that, so it silently
    // becomes dead data — this is the exact "Carl shape discrepancy" guard.
    if ("color" in part) errors.push(`${at}: part-level "color" is an entity-ism — put base color in texture.generated.primary/.secondary.`);

    for (const key of ref.part) {
        if (!(key in part)) errors.push(`${at}: missing "${key}".`);
    }

    for (const key of VEC3_PART_KEYS) {
        if (key in part && !isVec3(part[key])) errors.push(`${at}.${key}: must be a {x,y,z} vector.`);
    }

    validateTexture(part.texture, at, ref, errors);

    if (part.shape === "tube") validateTubeOptions(part.primitiveOptions, at, errors);
}

function validateTexture(texture, at, ref, errors) {
    if (!isObject(texture)) {
        if (texture !== undefined) errors.push(`${at}.texture: must be an object.`);
        return;
    }

    if (isObject(texture.generated)) {
        // `color` inside generated aliases to `secondary` in the engine schema —
        // reject it so authored data uses explicit primary/secondary.
        if ("color" in texture.generated) errors.push(`${at}.texture.generated: "color" is an entity-ism — use "primary" and "secondary".`);
        for (const key of ref.generated) {
            if (!(key in texture.generated)) errors.push(`${at}.texture.generated: missing "${key}".`);
        }
    } else errors.push(`${at}.texture.generated: must be an object.`);

    if (!Array.isArray(texture.custom)) {
        errors.push(`${at}.texture.custom: must be an array.`);
        return;
    }

    // Player decal image paths are authored relative to engine/v1/player/ (e.g. "../assets/...")
    // so they port straight into characters.json. The entity "../../engine/v1/assets/..." form
    // is drift — it resolves against a different base and would break once ported.
    texture.custom.forEach((decal, d) => {
        if (decal?.decalType === "image" && typeof decal.imagePath === "string" && decal.imagePath.startsWith("../../engine")) {
            errors.push(`${at}.texture.custom[${d}]: imagePath "${decal.imagePath}" uses the entity path convention — player decals must be relative to engine/v1/player/ (e.g. "../assets/...").`);
        }
    });
}

function validateTubeOptions(options, at, errors) {
    if (!isObject(options)) {
        errors.push(`${at}.primitiveOptions: tube parts require an options object.`);
        return;
    }
    if (typeof options.thickness !== "number") errors.push(`${at}.primitiveOptions.thickness: tube parts require a numeric thickness.`);
    if (!Array.isArray(options.nodes) || options.nodes.length === 0) {
        errors.push(`${at}.primitiveOptions.nodes: tube parts require a non-empty nodes array.`);
        return;
    }
    options.nodes.forEach((node, n) => {
        const nat = `${at}.primitiveOptions.nodes[${n}]`;
        if (!isVec3(node?.dimensions)) errors.push(`${nat}.dimensions: must be a {x,y,z} vector.`);
        if (!isVec3(node?.localPosition)) errors.push(`${nat}.localPosition: must be a {x,y,z} vector.`);
        if (!isVec3(node?.localRotation)) errors.push(`${nat}.localRotation: must be a {x,y,z} vector.`);
        if (typeof node?.thickness !== "number") errors.push(`${nat}.thickness: must be a number.`);
    });
}

// ── Rendering & export ───────────────────────────────────────────────────────

// Player decal imagePaths in characters.json are relative to engine/v1/player/
// (that's where player/Model.js resolves them, via `new URL(imagePath, import.meta.url)`).
// The entity pipeline this Simulator renders through instead fetches imagePath with no
// base, so it would resolve against carlGames/simulator/ and 404. Reproduce the player
// pipeline's anchor from this module's location: carlGames/simulator/ -> engine/v1/player/.
const PLAYER_ASSET_BASE = new URL("../../engine/v1/player/", import.meta.url);

// Rewrite every image decal's imagePath (top-level and nested `sources`) to the absolute
// URL the player pipeline would produce, so the entity-pipeline fetch resolves it. Mutates
// the passed parts in place — only ever called on the deep-cloned render copy below.
function resolveDecalPaths(parts) {
    const rewrite = (decal) => {
        if (decal?.decalType === "image" && typeof decal.imagePath === "string") {
            decal.imagePath = new URL(decal.imagePath, PLAYER_ASSET_BASE).href;
        }
        if (isObject(decal?.sources)) Object.values(decal.sources).forEach(rewrite);
    };
    for (const part of parts) if (Array.isArray(part?.texture?.custom)) part.texture.custom.forEach(rewrite);
}

// Wrap a validated player character in a throwaway entity payload so the existing
// entity render path (ENGINE.Simulator.Cache/Load -> BuildEntity) can preview it.
// Player parts already carry explicit generated.primary/.secondary and no part-level
// color, so they build cleanly through the entity pipeline. Rendering fidelity is a
// preview only — the canonical player JSON (see toCharactersJsonEntry) is what ports.
export function synthesizePlayerEntity(def) {
    // Deep-clone so the engine's in-place normalization of the render copy can't
    // mutate the shared ENGINE.Blueprints.PlayerCharacters data across loads.
    const synth = structuredClone({
        id: SIM_PLAYER_PREFIX + def.id,
        type: "entity",
        name: def.name,
        meta: def.meta,
        physics: def.physics,
        collisionOverride: def.collisionOverride,
        model: {
            rootTransform: { position: { x: 0, y: 0, z: 0 } },
            parts: def.model.parts,
        },
    });
    // Fix decal paths on the clone only — the registry/export copy keeps canonical
    // engine/v1/player-relative paths so "Copy Player JSON" round-trips into characters.json.
    resolveDecalPaths(synth.model.parts);
    return synth;
}

// Format a validated player character as a characters.json map entry: `"id": { ...}`
// with the Simulator-only `id` field stripped (the id becomes the map key).
export function toCharactersJsonEntry(def) {
    const { id, type, ...body } = def; // strip the Simulator-only id + player tag
    return JSON.stringify({ [id]: body }, null, 2);
}

// Build the player registry: canonical characters (id + player tag injected for
// editing/keying), overlaid with user-authored player drafts (already tagged).
export function buildPlayerRegistry(userPlayerDefs) {
    const canonical = Object.entries(characters()).map(([id, def]) => ({ id, type: PLAYER_TYPE, ...def }));
    const byId = new Map(canonical.map((def) => [def.id, def]));
    for (const def of userPlayerDefs) byId.set(def.id, def);
    return [...byId.values()].map((def) => ({ objectType: "player", definition: def }));
}
