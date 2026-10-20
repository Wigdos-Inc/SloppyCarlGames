# Primitive Expansion: Scope

0.36 (todo: Primitive Expansion), written during 0.34.7. This is a scope only, and building any of it needs a separate go-ahead.

It covers the shape items of the 0.36 entry. Instance.js expansion, dead-field cleanup and moving more fields into `primitiveOptions` are not covered here.

Section 10 lists the decisions still open.

---

## 1. Terms

- **Primitive option:** a field in `primitiveOptions`, validated per shape, like capsule `rounding`.
- **Complexity:** `low` / `medium` / `high`. It sets how many triangles a shape gets. Every triangle is lit flat ([Shaders.js:97](../../../handlers/utilities/Shaders.js#L97)), so fewer triangles read as facets, not as a coarse curve.
- **Decal projection:** how a decal's image is laid onto a part. The codes are in [Render.js:116](../../../handlers/Render.js#L116) (Flat, Sphere, Cylinder, Capsule). They are mirrored in GLSL ([Shaders.js:381](../../../handlers/utilities/Shaders.js#L381)) and in the Simulator ([Simulator.js:501](../../../handlers/game/Simulator.js#L501)).
- **Flat decal:** drawn as the exact placed quad ([Render.js:233](../../../handlers/Render.js#L233)), not on the part's own triangles. A flat decal larger than its face hangs off the edge.
- **Side:** `front` / `back` / `top` / `bottom` / `left` / `right`. Anchors a decal at that face of the part's box ([Render.js:1485](../../../handlers/Render.js#L1485)).

---

## 2. What exists today

**Shapes:** cube, cylinder, sphere, capsule, cone, ramp-simple, ramp-complex, tube, torus, pyramid, plane. They're defined in three places:
- **Builders:** [NewPrimitive.js](../../../builder/NewPrimitive.js).
- **Names:** both `shape` allowed-value lists ([canonSchemas.json:1637](../../../core/canonSchemas.json#L1637), [canonSchemas.json:1823](../../../core/canonSchemas.json#L1823)).
- **Default collider per shape:** [normalize.js:575](../../../core/normalize.js#L575).

**Character model usage**, counted across [player/characters.json](../../../player/characters.json) and [builder/templates/characters.json](../../../builder/templates/characters.json):

| Shape | Uses |
|---|---|
| Capsule | 77 |
| Sphere | 18 |
| Cube | 16 |
| Cylinder | 10 |
| Tube | 6 |
| Pyramid | 4 |

**Workarounds this scope removes:**
- **Jeff's shoes:** a sphere with a cylinder "sole" stacked under it ([characters.json:1858](../../../player/characters.json#L1858), [characters.json:1874](../../../player/characters.json#L1874)). This becomes a dome.
- **Jeff's torso and shorts:** capsules squashed to box proportions ([characters.json:1482](../../../player/characters.json#L1482)). A capsule's cross-section is always an oval, so it can't have a flat front with soft edges. This becomes a rounded cube.
- **Chara and the template character:** hard cubes throughout. These become rounded cubes.
- **Animal noses:** spheres. These become diamonds.

**Current limits:**
- **Capsule `rounding`:** one value for both ends, with a range of 0.05–0.95 ([canonSchemas.json:1758](../../../core/canonSchemas.json#L1758)). A flat end can't be made with the current options.
- **`buildCube`:** ignores complexity, even though cube parts carry it ([canonSchemas.json:1638](../../../core/canonSchemas.json#L1638)).

---

## 3. Cube: `rounding` + complexity

**Option:** `rounding` in `primitiveOptions`, from 0 to 1. It is the edge radius as a share of the cube's smallest half-width.
- The fallback is 0, which builds today's cube exactly: the same vertices and the same face groups. No existing cube changes.

**Complexity** sets the steps around each rounded edge:

| Complexity | Steps per edge | Triangles (approx.) |
|---|---|---|
| (plain cube) | 0 | 12 |
| low | 1, a straight 45° bevel | 44 |
| medium | 2 | 92 |
| high | 3 | 156 |

For comparison, a medium sphere has 384.

**Geometry:**
- The six flat faces shrink inward by the radius.
- 12 edge strips and 8 corner patches fill the gaps.

**Face groups:**
- The six flat faces keep their own groups, so per-face textures and face-picked decals work as before.
- Each edge strip and each corner gets its own group with its own normal.

**Collision:** box (`obb`), unchanged.

**Decals:** see section 6. Without the planar mode, a flat decal that reaches past the flat area hangs in the air beside the bevel.

**Scatter:**
- Scatter meshes are shared by a key that includes `primitiveOptions`.
- Until 0.34.7 that key ignored the options, so two scatter cubes with different `rounding` would have shared one mesh.
- This is fixed at [NewScatter.js:39](../../../builder/NewScatter.js#L39).

**Where:**
- `BuildGeometry` passes complexity and options to `buildCube`.
- A `cubeOptions` schema entry.
- Normalize lines next to the capsule ones ([normalize.js:883](../../../core/normalize.js#L883), [normalize.js:910](../../../core/normalize.js#L910)).

**Size:** about 60–90 lines.

---

## 4. Sphere: `domeRatio`

**Option:** `domeRatio`, the share of the sphere's height that's kept, measured from the top down.
- **Values:** 1 is the full sphere (the fallback), and 0.5 is a hemisphere.
- **Flat face:** it points down (−Y). Rotate the part to aim it elsewhere.

**Dimensions describe the full sphere** (author, 2026-10-17).
- **Why:** the sphere's center stays at the mesh origin, so the sphere decal projection and the sphere UVs need no offset.
- **Tradeoff:** `dimensions.y` isn't the visible height.
- **Example:** for Jeff's shoe, put the center at sole level and set `domeRatio: 0.5`.

**Geometry:**
- Keep the sphere's ring spacing and drop the rings below the cut.
- Add one exact ring at the cut, so the flat face sits at `y = dimensions.y × (0.5 − domeRatio)`.
- Close it with a flat disc.

A lower `domeRatio` means fewer triangles.

**The flat face must not smear** (author requirement). It is round like a cylinder cap but flat, and it's handled the same way:
- **Texture:**
  - The builder gives the disc its own flat (X-Z) UVs instead of the sphere's wrap.
  - Their scale matches the sphere's UVs.
  - The entity-part sphere pre-scale ([NewObject.js:251](../../../builder/NewObject.js#L251)) multiplies every UV, so the disc's UVs are written pre-divided by it.
- **Decals on the flat face:**
  - `side: "bottom"` on a dome resolves to the planar mode (section 6), the way cylinder caps resolve to Flat today ([Render.js:124](../../../handlers/Render.js#L124)).
  - The bottom anchor moves from the bottom of the box to the cut plane ([`BuildDecalPlacementMatrix`](../../../handlers/Render.js#L1485)).
- **Decals that cross the rim:**
  - A decal on the curved side skips the disc's triangles, and a decal on the disc skips the curved ones.
  - The rim is a hard edge for both, and nothing smears across it.
  - The builder marks where the disc's triangles start.
- **Signature change:** `ResolveDecalShapeCode` and `BuildDecalPlacementMatrix` both need the part's `primitiveOptions` for this. They're called at:
  - [Render.js:434](../../../handlers/Render.js#L434)–[Render.js:435](../../../handlers/Render.js#L435)
  - [Render.js:1438](../../../handlers/Render.js#L1438)–[Render.js:1439](../../../handlers/Render.js#L1439)
  - [Render.js:1535](../../../handlers/Render.js#L1535)
  - [Simulator.js:543](../../../handlers/game/Simulator.js#L543)

**Collision:**
- The collider is a sphere fitted to the dome's own box (`SphereFromAabb`). It covers the dome but reaches past the flat face.
- A level object that needs a tight fit sets `collisionShape` ([canonSchemas.json:1869](../../../core/canonSchemas.json#L1869)).

**Size:** about 40–60 lines, plus the decal signature changes.

---

## 5. Diamond primitive

**Shape:** `"diamond"`. It has a widest ring around the middle and tapers to the top and bottom.
- It is sized by `dimensions` like every other shape: `x` and `z` are the ring's width and depth, and `y` is the height.

**Option, widest point** (name open, D1): how high the widest ring sits, measured from the bottom, from 0 to 1.
- **0:** widest at the bottom, a wide underside like a mushroom cap.
- **1:** widest at the top, an upside-down cone.
- **0.5 (fallback):** symmetric.
- **At 0 or 1:** that end becomes a flat face.

The goblin reference's nose is widest low, with a long bridge above.

**Complexity** (author, 2026-10-17): low is the jewel, with harsh cut facets, and high is the nose, rounded. Proposed:

| Complexity | Cross-section | Side profile | Top | Triangles (approx.) |
|---|---|---|---|---|
| low (jewel) | 8 sides | straight, sharp facets | flat top facet | 30 |
| medium | 12 sides, rounded diamond | slight bulge, 1 extra ring each side | point | 72 |
| high (nose) | 16 sides, rounded diamond | rounded, 3 extra rings each side | rounded tip | 224 |

Unlike other primitives, complexity here changes the shape's style, not only its resolution. That's by author design.

**Face groups:**
- **Jewel:** one group per facet, like the pyramid.
- **Medium and high:** angular sectors with radial normals, like torus and tube (`resolveSectorRange`).

**Collision:** `triangle-soup`, the same as pyramid and cone.

**Decals:** the jewel uses the planar mode (section 6) on its facets. Medium and high use the sphere projection, which hugs the surface and stretches mildly on long shapes. See D3.

**Where:**
- The builder and a `BuildGeometry` case.
- `"diamond"` in both `shape` allowed-value lists.
- A `defaultsByShape` entry.
- A `diamondOptions` schema entry and normalize lines.

**Size:** about 80–120 lines. This is up from the first estimate of 50–70, because the high tier is now a rounded nose rather than only facets.

---

## 6. Planar decal mode (supports sections 3, 4 and 5)

**Problem:**
- Flat decals are drawn as the placed quad, not on the part's triangles.
- That's exact on a hard cube face.
- On a rounded cube's bevels, a dome's rim or a jewel's facets, the quad floats off the surface.

**Proposal:** a new decal code that keeps Flat's planar mapping but draws on the part's own triangles.
- **Triangle selection:** [`SelectDecalFacets`](../../../handlers/Render.js#L246) keeps the triangles that face the decal's side and fall inside its footprint. The current loop already checks the footprint.
- **Dropped triangles:** the decal never shows through on the opposite side.
- **Result:** the decal hugs bevels and facets, and stretches with their slope.

**Used by:**
- Rounded cubes, on every side, when `rounding` > 0.
- The dome's flat face.
- The jewel diamond.

Hard cubes keep today's quad, so their output is identical.

**Shader:** the math is the same planar mapping as Flat, so GLSL needs only a new constant. The Simulator's `decalSurfaceNormal` treats it like Flat.

**Size:** about 30–50 lines.

---

## 7. Diamond decal

**Mask:** `"diamond"`, a rhombus with a point at the middle of each edge, stretched by the decal's width and height.

**Registrations** (per the note at [normalize.js:646](../../../core/normalize.js#L646)):
- `shapeMaskBuilders` ([NewTexture.js:440](../../../builder/NewTexture.js#L440)).
- `shapeRequiredFields` ([normalize.js:647](../../../core/normalize.js#L647)).
- `levelCustomTexture.shape` allowed values.

**Optional:** the same widest-point option as the primitive. The decal shape table already supports per-shape fields. See D4.

**Size:** about 10–15 lines.

---

## 8. Capsule and cylinder: unify (look into)

**Can current options make a flat capsule end?** No. `rounding` is one value with a minimum of 0.05.

**The todo's `topRounding` / `bottomRounding`** (the share of the body each cap replaces) already cover `noTop` / `noBottom`:
- 0 at one end gives a flat end.
- 0 at both ends gives a cylinder.

**Recommendation:** use per-end rounding instead of flags. That's one mechanism instead of two.

**What changes:**
- **Geometry:**
  - The capsule builder takes one cap height per end.
  - An end at 0 closes with a flat disc instead of a cap.
  - The ring layout already matches the cylinder's: the same segment count and the same half-segment turn.
- **Shape name:**
  - One shape becomes an alias of the other.
  - Schema aliases only rename fields ([normalize.js:77](../../../core/normalize.js#L77)), so mapping one shape value to another is new work in normalize.
- **Existing `rounding`:**
  - An alias maps one field to one field, so it can't turn `rounding` into both ends.
  - Either `rounding` stays as a both-ends field, or the data migrates: 77 capsules in the character JSONs, plus level data. See D5.
- **Decals:**
  - Three places take a cap radius per end: `CapsuleBand` ([Render.js:135](../../../handlers/Render.js#L135)), its GLSL mirror ([Shaders.js:417](../../../handlers/utilities/Shaders.js#L417)), and the Simulator's capsule normal ([Simulator.js:506](../../../handlers/game/Simulator.js#L506)).
  - `DecalRounding` returns two values.
  - An end at 0 resolves like a cylinder cap does today.
- **Textures:**
  - Face-projected textures depend on face groups. Cylinders have one group per side quad, and the capsule body has one group for the whole body.
  - Whichever builder survives, the other shape's existing parts must look the same, or the author signs off on the difference.

**Collision:** both shapes already default to a capsule collider.

**Size:** about 100–150 lines, plus the data migration if `rounding` goes.

---

## 9. Verification plan

- **Unchanged output:** existing cubes (`rounding` 0) and spheres (`domeRatio` 1) build identical vertex and index buffers. Compare them before and after on the character models. After the fusion, cylinders and capsules are checked the same way.
- **Simulator App:** RIGOR authors trial parts, and the author signs off by eye:
  - Jeff's shoes as domes.
  - Jeff's torso as a rounded cube.
  - A diamond nose at each complexity.
  - A jewel.
- **Decals:**
  - One on a rounded-cube face, reaching onto the bevel.
  - One on a dome's flat face.
  - One crossing a dome's rim from the curved side.
  - One on a jewel facet.
- **Scatter:** two scatter parts that differ only in `primitiveOptions` get separate meshes.

---

## 10. Open decisions

- **D1. Widest-point name.**
  - **Candidates:** `widestPoint`, `widestRatio` (matches `domeRatio`), `bulgeHeight`.
  - **Recommendation:** `widestPoint`. It reads plainly, and 0 = bottom / 1 = top follows from the name.
- **D2. Diamond tiers.**
  - Is medium as proposed?
  - **Cross-section at medium and high:** a rounded diamond keeps a front ridge and reads as a diamond from every side. An ellipse is smoother, but reads as an egg from above.
  - **Recommendation:** rounded diamond.
  - Does the jewel keep its flat top facet?
- **D3. Diamond decals.**
  - **Proposal:** planar for the jewel, sphere projection for medium and high.
  - **Recommendation:** yes.
- **D4. Diamond decal widest point.**
  - **Proposal:** give the 2D diamond the same option.
  - **Recommendation:** yes. It costs one coordinate.
- **D5. Capsule/cylinder fusion.**
  - Which name survives?
  - Does `rounding` stay as a both-ends field, or does the data migrate to `topRounding` / `bottomRounding`?
  - **Recommendation:**
    - **Capsule survives:** it's the general case.
    - **Migrate:** keeping `rounding` next to the per-end fields needs a rule for which one wins.
- **D6. Rounded cube steps.**
  - **Proposal:** 1 / 2 / 3 steps per edge for low / medium / high.
  - **Recommendation:** as proposed.
