import { createRequest } from './meraki-request.js';

export { MerakiError, redact } from './meraki-request.js';

export function createMerakiClient({ fetch, sleep }) {
  const request = createRequest({ fetch, sleep });
  return { _request: request };
}
