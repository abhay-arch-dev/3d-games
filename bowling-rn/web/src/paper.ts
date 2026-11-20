// Paper Toss (TV): lob a crumpled paper ball into a bin, with wind. Uses the same throw messages as bowling.
import * as THREE from 'three';
import { connect, $, clamp, enableBackToHub } from './net';
import type { ControllerToTv, ServerMessage, ThrowParams, TvToController } from './protocol';

const SHOTS = 10;
const G = 9.81, BALL_R = 0.065, RIM_Y = 0.55, BIN_R = 0.24, START = new THREE.Vector3(0, 1.45, 0.2);
const LAUNCH = THREE.MathUtils.degToRad(42);

// ---- Scene ---------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
$('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1f2e);
scene.fog = new THREE.Fog(0x1a1f2e, 9, 20);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.05, 60);
camera.position.set(0, 1.75, 1.6);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2018, 0.9));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.4);
sun.position.set(2, 6, 2); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -9 });
scene.add(sun);

function tex(draw: (g: CanvasRenderingContext2D, s: number) => void, size = 512, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Carpet tiles
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 22), new THREE.MeshStandardMaterial({ roughness: 1, map: tex((g, s) => {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    g.fillStyle = (x + y) % 2 ? '#3b4258' : '#353b50'; g.fillRect(x * s / 4, y * s / 4, s / 4, s / 4);
  }
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`; g.fillRect(Math.random() * s, Math.random() * s, 2, 2); }
}, 512, 6) }));
floor.rotation.x = -Math.PI / 2; floor.position.z = -6; floor.receiveShadow = true; scene.add(floor);
const wallMat = new THREE.MeshStandardMaterial({ color: 0xc9c3b6, roughness: 0.95 });
const back = new THREE.Mesh(new THREE.PlaneGeometry(14, 5), wallMat); back.position.set(0, 2.5, -12); scene.add(back);
for (const s of [-1, 1]) {
  const w = new THREE.Mesh(new THREE.PlaneGeometry(22, 5), wallMat); w.position.set(s * 4.5, 2.5, -6); w.rotation.y = -s * Math.PI / 2; scene.add(w);
}
// A whiteboard and some desks so it reads as an office.
const board = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.4), new THREE.MeshStandardMaterial({ map: tex((g, s) => {
  g.fillStyle = '#f7f7f2'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#3166c4'; g.lineWidth = 6; g.font = 'bold 54px sans-serif'; g.fillStyle = '#c43131';
  g.fillText('Q4 GOALS:', 30, 90); g.fillStyle = '#3166c4'; g.fillText('1. Hit the bin', 30, 190); g.fillText('2. Mind the fan', 30, 280);
  g.beginPath(); g.moveTo(40, 420); g.lineTo(160, 360); g.lineTo(260, 400); g.lineTo(460, 300); g.stroke();
}) }));
board.position.set(0, 2.1, -11.95); scene.add(board);
const deskMat = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.7 });
for (const [x, z] of [[-3.2, -3], [3.2, -5], [-3.2, -8], [3.2, -9.5]]) {
  const d = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.75, 0.9), deskMat); d.position.set(x, 0.375, z); d.castShadow = d.receiveShadow = true; scene.add(d);
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.38, 0.04), new THREE.MeshStandardMaterial({ color: 0x111, emissive: 0x223355 }));
  m.position.set(x, 0.97, z); scene.add(m);
}
// Fan on the side that shows the wind direction.
const fan = new THREE.Group();
const fanBlades = new THREE.Group();
for (let i = 0; i < 3; i++) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.01), new THREE.MeshStandardMaterial({ color: 0xdddddd }));
  b.position.y = 0.16; const holder = new THREE.Group(); holder.rotation.z = (i * Math.PI * 2) / 3; holder.add(b); fanBlades.add(holder);
}
fan.add(fanBlades);
const fanPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2), new THREE.MeshStandardMaterial({ color: 0x555 }));
fanPole.position.y = -0.6; fan.add(fanPole);
scene.add(fan);

// Bin: open cylinder of wire mesh
const binTex = tex((g, s) => {
  g.clearRect(0, 0, s, s); g.strokeStyle = '#c8ccd6'; g.lineWidth = 5;
  for (let i = 0; i <= 16; i++) { g.beginPath(); g.moveTo((i * s) / 16, 0); g.lineTo((i * s) / 16, s); g.stroke(); }
  for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(0, (i * s) / 8); g.lineTo(s, (i * s) / 8); g.stroke(); }
});
const bin = new THREE.Group();
const binWall = new THREE.Mesh(new THREE.CylinderGeometry(BIN_R, BIN_R * 0.8, RIM_Y, 32, 1, true),
  new THREE.MeshStandardMaterial({ map: binTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 }));
binWall.position.y = RIM_Y / 2; binWall.castShadow = true; bin.add(binWall);
const rim = new THREE.Mesh(new THREE.TorusGeometry(BIN_R, 0.012, 8, 40), new THREE.MeshStandardMaterial({ color: 0xe6e9f0, metalness: 0.8, roughness: 0.3 }));
rim.rotation.x = Math.PI / 2; rim.position.y = RIM_Y; bin.add(rim);
const binBase = new THREE.Mesh(new THREE.CircleGeometry(BIN_R * 0.8, 24), new THREE.MeshStandardMaterial({ color: 0x5a5f6e }));
binBase.rotation.x = -Math.PI / 2; binBase.position.y = 0.01; bin.add(binBase);
const glow = new THREE.Mesh(new THREE.RingGeometry(BIN_R * 1.2, BIN_R * 1.5, 40), new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true, opacity: 0.35 }));
glow.rotation.x = -Math.PI / 2; glow.position.y = 0.012; bin.add(glow);
scene.add(bin);

// Crumpled paper ball
const ballGeo = new THREE.IcosahedronGeometry(BALL_R, 2);
const pos = ballGeo.attributes.position;
for (let i = 0; i < pos.count; i++) {
  const v = new THREE.Vector3().fromBufferAttribute(pos, i);
  v.multiplyScalar(0.8 + Math.random() * 0.35); pos.setXYZ(i, v.x, v.y, v.z);
}
ballGeo.computeVertexNormals();
const ballMesh = new THREE.Mesh(ballGeo, new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.9, flatShading: true }));
ballMesh.castShadow = true; scene.add(ballMesh);

// Aim guide on the floor
const aimGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, 0.02, -2)]);
const aimLine = new THREE.Line(aimGeo, new THREE.LineDashedMaterial({ color: 0xffb03a, dashSize: 0.12, gapSize: 0.1 }));
aimLine.computeLineDistances(); scene.add(aimLine);

// ---- Game state ------------------------------------------------------------------------------
type Phase = 'ready' | 'flying' | 'result' | 'over';
const s = {
  phase: 'ready' as Phase, shot: 0, score: 0, streak: 0, best: 0, level: 0,
  results: [] as boolean[], aim: 0, power: 0.5, wind: 0, binX: 0, binZ: -3,
  vel: new THREE.Vector3(), rimHit: false, inBin: false, t: 0, phaseT: 0,
};
try { s.best = Number(localStorage.getItem('paper.best')) || 0; } catch { /* ignore */ }

function setupShot(): void {
  const d = Math.min(3 + s.level * 0.45, 7.5);
  s.binZ = START.z - d;
  s.binX = s.level === 0 ? 0 : (Math.random() * 2 - 1) * Math.min(0.3 + s.level * 0.15, 1.6);
  s.wind = s.level === 0 ? 0 : (Math.random() * 2 - 1) * Math.min(0.4 + s.level * 0.35, 3);
  bin.position.set(s.binX, 0, s.binZ);
  fan.position.set(s.wind >= 0 ? -3.6 : 3.6, 1.4, (s.binZ + START.z) / 2);
  fan.rotation.y = s.wind >= 0 ? Math.PI / 2 : -Math.PI / 2;
  s.vel.set(0, 0, 0); s.rimHit = false; s.inBin = false;
  ballMesh.position.copy(START);
  ballMesh.visible = true;
  const w = Math.abs(s.wind);
  $('windTxt').textContent = w < 0.15 ? 'calm' : `${w.toFixed(1)} ${s.wind > 0 ? '→' : '←'}`;
  $('windArrow').style.transform = `scaleX(${s.wind < 0 ? -1 : 1}) scale(${0.6 + Math.min(w, 3) / 3})`;
  $('windArrow').style.opacity = w < 0.15 ? '0.25' : '1';
  $('dist').textContent = `${d.toFixed(1)} m`;
  setPhase('ready');
  renderHud();
}

function newGame(): void {
  s.shot = 0; s.score = 0; s.streak = 0; s.level = 0; s.results = [];
  hideMsg();
  setupShot();
}

function throwBall({ speed = 0.5, angle = 0, x }: Partial<ThrowParams>): void {
  if (s.phase !== 'ready') return;
  hideOverlay();
  if (typeof x === 'number') s.aim = clamp(x, -1, 1);
  // Power is relative to the bin: 50% is the right length, each 10% either way is about 6% more or less speed.
  const v = idealSpeed(START.z - s.binZ) * (0.7 + clamp(speed, 0, 1) * 0.6);
  const yaw = s.aim * 0.32 + clamp(angle, -1, 1) * 0.12;
  s.vel.set(Math.sin(yaw) * Math.cos(LAUNCH) * v, Math.sin(LAUNCH) * v, -Math.cos(yaw) * Math.cos(LAUNCH) * v);
  ballMesh.position.copy(START);
  setPhase('flying');
}

/** Launch speed that lands exactly on the rim height at distance d (same drag as step()). */
function idealSpeed(d: number): number {
  let lo = 1, hi = 15;
  for (let k = 0; k < 30; k++) {
    const v = (lo + hi) / 2;
    let y = START.y, z = 0, vy = Math.sin(LAUNCH) * v, vz = Math.cos(LAUNCH) * v;
    const dt = 1 / 480;
    for (let i = 0; i < 4000; i++) {
      const py = y; vy -= G * dt; vy *= 1 - 0.12 * dt; vz *= 1 - 0.12 * dt; y += vy * dt; z += vz * dt;
      if (py >= RIM_Y && y < RIM_Y && vy < 0) break;
    }
    if (z < d) lo = v; else hi = v;
  }
  return (lo + hi) / 2;
}

function finishShot(made: boolean): void {
  s.results.push(made);
  s.shot++;
  if (made) {
    s.score += s.rimHit ? 1 : 2; s.streak++; s.level++;
    s.best = Math.max(s.best, s.streak);
    try { localStorage.setItem('paper.best', String(s.best)); } catch { /* ignore */ }
    showMsg(s.rimHit ? 'In! +1' : 'SWISH! +2', false);
  } else {
    s.streak = 0;
    showMsg(['Missed', 'So close', 'Not quite'][Math.floor(Math.random() * 3)], true);
  }
  net.send({ type: 'result', label: made ? (s.rimHit ? 'In!' : 'Swish!') : 'Missed', kind: made ? (s.rimHit ? 'spare' : 'strike') : 'normal', knocked: made ? 1 : 0 });
  renderHud();
  setPhase('result');
}

function setPhase(p: Phase): void { s.phase = p; s.phaseT = 0; sendState(); }
function sendState(): void {
  net.send({ type: 'state', frame: Math.min(s.shot + 1, SHOTS), roll: 1, total: s.score, canThrow: s.phase === 'ready',
    over: s.phase === 'over', player: 1, players: 1, totals: [s.score] });
}

function renderHud(): void {
  $('score').textContent = String(s.score);
  $('best').textContent = String(s.best);
  $('streak').textContent = `Streak ${s.streak}`;
  $('shots').innerHTML = Array.from({ length: SHOTS }, (_, i) =>
    `<i class="${i < s.results.length ? (s.results[i] ? 'in' : 'out') : i === s.shot ? 'cur' : ''}"></i>`).join('');
  $('powerBar').style.width = `${Math.round(s.power * 100)}%`;
}

// ---- Physics -------------------------------------------------------------------------------
function step(dt: number): void {
  const b = ballMesh.position, v = s.vel;
  const prevY = b.y;
  v.y -= G * dt;
  v.x += s.wind * dt;
  v.multiplyScalar(1 - 0.12 * dt); // paper is light: a little air drag
  b.addScaledVector(v, dt);
  ballMesh.rotation.x -= dt * 9; ballMesh.rotation.z += dt * 4;

  const dx = b.x - s.binX, dz = b.z - s.binZ, d = Math.hypot(dx, dz);
  if (s.inBin) { // settle at the bottom of the bin
    if (b.y < BALL_R + 0.02) { b.y = BALL_R + 0.02; v.set(0, 0, 0); }
    if (d > BIN_R * 0.7) { b.x = s.binX + (dx / d) * BIN_R * 0.7; b.z = s.binZ + (dz / d) * BIN_R * 0.7; v.x = v.z = 0; }
    return;
  }
  // Crossing the rim height on the way down
  if (prevY >= RIM_Y && b.y < RIM_Y && v.y < 0) {
    if (d < BIN_R - BALL_R * 0.6) { s.inBin = true; v.x *= 0.2; v.z *= 0.2; return; }
    if (d < BIN_R + BALL_R) { // clipped the rim: bounce up and outward
      s.rimHit = true;
      const nx = d ? dx / d : 0, nz = d ? dz / d : 1, dir = d < BIN_R ? -1 : 1;
      v.x = v.x * 0.35 + nx * dir * 0.9; v.z = v.z * 0.35 + nz * dir * 0.9; v.y = Math.abs(v.y) * 0.35 + 0.6;
      b.y = RIM_Y + 0.001;
      playTone(1600, 0.08, 0.05);
    }
  }
  // Bin wall from the outside
  if (b.y < RIM_Y && d < BIN_R + BALL_R && d > BIN_R * 0.6) {
    const nx = dx / d, nz = dz / d; b.x = s.binX + nx * (BIN_R + BALL_R); b.z = s.binZ + nz * (BIN_R + BALL_R);
    const vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= 1.6 * vn * nx; v.z -= 1.6 * vn * nz; }
  }
  // Floor
  if (b.y < BALL_R) { b.y = BALL_R; v.y = Math.abs(v.y) * 0.3; v.x *= 0.6; v.z *= 0.6; }
}

// ---- Sound ------------------------------------------------------------------------------------
let actx: AudioContext | null = null;
function playTone(freq: number, dur: number, vol = 0.1): void {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain();
  o.frequency.value = freq; g.gain.setValueAtTime(vol, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
}

// ---- HUD helpers ------------------------------------------------------------------------------
let msgTimer: ReturnType<typeof setTimeout> | undefined;
function showMsg(text: string, small: boolean, stay = false): void {
  const m = $('msg'); m.textContent = text; m.classList.toggle('small', small);
  m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
  clearTimeout(msgTimer); if (!stay) msgTimer = setTimeout(hideMsg, 1500);
}
function hideMsg(): void { $('msg').classList.remove('show'); }
let overlayOpen = true;
function hideOverlay(): void {
  if (!overlayOpen) return;
  overlayOpen = false; $('overlay').classList.add('hide');
  try { actx = new AudioContext(); } catch { /* no audio */ }
}
$('startBtn').addEventListener('click', hideOverlay);
$('startBtn').focus();

// ---- Input ------------------------------------------------------------------------------------
const net = connect<ControllerToTv, TvToController>('tv', (msg: ControllerToTv | ServerMessage) => {
  switch (msg.type) {
    case 'peers':
      $('status').classList.toggle('on', msg.controller > 0);
      $('statusTxt').textContent = msg.controller > 0 ? 'Phone connected' : 'Waiting for phone…';
      sendState();
      break;
    case 'pos': if (s.phase === 'ready') s.aim = clamp(msg.x, -1, 1); break;
    case 'throw': throwBall(msg); break;
    case 'cmd': if (msg.action === 'newgame' && (!msg.soft || s.phase === 'over')) newGame(); break;
  }
}, (on) => { if (on) sendState(); });

enableBackToHub();
addEventListener('keydown', (e) => {
  if (overlayOpen) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hideOverlay(); } return; }
  if (e.key === 'ArrowLeft') s.aim = clamp(s.aim - 0.1, -1, 1);
  else if (e.key === 'ArrowRight') s.aim = clamp(s.aim + 0.1, -1, 1);
  else if (e.key === 'ArrowUp') { s.power = clamp(s.power + 0.05, 0, 1); renderHud(); }
  else if (e.key === 'ArrowDown') { s.power = clamp(s.power - 0.05, 0, 1); renderHud(); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (s.phase === 'over') newGame(); else throwBall({ speed: s.power, x: s.aim }); }
});

// ---- Loop -------------------------------------------------------------------------------------
const clock = new THREE.Clock();
const look = new THREE.Vector3();
function tick(): void {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  s.phaseT += dt;
  fanBlades.rotation.z += dt * (2 + Math.abs(s.wind) * 8);
  (glow.material as THREE.MeshBasicMaterial).opacity = 0.2 + 0.2 * Math.sin(performance.now() / 300);

  if (s.phase === 'ready') {
    const yaw = s.aim * 0.32;
    aimLine.visible = true;
    aimLine.position.set(START.x, 0, START.z); aimLine.rotation.y = -yaw;
    ballMesh.position.set(START.x + Math.sin(performance.now() / 500) * 0.01, START.y + Math.sin(performance.now() / 400) * 0.02, START.z);
  } else aimLine.visible = false;

  if (s.phase === 'flying') {
    for (let i = 0; i < 4; i++) step(dt / 4);
    const b = ballMesh.position;
    const stopped = s.vel.length() < 0.15 && b.y < BALL_R + 0.05;
    if (s.inBin && s.phaseT > 0.4 && b.y < 0.2) finishShot(true);
    else if ((stopped && s.phaseT > 0.5) || s.phaseT > 5 || b.z < -11.5 || Math.abs(b.x) > 4.3) finishShot(false);
  } else if (s.phase === 'result' && s.phaseT > 1.6) {
    if (s.shot >= SHOTS) {
      showMsg(`Final score ${s.score}`, true, true);
      setPhase('over');
    } else setupShot();
  }

  // Camera: behind the thrower, drifting toward the ball while it flies.
  const target = s.phase === 'flying' || s.phase === 'result' ? ballMesh.position : bin.position;
  look.lerp(new THREE.Vector3(target.x * 0.6, 0.5, Math.max(target.z, s.binZ)), 1 - Math.exp(-dt * 3));
  camera.position.lerp(new THREE.Vector3(s.aim * 0.3, 1.75, 1.6), 1 - Math.exp(-dt * 3));
  camera.lookAt(look);
  renderer.render(scene, camera);
}
look.set(0, 0.5, -3);
newGame();
tick();

declare global { interface Window { __paper?: unknown } }
window.__paper = { s, throwBall, newGame };
