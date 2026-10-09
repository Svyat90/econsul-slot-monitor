// Web Audio sounds, no files. The two alerts must be easy to tell apart.
// Ported from slots.html; the glass sound is the same as glass() in extension/sounds.js:
// keep the two copies in sync.

type AudioWindow = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

type Note = readonly [frequency: number, duration: number];

export interface Sounds {
  unlock(): void;
  ready(): boolean;
  playSlotSound(): void;
  playSessionSound(): void;
}

export const createSounds = (win: Window): Sounds => {
  let audio: AudioContext | null = null;

  // Created inside a click so the sounds can play later.
  const getAudio = (): AudioContext => {
    if (!audio) {
      const w = win as AudioWindow;
      const Ctor = w.AudioContext || w.webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio is not supported');
      audio = new Ctor();
    }
    const ctx = audio;
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  };

  const playTones = (notes: readonly Note[], waveType: OscillatorType): void => {
    const ctx = getAudio();
    let at = ctx.currentTime + 0.05;
    notes.forEach(([frequency, duration]) => {
      if (frequency) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = waveType;
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.3, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + duration + 0.02);
      }
      at += duration;
    });
  };

  const glassTone = (ctx: AudioContext, frequency: number, at: number, duration: number, level: number): void => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  };

  // A burst of high-passed white noise with a sharp decay, then a dozen short high "tinkles"
  // (3-6 kHz) at random delays.
  const glassCrash = (ctx: AudioContext, at: number): void => {
    const length = Math.round(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 1800;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.55, at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.08, at + 0.06);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    noise.connect(highpass).connect(gain).connect(ctx.destination);
    noise.start(at);
    noise.stop(at + 0.5);

    const pieces = 10 + Math.floor(Math.random() * 5);
    for (let i = 0; i < pieces; i++) {
      const t = at + 0.02 + Math.pow(Math.random(), 1.6) * 0.95;
      const frequency = 3000 + Math.random() * 3000;
      const duration = 0.06 + Math.random() * 0.18;
      const level = 0.06 + Math.random() * 0.12;
      glassTone(ctx, frequency, t, duration, level);
      glassTone(ctx, frequency * 1.47, t, duration * 0.7, level * 0.5); // inharmonic overtone
    }
  };

  return {
    unlock: () => {
      getAudio();
    },
    ready: () => audio !== null && audio.state === 'running',
    // Free slots: bright rising chime (A5-C#6-E6), three times
    playSlotSound: () => {
      const chime: Note[] = [
        [880, 0.15],
        [1109, 0.15],
        [1319, 0.3],
        [0, 0.25],
      ];
      playTones([...chime, ...chime, ...chime], 'sine');
    },
    // Session lost: broken glass, twice
    playSessionSound: () => {
      const ctx = getAudio();
      const start = ctx.currentTime + 0.05;
      glassCrash(ctx, start);
      glassCrash(ctx, start + 1.25);
    },
  };
};
