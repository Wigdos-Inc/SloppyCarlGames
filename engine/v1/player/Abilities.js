// Tracking of and initiating ability usage

// Used by player/Master.js to process ability state each frame.

import { Log } from "../core/meta.js";
import { CONFIG } from "../core/config.js";
import { ToNumber } from "../math/Utilities.js";

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
	const dt = ToNumber(deltaSeconds, 0);
	const char = playerState.character;
	const meta = char && char.meta ? char.meta : {};

	// === BOOST SYSTEM ===
	const boost = playerState.boost;

	// Activate boost.
	if (input && input.boost && !boost.active && playerState.state !== "Stunned" && playerState.state !== "Dead") {
		boost.active = true;
		boost.timer = ToNumber(meta.boostDuration, 1.5);
		boost.maxSpeedMultiplier = ToNumber(meta.boostMultiplier, 1.8);
		boost.accelMultiplier = ToNumber(meta.boostAccelMultiplier, 2.2);
		playerState.attackFlag = true;

		if (playerState.state !== "Jumping" && playerState.state !== "Falling") {
			playerState.previousState = playerState.state;
			playerState.state = "Boosting";
		}

		Log("ENGINE", `Player boost activated: duration=${boost.timer.toFixed(2)}s`, "log", "Level");
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

			Log("ENGINE", "Player boost deactivated.", "log", "Level");
		}
	}

	// === INVULNERABILITY SYSTEM ===
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
