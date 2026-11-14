// Run: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const SS = require('../src/engine.js');

const SR = 48000;
function speechLike(seed, seconds, leadSilence) {
  let a = seed * 9301 + 49297;
  const rnd = () => ((a = (a * 233280 + 49297) % 2147483647) / 2147483647) * 2 - 1;
  const out = new Float32Array(Math.round((seconds + leadSilence) * SR));
  const start = Math.round(leadSilence * SR);
  let i = start;
  while (i < out.length) {
    const len = Math.round(SR * (0.12 + 0.16 * Math.abs(rnd())));
    const gap = Math.round(SR * (0.03 + 0.08 * Math.abs(rnd())));
    const f = 110 + seed * 13 + 40 * rnd();
    for (let k = 0; k < len && i + k < out.length; k++) out[i + k] = 0.4 * Math.sin(Math.PI * k / len) * (Math.sin(2 * Math.PI * f * k / SR) * 0.7 + 0.3 * rnd());
    i += len + gap;
  }
  return out;
}

test('parses scene headers, titles, labels and directives', () => {
  const r = SS.parseStory(`intro
Scene 1: The Start
Narration: Sam walks to the door.
Visual: he waves
Scene 2 - Sam falls down. [fall, sad]
SCENA 3: Sam legge un libro.`);
  assert.deepStrictEqual(r.scenes.map((s) => s.n), [1, 2, 3]);
  assert.strictEqual(r.scenes[0].title, 'The Start');
  assert.strictEqual(r.scenes[0].narration, 'Sam walks to the door.');
  assert.deepStrictEqual(r.scenes[0].actions, ['wave']); // Visual line wins over narration
  assert.deepStrictEqual(r.scenes[1].actions, ['fall', 'sad']);
  assert.strictEqual(r.scenes[1].actionSource, 'directive');
  assert.deepStrictEqual(r.scenes[2].actions, ['read']);
  assert.ok(r.warnings.some((w) => /ignored/.test(w)));
  assert.deepStrictEqual(r.errors, []);
});

test('reports duplicate scene numbers and empty scenes', () => {
  const r = SS.parseStory('Scene 1: a walk.\nScene 1: again.\nScene 2:');
  assert.ok(r.errors.some((e) => /Scene 1 appears more than once/.test(e)));
  assert.ok(r.errors.some((e) => /Scene 2 has no narration/.test(e)));
});

test('action order follows the sentence; cast detection ignores "Meet X."', () => {
  const [a, b] = SS.parseStory('Scene 1: Meet Sam. He jumps and then runs home.\nScene 2: Sam meets his friend Lia.').scenes;
  assert.deepStrictEqual(a.actions, ['jump', 'run']);
  assert.strictEqual(a.cast, 1);
  assert.strictEqual(b.cast, 2);
});

test('leading silence is removed so narration starts at the clip start', () => {
  const raw = speechLike(1, 2, 0.6);
  const prep = SS.prepareClip(raw, SR);
  const lead = SS.detectOnset(prep.pcm, SR) / SR * 1000;
  assert.ok(prep.leadTrimmed / SR > 0.55, 'trimmed ~0.6 s');
  assert.ok(lead <= SS.MAX_LEAD_SILENCE_MS, 'onset within tolerance, got ' + lead);
});

test('duplicate lock: identical hash, re-encoded copy, and missing slots', () => {
  const c1 = SS.prepareClip(speechLike(1, 2.5, 0.2), SR).pcm;
  const c2 = SS.prepareClip(speechLike(2, 2.5, 0.1), SR).pcm;
  const c3 = SS.prepareClip(speechLike(3, 3.0, 0), SR).pcm;
  const noisy = c1.map((v, i) => v * 0.8 + (i % 7 === 0 ? 0.002 : 0)); // "re-encoded" copy: different bytes, same recording
  const fp = (x) => SS.fingerprint(x, SR);
  const r = SS.findDuplicates([
    { hash: 'a', fp: fp(c1) }, { hash: 'b', fp: fp(c2) }, { hash: 'a', fp: fp(c1) }, { hash: 'z', fp: fp(noisy) }, { hash: 'c', fp: fp(c3) }, null,
  ]);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, [5]);
  assert.strictEqual(r.groups.length, 1);
  assert.deepStrictEqual(r.groups[0].indices, [0, 2, 3]);
  const clean = SS.findDuplicates([{ hash: 'a', fp: fp(c1) }, { hash: 'b', fp: fp(c2) }, { hash: 'c', fp: fp(c3) }]);
  assert.strictEqual(clean.ok, true);
});

test('timeline: scenes are cut/extended to their narration, starts on frame boundaries', () => {
  for (const fps of SS.FPS_OPTIONS) {
    const clips = [speechLike(1, 2.3, 0.3), speechLike(2, 1.1, 0), speechLike(3, 3.7, 0.5)].map((x) => SS.prepareClip(x, SR).pcm);
    const plan = SS.planTimeline(clips.map((c) => ({ samples: c.length })), fps, SR);
    const mixed = SS.mixTrack(plan, clips);
    const chk = SS.checkPlan(plan, mixed);
    assert.ok(chk.ok, JSON.stringify(chk.rows));
    plan.items.forEach((it) => {
      assert.ok(it.padMs >= 0 && it.padMs < 1000 / fps, 'pad < 1 frame');
      assert.strictEqual(it.startSample, it.startFrame * plan.spf);
    });
    assert.strictEqual(plan.totalFrames, plan.items.reduce((a, it) => a + it.frames, 0));
    // verification on the un-encoded mix must find every clip at offset 0
    const v = SS.verifyRendered(mixed, SR, plan, clips);
    assert.ok(v.ok && v.rows.every((r) => r.offsetMs === 0), JSON.stringify(v.rows));
  }
});

test('verification detects a shifted narration', () => {
  const clips = [speechLike(4, 2, 0), speechLike(5, 2, 0)].map((x) => SS.prepareClip(x, SR).pcm);
  const plan = SS.planTimeline(clips.map((c) => ({ samples: c.length })), 30, SR);
  const mixed = SS.mixTrack(plan, clips);
  const shifted = new Float32Array(mixed.length + SR);
  shifted.set(mixed.subarray(0, plan.items[1].startSample), 0);
  shifted.set(mixed.subarray(plan.items[1].startSample), plan.items[1].startSample + Math.round(0.08 * SR)); // scene 2 voice 80 ms late
  const v = SS.verifyRendered(shifted, SR, plan, clips);
  assert.strictEqual(v.rows[0].ok, true);
  assert.strictEqual(v.rows[1].ok, false);
  assert.ok(Math.abs(v.rows[1].offsetMs - 80) <= 2, 'measured ' + v.rows[1].offsetMs);
});

test('every action has a pose and builds a script', () => {
  for (const a of SS.ACTIONS) {
    const script = SS.buildSceneScript({ n: 1, narration: '', actions: [a], props: [], cast: 2 }, 3, 1280, 720, {});
    assert.strictEqual(script.segs[0].action, a);
  }
});
