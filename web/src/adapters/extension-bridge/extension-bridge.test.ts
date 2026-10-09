import { describe, expect, it, vi } from 'vitest';
import type { ExtMessage } from '@/domain/contracts/extension-messages.ts';
import { createExtensionBridge } from './extension-bridge.ts';

function deliver(init: { data: unknown; origin?: string; source?: MessageEventSource | null }) {
    window.dispatchEvent(
        new MessageEvent('message', {
            data: init.data,
            origin: init.origin ?? window.location.origin,
            source: init.source === undefined ? window : init.source,
        }),
    );
}

const hello = { source: 'econsul-ext', type: 'ext:hello', version: '1.2.3' };

describe('createExtensionBridge', () => {
    it('delivers a valid ext:hello from this window and origin', () => {
        const listener = vi.fn<(m: ExtMessage) => void>();
        createExtensionBridge(window).subscribe(listener);
        deliver({ data: hello });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0]?.[0]).toMatchObject({ type: 'ext:hello', version: '1.2.3' });
    });

    it('drops other origin, other source window, app echo, unknown type and junk', () => {
        const listener = vi.fn();
        createExtensionBridge(window).subscribe(listener);
        deliver({ data: hello, origin: 'https://evil.example' });
        deliver({ data: hello, source: null });
        deliver({ data: hello, source: {} as MessageEventSource });
        deliver({ data: { ...hello, source: 'econsul-app' } });
        deliver({ data: { source: 'econsul-ext', type: 'ext:nope' } });
        deliver({ data: 'text' });
        deliver({ data: null });
        expect(listener).not.toHaveBeenCalled();
    });

    it('send adds source and posts to the own origin', () => {
        const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
        createExtensionBridge(window).send({ type: 'app:hello', audioReady: true });
        expect(postMessage).toHaveBeenCalledWith(
            { type: 'app:hello', audioReady: true, source: 'econsul-app' },
            window.location.origin,
        );
        postMessage.mockRestore();
    });

    it('unsubscribe stops delivery', () => {
        const listener = vi.fn();
        const off = createExtensionBridge(window).subscribe(listener);
        off();
        deliver({ data: hello });
        expect(listener).not.toHaveBeenCalled();
    });
});
