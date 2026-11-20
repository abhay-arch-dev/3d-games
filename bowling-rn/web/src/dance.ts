// Dance (TV): match target poses on the beat. The camera phone streams a 13-point body pose; this page
// compares 8 limb direction vectors with the target and scores each move.
import { connect, $, clamp, enableBackToHub } from './net';
import type { ControllerToTv, ServerMessage, TvToController } from './protocol';
import { dirDeg, drawFigure, LIMBS, limbVec, mid, P, poseFromAngles, pt, seen, type PoseMsg, type Pt } from './pose';

// ---- Moves (8 limb angles: L upper arm, L forearm, R upper arm, R forearm, L thigh, L shin, R thigh, R shin).
// 0 = pointing down, +90 = screen right, -90 = screen left, 180 = up. "L" is the limb on the left of the screen.
const LEGS = [-6, -3, 6, 3];
interface Move { name: string; a: number[]; legs?: boolean }
const MOVES: Move[] = [
  { name: 'T-Pose', a: [-90, -90, 90, 90, ...LEGS] },
  { name: 'Hands Up', a: [-150, -160, 150, 160, ...LEGS] },
  { name: 'Flex!', a: [-90, 180, 90, 180, ...LEGS] },
  { name: 'Disco Left', a: [-135, -140, 30, 20, ...LEGS] },
  { name: 'Disco Right', a: [-30, -20, 135, 140, ...LEGS] },
  { name: 'Left Arm Up', a: [-170, -175, 15, 10, ...LEGS] },
  { name: 'Right Arm Up', a: [-15, -10, 170, 175, ...LEGS] },
  { name: 'Point Left', a: [-90, -90, -70, -90, ...LEGS] },
  { name: 'Point Right', a: [70, 90, 90, 90, ...LEGS] },
  { name: 'Star Jump', a: [-130, -130, 130, 130, -25, -25, 25, 25], legs: true },
  { name: 'Kick Left', a: [-90, -90, 90, 90, -55, -50, 6, 3], legs: true },
  { name: 'Kick Right', a: [-90, -90, 90, 90, -6, -3, 55, 50], legs: true },
  { name: 'Hands on Head', a: [-125, 60, 125, -60, ...LEGS] },
];
const BPM = 110, BEAT = 60 / BPM, BEATS_PER_MOVE = 4, INTRO_BEATS = 8;
const CHOREO = [0, 1, 2, 1, 3, 4, 3, 4, 5, 6, 7, 8, 9, 0, 10, 11, 12, 2, 7, 8, 3, 4, 9, 1];
const SONG_MOVES = CHOREO.length;

// ---- Canvas --------------------------------------------------------------------------------
const cv = $<HTMLCanvasElement>('cv'), ctx = cv.getContext('2d')!;
let W = 0, H = 0;
function resize(): void { const dpr = Math.min(devicePixelRatio || 1, 2); W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr; }
addEventListener('resize', resize); resize();

// ---- State ---------------------------------------------------------------------------------
type Phase = 'idle' | 'play' | 'done';
const s = {
  phase: 'idle' as Phase, t0: 0, score: 0, combo: 0, maxCombo: 0, scored: -1,
  counts: { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 } as Record<string, number>,
  sims: new Array(LIMBS.length).fill(0) as number[], simNow: 0, best: 0, energy: 0,
};
let player: number[] | null = null, prevPlayer: number[] | null = null, lastPoseAt = 0, handsUpSince = 0;

const songTime = (): number => (actx ? actx.currentTime : performance.now() / 1000) - s.t0;
/** Index of the move currently being prepared (scored at the end of its 4 beats). */
const moveAt = (t: number): number => Math.floor((t - INTRO_BEATS * BEAT) / (BEATS_PER_MOVE * BEAT));
const hitTime = (i: number): number => (INTRO_BEATS + (i + 1) * BEATS_PER_MOVE) * BEAT;

