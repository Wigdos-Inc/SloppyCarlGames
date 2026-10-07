# Engine Semantics

These rules define how engine code should read and how design decisions must be justified.

They govern intent rather than mechanism. Two changes can produce identical code and only one of them be correct, because the rule is about the reason the code exists.

---

## 1. Comment Quality

### 1.1 Core Rule

Comments are for the author. A comment tells the reader what the code below does, in plain words, at a glance.

When the reason a line exists isn't obvious, fold a short why into the same line: the what and the why combined into one concise statement. A comment that says what but leaves the reader wondering why it's there hasn't done its job.

### 1.2 The Glance Test

Read only the comment, at speed. You should know what the code below does, and why if it isn't obvious. If you had to slow down, rewrite it.

- **One line is the norm.** A second line is allowed only to explain a term the first line needs.
- **Plain words.** Jargon that stops the reader ("ulp", "coincident boundary plane") fails, even in one line.
- **Readable, not compressed.** Squeezing a comment into a cryptic fragment fails as badly as an essay. Don't drop the nuance the reader needs.
- **About this code.** The comment relates to the code directly below it. Mentions of other modules or systems that this code doesn't touch don't belong.
- **Readable in isolation.** Read it as if you don't know what the code does. If it only makes sense once you already understand the code, it does nothing.
- **Accurate for the whole block.** A comment above a block must describe the block, not just its first line, and must never claim something the code doesn't do. If it's about one important line, separate that line with a blank line on either side so the comment covers only it.
- **Data says its purpose.** A comment on a table or constant says what it's for, not what it is ("Rotations that turn a decal to face each side of a part").

### 1.3 Allowed Patterns

- **Short declarative statements**, even when the code is fairly self-evident. These are the house style. Never delete them as "restatements".
  ```js
  // Start global input routing.
  // Combined scale for dimensions computation.
  // A cache to prevent geometry regeneration
  ```
- **What + short why** in one line.
  ```js
  // One offset shared by r/g/b, keeping the hue (grey stays grey).
  // Void walls run before scatter so scatter may avoid openings.
  ```
- **`// Note:`** for a constraint someone editing the code must know, including cross-file registration.
  ```js
  // Note: Inlined to prevent over-allocation per triangle.
  ```
- **Trailing comments on object properties and fields only.** Everywhere else the comment goes above the line.
- **Order-critical lines** stand apart: blank lines around them, the comment above, naming the specific things involved.
- **Reference tables**, such as a shader attribute layout.
- **File headers are exempt.** Line 1 is the module's one-line purpose; the lines below say what it uses and what uses it.
- **JSDoc `@param` lists only for complex functions.** Otherwise a single `//` line.

### 1.4 Forbidden Patterns

**A. The essay**: multi-line reasoning.

**B. The reasoning chain**: walks the reader to a conclusion ("X is Y, so Z") instead of saying what the code does.

```js
// No physics pipeline runs here, so anything but "none" would emit and never move.
```

**C. Arguing with a reviewer**: audit notes and rule justifications.

```js
// Validation already proved the target resolves; re-checking it here would be a defensive guard.
// User-authorized freeze, not a violation.
```

**D. Stale notes**: old tuning results, TODOs for work that is already planned or obsolete, line-number references to other files, and orphaned comments that no longer describe the code below. Postponed work goes to `docs/status/DEFERRED.md`.

**E. Jargon and cryptic fragments**: see §1.2. Math and graphics terms count ("perpendicular", "parity", "azimuthal", "O(n log n)", "z-fighting"). Say what the math achieves instead.

**F. Tutorials**: explaining how controls or gameplay feel ("A/D spin the loop as seen…") instead of what the code does.

### 1.5 Bad vs Good

Taken from the author's review of real engine comments.

| Bad | Good |
|---|---|
| `// Debt is dropped so time dilates instead of compounding into a spiral.` | `// Drops leftover time debt instead of carrying it to the next frame.` |
| `// No physics pipeline runs here, so anything but "none" would emit and never move.` | `// Force-disable physics in the Simulator` |
| `// Parts carry their own generators, so a root one has nowhere to sit and the builder would drop it.` | `// Drop root-authored and keep part-authored particle generators.` |
| `// Object.assign onto a CSSStyleDeclaration ignores kebab keys, so camelCase them here.` | `// camelCase so kebab keys aren't ignored` |
| A 3-line block on how void walls attach `relations` that scatter reads | `// Void walls run before scatter so scatter may avoid openings.` |
| A 5-line JSDoc on Euler composition order | `// Rotates a point by Euler radians in CreateModelMatrix's order (Z, then X, then Y).` |
| A 3-line JSDoc on action transitions | `// Updates & logs playerState.action` |
| `return result; // No collision possible.` | Folded into the comment above: `// Ray is parallel to slab — no collision possible unless already inside.` |
| `// The key is omitted rather than set false, so absence means UV.` | `// Triplanar only when the mesh is flagged. Unflagged meshes use UVs.` |
| A 3-line block on float precision at coincident boundary planes | `// Extra height on void bounds, so a ground point sitting exactly on a void's bottom still counts.` |
| A 2-line block naming `UNPACK_PREMULTIPLY_ALPHA_WEBGL` | `// Premultiply alpha at load to match how WebGL blends decals.` |

