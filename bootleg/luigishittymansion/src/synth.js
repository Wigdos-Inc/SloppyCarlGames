// Placeholder SFX synthesized with WebAudio, used until real audio files are supplied (see ASSETS.md).

let context = null;
let noiseBuffer = null;

function audio() {
	if (!context) {
		context = new AudioContext();
		noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
		const data = noiseBuffer.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
	}
	if (context.state === "suspended") context.resume();
	return context;
}

const volume = () => ENGINE.Config.Volume.Master * ENGINE.Config.Volume.GameSfx;

function envelope(gainNode, now, attack, hold, release, peak) {
	gainNode.gain.setValueAtTime(0.0001, now);
	gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
	gainNode.gain.setValueAtTime(Math.max(0.0002, peak), now + attack + hold);
	gainNode.gain.exponentialRampToValueAtTime(0.0001, now + attack + hold + release);
}

function tone(type, from, to, duration, peak = 0.25, delay = 0) {
	const ctx = audio();
	const now = ctx.currentTime + delay;
	const osc = ctx.createOscillator();
	const gain = ctx.createGain();
	osc.type = type;
	osc.frequency.setValueAtTime(from, now);
	osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration);
	envelope(gain, now, 0.01, duration * 0.4, duration * 0.6, peak * volume());
	osc.connect(gain).connect(ctx.destination);
	osc.start(now);
	osc.stop(now + duration + 0.05);
}

function noise(duration, filterFrom, filterTo, peak = 0.3, q = 1, delay = 0) {
	const ctx = audio();
	const now = ctx.currentTime + delay;
	const src = ctx.createBufferSource();
	src.buffer = noiseBuffer;
	const filter = ctx.createBiquadFilter();
	filter.type = "bandpass";
	filter.Q.value = q;
	filter.frequency.setValueAtTime(filterFrom, now);
	filter.frequency.exponentialRampToValueAtTime(filterTo, now + duration);
	const gain = ctx.createGain();
	envelope(gain, now, 0.01, duration * 0.3, duration * 0.7, peak * volume());
	src.connect(filter).connect(gain).connect(ctx.destination);
	src.start(now);
	src.stop(now + duration + 0.05);
}

export const SYNTH = {
	capture: () => { noise(0.35, 400, 3000, 0.35, 2); tone("sine", 900, 120, 0.4, 0.3); tone("square", 300, 1200, 0.15, 0.08, 0.3); },
	trash: () => { noise(0.18, 2500, 600, 0.3, 3); tone("triangle", 600, 200, 0.15, 0.12); },
	hurt: () => { tone("square", 220, 70, 0.3, 0.25); noise(0.15, 1500, 400, 0.25, 4); },
	ghost_laugh: () => { [0, 0.12, 0.24].forEach((d, i) => tone("sine", 700 + i * 90, 500 + i * 60, 0.11, 0.12, d)); },
	heart: () => { tone("sine", 660, 660, 0.12, 0.2); tone("sine", 990, 990, 0.2, 0.2, 0.1); },
	vacuum_start: () => { tone("sawtooth", 80, 320, 0.3, 0.1); },
	victory: () => { [523, 659, 784, 1046].forEach((f, i) => tone("triangle", f, f, 0.22, 0.2, i * 0.14)); },
	game_over: () => { [392, 370, 349, 262].forEach((f, i) => tone("sawtooth", f, f * 0.97, 0.35, 0.12, i * 0.3)); },
	door: () => { tone("sawtooth", 140, 90, 0.6, 0.05); noise(0.6, 300, 900, 0.08, 8); },
};

// Looping vacuum hum with a pitch that follows "load" (0..1).
let hum = null;

export function StartHum() {
	if (hum) return;
	const ctx = audio();
	const src = ctx.createBufferSource();
	src.buffer = noiseBuffer;
	src.loop = true;
	const filter = ctx.createBiquadFilter();
	filter.type = "lowpass";
	filter.frequency.value = 900;
	const motor = ctx.createOscillator();
	motor.type = "sawtooth";
	motor.frequency.value = 95;
	const motorGain = ctx.createGain();
	motorGain.gain.value = 0.05;
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, ctx.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.12 * volume() + 0.0002, ctx.currentTime + 0.15);
	src.connect(filter).connect(gain);
	motor.connect(motorGain).connect(gain);
	gain.connect(ctx.destination);
	src.start();
	motor.start();
	hum = { src, motor, filter, gain };
}

export function SetHumLoad(load) {
	if (!hum) return;
	const ctx = audio();
	hum.filter.frequency.setTargetAtTime(900 + load * 1400, ctx.currentTime, 0.05);
	hum.motor.frequency.setTargetAtTime(95 + load * 35, ctx.currentTime, 0.05);
}

export function StopHum() {
	if (!hum) return;
	const ctx = audio();
	const current = hum;
	hum = null;
	current.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
	current.src.stop(ctx.currentTime + 0.3);
	current.motor.stop(ctx.currentTime + 0.3);
}
