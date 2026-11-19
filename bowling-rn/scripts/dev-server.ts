// Desktop dev server: the same GameServer the app runs, on Node's `net` module.
//   npm run build:web && npm run serve   →  http://localhost:3000/tv  and  /camera
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { GameServer, PORT } from '../src/server/GameServer';

const ROOT = path.resolve(__dirname, '..', 'web', 'dist');

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  // Prefer typical home Wi-Fi ranges first.
  return out.sort((a, b) => Number(!a.startsWith('192.168.')) - Number(!b.startsWith('192.168.')));
}

const server = new GameServer({
  async readFile(p) {
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) return null;
    return readFile(file).then((b) => new Uint8Array(b)).catch(() => null);
  },
  lanAddresses: async () => lanAddresses(),
});

net.createServer((socket) => server.handleConnection(socket)).listen(PORT, '0.0.0.0', () => {
  server.start();
  console.log('\n  Motion Bowling dev server\n');
  console.log(`  Phone, camera mode:  http://localhost:${PORT}/camera`);
  console.log(`  Phone, motion mode:  http://localhost:${PORT}/controller`);
  for (const ip of lanAddresses()) console.log(`  TV (game):           http://${ip}:${PORT}/tv`);
  console.log('\n  Press Ctrl+C to stop.\n');
});