Over-compression is also a failure. These were rejected:
- `// Returns 0 for a point inside the box.` says what but not why it's there.
- `// Fallback pause toggle for keys nothing above consumed.` is hard to read and loses the original's nuance.

### 1.6 What Belongs Elsewhere

| Content | Home |
|---|---|
| Why a change was made | `docs/changelog` |
| Why an alternative was rejected | `docs/changelog` |
| How a system fits together | `docs/system_map/` |
| Work postponed | `docs/status/DEFERRED.md` |
| What this line does | the comment |

---

## 2. Structure as Defense

### 2.1 Core Rule

Structure introduced to prevent author error is a defensive check.

`FORBIDDEN_DEFENSIVE_CHECKS.md` forbids runtime guards against things that should not happen. The same prohibition applies at the design level: do not add a helper, wrapper, indirection, or abstraction whose justification is that someone might otherwise make a mistake.

Such code exists to protect against the author rather than to serve the program. Its shape differs from an `if (!x)` guard; its reasoning does not.

### 2.2 The Test

Ask what the justification is. Not what the change does — why it is being made.

| Justification | Verdict |
|---|---|
| "So the two can't diverge" | Forbidden |
| "So a future writer doesn't forget" | Forbidden |
| "So this can't be misused" | Forbidden |
| "This duplication is itself a cost" | Allowed — argue it on DRY grounds |
| "This is measurably faster" | Allowed |
| "The current behavior is incorrect" | Allowed — that is a correctness fix |

The same extraction can be right or wrong depending on which row it lands in. If the only argument left after removing the mistake-prevention rationale is nothing, do not make the change.

### 2.3 Correctness Is Not Defense

Fixing a wrong formula, a wrong comparison, or a wrong contract is always allowed and is not covered by this rule. The distinction is between repairing what is broken and building scaffolding around what currently works.

### 2.4 Bad vs Good

Bad — the reason is mistake-prevention:

```js
// Two call sites compute the same spherical offset. Extract so they cannot diverge.
function boomOffset(distance, yawRad, pitchRad) { ... }
```

Good — the same extraction, argued on its own merits:

```js
// Duplication is the cost here: four call sites, one formula.
function boomOffset(distance, yawRad, pitchRad) { ... }
```

Bad — a flag whose rationale is author discipline:

```js
// Set this whenever the transform changes, or the cache goes stale.
mesh.transformDirty = true;
```

Good — the same invalidation chosen because it is correct and cheap:

```js
// Snapshot covers every field CreateRenderMatrix reads.
```

### 2.5 Why This Matters

A codebase that accretes mistake-prevention structure grows indirection without gaining capability. Each layer is individually reasonable and collectively expensive, and none of it can be removed later without an argument about hypothetical future editors.

Trust the rules and the review process to catch errors. Do not encode that distrust into the engine's shape.

---

## 3. Tuning Constants

### 3.1 Core Rule

A constant that exists so a value can be tuned is configuration. It lives in `core/config.js`, outside `API_CONFIG`, never scoped to the module that uses it.

Inside a module, a tuning constant reads as a single-use variable. Tuning means configuring.

### 3.2 Placement

| Constant | Home |
|---|---|
| A game may author it | `API_CONFIG`, only with the author's explicit approval |
| Internal tuning, standalone | An exported constant in `config.js`, like `SKY_STOP_LIMIT` |
| Internal tuning, part of a theme or connected to other tuning values | An exported object in `config.js` grouping them, like `PERFORMANCE_SCALING`. Add to an existing object before creating a new one |

Internal tuning values never reach the game. They are for the author, or an agent, to adjust while feel-testing.

### 3.3 Bad vs Good

Bad — tuning scoped to the module:

```js
// player/Movement.js
const jumpBufferSeconds = 0.12;
const coyoteSeconds = 0.1;
```

Good — a themed object in `config.js`, outside `API_CONFIG`:

```js
// core/config.js
const JUMP_WINDOWS = { BufferSeconds: 0.12, CoyoteSeconds: 0.1 };
```

---

## 4. Exports

### 4.1 Core Rule

Re-exporting is forbidden. No exceptions.

A module exports only what it defines. It never exports a binding it imported. That includes JSON imports, `export ... from`, and `export *`.

### 4.2 Placement

- Consumers import a symbol from the module that defines it, and JSON from its own file.
- Module roles are not bent for convenience. `core/meta.js` holds standard engine functionality, such as `DeepFreeze`. `core/config.js` holds configurables only.
- An import cycle is not a reason to move code. Keep anything a caller needs during load, such as constants a function uses, inside the function body. Function declarations are hoisted.

### 4.3 Bad vs Good

Bad: passing an import through.

