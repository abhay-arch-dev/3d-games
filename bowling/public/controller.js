import { connect } from './net.js';

const $ = (id) => document.getElementById(id);
const pad = $('pad');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---- Tunables (adjust after testing on the real phone) ---------------------
const MOTION = {
  minPeak: 90,     // deg/s: below this the release is treated as "no swing"
  slowPeak: 150,   // deg/s that maps to the slowest throw
  fastPeak: 850,   // deg/s that maps to the fastest throw
  twistFull: 380,  // deg/s of wrist twist at release for full hook
  yawFull: 600,    // deg/s of sideways swing at release for full angle
  tiltRange: 25,   // degrees of left/right tilt to reach the lane edge
};

// ---- State ------------------------------------------------------------------
let mode = 'motion';
let tvCount = 0;
let canThrow = false;
let holding = false;
let sensorsOk = false;
let position = 0; // -1..1
const samples = []; // { t, a, b, g } rotation rates in deg/s
let swipePts = [];
let wakeLock = null;

const net = connect('controller', onMessage, (on) => {
  $('dServer').classList.toggle('on', on);
  if (!on) { tvCount = 0; $('dTv').classList.remove('on'); updatePad(); }
});

function onMessage(msg) {
  if (msg.type === 'peers') {
    tvCount = msg.tv;
    $('dTv').classList.toggle('on', tvCount > 0);
    updatePad();
  } else if (msg.type === 'state') {
    canThrow = !!msg.canThrow;
    $('total').textContent = msg.total;
    $('frameLbl').textContent = msg.over ? 'Game over' : `Frame ${msg.frame} · Ball ${msg.roll}`;
    updatePad();
  } else if (msg.type === 'result') {
    toast(msg.label);
    if (navigator.vibrate) {
      if (msg.kind === 'strike') navigator.vibrate([90, 60, 90, 60, 350]);
      else if (msg.kind === 'spare') navigator.vibrate([90, 60, 220]);
      else navigator.vibrate(50);
    }
  } else if (msg.type === 'thrown') {
    $('speed').textContent = `${msg.kmh} km/h`;
  } else if (msg.type === 'hit') {
    if (navigator.vibrate) navigator.vibrate(Math.round(20 + 40 * clamp(msg.power || 0.5, 0, 1)));
  }
}

function updatePad() {
  const ready = tvCount > 0 && canThrow;
  pad.classList.toggle('disabled', !ready);
  if (tvCount === 0) $('hint').textContent = 'Waiting for the TV. Open the TV address shown in Termux on the TV browser.';
  else if (!canThrow) $('hint').textContent = 'Wait for the pins…';
  else $('hint').textContent = mode === 'motion'
    ? 'Hold the button, swing your arm forward like a bowler, and let go to throw.'
    : 'Swipe up on this pad to throw. Curve the swipe to add hook.';
  $('padLbl').textContent = mode === 'motion' ? (holding ? 'SWING!' : 'HOLD') : 'SWIPE ↑';
}

function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 1400);
}

// ---- Mode switch ----------------------------------------------------------------
function setMode(m) {
  mode = m;
  for (const b of $('mode').children) b.classList.toggle('on', b.dataset.mode === m);
  $('tilt').checked = m === 'motion' && sensorsOk;
  updatePad();
}
$('mode').addEventListener('click', (e) => {
  const m = e.target.dataset && e.target.dataset.mode;
  if (!m) return;
  if (m === 'motion' && !sensorsOk) { showWarn(); return; }
  setMode(m);
});

function showWarn() {
  const w = $('warn');
  w.style.display = 'block';
  w.textContent = window.isSecureContext
    ? 'No motion sensor data from this browser, so Swipe mode is on.'
    : `Motion sensors only work on the phone running the server, at http://localhost:${location.port || 3000}/controller. Swipe mode is on.`;
}

// ---- Position (slider + tilt) -------------------------------------------------
let lastPosSent = 0;
function setPosition(p, fromSlider) {
  position = clamp(p, -1, 1);
  if (!fromSlider) $('posRange').value = Math.round(position * 100);
  const now = performance.now();
  if (now - lastPosSent > 33) { // ~30 updates/s
    lastPosSent = now;
    net.send({ type: 'pos', x: position });
  }
}
$('posRange').addEventListener('input', (e) => {
  $('tilt').checked = false;
  setPosition(e.target.value / 100, true);
});

