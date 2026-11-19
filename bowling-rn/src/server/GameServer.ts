// Motion Bowling server core: a tiny HTTP server for the game pages plus a WebSocket relay
// between the TV page and the phone pages. It works on raw TCP sockets, so the same code runs
// inside the React Native app (react-native-tcp-socket) and on a desktop (Node's `net`).
import { base64, sha1, utf8 } from './sha1';
import type { ServerInfo } from '../../web/src/protocol';

export const PORT = 3000;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** The minimum a TCP socket must offer. Node's net.Socket and react-native-tcp-socket both fit. */
export interface RawSocket {
  write(data: Uint8Array | string): unknown;
  destroy(): unknown;
  setNoDelay?(on?: boolean): unknown;
  /** Resolves once the data has been handed to the OS. Used for large HTTP bodies. */
  writeAsync?(data: Uint8Array): Promise<void>;
  /** Closes after pending writes are flushed. */
  end?(): unknown;
  on(event: 'data', cb: (d: Uint8Array | string) => void): unknown;
  on(event: 'close' | 'error', cb: (...args: unknown[]) => void): unknown;
}

export interface Platform {
  /** Returns the file at a path under the web root (e.g. "tv.html"), or null if missing. */
  readFile(path: string): Promise<Uint8Array | null>;
  lanAddresses(): Promise<string[]>;
  log?(msg: string): void;
}

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  png: 'image/png',
  svg: 'image/svg+xml',
  wasm: 'application/wasm',
  task: 'application/octet-stream',
};

const ROUTES: Record<string, string> = {
  '/': 'index.html', '/tv': 'tv.html', '/tv/': 'tv.html',
  '/controller': 'controller.html', '/controller/': 'controller.html', '/c': 'controller.html',
  '/camera': 'camera.html', '/camera/': 'camera.html',
};

type ClientRole = 'tv' | 'controller';
interface Client { socket: RawSocket; role: ClientRole; alive: boolean; buf: Uint8Array }

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length);
  return out;
};
const toBytes = (d: Uint8Array | string): Uint8Array => (typeof d === 'string' ? utf8.encode(d) : new Uint8Array(d));

export function encodeFrame(opcode: number, payload: Uint8Array): Uint8Array {
  const len = payload.length;
  let header: Uint8Array;
  if (len < 126) header = Uint8Array.of(0x80 | opcode, len);
  else if (len < 65536) header = Uint8Array.of(0x80 | opcode, 126, len >> 8, len & 255);
  else {
    header = new Uint8Array(10);
    header[0] = 0x80 | opcode; header[1] = 127;
    new DataView(header.buffer).setUint32(6, len);
  }
  return concat(header, payload);
}

