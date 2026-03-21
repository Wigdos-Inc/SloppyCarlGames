// Tracks the entire player state.

// Used by handlers/game/Level.js as the per-frame player update orchestrator.
// Uses all player modules: Movement.js, Abilities.js, Model.js.

import { NormalizeVector3 } from "../math/Vector3.js";
import { Log } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { ToNumber, Unit, UnitVector3 } from "../math/Utilities.js";
import { BuildPlayerModel, UpdatePlayerModelFromState } from "./Model.js";
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
	return {
		active: true,
		character: character,
		model: BuildPlayerModel(character, spawnPos),
		transform: {
			position: spawnPos,
			rotation: new UnitVector3(0, 0, 0, "radians"),
			scale: playerData.scale,
		},
		velocity: new UnitVector3(0, 0, 0, "CNU"),
		grounded: false,
		underwater: false,
		surfaceNormal: { x: 0, y: 1, z: 0 },
		alignedUp: { x: 0, y: 1, z: 0 },
		jumpStartY: new Unit(spawnPos.y, "cnu"),
		jumpApexY: new Unit(spawnPos.y, "cnu"),
		state: "Idle",
		previousState: "Idle",
		hp: 3,
		collectibles: playerData.collectibles || 0,
		maxCollectibles: 100,
		attackFlag: false,
		modelOpacity: 1.0,
		abilities: null,
		invulnerable: {
			active: false,
			timer: 0,
			flashTimer: 0,
		},
		activeTriggers: [],
		checkpoint: null,
		spawnPosition: spawnPos,
		collision: {
			aabb: { min: new UnitVector3(0, 0, 0, "CNU"), max: new UnitVector3(0, 0, 0, "CNU") },
			radius: new Unit(ToNumber(playerData.collisionRadius, character.meta.collisionRadius)),
			simRadiusPadding: 24,
			simRadiusAabb: { min: new UnitVector3(0, 0, 0, "CNU"), max: new UnitVector3(0, 0, 0, "CNU") },
		},
		mesh: null,
		type: "player",
		id: "player",
	};
}

/**
 * Initialize the player entity for a level.
 * @param {object} payload — { spawnPosition, character, collectibles }
 * @param {object} sceneGraph — the active scene graph.
 * @returns {object} — the initialized playerState.
 */
function InitializePlayer(payload, sceneGraph) {
	const character = characterData[payload.character];
	const spawnPos = payload.spawnPosition;
	const collectibles = ToNumber(payload.collectibles, 0);

	// Build Player State & Model
	playerState = createDefaultPlayerState({
		character: character, 
		spawnPosition: spawnPos, 
		scale: payload.scale,
		collectibles: collectibles,
		collisionRadius: character.meta.collisionRadius
	});
	UpdatePlayerModelFromState(playerState);

	// Insert player as entity into sceneGraph for rendering.
	sceneGraph.player = playerState;
	// Also place in entities array so the renderer and bounding box system see it.
	sceneGraph.entities.push(playerState);

	Log("ENGINE", `Player initialized: character="${character.name}" at (${spawnPos.x}, ${spawnPos.y}, ${spawnPos.z})`, "log", "Level");
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
 * @param {object} sceneGraph
 * @param {{ forward, right }} cameraVectors — camera orientation for relative movement.
 * @returns {object|null} — updated playerState, or null if no player.
 */
function UpdatePlayer(deltaSeconds, sceneGraph, cameraVectors) {
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
		if (playerState.boost && playerState.boost.active) playerState.state = "Boosting";
		else if (speed > movementThreshold) playerState.state = "Running";
		else playerState.state = "Idle";
	}

	// Log state transitions.
	if (oldState !== playerState.state) {
		Log("ENGINE", `Player state: ${oldState} → ${playerState.state}`, "log", "Level");
		playerState.previousState = oldState;
	}
}

/**
 * Trigger the player death sequence.
 * Called by Enemy.js when player has no collectibles and takes damage.
 */
function TriggerPlayerDeath() {
	playerState.state = "Dead";
	playerState.velocity.set({ x: 0, y: 0, z: 0 });
	Log("ENGINE", "Player death triggered.", "log", "Level");
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
	playerState.modelOpacity = 1.0;
	playerState.boost = { active: false, timer: 0, maxSpeedMultiplier: 1, accelMultiplier: 1 };
	playerState.invulnerable = { active: false, timer: 0, flashTimer: 0 };

	UpdatePlayerModelFromState(playerState);
	Log("ENGINE", `Player respawned at (${respawnPos.x.toFixed(1)}, ${respawnPos.y.toFixed(1)}, ${respawnPos.z.toFixed(1)})`, "log", "Level");
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
	ResolvePlayerState,
	TriggerPlayerDeath,
	RespawnPlayer,
	GetPlayerState,
	GetPlayerInput,
};
