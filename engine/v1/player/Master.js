// Tracks the entire player state.

// Used by handlers/game/Level.js as the per-frame player update orchestrator.
// Uses all player modules: Movement.js, Abilities.js, Model.js.

import { Log, SendEvent } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { Unit } from "../math/Utilities.js";
import { CloneVector3, RotateByEuler, ToVector3, WORLD_NORMALS } from "../math/Vector3.js";
import { NewInputFrame } from "../builder/NewEntity.js";
import { BuildPlayerModel, RefreshPlayerModel } from "./Model.js";
import CharacterData from "./characters.json" with { type: "json" };
import { UpdateMovement } from "./Movement.js";

/* === PLAYER INPUT FLAGS === */
// Mutable object exposed as ENGINE.Level.Player.Input.
// Game code writes to this directly each frame.

let jumpHeld = false;
let jumpPressed = false;

const playerInputFlags = {
	forward: 0,
	right: 0,
	// Latches the press at event time so taps between steps still register.
	get jump() { return jumpHeld; },
	set jump(held) {
		if (held && !jumpHeld) jumpPressed = true;
		jumpHeld = held;
	},
	boost: false,
};

const ConsumeJumpPress = () => {
	const pressed = jumpPressed;
	jumpPressed = false;
	return pressed;
};

/* === PLAYER STATE === */

let playerState = null;

/**
 * Promote an entity into a player by adding player-specific flags and fields.
 * @param {object} baseEntity — the entity assembled by Model.js.
 * @param {object} playerData — { character, spawnPosition, collectibles }.
 */
