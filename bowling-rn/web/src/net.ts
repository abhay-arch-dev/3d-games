// Shared WebSocket helper with auto-reconnect.
import type { Role, ServerMessage } from './protocol';

export interface Connection<Out> {
  send(obj: Out): void;
  readonly connected: boolean;
}

export function connect<In, Out>(
  role: Role,
  onMessage: (msg: In | ServerMessage) => void,
  onStatus: (connected: boolean) => void = () => {},
): Connection<Out> {
  let ws: WebSocket | null = null;
  let retry = 500;

  function open(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${proto}://${location.host}/ws?role=${role}`);
    ws = sock;
    sock.onopen = () => {
      retry = 500;
      onStatus(true);
    };
    sock.onclose = () => {
      onStatus(false);
      setTimeout(open, retry);
      retry = Math.min(retry * 2, 4000);
    };
    sock.onerror = () => sock.close();
    sock.onmessage = (e: MessageEvent<string>) => {
      let msg: In | ServerMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      onMessage(msg);
    };
  }
  open();

  return {
    send(obj: Out) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    },
    get connected() {
      return !!ws && ws.readyState === WebSocket.OPEN;
    },
  };
}

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
