// Tracks the entire player state.

// Used by handlers/game/Level.js as the per-frame player update orchestrator.
// Uses all player modules: Movement.js, Abilities.js, Model.js.

import { Log, SendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { NormalizeImage } from "../core/normalize.js";
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { CloneVector3, ScaleVector3, ToVector3, WORLD_NORMALS } from "../math/Vector3.js";
import { 
	BuildPlayerModel, 
	InitializePlayerCollisionProfile, 
	SyncPlayerCollisionFromState, 
	UpdatePlayerModelFromState 
} from "./Model.js";
import { UpdateMovement } from "./Movement.js";
import characterData from "./characters.json" with { type: "json" };

(function normalizeCharacterTemplates() {
	const toUnitVector3 = (vector, type) => new UnitVector3(vector.x, vector.y, vector.z, type);
	for (const characterId in characterData) {
		const char = characterData[characterId];
		char.meta.jumpHeight = new Unit(char.meta.jumpHeight, "cnu");
		char.model.parts.forEach((part) => {
			part.dimensions = toUnitVector3(part.dimensions, "cnu");
			part.localPosition = toUnitVector3(part.localPosition, "cnu");
			part.localRotation = toUnitVector3(part.localRotation, "degrees").toRadians(true);
			part.pivot = toUnitVector3(part.pivot, "cnu");
			part.customTextures.forEach((ct) => {
				ct.localTransform.position = toUnitVector3(ct.localTransform.position, "cnu");
				ct.localTransform.rotation = new Unit(ct.localTransform.rotation, "degrees").toRadians(true);
			});
		});
	}
})();

/* === PLAYER INPUT FLAGS === */
// Mutable object exposed as ENGINE.Level.Player.Input.
// Game code writes to this directly each frame.

const playerInputFlags = {
	forward: 0,
	right: 0,
	jump: false,
	boost: false,
};

/* === PLAYER STATE === */

let playerState = null;
function createDefaultPlayerState(playerData) {
	const sphereBounds = {
		type: "sphere",
		center: new UnitVector3(0, 0, 0, "cnu"),
		radius: new Unit(0, "cnu"),
	};
	const capsuleBounds = {
		type: "capsule",
		radius: new Unit(0, "cnu"),
		halfHeight: new Unit(0, "cnu"),
		segmentStart: new UnitVector3(0, 0, 0, "cnu"),
		segmentEnd: new UnitVector3(0, 0, 0, "cnu"),
	};

	const collision = {
		aabb: { min: new UnitVector3(0, 0, 0, "cnu"), max: new UnitVector3(0, 0, 0, "cnu") },
		radius: new Unit(playerData.collisionRadius, "cnu"),
		shape: "sphere",
		profile: {
			shape: "sphere",
			modelAabb: { min: new UnitVector3(0, 0, 0, "cnu"), max: new UnitVector3(0, 0, 0, "cnu") },
			bodyCenterOffset: new UnitVector3(0, 0, 0, "cnu"),
			bodyRadius: new Unit(0, "cnu"),
			bottomOffset: new Unit(0, "cnu"),
			sphereCenterOffset: new UnitVector3(0, 0, 0, "cnu"),
			sphereRadius: new Unit(0, "cnu"),
			capsuleStartOffset: new UnitVector3(0, 0, 0, "cnu"),
			capsuleEndOffset: new UnitVector3(0, 0, 0, "cnu"),
			capsuleRadius: new Unit(0, "cnu"),
			capsuleHalfHeight: new Unit(0, "cnu"),
		},
		sphere: sphereBounds,
		capsule: capsuleBounds,
		simRadiusPadding: 24,
		simRadiusAabb: { min: new UnitVector3(0, 0, 0, "cnu"), max: new UnitVector3(0, 0, 0, "cnu") },
		physics: {
			shape: "sphere",
			bounds: sphereBounds,
		},
		hurtbox: {
			shape: "sphere",
			bounds: { type: "sphere", center: new UnitVector3(0, 0, 0, "cnu"), radius: new Unit(0, "cnu") },
		},
		hitbox: {
			shape: "sphere",
			bounds: { type: "sphere", center: new UnitVector3(0, 0, 0, "cnu"), radius: new Unit(0, "cnu") },
		},
	};

	return {
		active: true,
		character: playerData.character,
		animations: playerData.animations,
		model: BuildPlayerModel(playerData.character, playerData.spawnPosition),
		transform: {
			position: playerData.spawnPosition,
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: playerData.scale,
		},
		velocity: new UnitVector3(0, 0, 0, "cnu"),
		grounded: false,
		underwater: false,
		submergence: 0,
		buoyancyForce: 0,
		surfaceNormal: CloneVector3(WORLD_NORMALS.Up),
		alignedUp: CloneVector3(WORLD_NORMALS.Up),
		jumpStartY: new Unit(playerData.spawnPosition.y, "cnu"),
		jumpApexY: new Unit(playerData.spawnPosition.y, "cnu"),
		stoppingActive: false,
		primaryOppositeHeld: false,
		state: "Idle",
		previousState: "Idle",
		hp: 3,
		collectibles: playerData.collectibles,
		maxCollectibles: 100,
		attackFlag: false,
		hitboxActive: false,
		modelOpacity: 1.0,
		abilities: null,
		boost: {
			active: false,
			timer: 0,
			maxSpeedMultiplier: 1,
			accelMultiplier: 1,
		},
		invulnerable: {
			active: false,
			timer: 0,
			flashTimer: 0,
		},
		activeTriggers: [],
		checkpoint: null,
		spawnPosition: playerData.spawnPosition.clone(),
		physicsRuntime: {
			previousPosition: playerData.spawnPosition.clone(),
			previousRotation: new UnitVector3(0, 0, 0, "radians"),
			hasUnresolvedPenetration: false,
			cachePrimed: false,
			lastPhysicsCollisionKey: "",
		},
		collision,
		customEvents: playerData.customEvents,
		mesh: null,
		type: "player",
		id: "player",
	};
}

/**
 * Initialize the player entity for a level.
 * @param {object} payload — { spawnPosition, character, modelParts, collectibles }
 * @param {object} sceneGraph — the active scene graph.
 * @returns {object} — the initialized playerState.
 */
async function InitializePlayer(payload, sceneGraph) {
	const characterProfile = characterData[payload.character];
	const hasCustomParts = payload.modelParts.length > 0;
	const { list: metaOverrideList, ...metaOverrides } = payload.metaOverrides;
	const effectiveCharacter = {
		...characterProfile,
		meta: { ...characterProfile.meta, ...metaOverrides },
		model: hasCustomParts ? { ...characterProfile.model, parts: payload.modelParts } : characterProfile.model,
	};

	if (!hasCustomParts) {
		const imageLoads = [];
		effectiveCharacter.model.parts.forEach((part) => {
			part.customTextures.forEach((ct) => {
				if (ct.decalType !== "image") return;
				imageLoads.push(
					NormalizeImage(new URL(ct.imagePath, import.meta.url).href, ct.sourceType, "webgl").then((result) => {
						ct.bitmap = result.bool ? result.value : null;
					})
				);
			});
		});
		await Promise.all(imageLoads);
		effectiveCharacter.model.parts.forEach((part) => {
			part.customTextures = part.customTextures.filter((ct) => ct.decalType !== "image" || ct.bitmap !== null);
		});
	}

	// Log meta overrides using the normalized, formatted list from the payload.
	Log("ENGINE", `Player meta overrides applied:\n- ${metaOverrideList.join('\n- ')}`, "log", "Player");

	// Build Player State & Model
	playerState = createDefaultPlayerState({
		character      : effectiveCharacter,
		spawnPosition  : payload.spawnPosition,
		scale          : payload.scale,
		collectibles   : payload.collectibles,
		collisionRadius: effectiveCharacter.meta.collisionRadius,
		customEvents   : payload.customEvents,
		animations     : payload.animations,
	});
	InitializePlayerCollisionProfile(playerState);
	SyncPlayerCollisionFromState(playerState);
	UpdatePlayerModelFromState(playerState);

	// Insert player as entity into sceneGraph for rendering.
	sceneGraph.player = playerState;
	// Also place in entities array so the renderer and bounding box system see it.
	sceneGraph.entities.push(playerState);

	const sourceType = hasCustomParts ? "custom-model" : "profile";

	Log(
		"ENGINE", 
		`
			Player initialized: 
			character="${effectiveCharacter.name}" 
			source="${sourceType}" at (${payload.spawnPosition.x}, ${payload.spawnPosition.y}, ${payload.spawnPosition.z})
		`, 
		"log", 
		"Player"
	);
	return playerState;
}

/**
 * Per-frame player update orchestrator. Called from Level.js Update().
 * Runs the full player pipeline in order:
 *   1. Read input flags
 *   2. Movement (input → velocity intent)
 *   3. Abilities (boost, invulnerability timers)
 *   — Physics, collision, correction, enemy, collectible are handled by their respective handlers
 *     called from Level.js after this returns.
 *
 * @param {number} deltaSeconds
 * @param {{ forward, right }} cameraVectors — camera orientation for relative movement.
 * @returns {object|null} — updated playerState, or null if no player.
 */
function UpdatePlayer(deltaSeconds, cameraVectors) {
	if (!playerState.active) return null;
	if (playerState.state === "Dead") return playerState;

	// Step 1–2: Movement (reads input, modifies velocity).
	UpdateMovement(playerState, playerInputFlags, cameraVectors, deltaSeconds);

	// Step 3: Ability updates (not implemented).

	// Steps 4–8 (physics, collision, correction, enemy, collectible) are called
	// from Level.js after this function returns, so the player pipeline order is:
	// Master.UpdatePlayer → Physics.ApplyPhysicsPipeline → Enemy → Collectible → state machine → model sync

	return playerState;
}

function UpdatePlayerCollision() {
	SyncPlayerCollisionFromState(playerState);
	return playerState;
}

function UpdatePlayerModel() {
	UpdatePlayerModelFromState(playerState);
	return playerState;
}

/**
 * Resolve the player state machine after all physics/collision/damage have been applied.
 * Called from Level.js after the full pipeline.
 */
function ResolvePlayerState() {
	if (!playerState.active) return;
	if (playerState.state === "Dead") return;

	const speed = Math.sqrt(
		playerState.velocity.x * playerState.velocity.x +
		playerState.velocity.z * playerState.velocity.z
	);
	const oldState = playerState.state;

	// State transitions (priority order).
	if (playerState.state === "Stunned") return;

	if (playerState.underwater && playerState.state !== "Swimming") {
		// Sinking requires genuine ungrounded descent; grounded underwater = resting on floor = Floating.
		playerState.state = !playerState.grounded && playerState.velocity.y < 0 ? "Sinking" : "Floating";
	}
	else if (!playerState.grounded && playerState.state !== "Flying") {
		if (playerState.state === "Jumping") {
			const currentY = playerState.transform.position.y;
			playerState.jumpApexY.value = Math.max(playerState.jumpApexY.value, currentY);

			// Switch to Falling after descending below jump start height by 1 unit.
			if (currentY <= playerState.jumpStartY.value - 1) playerState.state = "Falling";
		}
		else playerState.state = "Falling";
	}
	else {
		// Grounded states.
		if      (playerState.boost.active)   playerState.state = "Boosting";
		else if (playerState.stoppingActive) playerState.state = "Stopping";
		else if (speed > 0.5)                playerState.state = "Running";
		else                                 playerState.state = "Idle";
	}

	// Log state transitions.
	if (oldState !== playerState.state) {
		Log("ENGINE", `Player state: ${oldState} → ${playerState.state}`, "log", "Player");
		playerState.previousState = oldState;
		if (playerState.customEvents.stateChange && CONFIG.CUSTOM_EVENTS.Entities.stateChange) {
			SendEvent("PLAYER_STATE_CHANGE", {
				id      : playerState.id,
				type    : playerState.type,
				position: CloneVector3(playerState.transform.position),
				velocity: CloneVector3(playerState.velocity),
				from    : oldState,
				to      : playerState.state,
			});
		}
	}
}

/**
 * Trigger the player death sequence.
 * Called by Enemy.js when player has no collectibles and takes damage.
 */
function TriggerPlayerDeath() {
	playerState.state = "Dead";
	playerState.stoppingActive = false;
	playerState.primaryOppositeHeld = false;
	playerState.velocity.set(ToVector3(0));
	Log("ENGINE", "Player death triggered.", "log", "Player");
}

function TriggerPlayerRespawnSequence() {
	if (playerState.state === "Dead") return;

	TriggerPlayerDeath();
	SendEvent("PLAYER_DEATH", {});

	setTimeout(() => RespawnPlayer(), 200);
}

/**
 * Respawn the player at checkpoint or spawn position.
 */
function RespawnPlayer() {
	const respawnPos = playerState.checkpoint
		? playerState.checkpoint.position
		: playerState.spawnPosition;

	playerState.transform.position.set(respawnPos);
	playerState.velocity.set(ToVector3(0));
	playerState.grounded = false;
	playerState.state = "Idle";
	playerState.jumpStartY.value = respawnPos.y;
	playerState.jumpApexY.value = respawnPos.y;
	playerState.attackFlag = false;
	playerState.hitboxActive = false;
	playerState.stoppingActive = false;
	playerState.primaryOppositeHeld = false;
	playerState.modelOpacity = 1.0;
	playerState.boost = { active: false, timer: 0, maxSpeedMultiplier: 1, accelMultiplier: 1 };
	playerState.invulnerable = { active: false, timer: 0, flashTimer: 0 };

	UpdatePlayerModel();
	UpdatePlayerCollision();
	Log("ENGINE", `Player respawned at (${respawnPos.x.toFixed(1)}, ${respawnPos.y.toFixed(1)}, ${respawnPos.z.toFixed(1)})`, "log", "Player");
}

function GetPlayerState() {
	return playerState;
}

function GetPlayerInput() {
	return playerInputFlags;
}

/* === ENGINE API === */
// Attached to ENGINE.Level.Player by ini.js.

const PlayerAPI = {
	Input   : playerInputFlags,
	GetState: GetPlayerState,
	SetPosition: (x, y, z) => {
		playerState.transform.position.set(ToVector3({ x, y, z }));
		playerState.velocity.set(ToVector3(0));
		playerState.jumpStartY.value = y;
		playerState.jumpApexY.value = y;
		UpdatePlayerCollision();
	},
};

/* === EXPORTS === */

export {
	PlayerAPI,
	InitializePlayer,
	UpdatePlayer,
	UpdatePlayerCollision,
	UpdatePlayerModel,
	ResolvePlayerState,
	TriggerPlayerDeath,
	TriggerPlayerRespawnSequence,
	RespawnPlayer,
	GetPlayerState,
	GetPlayerInput,
};
