// Messages exchanged over the WebSocket relay between the TV page and the phone pages.

export type Role = 'tv' | 'controller';

/** The games on the TV. 'hub' is the game picker. */
export type GameId = 'hub' | 'bowling' | 'paper' | 'runner' | 'dance';
export const GAMES: Record<Exclude<GameId, 'hub'>, { name: string; icon: string; blurb: string; motion: boolean }> = {
  bowling: { name: 'Bowling', icon: '🎳', blurb: 'Swing your arm to roll a strike. 1 or 2 players.', motion: true },
  paper: { name: 'Paper Toss', icon: '🗑️', blurb: 'Lob a paper ball into the bin. Watch the wind.', motion: true },
  runner: { name: 'Track Runner', icon: '🏃', blurb: 'Step left and right, jump and duck past obstacles.', motion: true },
  dance: { name: 'Dance', icon: '💃', blurb: 'Copy the poses to the beat. Camera mode only.', motion: false },
};
/** TV page for each game. */
export const gameUrl = (g: GameId): string => (g === 'hub' ? '/tv' : `/${g}`);
export type Dir = 'left' | 'right' | 'up' | 'down';

export interface ThrowParams {
  speed: number; // 0..1
  hook: number; // -1..1
  angle: number; // -1..1 (scaled)
  x?: number; // starting position -1..1
  peak?: number;
}

export type ControllerToTv =
  | { type: 'pos'; x: number }
  | { type: 'holding'; on: boolean }
  | ({ type: 'throw' } & ThrowParams)
  | { type: 'cmd'; action: 'newgame'; soft?: boolean; players?: 1 | 2 }
  | { type: 'launch'; game: GameId }
  | { type: 'move'; dir: Dir }
  | { type: 'pose'; visible: boolean; ready: boolean; lean: number; p: number[] | null };

export type TvToController =
  | { type: 'state'; frame: number; roll: number; total: number; canThrow: boolean; over: boolean;
      player: number; players: number; totals: number[] }
  | { type: 'result'; label: string; kind: 'strike' | 'spare' | 'normal'; knocked: number }
  | { type: 'thrown'; kmh: number }
  | { type: 'hit'; power: number }
  | { type: 'game'; game: GameId };

export type ServerMessage =
  | { type: 'peers'; tv: number; controller: number }
  | { type: 'pong'; t?: number };

export type ClientMessage = ControllerToTv | TvToController | { type: 'ping'; t?: number };

export interface ServerInfo {
  port: number;
  ips: string[];
  peers: { tv: number; controller: number };
}
