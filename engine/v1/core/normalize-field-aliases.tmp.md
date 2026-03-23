
Normalize.js — Key normalization mapping and semantic aliases
Date: 2026-03-23

Overview
Run a canonical key normalizer on object keys before normalization to collapse syntactic variants (case, `-`, `_`). The helper should be:

- `normalizeKey(key)` → `String(key).toLowerCase().replace(/[-_]/g, "")`

Below each canonical field used by `normalize.js` is listed with explicit semantic aliases. Separator/case variants are covered by `normalizeKey` and are not included here.

Menu UI
- `screenId`
  - aliases: screen, screenName, screenId, uiScreen, view
- `rootId`
  - aliases: root, rootElement, rootNode, uiRoot
- `elements`
  - aliases: items, nodes, childrenList, components
- `music`
  - aliases: soundtrack, bgMusic, track, backgroundMusic

Splash payload
- `presetId`
  - aliases: preset, presetName, splashPreset
- `sequence`
  - aliases: frames, steps, items, sequenceList

Splash step
- `name`
  - aliases: title, label, caption
- `image`
  - aliases: imageSrc, src, img, icon, artwork
- `sfx`
  - aliases: sound, soundEffect, sfxSrc, sfxFile
- `voice`
  - aliases: narration, voiceover, voiceline, voiceFile
- `voiceAtStart`
  - aliases: startVoice, firstVoice, playVoiceAtStart
- `fadeInSeconds`
  - aliases: fadeIn, fadeInSec, fadeInTime
- `holdMs`
  - aliases: holdMillis, holdTimeMs, holdDuration
- `fadeOutSeconds`
  - aliases: fadeOut, fadeOutSec, fadeOutTime

Audio / Music
- `src`
  - aliases: url, file, path, source
- `options`
  - aliases: opts, config, settings, audioOptions
- `name` (music track)
  - aliases: track, title, trackId, id

UI Element
- `children`
  - aliases: items, nodes, childNodes, elements
- `attributes`
  - aliases: attrs, props, properties
- `styles`
  - aliases: css, style, styleObj
- `events` / `on`
  - aliases: handlers, eventMap, listeners
- `type`
  - aliases: tag, elementType, nodeType
- `id`
  - aliases: id, elementId
- `className`
  - aliases: class, classes, classList
- `text`
  - aliases: textContent, label, content

Actions
- action types: `ui`, `request`, `event`, `exit`, `style` (no aliases)
- `request.screenId`
  - aliases: screen, targetScreen, screenName, route
- `event.name`
  - aliases: eventName, action, eventType
- `style.targetId`
  - aliases: target, targetId, selector
- `styles.classList`
  - aliases: add, remove, addClasses, removeClasses, classesToAdd, classesToRemove

Geometry / Vectors / Terrain / Obstacles
- `position`
  - aliases: pos, location, coords, origin, translate
- `dimensions`
  - aliases: size, dims, extent, scale, widthHeightDepth
- `size`
  - aliases: size, dimensions, bbox, extent
- `rotation`
  - aliases: rot, euler, orientation, angle
- `pivot`
  - aliases: anchor, origin, anchorPoint
- `shape` / `primitive`
  - aliases: type, form, primitiveType
- `complexity`
  - aliases: detail, level, quality

Primitive / Texture / Color / Scatter
- `primitiveOptions`
  - aliases: primitiveOpts, primitive_options, geomOptions
- `textureID`
  - aliases: texture, textureKey, material, materialId
- `opacity`
  - aliases: alpha, transparency
- `density`
  - aliases: density, frequency, densityValue
- `speckSize`
  - aliases: speck, grainSize, speck_size
- `animated`
  - aliases: animated, isAnimated, animate
- `holdTimeSpeed`
  - aliases: holdSpeed, holdDurationScale
- `blendTimeSpeed`
  - aliases: blendSpeed, blendDurationScale
- `color`
  - aliases: `{r,g,b,a}` object, rgb/rgba string, hex, tint, textureColor
- `scatter`
  - aliases: particles, distribution, spawnList
- `scatter.typeID`
  - aliases: type, prefab, entityType, spawnType
- `scatter.density`
  - aliases: density, amount

Triggers
- `start` / `end`
  - aliases: startPosition, endPosition, from, to
