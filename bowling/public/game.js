import * as THREE from '/lib/three.module.min.js';
import { connect } from './net.js';

// ============================================================================
// Settings
// ============================================================================
const params = new URLSearchParams(location.search);
const LOW = params.get('quality') === 'low';

// Real bowling dimensions in metres.
const LANE_W = 1.054, LANE_HALF = LANE_W / 2;
const GUTTER_R = 0.117;
const FOUL_TO_HEADPIN = 18.29;
const HEAD_Z = -FOUL_TO_HEADPIN;
const PIN_SPACING = 0.3048;
const ROW_GAP = PIN_SPACING * Math.sin(Math.PI / 3);
const DECK_END = HEAD_Z - ROW_GAP * 3 - 0.35;
const BALL_R = 0.109, BALL_M = 7.0;
const PIN_R = 0.06, PIN_M = 1.55;
const START_Z = 0.35;
const POS_RANGE = LANE_HALF - BALL_R - 0.03;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (id) => document.getElementById(id);

// ============================================================================
// Renderer, scene, camera
// ============================================================================
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: !LOW, powerPreference: 'high-performance' });
} catch (e) {
  $('err').textContent = 'This browser cannot run 3D graphics (WebGL). Try another browser on the TV.';
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !LOW;
renderer.shadowMap.type = THREE.PCFShadowMap;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x070a12);
scene.fog = new THREE.Fog(0x070a12, 14, 34);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 80);
camera.position.set(0, 1.35, 2.6);
const camLook = new THREE.Vector3(0, 0.2, -10);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// Lights
scene.add(new THREE.HemisphereLight(0xfff4e6, 0x1a2033, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(1.5, 9, -9);
sun.target.position.set(0, 0, -12);
scene.add(sun, sun.target);
if (!LOW) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -3; s.right = 3; s.top = 12; s.bottom = -12; s.near = 1; s.far = 25;
  sun.shadow.bias = -0.0005;
}
const pinLight = new THREE.PointLight(0xfff0d8, 2.5, 4, 1.5);
pinLight.position.set(0, 1.6, HEAD_Z - 0.2);
scene.add(pinLight);

// ============================================================================
// Textures drawn on canvases (no image files needed)
// ============================================================================
function laneTexture(len, approach) {
  const W = 128, H = approach ? 256 : 2048;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const boards = 39;
  for (let i = 0; i < boards; i++) {
    const shade = 200 + ((i * 37) % 23) - 11;
    g.fillStyle = approach
      ? `rgb(${shade - 10},${shade - 45},${shade - 105})`
      : `rgb(${shade + 20},${shade - 30},${shade - 105})`;
    g.fillRect((i / boards) * W, 0, W / boards + 1, H);
    g.fillStyle = 'rgba(80,40,10,.18)';
    g.fillRect((i / boards) * W, 0, 0.6, H);
  }
  // Wood grain streaks
  for (let i = 0; i < (approach ? 60 : 400); i++) {
    g.fillStyle = `rgba(90,45,15,${0.04 + Math.random() * 0.05})`;
    g.fillRect(Math.random() * W, Math.random() * H, 0.7, 10 + Math.random() * 60);
  }
  if (!approach) {
    const yAt = (dist) => H * (1 - dist / len);
    const xAt = (board) => (board / boards) * W;
    // Guide dots at 7 ft
    g.fillStyle = '#4a2a14';
    for (const b of [3, 5, 8, 11, 14, 25, 28, 31, 34, 36]) {
      g.beginPath(); g.arc(xAt(b + 0.5), yAt(2.13), 1.4, 0, Math.PI * 2); g.fill();
    }
    // Target arrows (V shape, 12–16 ft)
    g.fillStyle = '#3a1f0f';
    for (let k = 0; k < 7; k++) {
      const board = 4.5 + k * 5;
      const depth = 3.66 + (3 - Math.abs(k - 3)) * 0.3;
      const x = xAt(board + 0.5), y = yAt(depth);
      g.beginPath(); g.moveTo(x, y - 14); g.lineTo(x - 2.4, y + 6); g.lineTo(x + 2.4, y + 6); g.closePath(); g.fill();
    }
    // Pin spots
    g.fillStyle = 'rgba(40,20,10,.55)';
    for (const p of pinSpots()) {
      g.beginPath(); g.arc(W / 2 + (p.x / LANE_W) * W, yAt(-p.z), 1.6, 0, Math.PI * 2); g.fill();
    }
  } else {
    // Foul line at the far edge of the approach
    g.fillStyle = '#111'; g.fillRect(0, 0, W, 4);
    g.fillStyle = '#3a1f0f';
    for (const b of [5, 10, 15, 20, 25, 30, 35]) { g.beginPath(); g.arc(xAt2(b), 60, 1.6, 0, Math.PI * 2); g.fill(); }
  }
  function xAt2(b) { return (b / boards) * W; }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 512, 256);
  grd.addColorStop(0, '#1b3cff'); grd.addColorStop(0.5, '#7a1bff'); grd.addColorStop(1, '#1b3cff');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  // Marbled swirls
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(${150 + Math.random() * 100},${120 + Math.random() * 120},255,${0.12 + Math.random() * 0.2})`;
    g.lineWidth = 2 + Math.random() * 7;
    g.beginPath();
    let x = Math.random() * 512, y = Math.random() * 256;
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 160; y += (Math.random() - 0.5) * 90; g.quadraticCurveTo(x + 40, y - 30, x, y); }
    g.stroke();
  }
  // Finger holes
  g.fillStyle = '#05060a';
  for (const [x, y, r] of [[250, 60, 12], [278, 62, 12], [264, 104, 15]]) { g.beginPath(); g.ellipse(x, y, r, r * 1.6, 0, 0, Math.PI * 2); g.fill(); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function signTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 512, 0);
  grd.addColorStop(0, '#1a0c2e'); grd.addColorStop(0.5, '#2c0f3d'); grd.addColorStop(1, '#1a0c2e');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 128);
  g.font = '900 64px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#ff7a2f'; g.shadowBlur = 24;
  g.fillStyle = '#ffd08a';
  g.fillText(text, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ============================================================================
// Alley geometry
// ============================================================================
function pinSpots() {
  const out = [];
  for (let r = 0; r < 4; r++) for (let k = 0; k <= r; k++) out.push({ x: (k - r / 2) * PIN_SPACING, z: HEAD_Z - r * ROW_GAP });
  return out;
}

const laneLen = -DECK_END;
const laneTex = laneTexture(laneLen, false);
const approachTex = laneTexture(5, true);
const laneMat = new THREE.MeshStandardMaterial({ map: laneTex, roughness: 0.28, metalness: 0.0 });
const approachMat = new THREE.MeshStandardMaterial({ map: approachTex, roughness: 0.45 });
const gutterMat = new THREE.MeshStandardMaterial({ color: 0x8a90a0, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide });
const capMat = new THREE.MeshStandardMaterial({ color: 0x1b2236, roughness: 0.6 });
const floorMat = new THREE.MeshStandardMaterial({ color: 0x10141f, roughness: 0.9 });
const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d });
const glowMat2 = new THREE.MeshBasicMaterial({ color: 0x5b7cff });

function buildLane(xOffset, main) {
  const g = new THREE.Group();
  g.position.x = xOffset;

  const lane = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W, laneLen), laneMat);
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0, DECK_END / 2);
  lane.receiveShadow = main;
  g.add(lane);

  const app = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W + GUTTER_R * 4 + 0.2, 5), approachMat);
  app.rotation.x = -Math.PI / 2;
  app.position.set(0, 0, 2.5);
  app.receiveShadow = main;
  g.add(app);

  const gutterGeo = new THREE.CylinderGeometry(GUTTER_R, GUTTER_R, laneLen, 14, 1, true, -Math.PI / 2, Math.PI);
  for (const s of [-1, 1]) {
    const gm = new THREE.Mesh(gutterGeo, gutterMat);
    gm.rotation.x = Math.PI / 2;
    gm.position.set(s * (LANE_HALF + GUTTER_R), 0, DECK_END / 2);
    gm.receiveShadow = main;
    g.add(gm);
    // Capping between lanes
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, laneLen + 0.2), capMat);
    cap.position.set(s * (LANE_HALF + GUTTER_R * 2 + 0.07), 0.03, DECK_END / 2);
    g.add(cap);
    // Kickback walls at the pin deck
    const kick = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.55, 2.2), capMat);
    kick.position.set(s * (LANE_HALF + GUTTER_R * 2 + 0.03), 0.27, HEAD_Z - 0.6);
    g.add(kick);
    // Glow strip
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.01, laneLen), s < 0 ? glowMat2 : glowMat);
    strip.position.set(s * (LANE_HALF + GUTTER_R * 2 + 0.07), 0.065, DECK_END / 2);
    g.add(strip);
  }

  // Pit and back curtain
  const pit = new THREE.Mesh(new THREE.BoxGeometry(LANE_W + GUTTER_R * 4, 0.02, 1.2), new THREE.MeshBasicMaterial({ color: 0x030407 }));
  pit.position.set(0, -0.12, DECK_END - 0.6);
  g.add(pit);
  const curtain = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W + GUTTER_R * 4 + 0.3, 1.2), new THREE.MeshStandardMaterial({ color: 0x0b0d16, roughness: 1 }));
  curtain.position.set(0, 0.5, DECK_END - 1.2);
  g.add(curtain);

  // Masking unit sign above the pins
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(LANE_W + GUTTER_R * 4 + 0.3, 0.55),
    new THREE.MeshBasicMaterial({ map: signTexture(main ? 'STRIKE ZONE' : 'LANE ' + (xOffset > 0 ? 6 : 4)) }));
  sign.position.set(0, 1.5, HEAD_Z - 0.3);
  g.add(sign);

  scene.add(g);
  return g;
}

const LANE_PITCH = LANE_W + GUTTER_R * 4 + 0.28;
buildLane(0, true);
for (const k of [-1, 1, -2, 2]) buildLane(k * LANE_PITCH, false);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 60), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, -0.13, -10);
scene.add(floor);

// Ceiling light bars for atmosphere
for (let z = -2; z > DECK_END; z -= 4) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(8, 0.03, 0.12), new THREE.MeshBasicMaterial({ color: 0x2b335a }));
  bar.position.set(0, 3.2, z);
  scene.add(bar);
}

// ============================================================================
// Pins
// ============================================================================
const pinProfile = [
  [0, 0], [0.026, 0], [0.04, 0.02], [0.054, 0.065], [0.0605, 0.112], [0.056, 0.155],
  [0.044, 0.2], [0.028, 0.24], [0.02, 0.265], [0.019, 0.28], [0.022, 0.305], [0.029, 0.335],
  [0.031, 0.352], [0.026, 0.37], [0.014, 0.379], [0, 0.381],
].map(([r, h]) => new THREE.Vector2(r, h));
const pinGeo = new THREE.LatheGeometry(pinProfile, LOW ? 10 : 18);
const pinMat = new THREE.MeshStandardMaterial({ color: 0xf8f6f0, roughness: 0.3 });
const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd8192a, roughness: 0.35 });
const stripeGeoA = new THREE.CylinderGeometry(0.0212, 0.0198, 0.011, LOW ? 10 : 18);
const stripeGeoB = new THREE.CylinderGeometry(0.0222, 0.0214, 0.011, LOW ? 10 : 18);

function makePinMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(pinGeo, pinMat);
  body.castShadow = !LOW;
  g.add(body);
  const s1 = new THREE.Mesh(stripeGeoA, stripeMat); s1.position.y = 0.258;
  const s2 = new THREE.Mesh(stripeGeoB, stripeMat); s2.position.y = 0.29;
  g.add(s1, s2);
  scene.add(g);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpV = new THREE.Vector3();

const pins = pinSpots().map((spot, i) => ({
  i, spot, mesh: makePinMesh(),
  x: 0, z: 0, vx: 0, vz: 0, y: 0,
  tilt: 0, tiltV: 0, dx: 0, dz: 1, falling: false,
  yaw: 0, yawV: 0, out: false, drop: 0,
}));

function placePin(p, fromAbove) {
  p.x = p.spot.x; p.z = p.spot.z; p.vx = p.vz = 0; p.y = 0;
  p.tilt = p.tiltV = 0; p.falling = false; p.out = false;
  p.yaw = Math.random() * Math.PI * 2; p.yawV = 0;
  p.drop = fromAbove ? 0.6 : 0;
  p.mesh.visible = true;
}

function isStanding(p) { return !p.out && !p.falling; }

// Collision centre moves along the fall direction so a toppling pin sweeps its neighbours.
function pinCenter(p) {
  const s = Math.sin(p.tilt) * 0.17;
  return { x: p.x + p.dx * s, z: p.z + p.dz * s, r: PIN_R + Math.sin(p.tilt) * 0.025 };
}

function knockPin(p, dirX, dirZ, power) {
  if (p.falling || p.out) return;
  const len = Math.hypot(dirX, dirZ) || 1;
  const jitter = (Math.random() - 0.5) * 0.5;
  const ang = Math.atan2(dirX / len, dirZ / len) + jitter;
  p.dx = Math.sin(ang); p.dz = Math.cos(ang);
  p.falling = true;
  p.tiltV = 2.5 + power * 4;
  p.yawV = (Math.random() - 0.5) * 10 * power;
}

function updatePinMesh(p) {
  const m = p.mesh;
  if (!m.visible) return;
  tmpQ.setFromAxisAngle(UP, p.yaw);
  tmpV.set(p.dz, 0, -p.dx).normalize(); // axis = up × fallDir
  tmpQ2.setFromAxisAngle(tmpV, p.tilt);
  m.quaternion.copy(tmpQ2).multiply(tmpQ);
  m.position.set(p.x, p.y + Math.sin(p.tilt) * 0.05 + p.drop, p.z);
}

// ============================================================================
// Ball and aim guide
// ============================================================================
const ballMesh = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R, LOW ? 20 : 32, LOW ? 14 : 24),
  new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.15, metalness: 0.1, emissive: 0xff7a2f, emissiveIntensity: 0 }),
);
ballMesh.castShadow = !LOW;
scene.add(ballMesh);

const ball = {
  x: 0, y: BALL_R, z: START_Z, vx: 0, vz: 0, hook: 0,
  rolling: false, gutter: 0, pit: false, hitSent: false,
};

const aimGroup = new THREE.Group();
const aimMat = new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true, opacity: 0.55, depthWrite: false });
for (let i = 0; i < 8; i++) {
  const chev = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 3), aimMat);
  chev.rotation.x = -Math.PI / 2;
  chev.position.set(0, 0.01, -0.6 - i * 0.55);
  chev.scale.y = 0.15;
  aimGroup.add(chev);
}
scene.add(aimGroup);

// ============================================================================
// Sound (Web Audio, synthesised)
// ============================================================================
const audio = { ctx: null, roll: null, noise: null, lastHit: 0 };
function initAudio() {
  if (audio.ctx) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5 + (Math.random() * 2 - 1) * 0.08; }
    audio.noise = buf;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
    const gain = ctx.createGain(); gain.gain.value = 0;
    src.connect(lp).connect(gain).connect(ctx.destination);
    src.start();
    audio.ctx = ctx; audio.roll = gain;
  } catch { /* no audio available */ }
}
function playHit(power) {
  const ctx = audio.ctx;
  if (!ctx || ctx.currentTime - audio.lastHit < 0.025) return;
  audio.lastHit = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = audio.noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400 + Math.random() * 1600; bp.Q.value = 1.2;
  const g = ctx.createGain();
  const t = ctx.currentTime, v = clamp(power, 0.05, 1) * 0.9;
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t, Math.random()); src.stop(t + 0.2);
}

// ============================================================================
// Scoring
// ============================================================================
const mark = (n) => (n === 0 ? '-' : String(n));

function scoreFrames(rolls) {
  const frames = [];
  let i = 0, total = 0, pending = false;
  for (let f = 0; f < 9; f++) {
    const a = rolls[i], b = rolls[i + 1], c = rolls[i + 2];
    let marks = ['', ''], add = null;
    if (a === undefined) { frames.push({ marks, total: null }); continue; }
    if (a === 10) { marks = ['', 'X']; if (b !== undefined && c !== undefined) add = 10 + b + c; i += 1; }
    else if (b === undefined) { marks = [mark(a), '']; i += 1; }
    else if (a + b === 10) { marks = [mark(a), '/']; if (c !== undefined) add = 10 + c; i += 2; }
    else { marks = [mark(a), mark(b)]; add = a + b; i += 2; }
    if (add === null) pending = true; else if (!pending) total += add;
    frames.push({ marks, total: add !== null && !pending ? total : null });
  }
  const t = rolls.slice(i, i + 3);
  const m = ['', '', ''];
  if (t.length > 0) m[0] = t[0] === 10 ? 'X' : mark(t[0]);
  if (t.length > 1) m[1] = t[0] === 10 ? (t[1] === 10 ? 'X' : mark(t[1])) : (t[0] + t[1] === 10 ? '/' : mark(t[1]));
  if (t.length > 2) {
    const freshRack = (t[0] === 10 && t[1] === 10) || (t[0] !== 10 && t[0] + t[1] === 10);
    m[2] = freshRack ? (t[2] === 10 ? 'X' : mark(t[2])) : (t[1] + t[2] === 10 ? '/' : mark(t[2]));
  }
  const done = t.length === 3 || (t.length === 2 && t[0] + t[1] < 10);
  if (done && !pending) total += t.reduce((s, v) => s + v, 0);
  frames.push({ marks: m, total: done && !pending ? total : null });
  return frames;
}

function runningTotal(frames) {
  let last = 0;
  for (const f of frames) if (f.total !== null) last = f.total;
  return last;
}

// ============================================================================
// Game state
// ============================================================================
const game = {
  rolls: [], frame: 0, roll: 0, tenthStart: -1,
  phase: 'ready', // ready | rolling | result | over
  phaseTime: 0, rollTime: 0, standingBefore: 10,
  position: 0, targetPos: 0, holding: false,
  lastKmh: null,
};

function newGame() {
  game.rolls = []; game.frame = 0; game.roll = 0; game.tenthStart = -1;
  $('remote').textContent = 'Remote: ◀ ▶ move · OK throw';
  pins.forEach((p) => placePin(p, true));
  resetBall();
  setPhase('ready');
  renderBoard();
  hideMsg();
}

function resetBall() {
  ball.rolling = false; ball.gutter = 0; ball.pit = false; ball.hitSent = false;
  ball.vx = ball.vz = 0; ball.hook = 0;
  ball.x = game.position * POS_RANGE; ball.z = START_Z; ball.y = BALL_R;
  ballMesh.visible = true;
}

function setPhase(ph) {
  game.phase = ph; game.phaseTime = 0;
  sendState();
}

function sendState() {
  const frames = scoreFrames(game.rolls);
  net.send({
    type: 'state',
    frame: Math.min(game.frame + 1, 10),
    roll: game.roll + 1,
    total: runningTotal(frames),
    canThrow: game.phase === 'ready',
    over: game.phase === 'over',
  });
}

function throwBall({ speed = 0.5, hook = 0, angle = 0, x }) {
  if (game.phase !== 'ready') return;
  hideOverlay(false);
  if (typeof x === 'number') game.position = game.targetPos = clamp(x, -1, 1);
  ball.x = game.position * POS_RANGE;
  const v = 4.2 + clamp(speed, 0, 1) * 5.8; // 4.2–10 m/s (15–36 km/h)
  const a = clamp(angle, -1, 1) * THREE.MathUtils.degToRad(2.2);
  ball.vx = Math.sin(a) * v;
  ball.vz = -Math.cos(a) * v;
  ball.hook = clamp(hook, -1, 1);
  ball.rolling = true;
  game.standingBefore = pins.filter(isStanding).length;
  game.rollTime = 0;
  game.lastKmh = Math.round(v * 3.6);
  $('kmh').textContent = `${game.lastKmh} km/h`;
  net.send({ type: 'thrown', kmh: game.lastKmh });
  setPhase('rolling');
}

function finishRoll() {
  const standing = pins.filter(isStanding).length;
  const knocked = game.standingBefore - standing;
  const rackWasFull = game.standingBefore === 10;
  game.rolls.push(knocked);

  let kind = 'normal', label;
  if (standing === 0 && rackWasFull && (game.frame < 9 ? game.roll === 0 : true)) { kind = 'strike'; label = 'STRIKE!'; }
  else if (standing === 0) { kind = 'spare'; label = 'SPARE!'; }
  else if (knocked === 0) label = ball.gutter ? 'Gutter ball' : 'Missed';
  else label = knocked === 1 ? '1 pin' : `${knocked} pins`;

  let resetRack = false, over = false;
  if (game.frame < 9) {
    if (game.roll === 0 && standing > 0) game.roll = 1;
    else { game.frame++; game.roll = 0; resetRack = true; }
    if (game.frame === 9 && game.roll === 0) game.tenthStart = game.rolls.length;
  } else {
    const t = game.rolls.slice(game.tenthStart);
    if (standing === 0) resetRack = true;
    game.roll++;
    if (game.roll === 2 && t[0] + t[1] < 10) over = true;
    if (game.roll === 3) over = true;
  }

  renderBoard();
  showMsg(label, kind === 'normal');
  net.send({ type: 'result', label, kind, knocked });
  game.pending = { resetRack, over };
  setPhase('result');
}

function afterResult() {
  const { resetRack, over } = game.pending;
  if (over) {
    const total = runningTotal(scoreFrames(game.rolls));
    showMsg(`Final score ${total}`, true, true);
    $('remote').textContent = 'New game: raise both hands, or press OK';
    setPhase('over');
    return;
  }
  hideMsg();
  if (resetRack) pins.forEach((p) => placePin(p, true));
  else pins.forEach((p) => {
    if (!isStanding(p)) { p.out = true; p.mesh.visible = false; }
    else { p.vx = p.vz = 0; }
  });
  resetBall();
  setPhase('ready');
}

// ============================================================================
// Physics
// ============================================================================
function collide(ax, az, ar, am, a, bx, bz, br, bm, b, e) {
  // a and b are objects with vx, vz; positions passed separately (collision centres).
  const dx = bx - ax, dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const minD = ar + br;
  if (dist >= minD || dist === 0) return 0;
  const nx = dx / dist, nz = dz / dist;
  // Separate
  const overlap = minD - dist;
  const ia = 1 / am, ib = 1 / bm, sum = ia + ib;
  a.x -= nx * overlap * (ia / sum); a.z -= nz * overlap * (ia / sum);
  b.x += nx * overlap * (ib / sum); b.z += nz * overlap * (ib / sum);
  const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (rel <= 0) return 0;
  const j = ((1 + e) * rel) / sum;
  a.vx -= j * ia * nx; a.vz -= j * ia * nz;
  b.vx += j * ib * nx; b.vz += j * ib * nz;
  // A little random sideways scatter makes pin action less predictable.
  const tx = -nz, tz = nx, sc = (Math.random() - 0.5) * 0.25 * rel;
  b.vx += tx * sc; b.vz += tz * sc;
  return j;
}

function stepPhysics(dt) {
  // ---- Ball ----
  if (ball.rolling) {
    const speed = Math.hypot(ball.vx, ball.vz);
    if (!ball.gutter && !ball.pit) {
      // Oil pattern: the front of the lane is slick, the back end lets the ball hook.
      const dist = -ball.z;
      const oil = dist < 11 ? 0.12 : clamp((dist - 11) / 2, 0.12, 1);
      ball.vx += ball.hook * 1.25 * oil * dt;
      ball.vx = clamp(ball.vx, -0.6 * speed, 0.6 * speed);
      if (Math.abs(ball.x) > LANE_HALF - 0.01 && ball.z > DECK_END) {
        ball.gutter = Math.sign(ball.x);
        ball.hook = 0;
      }
    }
    if (ball.gutter) {
      const gx = ball.gutter * (LANE_HALF + GUTTER_R);
      ball.x = lerp(ball.x, gx, Math.min(1, dt * 14));
      ball.y = lerp(ball.y, GUTTER_R * -0.05, Math.min(1, dt * 14));
      ball.vx = 0;
    }
    const decel = 0.12 * dt;
    const s = Math.hypot(ball.vx, ball.vz);
    if (s > decel) { ball.vx -= (ball.vx / s) * decel; ball.vz -= (ball.vz / s) * decel; }
    ball.x += ball.vx * dt;
    ball.z += ball.vz * dt;
    if (ball.z < DECK_END && !ball.pit) { ball.pit = true; }
    if (ball.pit) { ball.y -= dt * 1.5; ball.vz *= 0.9; ball.vx *= 0.9; if (ball.y < -0.4) ballMesh.visible = false; }

    // Ball vs pins (gutter balls pass beside the deck)
    if (!ball.gutter && !ball.pit) {
      for (const p of pins) {
        if (p.out || p.drop > 0) continue;
        const c = pinCenter(p);
        const holder = { x: c.x, z: c.z, vx: p.vx, vz: p.vz };
        const j = collide(ball.x, ball.z, BALL_R, BALL_M, ball, c.x, c.z, c.r, PIN_M, holder, 0.55);
        if (j > 0) {
          p.x += holder.x - c.x; p.z += holder.z - c.z; p.vx = holder.vx; p.vz = holder.vz;
          const ps = Math.hypot(p.vx, p.vz);
          knockPin(p, p.vx, p.vz, clamp(ps / 6, 0.2, 1));
          playHit(j / 18);
          if (!ball.hitSent) { ball.hitSent = true; net.send({ type: 'hit', power: clamp(j / 25, 0, 1) }); }
        }
      }
    }
  }

  // ---- Pins ----
  for (const p of pins) {
    if (p.out) continue;
    if (p.drop > 0) { p.drop = Math.max(0, p.drop - dt * 2.2); continue; }
    if (p.falling) {
      if (p.tilt < Math.PI / 2 - 0.06) {
        p.tiltV += (14 * Math.sin(p.tilt) + 3) * dt;
        p.tilt = Math.min(Math.PI / 2 - 0.06, p.tilt + p.tiltV * dt);
      }
      p.yaw += p.yawV * dt;
      p.yawV *= 1 - Math.min(1, dt * 2);
    }
    const s = Math.hypot(p.vx, p.vz);
    const fr = (p.falling ? 3.2 : 7) * dt;
    if (s > fr) { p.vx -= (p.vx / s) * fr; p.vz -= (p.vz / s) * fr; } else { p.vx = p.vz = 0; }
    p.x += p.vx * dt; p.z += p.vz * dt;
    if (!p.falling && s > 0.55) knockPin(p, p.vx, p.vz, clamp(s / 5, 0.2, 1));

    // Side walls on the deck bounce pins back in; pins that leave the deck are down.
    const wall = LANE_HALF + GUTTER_R * 2;
    if (Math.abs(p.x) > wall && p.z < HEAD_Z + 1.2) { p.x = Math.sign(p.x) * wall; p.vx *= -0.45; }
    if (Math.abs(p.x) > LANE_HALF + 0.02 || p.z < DECK_END) {
      if (!p.falling) knockPin(p, p.vx || Math.sign(p.x), p.vz || -1, 0.5);
      if (Math.abs(p.x) > LANE_HALF + 0.02) p.y = lerp(p.y, -0.09, Math.min(1, dt * 8));
      if (p.z < DECK_END) { p.y -= dt * 1.2; if (p.y < -0.5) { p.out = true; p.mesh.visible = false; } }
    }
  }

  // Pin vs pin
  for (let a = 0; a < pins.length; a++) {
    const A = pins[a];
    if (A.out || A.drop > 0) continue;
    for (let b = a + 1; b < pins.length; b++) {
      const B = pins[b];
      if (B.out || B.drop > 0) continue;
      if (!A.falling && !B.falling && Math.hypot(A.vx, A.vz) + Math.hypot(B.vx, B.vz) < 0.01) continue;
      const ca = pinCenter(A), cb = pinCenter(B);
      // A falling pin's sweep carries extra velocity into whatever it lands on.
      const sweepA = A.falling ? Math.cos(A.tilt) * A.tiltV * 0.17 : 0;
      const sweepB = B.falling ? Math.cos(B.tilt) * B.tiltV * 0.17 : 0;
      const ha = { x: ca.x, z: ca.z, vx: A.vx + A.dx * sweepA, vz: A.vz + A.dz * sweepA };
      const hb = { x: cb.x, z: cb.z, vx: B.vx + B.dx * sweepB, vz: B.vz + B.dz * sweepB };
      const j = collide(ca.x, ca.z, ca.r, PIN_M, ha, cb.x, cb.z, cb.r, PIN_M, hb, 0.45);
      if (j > 0) {
        A.x += ha.x - ca.x; A.z += ha.z - ca.z; A.vx = ha.vx - A.dx * sweepA; A.vz = ha.vz - A.dz * sweepA;
        B.x += hb.x - cb.x; B.z += hb.z - cb.z; B.vx = hb.vx - B.dx * sweepB; B.vz = hb.vz - B.dz * sweepB;
        if (j > 0.35) {
          if (!A.falling) knockPin(A, A.vx || -hb.vx, A.vz || -hb.vz, clamp(j / 4, 0.2, 1));
          if (!B.falling) knockPin(B, B.vx || ha.vx, B.vz || ha.vz, clamp(j / 4, 0.2, 1));
        }
        playHit(j / 8);
      }
    }
  }
}

function pinsSettled() {
  return pins.every((p) => p.out || p.drop > 0 ||
    (Math.hypot(p.vx, p.vz) < 0.06 && (!p.falling || p.tilt >= Math.PI / 2 - 0.07)));
}

// ============================================================================
// Camera
// ============================================================================
const camTarget = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

function updateCamera(dt) {
  if (game.phase === 'ready' || (game.phase === 'rolling' && ball.z > -1)) {
    const x = ball.x * 0.6;
    camTarget.set(x, 1.3, 2.7);
    lookTarget.set(x * 0.5, 0.15, -9);
  } else if (game.phase === 'rolling' && ball.z > HEAD_Z + 4.2 && !ball.pit) {
    camTarget.set(ball.x * 0.7, 0.75, ball.z + 2.4);
    lookTarget.set(ball.x * 0.3, 0.1, ball.z - 6);
  } else {
    camTarget.set(0, 1.0, HEAD_Z + 3.4);
    lookTarget.set(0, 0.12, HEAD_Z - 0.35);
  }
  const k = 1 - Math.exp(-dt * (game.phase === 'rolling' ? 6 : 3));
  camera.position.lerp(camTarget, k);
  camLook.lerp(lookTarget, k);
  camera.lookAt(camLook);
}

// ============================================================================
// HUD
// ============================================================================
function renderBoard() {
  const frames = scoreFrames(game.rolls);
  const cur = game.phase === 'over' ? -1 : game.frame;
  $('board').innerHTML = frames.map((f, i) => {
    const boxes = f.marks.map((m) => `<span class="${m === 'X' || m === '/' ? 'x' : ''}">${m}</span>`).join('');
    return `<div class="fr${i === cur ? ' cur' : ''}"><div class="n">${i + 1}</div><div class="m">${boxes}</div><div class="t">${f.total ?? ''}</div></div>`;
  }).join('');
}

function showMsg(text, small = false, stay = false) {
  const m = $('msg');
  m.textContent = text;
  m.classList.toggle('small', small);
  m.classList.remove('show');
  void m.offsetWidth;
  m.classList.add('show');
  clearTimeout(showMsg.t);
  if (!stay) showMsg.t = setTimeout(hideMsg, 1700);
}
function hideMsg() { $('msg').classList.remove('show'); }

let overlayOpen = true;
function hideOverlay(withSound) {
  if (!overlayOpen) return;
  overlayOpen = false;
  $('overlay').classList.add('hide');
  if (withSound) {
    initAudio();
    const el = document.documentElement;
    try { (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); } catch {}
  }
}
$('startBtn').addEventListener('click', () => hideOverlay(true));
$('startBtn').focus();

// ============================================================================
// Networking
// ============================================================================
let controllers = 0;
const net = connect('tv', (msg) => {
  switch (msg.type) {
    case 'peers': {
      const before = controllers;
      controllers = msg.controller;
      $('status').classList.toggle('on', controllers > 0);
      $('statusTxt').textContent = controllers > 0 ? `Phone connected${controllers > 1 ? ` (${controllers})` : ''}` : 'Waiting for phone…';
      if (controllers > before) sendState();
      break;
    }
    case 'pos':
      if (game.phase === 'ready') game.targetPos = clamp(msg.x, -1, 1);
      break;
    case 'holding':
      game.holding = !!msg.on;
      break;
    case 'throw':
      throwBall(msg);
      break;
    case 'cmd':
      // Gesture-triggered "new game" (both hands up) only works once the game is over.
      if (msg.action === 'newgame' && (!msg.soft || game.phase === 'over')) newGame();
      break;
    case 'pose':
      drawPose(msg);
      break;
  }
}, (on) => {
  if (!on) { $('status').classList.remove('on'); $('statusTxt').textContent = 'Reconnecting to server…'; }
  else sendState();
});

// Camera-mode stick figure
const poseCv = $('posecv'), poseCtx = poseCv.getContext('2d');
const POSE_BONES = [[1, 2], [1, 3], [3, 5], [2, 4], [4, 6], [1, 7], [2, 8], [7, 8], [7, 9], [9, 11], [8, 10], [10, 12]];
let lastPoseAt = 0;
function drawPose(msg) {
  lastPoseAt = performance.now();
  $('posebox').classList.add('on');
  $('hint').classList.add('on');
  $('posebox').classList.toggle('ready', !!msg.ready);
  $('poseLbl').textContent = !msg.visible ? 'Step into view' : msg.ready ? 'Ready, swing!' :
    game.phase === 'ready' ? 'Lower your arm' : 'Tracking';
  const W = poseCv.width, H = poseCv.height;
  poseCtx.clearRect(0, 0, W, H);
  const p = msg.p;
  if (!p) return;
  // Camera frames are 4:3 landscape; fit them into the portrait box, centred on the body.
  const scale = H / 0.9, cx = (p[7 * 3] + p[8 * 3]) / 2;
  const X = (i) => W / 2 + (p[i * 3] - cx) * scale * 0.75;
  const Y = (i) => (p[i * 3 + 1] - 0.05) * scale;
  const ok = (i) => p[i * 3 + 2] >= 0.4;
  poseCtx.lineCap = 'round';
  poseCtx.lineWidth = 7;
  poseCtx.strokeStyle = msg.ready ? '#3ddc97' : '#ffb03a';
  poseCtx.beginPath();
  for (const [a, b] of POSE_BONES) {
    if (!ok(a) || !ok(b)) continue;
    poseCtx.moveTo(X(a), Y(a)); poseCtx.lineTo(X(b), Y(b));
  }
  poseCtx.stroke();
  if (ok(0)) { poseCtx.fillStyle = poseCtx.strokeStyle; poseCtx.beginPath(); poseCtx.arc(X(0), Y(0), 14, 0, Math.PI * 2); poseCtx.fill(); }
}
setInterval(() => {
  if (lastPoseAt && performance.now() - lastPoseAt > 2000) {
    lastPoseAt = 0;
    $('posebox').classList.remove('on');
    $('hint').classList.remove('on');
  }
}, 500);

// TV remote / keyboard: D-pad moves, OK throws. Lets you play (or test) without the phone.
addEventListener('keydown', (e) => {
  if (overlayOpen) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideOverlay(true); }
    return;
  }
  if (e.key === 'ArrowLeft') game.targetPos = clamp(game.targetPos - 0.1, -1, 1);
  else if (e.key === 'ArrowRight') game.targetPos = clamp(game.targetPos + 0.1, -1, 1);
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (game.phase === 'over') newGame();
    else throwBall({ speed: 0.55, hook: 0, angle: 0, x: game.targetPos });
  } else if (e.key === 'n' || e.key === 'N') newGame();
});

// ============================================================================
// Main loop
// ============================================================================
const clock = new THREE.Clock();
const rollAxis = new THREE.Vector3();
let fpsFrames = 0, fpsTime = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  game.phaseTime += dt;

  // Smooth position updates while aiming
  if (game.phase === 'ready') {
    game.position = lerp(game.position, game.targetPos, 1 - Math.exp(-dt * 12));
    ball.x = game.position * POS_RANGE;
  }

  // Physics in small substeps for stable collisions
  const steps = 4;
  for (let i = 0; i < steps; i++) stepPhysics(dt / steps);

  // Phase logic
  if (game.phase === 'rolling') {
    game.rollTime += dt;
    const ballDone = ball.pit || ball.z < HEAD_Z - 0.5 || Math.hypot(ball.vx, ball.vz) < 0.05;
    if ((ballDone && game.phaseTime > 1 && pinsSettled()) || game.rollTime > 9) {
      if (!game.settleAt) game.settleAt = game.rollTime;
      if (game.rollTime - game.settleAt > 0.6 || game.rollTime > 9) { game.settleAt = 0; finishRoll(); }
    } else game.settleAt = 0;
  } else if (game.phase === 'result' && game.phaseTime > 2.0) {
    afterResult();
  }

  // Ball visuals
  const prevX = ballMesh.position.x, prevZ = ballMesh.position.z;
  ballMesh.position.set(ball.x, ball.y, ball.z);
  const mdx = ball.x - prevX, mdz = ball.z - prevZ, md = Math.hypot(mdx, mdz);
  if (md > 1e-5 && md < 1) {
    rollAxis.set(mdz, 0, -mdx).normalize(); // up × direction
    ballMesh.rotateOnWorldAxis(rollAxis, md / BALL_R);
    if (ball.hook && ball.rolling) ballMesh.rotateOnWorldAxis(UP, ball.hook * dt * 6);
  }
  const glow = game.phase === 'ready' && game.holding ? 0.35 + Math.sin(performance.now() / 90) * 0.15 : 0;
  ballMesh.material.emissiveIntensity = lerp(ballMesh.material.emissiveIntensity, glow, 0.2);

  // Aim guide
  aimGroup.visible = game.phase === 'ready';
  aimGroup.position.set(ball.x, 0, START_Z);
  aimMat.opacity = game.holding ? 0.85 : 0.45 + Math.sin(performance.now() / 300) * 0.1;

  // Rolling sound
  if (audio.roll) {
    const s = ball.rolling && !ball.pit ? clamp(Math.hypot(ball.vx, ball.vz) / 10, 0, 1) : 0;
    audio.roll.gain.value = lerp(audio.roll.gain.value, s * 0.5, 0.15);
  }

  pins.forEach(updatePinMesh);
  updateCamera(dt);
  renderer.render(scene, camera);

  // Debug FPS readout with ?fps
  if (params.has('fps')) {
    fpsFrames++; fpsTime += dt;
    if (fpsTime > 1) { $('remote').textContent = `${Math.round(fpsFrames / fpsTime)} fps`; fpsFrames = 0; fpsTime = 0; }
  }
  requestAnimationFrame(tick);
}

newGame();
tick();

// Expose a small hook for automated testing in a desktop browser.
window.__bowling = {
  game, ball, pins, throwBall, newGame, scoreFrames,
  // Runs one throw instantly (no rendering) and returns pins knocked down.
  simulate({ x = 0, speed = 0.55, hook = 0, angle = 0 } = {}) {
    pins.forEach((p) => placePin(p, false));
    game.position = game.targetPos = x;
    game.phase = 'ready';
    throwBall({ x, speed, hook, angle });
    for (let t = 0; t < 12; t += 1 / 240) {
      stepPhysics(1 / 240);
      if ((ball.pit || ball.z < HEAD_Z - 0.5) && t > 1 && pinsSettled()) break;
    }
    const left = pins.filter(isStanding).length;
    newGame();
    return 10 - left;
  },
};
