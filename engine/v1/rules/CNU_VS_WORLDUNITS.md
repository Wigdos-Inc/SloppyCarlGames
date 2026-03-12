# CNU vs World Units

These rules define the two measurement unit systems used by the engine and how they relate to each other.

---

## 1. CarlNet Units (CNU)

CNU is the **standard unit of measurement** within the engine. All game-facing values — positions, distances, dimensions, speeds — are expressed in CNU.

- 1 CNU is intended to represent approximately **1 meter** in game space.
- All payload data from games arrives in CNU.
- All physics, collision, entity, and player logic operates in CNU.
- CNU is the unit that game developers think in and author content with.

---

## 2. World Units (WebGL Units)

World Units are what the **renderer** uses to draw sizes and positions on screen. They are the raw coordinate values passed to WebGL.

- World Units have no inherent real-world meaning — they exist purely as the renderer's coordinate space.
- World Units are only relevant inside the rendering pipeline and in modules that interface directly with it (e.g. Camera.js).
- Game code and game developers should never need to think in World Units.

---

## 3. CNU_SCALE

`CNU_SCALE` is the conversion factor from CNU to World Units.

```
1 CNU = CNU_SCALE World Units
```

- Defined in `core/meta.js`.
- Conversion functions are in `math/Utilities.js`:
  - `CNUtoWorldUnit(cnu)` → returns `cnu * CNU_SCALE`
  - `WorldUnitToCNU(worldUnit)` → returns `worldUnit / CNU_SCALE`
- The `Unit` and `UnitVector3` classes handle conversions through `.toWorldUnit()` and `.toCNU()` methods (see `rules/UNIT_INSTANCING.md`).

### What CNU_SCALE controls

`CNU_SCALE` determines how large 1 CNU appears in the rendered world. Adjusting it changes visual scale without affecting gameplay logic:

| CNU_SCALE | Effect                                          |
|-----------|--------------------------------------------------|
| `1`       | 1 CNU = 1 World Unit (no scaling)                |
| `2`       | 1 CNU = 2 World Units (everything renders larger) |
| `0.5`     | 1 CNU = 0.5 World Units (everything renders smaller) |

Gameplay values (speeds, distances, positions) remain the same in CNU regardless of `CNU_SCALE`. Only the rendered representation changes.

---

## 4. Where Each Unit Lives

| Domain                        | Unit        |
|-------------------------------|-------------|
| Payload data from games       | CNU         |
| Physics, collision, movement  | CNU         |
| Entity positions and sizes    | CNU         |
| Player state                  | CNU         |
| normalize.js defaults         | CNU         |
| Camera.js                     | World Units |
| Render.js                     | World Units |
| WebGL draw calls              | World Units |

---

## 5. Conversion Rules

- **Never mix CNU and World Unit values in the same calculation** without explicit conversion.
- **Convert at point of use**, not preemptively upstream (see `rules/UNIT_INSTANCING.md`, Section 5).
- **All engine modules (except Render.js)** should operate purely in CNU unless otherwise stated.
