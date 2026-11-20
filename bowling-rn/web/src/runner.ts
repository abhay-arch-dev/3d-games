// Track Runner (TV): endless three-lane runner. Moves come from the camera pose stream, phone swipes, or the remote.
import * as THREE from 'three';
import { connect, $, clamp, enableBackToHub } from './net';
import type { ControllerToTv, Dir, ServerMessage, TvToController } from './protocol';
import { drawFigure, mid, P, pt, seen, type PoseMsg } from './pose';

const LANE_X = 1.7, SPAWN_Z = -90, JUMP_V = 7.2, GRAV = 20, ROLL_TIME = 0.75;
type ObType = 'hurdle' | 'bar' | 'block' | 'coin';
interface Ob { type: ObType; lane: number; z: number; len: number; mesh: THREE.Object3D; taken?: boolean }

// ---- Scene ---------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
$('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const SKY = 0xf2a65a;
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 30, 85);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 120);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
scene.add(new THREE.HemisphereLight(0xffe7c4, 0x40304a, 1.0));
const sun = new THREE.DirectionalLight(0xffd7a0, 1.6);
sun.position.set(-6, 12, 4); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 10, bottom: -30, far: 60 });
scene.add(sun); scene.add(sun.target);

// Track: gravel bed with three running lanes, scrolled by moving the texture.
const trackC = document.createElement('canvas'); trackC.width = 512; trackC.height = 512;
{
  const g = trackC.getContext('2d')!;
  g.fillStyle = '#7d6a5c'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.12})`; g.fillRect(Math.random() * 512, Math.random() * 512, 3, 3); }
  for (let l = 0; l < 3; l++) { // lane surface + white edge lines
    const x0 = 512 * (l / 3) + 16; g.fillStyle = '#b4553a'; g.fillRect(x0, 0, 512 / 3 - 32, 512);
    g.fillStyle = '#f4efe6'; g.fillRect(x0, 0, 6, 512); g.fillRect(x0 + 512 / 3 - 38, 0, 6, 512);
  }
  g.fillStyle = 'rgba(255,255,255,.5)'; for (let l = 0; l < 3; l++) g.fillRect(512 * (l / 3) + 512 / 6 - 4, 0, 8, 120);
}
const trackTex = new THREE.CanvasTexture(trackC);
trackTex.wrapS = trackTex.wrapT = THREE.RepeatWrapping; trackTex.repeat.set(1, 14); trackTex.colorSpace = THREE.SRGBColorSpace;
trackTex.anisotropy = 8;
const track = new THREE.Mesh(new THREE.PlaneGeometry(LANE_X * 3 + 0.6, 140), new THREE.MeshStandardMaterial({ map: trackTex, roughness: 1 }));
track.rotation.x = -Math.PI / 2; track.position.z = -55; track.receiveShadow = true; scene.add(track);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x6f8f4a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, -60); ground.receiveShadow = true; scene.add(ground);

// Scenery that scrolls past: trees and buildings on both sides.
const scenery: THREE.Object3D[] = [];
const treeMat = new THREE.MeshStandardMaterial({ color: 0x3f7a3a, flatShading: true });
const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f });
const houseCols = [0xe9c46a, 0xe76f51, 0x9ec1cf, 0xf4a261, 0xc9ada7];
for (let i = 0; i < 36; i++) {
  const side = i % 2 ? 1 : -1, g = new THREE.Group();
  if (Math.random() < 0.6) {
    const top = new THREE.Mesh(new THREE.ConeGeometry(1 + Math.random() * 0.6, 3 + Math.random() * 2, 7), treeMat); top.position.y = 3; top.castShadow = true;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.4), trunkMat); trunk.position.y = 0.7;
    g.add(top, trunk);
  } else {
    const h = 3 + Math.random() * 5;
    const house = new THREE.Mesh(new THREE.BoxGeometry(3, h, 3), new THREE.MeshStandardMaterial({ color: houseCols[i % houseCols.length], roughness: 0.9 }));
    house.position.y = h / 2; house.castShadow = true; g.add(house);
  }
  g.position.set(side * (6 + Math.random() * 8), 0, -i * 3.2);
  scene.add(g); scenery.push(g);
}

// Runner figure
const runner = new THREE.Group();
const skin = new THREE.MeshStandardMaterial({ color: 0xf1c27d }), shirt = new THREE.MeshStandardMaterial({ color: 0x2a9d8f }),
  shorts = new THREE.MeshStandardMaterial({ color: 0x264653 });
const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.3), shirt); torso.position.y = 1.15;
const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), skin); head.position.y = 1.65;
const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe63946 }));
cap.position.y = 1.68;
const limb = (mat: THREE.Material, len: number, x: number, y: number): THREE.Group => {
  const piv = new THREE.Group(); piv.position.set(x, y, 0);
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.15, len, 0.15), mat); m.position.y = -len / 2; m.castShadow = true; piv.add(m);
  return piv;
};
const legL = limb(shorts, 0.82, -0.13, 0.84), legR = limb(shorts, 0.82, 0.13, 0.84);
const armL = limb(skin, 0.62, -0.33, 1.42), armR = limb(skin, 0.62, 0.33, 1.42);
const body = new THREE.Group(); body.add(torso, head, cap, legL, legR, armL, armR);
torso.castShadow = head.castShadow = true;
runner.add(body); scene.add(runner);

// Obstacle builders
const hurdleMat = new THREE.MeshStandardMaterial({ color: 0xffffff }), stripeMat = new THREE.MeshStandardMaterial({ color: 0xd62828 });
const blockMat = new THREE.MeshStandardMaterial({ color: 0x3a86ff, roughness: 0.6 });
const coinMat = new THREE.MeshStandardMaterial({ color: 0xffc300, metalness: 0.7, roughness: 0.25, emissive: 0x553300 });
function build(type: ObType): THREE.Object3D {
  const g = new THREE.Group();
  if (type === 'hurdle') {
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.7, 0.08), hurdleMat); p.position.set(s * 0.65, 0.35, 0); g.add(p); }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.22, 0.08), stripeMat); bar.position.y = 0.6; g.add(bar);
  } else if (type === 'bar') {
    for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), hurdleMat); p.position.set(s * 0.75, 1.2, 0); g.add(p); }
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.15, 0.12), new THREE.MeshStandardMaterial({ color: 0xffb703 })); sign.position.y = 1.75; g.add(sign);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.16, 0.14), stripeMat); stripe.position.y = 1.3; g.add(stripe);
  } else if (type === 'block') {
    const b = new THREE.Mesh(new THREE.BoxGeometry(1.45, 2.6, 5), blockMat); b.position.y = 1.3; g.add(b);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.47, 0.2, 5.02), new THREE.MeshStandardMaterial({ color: 0xffffff })); top.position.y = 2.2; g.add(top);
  } else {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.06, 20), coinMat); c.rotation.x = Math.PI / 2; c.position.y = 0.9; g.add(c);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  scene.add(g);
  return g;
}

// ---- Game state ------------------------------------------------------------------------------
type Phase = 'idle' | 'count' | 'run' | 'crash';
const s = {
  phase: 'idle' as Phase, t: 0, phaseT: 0, speed: 9, dist: 0, coins: 0, best: 0,
  lane: 0, x: 0, y: 0, vy: 0, rollT: 0, nextSpawn: 30, obs: [] as Ob[],
};
try { s.best = Number(localStorage.getItem('runner.best')) || 0; } catch { /* ignore */ }

function reset(): void {
  for (const o of s.obs) scene.remove(o.mesh);
  Object.assign(s, { speed: 9, dist: 0, coins: 0, lane: 0, x: 0, y: 0, vy: 0, rollT: 0, nextSpawn: 25, obs: [] });
  runner.rotation.set(0, 0, 0);
}

function spawnRow(z: number): void {
  // Pick a pattern that always leaves a way through.
  const r = Math.random(), lanes = [-1, 0, 1].sort(() => Math.random() - 0.5);
  const add = (type: ObType, lane: number, len = 0.3) => s.obs.push({ type, lane, z, len, mesh: build(type) });
  const hardness = clamp(s.dist / 1500, 0, 1);
  if (r < 0.3) add('hurdle', lanes[0]);
  else if (r < 0.5) add('bar', lanes[0]);
  else if (r < 0.7) { add('block', lanes[0], 5); if (Math.random() < 0.3 + hardness * 0.5) add('block', lanes[1], 5); }
  else if (r < 0.85) { add(Math.random() < 0.5 ? 'hurdle' : 'bar', lanes[0]); add(Math.random() < 0.5 ? 'hurdle' : 'bar', lanes[1]); }
  else { add('hurdle', lanes[0]); add('bar', lanes[1]); add('block', lanes[2], 5); }
  // Coins in a free lane
  const used = new Set(s.obs.filter((o) => o.z === z).map((o) => o.lane));
  const free = [-1, 0, 1].filter((l) => !used.has(l));
  const cl = free.length ? free[Math.floor(Math.random() * free.length)] : lanes[0];
  for (let i = 0; i < 5; i++) s.obs.push({ type: 'coin', lane: cl, z: z + 4 + i * 1.6, len: 0.3, mesh: build('coin') });
}

function move(dir: Dir): void {
  flash(dir);
  if (s.phase === 'idle' || (s.phase === 'crash' && s.phaseT > 1.2)) { if (dir === 'up') start(); return; }
  if (s.phase !== 'run') return;
  if (dir === 'left') s.lane = Math.max(-1, s.lane - 1);
  else if (dir === 'right') s.lane = Math.min(1, s.lane + 1);
  else if (dir === 'up' && s.y <= 0.001) { s.vy = JUMP_V; s.rollT = 0; beep(520, 0.08); }
  else if (dir === 'down') { s.rollT = ROLL_TIME; if (s.y > 0) s.vy = -12; beep(220, 0.08); }
}

function start(): void {
  hideOverlay(); reset(); hideMsg();
  s.phase = 'count'; s.phaseT = 0;
}

function crash(): void {
  s.phase = 'crash'; s.phaseT = 0;
  const score = Math.floor(s.dist) + s.coins * 10;
  if (score > s.best) { s.best = score; try { localStorage.setItem('runner.best', String(score)); } catch { /* ignore */ } }
  showMsg(`Crash! Score ${score}`, true, true);
  net.send({ type: 'result', label: `Score ${score}`, kind: 'normal', knocked: 0 });
  beep(110, 0.4, 0.2);
}

// ---- Camera gestures (from the pose stream) ------------------------------------------------
const pose = { base: null as null | { hip: number; sh: number; torso: number }, laneHint: 0, jumpArmed: true, duckArmed: true, lastAt: 0, calibN: 0 };
function onPose(msg: PoseMsg): void {
  pose.lastAt = performance.now();
  drawPose(msg);
  const p = msg.p;
  if (!p || !seen(p, P.lHip) || !seen(p, P.rHip) || !seen(p, P.lSh) || !seen(p, P.rSh)) return;
  const hip = mid(pt(p, P.lHip), pt(p, P.rHip)), sh = mid(pt(p, P.lSh), pt(p, P.rSh));
  const torso = Math.max(0.05, hip.y - sh.y);
  if (!pose.base) { pose.base = { hip: hip.y, sh: sh.y, torso }; pose.calibN = 0; }
  const b = pose.base;
  // Lane from where you stand (with hysteresis so it doesn't flicker at the borders).
  const x = hip.x, cur = pose.laneHint;
  let lane = cur;
  if (x < 0.39 - (cur === -1 ? -0.03 : 0)) lane = -1;
  else if (x > 0.61 + (cur === 1 ? -0.03 : 0)) lane = 1;
  else if (x > 0.42 && x < 0.58) lane = 0;
  if (lane !== cur) {
    pose.laneHint = lane;
    if (s.phase === 'run') { s.lane = lane; flash(lane < cur ? 'left' : 'right'); }
  }
  // Jump: hips rise clearly above standing height. Duck: shoulders drop well below it.
  const up = (b.hip - hip.y) / b.torso, down = (sh.y - b.sh) / b.torso;
  if (up > 0.28 && pose.jumpArmed) { pose.jumpArmed = false; move('up'); }
  if (up < 0.12) pose.jumpArmed = true;
  if (down > 0.38 && pose.duckArmed) { pose.duckArmed = false; move('down'); }
  if (down < 0.18) pose.duckArmed = true;
  // Slowly track the standing baseline while standing still (handles drifting closer / further).
  if (Math.abs(up) < 0.12 && Math.abs(down) < 0.15) {
    const k = pose.calibN++ < 20 ? 0.3 : 0.03;
    b.hip += (hip.y - b.hip) * k; b.sh += (sh.y - b.sh) * k; b.torso += (torso - b.torso) * k;
  }
}
const poseCv = $<HTMLCanvasElement>('posecv'), poseCtx = poseCv.getContext('2d')!;
function drawPose(msg: PoseMsg): void {
  $('posebox').classList.add('on');
  poseCtx.clearRect(0, 0, poseCv.width, poseCv.height);
  const w = poseCv.width, h = poseCv.height;
  // Lane guides
  poseCtx.strokeStyle = 'rgba(255,255,255,.25)'; poseCtx.lineWidth = 2; poseCtx.setLineDash([6, 6]);
  for (const gx of [0.4, 0.6]) { const X = (gx - 0.5) * 1.6 * w + w / 2; poseCtx.beginPath(); poseCtx.moveTo(X, 0); poseCtx.lineTo(X, h); poseCtx.stroke(); }
  poseCtx.setLineDash([]);
  if (msg.p) drawFigure(poseCtx, msg.p, { x: -0.3 * w, y: 0, w: w * 1.6, h }, '#ffb03a', 6);
}
setInterval(() => { if (pose.lastAt && performance.now() - pose.lastAt > 2000) { pose.lastAt = 0; pose.base = null; $('posebox').classList.remove('on'); } }, 500);

// ---- Sound + HUD -------------------------------------------------------------------------------
let actx: AudioContext | null = null;
function beep(f: number, d: number, v = 0.08): void {
  if (!actx) return;
  const o = actx.createOscillator(), g = actx.createGain(); o.type = 'square'; o.frequency.value = f;
  g.gain.setValueAtTime(v, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d);
  o.connect(g).connect(actx.destination); o.start(); o.stop(actx.currentTime + d);
}
const mvEl: Record<Dir, string> = { left: 'mvL', right: 'mvR', up: 'mvU', down: 'mvD' };
function flash(d: Dir): void { const el = $(mvEl[d]); el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 250); }
let msgTimer: ReturnType<typeof setTimeout> | undefined;
function showMsg(text: string, small: boolean, stay = false): void {
  const m = $('msg'); m.textContent = text; m.classList.toggle('small', small);
  m.classList.remove('show'); void m.offsetWidth; m.classList.add('show');
  clearTimeout(msgTimer); if (!stay) msgTimer = setTimeout(hideMsg, 900);
}
function hideMsg(): void { $('msg').classList.remove('show'); }
let overlayOpen = true;
function hideOverlay(): void {
  if (!overlayOpen) return; overlayOpen = false; $('overlay').classList.add('hide');
  try { actx = actx || new AudioContext(); } catch { /* ignore */ }
}
$('startBtn').addEventListener('click', start);
$('startBtn').focus();

// ---- Input --------------------------------------------------------------------------------------
const net = connect<ControllerToTv, TvToController>('tv', (msg: ControllerToTv | ServerMessage) => {
  if (msg.type === 'peers') {
    $('status').classList.toggle('on', msg.controller > 0);
    $('statusTxt').textContent = msg.controller > 0 ? 'Phone connected' : 'Waiting for phone…';
  } else if (msg.type === 'move') move(msg.dir);
  else if (msg.type === 'pose') onPose(msg);
  else if (msg.type === 'cmd' && msg.action === 'newgame' && s.phase !== 'run') start();
});
enableBackToHub();
const KEYS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
addEventListener('keydown', (e) => {
  if (KEYS[e.key]) { e.preventDefault(); move(KEYS[e.key]); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (s.phase !== 'run' && s.phase !== 'count') start(); else move('up'); }
});

// ---- Loop ---------------------------------------------------------------------------------------
const clock = new THREE.Clock();
function tick(): void {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  s.phaseT += dt; s.t += dt;

  if (s.phase === 'count') {
    const n = 3 - Math.floor(s.phaseT);
    if (n > 0) { if ($('msg').textContent !== String(n)) { showMsg(String(n), false); beep(440, 0.1); } }
    else { s.phase = 'run'; s.phaseT = 0; showMsg('GO!', false); beep(880, 0.2); }
  }
  const running = s.phase === 'run';
  const v = running ? s.speed : 0;

  if (running) {
    s.speed = Math.min(9 + s.dist / 60, 22);
    s.dist += v * dt;
    // Spawn rows ahead
    s.nextSpawn -= v * dt;
    if (s.nextSpawn <= 0) { spawnRow(SPAWN_Z); s.nextSpawn = clamp(26 - s.dist / 120, 13, 26) + Math.random() * 6; }
  }
  // Vertical motion
  if (s.y > 0 || s.vy > 0) { s.vy -= GRAV * dt; s.y = Math.max(0, s.y + s.vy * dt); if (s.y === 0) s.vy = 0; }
  s.rollT = Math.max(0, s.rollT - dt);
  s.x += (s.lane * LANE_X - s.x) * (1 - Math.exp(-dt * 14));

  // Move world objects toward the player and check hits
  for (const o of s.obs) {
    o.z += v * dt;
    o.mesh.position.set(o.lane * LANE_X, 0, o.z);
    if (o.type === 'coin') o.mesh.rotation.y += dt * 4;
    if (!running || o.taken) continue;
    const dz = Math.abs(o.z - 0), dx = Math.abs(o.lane * LANE_X - s.x);
    if (dx > 0.8 || dz > o.len / 2 + 0.25) continue;
    if (o.type === 'coin') { o.taken = true; o.mesh.visible = false; s.coins++; beep(1320, 0.06, 0.05); continue; }
    const hit = o.type === 'block' || (o.type === 'hurdle' && s.y < 0.62) || (o.type === 'bar' && s.rollT <= 0);
    if (hit) { crash(); break; }
  }
  s.obs = s.obs.filter((o) => { if (o.z > 8) { scene.remove(o.mesh); return false; } return true; });
  for (const g of scenery) { g.position.z += v * dt; if (g.position.z > 10) g.position.z -= 36 * 3.2; }
  trackTex.offset.y += (v * dt) / 10;

  // Runner animation
  const rolling = s.rollT > 0, airborne = s.y > 0.01;
  runner.position.set(s.x, s.y, 0);
  const cycle = running ? s.t * (8 + s.speed * 0.5) : s.t * 2;
  const swing = running && !airborne && !rolling ? Math.sin(cycle) * 0.9 : airborne ? 0.6 : 0.1 * Math.sin(cycle);
  legL.rotation.x = swing; legR.rotation.x = -swing; armL.rotation.x = -swing * 0.8; armR.rotation.x = swing * 0.8;
  body.scale.y += ((rolling ? 0.45 : 1) - body.scale.y) * (1 - Math.exp(-dt * 20));
  body.rotation.x = rolling ? -0.5 : 0;
  runner.rotation.z = (s.lane * LANE_X - s.x) * -0.15;
  if (s.phase === 'crash') { runner.rotation.x = Math.min(runner.rotation.x + dt * 5, Math.PI / 2.2); }

  // Camera follows from behind and above
  camera.position.set(s.x * 0.5, 3.4 + s.y * 0.3, 6.2);
  camera.lookAt(s.x * 0.6, 1.2, -6);
  sun.position.set(s.x - 6, 12, 4); sun.target.position.set(s.x, 0, -8);

  $('dist').textContent = `${Math.floor(s.dist)} m`;
  $('coins').textContent = `🪙 ${s.coins}`;
  $('best').textContent = String(s.best);
  $('speed').textContent = running ? `${Math.round(s.speed * 3.6)} km/h` : '–';
  renderer.render(scene, camera);
}
tick();

declare global { interface Window { __runner?: unknown } }
window.__runner = { s, move, start, onPose, pose };
