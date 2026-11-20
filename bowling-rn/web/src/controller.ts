// Motion mode: the phone in your hand is the ball (gyro swing), or swipe on the pad.
import { connect, $, clamp } from './net';
import { GAMES, type ControllerToTv, type Dir, type GameId, type ServerMessage, type TvToController } from './protocol';

const pad = $('pad');

// ---- Tunables (adjust after testing on the real phone) ---------------------
const MOTION = {
  minPeak: 90,     // deg/s: below this the release is treated as "no swing"
  slowPeak: 150,   // deg/s that maps to the slowest throw
  fastPeak: 850,   // deg/s that maps to the fastest throw
  twistFull: 380,  // deg/s of wrist twist at release for full hook
  yawFull: 600,    // deg/s of sideways swing at release for full angle
  tiltRange: 25,   // degrees of left/right tilt to reach the lane edge
};

type Mode = 'motion' | 'swipe';
interface Sample { t: number; a: number; b: number; g: number }
interface SwipePt { x: number; y: number; t: number }
type ThrowResult = { tooSoft: true } | { tooSoft?: false; speed: number; hook: number; angle: number; peak?: number };
type WakeLockLike = { release(): Promise<void> } | null | undefined;

// ---- State ------------------------------------------------------------------
let mode: Mode = 'motion';
let tvCount = 0;
let canThrow = false;
let holding = false;
let sensorsOk = false;
let position = 0; // -1..1
let players = 1;
let game: GameId = 'bowling';
const samples: Sample[] = []; // rotation rates in deg/s
let swipePts: SwipePt[] = [];
let wakeLock: WakeLockLike = null;
const tilt = $<HTMLInputElement>('tilt');
const posRange = $<HTMLInputElement>('posRange');

const vibrate = (p: number | number[]) => { if (navigator.vibrate) navigator.vibrate(p); };

const net = connect<TvToController, ControllerToTv>('controller', onMessage, (on) => {
  $('dServer').classList.toggle('on', on);
  if (!on) { tvCount = 0; $('dTv').classList.remove('on'); updatePad(); }
});

function onMessage(msg: TvToController | ServerMessage): void {
  switch (msg.type) {
    case 'game':
      game = msg.game;
      document.body.dataset.game = game;
      $('gameName').textContent = game === 'hub' ? 'Pick a game on the TV' : `${GAMES[game].icon} ${GAMES[game].name}`;
      updatePad();
      break;
    case 'peers':
      tvCount = msg.tv;
      $('dTv').classList.toggle('on', tvCount > 0);
      updatePad();
      break;
    case 'state':
      canThrow = !!msg.canThrow;
      players = msg.players === 2 ? 2 : 1;
      markPlayers();
      $('total').textContent = players === 2 ? (msg.totals ?? []).join(' – ') : String(msg.total);
      $('frameLbl').textContent = msg.over ? 'Game over'
        : game === 'paper' ? `Shot ${msg.frame} of 10`
        : `${players === 2 ? `Player ${msg.player} · ` : ''}Frame ${msg.frame} · Ball ${msg.roll}`;
      updatePad();
      break;
    case 'result':
      toast(msg.label);
      if (msg.kind === 'strike') vibrate([90, 60, 90, 60, 350]);
      else if (msg.kind === 'spare') vibrate([90, 60, 220]);
      else vibrate(50);
      break;
    case 'thrown':
      $('speed').textContent = `${msg.kmh} km/h`;
      break;
    case 'hit':
      vibrate(Math.round(20 + 40 * clamp(msg.power || 0.5, 0, 1)));
      break;
  }
}

function updatePad(): void {
  if (game === 'runner' || game === 'dance' || game === 'hub') {
    pad.classList.toggle('disabled', tvCount === 0 || game !== 'runner');
    $('hint').textContent = tvCount === 0 ? 'Waiting for the TV.'
      : game === 'runner' ? 'Swipe left/right to change lane, up to jump, down to duck. Tap to start.'
      : game === 'dance' ? 'Dance needs Camera mode: go back and pick Camera mode.'
      : 'Choose a game on the TV with the remote, or go back in the app.';
    $('padLbl').textContent = game === 'runner' ? 'SWIPE' : '–';
    return;
  }
  const ready = tvCount > 0 && canThrow;
  pad.classList.toggle('disabled', !ready);
  if (tvCount === 0) $('hint').textContent = 'Waiting for the TV. Open the TV address shown in the app on the TV browser.';
  else if (!canThrow) $('hint').textContent = 'Wait for the pins…';
  else $('hint').textContent = mode === 'motion'
    ? 'Hold the button, swing your arm forward like a bowler, and let go to throw.'
    : 'Swipe up on this pad to throw. Curve the swipe to add hook.';
  $('padLbl').textContent = mode === 'motion' ? (holding ? 'SWING!' : 'HOLD') : 'SWIPE ↑';
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string): void {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}