function createDefaultPlayerState(baseEntity, playerData) {
	// Increased simRadius for the player compared to other entities.
	baseEntity.collision.simRadiusPadding.value = 24;

	return Object.assign(baseEntity, {
		active             : true,
		character          : playerData.character,
		modelTurnRate      : {
			air  : baseEntity.modelTurnRate.air,
			water: new Unit(baseEntity.modelTurnRate.water.toRadians() * playerData.character.meta.underwaterAirControl, "radians"),
		},
		jumpStartY         : new Unit(playerData.spawnPosition.y, "cnu"),
		jumpApexY          : new Unit(playerData.spawnPosition.y, "cnu"),
		jumpWindow         : { buffer: 0, coyote: 0 },
		stoppingActive     : false,
		primaryOppositeHeld: false,
		lastAction         : "Idle",
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
 * @param {object} payload — { rootTransform, spawnSurfaceId, character, modelParts, collectibles }
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
	const { rootTransform, spawnSurfaceId, customEvents, animations } = payload;
	const baseEntity = await BuildPlayerModel(effectiveCharacter, {
		rootTransform, spawnSurfaceId, customEvents, animations, hasCustomParts,
	}, sceneGraph.spawnSurfaces);

	// Respawns return to the authored point, in world space.
	const spawnPosition = payload.rootTransform.position.clone().add(baseEntity.model.surfacePosition);
	playerState = createDefaultPlayerState(baseEntity, {
		character   : effectiveCharacter,
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
			- Character="${effectiveCharacter.name}" 
			- Source="${sourceType}" at (${spawnPosition.x}, ${spawnPosition.y}, ${spawnPosition.z}) surface=${payload.spawnSurfaceId}
		`, 
		"log", 
		"Player"
	);
	return playerState;
}

// Per-frame player update: movement now, abilities once they exist.
function UpdatePlayer(deltaSeconds, modeData) {
	if (!playerState.active) return null;
	if (playerState.action === "Dead") return playerState;

	// Movement (reads input, modifies velocity).
	UpdateMovement(playerState, playerInputFlags, modeData, deltaSeconds);

	return playerState;
}

/**
 * Re-pose the model from the player's transform and recompute its derived collision bounds.
 */
function UpdatePlayerModel() {
	RefreshPlayerModel(playerState);
	return playerState;
}

// Updates & logs playerState.action
function SetPlayerAction(action) {
	const lastAction = playerState.action;
	if (action === lastAction) return;

	playerState.lastAction = lastAction;
	playerState.action     = action;

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

/**
 * Resolve the player state machine after all physics/collision/damage have been applied.
 * Called from Level.js after the full pipeline.
 */
function ResolvePlayerState() {
	if (!playerState.active || playerState.action === "Dead" || playerState.action === "Stunned") return;


	if (playerState.surfaceContact === "sliding") SetPlayerAction("Sliding");
	else if (playerState.underwater && playerState.action !== "Swimming") {
		// Sinking requires genuine ungrounded descent; grounded underwater = resting on floor = Floating.
		SetPlayerAction(!playerState.grounded && playerState.velocity.y < 0 ? "Sinking" : "Floating");
	}
	else if (!playerState.grounded && playerState.action !== "Flying") {
		if (playerState.action === "Jumping") {
			playerState.jumpApexY.math(Math.max, playerState.transform.position.y);

			// Switch to Falling after descending below jump start height by 1 unit.
			if (playerState.transform.position.y <= playerState.jumpStartY.value - 1) SetPlayerAction("Falling");
		}
		else SetPlayerAction("Falling");
	}
	else {
		// Grounded actions.
		const speed = Math.sqrt(playerState.velocity.x * playerState.velocity.x + playerState.velocity.z * playerState.velocity.z);
		SetPlayerAction(playerState.stoppingActive ? "Stopping" : speed > 0.5 ? "Running" : "Idle");
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

// Teleports snap upright; an eased pose would hang mid-air at the destination.
function snapOrientationUpright() {
	playerState.alignedUp = CloneVector3(WORLD_NORMALS.Up);
	playerState.referenceNormal = CloneVector3(WORLD_NORMALS.Up);
	playerState.contactGrace = 0;
	playerState.gripDemand = 0;
	playerState.transform.rotation.set({ x: 0, y: playerState.transform.rotation.y, z: 0 });
	playerState.animationRuntime.modelPose.rotation.set(playerState.transform.rotation);
}

/**
 * Respawn the player at checkpoint or spawn position.
 */
function RespawnPlayer() {
	const respawnPos = playerState.checkpoint ? playerState.checkpoint.position : playerState.spawnPosition;

	playerState.transform.position.set(respawnPos);
	playerState.velocity.set(ToVector3(0));
	SetPlayerAction("Idle");
	playerState.jumpStartY.value = respawnPos.y;
	playerState.jumpApexY.value = respawnPos.y;
	playerState.jumpWindow = { buffer: 0, coyote: 0 };
	playerState.launched = false;
	jumpPressed = false;
	playerState.attackFlag = false;
	playerState.hitboxActive = false;
	playerState.stoppingActive = false;
	playerState.primaryOppositeHeld = false;
	playerState.modelOpacity = 1.0;
	snapOrientationUpright();
	playerState.facing = RotateByEuler(WORLD_NORMALS.Forward, playerState.transform.rotation);
	playerState.gravityScale = 1;
	playerState.dragFree = false;
	playerState.staticFriction = 0;
	playerState.inputFrame = NewInputFrame();
	playerState.boost = { active: false, timer: 0, maxSpeedMultiplier: 1, accelMultiplier: 1 };
	playerState.invulnerable = { active: false, timer: 0, flashTimer: 0 };

	UpdatePlayerModel();
	Log("ENGINE", `Player respawned at (${respawnPos.x.toFixed(1)}, ${respawnPos.y.toFixed(1)}, ${respawnPos.z.toFixed(1)})`, "log", "Player");
}

const GetPlayerState = () => playerState;
const GetPlayerInput = () => playerInputFlags;
const PlayerHeight = (playerState) => new Unit((playerState.collision.rest.aabb.max.y - playerState.collision.rest.aabb.min.y) * playerState.transform.scale.y, "cnu");

/* === ENGINE API === */
// Attached to ENGINE.Level.Player by ini.js.

const PlayerAPI = {
	Input      : playerInputFlags,
	GetState   : GetPlayerState,
	SetPosition: (v) => {
		playerState.transform.position.set(v);
		playerState.velocity.set(ToVector3(0));
		playerState.jumpStartY.value = v.y;
		playerState.jumpApexY.value = v.y;
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
	TriggerPlayerDeath,
	TriggerPlayerRespawnSequence,
	RespawnPlayer,
	GetPlayerState,
	GetPlayerInput,
	PlayerHeight,
};
