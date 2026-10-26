/*
 * Smoke test: starts the notes-server and multiplex plugins, checks that they
 * serve the slides and their respective endpoints, then shuts them down.
 *
 * Usage: node test/smoke-test.js
 */

const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { io: connect } = require('socket.io-client');

const root = path.join(__dirname, '..');

function request(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error(`timeout waiting for ${port}${urlPath}`)); });
  });
}

async function waitUntilUp(port, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await request(port, '/');
      return res;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`server on port ${port} did not come up in time`);
}

function startServer(file, port) {
  const child = spawn(process.execPath, [path.join(root, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const timer = setTimeout(() => { child.kill('SIGKILL'); }, 30000);
  return { child, timer };
}

function stopServer({ child, timer }) {
  clearTimeout(timer);
  child.kill('SIGTERM');
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    console.error(`FAIL - ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

function expect(cond, message) {
  if (!cond) throw new Error(message);
}

function connectSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
    const timer = setTimeout(() => { socket.close(); reject(new Error('socket connect timed out')); }, 10000);
    socket.on('connect', () => { clearTimeout(timer); resolve(socket); });
    socket.on('connect_error', (e) => { clearTimeout(timer); reject(e); });
  });
}

function once(socket, event, tries = 50) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, handler); reject(new Error(`timed out waiting for ${event}`)); }, 10000);
    const handler = (data) => { clearTimeout(timer); resolve(data); };
    socket.on(event, handler);
  });
}

(async () => {
  // --- notes-server (port 1947) ---
  const notes = startServer('plugin/notes-server/index.js', 1947);
  try {
    await check('notes-server serves the slides at /', async () => {
      const res = await waitUntilUp(1947);
      expect(res.status === 200, `expected 200, got ${res.status}`);
      expect(/<html/i.test(res.body), 'response does not look like the slides HTML');
    });
    await check('notes-server serves the notes page', async () => {
      const res = await request(1947, '/notes/smoke-test');
      expect(res.status === 200, `expected 200, got ${res.status}`);
      expect(/socket\.io/.test(res.body), 'notes page does not load socket.io');
    });
    await check('notes-server serves the socket.io client bundle', async () => {
      const res = await request(1947, '/socket.io/socket.io.js');
      expect(res.status === 200, `expected 200, got ${res.status}`);
    });
    await check('notes-server relays slide state over socket.io', async () => {
      const a = await connectSocket(1947);
      const b = await connectSocket(1947);
      const received = once(b, 'new-subscriber');
      a.emit('new-subscriber', { state: { indexh: 1, indexv: 0, overview: false } });
      const data = await received;
      expect(data && data.state && data.state.indexh === 1, 'broadcast payload was not relayed');
      a.close();
      b.close();
    });
  } finally {
    stopServer(notes);
  }

  // --- multiplex (port 1948) ---
  const multiplex = startServer('plugin/multiplex/index.js', 1948);
  try {
    await check('multiplex serves the slides at /', async () => {
      const res = await waitUntilUp(1948);
      expect(res.status === 200, `expected 200, got ${res.status}`);
      expect(/<html/i.test(res.body), 'response does not look like the slides HTML');
    });
    await check('multiplex /token returns secret and socketId', async () => {
      const res = await request(1948, '/token');
      expect(res.status === 200, `expected 200, got ${res.status}`);
      const token = JSON.parse(res.body);
      expect(typeof token.secret === 'string' && token.secret.length > 0, 'missing secret');
      expect(typeof token.socketId === 'string' && token.socketId.length > 0, 'missing socketId');
    });
    await check('multiplex relays state for a valid token over socket.io', async () => {
      const tokenRes = await request(1948, '/token');
      const token = JSON.parse(tokenRes.body);
      const a = await connectSocket(1948);
      const b = await connectSocket(1948);
      const received = once(b, token.socketId);
      a.emit('multiplex-statechanged', { secret: token.secret, socketId: token.socketId, state: { indexh: 2, indexv: 1 } });
      const data = await received;
      expect(data && data.state && data.state.indexh === 2, 'state was not relayed');
      expect(data.secret === null, 'secret should be stripped before broadcast');
      a.close();
      b.close();
    });
  } finally {
    stopServer(multiplex);
  }

  if (process.exitCode) {
    console.error('smoke test failed');
  } else {
    console.log('smoke test passed');
  }
})();
