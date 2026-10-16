// Sound generators (Web Audio, no files). The glass sound is the same as playSessionSound()
// in slots.html: keep the two copies in sync. The three alerts must be easy to tell apart:
// chime = new slots, double beeps = slot selected, broken glass = session ended, soft low
// two-note "ding-dong" = draft saved (calm: nothing to do right now), three bell strokes = a
// reminder before the location opens (log in / start the monitor).
const EconsulSounds = (() => {
    // Free slots: bright rising chime (A5–C#6–E6), three times. Same as playSlotSound() in slots.html
    function chime(ctx) {
        const notes = [[880, 0.15], [1109, 0.15], [1319, 0.3], [0, 0.25]];
        let at = ctx.currentTime + 0.05;
        for (let i = 0; i < 3; i++) {
            notes.forEach(([frequency, duration]) => {
                if (frequency) tone(ctx, frequency, at, duration, 0.3, 'sine');
                at += duration;
            });
        }
        return at - ctx.currentTime;
    }

    // Slot selected: fast high double beep (G6, C7). One call = one second of sound
    function selectedBeat(ctx) {
        const at = ctx.currentTime + 0.02;
        tone(ctx, 1568, at, 0.09, 0.28, 'triangle');
        tone(ctx, 2093, at + 0.13, 0.09, 0.28, 'triangle');
        tone(ctx, 1568, at + 0.4, 0.09, 0.28, 'triangle');
        tone(ctx, 2093, at + 0.53, 0.09, 0.28, 'triangle');
        return 1;
    }

    // Draft saved: two soft low notes going up (E5, A5), sine with a slow decay; once
    function draftSaved(ctx) {
        const at = ctx.currentTime + 0.05;
        tone(ctx, 659, at, 0.45, 0.28, 'sine', 0.015);
        tone(ctx, 880, at + 0.28, 0.7, 0.28, 'sine', 0.015);
        return 1.1;
    }

    // Reminder: three strokes of a low bell (C5 with an octave overtone), 0.6 s apart
    function reminder(ctx) {
        const start = ctx.currentTime + 0.05;
        for (let i = 0; i < 3; i++) {
            tone(ctx, 523, start + i * 0.6, 0.55, 0.3, 'sine', 0.01);
            tone(ctx, 1046, start + i * 0.6, 0.35, 0.12, 'sine', 0.01);
        }
        return 1.9;
    }

    // Session ended: broken glass, twice. A burst of high-passed white noise with a sharp decay,
    // then a dozen short high "tinkles" (3–6 kHz) at random delays
    function glass(ctx) {
        const start = ctx.currentTime + 0.05;
        glassCrash(ctx, start);
        glassCrash(ctx, start + 1.25);
        return 2.6;
    }

    function glassCrash(ctx, at) {
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
            tone(ctx, frequency, t, duration, level, 'sine', 0.002);
            tone(ctx, frequency * 1.47, t, duration * 0.7, level * 0.5, 'sine', 0.002); // inharmonic overtone
        }
    }

    function tone(ctx, frequency, at, duration, level, waveType, attack = 0.01) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = waveType;
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(level, at + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + duration + 0.02);
    }

    return { chime, selectedBeat, glass, draftSaved, reminder };
})();
