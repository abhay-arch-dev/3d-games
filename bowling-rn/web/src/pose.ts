// Helpers for the 13-point body pose the camera phone streams to the TV.
// Points are [x, y, visibility] triplets, x mirrored (so the screen acts like a mirror), y pointing down.
import type { ControllerToTv } from './protocol';

export type PoseMsg = Extract<ControllerToTv, { type: 'pose' }>;
export const P = { nose: 0, lSh: 1, rSh: 2, lEl: 3, rEl: 4, lWr: 5, rWr: 6, lHip: 7, rHip: 8, lKn: 9, rKn: 10, lAn: 11, rAn: 12 } as const;
export const BONES: [number, number][] = [[1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [7, 9], [9, 11], [8, 10], [10, 12]];

/** The eight limb vectors the dance game compares: upper arms, forearms, thighs, shins. */
export const LIMBS: { name: string; a: number; b: number; w: number }[] = [
  { name: 'left upper arm', a: P.lSh, b: P.lEl, w: 1 }, { name: 'left forearm', a: P.lEl, b: P.lWr, w: 1 },
  { name: 'right upper arm', a: P.rSh, b: P.rEl, w: 1 }, { name: 'right forearm', a: P.rEl, b: P.rWr, w: 1 },
  { name: 'left thigh', a: P.lHip, b: P.lKn, w: 0.6 }, { name: 'left shin', a: P.lKn, b: P.lAn, w: 0.6 },
  { name: 'right thigh', a: P.rHip, b: P.rKn, w: 0.6 }, { name: 'right shin', a: P.rKn, b: P.rAn, w: 0.6 },
];

export interface Pt { x: number; y: number }
export const pt = (p: number[], i: number): Pt => ({ x: p[i * 3], y: p[i * 3 + 1] });
export const seen = (p: number[], i: number, min = 0.4): boolean => p[i * 3 + 2] >= min;
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Unit vector for a limb, or null if either end is not visible. */
export function limbVec(p: number[], a: number, b: number): Pt | null {
  if (!seen(p, a) || !seen(p, b)) return null;
  const dx = p[b * 3] - p[a * 3], dy = (p[b * 3 + 1] - p[a * 3 + 1]) * 0.75; // camera frames are 4:3
  const l = Math.hypot(dx, dy) || 1;
  return { x: dx / l, y: dy / l };
}

/** Direction from an angle in degrees: 0 = straight down, +90 = screen right, -90 = screen left, 180 = up. */
export const dirDeg = (deg: number): Pt => ({ x: Math.sin((deg * Math.PI) / 180), y: Math.cos((deg * Math.PI) / 180) });

/** Builds a full 13-point pose (for drawing a target figure) from 8 limb angles. */
export function poseFromAngles(angles: number[], cx = 0.5, top = 0.2, scale = 0.2): number[] {
  const out: number[] = Array.from({ length: 13 * 3 }, (_, i) => (i % 3 === 2 ? 1 : 0));
  const set = (i: number, x: number, y: number) => { out[i * 3] = x; out[i * 3 + 1] = y; };
  const sh = 0.45 * scale, hip = 0.3 * scale, torso = 1.0 * scale, ua = 0.62 * scale, fa = 0.58 * scale, th = 0.8 * scale, sn = 0.78 * scale;
  set(P.nose, cx, top - 0.32 * scale);
  set(P.lSh, cx - sh / 2, top); set(P.rSh, cx + sh / 2, top);
  set(P.lHip, cx - hip / 2, top + torso); set(P.rHip, cx + hip / 2, top + torso);
  const chain = (from: number, to: number, deg: number, len: number) => {
    const d = dirDeg(deg);
    set(to, out[from * 3] + d.x * len, out[from * 3 + 1] + (d.y * len) / 0.75);
  };
  chain(P.lSh, P.lEl, angles[0], ua); chain(P.lEl, P.lWr, angles[1], fa);
  chain(P.rSh, P.rEl, angles[2], ua); chain(P.rEl, P.rWr, angles[3], fa);
  chain(P.lHip, P.lKn, angles[4], th); chain(P.lKn, P.lAn, angles[5], sn);
  chain(P.rHip, P.rKn, angles[6], th); chain(P.rKn, P.rAn, angles[7], sn);
  return out;
}

/** Draws a stick figure; `color` may be a function of the bone index for per-limb colouring. */
export function drawFigure(ctx: CanvasRenderingContext2D, p: number[], box: { x: number; y: number; w: number; h: number },
  color: string | ((a: number, b: number) => string), width = 8): void {
  const X = (i: number) => box.x + p[i * 3] * box.w, Y = (i: number) => box.y + p[i * 3 + 1] * box.h;
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  for (const [a, b] of BONES) {
    if (!seen(p, a) || !seen(p, b)) continue;
    ctx.strokeStyle = typeof color === 'string' ? color : color(a, b);
    ctx.beginPath(); ctx.moveTo(X(a), Y(a)); ctx.lineTo(X(b), Y(b)); ctx.stroke();
  }
  if (seen(p, 0)) {
    ctx.fillStyle = typeof color === 'string' ? color : color(0, 0);
    ctx.beginPath(); ctx.arc(X(0), Y(0), width * 1.8, 0, Math.PI * 2); ctx.fill();
  }
}
