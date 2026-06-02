'use strict';

const ext = typeof browser !== 'undefined' ? browser : chrome;

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
});
