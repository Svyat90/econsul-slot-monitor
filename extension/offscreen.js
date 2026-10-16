// Plays sounds for the background service worker, which has no DOM and no Web Audio.
// Messages: { target: 'offscreen', type: 'play', sound: 'glass' | 'chime' | 'draft' | 'reminder' | 'selected', minMs?, maxMs? }
//           { target: 'offscreen', type: 'stop', force? }
// The "selected" alarm repeats every second for at least minMs and at most maxMs. stop with
// force (the user pressed "Вимкнути звук") ends it at once; without force (an automatic reason)
// it ends only after minMs.
let ctx = null;
const alarm = { timer: null, startedAt: 0, minMs: 0, stopRequested: false };

function audio() {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
}

function startAlarm(minMs, maxMs) {
    stopAlarm('restart');
    alarm.startedAt = Date.now();
    alarm.minMs = minMs;
    alarm.stopRequested = false;
    EconsulSounds.selectedBeat(audio());
    alarm.timer = setInterval(() => {
        const elapsed = Date.now() - alarm.startedAt;
        if (elapsed >= maxMs) return stopAlarm('timeout');
        if (alarm.stopRequested && elapsed >= alarm.minMs) return stopAlarm('requested');
        EconsulSounds.selectedBeat(audio());
    }, 1000);
}

function stopAlarm(reason) {
    if (!alarm.timer) return;
    clearInterval(alarm.timer);
    alarm.timer = null;
    chrome.runtime.sendMessage({ type: 'offscreen:alarm-ended', reason, playedMs: Date.now() - alarm.startedAt }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.target !== 'offscreen') return;
    if (message.type === 'ping') {
        sendResponse({ ok: true });
    } else if (message.type === 'play') {
        if (message.sound === 'selected') startAlarm(message.minMs ?? 30000, message.maxMs ?? 120000);
        else if (message.sound === 'glass') EconsulSounds.glass(audio());
        else if (message.sound === 'chime') EconsulSounds.chime(audio());
        else if (message.sound === 'draft') EconsulSounds.draftSaved(audio());
        else if (message.sound === 'reminder') EconsulSounds.reminder(audio());
        sendResponse({ ok: true, state: audio().state });
    } else if (message.type === 'stop') {
        if (message.force) stopAlarm('muted');
        else alarm.stopRequested = true;
        sendResponse({ ok: true });
    } else if (message.type === 'status') {
        sendResponse({ playing: !!alarm.timer, elapsedMs: alarm.timer ? Date.now() - alarm.startedAt : 0 });
    }
});
