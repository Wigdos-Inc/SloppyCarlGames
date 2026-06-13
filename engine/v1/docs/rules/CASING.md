# Casing Rules

These rules govern the naming conventions for all identifiers in engine code. Every variable, function, constant, and export must follow these rules without exception.

---

## 1. Single-file Identifiers: `lowerCamelCase`

Any identifier that is **not exported** uses `lowerCamelCase`.

This applies to:
- Local variables
- Local functions
- Function parameters
- Private/internal module-scoped variables
- Private/internal module-scoped functions

```js
// Correct
const playerSpeed = 10;
function resolveWaterLevel(source) { ... }
let currentDistance = 0;

// Incorrect
const PlayerSpeed = 10;        // UpperCamelCase is for exports
const PLAYER_SPEED = 10;       // FULL_CAPS is for exported constants
function ResolveWaterLevel() { ... }  // UpperCamelCase is for exports
```

---

## 2. Exported Identifiers: `UpperCamelCase`

Any identifier that is **exported** (functions, classes, non-constant variables) uses `UpperCamelCase`.

This applies to:
- Exported functions
- Exported classes
- Exported mutable variables

```js
// Correct
export function BuildLevel(payload) { ... }
export class Unit { ... }
export function ValidateLevelPayload(payload) { ... }

// Incorrect
export function buildLevel(payload) { ... }   // lowerCamelCase is for non-exported
export function build_level(payload) { ... }  // snake_case is never used
```

---

### Class Instance Methods

Class instance methods use `lowerCamelCase`. The class itself is the exported identifier — its methods are accessed through instances and are never directly exported.

```js
// Unit is exported (UpperCamelCase)
export class Unit { ... }

// Methods are accessed through instances — never exported directly (lowerCamelCase)
const u = new Unit(10, "cnu");
u.toWorldUnit();    // lowerCamelCase
u.clone();          // lowerCamelCase
u.set(42);          // lowerCamelCase
```

---

## 3. Exported Constants: `FULL_CAPS`

Any **exported constant** (a variable that never changes after declaration) uses `FULL_CAPS` with underscores separating words.

This applies to:
- Exported `const` values that are true constants (not objects/arrays that get mutated)
- Exported configuration keys
- Exported scale factors

```js
// Correct
export const CNU_SCALE = 1;
export const SESSION_KEYS = { Logs: "ENGINE_LOGS", Cache: "ENGINE_CACHE" };

// Incorrect
export const cnuScale = 1;       // lowerCamelCase is for non-exported
export const CnuScale = 1;       // UpperCamelCase is for non-constant exports
```

---

## Summary Table

| Scope              | Convention       | Example                  |
|--------------------|------------------|--------------------------|
| Non-exported       | `lowerCamelCase` | `playerSpeed`            |
| Exported           | `UpperCamelCase` | `BuildLevel`             |
| Exported constant  | `FULL_CAPS`      | `CNU_SCALE`              |

---

## Edge Cases

- **Acronyms in UpperCamelCase**: Treat acronyms as words. `CNU` stays `CNU` as a standalone term, but in compound names follow natural reading: `CNUtoWorldUnit`, `ValidateUIPayload`.
- **Non-exported constants**: Use `lowerCamelCase`, not `FULL_CAPS`. The `FULL_CAPS` convention only applies to exported constants.
- **Object properties**: Follow the convention of their containing scope. Properties on exported objects follow `UpperCamelCase` if they represent public API surface (e.g. `ENGINE.Level.CreateLevel`), `lowerCamelCase` for internal data.
- **Properties on exported FULL_CAPS objects**: Properties on exported constant objects (e.g. `SESSION_KEYS.Logs`, `CONFIG.DEBUG.ALL`) intentionally use `UpperCamelCase` for readability. This is a known inconsistency relative to class instance methods and is kept deliberately. Do not conflate the two conventions.
