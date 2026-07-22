// Tracks the entire player state.

// Used by handlers/game/Level.js as the per-frame player update orchestrator.
// Uses all player modules: Movement.js, Abilities.js, Model.js.

import { Log, SendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { Unit } from "../math/Utilities.js";
import { CloneVector3, ToVector3, WORLD_NORMALS } from "../math/Vector3.js";
import { CharacterData, BuildPlayerModel, RefreshPlayerModel } from "./Model.js";
import { UpdateMovement } from "./Movement.js";

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

/**
 * Prompte an entity into a player by adding player-specific flags and fields.
 * @param {object} baseEntity — the entity assembled by Model.js.
 * @param {object} playerData — { character, spawnPosition, collectibles }.
 */
function createDefaultPlayerState(baseEntity, playerData) {
	// The player outruns every other entity, so it broadphases against a wider radius than the
	// builder's entity default.
	baseEntity.collision.simRadiusPadding.value = 24;

	return Object.assign(baseEntity, {
		active             : true,
		character          : playerData.character,
		grounded           : false,
		surfaceNormal      : CloneVector3(WORLD_NORMALS.Up),
		alignedUp          : CloneVector3(WORLD_NORMALS.Up),
		jumpStartY         : new Unit(playerData.spawnPosition.y, "cnu"),
		jumpApexY          : new Unit(playerData.spawnPosition.y, "cnu"),
		stoppingActive     : false,
		primaryOppositeHeld: false,
		action             : "Idle",
		previousAction     : "Idle",
		collectibles       : playerData.collectibles,
		maxCollectibles    : 100,
		attackFlag         : false,
		hitboxActive       : false,
		modelOpacity       : 1.0,
		abilities          : null,
		boost              : {
			active            : false,
			timer             : 0,
			maxSpeedMultiplier: 1,
			accelMultiplier   : 1,
		},
		invulnerable: {
			active    : false,
			timer     : 0,
			flashTimer: 0,
		},
		activeTriggers: [],
		checkpoint    : null,
		spawnPosition : playerData.spawnPosition.clone(),
	});
}

/**
 * Initialize the player entity for a level.
 * @param {object} payload — { spawnPosition, character, modelParts, collectibles }
 * @param {object} sceneGraph — the active scene graph.
 * @returns {object} — the initialized playerState.
 */
async function InitializePlayer(payload, sceneGraph) {
	const characterProfile = CharacterData[payload.character];
	const hasCustomParts = payload.modelParts.length > 0;
	const { list: metaOverrideList, ...metaOverrides } = payload.metaOverrides;
	const effectiveCharacter = {
		...characterProfile,
		meta: { ...characterProfile.meta, ...metaOverrides },
		model: hasCustomParts ? { ...characterProfile.model, parts: payload.modelParts } : characterProfile.model,
	};

	// Log meta overrides using the normalized, formatted list from the payload.
	Log("ENGINE", `Player meta overrides applied:\n- ${metaOverrideList.join('\n- ')}`, "log", "Player");

	// Assemble as an entity, then extend it.
	const baseEntity = await BuildPlayerModel(effectiveCharacter, {
		spawnPosition : payload.spawnPosition,
		scale         : payload.scale,
		customEvents  : payload.customEvents,
		animations    : payload.animations,
		hasCustomParts,
	});

	playerState = createDefaultPlayerState(baseEntity, {
		character    : effectiveCharacter,
		spawnPosition: payload.spawnPosition,
		collectibles : payload.collectibles,
	});

	// Re-derive bounds to apply widened sim-radius.
	UpdatePlayerModel();

	// Insert player as entity into sceneGraph for rendering.
	sceneGraph.player = playerState;
	// Place entities in array so the renderer and bounding box system see it.
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
	if (playerState.action === "Dead") return playerState;

	// Step 1–2: Movement (reads input, modifies velocity).
	UpdateMovement(playerState, playerInputFlags, cameraVectors, deltaSeconds);

	// Step 3: Ability updates (not implemented).

	// Steps 4–8 run from Level.js after this returns:
	// Physics.ApplyPhysicsPipeline → Enemy → Collectible → state machine → model sync.

	return playerState;
}

/**
 * Re-pose the model from the player's transform and recompute its derived collision bounds.
 */
function UpdatePlayerModel() {
	RefreshPlayerModel(playerState);
	return playerState;
}

/**
 * Central authority for player action transitions. All writes to playerState.action must go
 * through this so the log and (optional) event are guaranteed to fire consistently.
 * No-ops if newAction matches the current action.
 */
function SetPlayerAction(newAction) {
	const oldAction = playerState.action;
	if (newAction === oldAction) return;

	playerState.previousAction = oldAction;
	playerState.action = newAction;

	Log("ENGINE", `Player action: ${oldAction} → ${newAction}`, "log", "Player");

	if (playerState.customEvents.actionChange && CONFIG.CUSTOM_EVENTS.Entities.actionChange) {
		SendEvent("PLAYER_ACTION_CHANGE", {
			id      : playerState.id,
			type    : playerState.type,
			position: CloneVector3(playerState.transform.position),
			velocity: CloneVector3(playerState.velocity),
			from    : oldAction,
			to      : newAction,
		});
	}
}

/**
 * Resolve the player state machine after all physics/collision/damage have been applied.
 * Called from Level.js after the full pipeline.
 */
function ResolvePlayerState() {
	if (!playerState.active)           return;
	if (playerState.action === "Dead") return;

	const speed = Math.sqrt(playerState.velocity.x * playerState.velocity.x + playerState.velocity.z * playerState.velocity.z);

	// Action transitions (priority order).
	if (playerState.action === "Stunned") return;

	if (playerState.underwater && playerState.action !== "Swimming") {
		// Sinking requires genuine ungrounded descent; grounded underwater = resting on floor = Floating.
		SetPlayerAction(!playerState.grounded && playerState.velocity.y < 0 ? "Sinking" : "Floating");
	}
	else if (!playerState.grounded && playerState.action !== "Flying") {
		if (playerState.action === "Jumping") {
			playerState.jumpApexY.value = Math.max(playerState.jumpApexY.value, playerState.transform.position.y);

			// Switch to Falling after descending below jump start height by 1 unit.
			if (playerState.transform.position.y <= playerState.jumpStartY.value - 1) SetPlayerAction("Falling");
		}
		else SetPlayerAction("Falling");
	}
	else {
		// Grounded actions.
		if (playerState.stoppingActive) SetPlayerAction("Stopping");
		else if (speed > 0.5)           SetPlayerAction("Running");
		else                            SetPlayerAction("Idle");
	}
}

/**
 * Trigger the player death sequence.
 * Called by Enemy.js when player has no collectibles and takes damage.
 */
function TriggerPlayerDeath() {
	SetPlayerAction("Dead");
	playerState.stoppingActive = false;
	playerState.primaryOppositeHeld = false;
	playerState.velocity.set(ToVector3(0));
	Log("ENGINE", "Player death triggered.", "log", "Player");
}

function TriggerPlayerRespawnSequence() {
	if (playerState.action === "Dead") return;

	TriggerPlayerDeath();
	SendEvent("PLAYER_DEATH", {});

	setTimeout(() => RespawnPlayer(), 200);
}

/**
 * Respawn the player at checkpoint or spawn position.
 */
function RespawnPlayer() {
	const respawnPos = playerState.checkpoint ? playerState.checkpoint.position : playerState.spawnPosition;

	playerState.transform.position.set(respawnPos);
	playerState.velocity.set(ToVector3(0));
	playerState.grounded = false;
	SetPlayerAction("Idle");
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
	Log("ENGINE", `Player respawned at (${respawnPos.x.toFixed(1)}, ${respawnPos.y.toFixed(1)}, ${respawnPos.z.toFixed(1)})`, "log", "Player");
}

const GetPlayerState = () => playerState;
const GetPlayerInput = () => playerInputFlags;

/* === ENGINE API === */
// Attached to ENGINE.Level.Player by ini.js.

const PlayerAPI = {
	Input      : playerInputFlags,
	GetState   : GetPlayerState,
	SetPosition: (x, y, z) => {
		playerState.transform.position.set({ x, y, z });
		playerState.velocity.set(ToVector3(0));
		playerState.jumpStartY.value = y;
		playerState.jumpApexY.value = y;
		UpdatePlayerModel();
	},
};

/* === EXPORTS === */

export {
	PlayerAPI,
	InitializePlayer,
	UpdatePlayer,
	UpdatePlayerModel,
	ResolvePlayerState,
	SetPlayerAction,
	TriggerPlayerDeath,
	TriggerPlayerRespawnSequence,
	RespawnPlayer,
	GetPlayerState,
	GetPlayerInput,
};
