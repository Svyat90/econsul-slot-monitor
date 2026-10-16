// Content script on http://localhost:4000/*: a bridge between the page of the app (slots.html)
// and the background. The page talks to it with window.postMessage, so it does not need the
// extension ID. Only messages from this window and this origin with source 'econsul-app' are
// passed on; replies go back to this origin only.
// Runs at document_start, so it listens before the page sends its first app:hello.

// Wrapped in a function: the background injects this file again into open tabs after an
// extension reload, and top-level consts would clash with the orphaned copy
(() => {
    const FROM_APP = 'econsul-app';
    const FROM_EXT = 'econsul-ext';

    function post(msg) {
        window.postMessage({ ...msg, source: FROM_EXT }, window.location.origin);
    }

    function forward(msg) {
        chrome.runtime.sendMessage({ type: 'app', msg })
            .then(reply => (reply && reply.messages || []).forEach(post))
            .catch(() => {});
    }

    function onPageMessage(event) {
        // After the extension is reloaded this copy is orphaned (a fresh one is injected by the
        // background): go quiet, the page notices the missing replies to its app:hello
        if (!chrome.runtime || !chrome.runtime.id) {
            window.removeEventListener('message', onPageMessage);
            return;
        }
        if (event.source !== window || event.origin !== window.location.origin) return;
        const msg = event.data;
        if (!msg || msg.source !== FROM_APP || typeof msg.type !== 'string' || !msg.type.startsWith('app:')) return;
        const { source, ...rest } = msg;
        forward(rest);
    }

    window.addEventListener('message', onPageMessage);

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.to === 'bridge' && message.type === 'ping') sendResponse({ ok: true });
        else if (message.to === 'app' && message.msg) post(message.msg);
    });

    // If the page is already listening (bridge injected into an open tab), let it know
    post({ type: 'ext:hello', version: chrome.runtime.getManifest().version });
})();