```js
// builder/NewTexture.js
import VISUAL_TEMPLATES from "./templates/textures.json" with { type: "json" };
export { VISUAL_TEMPLATES };
```

Good: each consumer imports from the source.

```js
// builder/NewVoid.js
import VISUAL_TEMPLATES from "./templates/textures.json" with { type: "json" };
```

---

## 5. Constant Chains

### 5.1 Core Rule

Long unbroken chains of constants are discouraged. Most of their constants are used once or twice, and stacked together they bury the code they feed.

Inline a constant when the line stays readable. When it doesn't, break the chain into subchains:

- **Subchains sit just before their use.** Each declares only what the code directly below it needs, with a blank line above it.
- **Widely used constants go at the top** of their scope, separated from the subchains by a blank line.
- **Long property paths used throughout a scope are destructured at its top.** Not for a path used only once or twice.
- **A constant that only shortens a path is destructured instead**, so its uses drop the prefix: `const { maxSpeed } = target.character.meta;` over `const meta = target.character.meta;`.

```js
const { Gravity, Correction } = CONFIG.Physics;
const { Look, Loops, Modes, Body } = CAMERA_TUNING;
```

### 5.2 Multi-Line Constants

A constant stays on one line unless its value is an array, object, function or ternary. Any other value too long for one line is split into smaller constants within its subchain.

A multi-line ternary keeps its condition on the first line with the constant name. The second and third lines start on `?` and `:`.

```js
const rolls = ctx.cameraState.looping
	? !addons.includes("noLoopRoll")
	: inclined && !ctx.onSmallLoop && !addons.includes("noSlopeRoll");
```

### 5.3 Bad vs Good

Bad — one unbroken chain:

```js
const { Gravity, Correction } = CONFIG.Physics;
const meta = target.character.meta;
const fall = ...;
const height = ...;
const bottomSpeed = ...;
const ceilingGrip = ...;
const scaledDistance = ...;
const aim = ...;
rig.direction = ResolveVector3Axis(LerpVector3(rig.direction, aim, ctx.follow));
```

Good — shared constants at the top, then a subchain before each use:

```js
const { Gravity, Correction } = CONFIG.Physics;
const meta = target.character.meta;

const fall = ...;
const height = ...;
const bottomSpeed = ...;

const ceilingGrip = ...;
const scaledDistance = ...;

const aim = ...;
rig.direction = ResolveVector3Axis(LerpVector3(rig.direction, aim, ctx.follow));
```

Bad — arithmetic spread over several lines:

```js
const fall =
	(Gravity.Strength.value * target.gravityScale - target.buoyancyForce) /
	(target.underwater ? meta.waterFloatiness : meta.airFloatiness);

const scaledDistance =
	(Loops.TightFraming * loop.radius) / Math.sin(DegreesToRadians(ctx.cameraState.fov) * 0.5) *
	(1 + (Loops.SpeedZoom - 1) * Clamp01((bottomSpeed / meta.maxSpeed - ceilingGrip) / (1 - ceilingGrip)));
```

Good — split into one-line constants:

```js
const floatiness = target.underwater ? meta.waterFloatiness : meta.airFloatiness;
const fall = (Gravity.Strength.value * target.gravityScale - target.buoyancyForce) / floatiness;

const fitDistance = (Loops.TightFraming * loop.radius) / Math.sin(DegreesToRadians(ctx.cameraState.fov) * 0.5);
const speedZoom = 1 + (Loops.SpeedZoom - 1) * Clamp01((bottomSpeed / meta.maxSpeed - ceilingGrip) / (1 - ceilingGrip));
const scaledDistance = fitDistance * speedZoom;
```

---

## 6. Relationship to Other Rules

- §2 is a design-level extension of `rules/FORBIDDEN_DEFENSIVE_CHECKS.md`. Read that first.
- `rules/MODULE_GROUPS.md` governs *where* a justified helper belongs; §2 governs *whether* it should exist.
- §1 supersedes any line-count threshold applied by review agents. The glance test is the actual rule, and a short comment is never deleted just to save a line.
- §5 covers constants computed in code. A constant that exists to be tuned follows §3 instead.

---

## Summary Table

| Question | Rule |
|---|---|
| Does this comment read at a glance, saying what and (if unclear) why? | If not, rewrite it |
| Is it a short plain statement of what the code does? | Keep it |
| Does it reason, argue with a reviewer, use jargon, or carry stale notes? | Rewrite or delete it |
| Why does this abstraction exist? | If the answer is "to prevent mistakes", remove it |
| Is the current behavior wrong? | Then fixing it is not defensive |
| Is this module constant there to be tuned? | Move it to `config.js`, outside `API_CONFIG` |
| Does this module export something it imported? | Remove it; consumers import from the source |
| Is this a long unbroken chain of constants? | Break it into subchains just before their use; widely used ones go at the top |
| Does this constant span lines without being an array, object, function or ternary? | Split it into one-line constants |
| Is a long property path repeated throughout this scope? | Destructure it at the top |
