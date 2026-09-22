// Keyboard state: held keys plus "pressed this step" edges.

const KEY_MAP = {
  ArrowLeft: "left",  KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  ArrowUp: "jump",    KeyW: "jump", Space: "jump", KeyZ: "jump",
  ArrowDown: "down",  KeyS: "down",
  Enter: "confirm",   NumpadEnter: "confirm",
  KeyP: "pause",      Escape: "pause",
  KeyR: "restart",
  KeyM: "mute",
};

class Input {
  constructor(target) {
    this.held = {};
    this.edge = {};
    this.anyPressed = false;

    target.addEventListener("keydown", (e) => {
      const name = KEY_MAP[e.code];
      if (name) e.preventDefault();
      this.anyPressed = true;
      if (!name || e.repeat) return;
      this.held[name] = true;
      this.edge[name] = true;
    });

    target.addEventListener("keyup", (e) => {
      const name = KEY_MAP[e.code];
      if (!name) return;
      e.preventDefault();
      this.held[name] = false;
    });

    // Losing focus mid-jump shouldn't leave keys stuck down.
    window.addEventListener("blur", () => {
      this.held = {};
      this.edge = {};
    });
  }

  down(name) { return !!this.held[name]; }
  pressed(name) { return !!this.edge[name]; }

  endStep() {
    this.edge = {};
    this.anyPressed = false;
  }
}
