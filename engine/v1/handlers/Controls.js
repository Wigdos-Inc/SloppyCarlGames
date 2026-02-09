// User Input Handler

// Allows creating, tracking, and clearing input event listeners.

class Controls {
	constructor(target) {
		this.target = target || (typeof window !== "undefined" ? window : null);
		this.listeners = [];
	}

	on(type, handler, options) {
		if (!this.target || !type || typeof handler !== "function") {
			return () => {};
		}

		const once = options && options.once === true;
		const wrapped = once
			? (...args) => {
				handler(...args);
				this.off(type, wrapped);
			}
			: handler;
		const resolvedOptions = once ? { ...options, once: false } : options;

		this.listeners.push({ type: type, wrapped: wrapped, options: resolvedOptions });
		this.target.addEventListener(type, wrapped, resolvedOptions);

		return () => this.off(type, wrapped);
	}

	off(type, handler) {
		if (!this.target || !type || typeof handler !== "function") {
			return;
		}

		const index = this.listeners.findIndex(
			(item) => item.type === type && item.wrapped === handler
		);
		if (index < 0) {
			return;
		}

		const [listener] = this.listeners.splice(index, 1);
		this.target.removeEventListener(listener.type, listener.wrapped, listener.options);
	}

	clear() {
		if (!this.target) {
			return;
		}

		this.listeners.forEach((listener) => {
			this.target.removeEventListener(
				listener.type,
				listener.wrapped,
				listener.options
			);
		});
		this.listeners.length = 0;
	}
}

export { Controls };