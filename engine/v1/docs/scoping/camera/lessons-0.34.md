# Lessons from 0.34 (camera & controls)

Context for the carlCamSet rework ([carlCamSet-scope.md](carlCamSet-scope.md)). Measured in the browser on 2026-10-01 in lvl2's `uw-tube-uturn` (underwater, near spawn), with chaseCam unless noted. 0.34's control rules themselves are discarded; only these findings carry over.

## Speed thresholds flip held keys
- **Setup:** keys pressed at speed followed travel, and switched to following the camera below 12.5 u/s.
- **What happened:** S at speed braked for 0.1–0.25 s, then re-aimed along the side camera (looking down the tube), and Carl ran along it. Back above 12.5, S braked again.
- **Lesson:** a hard threshold that changes what a held key means turns into an oscillation.

## Input that follows live velocity makes the loop lean run away
- **Mechanism:** each climb up the wall slows Carl's around-the-tube motion, which tilts his velocity along the tube. Held input that follows the velocity then pushes along the tilt, so the tilt never comes back.

| Input | Starting velocity | Lean over time |
|---|---|---|
| Travel-latched W (follows velocity) | 25 u/s, 20° | 38.5° → 48° → 61.8° in 3 s; along-tube speed 8.6 → 20.4 |
| Carried W (orbit) | 25 u/s, 20° | 29.1° → 26.8° → 32.4° → 27.8°; along-tube speed 9.1 → 10.0 |
| Camera-relative W pressed from standstill (chase or orbit) | standstill, 22° | input held at 21.8° / 23.2°; velocity drifts 22° → 27°+ |
| W straight around (control) | 25 u/s, 0° | along-tube speed stays ~0 over two laps |

- **Lessons:**
  - Physics adds no along-tube speed by itself.
  - Carried input removes the runaway but leaves a slow residual drift: velocity runs 7–12° above the input and creeps 1–3° per lap. Whether it levels off is unknown.

## Action labels are not physical state
- **The failure:** grounded underwater is always "Floating", never "Idle", so a loop release keyed on "Idle" never fired in the underwater tubes.
- **What worked:** the live grip minimum, `playerState.gripDemand × maxSpeed`, compared with speed along the surface.
  - At full speed it never released mid-lap; the minimum margin was 3.7 u/s (14.9 against 11.1, on the wall).
  - It released when Carl slowed and slid off the wall.
  - The author confirmed it releases when stopping at the bottom.

## A side view must not aim input
- **What happened:** input seeded from a side camera looking down the tube redirected Carl along it.

## Framing tight loops
- **What happened:** a side camera whose distance followed the user's zoom sat inside the loop at max zoom-in, with Carl circling it.
- **What worked:** a distance fitted to the loop's size (`radius × framing / sin(fov/2)`), independent of zoom, together with easing the arm onto the loop's axis.

## Rejected approaches
- **Traction** (velocity turned toward the held direction): it fixed the lean but removed control at low speed and from camera-based movement.
- **Carrying travel keys like orbit:** it would stop held directions bending along curved paths, and that bending is wanted.
- **Extra levers and exception rules to mask a bug in another system,** for example a new still-speed tunable instead of fixing the release.
