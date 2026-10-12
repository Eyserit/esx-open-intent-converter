import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const pageFiles = ['index.html', 'styles.css', 'app.js', 'meraki-flow.js', 'map-place.js'];

const jsUnder = (dir) => readdirSync(join(root, dir), { recursive: true })
  .filter((name) => name.endsWith('.js'))
  .map((name) => join(dir, name));

// Plain http is only ever the user's own local server, plus a licence link in a comment.
const ALLOWED = [/^http:\/\/localhost\b/, /^http:\/\/\$\{host\}/, /^http:\/\/www\.apache\.org\/licenses\//];

test('the shipped code only ever addresses outside hosts over https', () => {
  const offenders = [];
  for (const file of [...pageFiles, ...jsUnder('src'), ...jsUnder('server')]) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const [url] of text.matchAll(/http:\/\/[^\s'"`)>]+/gi)) {
      if (!ALLOWED.some((pattern) => pattern.test(url))) offenders.push(`${file}: ${url}`);
    }
  }
  assert.deepEqual(offenders, []);
});
