// Thin adapter over the live scene (ENGINE.Level.GetActiveLevel). All direct scene access lives here.

export const Scene = () => ENGINE.Level.GetActiveLevel();
export const Player = () => ENGINE.Level.Player.GetState();

export function FindEntity(id) {
	const scene = Scene();
	return scene ? scene.entities.find((entity) => entity.id === id) || null : null;
}

export const PosOf = (entity) => entity.transform.position;

export function SetPos(entity, x, y, z) {
	entity.transform.position.set({ x, y, z });
	entity.velocity.set({ x: 0, y: 0, z: 0 });
}

export function SetYaw(entity, radians) {
	const rotation = entity.transform.rotation;
	rotation.set({ x: rotation.x, y: radians, z: rotation.z });
}

export function SetScale(entity, s) {
	Object.assign(entity.transform.scale, { x: s, y: s, z: s });
}

// Tint every part of an entity; null restores authored colors.
export function Tint(entity, color) {
	entity.model.parts.forEach((part) => { part.mesh.displayColor = color; });
}

export function TintPart(entity, partId, color) {
	const part = entity.model.parts.find((p) => p.id === partId);
	if (part) part.mesh.displayColor = color;
}

export function CameraForward() {
	const scene = Scene();
	return scene ? scene.cameraConfig.state.forward : null;
}

export function CameraPosition() {
	return ENGINE.Level.GetCameraPosition();
}

export const Dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const Dist3D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
