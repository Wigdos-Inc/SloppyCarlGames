// Resolves a level's camera config into its runtime camera set.

// Used by camera/Master.js at level start.
// Built-in sets come from camera/Sets.json; "custom" builds from the level's own situations.

import cameraSets from "./Sets.json" with { type: "json" };

// Situations map to modes; addons are per-mode arrays the modes branch on.
function ResolveCameraSet(cameraConfig) {
	const name = cameraConfig.activeSet;
	// Built-in: its own addons, the level's situations overriding; custom: the level's maps alone.
	const source = name === "custom" ? { situations: {}, addons: cameraConfig.modeAddons } : cameraSets.sets[name];
	return {
		name,
		situations: { ...source.situations, ...cameraConfig.situations },
		addons    : source.addons,
	};
}

export { ResolveCameraSet };
