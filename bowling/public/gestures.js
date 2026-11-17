// Turns body landmarks (MediaPipe Pose, 33 points, normalised image coords)
// into bowling actions: position, "ready", throw, and a "both hands up" gesture.
// Pure logic with no camera or DOM, so it can be tested with fake poses.

export const LM = {
  nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
};

// Tunables. Distances are in "torso lengths" (shoulder centre to hip centre),
// so they work whether you stand near or far from the camera.
export const GESTURE = {
  lowY: 0.8,        // wrist this far below shoulders counts as "arm down / ready"
  highY: 0.2,       // wrist rising above this (near shoulder height) releases the ball
  armWindow: 0.9,   // seconds: how long after the hand was low a release still counts
  minVel: 1.8,      // torso lengths per second: slower upward swings are ignored
  slowVel: 2.2,     // maps to the slowest throw
  fastVel: 8.5,     // maps to the fastest throw
  leanFull: 15,     // degrees of shoulder tilt for full hook
  leanDead: 4,      // degrees of tilt ignored
  posSpan: 0.22,    // hip centre moving this far from image centre = lane edge
  cooldown: 1.2,    // seconds after a throw before another can trigger
  handsUpHold: 1.5, // seconds both hands above head to trigger "new game"
  minVis: 0.5,      // landmark visibility needed
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createTracker(options = {}) {
  const cfg = { ...GESTURE, ...options };
  let hand = options.hand || 'right';
  const smooth = new Map(); // landmark index -> {x, y}
  const hist = [];          // { t, y, x } wrist relative to shoulders
  const posHist = [];       // { t, p }
  let lastLowT = -1e9, lowSince = null, lastThrowT = -1e9, handsUpSince = null, handsUpFired = false;
  let pos = 0;

  function pt(lm, i, a = 0.55) {
    const raw = lm[i];
    const prev = smooth.get(i);
    const v = prev ? { x: prev.x + (raw.x - prev.x) * a, y: prev.y + (raw.y - prev.y) * a } : { x: raw.x, y: raw.y };
    smooth.set(i, v);
    return v;
  }
  const vis = (lm, ...ids) => ids.every((i) => (lm[i].visibility ?? 1) >= cfg.minVis);

  return {
    setHand(h) { hand = h; hist.length = 0; },
    get hand() { return hand; },

    /** lm: 33 landmarks, t: seconds, canThrow: whether the game is waiting for a throw. */
    update(lm, t, canThrow = true) {
      const out = { visible: false, ready: false, pos, throw: null, newGame: false };
      if (!lm || lm.length < 29 || !vis(lm, LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip)) {
        smooth.clear(); hist.length = 0; lowSince = null;
        return out;
      }
      out.visible = true;

      const ls = pt(lm, LM.lShoulder), rs = pt(lm, LM.rShoulder);
      const lh = pt(lm, LM.lHip), rh = pt(lm, LM.rHip);
      const nose = pt(lm, LM.nose);
      const sm = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
      const hm = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
      const torso = Math.max(0.05, Math.hypot(hm.x - sm.x, hm.y - sm.y));

      // Position: the camera sees you mirrored, so your right is the image's left.
      const target = clamp(-(hm.x - 0.5) / cfg.posSpan, -1, 1);
      pos += (target - pos) * 0.35;
      out.pos = pos;
      posHist.push({ t, p: pos });
      while (posHist.length && t - posHist[0].t > 2) posHist.shift();

      // Hook from leaning: lean right (right shoulder lower) = hook to the right.
      const tilt = (Math.atan2(ls.y - rs.y, ls.x - rs.x) * 180) / Math.PI;
      const leanAbs = Math.abs(tilt);
      out.lean = leanAbs < cfg.leanDead ? 0 : clamp((-Math.sign(tilt) * (leanAbs - cfg.leanDead)) / (cfg.leanFull - cfg.leanDead), -1, 1);

      // Both hands above the head → new game.
      const lwRaw = lm[LM.lWrist], rwRaw = lm[LM.rWrist];
      const handsUp = vis(lm, LM.lWrist, LM.rWrist) && lwRaw.y < nose.y - torso * 0.15 && rwRaw.y < nose.y - torso * 0.15;
      if (handsUp) {
        if (handsUpSince === null) handsUpSince = t;
        if (!handsUpFired && t - handsUpSince >= cfg.handsUpHold) { handsUpFired = true; out.newGame = true; }
      } else { handsUpSince = null; handsUpFired = false; }
      out.handsUp = handsUp;

      // Throwing arm
      const wi = hand === 'right' ? LM.rWrist : LM.lWrist;
      if (!vis(lm, wi)) { lowSince = null; return out; }
      const w = pt(lm, wi, 0.7);
      const y = (w.y - sm.y) / torso;   // 0 = shoulder height, ~1 = hip height
      const x = -(w.x - sm.x) / torso;  // positive = towards your right
      hist.push({ t, y, x });
      while (hist.length && t - hist[0].t > 0.8) hist.shift();
      out.armY = y;

      if (y > cfg.lowY) {
        if (lowSince === null) lowSince = t;
        if (t - lowSince > 0.15) lastLowT = t;
      } else lowSince = null;

      const armed = canThrow && !handsUp && t - lastThrowT > cfg.cooldown && t - lastLowT < cfg.armWindow;
      out.ready = armed && y > cfg.lowY * 0.6;

      if (armed && y < cfg.highY) {
        // Peak upward speed over the last 350 ms
        let peak = 0, lowPt = null;
        for (let i = 1; i < hist.length; i++) {
          const a = hist[i - 1], b = hist[i];
          if (t - b.t > 0.35) continue;
          const dt = Math.max(1e-3, b.t - a.t);
          peak = Math.max(peak, (a.y - b.y) / dt);
        }
        // Latest moment the hand was at (or near) its lowest point = start of the swing.
        for (const h of hist) if (!lowPt || h.y >= lowPt.y - 0.03) lowPt = h;
        if (peak >= cfg.minVel && lowPt) {
          const rise = Math.max(0.3, lowPt.y - y);
          const side = (x - lowPt.x) / rise;
          // Use where you stood when the swing started, not where the swing carried you.
          const startPos = posHist.find((h) => h.t >= lowPt.t) || posHist[posHist.length - 1];
          out.throw = {
            speed: clamp((peak - cfg.slowVel) / (cfg.fastVel - cfg.slowVel), 0, 1),
            angle: clamp(side * 1.2, -1, 1) * 0.6,
            hook: out.lean,
            x: startPos ? startPos.p : pos,
            peak: Math.round(peak * 10) / 10,
          };
          lastThrowT = t;
          lastLowT = -1e9;
          out.ready = false;
        }
      }
      return out;
    },
  };
}
