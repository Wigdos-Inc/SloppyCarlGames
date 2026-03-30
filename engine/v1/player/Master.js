// Tracks the entire player state.

// Used by handlers/game/Level.js as the per-frame player update orchestrator.
// Uses all player modules: Movement.js, Abilities.js, Model.js.

import { Log } from "../core/meta.js";
import { ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";
import { BuildPlayerModel, InitializePlayerCollisionProfile, SyncPlayerCollisionFromState, UpdatePlayerModelFromState } from "./Model.js";
import { UpdateMovement } from "./Movement.js";
import characterData from "./characters.json" with { type: "json" };

/* === PLAYER INPUT FLAGS === */
// Mutable object exposed as ENGINE.Player.Input.
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
	const character = playerData.character;
	const spawnPos = playerData.spawnPosition;
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
		radius: new Unit(ToNumber(playerData.collisionRadius, character.meta.collisionRadius), "cnu"),
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
		character: character,
		model: BuildPlayerModel(character, spawnPos),
		transform: {
			position: spawnPos,
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: playerData.scale,
		},
		velocity: new UnitVector3(0, 0, 0, "cnu"),
		grounded: false,
		underwater: false,
		surfaceNormal: { x: 0, y: 1, z: 0 },
		alignedUp: { x: 0, y: 1, z: 0 },
		jumpStartY: new Unit(spawnPos.y, "cnu"),
		jumpApexY: new Unit(spawnPos.y, "cnu"),
		stoppingActive: false,
		primaryOppositeHeld: false,
		state: "Idle",
		previousState: "Idle",
		hp: 3,
		collectibles: playerData.collectibles || 0,
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
		spawnPosition: spawnPos,
		physicsRuntime: {
			previousPosition: spawnPos.clone(),
			previousRotation: new UnitVector3(0, 0, 0, "radians"),
			hasUnresolvedPenetration: false,
			cachePrimed: false,
		},
		collision: collision,
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
function InitializePlayer(payload, sceneGraph) {
	const characterProfile = characterData[payload.character] || characterData.carl;
	const hasCustomParts = payload.modelParts.length > 0;
	const mergedMeta = {
		...characterProfile.meta,
		...(payload.metaOverrides || {}),
	};
	const effectiveCharacter = {
		...characterProfile,
		meta: mergedMeta,
		model: hasCustomParts
			? { ...characterProfile.model, parts: payload.modelParts }
			: characterProfile.model,
	};

	// Log meta overrides using the normalized, formatted list from the payload.
	Log("ENGINE", `Player meta overrides applied:\n- ${payload.metaOverrides.list.join('\n- ')}`, "log", "Player");

	const spawnPos = payload.spawnPosition;
	const collectibles = ToNumber(payload.collectibles, 0);

	// Build Player State & Model
	playerState = createDefaultPlayerState({
		character: effectiveCharacter,
		spawnPosition: spawnPos, 
		scale: payload.scale,
		collectibles: collectibles,
		collisionRadius: effectiveCharacter.meta.collisionRadius
	});
	InitializePlayerCollisionProfile(playerState);
	SyncPlayerCollisionFromState(playerState);
	UpdatePlayerModelFromState(playerState);

	// Insert player as entity into sceneGraph for rendering.
	sceneGraph.player = playerState;
	// Also place in entities array so the renderer and bounding box system see it.
	sceneGraph.entities.push(playerState);

	const sourceType = hasCustomParts
		? "custom-model"
		: (characterData[payload.character] ? "profile" : "fallback");

	Log("ENGINE", `Player initialized: character="${effectiveCharacter.name}" source="${sourceType}" at (${spawnPos.x}, ${spawnPos.y}, ${spawnPos.z})`, "log", "Player");
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
	if (!playerState.active) { return null; }
	if (playerState.state === "Dead") { return playerState; }

	const dt = ToNumber(deltaSeconds, 0);
	const input = playerInputFlags;

	// Step 1–2: Movement (reads input, modifies velocity).
	UpdateMovement(playerState, input, cameraVectors, dt);

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
	if (!playerState.active) { return; }
	if (playerState.state === "Dead") { return; }

	const speed = Math.sqrt(
		playerState.velocity.x * playerState.velocity.x +
		playerState.velocity.z * playerState.velocity.z
	);
	const movementThreshold = 0.5;
	const oldState = playerState.state;

	// State transitions (priority order).
	if (playerState.state === "Stunned") {
		// Stay stunned until invulnerability system clears it (in Abilities.js).
		return;
	}

	if (!playerState.grounded) {
		if (playerState.state === "Jumping") {
			const currentY = ToNumber(playerState.transform.position.y, 0);
			playerState.jumpApexY.value = Math.max(playerState.jumpApexY.value, currentY);

			// Stay Jumping through ascent and early descent; switch to Falling
			// only after descending below jump start height by 1 unit.
			if (currentY <= playerState.jumpStartY.value - 1) playerState.state = "Falling";
		} else playerState.state = "Falling";
	} else {
		// Grounded states.
		if (playerState.boost.active) playerState.state = "Boosting";
		else if (playerState.stoppingActive) playerState.state = "Stopping";
		else if (speed > movementThreshold) playerState.state = "Running";
		else playerState.state = "Idle";
	}

	// Log state transitions.
	if (oldState !== playerState.state) {
		Log("ENGINE", `Player state: ${oldState} → ${playerState.state}`, "log", "Player");
		playerState.previousState = oldState;
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
	playerState.velocity.set({ x: 0, y: 0, z: 0 });
	Log("ENGINE", "Player death triggered.", "log", "Player");
}

/**
 * Respawn the player at checkpoint or spawn position.
 */
function RespawnPlayer() {
	const respawnPos = playerState.checkpoint
		? playerState.checkpoint.position
		: playerState.spawnPosition;

	playerState.transform.position.set(respawnPos);
	playerState.velocity.set({ x: 0, y: 0, z: 0 });
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

/* === EXPORTS === */

export {
	InitializePlayer,
	UpdatePlayer,
	UpdatePlayerCollision,
	UpdatePlayerModel,
	ResolvePlayerState,
	TriggerPlayerDeath,
	RespawnPlayer,
	GetPlayerState,
	GetPlayerInput,
};