export class GameServer {
  private clients = new Set<Client>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private platform: Platform, readonly port = PORT) {}

  private log(msg: string): void { (this.platform.log ?? console.log)(msg); }

  /** Call when the TCP listener is up. Starts dropping clients that stop answering (e.g. TV switched off). */
  start(): void {
    if (this.pingTimer) return;
    this.pingTimer = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) { this.drop(c); continue; }
        c.alive = false;
        c.socket.write(encodeFrame(0x9, new Uint8Array(0)));
      }
    }, 10000);
  }

  stop(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    for (const c of this.clients) c.socket.destroy();
    this.clients.clear();
  }

  peerCounts(): { tv: number; controller: number } {
    let tv = 0, controller = 0;
    for (const c of this.clients) if (c.role === 'tv') tv++; else controller++;
    return { tv, controller };
  }

  async info(): Promise<ServerInfo> {
    return { port: this.port, ips: await this.platform.lanAddresses(), peers: this.peerCounts() };
  }

  /** Hand every accepted TCP connection to this. */
  handleConnection(socket: RawSocket): void {
    socket.setNoDelay?.(true); // send motion data immediately, no batching
    let head = new Uint8Array(0);
    let upgraded: Client | null = null;

    socket.on('data', (d) => {
      const chunk = toBytes(d);
      if (upgraded) { this.onWsData(upgraded, chunk); return; }
      head = concat(head, chunk);
      const end = indexOfHeaderEnd(head);
      if (end < 0) { if (head.length > 16384) socket.destroy(); return; }
      const req = parseRequest(utf8.decode(head.subarray(0, end)));
      const rest = head.subarray(end + 4);
      head = new Uint8Array(0);
      if (!req) { socket.destroy(); return; }
      if ((req.headers.upgrade || '').toLowerCase() === 'websocket') {
        upgraded = this.upgrade(socket, req);
        if (upgraded && rest.length) this.onWsData(upgraded, rest);
      } else {
        void this.serveHttp(socket, req.path);
      }
    });
    socket.on('close', () => { if (upgraded) this.drop(upgraded); });
    socket.on('error', () => { if (upgraded) this.drop(upgraded); else socket.destroy(); });
  }

  // ---- HTTP ----------------------------------------------------------------------
  private async serveHttp(socket: RawSocket, rawPath: string): Promise<void> {
    let p: string;
    try { p = decodeURIComponent(splitPath(rawPath).pathname); } catch { return this.respond(socket, 400, 'text/plain', utf8.encode('Bad request')); }

    if (p === '/api/info') return this.respond(socket, 200, 'application/json', utf8.encode(JSON.stringify(await this.info())));
    const file = ROUTES[p] ?? p.replace(/^\/+/, '');
    if (file.split('/').some((seg) => seg === '..')) return this.respond(socket, 403, 'text/plain', utf8.encode('Forbidden'));
    const data = await this.platform.readFile(file).catch(() => null);
    if (!data) return this.respond(socket, 404, 'text/plain', utf8.encode('Not found'));
    const ext = file.slice(file.lastIndexOf('.') + 1);
    this.respond(socket, 200, MIME[ext] || 'application/octet-stream', data);
  }

  private respond(socket: RawSocket, status: number, type: string, body: Uint8Array): void {
    const text = { 200: 'OK', 400: 'Bad Request', 403: 'Forbidden', 404: 'Not Found' }[status] ?? 'OK';
    socket.write(
      `HTTP/1.1 ${status} ${text}\r\nContent-Type: ${type}\r\nContent-Length: ${body.length}\r\n` +
      'Cache-Control: no-cache\r\nConnection: close\r\n\r\n',
    );
    void this.writeBody(socket, body);
  }

  /** Writes a body in chunks, waiting for each to flush; some socket stacks drop data past their buffer otherwise. */
  private async writeBody(socket: RawSocket, body: Uint8Array): Promise<void> {
    const CHUNK = 64 * 1024;
    for (let off = 0; off < body.length; off += CHUNK) {
      const part = body.subarray(off, off + CHUNK);
      if (socket.writeAsync) {
        try { await socket.writeAsync(part); } catch { socket.destroy(); return; }
      } else socket.write(part);
    }
    if (socket.end) socket.end(); else setTimeout(() => socket.destroy(), 1000);
  }

  // ---- WebSocket (RFC 6455): text frames, ping/pong, close ---------------------------
  private upgrade(socket: RawSocket, req: Request): Client | null {
    const url = splitPath(req.path);
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== '/ws' || !key) { socket.destroy(); return null; }
    const accept = base64(sha1(utf8.encode(key + WS_GUID)));
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const role: ClientRole = url.query.role === 'tv' ? 'tv' : 'controller';
    const client: Client = { socket, role, alive: true, buf: new Uint8Array(0) };
    this.clients.add(client);
    this.log(`+ ${role} connected`);
    this.broadcastPeers();
    return client;
  }

  private send(c: Client, obj: unknown): void {
    c.socket.write(encodeFrame(0x1, utf8.encode(JSON.stringify(obj))));
  }

  private broadcastPeers(): void {
    const msg = { type: 'peers', ...this.peerCounts() };
    for (const c of this.clients) this.send(c, msg);
  }

  private relay(from: Client, msg: unknown): void {
    const target: ClientRole = from.role === 'tv' ? 'controller' : 'tv';
    for (const c of this.clients) if (c.role === target) this.send(c, msg);
  }

  private drop(c: Client): void {
    if (!this.clients.delete(c)) return;
    c.socket.destroy();
    this.log(`- ${c.role} disconnected`);
    this.broadcastPeers();
  }

  private onWsData(c: Client, chunk: Uint8Array): void {
    c.buf = concat(c.buf, chunk);
    while (c.buf.length >= 2) {
      const b = c.buf;
      const opcode = b[0] & 0x0f;
      const masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = (b[2] << 8) | b[3]; off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = new DataView(b.buffer, b.byteOffset).getUint32(6); off = 10;
      }
      const maskOff = off;
      if (masked) off += 4;
      if (b.length < off + len) return; // wait for the rest of the frame

      const payload = b.slice(off, off + len);
      if (masked) for (let i = 0; i < len; i++) payload[i] ^= b[maskOff + (i & 3)];
      c.buf = b.slice(off + len);

      if (opcode === 0x8) { this.drop(c); return; }
      if (opcode === 0x9) { c.socket.write(encodeFrame(0xa, payload)); continue; }
      if (opcode === 0xa) { c.alive = true; continue; }
      if (opcode !== 0x1) continue;

      let msg: { type?: string; t?: number };
      try { msg = JSON.parse(utf8.decode(payload)); } catch { continue; }
      c.alive = true;
      if (msg.type === 'ping') { this.send(c, { type: 'pong', t: msg.t }); continue; }
      this.relay(c, msg);
    }
  }
}

// ---- HTTP request parsing ------------------------------------------------------------
interface Request { method: string; path: string; headers: Record<string, string> }

function indexOfHeaderEnd(b: Uint8Array): number {
  for (let i = 0; i + 3 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  return -1;
}

function parseRequest(head: string): Request | null {
  const lines = head.split('\r\n');
  const [method, path] = lines[0].split(' ');
  if (!method || !path) return null;
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return { method, path, headers };
}

/** Splits "/ws?role=tv" into its path and query (React Native has no full URL implementation). */
function splitPath(raw: string): { pathname: string; query: Record<string, string> } {
  const q = raw.indexOf('?');
  const pathname = q < 0 ? raw : raw.slice(0, q);
  const query: Record<string, string> = {};
  if (q >= 0) {
    for (const pair of raw.slice(q + 1).split('&')) {
      const [k, v = ''] = pair.split('=');
      if (k) query[decodeURIComponent(k)] = decodeURIComponent(v);
    }
  }
  return { pathname, query };
}
