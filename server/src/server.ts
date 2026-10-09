import { buildApp } from './app.ts';
import { loadConfig } from './platform/config.ts';
import { createContainer } from './platform/container.ts';

const config = loadConfig();
const container = createContainer(config);
const app = await buildApp({ ...container, config, logger: true });

let closing = false;
async function shutdown() {
    if (closing) return;
    closing = true;
    await app.close();
    await container.close();
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

await app.listen({ host: config.host, port: config.port });
