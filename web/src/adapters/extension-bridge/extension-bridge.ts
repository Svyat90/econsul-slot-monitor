import type { AppMessageBody, ExtensionBridge } from '@/application/ports.ts';
import { extMessageSchema } from '@/domain/contracts/extension-messages.ts';

// window.postMessage side of the protocol; the content script extension/app-bridge.js is the
// other end. Both directions are pinned to this window and this origin.
export function createExtensionBridge(win: Window = window): ExtensionBridge {
    return {
        send(message: AppMessageBody) {
            win.postMessage({ ...message, source: 'econsul-app' }, win.location.origin);
        },
        subscribe(listener) {
            const onMessage = (event: MessageEvent) => {
                if (event.source !== win || event.origin !== win.location.origin) return;
                const parsed = extMessageSchema.safeParse(event.data);
                if (parsed.success) listener(parsed.data);
            };
            win.addEventListener('message', onMessage);
            return () => win.removeEventListener('message', onMessage);
        },
    };
}
