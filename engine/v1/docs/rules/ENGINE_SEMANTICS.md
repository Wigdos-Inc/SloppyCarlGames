# Engine Semantics

These rules define how engine code should read and how design decisions must be justified.

They govern intent rather than mechanism. Two changes can produce identical code and only one of them be correct, because the rule is about the reason the code exists.

---

## 1. Comment Quality

### 1.1 Core Rule

A comment must be understandable at a glance.

If a comment reads as a sentence the reader has to parse, it has failed. If it reads as a paragraph, it is code bloat.

A comment says what the code below does, compressed. It is not the place for reasoning, history, or decision records.

### 1.2 The Glance Test

Read only the comment, at speed. If you had to slow down, rewrite it.

A fragment beats a sentence. A sentence beats two. Two lines is already a smell, not a budget to spend.

**Line count is a floor, not the bar.** A one-line comment that reads as prose still fails. Do not treat "under the line limit" as passing.

### 1.3 Forbidden Patterns

**A. The essay** — reasoning that belongs in the changelog.

```js
// Capped by the ray's own limit, not broadHit.t — detailed bounds sit inside the AABB, so a real
// narrowphase hit is always at or beyond the broad entry and an entry-t cap could only reject it.
```

**B. The restatement** — says what the next line already says.

```js
// Boom segment AABB built from the two endpoints.
const boomAabb = { min: ..., max: ... };
```

**C. The decision log** — records why an alternative was rejected.

```js
// We use value comparison here rather than reference identity, because the display object is
// mutated in place and identity would therefore remain stable while the values change.
```

That belongs in `docs/changelog`, not above the line.

### 1.4 Bad vs Good

Bad:

```js
// `inside` marks an exit hit — the ray started within the volume, so no surface faces the origin.
```

Good:

```js
// `inside`: exit hit — no surface faces the origin.
```

Bad:

```js
// cos(pitch) is the horizontal foreshortening — without it desiredPos leaves the sphere and
// clippedDistance stops matching the radius finalPos uses.
```

Good:

```js
// Horizontal foreshortening — keeps desiredPos on finalPos's sphere.
```

### 1.5 What Belongs Elsewhere

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

## 3. Relationship to Other Rules

- §2 is a design-level extension of `rules/FORBIDDEN_DEFENSIVE_CHECKS.md`. Read that first.
- `rules/MODULE_GROUPS.md` governs *where* a justified helper belongs; §2 governs *whether* it should exist.
- §1 supersedes any line-count threshold applied by review agents. Line count catches the worst cases; the glance test is the actual rule.

---

## Summary Table

| Question | Rule |
|---|---|
| Does this comment read at a glance? | If not, rewrite it |
| Is this comment under the line limit but still prose? | Still a violation |
| Why does this abstraction exist? | If the answer is "to prevent mistakes", remove it |
| Is the current behavior wrong? | Then fixing it is not defensive |
