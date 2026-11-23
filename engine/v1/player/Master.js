// Tracks the entire player state.

// Used by handlers/game/Level.js to build the player and update it each frame.
// Used by core/ini.js to give the game the player API.
// Used by handlers/Controls.js, handlers/game/Enemy.js and physics/Master.js to kill and respawn the player.
// Used by camera/Modes.js to aim at the player's height.
// Uses player/Movement.js to move the player.
// Uses player/Model.js to build the player's model.
// Uses builder/NewEntity.js to re-pose the model and reset the input frame.

import { Log, SendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { Unit, UnitVector3 } from "../math/Utilities.js";
import { CloneVector3, RotateByEuler, ToVector3, WORLD_NORMALS } from "../math/Vector3.js";
import { NewInputFrame, UpdateEntityModel } from "../builder/NewEntity.js";
import { BuildPlayerModel } from "./Model.js";
import CharacterData from "./characters.json" with { type: "json" };
import { UpdateMovement, EndJump } from "./Movement.js";

/* === PLAYER INPUT FLAGS === */

let jumpHeld = false;
let jumpPressed = false;

// Input the game writes each frame through ENGINE.Level.Player.Input.
const playerInputFlags = {
	forward: 0,
	right: 0,
	get jump() { return jumpHeld; },
	set jump(held) {                                        // Latch a press at event time to catch taps between steps.
		if (held && !jumpHeld) jumpPressed = true;
		jumpHeld = held;
	},
};

// Take the latched jump press, clearing it.
function ConsumeJumpPress() {
	const pressed = jumpPressed;
	jumpPressed = false;
	return pressed;
}

/* === PLAYER STATE === */

let playerState = null;

// Promote an entity into a player by adding player-specific flags and fields.
function createDefaultPlayerState(baseEntity, playerData) {
	baseEntity.physics.collision.simRadiusPadding.value = 24;

	// Start with the player's hitbox off.
	baseEntity.combat.hitboxActive = false;

	// Add the player's own movement state next to its authored movement.
	Object.assign(baseEntity.movement, {
		jump     : {
			startY  : new Unit(playerData.spawnPosition.y, "cnu"),
			apexY   : new Unit(playerData.spawnPosition.y, "cnu"),
			distance: new UnitVector3(0, 0, 0, "cnu"),
			airTime : 0,
			window  : { buffer: 0, coyote: 0 },
		},
		braking  : { input: false, active: false },
		abilities: null,
	});

	return Object.assign(baseEntity, {
		character      : playerData.character,
		modelTurnRate  : {
			air  : baseEntity.modelTurnRate.air,
			water: new Unit(baseEntity.modelTurnRate.water.toRadians() * playerData.character.meta.underwaterAirControl, "radians"),
		},
		collectibles   : playerData.collectibles,
		maxCollectibles: 100,
		activeTriggers : [],
		spawnPosition  : {
			start     : playerData.spawnPosition.clone(),
			checkpoint: playerData.spawnPosition.clone(),
		},
	});
}

// Initialize the player entity for a level.
function InitializePlayer(payload, sceneGraph) {
	const characterProfile = CharacterData[payload.character];
	const hasCustomParts = payload.modelParts.length > 0;
	const { list: metaOverrideList, ...metaOverrides } = payload.metaOverrides;
	const effectiveCharacter = {
		...characterProfile,
		id   : `player.${payload.character}`,
		meta : { ...characterProfile.meta, ...metaOverrides },
		model: hasCustomParts ? { ...characterProfile.model, parts: payload.modelParts } : characterProfile.model,
	};

	// Log meta overrides using the normalized, formatted list from the payload.
	Log("ENGINE", `Player meta overrides applied:\n- ${metaOverrideList.join('\n- ')}`, "log", "Player");

	// Assemble as an entity, then extend it.
	const { rootTransform, spawnSurfaceId, customEvents, animations } = payload;
	const baseEntity = BuildPlayerModel(effectiveCharacter, { rootTransform, spawnSurfaceId, customEvents, animations }, sceneGraph.surfaces.spawn);

	// Respawns return to the authored point, in world space.
	const spawnPosition = payload.rootTransform.position.clone().add(baseEntity.model.surfacePosition);

	// Keep only the character fields the player reads at runtime.
	const { id, name, meta } = effectiveCharacter;
	playerState = createDefaultPlayerState(baseEntity, {
		character   : { id, name, meta },
		spawnPosition,
		collectibles: payload.collectibles,
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
			- Character: "${effectiveCharacter.name}" 
			- Source: "${sourceType}" at (${spawnPosition.x}, ${spawnPosition.y}, ${spawnPosition.z}) surface=${payload.spawnSurfaceId}
		`, 
		"log", 
		"Player"
	);
	return playerState;
}

// Update the player for this frame.
function UpdatePlayer(deltaSeconds, modeData) {
	if (playerState.action === "Dead") return playerState;

	// Movement (reads input, modifies velocity).
	UpdateMovement(playerState, playerInputFlags, modeData, deltaSeconds);

	return playerState;
}

// Re-pose the model from the player's transform and recompute its collision bounds.
function UpdatePlayerModel() {
	UpdateEntityModel(playerState);
	return playerState;
}

// Updates & logs playerState.action
function SetPlayerAction(action) {
	const lastAction = playerState.action;
	if (action === lastAction) return;

	playerState.action = action;

	Log("ENGINE", `Player action: ${lastAction} → ${action}`, "log", "Player");

	if (playerState.customEvents.actionChange && CONFIG.CustomEvents.Entities.ActionChange) {
		SendEvent("PLAYER_ACTION_CHANGE", {
			id        : playerState.id,
			type      : playerState.type,
			position  : CloneVector3(playerState.transform.position),
			velocity  : CloneVector3(playerState.velocity),
			lastAction, action,
		});
	}
}

// Pick the player's action once physics, collision and damage have run.
function ResolvePlayerState() {
	if (playerState.action === "Dead" || playerState.action === "Stunned") return;

	if (playerState.physics.correction.surfaceContact === "sliding") SetPlayerAction("Sliding");
	else if (playerState.physics.medium === "Water" && playerState.action !== "Swimming") {
		SetPlayerAction(!playerState.physics.grounded && playerState.velocity.y < 0 ? "Sinking" : "Floating");
	}
	else if (!playerState.physics.grounded && playerState.action !== "Flying") {
		if (playerState.action === "Jumping") {
			// Switch to Falling after descending below jump start height by 1 unit.
			if (playerState.transform.position.y <= playerState.movement.jump.startY.value - 1) SetPlayerAction("Falling");
		}
		else SetPlayerAction("Falling");
	}
	else {
		// Grounded actions.
		const speed = Math.sqrt(playerState.velocity.x * playerState.velocity.x + playerState.velocity.z * playerState.velocity.z);
		SetPlayerAction(playerState.movement.braking.active ? "Stopping" : speed > 0.5 ? "Running" : "Idle");
	}
}

// Kill the player and stop all its motion.
function KillPlayer() {
	EndJump(playerState);
	SetPlayerAction("Dead");
	playerState.movement.braking.active = false;
	playerState.movement.braking.input  = false;
	playerState.velocity.set(ToVector3(0));
	Log("ENGINE", "Player death triggered.", "log", "Player");
}

// Kill the player and respawn it shortly after.
function TriggerPlayerDeath() {
	if (playerState.action === "Dead") return;

	KillPlayer();
	SendEvent("PLAYER_DEATH", {});

	setTimeout(() => RespawnPlayer(), 200);
}

// Snap upright on a teleport
// Note: an eased pose would hang mid-air at the destination.
function snapOrientationUpright() {
	playerState.physics.correction.alignedUp = CloneVector3(WORLD_NORMALS.Up);
	playerState.physics.correction.referenceNormal = CloneVector3(WORLD_NORMALS.Up);
	playerState.physics.correction.contactGrace = 0;
	playerState.physics.slopes.gripDemand = 0;
	playerState.transform.rotation.set({ x: 0, y: playerState.transform.rotation.y, z: 0 });
	playerState.display.animationRuntime.modelPose.rotation.set(playerState.transform.rotation);
}

// Respawn the player at their spawn- or checkpoint
function RespawnPlayer() {
	const respawnPos = playerState.spawnPosition.checkpoint;

	playerState.transform.position.set(respawnPos);
	playerState.velocity.set(ToVector3(0));
	SetPlayerAction("Idle");
	playerState.movement.jump.startY.value = respawnPos.y;
	playerState.movement.jump.apexY.value  = respawnPos.y;
	playerState.movement.jump.window       = { buffer: 0, coyote: 0 };
	playerState.physics.launched = false;
	jumpPressed = false;
	playerState.combat.hitboxActive = false;
	playerState.movement.braking.active = false;
	playerState.movement.braking.input  = false;
	snapOrientationUpright();
	playerState.facing = RotateByEuler(WORLD_NORMALS.Forward, playerState.transform.rotation);
	playerState.physics.slopes = { gravityScale: 1, staticFriction: 0, isInLoop: false, isCoasting: false, gripDemand: 0 };
	playerState.inputFrame = NewInputFrame();
	playerState.combat.invulnerable = { active: false, timer: 0, flashTimer: 0 };

	UpdatePlayerModel();
	Log("ENGINE", `Player respawned at (${respawnPos.x.toFixed(1)}, ${respawnPos.y.toFixed(1)}, ${respawnPos.z.toFixed(1)})`, "log", "Player");
}

const GetPlayerState = () => playerState;
const GetPlayerInput = () => playerInputFlags;
const PlayerHeight = (playerState) => new Unit((playerState.physics.collision.rest.aabb.max.y - playerState.physics.collision.rest.aabb.min.y) * playerState.transform.scale.y, "cnu");

/* === ENGINE API === */

// The player API the game reaches through ENGINE.Level.Player.
const PlayerAPI = {
	Input      : playerInputFlags,
	GetState   : GetPlayerState,
	SetPosition: (v) => {
		EndJump(playerState);
		playerState.transform.position.set(v);
		playerState.velocity.set(ToVector3(0));
		playerState.movement.jump.startY.value = v.y;
		playerState.movement.jump.apexY.value  = v.y;
		snapOrientationUpright();
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
	ConsumeJumpPress,
	KillPlayer,
	TriggerPlayerDeath,
	RespawnPlayer,
	GetPlayerState,
	GetPlayerInput,
	PlayerHeight,
};
