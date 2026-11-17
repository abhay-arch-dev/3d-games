import { connect } from './net.js';
import { createTracker, LM } from './gestures.js';

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');

// Points sent to the TV for its stick-figure view.
const SEND = [LM.nose, LM.lShoulder, LM.rShoulder, LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist,
  LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle];
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

let tvCount = 0, canThrow = false;
let facing = 'user';
let landmarker = null, stream = null, running = false;
let wakeLock = null;
const tracker = createTracker({ hand: localStorageGet('hand') || 'right' });

function localStorageGet(k) { try { return localStorage.getItem('bowl.' + k); } catch { return null; } }
function localStorageSet(k, v) { try { localStorage.setItem('bowl.' + k, v); } catch {} }

const net = connect('controller', (msg) => {
  if (msg.type === 'peers') { tvCount = msg.tv; $('dTv').classList.toggle('on', tvCount > 0); }
  else if (msg.type === 'state') canThrow = !!msg.canThrow;
}, (on) => $('dServer').classList.toggle('on', on));

// ---- Settings -------------------------------------------------------------------
function seg(id, value, onPick) {
  const el = $(id);
  const mark = (v) => { for (const b of el.children) b.classList.toggle('on', b.dataset.v === v); };
  mark(value);
  el.addEventListener('click', (e) => { const v = e.target.dataset && e.target.dataset.v; if (v) { mark(v); onPick(v); } });
}
seg('hand', tracker.hand, (v) => { tracker.setHand(v); localStorageSet('hand', v); });
seg('cam', facing, (v) => { facing = v; startCamera(); });
seg('prev', 'on', (v) => document.body.classList.toggle('nopreview', v === 'off'));

// ---- Camera + model --------------------------------------------------------------
async function loadModel() {
  const { FilesetResolver, PoseLandmarker } = await import('/lib/mediapipe/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('/lib/mediapipe/wasm');
  const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try { return await make('GPU'); } catch (e) { console.warn('GPU delegate failed, using CPU', e); return make('CPU'); }
}

async function startCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;
  await video.play();
  // Show the front camera like a mirror; the back camera as-is.
  video.classList.toggle('mirror', facing === 'user');
  canvas.classList.toggle('mirror', facing === 'user');
}

$('go').addEventListener('click', async () => {
  $('go').disabled = true;
  $('err').textContent = '';
  try {
    if (!window.isSecureContext) throw new Error(`The camera only works at http://localhost:${location.port || 3000}/camera on the phone running the server.`);
    $('go').textContent = 'Starting camera…';
    await startCamera();
    $('go').textContent = 'Loading body tracking…';
    landmarker = await loadModel();
    $('start').classList.add('hide');
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    running = true;
    loop();
  } catch (e) {
    console.error(e);
    $('err').textContent = e.message || String(e);
    $('go').disabled = false;
    $('go').textContent = 'Try again';
  }
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && running) { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
});

// ---- Main loop ---------------------------------------------------------------------
let lastVideoTime = -1, frames = 0, fpsT = performance.now();
let lastPoseSent = 0, lastPosSent = 0, wasReady = false, stateTimer = 0;

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  let result;
  try { result = landmarker.detectForVideo(video, now); } catch (e) { console.error(e); return; }
  const lm = result.landmarks && result.landmarks[0];
  handlePose(lm, now / 1000);
  draw(lm);

  frames++;
  if (now - fpsT > 1000) { $('fps').textContent = `${Math.round((frames * 1000) / (now - fpsT))} fps`; frames = 0; fpsT = now; }
}

export function handlePose(lm, t) {
  const r = tracker.update(lm, t, canThrow && tvCount > 0);
  const nowMs = t * 1000;

  if (r.visible && nowMs - lastPosSent > 50 && canThrow) {
    lastPosSent = nowMs;
    net.send({ type: 'pos', x: r.pos });
  }
  if (r.ready !== wasReady) { wasReady = r.ready; net.send({ type: 'holding', on: r.ready }); }
  if (r.throw) {
    net.send({ type: 'throw', ...r.throw });
    canThrow = false;
    setState(`Throw! ${Math.round(r.throw.speed * 100)}%`, 'thrown', 1200);
  }
  if (r.newGame) net.send({ type: 'cmd', action: 'newgame', soft: true });

  // Stick figure for the TV (~15 per second). Mirrored so the TV acts like a mirror.
  if (nowMs - lastPoseSent > 66) {
    lastPoseSent = nowMs;
    net.send({
      type: 'pose',
      visible: r.visible,
      ready: r.ready,
      lean: r.lean || 0,
      p: lm && r.visible ? SEND.flatMap((i) => [+(1 - lm[i].x).toFixed(3), +lm[i].y.toFixed(3), +(lm[i].visibility ?? 1).toFixed(2)]) : null,
    });
  }

  if (nowMs > stateTimer) {
    if (tvCount === 0) setState('Open the game on the TV');
    else if (!r.visible) setState('Step into view: whole body');
    else if (!canThrow) setState('Wait for the pins…');
    else if (r.ready) setState('Ready, swing!', 'ready');
    else setState(`Lower your ${tracker.hand} arm`);
  }
  return r;
}

function setState(text, cls = '', holdMs = 0) {
  const el = $('state');
  if (el.textContent !== text) el.textContent = text;
  el.className = cls;
  if (holdMs) stateTimer = performance.now() + holdMs;
}

function draw(lm) {
  const w = video.videoWidth, h = video.videoHeight;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.clearRect(0, 0, w, h);
  if (!lm) return;
  ctx.lineWidth = Math.max(3, w / 160);
  ctx.strokeStyle = wasReady ? '#3ddc97' : 'rgba(255,176,58,.9)';
  ctx.beginPath();
  for (const [a, b] of BONES) {
    if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue;
    ctx.moveTo(lm[a].x * w, lm[a].y * h);
    ctx.lineTo(lm[b].x * w, lm[b].y * h);
  }
  ctx.stroke();
  ctx.fillStyle = '#fff';
  for (const i of SEND) {
    if ((lm[i].visibility ?? 1) < 0.4) continue;
    ctx.beginPath(); ctx.arc(lm[i].x * w, lm[i].y * h, ctx.lineWidth, 0, Math.PI * 2); ctx.fill();
  }
}

setState('Tap Start camera');

// Show the address the TV should open.
function showTvAddress() {
  fetch('/api/info').then((r) => r.json()).then((info) => {
    const url = info.ips.length ? `http://${info.ips[0]}:${info.port}/tv` : 'Connect this phone to Wi-Fi';
    $('tvUrl').textContent = url;
    $('tvAddr').textContent = info.ips.length ? `TV: ${info.ips[0]}:${info.port}/tv` : 'No Wi-Fi';
  }).catch(() => {});
}
showTvAddress();
setInterval(showTvAddress, 10000);

// Inside the Android app the camera permission is already granted, so start right away.
if (new URLSearchParams(location.search).has('app')) setTimeout(() => $('go').click(), 300);
// For automated testing without a camera.
window.__camera = { handlePose, tracker, setCanThrow: (v) => { canThrow = v; }, get tvCount() { return tvCount; } };
