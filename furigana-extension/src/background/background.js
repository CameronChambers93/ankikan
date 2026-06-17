'use strict';

import { readDictFile } from '../shared/dict-store.js';

/** Cross-browser API shim — resolves to `browser` (Firefox) or `chrome` (Chromium). */
const ext = typeof browser !== 'undefined' ? browser : chrome;

/**
 * Routes messages from content scripts and the popup to the appropriate local HTTP service.
 *
 * Handled actions:
 *   - `ankiQuery`: proxies the request body to AnkiConnect on port 8765 and returns the
 *     parsed JSON response, or `{result: null, error: '...'}` if the server is unreachable.
 *   - `lemmaQuery`: proxies the request body to the lemma server on port 7654 and returns
 *     the parsed JSON response, or `{}` on failure.
 *
 * The service worker acts as a proxy because content scripts cannot reach localhost services
 * directly due to CORS restrictions in some browser configurations.
 */
ext.runtime.onMessage.addListener((msg) => {
  if (msg.action === 'ankiQuery') {
    return fetch('http://127.0.0.1:8765', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.body),
    })
      .then((r) => r.json())
      .catch(() => ({ result: null, error: 'Could not connect to AnkiConnect' }));
  }
  if (msg.action === 'lemmaQuery') {
    return fetch('http://127.0.0.1:7654', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.body),
    })
      .then((r) => r.json())
      .catch(() => ({}));
  }
  if (msg.action === 'getDictFile') {
    return readDictFile(msg.name)
      .then((buf) => {
        if (!buf) return null;
        // Chrome's message passing serialises ArrayBuffers as {} via JSON.
        // Return base64 so the binary data survives the round trip.
        const bytes = new Uint8Array(buf);
        let binary = '';
        const chunk = 8192;
        for (let i = 0; i < bytes.byteLength; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.byteLength)));
        }
        return btoa(binary);
      })
      .catch(() => null);
  }
});
