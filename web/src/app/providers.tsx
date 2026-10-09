import type { ReactNode } from 'react';

// Composition root: dependencies (ports -> adapters) are wired here from stage 3 on.
export function AppProviders({ children }: { children: ReactNode }) {
    return <>{children}</>;
}
