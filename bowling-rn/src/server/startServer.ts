// Runs GameServer inside the React Native app. Game files are bundled in the app
// (Android: assets/www, iOS: www folder in the app bundle) by `npm run build:web`.
import { Platform as RNPlatform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';
import RNFS from 'react-native-fs';
import { NetworkInfo } from 'react-native-network-info';
import { Buffer } from 'buffer';
import { GameServer, PORT, type RawSocket } from './GameServer';

let instance: GameServer | null = null;
const cache = new Map<string, Uint8Array>();

async function readBundled(path: string): Promise<Uint8Array | null> {
  const hit = cache.get(path);
  if (hit) return hit;
  try {
    const b64 = RNPlatform.OS === 'android'
      ? await RNFS.readFileAssets(`www/${path}`, 'base64')
      : await RNFS.readFile(`${RNFS.MainBundlePath}/www/${path}`, 'base64');
    const bytes = new Uint8Array(Buffer.from(b64, 'base64'));
    cache.set(path, bytes);
    return bytes;
  } catch {
    return null;
  }
}

/** Starts the server once for the lifetime of the app and returns it. */
export function startServer(): GameServer {
  if (instance) return instance;
  const server = new GameServer({
    readFile: readBundled,
    async lanAddresses() {
      const ip = await NetworkInfo.getIPV4Address().catch(() => null);
      return ip && ip !== '0.0.0.0' ? [ip] : [];
    },
    log: (m) => console.log(`[server] ${m}`),
  });

  const tcp = TcpSocket.createServer((socket) => {
    // react-native-tcp-socket wants Buffers or strings.
    const raw: RawSocket & { end: () => void } = {
      write: (d) => socket.write(typeof d === 'string' ? d : Buffer.from(d.buffer, d.byteOffset, d.byteLength)),
      writeAsync: (d) => new Promise<void>((resolve, reject) => {
        socket.write(Buffer.from(d.buffer, d.byteOffset, d.byteLength), undefined, (err) => (err ? reject(err) : resolve()));
      }),
      destroy: () => socket.destroy(),
      end: () => socket.end(),
      setNoDelay: (on) => socket.setNoDelay(on),
      on: (event: 'data' | 'close' | 'error', cb: (...args: never[]) => void) => socket.on(event, cb as never),
    };
    server.handleConnection(raw);
  });
  tcp.on('error', (e) => console.warn('[server] error', e));
  tcp.listen({ port: PORT, host: '0.0.0.0', reuseAddress: true }, () => console.log(`[server] listening on ${PORT}`));
  server.start();
  instance = server;
  return server;
}