// ---- Mode switch ----------------------------------------------------------------
function setMode(m: Mode): void {
  mode = m;
  for (const b of Array.from($('mode').children) as HTMLElement[]) b.classList.toggle('on', b.dataset.mode === m);
  tilt.checked = m === 'motion' && sensorsOk;
  updatePad();
}
$('mode').addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).dataset?.mode as Mode | undefined;
  if (!m) return;
  if (m === 'motion' && !sensorsOk) { showWarn(); return; }
  setMode(m);
});

function showWarn(): void {
  const w = $('warn');
  w.style.display = 'block';
  w.textContent = window.isSecureContext
    ? 'No motion sensor data from this browser, so Swipe mode is on.'
    : `Motion sensors only work on the phone running the server, at http://localhost:${location.port || 3000}/controller. Swipe mode is on.`;
}

// ---- Position (slider + tilt) -------------------------------------------------
let lastPosSent = 0;
function setPosition(p: number, fromSlider: boolean): void {
  position = clamp(p, -1, 1);
  if (!fromSlider) posRange.value = String(Math.round(position * 100));
  const now = performance.now();
  if (now - lastPosSent > 33) { // ~30 updates/s
    lastPosSent = now;
    net.send({ type: 'pos', x: position });
  }
}
posRange.addEventListener('input', () => {
  tilt.checked = false;
  setPosition(Number(posRange.value) / 100, true);
});

let smoothTilt = 0;
window.addEventListener('deviceorientation', (e) => {
  if (e.gamma == null || holding || !tilt.checked || mode !== 'motion') return;
  smoothTilt += (e.gamma - smoothTilt) * 0.2;
  setPosition(smoothTilt / MOTION.tiltRange, false);
});

// ---- Motion sensors -----------------------------------------------------------
window.addEventListener('devicemotion', (e) => {
  const r = e.rotationRate;
  if (!r || (r.alpha == null && r.beta == null)) return;
  if (!sensorsOk) { sensorsOk = true; $('warn').style.display = 'none'; if (mode === 'motion') tilt.checked = true; }
  const t = performance.now();
  samples.push({ t, a: r.alpha || 0, b: r.beta || 0, g: r.gamma || 0 });
  while (samples.length && t - samples[0].t > 800) samples.shift();
});

setTimeout(() => {
  if (!sensorsOk) { setMode('swipe'); showWarn(); }
}, 1500);

function motionThrow(): ThrowResult | null {
  const now = performance.now();
  const swing = samples.filter((s) => now - s.t < 350);
  const release = samples.filter((s) => now - s.t < 140);
  if (!swing.length) return null;

  let peak = 0;
  for (const s of swing) peak = Math.max(peak, Math.hypot(s.a, s.b, s.g));
  if (peak < MOTION.minPeak) return { tooSoft: true };

  const avg = (k: 'a' | 'b' | 'g') => release.reduce((sum, s) => sum + s[k], 0) / Math.max(1, release.length);
  const speed = clamp((peak - MOTION.slowPeak) / (MOTION.fastPeak - MOTION.slowPeak), 0, 1);
  let hook = clamp(avg('g') / MOTION.twistFull, -1, 1);
  if (Math.abs(hook) < 0.12) hook = 0;
  const angle = clamp(avg('a') / MOTION.yawFull, -1, 1) * 0.6;
  return { speed, hook, angle, peak: Math.round(peak) };
}

// ---- Pad input ------------------------------------------------------------------
const trail = $<HTMLCanvasElement>('trail');
const tctx = trail.getContext('2d')!;
function sizeTrail(): void {
  trail.width = pad.clientWidth * devicePixelRatio;
  trail.height = pad.clientHeight * devicePixelRatio;
}
addEventListener('resize', sizeTrail);
sizeTrail();

function drawTrail(): void {
  tctx.clearRect(0, 0, trail.width, trail.height);
  if (swipePts.length < 2) return;
  const rect = pad.getBoundingClientRect();
  tctx.strokeStyle = 'rgba(255,176,58,.8)';
  tctx.lineWidth = 6 * devicePixelRatio;
  tctx.lineCap = 'round';
  tctx.beginPath();
  swipePts.forEach((p, i) => {
    const x = (p.x - rect.left) * devicePixelRatio, y = (p.y - rect.top) * devicePixelRatio;
    if (i) tctx.lineTo(x, y); else tctx.moveTo(x, y);
  });
  tctx.stroke();
}

