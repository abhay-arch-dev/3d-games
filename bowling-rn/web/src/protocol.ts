// Messages exchanged over the WebSocket relay between the TV page and the phone pages.

export type Role = 'tv' | 'controller';

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
  | { type: 'cmd'; action: 'newgame'; soft?: boolean }
  | { type: 'pose'; visible: boolean; ready: boolean; lean: number; p: number[] | null };

export type TvToController =
  | { type: 'state'; frame: number; roll: number; total: number; canThrow: boolean; over: boolean }
  | { type: 'result'; label: string; kind: 'strike' | 'spare' | 'normal'; knocked: number }
  | { type: 'thrown'; kmh: number }
  | { type: 'hit'; power: number };

export type ServerMessage =
  | { type: 'peers'; tv: number; controller: number }
  | { type: 'pong'; t?: number };

export type ClientMessage = ControllerToTv | TvToController | { type: 'ping'; t?: number };

export interface ServerInfo {
  port: number;
  ips: string[];
  peers: { tv: number; controller: number };
}
