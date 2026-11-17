// Motion Bowling server: serves the TV game and phone controller pages,
// and relays messages between them over WebSocket.
// No npm dependencies of its own (three.js and MediaPipe are served as static files), so it runs
// on a phone under Termux with plain `node server.js`.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const THREE_FILE = path.join(__dirname, 'node_modules', 'three', 'build', 'three.module.min.js');
const MEDIAPIPE = path.join(__dirname, 'node_modules', '@mediapipe', 'tasks-vision');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  // Prefer typical home Wi-Fi ranges first.
  return out.sort((a, b) => Number(!a.startsWith('192.168.')) - Number(!b.startsWith('192.168.')));
}

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);

  if (p === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ port: PORT, ips: lanAddresses(), peers: peerCounts() }));
  }
  if (p === '/lib/three.module.min.js') return sendFile(res, THREE_FILE);
  if (p.startsWith('/lib/mediapipe/')) {
    const f = path.normalize(path.join(MEDIAPIPE, p.slice('/lib/mediapipe/'.length)));
    return f.startsWith(MEDIAPIPE) ? sendFile(res, f) : (res.writeHead(403), res.end());
  }
  if (p === '/') p = '/index.html';
  if (p === '/tv' || p === '/tv/') p = '/tv.html';
  if (p === '/controller' || p === '/controller/' || p === '/c') p = '/controller.html';
  if (p === '/camera' || p === '/camera/') p = '/camera.html';

  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end();
  }
  sendFile(res, file);
});

// ---------------------------------------------------------------------------
// Minimal WebSocket implementation (RFC 6455): text frames, ping/pong, close.
// ---------------------------------------------------------------------------
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set(); // { socket, role, alive, buf }

function peerCounts() {
  let tv = 0, controller = 0;
  for (const c of clients) c.role === 'tv' ? tv++ : controller++;
  return { tv, controller };
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x80 | opcode, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function send(client, obj) {
  if (client.socket.destroyed) return;
  client.socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(obj))));
}

function broadcastPeers() {
  const msg = { type: 'peers', ...peerCounts() };
  for (const c of clients) send(c, msg);
}

function relay(from, msg) {
  const target = from.role === 'tv' ? 'controller' : 'tv';
  for (const c of clients) if (c.role === target) send(c, msg);
}

function drop(client) {
  if (!clients.delete(client)) return;
  client.socket.destroy();
  console.log(`- ${client.role} disconnected`);
  broadcastPeers();
}

function onData(client, chunk) {
  client.buf = Buffer.concat([client.buf, chunk]);
  while (client.buf.length >= 2) {
    const b = client.buf;
    const opcode = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < 4) return;
      len = b.readUInt16BE(2); off = 4;
    } else if (len === 127) {
      if (b.length < 10) return;
      len = Number(b.readBigUInt64BE(2)); off = 10;
    }
    const maskOff = off;
    if (masked) off += 4;
    if (b.length < off + len) return; // wait for the rest of the frame

    const payload = Buffer.from(b.subarray(off, off + len));
    if (masked) for (let i = 0; i < len; i++) payload[i] ^= b[maskOff + (i & 3)];
    client.buf = b.subarray(off + len);

    if (opcode === 0x8) return drop(client);
    if (opcode === 0x9) { client.socket.write(encodeFrame(0xA, payload)); continue; }
    if (opcode === 0xA) { client.alive = true; continue; }
    if (opcode !== 0x1) continue;

    let msg;
    try { msg = JSON.parse(payload.toString('utf8')); } catch { continue; }
    client.alive = true;
    if (msg.type === 'ping') { send(client, { type: 'pong', t: msg.t }); continue; }
    relay(client, msg);
  }
}

server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== '/ws' || !key) return socket.destroy();

  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  socket.setNoDelay(true); // send motion data immediately, no batching

  const role = url.searchParams.get('role') === 'tv' ? 'tv' : 'controller';
  const client = { socket, role, alive: true, buf: Buffer.alloc(0) };
  clients.add(client);
  console.log(`+ ${role} connected (${req.socket.remoteAddress})`);

  socket.on('data', (d) => onData(client, d));
  socket.on('close', () => drop(client));
  socket.on('error', () => drop(client));
  broadcastPeers();
});

// Drop clients that stop answering (e.g. TV switched off).
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { drop(c); continue; }
    c.alive = false;
    c.socket.write(encodeFrame(0x9, Buffer.alloc(0)));
  }
}, 10000);

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanAddresses();
  console.log('\n  Motion Bowling is running\n');
  console.log(`  Phone, camera mode:  http://localhost:${PORT}/camera   (phone on a stand, facing you)`);
  console.log(`  Phone, motion mode:  http://localhost:${PORT}/controller   (phone in your hand)`);
  if (ips.length) {
    for (const ip of ips) console.log(`  TV (game):           http://${ip}:${PORT}/tv`);
  } else {
    console.log('  No Wi-Fi address found. Is the phone connected to Wi-Fi?');
  }
  console.log('\n  Press Ctrl+C to stop.\n');
});
