# Frustum & Occlusion Culling: Scope

0.34.4 (DEFERRED Performance Enhancements). This is a scope only, and building any of it needs a separate go-ahead. All measurements are from lvl2 on the author's machine on 2026-10-09, with SimDistance "High" (150).

Section 6 lists the decisions still open.

---

## 1. Terms

- **Culling:** deciding not to draw something because it can't appear on screen. If it's done right, the image doesn't change; only the work does.
- **Frustum:** the pyramid-shaped volume the camera can see. Anything fully outside it (behind the camera, or off to a side) can't appear on screen.
- **Frustum culling:** each frame, testing every object's bounding box against the frustum and skipping the ones fully outside it.
- **Occlusion culling:** skipping objects that are inside the frustum but completely hidden behind other geometry, such as everything past a cave wall.

---

## 2. What exists today

| Kind | Distance cull | View cull | Where |
|---|---|---|---|
| Terrain | Yes, per object, `performance.rendering` | No | [Performance.js](../../../handlers/game/Performance.js), [`collectRenderableMeshes`](../../../handlers/Render.js#L1140) |
| Obstacles | Yes, per record; all parts drawn together | No | same |
| Entities (incl. particles) | **Flag is set but the renderer ignores it**, so every part is always drawn | No | `collectRenderableMeshes` never reads `entity.performance.rendering` |
| Entity decals | **No.** Every entity's decals are drawn | No | [`drawDecalPass`](../../../handlers/Render.js#L1491) |
| Void walls | **No.** All are drawn every frame | No | [`drawVoidWalls`](../../../handlers/Render.js#L1556) |
| Scatter (instanced) | On the GPU: instances past the cull radius are discarded in the vertex shader, but **every instance's vertices still run** | No | `scatterCullGLSL` in [Shaders.js](../../../handlers/utilities/Shaders.js) |
| Water meshes | No (the camera is inside them) | No | `drawWaterPass` |

**Render reach vs. fog reach:**
- Objects are drawn out to `SimDistance × WorldInstances.Cull` = **225**.
- Fog turns everything fully sky-colored at `225 × WorldInstances.Fog × Fog%`:
  - **202.5** in air (Fog.Air 100%)
  - **121.5** underwater (Fog.Water 60%)
- Anything whose nearest point is beyond that distance is drawn but invisible.

---

## 3. Measurements

### 3.1 Per frame

| Measure | Value |
|---|---|
| Frame time | ~13.3 ms, flat. This is the display refresh cap. |
| Engine JavaScript per frame | ~1.3 ms, of which `drawScene` ~0.5 ms |
| Chrome GPU-process work per frame | ~1.5 ms |
| Indices sent per frame | ~4.1–4.3 million |
| Draw calls per frame | 200–565 regular, plus 11–12 instanced |

Scatter instancing accounts for ~95% of the indices. All the regular meshes together come to ~100k.

**On this machine, rendering is far from the bottleneck, so culling will not raise visible FPS here.** Its value is headroom for weaker hardware (1.3 targets mobile), denser scatter, and bigger levels. True GPU shader time was not measured; the "GPU process" figure is command handling, not execution.

### 3.2 Regular objects: off-screen or fully fogged

Counted per drawn object.

| Spot | Drawn | Off-screen | Fully fogged | Cullable (either) |
|---|---|---|---|---|
| Spawn (underwater) | 334 | 234 | 224 | **276 (83%)** |
| Hub platform | 342 | 219 | 67 | **235 (69%)** |
| Swiss platform | 184 | 124 | 101 | **124 (67%)** |

Breakdown:
- **Entity parts:** of 128 parts, 85 are always cullable. Only the player's 43 are on screen.
- **Void walls:** 25–38 of the 39 are cullable at every spot.

### 3.3 Scatter instances

Per frame, out of 53,091.

| Spot | Within cull radius (105) | Also on screen |
|---|---|---|
| Spawn (underwater) | 6,170 | 3,432 |
| Hub platform | 300 | 300 |
| Swiss platform | 0 | 0 |
| Inside the grass field | 50,996 | 19,220 |

- **Away from the grass field:** nearly all of the scatter vertex work produces nothing.
- **Inside it:** ~60% of in-range instances are off-screen.

---

## 4. Proposal

The parts are listed in order of cost and risk; each one stands on its own.

### 4.1 Fog-aware render reach: REJECTED (by design)

The band between fog-full and the draw distance is intentional. It keeps objects drawn, invisible in the fog, before they come into view, so nothing pops in at high speed. The render reach stays as it is.

### 4.2 Entity distance gate (small, fixes an existing gap): SHIPPED 2026-10-09 with 4.3

`collectRenderableMeshes` and `drawDecalPass` read `entity.performance.rendering`, the same way terrain and obstacles already do. The flag is already computed every tick; nothing reads it.

### 4.3 Frustum culling for meshes (medium): SHIPPED 2026-10-09 (entities reuse `performance.rendering`)

**Each frame, in `drawScene`:**
- Build the six frustum planes from the same projection × view matrix the frame uses. This has to happen in the renderer, not in `Performance.js`: the frustum depends on this frame's exact camera, and `Performance.js` runs per tick.
- Skip every object whose bounding box is fully outside the frustum:
  - terrain meshes
  - obstacle records first, then their parts
  - entities
  - void walls
- A host's decals are skipped with the host.

**Math helpers:**
- `math/`: planes from a matrix, and "box fully outside planes". These are pure functions with no state.
- `createPerspectiveMatrix`/`createLookAtMatrix` stay in Render.js.

**Never culled:** water meshes, the sky, and full-screen passes.

**Animated entities need care.** Parts are drawn at `displayTransform`, but `worldAabb` is built from the true pose. An animated part, such as a swinging tentacle, can be drawn outside its own box. Culling per part could make a part vanish at a screen edge while it is still visible. See decision D2.

### 4.4 Scatter cell culling (largest win, most work): SHIPPED 2026-10-09 (cell size 20 cnu)

**At build:**
- Sort each batch's instances into spatial cells, for example square columns on X/Z.
- Instances in the same cell sit next to each other in the instance buffer.
- Each cell keeps its instance range and bounding box.

**Each frame, per batch:**
- Skip cells that are fully beyond the cull radius or fully outside the frustum.
- Draw each remaining cell's range on its own.

WebGL2 has no "start drawing at instance N" option. So before each cell's draw, the instance attributes are re-pointed at that cell's offset (`vertexAttribPointer` with a byte offset), and the cell gets one `drawElementsInstanced`. The same applies to the scatter decal pass.

The existing in-shader fade and cull stays. It still gives the soft dissolve at the edge of the radius; cells only remove instances that can't be reached at all.

**Trade-off:** draw calls go from one per batch to one per visible cell per batch. Cell size balances draw calls against wasted vertices. It becomes a tuning constant in `config.js`, likely in `PERFORMANCE_SCALING`, never in `API_CONFIG`.

**Expected effect:**
- **On the platforms:** scatter vertex work drops from all 53k instances to the few hundred near the camera.
- **Inside the field:** it drops to roughly the 19k on screen.

**Same image:** cells only drop instances that are past the radius (already discarded in the shader) or fully off-screen.

### 4.5 Occlusion culling: STAYS IN SCOPE (author, D4)

The author rejected leaving it out. A level with a dense hotspot of objects behind walls, lagging while none of it can be seen, would read as a bug, and future content may well do that. It is **its own patch, 0.34.6** (author, 2026-10-10).

**Measure first.** Its CPU cost has to beat the GPU work it saves, and neither is known. Before building, a one-off debug count uses GPU occlusion queries (late answers don't matter for counting) to total how much drawing is fully hidden behind walls. It is built only if that total justifies it.

**Edge rule (if built):** fill depth at pixel corners, and count a pixel as walled only when all four corners hit the same object. Joins inside one object leave no gaps, and cracks between objects are never closed. The one miss is a hole in a single object that looks smaller than one picture pixel.

**Chosen direction: a same-frame CPU depth check.**
- **Small depth picture:** each frame, a few large, solid, opaque nearby objects ("walls", using the carved geometry so openings stay open) are drawn on the CPU into a small picture, about 256 × 128. Each pixel stores the distance to the nearest wall in that direction.
- **Object test:** each other object's box is projected onto that picture. The object is skipped only if the wall is closer than the box's nearest point at *every* pixel the box covers.
- **No pop-in:** it runs in the same frame as the draw, so nothing appears late.
- **Rough size:** ~250 lines, most of it the triangle filler.
- **Placement (author, 2026-10-10):** the pure part goes in a new `math/Occlusion.js`. Size settings live in config.js and are passed in as parameters, so the module stays free of config and a worker can load it in 0.35. Wall selection and the calls stay in Render.js (~40 lines).

**Considered and not chosen: a build-time visibility grid** ("which areas can see which", the author's idea).
- **Stacked spaces:** a flat grid can't represent spaces stacked on top of each other, like lvl2's underwater tunnel under the hub. It would need to be 3D, and its build cost and memory grow fast.
- **Moving things:** it goes stale when walls move, and Moving Terrain & Obstacles is planned.
- **Gaps:** rays cast across it can slip past narrow objects.

The two forms below were the first options considered.

Two practical forms exist, and both are poor fits right now:

- **GPU occlusion queries** (WebGL2 `ANY_SAMPLES_PASSED_CONSERVATIVE`):
  - **How it works:** draw an object's box invisibly and ask the GPU whether any pixel passed the depth test.
  - **Problem:** the answer arrives one or more frames late. Objects that come into view while turning or rounding a corner pop in a frame late.
  - **Cost:** a query per tested object per frame.
- **Hand-authored visibility zones** (rooms or portals):
  - **How it works:** levels author which areas can see which.
  - **Problem:** exact and cheap at runtime, but every level carries the authoring burden.

After 4.1–4.4 there is little left to occlude. The CPU cost is already ~1.3 ms, so even the query cost would need measuring against what it saves. Tunnel and cave interiors are where it would help most. Revisit once a level is actually GPU-bound there, with a measurement.

---

## 5. Verification plan

- **Same image:** take before and after screenshots from fixed camera spots: underwater spawn, hub platform, swiss platform, the grass field, and inside `uw-tube-winding`. They should match. The author signs off on any visual difference.
- **Work saved:** measure draw calls, indices, and scatter instances submitted per frame at the same spots, using the instrumentation from this scope.
- **Edge cases, by eye:**
  - Turning quickly at screen edges, to catch animated parts vanishing (D2).
  - Crossing the water surface, when the fog distance switches from 202.5 to 121.5.
  - Scatter at the edge of the cull radius, to check the dissolve is unchanged.

---

## 6. Open decisions

- **D1. Scope of this pass.** All of 4.1–4.4, or only the small parts (4.1–4.3), with scatter cells as their own patch? Recommendation: 4.1–4.3 first, then 4.4. They don't depend on each other, and 4.4 is the only one that changes buffers.
- **D2. Animated entities in frustum culling.**
  - **(a)** Cull a whole entity by one box covering all its parts, padded for animation reach. The padding is a tuning constant.
  - **(b)** Rebuild each part's box from its display pose every frame, which is exact.
  - **(c)** Don't frustum-cull entity parts; distance-cull them only (4.2).

  Recommendation: (a). It's cheap, and with any reasonable padding nothing visible disappears.
- **D3. Scatter cell size.** Pick a starting value to tune by measurement. Recommendation: about a fifth of the cull radius (~20 units at High).
- **D4. Occlusion culling.** Agree to leave it out of 0.34.4, per 4.5? If agreed, it goes into `todo` or `DEFERRED.md` with the reason.

---

## 7. Notes for later

- **Lighting & Shadows (0.43):** a shadow pass draws from the light's point of view. An object can be off camera and still cast a shadow into view. Camera-frustum culling must not be reused for shadow casters as-is.
- **Seen while measuring, not part of this scope:** `ensureMeshBuffer` builds a string key per mesh per draw (`getMeshBufferKey`). That was ~47 ms of CPU over a 7.9 s trace. This is a candidate for item 5 (Todo Performance Enhancements).
