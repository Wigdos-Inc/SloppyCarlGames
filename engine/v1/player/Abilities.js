// Tracking of and initiating ability usage

// Used by player/Master.js to process ability state each frame.

import { Log } from "../core/meta.js";
import { CONFIG } from "../core/config.js";

function toNumber(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Update ability systems: boost and invulnerability.
 *
 * Boost: temporarily increases max speed, acceleration, and sets attack flag.
 * Invulnerability: timer-based post-damage protection with model flashing.
 *
 * @param {object} playerState — full mutable player state.
 * @param {object} input — { boost: boolean }
 * @param {number} deltaSeconds
 */
function UpdateAbilities(playerState, input, deltaSeconds) {
	if (!playerState || !playerState.character) { return; }

	const dt = toNumber(deltaSeconds, 0);
	const char = playerState.character;

	// === BOOST SYSTEM ===
	if (!playerState.boost) {
		playerState.boost = {
			active: false,
			timer: 0,
			maxSpeedMultiplier: 1,
			accelMultiplier: 1,
		};
	}

	const boost = playerState.boost;

	// Activate boost.
	if (input && input.boost && !boost.active && playerState.state !== "Stunned" && playerState.state !== "Dead") {
		boost.active = true;
		boost.timer = toNumber(char.boostDuration, 1.5);
		boost.maxSpeedMultiplier = toNumber(char.boostMultiplier, 1.8);
		boost.accelMultiplier = toNumber(char.boostAccelMultiplier, 2.2);
		playerState.attackFlag = true;

		if (playerState.state !== "Jumping" && playerState.state !== "Falling") {
			playerState.previousState = playerState.state;
			playerState.state = "Boosting";
		}

		if (CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LOGGING && CONFIG.DEBUG.LOGGING.Channel && CONFIG.DEBUG.LOGGING.Channel.Level) {
			Log("ENGINE", `Player boost activated: duration=${boost.timer.toFixed(2)}s`, "log", "Level");
		}
	}

	// Tick boost timer.
	if (boost.active) {
		boost.timer -= dt;
		if (boost.timer <= 0) {
			boost.active = false;
			boost.timer = 0;
			boost.maxSpeedMultiplier = 1;
			boost.accelMultiplier = 1;
			playerState.attackFlag = false;

			if (playerState.state === "Boosting") {
				playerState.state = playerState.grounded ? "Idle" : "Falling";
			}

			if (CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL === true && CONFIG.DEBUG.LOGGING && CONFIG.DEBUG.LOGGING.Channel && CONFIG.DEBUG.LOGGING.Channel.Level) {
				Log("ENGINE", "Player boost deactivated.", "log", "Level");
			}
		}
	}

	// === INVULNERABILITY SYSTEM ===
	if (!playerState.invulnerable) {
		playerState.invulnerable = {
			active: false,
			timer: 0,
			flashTimer: 0,
		};
	}

	const invuln = playerState.invulnerable;

	if (invuln.active) {
		invuln.timer -= dt;
		invuln.flashTimer += dt;

		// Per-frame opacity flashing: alternate every 0.08 seconds.
		const flashCycle = 0.08;
		playerState.modelOpacity = (Math.floor(invuln.flashTimer / flashCycle) % 2 === 0) ? 1.0 : 0.3;

		if (invuln.timer <= 0) {
			invuln.active = false;
			invuln.timer = 0;
			invuln.flashTimer = 0;
			playerState.modelOpacity = 1.0;

			if (playerState.state === "Stunned") {
				playerState.state = playerState.grounded ? "Idle" : "Falling";
			}
		}
	}
}

/* === EXPORTS === */

export { UpdateAbilities };
