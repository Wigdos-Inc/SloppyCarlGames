# cutscene/ — Cutscene Pipeline

## Responsibility
Implements cutscene sequencing, actor management, animation scripting, and audio synchronization. The cutscene pipeline is driven by `handlers/Cutscene.js`; it does not manage its own lifecycle or advance its own playback.

## Files
- `Actors.js` — Defines and tracks all active participants of a cutscene. Builds actors via `builder/NewEntity.js`. Used by `handlers/Cutscene.js` for actor data.
- `Animation.js` — Cutscene-specific animation handler. Drives actor visual states during playback.
- `AudioSync.js` — Synchronizes audio playback with cutscene timelines, ensuring audio fires at the correct point and speed.
- `Scene.js` — Scene sequencing and segment management for cutscene playback.
- `Master.js` — Currently a stub. The file exists (1 line) but exports no logic. `handlers/Cutscene.js` coordinates the pipeline without it.

## Boundaries
**Called by:** `handlers/Cutscene.js`.  
**Calls into:** `builder/NewEntity.js` (actor construction); `handlers/Sound.js` (audio sync).  
**Does not:** Self-advance playback; manage its own lifecycle; call into `player/`, `physics/`, or rendering directly.

## Invariants
- The cutscene pipeline is entirely driven by `handlers/Cutscene.js`. Cutscene modules do not self-trigger.
- `Master.js` is a stub and contributes no current runtime behavior.
