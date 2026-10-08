// Startup splash: the engine's CarlNet screen, then the Super Shitty Studios logo with its jingle.
import { AssetUrl, AudioDuration, CropUrl } from "./assets.js";

// A custom sequence can't reference built-in presets, so the CarlNet step mirrors the engine's own
// (same files and timings as handlers/menu/Splash.js's built-in "carlnet").
const ENGINE_ASSETS = new URL("../../../engine/v1/assets/engine/", import.meta.url);
const carlNet = {
	name: "CarlNet Engine",
	image: new URL("carlNetEngine.png", ENGINE_ASSETS).href,
	voice: { src: new URL("carlNetEngine.mp3", ENGINE_ASSETS).href, id: "CARLNET_ENGINE" },
	voiceAtStart: true,
	fadeInSeconds: 0.3,
	holdMs: 2500,
	fadeOutSeconds: 1,
};

// splash.mp3 plays to completion regardless of the step, so the step lasts as long as the jingle.
const studio = (image, clipSeconds) => ({
	name: "Super Shitty Studios",
	image,
	sfx: { src: AssetUrl("audio/splash.mp3"), id: "LSM_SPLASH" },
	fadeInSeconds: 0.6,
	holdMs: Math.max(1500, Math.round((clipSeconds - 0.6 - 1.4) * 1000)),
	fadeOutSeconds: 1.4,
});

const payload = (image, clipSeconds) => ({ outputType: "custom", sequence: [carlNet, studio(image, clipSeconds)] });

// The engine shows splash images at natural size (capped at 60vw/60vh). splash.png is 676×369 with
// the logo in a ~310 px box, so it's cropped to the logo and doubled; the cap then scales it to fit.
const LOGO_BOX = [162, 11, 512, 356];

export function ProvideSplash() {
	ENGINE.Startup.ProvideSplashScreenPayload(payload(AssetUrl("images/splash.png"), 14));
	// Refine before the player clicks; the last payload provided before the click wins.
	void Promise.all([CropUrl("images/splash.png", LOGO_BOX, 2), AudioDuration("audio/splash.mp3")])
		.then(([image, seconds]) => ENGINE.Startup.ProvideSplashScreenPayload(payload(image, seconds)));
}