/** Per-limb similarity (0..1) between the player's limb directions and the target. */
function compare(p: number[], m: Move): { sims: number[]; total: number } {
  const sims: number[] = []; let sum = 0, wsum = 0;
  LIMBS.forEach((l, i) => {
    const v = limbVec(p, l.a, l.b), d = dirDeg(m.a[i]);
    const sim = v ? Math.pow(Math.max(0, v.x * d.x + v.y * d.y), 1.5) : 0.2;
    const w = i >= 4 ? (m.legs ? 1 : 0.35) : 1;
    sims.push(sim); sum += sim * w; wsum += w;
  });
  return { sims, total: sum / wsum };
}

function start(): void {
  if (s.phase === 'play') return;
  hideOverlay();
  Object.assign(s, { phase: 'play', score: 0, combo: 0, maxCombo: 0, scored: -1, best: 0, counts: { PERFECT: 0, GREAT: 0, GOOD: 0, MISS: 0 } });
  hideMsg();
  startMusic();
  s.t0 = (actx ? actx.currentTime : performance.now() / 1000) + 0.1;
}

function rate(i: number): void {
  const q = s.best;
  const [label, pts, color] = q >= 0.85 ? ['PERFECT', 300, '#3ddc97'] : q >= 0.72 ? ['GREAT', 200, '#7ad7ff'] : q >= 0.55 ? ['GOOD', 100, '#ffb03a'] : ['MISS', 0, '#ff5d6c'];
  s.counts[label as string]++;
  s.combo = pts ? s.combo + 1 : 0;
  s.maxCombo = Math.max(s.maxCombo, s.combo);
  s.score += (pts as number) * (1 + Math.min(s.combo, 10) * 0.1) | 0;
  const r = $('rate'); r.textContent = label as string; r.style.color = color as string;
  r.classList.remove('show'); void r.offsetWidth; r.classList.add('show');
  setTimeout(() => r.classList.remove('show'), 600);
  net.send({ type: 'result', label: label as string, kind: label === 'PERFECT' ? 'strike' : label === 'MISS' ? 'normal' : 'spare', knocked: 0 });
  s.scored = i; s.best = 0;
}

function finish(): void {
  s.phase = 'done';
  stopMusic();
  const c = s.counts;
  showMsg(`Score ${s.score}`, true, true);
  $('moveName').textContent = `${c.PERFECT} perfect · ${c.GREAT} great · ${c.GOOD} good · ${c.MISS} miss · best combo ${s.maxCombo}`;
}

// ---- Pose input ------------------------------------------------------------------------------
function onPose(msg: PoseMsg): void {
  lastPoseAt = performance.now();
  prevPlayer = player;
  player = msg.p;
  $('camState').textContent = player ? 'Camera sees you. Raise both hands to start!' : 'Camera connected. Step back so your whole body is in view.';
  if (player && prevPlayer) { // energy = how much the limbs are moving
    let m = 0; for (let i = 0; i < 13; i++) m += Math.hypot(player[i * 3] - prevPlayer[i * 3], player[i * 3 + 1] - prevPlayer[i * 3 + 1]);
    s.energy += (clamp(m * 6, 0, 1) - s.energy) * 0.2;
  }
  // Both wrists above the head for a second starts the song.
  const up = player && seen(player, P.lWr) && seen(player, P.rWr) && seen(player, P.nose) &&
    player[P.lWr * 3 + 1] < player[P.nose * 3 + 1] && player[P.rWr * 3 + 1] < player[P.nose * 3 + 1];
  if (up && s.phase !== 'play') { if (!handsUpSince) handsUpSince = performance.now(); else if (performance.now() - handsUpSince > 1000) { handsUpSince = 0; start(); } }
  else if (!up) handsUpSince = 0;
}