async function keepAwake(): Promise<void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<WakeLockLike> } };
    if (!wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
  } catch { /* ignore */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wakeLock = null; void keepAwake(); } });

pad.addEventListener('pointerdown', (e) => {
  void keepAwake();
  if (game === 'runner') {
    if (tvCount === 0) return;
    pad.setPointerCapture(e.pointerId);
    swipePts = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    runnerSwipe = true;
    return;
  }
  if (tvCount === 0 || !canThrow) return;
  pad.setPointerCapture(e.pointerId);
  holding = true;
  pad.classList.add('holding');
  swipePts = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
  net.send({ type: 'holding', on: true });
  vibrate(15);
  updatePad();
});

let runnerSwipe = false;
function runnerMove(): void {
  runnerSwipe = false;
  const a = swipePts[0], b = swipePts[swipePts.length - 1];
  setTimeout(() => { swipePts = []; drawTrail(); }, 200);
  if (!a || !b) return;
  const dx = b.x - a.x, dy = b.y - a.y;
  const dir: Dir = Math.hypot(dx, dy) < 25 ? 'up' : Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy < 0 ? 'up' : 'down';
  net.send({ type: 'move', dir });
  vibrate(15);
}
pad.addEventListener('pointermove', (e) => {
  if (runnerSwipe) {
    swipePts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    drawTrail();
    // Fire as soon as the swipe is long enough, so it feels instant.
    const a = swipePts[0];
    if (Math.hypot(e.clientX - a.x, e.clientY - a.y) > 60) runnerMove();
    return;
  }
  if (!holding || mode !== 'swipe') return;
  swipePts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  drawTrail();
});

function endHold(cancelled: boolean): void {
  if (!holding) return;
  holding = false;
  pad.classList.remove('holding');
  net.send({ type: 'holding', on: false });
  updatePad();
  if (cancelled) return;

  const th = mode === 'motion' ? motionThrow() : swipeThrow();
  setTimeout(() => { swipePts = []; drawTrail(); }, 250);
  if (!th) return;
  if (th.tooSoft) {
    toast(mode === 'motion' ? 'Swing your arm!' : 'Swipe faster!');
    vibrate([40, 60, 40]);
    return;
  }
  net.send({ type: 'throw', speed: th.speed, hook: th.hook, angle: th.angle, x: position });
  canThrow = false;
  updatePad();
  const hookTxt = th.hook > 0.15 ? ' · hook →' : th.hook < -0.15 ? ' · hook ←' : '';
  $('last').textContent = `Power ${Math.round(th.speed * 100)}%${hookTxt}${th.peak ? ` · swing ${th.peak}°/s` : ''}`;
}
pad.addEventListener('pointerup', () => { if (runnerSwipe) runnerMove(); else endHold(false); });
pad.addEventListener('pointercancel', () => endHold(true));

function swipeThrow(): ThrowResult {
  const pts = swipePts;
  if (pts.length < 3) return { tooSoft: true };
  const end = pts[pts.length - 1];
  let i = pts.length - 1;
  while (i > 0 && end.t - pts[i].t < 120) i--;
  const dt = Math.max(16, end.t - pts[i].t);
  const vy = (pts[i].y - end.y) / dt; // px/ms, upward positive
  if (vy < 0.35) return { tooSoft: true };

  const first = pts[0], mid = pts[Math.floor(pts.length / 2)];
  const dir1 = Math.atan2(mid.x - first.x, first.y - mid.y);
  const dir2 = Math.atan2(end.x - mid.x, mid.y - end.y);
  const overall = Math.atan2(end.x - first.x, first.y - end.y);
  return {
    speed: clamp((vy - 0.4) / 2.2, 0, 1),
    angle: clamp(overall / 0.5, -1, 1) * 0.7,
    hook: clamp((dir2 - dir1) * 1.6, -1, 1),
  };
}

function markPlayers(): void {
  for (const b of Array.from($('players').children) as HTMLElement[]) b.classList.toggle('on', Number(b.dataset.n) === players);
}
$('players').addEventListener('click', (e) => {
  const n = Number((e.target as HTMLElement).dataset?.n);
  if (n !== 1 && n !== 2) return;
  if (confirm(`Start a new ${n}-player game?`)) net.send({ type: 'cmd', action: 'newgame', players: n });
});
$('newGame').addEventListener('click', () => {
  if (confirm('Start a new game?')) net.send({ type: 'cmd', action: 'newgame', players: players as 1 | 2 });
});
markPlayers();

updatePad();
