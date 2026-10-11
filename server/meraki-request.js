import { REGIONS } from '../src/meraki-regions.js';

const TIMEOUT_MS = 120000;
const MAX_RETRY_AFTER_S = 60;
const MAX_RETRIES = 3;
const MAX_REDIRECTS = 3;
export const GENERIC_MESSAGE = 'Something went wrong talking to Meraki.';

export class MerakiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'MerakiError';
    this.status = status;
  }
}

export function redact(text, apiKey) {
  if (!apiKey) return text;
  return text.replaceAll(apiKey, '[redacted]');
}

function retryDelayMs(retryAfter) {
  const seconds = Number.parseInt(retryAfter, 10);
  // Capped so a hostile or broken Retry-After can't freeze an upload.
  return Math.min(Number.isNaN(seconds) ? 1 : seconds, MAX_RETRY_AFTER_S) * 1000;
}

function parseUrl(location, base) {
  try {
    return new URL(location, base);
  } catch {
    return null;
  }
}

export function isWithinDomain(url, domain) {
  return url.protocol === 'https:' && (url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}

async function readJson(res) {
  const text = await res.text();
  return text === '' ? null : JSON.parse(text);
}

async function errorText(res) {
  try {
    const { errors } = await res.json();
    return Array.isArray(errors) ? errors.join(' ') : '';
  } catch {
    return '';
  }
}

export function createRequest({ fetch, sleep }) {
  return async function request({ region, apiKey, forbiddenMeansBadKey }, method, path, body) {
    const fail = (status, message) => new MerakiError(status, redact(message, apiKey));
    if (!Object.hasOwn(REGIONS, region)) throw fail(400, 'Unknown Meraki region.');
    const { host, label, domain } = REGIONS[region];
    const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let url = `https://${host}/api/v1${path}`;
    if (path.startsWith('https://')) {
      // An absolute URL (a paging link) would otherwise carry the key to any host.
      const absolute = parseUrl(path);
      if (!absolute || !isWithinDomain(absolute, domain)) throw fail(502, GENERIC_MESSAGE);
      url = absolute.href;
    }
    let retries = 0;
    let hops = 0;
    for (;;) {
      let res;
      try {
        res = await fetch(url, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        // The thrown error's text can echo the URL, so it is dropped rather than relayed.
        throw fail(502, `Couldn't reach ${new URL(url).hostname}.`);
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('Location');
        const next = location && parseUrl(location, url);
        // Following a redirect elsewhere would hand the API key to that host.
        if (!next || !isWithinDomain(next, domain) || hops++ === MAX_REDIRECTS) {
          throw fail(502, GENERIC_MESSAGE);
        }
        url = next.href;
        continue;
      }
      if (res.status === 429) {
        if (retries++ === MAX_RETRIES) {
          throw fail(429, 'Meraki is rate-limiting requests — try again in a minute.');
        }
        await sleep(retryDelayMs(res.headers.get('Retry-After')));
        continue;
      }
      // Listing organisations is the first call with a new key, so 403 there means the key is no good.
      if (res.status === 401 || (res.status === 403 && forbiddenMeansBadKey)) throw fail(401, `That API key wasn't accepted by Meraki (${label}).`);
      if (res.status >= 500) throw fail(502, GENERIC_MESSAGE);
      if (res.status >= 400) throw fail(502, (await errorText(res)) || GENERIC_MESSAGE);
      let json;
      try {
        json = await readJson(res);
      } catch {
        // Parser errors quote the body, which may echo the key.
        throw fail(502, GENERIC_MESSAGE);
      }
      return { json, headers: res.headers };
    }
  }}
