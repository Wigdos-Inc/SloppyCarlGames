// Maintains Full Cutscene State

// If In-Engine Cutscene:
// core/validate.js validates cutscene payload.
// Uses cutscene/Actors.js to build all Cutscene entities (player, npcs, etc)
// Uses cutscene/Scene.js to build the cutscene environment.
// Uses cutscene/Animation.js to manage animation state of all entities.
// Uses cutscene/AudioSync.js to determine the timing and playback speed of dialogue, music and sound effects.
// Feeds Render.js to render cutscenes.

// If Pre-Rendered Cutscene
// Receives video file path from Game, validated by core/validate.js
// Feeds Render.js to display cutscenes