- `type`
  - aliases: triggerType, kind, eventType
- `payload`
  - aliases: payload, data, actionPayload, params
- `activateOnce`
  - aliases: once, singleUse, activate_once

Entity / Model / Movement / Combat
- `id`
  - aliases: id, entityId
- `type`
  - aliases: type, entityType
- `blueprintId`
  - aliases: blueprint, blueprintId
- `spawnSurfaceId`
  - aliases: spawnSurface, spawnSurfaceId
- `rootTransform.position/rotation/scale/pivot`
  - aliases: position, rotation, scale, pivot
- `localPosition` / `localRotation` / `localScale`
  - aliases: localPos, localRot, localScale
- `dimensions` (part)
  - aliases: size, dims
- `primitiveOptions` (part)
  - aliases: primitiveOpts
- `movement.repeat`
  - aliases: repeat, loop
- `movement.backAndForth`
  - aliases: backAndForth, pingPong, yoyo
- `movement.speed`
  - aliases: speed, moveSpeed, velocity, maxSpeed
- `movement.jump`
  - aliases: jump, jumpStrength, jumpHeight
- `movement.jumpInterval`
  - aliases: jumpInterval, jumpDelay, jumpCooldown
- `movement.jumpOnSight`
  - aliases: jumpOnSight, jumpOnSee, jumpOnPlayer
- `hp`
  - aliases: hp, health, hitPoints, hit_points, life
- `attacks`
  - aliases: attackPatterns, moves, abilities, skills
- `platform`
  - aliases: platform, onPlatform

Collections / Blueprints / Meta
- `attacks`, `animations`, `hardcoded`
  - aliases: plural and semantic synonyms (e.g., `animations` → `anim`, `animSet`)
- `entityBlueprints`
  - aliases: blueprints, blueprintSet
- `meta.levelId` / `meta.stageId`
  - aliases: level, stage, levelId, stageId
- `meta` entries
  - allow numeric/string/boolean conversions (already handled in code)

World / Camera / Player
- `world.length` / `width` / `height`
  - aliases: length, width, height, worldLength, worldWidth, worldHeight, sizeX/sizeY/sizeZ
- `world.deathBarrierY`
  - aliases: deathBarrierY, deathY, deathPlane, death_threshold
- `world.waterLevel`
  - aliases: waterLevel, water, water_level
- `world.textureScale` / `scatterScale`
  - aliases: textureScale, scatterScale, scaleTexture
- `camera.levelOpening.startPosition` / `endPosition`
  - aliases: startPosition, startPos, endPosition, endPos
- `camera.distance`
  - aliases: distance, dist, cameraDistance, zoom
- `camera.sensitivity`
  - aliases: sensitivity, sens, lookSensitivity
- `camera.heightOffset`
  - aliases: heightOffset, yOffset, verticalOffset
- `player.character`
  - aliases: character, char, characterId, avatar
- `player.spawnPosition`
  - aliases: spawnPosition, spawnPos, spawn
- `player.scale`
  - aliases: scale, size, scaleFactor
- `player.meta` entries
  - aliases: semantic keys per character definitions (allow same conversions)

Helpers / Resolve fields
- `resolveStringField` targets: `type`, `id`, `blueprintId`, `parentId`, `anchorPoint`, `attachmentPoint`
  - aliases: typeName, blueprint, parent, anchor, attach
- `resolveNumberField` targets: `speed`, `hp`, `thickness`, `radius`, `subdivisionsX`, `subdivisionsZ`, numeric texture fields
  - aliases: ensure `value`, `amount` mapping where semantically meaningful
- `resolveBooleanField` targets: `repeat`, `backAndForth`, `jumpOnSight`, `disappear`, `chase`, `physics`
  - aliases: loop, pingPong, yoyo for logic where appropriate
- `resolveArrayField` / `resolveObjectField`: aliases depend on semantic context (e.g., `attacks` → `moves`)

Notes
- Prioritize semantic synonyms above; separator/case variants are covered by `normalizeKey`.
- If you want I can implement `normalizeKey` plus a conservative remap helper and then apply a minimal set of in-code alias checks for the highest-impact fields (positions/sizes, texture IDs, `hp`, `movement.*`, `spawnSurfaceId`). Which set should I implement first?


