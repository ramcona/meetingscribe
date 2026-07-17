import test from 'node:test';
import assert from 'node:assert';
import { app, server } from '../src/index.js';

test('Server Ping Test', async (t) => {
  const PORT = server.address().port;
  try {
    const res = await fetch(`http://localhost:${PORT}/api/ping`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.message, 'pong');
  } finally {
    server.close();
  }
});
