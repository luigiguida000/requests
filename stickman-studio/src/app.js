/* Stickman Studio — UI, audio slots, validation lock, render + MP4 assembly */
(function () {
  'use strict';
  const SS = window.StickmanEngine;
  const SR = SS.SAMPLE_RATE;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const fmtS = (s) => (s == null ? '—' : s.toFixed(2) + ' s');
  const fmtTC = (s) => { const m = Math.floor(s / 60); const r = s - m * 60; return m + ':' + r.toFixed(2).padStart(5, '0'); };

  const SAMPLE_STORY = `Scene 1: Meet Sam. Every morning he walks to the park under the bright sun.
Scene 2: One day, Sam sits on a bench and reads a strange old book.
Scene 3: He thinks hard. Then suddenly he gets an idea!
Scene 4: Sam runs home as fast as he can.
Scene 5: He works on his computer all night long.
Scene 6: He meets his friend Lia and explains the plan.
Scene 7: It works! Sam and Lia celebrate together.`;

  const state = {
    parsed: { scenes: [], errors: [], warnings: [] },
    slots: new Map(), // scene number -> slot
    settings: { format: '720p', fps: 30, captions: false, trimTail: false },
    encoder: null, // {video, audio} support
    rendering: false,
    output: null,
    previewStop: null,
  };
  let audioCtx = null;
  const getAudioCtx = () => (audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)());

  // ------------------------------------------------------------------ audio slots
  async function decodeToMono(buf) {
    const ctx = new OfflineAudioContext(1, 1, SR);
    const ab = await ctx.decodeAudioData(buf.slice(0));
    const n = ab.length; const out = new Float32Array(n);
    for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i] / ab.numberOfChannels; }
    return out;
  }

  function prepareSlot(slot) {
    if (!slot.raw) return;
    const prep = SS.prepareClip(slot.raw, SR, { trimTail: state.settings.trimTail });
    slot.clip = prep.pcm; slot.leadTrimmedMs = (prep.leadTrimmed / SR) * 1000; slot.silent = prep.silent;
    slot.dur = prep.pcm.length / SR; slot.fp = SS.fingerprint(prep.pcm, SR);
  }

  async function assignAudio(n, blob, name) {
    const slot = { name: name || blob.name || 'audio', size: blob.size, status: 'loading', source: blob.source || 'file' };
    state.slots.set(n, slot);
    renderScenes(); validate();
    try {
      const bytes = await blob.arrayBuffer();
      slot.hash = await SS.hashBytes(bytes);
      slot.raw = await decodeToMono(bytes);
      prepareSlot(slot);
      slot.status = slot.silent ? 'error' : 'ready';
      if (slot.silent) slot.error = 'Audio is silent';
    } catch (e) {
      slot.status = 'error'; slot.error = 'Cannot decode this audio file';
    }
    if (state.slots.get(n) === slot) { renderScenes(); validate(); }
  }

  function clearAudio(n) { state.slots.delete(n); renderScenes(); validate(); }

  function sceneNumberFromName(name) {
    const m = name.match(/(?:scene|scena|sc|s)[\s_.-]*0*(\d{1,3})/i) || name.match(/0*(\d{1,3})/);
    return m ? parseInt(m[1], 10) : null;
  }
  async function bulkAssign(files) {
    const known = new Set(state.parsed.scenes.map((s) => s.n));
    const unmatched = [];
    const jobs = [];
    for (const f of files) {
      const n = sceneNumberFromName(f.name);
      if (n != null && known.has(n)) jobs.push(assignAudio(n, f, f.name)); else unmatched.push(f.name);
    }
    await Promise.all(jobs);
    const note = $('#bulkNote');
    note.textContent = unmatched.length ? 'Not matched to any scene: ' + unmatched.join(', ') : jobs.length + ' file(s) assigned by scene number.';
    note.className = 'note ' + (unmatched.length ? 'warn' : 'ok');
  }

  // Microphone recording
  let recorder = null;
  async function toggleRecord(n, btn) {
    if (recorder && recorder.state === 'recording') { recorder.stop(); return; }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { alert('Microphone not available: ' + e.message); return; }
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      blob.source = 'mic';
      recorder = null;
      assignAudio(n, blob, 'Scene ' + n + ' recording');
    };
    recorder.start();
    btn.textContent = 'Stop'; btn.classList.add('rec');
    document.querySelectorAll('[data-rec]').forEach((b) => { if (b !== btn) b.disabled = true; });
  }

  // ------------------------------------------------------------------ story → scene cards
  function parse() {
    state.parsed = SS.parseStory($('#story').value);
    const nums = new Set(state.parsed.scenes.map((s) => s.n));
    for (const n of [...state.slots.keys()]) if (!nums.has(n)) state.slots.delete(n);
    $('#sceneCount').textContent = state.parsed.scenes.length ? state.parsed.scenes.length + ' scene' + (state.parsed.scenes.length > 1 ? 's' : '') : 'No scenes yet';
    renderScenes(); validate(); drawStageIdle();
  }

  function sceneDuration(scene) {
    const slot = state.slots.get(scene.n);
    return slot && slot.status === 'ready' ? Math.max(1 / state.settings.fps, slot.dur) : SS.estimateDuration(scene.narration);
  }

  function fmtDims() { return SS.FORMATS[state.settings.format]; }

  function renderScenes() {
    const list = $('#scenes');
    list.textContent = '';
    if (!state.parsed.scenes.length) {
      list.append(h('div', { class: 'empty' }, 'Paste a story above. Each scene starts with a line like ', h('code', null, 'Scene 1:'), '.'));
      return;
    }
    const dupIdx = new Map();
    (state.validation && state.validation.dups ? state.validation.dups.groups : []).forEach((g) => g.indices.forEach((i) => dupIdx.set(i, g)));
    const { w, h: H } = fmtDims();
    state.parsed.scenes.forEach((scene, i) => {
      const slot = state.slots.get(scene.n);
      const dup = dupIdx.get(i);
      const thumb = h('canvas', { class: 'thumb' + (H > w ? ' vert' : ''), width: Math.round(w / 4), height: Math.round(H / 4) });
      requestAnimationFrame(() => drawThumb(thumb, scene));
      let status;
      if (!slot) status = h('span', { class: 'badge missing' }, 'No voice');
      else if (slot.status === 'loading') status = h('span', { class: 'badge' }, 'Analyzing…');
      else if (slot.status === 'error') status = h('span', { class: 'badge bad' }, slot.error);
      else if (dup) status = h('span', { class: 'badge bad' }, 'Duplicate');
      else status = h('span', { class: 'badge good' }, 'Unique');

      const fileInput = h('input', { type: 'file', accept: 'audio/*,video/webm,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac', hidden: true,
        onchange: (e) => { const f = e.target.files[0]; if (f) assignAudio(scene.n, f, f.name); } });
      const recBtn = h('button', { class: 'btn small', 'data-rec': '', onclick: (e) => toggleRecord(scene.n, e.currentTarget) }, 'Record');

      const slotInfo = slot && slot.status === 'ready'
        ? h('div', { class: 'slotinfo' },
          h('span', { class: 'fname', title: slot.name }, slot.name),
          h('span', null, fmtS(slot.dur)),
          slot.leadTrimmedMs > 1 ? h('span', { class: 'muted' }, 'lead silence cut ' + Math.round(slot.leadTrimmedMs) + ' ms') : null,
          h('span', { class: 'mono muted', title: 'SHA-256 of file bytes' }, '#' + slot.hash.slice(0, 10)))
        : slot ? h('div', { class: 'slotinfo' }, h('span', { class: 'fname' }, slot.name)) : h('div', { class: 'slotinfo muted' }, 'Drop an audio file here, choose one, or record.');

      const card = h('article', { class: 'scene' + (dup ? ' is-dup' : '') + (!slot ? ' is-missing' : ''), 'data-n': scene.n },
        h('div', { class: 'scene-media' }, thumb,
          h('button', { class: 'btn small ghost', onclick: () => previewScene(scene) }, slot && slot.status === 'ready' ? 'Preview with voice' : 'Preview')),
        h('div', { class: 'scene-body' },
          h('header', null, h('strong', null, scene.label), scene.title ? h('span', { class: 'muted' }, ' · ' + scene.title) : null, status),
          h('p', { class: 'narr' }, scene.narration || h('em', null, 'No narration')),
          h('div', { class: 'chips' },
            scene.actions.map((a, k) => h('span', { class: 'chip act', title: scene.actionSource === 'directive' ? 'from [directive]' : 'detected from text' }, (k ? '→ ' : '') + a)),
            scene.props.map((p) => h('span', { class: 'chip' }, p)),
            scene.cast > 1 ? h('span', { class: 'chip' }, '2 characters') : null),
          h('div', { class: 'slot' + (dup ? ' dup' : '') },
            h('div', { class: 'slot-label' }, 'Voice slot'),
            slotInfo,
            dup ? h('div', { class: 'slot-err' }, 'Same audio as ' + dup.indices.filter((j) => j !== i).map((j) => state.parsed.scenes[j].label).join(', ')) : null,
            h('div', { class: 'slot-actions' },
              h('button', { class: 'btn small', onclick: () => fileInput.click() }, slot ? 'Replace' : 'Choose audio'),
              recBtn,
              slot ? h('button', { class: 'btn small ghost', onclick: () => clearAudio(scene.n) }, 'Clear') : null,
              fileInput))));
      card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop'); });
      card.addEventListener('dragleave', () => card.classList.remove('drop'));
      card.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); card.classList.remove('drop'); const f = e.dataTransfer.files[0]; if (f) assignAudio(scene.n, f, f.name); });
      list.append(card);
    });
  }

  function scriptFor(scene, dur) {
    const { w, h: H } = fmtDims();
    return SS.buildSceneScript(scene, dur, w, H, { captions: state.settings.captions });
  }
  function drawThumb(canvas, scene) {
    const { w, h: H } = fmtDims();
    const dur = sceneDuration(scene);
    const off = document.createElement('canvas'); off.width = w; off.height = H;
    SS.drawScene(off.getContext('2d'), scriptFor(scene, dur), dur * 0.45);
    canvas.getContext('2d').drawImage(off, 0, 0, canvas.width, canvas.height);
  }

  // ------------------------------------------------------------------ stage preview
  function stageCanvas() {
    const c = $('#stage'); const { w, h: H } = fmtDims();
    if (c.width !== w || c.height !== H) { c.width = w; c.height = H; }
    c.parentElement.classList.toggle('vertical', H > w);
    return c;
  }
  function drawStageIdle() {
    const c = stageCanvas();
    const scene = state.parsed.scenes[0];
    const fake = { n: 0, label: '', narration: '', actions: ['wave'], props: [], cast: 1 };
    SS.drawScene(c.getContext('2d'), scriptFor(scene || fake, 3), 0.8);
    $('#stageLabel').textContent = scene ? scene.label + ' (still)' : 'Stage';
  }
  function stopPreview() { if (state.previewStop) { state.previewStop(); state.previewStop = null; } }
  function previewScene(scene) {
    stopPreview();
    const slot = state.slots.get(scene.n);
    const dur = sceneDuration(scene);
    const script = scriptFor(scene, dur);
    const c = stageCanvas(); const ctx = c.getContext('2d');
    let src = null; let t0;
    const actx = getAudioCtx();
    if (actx.state === 'suspended') actx.resume();
    if (slot && slot.status === 'ready') {
      const buf = actx.createBuffer(1, slot.clip.length, SR); buf.copyToChannel(slot.clip, 0);
      src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
    }
    t0 = actx.currentTime + 0.05;
    if (src) src.start(t0);
    let raf = 0; let live = true;
    const tick = () => {
      if (!live) return;
      const t = actx.currentTime - t0;
      SS.drawScene(ctx, script, Math.max(0, t));
      $('#stageLabel').textContent = scene.label + ' · ' + Math.max(0, Math.min(t, dur)).toFixed(2) + ' / ' + dur.toFixed(2) + ' s' + (src ? '' : ' (no voice — estimated length)');
      if (t < dur) raf = requestAnimationFrame(tick); else live = false;
    };
    raf = requestAnimationFrame(tick);
    state.previewStop = () => { live = false; cancelAnimationFrame(raf); if (src) try { src.stop(); } catch (e) { /* already stopped */ } };
    $('#stage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ------------------------------------------------------------------ validation lock
  function validate() {
    const scenes = state.parsed.scenes;
    const errors = [];
    const warnings = [...state.parsed.warnings];
    state.parsed.errors.forEach((e) => errors.push(e));
    if (!scenes.length && !state.parsed.errors.length) errors.push('No scenes. Paste a story with "Scene 1:", "Scene 2:" … headers.');

    const slots = scenes.map((s) => { const sl = state.slots.get(s.n); return sl && sl.status === 'ready' ? { hash: sl.hash, fp: sl.fp } : null; });
    const dups = SS.findDuplicates(slots);
    const label = (i) => scenes[i].label;

    const loading = scenes.filter((s) => (state.slots.get(s.n) || {}).status === 'loading');
    const broken = scenes.filter((s) => (state.slots.get(s.n) || {}).status === 'error');
    const missing = scenes.filter((s) => !state.slots.get(s.n));
    if (missing.length) errors.push('Missing voice audio: ' + missing.map((s) => s.label).join(', ') + '.');
    if (broken.length) errors.push('Unusable audio: ' + broken.map((s) => s.label + ' (' + state.slots.get(s.n).error + ')').join(', ') + '.');
    if (loading.length) errors.push('Still analyzing audio for ' + loading.map((s) => s.label).join(', ') + '…');
    dups.groups.forEach((g) => errors.push({ dup: true, text: 'Duplicate voice conflict: ' + g.indices.map(label).join(' & ') + ' share the same audio (' + g.reason + '). Each scene needs its own narration line.' }));

    scenes.forEach((s) => {
      const sl = state.slots.get(s.n);
      if (sl && sl.status === 'ready') { const w = SS.speechRateWarning(s.narration, sl.dur); if (w) warnings.push(s.label + ': ' + w + ' — check the right file is in this slot.'); }
    });
    if (state.encoder && !state.encoder.video) errors.push('This browser cannot encode H.264 video (WebCodecs). Use a current Chrome, Edge or Safari.');
    if (state.encoder && !state.encoder.audio) errors.push('This browser cannot encode AAC or Opus audio (WebCodecs).');

    state.validation = { errors, warnings, dups };
    const locked = errors.length > 0 || state.rendering;
    const btn = $('#start');
    btn.disabled = locked;
    btn.classList.toggle('locked', errors.length > 0);
    btn.textContent = state.rendering ? 'Rendering…' : errors.length ? 'Start locked' : 'Start generation';
    btn.setAttribute('aria-describedby', 'lockbox');

    const box = $('#lockbox'); box.textContent = '';
    if (errors.length) {
      box.className = 'lockbox bad';
      box.append(h('div', { class: 'lock-title' }, 'Generation is locked — fix these first'),
        h('ul', null, errors.map((e) => h('li', { class: e.dup ? 'dup' : '' }, e.text || e))));
    } else if (scenes.length) {
      box.className = 'lockbox good';
      box.append(h('div', { class: 'lock-title' }, 'Ready: ' + scenes.length + ' scenes, ' + scenes.length + ' distinct voice clips'),
        h('div', { class: 'muted' }, 'Estimated length ' + fmtS(scenes.reduce((a, s) => a + sceneDuration(s), 0)) + ' · ' + fmtDims().label + ' · ' + state.settings.fps + ' fps'));
    } else box.className = 'lockbox';
    if (warnings.length) box.append(h('ul', { class: 'warns' }, warnings.map((w) => h('li', null, w))));

    // Re-badge duplicates on cards without full re-render
    document.querySelectorAll('.scene').forEach((card) => {
      const i = scenes.findIndex((s) => String(s.n) === card.dataset.n);
      const g = dups.groups.find((gg) => gg.indices.includes(i));
      if (!!g !== card.classList.contains('is-dup')) renderScenesSoon();
    });
    return !errors.length;
  }
  let reRenderPending = false;
  function renderScenesSoon() { if (reRenderPending) return; reRenderPending = true; requestAnimationFrame(() => { reRenderPending = false; renderScenes(); }); }

  // ------------------------------------------------------------------ encoder support
  async function probeEncoders() {
    const res = { video: null, audio: null };
    if (!('VideoEncoder' in window) || !('AudioEncoder' in window)) { state.encoder = res; validate(); return res; }
    const { w, h: H } = fmtDims();
    const bitrate = w * H > 1e6 ? 8_000_000 : 4_000_000;
    for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42002a', 'avc1.42001f']) {
      const cfg = { codec, width: w, height: H, bitrate, framerate: state.settings.fps, avc: { format: 'avc' } };
      try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { res.video = cfg; break; } } catch (e) { /* try next */ }
    }
    for (const [codec, mux, br] of [['mp4a.40.2', 'aac', 128000], ['opus', 'opus', 96000]]) {
      const cfg = { codec, sampleRate: SR, numberOfChannels: 1, bitrate: br };
      try { if ((await AudioEncoder.isConfigSupported(cfg)).supported) { res.audio = { cfg, mux }; break; } } catch (e) { /* try next */ }
    }
    state.encoder = res;
    $('#codecInfo').textContent = res.video && res.audio ? 'Encoder: H.264 (' + res.video.codec + ') + ' + (res.audio.mux === 'aac' ? 'AAC' : 'Opus') + ' in MP4' : 'Encoder unavailable in this browser';
    validate();
    return res;
  }

  // ------------------------------------------------------------------ render pipeline
  async function start() {
    if (!validate() || state.rendering) return;
    stopPreview();
    state.rendering = true; validate();
    const out = $('#output'); out.hidden = false;
    $('#result').hidden = true;
    setProgress(0, 'Planning timeline…');
    try {
      const enc = await probeEncoders();
      if (!enc.video || !enc.audio) throw new Error('Encoder not available');
      const scenes = state.parsed.scenes;
      const fps = state.settings.fps;
      const { w, h: H } = fmtDims();
      const clips = scenes.map((s) => state.slots.get(s.n).clip);
      const plan = SS.planTimeline(clips.map((c) => ({ samples: c.length })), fps, SR);
      const mixed = SS.mixTrack(plan, clips);
      const planCheck = SS.checkPlan(plan, mixed);

      const { Muxer, ArrayBufferTarget } = window.Mp4Muxer;
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: w, height: H, frameRate: fps },
        audio: { codec: enc.audio.mux, numberOfChannels: 1, sampleRate: SR },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      let encErr = null;
      const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { encErr = e; } });
      venc.configure(enc.video);
      const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { encErr = e; } });
      aenc.configure(enc.audio.cfg);

      // Audio first (fast)
      const CH = 4800;
      for (let o = 0; o < mixed.length; o += CH) {
        const n = Math.min(CH, mixed.length - o);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: n, numberOfChannels: 1, timestamp: Math.round((o / SR) * 1e6), data: mixed.slice(o, o + n) });
        aenc.encode(ad); ad.close();
      }

      // Video frames, scene by scene
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = H;
      const ctx = canvas.getContext('2d', { alpha: false });
      const stage = stageCanvas(); const sctx = stage.getContext('2d');
      const gop = fps * 2;
      let lastUi = 0;
      for (let si = 0; si < plan.items.length; si++) {
        const it = plan.items[si];
        const script = scriptFor(scenes[si], it.duration);
        for (let f = 0; f < it.frames; f++) {
          if (encErr) throw encErr;
          const gf = it.startFrame + f;
          SS.drawScene(ctx, script, f / fps);
          const vf = new VideoFrame(canvas, { timestamp: Math.round((gf * 1e6) / fps), duration: Math.round(1e6 / fps) });
          venc.encode(vf, { keyFrame: f === 0 || gf % gop === 0 });
          vf.close();
          while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
          const now = performance.now();
          if (now - lastUi > 120) {
            lastUi = now;
            sctx.drawImage(canvas, 0, 0);
            setProgress(gf / plan.totalFrames, 'Rendering ' + scenes[si].label + ' · frame ' + (gf + 1) + ' / ' + plan.totalFrames);
            await new Promise((r) => setTimeout(r, 0));
          }
        }
      }
      setProgress(0.98, 'Finalizing MP4…');
      await venc.flush(); await aenc.flush();
      if (encErr) throw encErr;
      venc.close(); aenc.close();
      muxer.finalize();
      const blob = new Blob([muxer.target.buffer], { type: 'video/mp4' });

      setProgress(0.99, 'Verifying alignment in the encoded file…');
      let rendered = null;
      try {
        const dec = await new OfflineAudioContext(1, 1, SR).decodeAudioData(await blob.arrayBuffer());
        rendered = SS.verifyRendered(dec.getChannelData(0), dec.sampleRate, plan, clips);
      } catch (e) { rendered = { ok: false, error: 'Could not decode the MP4 audio for verification: ' + e.message, rows: [] }; }

      showResult({ blob, plan, planCheck, rendered, scenes, enc });
      setProgress(1, 'Done');
    } catch (e) {
      console.error(e);
      setProgress(0, 'Render failed: ' + (e && e.message ? e.message : e));
      $('#progressText').classList.add('bad');
    } finally {
      state.rendering = false; validate();
    }
  }

  function setProgress(p, text) {
    $('#progressBar').style.width = (p * 100).toFixed(1) + '%';
    const t = $('#progressText'); t.textContent = text; t.classList.remove('bad');
  }

  function showResult(r) {
    if (state.output && state.output.url) URL.revokeObjectURL(state.output.url);
    const url = URL.createObjectURL(r.blob);
    state.output = { url, blob: r.blob, report: r };
    const res = $('#result'); res.hidden = false;
    const vid = $('#video'); vid.src = url;
    const ok = r.planCheck.ok && r.rendered && r.rendered.ok;
    const ind = $('#alignStatus');
    ind.className = 'align ' + (ok ? 'ok' : 'bad');
    ind.textContent = ok ? 'Alignment OK' : 'Alignment FAILED';
    $('#alignSub').textContent = ok
      ? 'All ' + r.scenes.length + ' narration lines start inside their own scene (measured in the encoded MP4, max offset ' + Math.max(...r.rendered.rows.map((x) => Math.abs(x.offsetMs))) + ' ms).'
      : (r.rendered && r.rendered.error) || 'One or more scenes are out of tolerance — see the table.';
    const dl = $('#download');
    dl.href = url; dl.download = 'stickman-video-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.mp4';
    dl.classList.toggle('disabled', !ok);
    dl.setAttribute('aria-disabled', ok ? 'false' : 'true');
    dl.onclick = (e) => { if (!ok && !confirm('Alignment check failed. Download anyway?')) e.preventDefault(); };
    $('#fileMeta').textContent = fmtS(r.plan.duration) + ' · ' + (r.blob.size / 1048576).toFixed(1) + ' MB · ' + fmtDims().label + ' · ' + r.plan.fps + ' fps · H.264 + ' + (r.enc.audio.mux === 'aac' ? 'AAC' : 'Opus');

    const tb = $('#alignTable tbody'); tb.textContent = '';
    r.plan.items.forEach((it, i) => {
      const pc = r.planCheck.rows[i]; const rv = r.rendered.rows[i];
      const rowOk = pc.ok && rv && rv.ok;
      tb.append(h('tr', { class: rowOk ? '' : 'bad' },
        h('td', null, r.scenes[i].label),
        h('td', { class: 'mono' }, fmtTC(it.start)),
        h('td', { class: 'mono' }, fmtS(it.audioDuration)),
        h('td', { class: 'mono' }, fmtS(it.duration) + (it.padMs > 0.5 ? ' (+' + it.padMs.toFixed(0) + ' ms)' : '')),
        h('td', { class: 'mono' }, rv ? (rv.offsetMs >= 0 ? '+' : '') + rv.offsetMs + ' ms' : '—'),
        h('td', null, rowOk ? '✓' : '✗ ' + pc.issues.concat(rv && !rv.ok ? ['offset ' + rv.offsetMs + ' ms, match ' + rv.confidence.toFixed(2)] : []).join('; '))));
    });
    res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.dispatchEvent(new CustomEvent('stickman:done', { detail: { ok } }));
  }

  // ------------------------------------------------------------------ wiring
  function init() {
    const story = $('#story');
    let t = 0;
    story.addEventListener('input', () => { clearTimeout(t); t = setTimeout(parse, 250); });
    $('#sample').addEventListener('click', () => { story.value = SAMPLE_STORY; parse(); });
    $('#format').addEventListener('change', (e) => { state.settings.format = e.target.value; probeEncoders(); renderScenes(); drawStageIdle(); });
    $('#fps').addEventListener('change', (e) => { state.settings.fps = parseInt(e.target.value, 10); probeEncoders(); });
    $('#captions').addEventListener('change', (e) => { state.settings.captions = e.target.checked; renderScenes(); });
    $('#trimTail').addEventListener('change', (e) => { state.settings.trimTail = e.target.checked; state.slots.forEach(prepareSlot); renderScenes(); validate(); });
    $('#bulk').addEventListener('change', (e) => bulkAssign([...e.target.files]));
    $('#bulkBtn').addEventListener('click', () => $('#bulk').click());
    $('#start').addEventListener('click', start);
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) bulkAssign([...e.dataTransfer.files]); });
    parse();
    probeEncoders();
  }

  // Programmatic API for agents / automation
  window.StickmanStudio = {
    setStory(text) { $('#story').value = text; parse(); return state.parsed.scenes.map((s) => ({ n: s.n, narration: s.narration, actions: s.actions, props: s.props, cast: s.cast })); },
    async setAudio(sceneNumber, data, name) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      await assignAudio(sceneNumber, blob, name || 'scene-' + sceneNumber);
      return state.slots.get(sceneNumber).status;
    },
    status() { validate(); return { locked: $('#start').disabled, errors: state.validation.errors.map((e) => e.text || e), warnings: state.validation.warnings }; },
    async start() { await start(); return state.output ? { ok: $('#alignStatus').textContent === 'Alignment OK', report: state.output.report } : null; },
    getMp4() { return state.output ? state.output.blob : null; },
    settings(s) { Object.assign(state.settings, s || {}); ['format', 'fps'].forEach((k) => { $('#' + k).value = state.settings[k]; }); $('#captions').checked = state.settings.captions; $('#trimTail').checked = state.settings.trimTail; state.slots.forEach(prepareSlot); renderScenes(); return probeEncoders(); },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
