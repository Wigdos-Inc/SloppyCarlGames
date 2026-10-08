# Asset Requests — Luigi's Shitty Mansion

Everything below already has a working placeholder, so the game runs without any of it. Drop a file at the
listed path (relative to `bootleg/luigishittymansion/`) and the game picks it up on the next load. The game
checks with a HEAD request, so each file you haven't supplied yet shows up as a harmless 404 in the console.

## Audio

| File | What it is | Placeholder today |
|---|---|---|
| `assets/audio/title_theme.mp3` | Title screen music. Spooky-goofy, loops. | Silence |
| `assets/audio/mansion_theme.mp3` | In-level music. Tense but silly, loops ~1–2 min. | Silence |
| `assets/audio/victory.mp3` | "Chapter clear" music/jingle; plays over the victory screen. | Synthesized arpeggio (SFX) |
| `assets/audio/game_over.mp3` | Short sad trombone / failure sting. | Synthesized |
| `assets/audio/vacuum_start.mp3` | Vacuum spin-up (~0.3 s). | Synthesized |
| `assets/audio/capture.mp3` | Ghost getting slurped in: pop / "fwoomp". | Synthesized |
| `assets/audio/trash.mp3` | Trash slurp (short, crunchy). | Synthesized |
| `assets/audio/hurt.mp3` | Robot "bonk"/clang when hit. | Synthesized |
| `assets/audio/ghost_laugh.mp3` | Ghost giggle (on spawn and when it hits you). | Synthesized |
| `assets/audio/heart.mp3` | Health pickup chime. | Synthesized |
| `assets/audio/door.mp3` | Door creak (reserved for later chapters). | Synthesized |

The vacuum's running hum stays synthesized on purpose: it pitches up live while a ghost is struggling,
and the engine's looping-SFX handling is unreliable (see `ENGINE_GAPS.md` §6).

## Images (UI)

| File | What it is | Placeholder today |
|---|---|---|
| `assets/images/title_art.png` | Title hero art: the box-head robot (straw hat, green round eye, blue square eye, frown) holding the vacuum. Transparent PNG, ~900 px tall; shown bottom-left. | CSS-drawn robot |
| `assets/images/logo.png` | "LUIGI'S SHITTY MANSION" logo, transparent PNG, wide (~1400×400). | Styled text |

## Images (in-world decals)

All transparent PNGs, drawn as image decals by the engine.

| File | What it is | Placeholder today |
|---|---|---|
| `assets/images/wall_crack.png` | Black hand-drawn crack lines (like the reference shot). Square, ~512 px. Drawn 1.6 m wide, randomly rotated. | Thin dark pill-shape decals |
| `assets/images/moon_window.png` | Night sky with a crescent moon and stars, seen through a window. ~560×520 (it fills a 2.8×2.6 m pane). | Yellow/blue circle decals + star dots |
| `assets/images/portrait.png` | Creepy ancestor portrait for the Foyer (ideally of the robot). ~560×720 (fills a 1.4×1.8 m canvas). | Robot face built from shape decals |
