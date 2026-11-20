// Shared WebSocket helper with auto-reconnect.
import { gameUrl, type GameId, type Role, type ServerMessage } from './protocol';

/** Game named in the page URL (?game=runner) or on <body data-game>. */
export const pageGame = (): GameId | null =>
  (new URLSearchParams(location.search).get('game') || document.body?.dataset.game || null) as GameId | null;

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
      // Phones tell the TV which game to show; TVs announce which game they are showing.
      const g = pageGame();
      if (g && role === 'controller') sock.send(JSON.stringify({ type: 'launch', game: g }));
      if (g && role === 'tv') sock.send(JSON.stringify({ type: 'game', game: g }));
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
      const m = msg as { type?: string; game?: GameId };
      if (role === 'tv') {
        // A phone picked a game: switch the TV to it.
        if (m.type === 'launch' && m.game && m.game !== pageGame()) { location.href = gameUrl(m.game); return; }
        // A new phone joined: tell it which game is on.
        if (m.type === 'peers' && pageGame()) sock.send(JSON.stringify({ type: 'game', game: pageGame() }));
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

/** TV pages: Back / Escape on the remote returns to the game picker. */
export function enableBackToHub(): void {
  addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') {
      e.preventDefault();
      location.href = '/tv';
    }
  });
}