let smoothTilt = 0;
window.addEventListener('deviceorientation', (e) => {
  if (e.gamma == null || holding || !$('tilt').checked || mode !== 'motion') return;
  smoothTilt += (e.gamma - smoothTilt) * 0.2;
  setPosition(smoothTilt / MOTION.tiltRange, false);
});

// ---- Motion sensors -----------------------------------------------------------
window.addEventListener('devicemotion', (e) => {
  const r = e.rotationRate;
  if (!r || (r.alpha == null && r.beta == null)) return;
  if (!sensorsOk) { sensorsOk = true; $('warn').style.display = 'none'; if (mode === 'motion') $('tilt').checked = true; }
  const t = performance.now();
  samples.push({ t, a: r.alpha || 0, b: r.beta || 0, g: r.gamma || 0 });
  while (samples.length && t - samples[0].t > 800) samples.shift();
});

setTimeout(() => {
  if (!sensorsOk) { setMode('swipe'); showWarn(); }
}, 1500);

function motionThrow() {
  const now = performance.now();
  const swing = samples.filter((s) => now - s.t < 350);
  const release = samples.filter((s) => now - s.t < 140);
  if (!swing.length) return null;

  let peak = 0;
  for (const s of swing) peak = Math.max(peak, Math.hypot(s.a, s.b, s.g));
  if (peak < MOTION.minPeak) return { tooSoft: true };

  const avg = (k) => release.reduce((sum, s) => sum + s[k], 0) / Math.max(1, release.length);
  const speed = clamp((peak - MOTION.slowPeak) / (MOTION.fastPeak - MOTION.slowPeak), 0, 1);
  let hook = clamp(avg('g') / MOTION.twistFull, -1, 1);
  if (Math.abs(hook) < 0.12) hook = 0;
  const angle = clamp(avg('a') / MOTION.yawFull, -1, 1) * 0.6;
  return { speed, hook, angle, peak: Math.round(peak) };
}

// ---- Pad input ------------------------------------------------------------------
const trail = $('trail');
const tctx = trail.getContext('2d');
function sizeTrail() {
  trail.width = pad.clientWidth * devicePixelRatio;
  trail.height = pad.clientHeight * devicePixelRatio;
}
addEventListener('resize', sizeTrail);
sizeTrail();

function drawTrail() {
  tctx.clearRect(0, 0, trail.width, trail.height);
  if (swipePts.length < 2) return;
  const rect = pad.getBoundingClientRect();
  tctx.strokeStyle = 'rgba(255,176,58,.8)';
  tctx.lineWidth = 6 * devicePixelRatio;
  tctx.lineCap = 'round';
  tctx.beginPath();
  swipePts.forEach((p, i) => {
    const x = (p.x - rect.left) * devicePixelRatio, y = (p.y - rect.top) * devicePixelRatio;
    i ? tctx.lineTo(x, y) : tctx.moveTo(x, y);
  });
  tctx.stroke();
}

async function keepAwake() {
  try { if (!wakeLock && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { wakeLock = null; keepAwake(); } });

pad.addEventListener('pointerdown', (e) => {
  keepAwake();
  if (tvCount === 0 || !canThrow) return;
  pad.setPointerCapture(e.pointerId);
  holding = true;
  pad.classList.add('holding');
  swipePts = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
  net.send({ type: 'holding', on: true });
  if (navigator.vibrate) navigator.vibrate(15);
  updatePad();
});

pad.addEventListener('pointermove', (e) => {
  if (!holding || mode !== 'swipe') return;
  swipePts.push({ x: e.clientX, y: e.clientY, t: performance.now() });
  drawTrail();
});

function endHold(cancelled) {
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
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
    return;
  }
  net.send({ type: 'throw', speed: th.speed, hook: th.hook, angle: th.angle, x: position });
  canThrow = false;
  updatePad();
  const hookTxt = th.hook > 0.15 ? ' · hook →' : th.hook < -0.15 ? ' · hook ←' : '';
  $('last').textContent = `Power ${Math.round(th.speed * 100)}%${hookTxt}${th.peak ? ` · swing ${th.peak}°/s` : ''}`;
}
pad.addEventListener('pointerup', () => endHold(false));
pad.addEventListener('pointercancel', () => endHold(true));

function swipeThrow() {
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

$('newGame').addEventListener('click', () => {
  if (confirm('Start a new game?')) net.send({ type: 'cmd', action: 'newgame' });
});

updatePad();
