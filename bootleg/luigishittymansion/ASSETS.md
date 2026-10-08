# Assets — Luigi's Shitty Mansion

Paths are relative to `bootleg/luigishittymansion/`. Every asset has a working placeholder, so the game
runs with any of them missing. A file dropped at its listed path is picked up on the next load. The game
probes with a HEAD request, so each still-missing file is a harmless 404 in the console.

## Delivered

| File | Used as | How it was fitted |
|---|---|---|
| `assets/audio/splash.mp3` | Studio jingle on the 2nd splash step | Starts the instant the step begins; the step lasts the clip's measured length (14.1 s) so it doesn't bleed into the title music. |
| `assets/images/splash.png` | Studio logo, after the engine's CarlNet splash | The engine shows splash images at natural size, so it's cropped to the logo and upscaled 2× at boot (displays ~540 px). |
| `assets/audio/title_theme.mp3` | Title screen music (loops) | — |
| `assets/audio/mansion_theme_full.mp3` | In-level music, played once | Hands off to the loop when it ends (countdown of its real length, held while paused). |
| `assets/audio/mansion_theme_loop.mp3` | In-level music after the intro, loops forever | — |
| `assets/images/title_art.png` | Title hero art (bottom-left) | Landscape art already contains the ghost, so the CSS ghost is hidden when it's present. Sized by height to stay clear of the menu. |
| `assets/images/logo.png` | Title logo | Tall and opaque on near-black: the black field is keyed out to transparent at boot, and the title layout gives it a 42vh slot. |
| `assets/images/moon_window.jpeg` | The view through every window | It's a whole window (frame + mullions), so window openings were reshaped to its 1.316 aspect (2.9 × 2.2 m) and the geometric mullions are dropped; it sits flush behind the opening. |
| `assets/images/portrait.png` | "The Ecstatic Gremlin" in the Foyer | Has its own ornate frame, so the brass frame is dropped; a backing board matches the opaque frame and the transparent margins vanish. |
| `assets/images/wall_crack.png` | Wall cracks | Drawn at its own aspect (2.1 × 1.5 m including margins, ~1.5 m of actual crack), randomly rotated. |

## Still open (optional)

| File | What it is | Placeholder today |
|---|---|---|
| `assets/audio/victory.mp3` | Short "chapter clear" sting over the victory screen. | Synthesized arpeggio |
| `assets/audio/game_over.mp3` | Short failure sting. | Synthesized |
| `assets/audio/vacuum_start.mp3` | Vacuum spin-up (~0.3 s). | Synthesized |
| `assets/audio/capture.mp3` | Ghost getting slurped in: pop / "fwoomp". | Synthesized |
| `assets/audio/trash.mp3` | Trash slurp. | Synthesized |
| `assets/audio/hurt.mp3` | Robot bonk/clang when hit. | Synthesized |
| `assets/audio/ghost_laugh.mp3` | Ghost giggle (spawn and on hitting you). | Synthesized |
| `assets/audio/heart.mp3` | Health pickup chime. | Synthesized |

The vacuum's running hum stays synthesized on purpose: it pitches up live while a ghost struggles.
