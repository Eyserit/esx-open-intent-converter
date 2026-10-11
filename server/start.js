import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMerakiClient } from './meraki-client.js';
import { createRoutes } from './meraki-routes.js';
import { createAppServer } from './server.js';

const port = Number(process.env.PORT ?? 8000);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = createMerakiClient({ fetch, sleep: (ms) => new Promise((done) => setTimeout(done, ms)) });

// Bound to loopback only, so nothing else on the network can reach the relay.
createAppServer({ root, routes: createRoutes(client) }).listen(port, '127.0.0.1', () => {
  process.stdout.write(`Converter running at http://localhost:${port} — press Ctrl+C to stop.\n`);
});