// ---- Music (generated) --------------------------------------------------------------------------
let actx: AudioContext | null = null, musicOn = false, nextBeat = 0, beatN = 0, timer: ReturnType<typeof setInterval> | undefined;
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
const hz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
function noiseBuf(): AudioBuffer {
  const b = actx!.createBuffer(1, actx!.sampleRate * 0.3, actx!.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
let noise: AudioBuffer | null = null;
function voice(type: OscillatorType, f: number, t: number, dur: number, vol: number, slideTo?: number): void {
  const o = actx!.createOscillator(), g = actx!.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx!.destination); o.start(t); o.stop(t + dur + 0.02);
}
function hit(t: number, dur: number, vol: number, hp: number): void {
  const src = actx!.createBufferSource(), f = actx!.createBiquadFilter(), g = actx!.createGain();
  src.buffer = noise; f.type = 'highpass'; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(actx!.destination); src.start(t); src.stop(t + dur);
}
function scheduleBeat(t: number, n: number): void {
  const bar = Math.floor(n / 4), chord = CHORDS[bar % 4], intro = n < INTRO_BEATS;
  voice('sine', 150, t, 0.25, 0.9, 45); // kick
  hit(t + BEAT / 2, 0.05, 0.25, 7000); // offbeat hat
  if (n % 2 === 1) hit(t, 0.18, 0.35, 1500); // clap
  if (!intro) {
    voice('triangle', hz(chord[0] - 24), t, BEAT * 0.9, 0.35); // bass
    voice('triangle', hz(chord[0] - 12), t + BEAT / 2, BEAT * 0.4, 0.2);
    const note = chord[(n * 7 + bar) % 3] + 12; // little arpeggio
    voice('square', hz(note), t + BEAT * 0.25, 0.12, 0.05);
    voice('square', hz(chord[(n + 1) % 3] + 12), t + BEAT * 0.75, 0.12, 0.04);
  }
}
function startMusic(): void {
  try { actx = actx || new AudioContext(); } catch { actx = null; return; }
  void actx.resume();
  noise = noise || noiseBuf();
  musicOn = true; beatN = 0; nextBeat = actx.currentTime + 0.1;
  clearInterval(timer);
  timer = setInterval(() => {
    if (!musicOn || !actx) return;
    while (nextBeat < actx.currentTime + 0.2) { scheduleBeat(nextBeat, beatN++); nextBeat += BEAT; }
  }, 50);
}
function stopMusic(): void { musicOn = false; clearInterval(timer); }

// ---- Drawing --------------------------------------------------------------------------------------
const simColor = (v: number): string => `hsl(${Math.round(clamp(v, 0, 1) * 130)}, 85%, 58%)`;
const boneLimb = new Map<string, number>(LIMBS.map((l, i) => [`${l.a}-${l.b}`, i]));

function render(): void {
  ctx.clearRect(0, 0, W, H);
  const t = s.phase === 'play' ? songTime() : 0;
  const idx = s.phase === 'play' ? clamp(moveAt(t), -1, SONG_MOVES - 1) : -1;
  const move = idx >= 0 ? MOVES[CHOREO[idx]] : MOVES[1];
  const beatPhase = s.phase === 'play' ? (t / BEAT) % 1 : (performance.now() / 1000 / BEAT) % 1;

  // Floor glow pulses on the beat
  const pulse = Math.pow(1 - beatPhase, 3);
  const g = ctx.createRadialGradient(W / 2, H * 0.92, 10, W / 2, H * 0.92, W * 0.45);
  g.addColorStop(0, `rgba(255,80,200,${0.15 + pulse * 0.25})`); g.addColorStop(1, 'rgba(255,80,200,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Stage box (4:3) in the middle
  const bh = H * 0.7, bw = bh * 4 / 3, box = { x: W / 2 - bw / 2, y: H * 0.06, w: bw, h: bh };
  const target = poseFromAngles(move.a, 0.5, 0.3, 0.24);
  const lp = (ctx.lineWidth = 1, Math.max(6, H / 90));
  ctx.save(); ctx.shadowColor = '#c77dff'; ctx.shadowBlur = 30;
  drawFigure(ctx, target, box, 'rgba(199,125,255,.55)', lp * 2.6);
  ctx.restore();

  // Player figure, moved and scaled onto the target's shoulders so the limb vectors line up.
  if (player && seen(player, P.lSh) && seen(player, P.rSh) && seen(player, P.lHip) && seen(player, P.rHip)) {
    const ps = mid(pt(player, P.lSh), pt(player, P.rSh)), ph = mid(pt(player, P.lHip), pt(player, P.rHip));
    const ts = mid(pt(target, P.lSh), pt(target, P.rSh)), th = mid(pt(target, P.lHip), pt(target, P.rHip));
    const k = (th.y - ts.y) / Math.max(0.03, ph.y - ps.y);
    const fitted = player.map((v, i) => (i % 3 === 0 ? ts.x + (v - ps.x) * k : i % 3 === 1 ? ts.y + (v - ps.y) * k : v));
    const res = compare(player, move);
    s.sims = s.sims.map((v, i) => v + (res.sims[i] - v) * 0.4);
    s.simNow = res.total;
    if (s.phase === 'play' && idx >= 0 && t > hitTime(idx) - BEAT * 1.5) s.best = Math.max(s.best, res.total);
    drawFigure(ctx, fitted, box, (a, b) => {
      const li = boneLimb.get(`${a}-${b}`);
      return li === undefined ? '#ffffff' : simColor(s.sims[li]);
    }, lp);
  }

  // Limb vector monitor (left panel): target direction vs your direction for each limb.
  const px = W * 0.02, py = H * 0.12, rowH = H * 0.085, pw = W * 0.2;
  ctx.fillStyle = 'rgba(10,14,26,.72)'; roundRect(px, py, pw, rowH * LIMBS.length + H * 0.05, 14); ctx.fill();
  ctx.font = `600 ${Math.round(H / 48)}px system-ui, sans-serif`; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#a3abc9'; ctx.fillText('LIMB VECTORS', px + 14, py + H * 0.025);
  LIMBS.forEach((l, i) => {
    const y = py + H * 0.05 + i * rowH + rowH / 2, cx = px + 14 + rowH * 0.4, r = rowH * 0.36;
    ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.stroke();
    arrow(cx, y, dirDeg(move.a[i]), r, 'rgba(199,125,255,.9)', 4);
    const v = player ? limbVec(player, l.a, l.b) : null;
    if (v) arrow(cx, y, v, r * 0.9, simColor(s.sims[i]), 3);
    ctx.fillStyle = '#f3f5ff'; ctx.fillText(l.name, cx + r + 12, y - rowH * 0.16);
    const bx = cx + r + 12, bwid = pw - (bx - px) - 16;
    ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(bx, y + rowH * 0.1, bwid, rowH * 0.14);
    ctx.fillStyle = simColor(s.sims[i]); ctx.fillRect(bx, y + rowH * 0.1, bwid * (v ? s.sims[i] : 0), rowH * 0.14);
  });

  // Match + energy meters (right)
  meter(W * 0.86, H * 0.32, 'MATCH', player ? s.simNow : 0, simColor(s.simNow));
  meter(W * 0.92, H * 0.32, 'ENERGY', s.energy, '#ff5fd2');

  // Timeline of upcoming moves along the bottom
  const lineX = W * 0.3, ty = H * 0.86, cardW = H * 0.11;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(lineX, ty - cardW * 0.7); ctx.lineTo(lineX, ty + cardW * 0.7); ctx.stroke();
  if (s.phase === 'play') {
    for (let i = Math.max(0, idx); i < Math.min(SONG_MOVES, idx + 5); i++) {
      const x = lineX + (hitTime(i) - t) * (W * 0.12);
      if (x < lineX - cardW || x > W) continue;
      ctx.fillStyle = i === idx ? 'rgba(199,125,255,.35)' : 'rgba(10,14,26,.75)';
      roundRect(x - cardW / 2, ty - cardW / 2, cardW, cardW, 10); ctx.fill();
      drawFigure(ctx, poseFromAngles(MOVES[CHOREO[i]].a, 0.5, 0.28, 0.3), { x: x - cardW / 2 - cardW / 6, y: ty - cardW / 2, w: cardW * 4 / 3, h: cardW }, '#e0c3ff', 3);
    }
    // Beat dots
    for (let b = 0; b < 4; b++) {
      const cur = Math.floor(t / BEAT) % 4 === b;
      ctx.fillStyle = cur ? '#ffb03a' : 'rgba(255,255,255,.2)';
      ctx.beginPath(); ctx.arc(W / 2 - 45 + b * 30, H * 0.085, cur ? 9 : 6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Move name / countdown text
  if (s.phase === 'play') {
    const nm = idx < 0 ? `Get ready… ${Math.max(1, Math.ceil((INTRO_BEATS * BEAT - t) / BEAT))}` : move.name;
    if ($('moveName').textContent !== nm) $('moveName').textContent = nm;
  }
}
function arrow(x: number, y: number, d: Pt, len: number, color: string, w: number): void {
  const ex = x + d.x * len, ey = y + d.y * len;
  ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.stroke();
  const a = Math.atan2(d.y, d.x);
  ctx.beginPath(); ctx.moveTo(ex, ey);
  ctx.lineTo(ex - Math.cos(a - 0.5) * len * 0.3, ey - Math.sin(a - 0.5) * len * 0.3);
  ctx.lineTo(ex - Math.cos(a + 0.5) * len * 0.3, ey - Math.sin(a + 0.5) * len * 0.3); ctx.fill();
}
function meter(x: number, y: number, label: string, v: number, color: string): void {
  const w = W * 0.035, h = H * 0.42;
  ctx.fillStyle = 'rgba(10,14,26,.72)'; roundRect(x - w / 2, y, w, h, 10); ctx.fill();
  ctx.fillStyle = color; roundRect(x - w / 2 + 4, y + 4 + (h - 8) * (1 - clamp(v, 0, 1)), w - 8, (h - 8) * clamp(v, 0, 1), 8); ctx.fill();
  ctx.fillStyle = '#a3abc9'; ctx.font = `700 ${Math.round(H / 60)}px system-ui, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(label, x, y + h + H * 0.025); ctx.textAlign = 'left';
}
function roundRect(x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- HUD helpers ---------------------------------------------------------------------------------
function showMsg(text: string, small: boolean, stay = false): void {
  const m = $('msg'); m.textContent = text; m.classList.toggle('small', small);
  m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
  if (!stay) setTimeout(hideMsg, 1500);
}
function hideMsg(): void { $('msg').classList.remove('show'); }
let overlayOpen = true;
function hideOverlay(): void { if (overlayOpen) { overlayOpen = false; $('overlay').classList.add('hide'); } }
$('startBtn').addEventListener('click', start);
$('startBtn').focus();

// ---- Network + keys ------------------------------------------------------------------------------
const net = connect<ControllerToTv, TvToController>('tv', (msg: ControllerToTv | ServerMessage) => {
  if (msg.type === 'peers') {
    $('status').classList.toggle('on', msg.controller > 0);
    $('statusTxt').textContent = msg.controller > 0 ? 'Phone connected' : 'Waiting for camera phone…';
  } else if (msg.type === 'pose') onPose(msg);
  else if (msg.type === 'cmd' && msg.action === 'newgame' && s.phase !== 'play') start();
});
enableBackToHub();
addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && s.phase !== 'play') { e.preventDefault(); start(); } });
setInterval(() => {
  if (lastPoseAt && performance.now() - lastPoseAt > 2000) { lastPoseAt = 0; player = null; $('camState').textContent = 'Waiting for the camera phone…'; }
}, 500);

// ---- Loop ------------------------------------------------------------------------------------------
function tick(): void {
  requestAnimationFrame(tick);
  if (s.phase === 'play') {
    const t = songTime();
    const i = moveAt(t);
    // Score each move just after its hit beat.
    if (i - 1 > s.scored && i - 1 >= 0 && i - 1 < SONG_MOVES) rate(i - 1);
    if (i >= SONG_MOVES && s.scored >= SONG_MOVES - 1) finish();
    $('score').textContent = String(s.score);
    $('combo').textContent = `Combo ${s.combo}`;
  }
  s.energy *= 0.995;
  render();
}
tick();

declare global { interface Window { __dance?: unknown } }
window.__dance = { s, onPose, start, MOVES, compare, poseFromAngles };
