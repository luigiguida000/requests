/*
 * Stickman Studio — engine
 * Pure logic + canvas drawing. No DOM access except a CanvasRenderingContext2D passed in.
 * Works in browsers and (for the non-drawing parts) in Node for tests.
 */
(function (root) {
  'use strict';

  const SS = {};
  SS.VERSION = '1.0.0';
  SS.SAMPLE_RATE = 48000;
  SS.FPS_OPTIONS = [24, 25, 30];
  SS.FORMATS = {
    '720p': { w: 1280, h: 720, label: '1280×720 · 16:9' },
    '1080p': { w: 1920, h: 1080, label: '1920×1080 · 16:9' },
    vertical: { w: 1080, h: 1920, label: '1080×1920 · 9:16' },
  };

  // Alignment tolerances
  SS.MAX_LEAD_SILENCE_MS = 20; // narration must be audible within 20 ms of its scene start
  SS.MAX_RENDER_OFFSET_MS = 25; // measured offset in the encoded MP4 (below lip-sync perception)

  // ------------------------------------------------------------------
  // 1. Story parsing
  // ------------------------------------------------------------------
  const HEADER_RE = /^[ \t]*[#>*_\-[(]*[ \t]*(?:scene|scena|escena|szene|sc\.)[ \t]*(\d{1,3})\b[ \t]*[*_\])]*[ \t]*[:.\-–—)]*[ \t]*/gim;
  const NARRATION_LABEL = /^\s*(?:narration|narrator|narrazione|voice[ -]?over|vo|voice|testo|text|line)\s*:\s*/i;
  const VISUAL_LABEL = /^\s*(?:visual|visuals|action|actions|azione|video|on[ -]?screen|scene action)\s*:\s*/i;

  SS.parseStory = function (text) {
    text = String(text || '').replace(/\r\n?/g, '\n');
    const out = { scenes: [], errors: [], warnings: [] };
    const matches = [...text.matchAll(HEADER_RE)];
    if (!text.trim()) return out;
    if (!matches.length) {
      out.errors.push('No scene headers found. Start each scene with a line like "Scene 1:".');
      return out;
    }
    const pre = text.slice(0, matches[0].index).trim();
    if (pre) out.warnings.push('Text before "Scene ' + matches[0][1] + '" is ignored.');

    const seen = new Map();
    matches.forEach((m, i) => {
      const n = parseInt(m[1], 10);
      const start = m.index + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      let body = text.slice(start, end);

      // Bracket directives: [walk, wave]  [action: run]  [props: tree, house]  [cast: 2]
      const directives = { actions: null, props: null, cast: null };
      body = body.replace(/\[([^\]\n]*)\]/g, (s, inner) => {
        const mm = inner.match(/^\s*(actions?|azioni?|props?|oggetti|cast|characters?)\s*:\s*(.*)$/i);
        const key = mm ? mm[1].toLowerCase() : 'actions';
        const vals = (mm ? mm[2] : inner).split(/[,;/+>]|→/).map((v) => v.trim().toLowerCase()).filter(Boolean);
        if (/^(prop|oggetti)/.test(key)) directives.props = (directives.props || []).concat(vals);
        else if (/^(cast|character)/.test(key)) directives.cast = parseInt(vals[0], 10) || null;
        else directives.actions = (directives.actions || []).concat(vals);
        return ' ';
      });

      // Title on the header line?
      const lines = body.split('\n');
      let title = '';
      const first = lines[0].trim();
      const rest = lines.slice(1).join('\n').trim();
      if (first && rest && first.split(/\s+/).length <= 6 && !/[.!?…"”]$/.test(first) &&
          !NARRATION_LABEL.test(first) && !VISUAL_LABEL.test(first)) {
        title = first.replace(/[*_#]+/g, '').trim();
        lines.shift();
      }

      const narr = [];
      const vis = [];
      let mode = 'narr';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (VISUAL_LABEL.test(line)) { mode = 'vis'; vis.push(line.replace(VISUAL_LABEL, '')); continue; }
        if (NARRATION_LABEL.test(line)) { mode = 'narr'; narr.push(line.replace(NARRATION_LABEL, '')); continue; }
        (mode === 'vis' ? vis : narr).push(line);
      }
      const narration = narr.join(' ').replace(/\s+/g, ' ').replace(/^["“]|["”]$/g, '').trim();
      const visual = vis.join(' ').replace(/\s+/g, ' ').trim();

      if (seen.has(n)) out.errors.push('Scene ' + n + ' appears more than once.');
      seen.set(n, true);
      if (!narration) out.errors.push('Scene ' + n + ' has no narration text.');

      const scene = { n, label: 'Scene ' + n, title, narration, visual, directives };
      Object.assign(scene, SS.interpretScene(scene, out.warnings));
      out.scenes.push(scene);
    });

    out.scenes.forEach((s, i) => {
      if (i > 0 && s.n !== out.scenes[i - 1].n + 1) {
        out.warnings.push('Scene numbering jumps from ' + out.scenes[i - 1].n + ' to ' + s.n + ' (scenes are rendered in the order written).');
      }
    });
    const byText = new Map();
    out.scenes.forEach((s) => {
      if (!s.narration) return;
      const k = s.narration.toLowerCase();
      if (byText.has(k)) out.warnings.push('Scenes ' + byText.get(k) + ' and ' + s.n + ' have identical narration text.');
      else byText.set(k, s.n);
    });
    return out;
  };

  // ------------------------------------------------------------------
  // 2. Narration → action / prop / cast mapping (deterministic, EN + IT)
  // ------------------------------------------------------------------
  // Keywords are word-start stems. Order inside the sentence decides the action order.
  const ACTION_LEXICON = {
    run: ['run', 'ran\\b', 'rush', 'sprint', 'hurr', 'chas', 'flee', 'fled', 'dash', 'race[sd]?\\b', 'racing', 'corr[eiao]', 'corse', 'scapp', 'fugg', 'insegu'],
    walk: ['walk', 'stroll', 'step', 'wander', 'march', 'goes to', 'went to', 'heads? (?:to|toward|home|out)', 'headed', 'arriv', 'enter', 'leav', 'left (?:the|home|for)', 'climb', 'cammin', 'passegg', 'arriv', 'entr[ao]', 'esce', 'uscì', 'va (?:a|verso|al|in)', 'andò', 'scal[ao]', 'arrampic'],
    jump: ['jump', 'leap', 'hop', 'bounc', 'salt[aoi]', 'balz'],
    wave: ['wave', 'waving', 'greet', 'hello\\b', 'say(?:s)? (?:hi|hello|goodbye|bye)', 'goodbye', 'farewell', 'salut', 'ciao\\b', 'arrivederci'],
    sit: ['sit', 'sat\\b', 'seat', 'bench', 'couch', 'sofa', 'sied', 'sedut', 'sedia', 'divano', 'panchina'],
    sleep: ['sleep', 'slept', 'asleep', 'nap', 'rest(?:s|ed|ing)?\\b', 'dream', 'bed\\b', 'dorm', 'sonno', 'sogn', 'riposa', 'letto\\b'],
    type: ['work(?:s|ed|ing)? (?:on|at|hard|late)', 'computer', 'laptop', 'typ(?:e|es|ed|ing)\\b', 'cod(?:e|es|ing)\\b', 'program', 'email', 'office', 'desk', 'scriv[ae]', 'lavor', 'ufficio', 'scrivania', 'portatile'],
    read: ['read', 'book', 'stud', 'learn', 'letter', 'news', 'legg', 'lesse', 'libro', 'studi', 'impar', 'lettera'],
    eat: ['eat', 'ate\\b', 'food', 'drink', 'coffee', 'tea\\b', 'lunch', 'dinner', 'breakfast', 'meal', 'mang', 'bev[eo]', 'caff', 'pranzo', 'cena\\b', 'colazione'],
    think: ['think', 'thought', 'wonder', 'idea', 'plan', 'decid', 'consider', 'imagin', 'realiz', 'remember', 'confus', 'puzzl', 'question', 'why\\b', 'how\\b', 'pens[aoi]', 'chied', 'decis', 'ricord', 'immagin', 'cap[iì]'],
    point: ['point', 'show', 'look(?:s|ed)? at', 'notice', 'spot', 'there is', 'indic', 'mostr', 'punt[ao]', 'not[aò]'],
    search: ['search', 'look(?:s|ed|ing)? for', 'seek', 'find', 'found', 'explor', 'discover', 'cerc', 'trov', 'esplor', 'scopr'],
    lift: ['lift', 'carr', 'pick(?:s|ed)? up', 'hold', 'box', 'heavy', 'deliver', 'packag', 'solleva', 'trasport', 'scatol', 'pacco', 'pesant'],
    push: ['push', 'shov', 'spin[gs]'],
    celebrate: ['celebrat', 'win\\b', 'wins\\b', 'won\\b', 'success', 'victor', 'cheer', 'happy', 'happi', 'joy', 'excit', 'proud', 'finally', 'hooray', 'yay\\b', 'achiev', 'festeg', 'vinc', 'vins', 'success', 'felic', 'gioi', 'orgogl', 'final'],
    laugh: ['laugh', 'smil', 'joke', 'funny', 'grin', 'rid[eo]\\b', 'ridev', 'sorrid', 'scherz', 'divertent'],
    sad: ['sad', 'cr(?:y|ies|ied|ying)\\b', 'tear', 'lonel', 'alone', 'lost\\b', 'fail', 'sorrow', 'depress', 'upset', 'disappoint', 'miss(?:es|ed)? ', 'broke\\b', 'trist', 'piang', 'pians', 'lacrim', 'solo\\b', 'sola\\b', 'fall[iì]', 'delus', 'pers[oae]\\b'],
    scared: ['scar', 'afraid', 'fear', 'terrif', 'shock', 'surpris', 'panic', 'nervous', 'worr', 'paur', 'spavent', 'sorpres', 'terror', 'ansi', 'preoccup'],
    fall: ['fall', 'fell', 'trip', 'slip', 'collaps', 'stumbl', 'crash', 'cad[eou]', 'cadd', 'inciamp', 'scivol', 'croll'],
    dance: ['danc', 'party', 'music', 'ball[aoi]', 'danz', 'festa', 'musica'],
    fight: ['fight', 'fought', 'punch', 'hit\\b', 'attack', 'battl', 'kick', 'struggl', 'defend', 'combatt', 'colp', 'lott', 'pugn', 'attacc', 'difend'],
    talk: ['say', 'said', 'talk', 'speak', 'spoke', 'tell', 'told', 'explain', 'ask', 'answer', 'repl', 'shout', 'call(?:s|ed)?\\b', 'discuss', 'dic[eo]\\b', 'disse', 'parl', 'spieg', 'raccont', 'rispond', 'urla', 'chiam'],
  };
  SS.ACTIONS = ['idle', 'present'].concat(Object.keys(ACTION_LEXICON));
  // Lower weight = dropped first when there are too many matches
  const ACTION_WEIGHT = { talk: 1, point: 2, think: 3, present: 0, idle: 0 };
  const ACTION_ALIASES = {
    walking: 'walk', running: 'run', jumping: 'jump', waving: 'wave', sitting: 'sit', sleeping: 'sleep',
    thinking: 'think', talking: 'talk', speak: 'talk', pointing: 'point', celebrating: 'celebrate', cheer: 'celebrate',
    crying: 'sad', cry: 'sad', falling: 'fall', dancing: 'dance', fighting: 'fight', punch: 'fight', reading: 'read',
    carry: 'lift', carrying: 'lift', searching: 'search', look: 'search', scared: 'scared', fear: 'scared',
    pushing: 'push', typing: 'type', work: 'type', drinking: 'eat', drink: 'eat', eating: 'eat', laughing: 'laugh',
    stand: 'idle', standing: 'idle', explain: 'present', present: 'present',
  };

  const PROP_LEXICON = {
    tree: ['tree', 'forest', 'wood(?:s)?\\b', 'park', 'garden', 'alber', 'bosc', 'foresta', 'parco', 'giardin'],
    house: ['house', 'home', 'cottage', 'casa', 'abitazion'],
    city: ['city', 'town', 'street', 'building', 'skyscraper', 'downtown', 'citt', 'strada', 'palazz', 'grattaciel', 'paese'],
    mountain: ['mountain', 'hill', 'peak', 'climb', 'montagn', 'collin', 'vetta', 'scal[ao]'],
    sun: ['sun', 'morning', 'sunny', 'day\\b', 'daylight', 'summer', 'sole\\b', 'mattin', 'giorno', 'estate'],
    moon: ['night', 'moon', 'dark', 'evening', 'midnight', 'star', 'nott', 'luna', 'sera\\b', 'buio', 'stell', 'mezzanott'],
    rain: ['rain', 'storm', 'thunder', 'pioggia', 'piov', 'tempest', 'temporal'],
    car: ['car\\b', 'cars\\b', 'drive', 'drove', 'traffic', 'taxi', 'auto\\b', 'macchina', 'guid[aoi]', 'traffico'],
    door: ['door', 'entrance', 'enter', 'knock', 'ingresso', 'bussa', 'entr[ao]'],
    heart: ['love', 'heart', 'crush', 'romant', 'amor', 'cuor', 'innamor', 'ama\\b', 'amo\\b'],
    money: ['money', 'cash', 'rich', 'pay', 'paid', 'coin', 'salary', 'price', 'buy', 'bought', 'sell', 'sold', 'invest', 'dollar', 'euro', 'soldi', 'denaro', 'ricc', 'pag[aoò]', 'monet', 'stipend', 'compr', 'vend', 'investi'],
    clock: ['clock', 'late\\b', 'time\\b', 'hour', 'minute', 'deadline', 'wait', 'orolog', 'tardi', 'ora\\b', 'ore\\b', 'minut', 'scadenz', 'aspett'],
    phone: ['phone', 'call(?:s|ed)?\\b', 'text(?:s|ed)?\\b', 'message', 'telefon', 'chiam', 'messaggi', 'cellular'],
    bulb: ['idea', 'realiz', 'eureka', 'insight', 'solution', 'soluzion', 'intuizion', 'cap[iì]'],
  };
  SS.PROPS = Object.keys(PROP_LEXICON).concat(['book', 'box', 'chair', 'bed', 'desk', 'cup', 'block']);

  const CAST_RE = /\b(friend|friends|together|meet|meets|met|partner|brother|sister|mother|mom|father|dad|boss|colleague|neighbou?r|stranger|someone|somebody|another|team|couple|they both|two of them|each other|amic[oaie]|insieme|incontr|fratell|sorell|madre|mamma|padre|pap[aà]|capo|collega|vicin[oa]|sconosciut|qualcuno|un altro|un'altra|squadra|coppia|a vicenda|l'un l'altro)/i;

  function lexMatches(text, lexicon) {
    const found = [];
    for (const key of Object.keys(lexicon)) {
      const re = new RegExp('(?:^|[^a-zà-ÿ])(?:' + lexicon[key].join('|') + ')', 'gi');
      let m;
      while ((m = re.exec(text))) {
        found.push({ key, index: m.index });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
    found.sort((a, b) => a.index - b.index);
    return found;
  }

  SS.interpretScene = function (scene, warnings) {
    const src = (scene.visual || scene.narration || '').toLowerCase();
    let actions;
    let actionSource = 'auto';
    if (scene.directives.actions && scene.directives.actions.length) {
      actions = [];
      for (const a of scene.directives.actions) {
        const k = SS.ACTIONS.includes(a) ? a : ACTION_ALIASES[a];
        if (k) actions.push(k);
        else if (warnings) warnings.push(scene.label + ': unknown action "' + a + '" ignored. Known: ' + SS.ACTIONS.join(', ') + '.');
      }
      actionSource = 'directive';
    } else {
      const seen = new Set();
      actions = [];
      for (const f of lexMatches(src, ACTION_LEXICON)) {
        if (!seen.has(f.key)) { seen.add(f.key); actions.push(f.key); }
      }
      while (actions.length > 3) {
        let worst = 0;
        actions.forEach((a, i) => { if ((ACTION_WEIGHT[a] ?? 9) < (ACTION_WEIGHT[actions[worst]] ?? 9)) worst = i; });
        if ((ACTION_WEIGHT[actions[worst]] ?? 9) === 9) actions.length = 3; else actions.splice(worst, 1);
      }
    }
    if (!actions.length) { actions = ['present']; if (actionSource === 'auto') actionSource = 'default'; }

    const props = [];
    const addProp = (p) => { if (!props.includes(p)) props.push(p); };
    if (scene.directives.props) {
      scene.directives.props.forEach((p) => { if (SS.PROPS.includes(p)) addProp(p); else if (warnings) warnings.push(scene.label + ': unknown prop "' + p + '" ignored.'); });
    } else {
      lexMatches(src, PROP_LEXICON).forEach((f) => addProp(f.key));
    }
    if (props.includes('sun') && props.includes('moon')) props.splice(props.indexOf(props.indexOf('sun') < props.indexOf('moon') ? 'sun' : 'moon'), 1);

    const castSrc = src.replace(/(^|[.!?]\s+)(?:meet|ecco|vi presento|conosciamo)\s+[a-zà-ÿ]+[.!,]/g, '$1');
    const cast = scene.directives.cast ? Math.min(2, Math.max(1, scene.directives.cast)) : (CAST_RE.test(castSrc) ? 2 : 1);
    return { actions, actionSource, props, cast };
  };

  // ------------------------------------------------------------------
  // 3. Stickman rig — one fixed design shared by every scene
  // ------------------------------------------------------------------
  // Proportions in reference units (scaled by s). NEVER changed per scene.
  SS.RIG = Object.freeze({ head: 22, neck: 9, torso: 68, upperArm: 36, foreArm: 34, thigh: 44, shin: 44, line: 6 });
  SS.STYLE = Object.freeze({
    paper: '#f7f5ef', ink: '#1c1c1e', ink2: '#5d5d63', soft: '#d9d5c9', ground: '#ebe7dc',
    accent: '#e4572e', warm: '#f2b134', cool: '#3d7ea6',
  });

  const TAU = Math.PI * 2;
  const HALF = Math.PI / 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const bump = (x, a, b) => smooth((x - a) / ((b - a) / 2)) * (1 - smooth((x - (a + b) / 2) / ((b - a) / 2)));

  function P(o) {
    return Object.assign({ lean: 0, head: 0, aF: 0.12, eF: 0.12, aB: -0.12, eB: 0.18, hF: 0.08, kF: 0, hB: -0.08, kB: 0, dx: 0, dy: 0 }, o);
  }

  function gait(t, freq, amp, knee, arm, elbow, lean, flight) {
    const ph = t * TAU * freq;
    const s = Math.sin(ph);
    const c = Math.cos(ph);
    return P({
      lean, hF: amp * s, kF: 0.12 + Math.max(0, c) * knee, hB: -amp * s, kB: 0.12 + Math.max(0, -c) * knee,
      aF: -arm * s, eF: elbow, aB: arm * s, eB: elbow, dy: flight ? -Math.abs(s) * flight : 0,
    });
  }

  // Movement speeds (reference px / s). 0 = stays in place.
  const MOVE = { walk: 140, run: 330, lift: 95, push: 70, search: 110 };

  // pose(action, t, segDur) → pose object
  const POSES = {
    idle(t) { const b = Math.sin(t * TAU * 0.35); return P({ lean: 0.015 * b, aF: 0.12 + 0.03 * b, aB: -0.12 - 0.03 * b }); },
    present(t) {
      return P({ aF: 0.75 + 0.25 * Math.sin(t * 2.9), eF: 1.0 + 0.45 * Math.sin(t * 4.1 + 1), aB: 0.2 + 0.08 * Math.sin(t * 2.1), eB: 0.5, head: 0.05 * Math.sin(t * 2.4), lean: 0.02 });
    },
    talk(t) { return POSES.present(t * 1.15); },
    listen(t) { const b = Math.sin(t * TAU * 0.6); return P({ head: 0.08 + 0.07 * Math.max(0, b), aF: 0.1, aB: -0.1 }); },
    walk(t) { return gait(t, 1.0, 0.42, 0.9, 0.42, 0.35, 0.06, 0); },
    run(t) { return gait(t, 1.5, 0.8, 1.5, 0.95, 1.6, 0.3, 10); },
    lift(t) { const g = gait(t, 0.8, 0.34, 0.7, 0, 0, 0.05, 0); return Object.assign(g, { aF: 1.2, eF: 0.45, aB: 1.1, eB: 0.5 }); },
    push(t) { const g = gait(t, 0.6, 0.38, 0.8, 0, 0, 0.5, 0); return Object.assign(g, { aF: 1.4, eF: 0.15, aB: 1.32, eB: 0.2 }); },
    search(t) {
      const cyc = t % 3;
      const g = cyc < 1.8 ? gait(cyc, 0.8, 0.4, 0.8, 0, 0, 0.05, 0) : POSES.idle(t);
      return Object.assign(g, { aF: 2.0, eF: 1.9, aB: -0.15, eB: 0.2, head: -0.1 + (cyc > 1.8 ? 0.12 * Math.sin((cyc - 1.8) * 5) : 0) });
    },
    jump(t) {
      const v = (t % 1.2) / 1.2;
      let cr = 0;
      let air = 0;
      if (v < 0.25) cr = smooth(v / 0.25);
      else if (v < 0.32) cr = 1 - smooth((v - 0.25) / 0.07);
      if (v >= 0.3 && v < 0.82) air = Math.sin(((v - 0.3) / 0.52) * Math.PI);
      if (v >= 0.82) cr = Math.sin(((v - 0.82) / 0.18) * Math.PI) * 0.7;
      const arms = air > 0 ? 2.5 * smooth(air * 2) : -0.6 * cr;
      return P({ lean: 0.4 * cr, hF: 0.9 * cr + 0.25 * air, kF: 1.8 * cr + 0.5 * air, hB: 0.85 * cr + 0.15 * air, kB: 1.75 * cr + 0.4 * air,
        aF: arms, eF: 0.15, aB: air > 0 ? -arms : arms, eB: 0.15, dy: -110 * air });
    },
    wave(t) { return P({ aF: 2.5, eF: 0.3 + 0.45 * Math.sin(t * TAU * 1.8), aB: -0.1, head: -0.05, lean: -0.02 }); },
    sit(t) { const b = Math.sin(t * TAU * 0.3); return P({ hF: HALF - 0.05, kF: HALF - 0.05, hB: HALF + 0.05, kB: HALF + 0.05, aF: 0.15, eF: 1.2, aB: 0.1, eB: 1.1, lean: -0.04 + 0.015 * b, seat: 1 }); },
    type(t) { const p = POSES.sit(t); return Object.assign(p, { aF: 1.0, eF: 0.55 + 0.06 * Math.sin(t * 23), aB: 0.95, eB: 0.6 + 0.06 * Math.sin(t * 19 + 1), lean: 0.08, head: 0.1, desk: 1 }); },
    sleep(t) { const b = Math.sin(t * TAU * 0.25); return P({ lean: -HALF, head: -0.05, hF: HALF, kF: 0, hB: HALF + 0.04, kB: 0.04, aF: 1.42 + 0.02 * b, eF: 0, aB: 1.38, eB: 0, lying: 1 }); },
    think(t) { return P({ aF: 0.75, eF: 2.55, aB: 0.35, eB: 1.3, head: 0.12 + 0.03 * Math.sin(t * 1.3), lean: 0.03 * Math.sin(t * 1.1) }); },
    point(t) { return P({ aF: HALF - 0.04 + 0.03 * Math.sin(t * 3), eF: 0.02, lean: 0.05, aB: -0.12, head: -0.05 }); },
    celebrate(t) {
      const s = Math.abs(Math.sin(t * TAU * 1.1));
      return P({ aF: 2.65 + 0.15 * Math.sin(t * 7), eF: 0.2, aB: -2.6 + 0.15 * Math.sin(t * 7), eB: -0.2, dy: -28 * s, hF: 0.2 * s, kF: 0.45 * s, hB: 0.1 * s, kB: 0.35 * s, head: -0.15 });
    },
    sad(t) { const b = Math.sin(t * TAU * 0.25); return P({ lean: 0.33 + 0.02 * b, head: 0.45, aF: 0.08, eF: 0.05, aB: 0.02, eB: 0.05, kF: 0.08, kB: 0.08, dx: 2 * b }); },
    fall(t) {
      const p = smooth(t / 0.75);
      const bounce = t > 0.75 && t < 1.05 ? -10 * Math.sin(((t - 0.75) / 0.3) * Math.PI) : 0;
      const lean = p * HALF * 0.97;
      return P({ lean, head: -0.2 * p, hF: -lean + 0.1, kF: 0.1, hB: -lean + 0.05, kB: 0.25 * p, aF: 0.3 + 1.9 * p, eF: 0.2, aB: 0.2 + 2.1 * p, eB: 0.1, dy: bounce, fallen: p });
    },
    dance(t) {
      const ph = t * TAU * 1.1;
      const s2 = Math.sin(ph * 2);
      return P({ lean: 0.15 * Math.sin(ph), dx: 12 * Math.sin(ph), aF: 1.6 + 1.0 * s2, eF: 0.8, aB: -(1.6 - 1.0 * s2), eB: -0.8,
        hF: 0.35 * Math.max(0, s2), kF: 0.9 * Math.max(0, s2), hB: 0.35 * Math.max(0, -s2), kB: 0.9 * Math.max(0, -s2), head: 0.12 * s2 });
    },
    fight(t) {
      const v = (t % 0.6) / 0.6;
      const ext = v < 0.3 ? smooth(v / 0.3) : v < 0.5 ? 1 : 1 - smooth((v - 0.5) / 0.5);
      return P({ lean: 0.12 + 0.12 * ext, hF: 0.4, kF: 0.25, hB: -0.35, kB: 0.15, aF: 1.1 + 0.45 * ext, eF: 1.9 * (1 - ext), aB: 0.8, eB: 2.1, head: -0.05, punch: ext });
    },
    read(t) { return P({ aF: 0.9, eF: 1.1, aB: 0.75, eB: 1.25, head: 0.3 + 0.03 * Math.sin(t * 0.9), lean: 0.04 }); },
    eat(t) {
      const k = bump((t % 2.4) / 2.4, 0.25, 0.75);
      return P({ aF: 0.3 + 0.6 * k, eF: 0.8 + 1.5 * k, aB: -0.1, eB: 0.2, head: -0.12 * k });
    },
    laugh(t) { return P({ lean: -0.16 + 0.07 * Math.sin(t * TAU * 4), head: -0.25, aF: 0.45, eF: 1.5, aB: 0.4, eB: 1.5 }); },
    scared(t) { const tr = Math.sin(t * TAU * 9); return P({ lean: -0.2, aF: 2.3, eF: 2.0, aB: 2.1, eB: 2.2, dx: 2 * tr, hF: 0.15, kF: 0.3, hB: -0.15, kB: 0.3, head: -0.15 }); },
  };

  const POSE_KEYS = ['lean', 'head', 'aF', 'eF', 'aB', 'eB', 'hF', 'kF', 'hB', 'kB', 'dx', 'dy'];
  function lerpPose(a, b, k) {
    const o = Object.assign({}, k < 0.5 ? a : b);
    for (const key of POSE_KEYS) o[key] = a[key] + (b[key] - a[key]) * k;
    return o;
  }

  // Forward kinematics. Angles: 0 = straight down, +π/2 = forward (facing dir), π = up.
  function solve(pose, dir, s) {
    const R = SS.RIG;
    const v = (a, len) => [Math.sin(a) * dir * len * s, Math.cos(a) * len * s];
    const add = (p, q) => [p[0] + q[0], p[1] + q[1]];
    const hip = [0, 0];
    const up = [Math.sin(pose.lean) * dir, -Math.cos(pose.lean)];
    const sh = [up[0] * R.torso * s, up[1] * R.torso * s];
    const ha = pose.lean + pose.head;
    const hd = [Math.sin(ha) * dir, -Math.cos(ha)];
    const neckEnd = [sh[0] + up[0] * R.neck * s, sh[1] + up[1] * R.neck * s];
    const head = [neckEnd[0] + hd[0] * R.head * s, neckEnd[1] + hd[1] * R.head * s];
    const elF = add(sh, v(pose.aF, R.upperArm));
    const haF = add(elF, v(pose.aF + pose.eF, R.foreArm));
    const elB = add(sh, v(pose.aB, R.upperArm));
    const haB = add(elB, v(pose.aB + pose.eB, R.foreArm));
    const knF = add(hip, v(pose.hF, R.thigh));
    const ftF = add(knF, v(pose.hF - pose.kF, R.shin));
    const knB = add(hip, v(pose.hB, R.thigh));
    const ftB = add(knB, v(pose.hB - pose.kB, R.shin));
    const low = Math.max(ftF[1], ftB[1], knF[1], knB[1], head[1] + R.head * s, sh[1], 0);
    return { hip, sh, neckEnd, head, hd, elF, haF, elB, haB, knF, ftF, knB, ftB, low };
  }

  // ------------------------------------------------------------------
  // 4. Scene script (timeline of actions + positions) and renderer
  // ------------------------------------------------------------------
  SS.layout = function (W, H) {
    const vertical = H > W;
    const s = (Math.min(H, W) / 720) * 1.3;
    return { W, H, s, vertical, groundY: Math.round(H * (vertical ? 0.66 : 0.79)) };
  };

  const COMPANION_MIRROR = { walk: 'walk', run: 'run', dance: 'dance', celebrate: 'celebrate', fight: 'fight', laugh: 'laugh', scared: 'scared', wave: 'wave', sad: 'sad', jump: 'jump', sit: 'sit', eat: 'eat', lift: 'lift' };

  SS.buildSceneScript = function (scene, dur, W, H, opts) {
    opts = opts || {};
    const L = SS.layout(W, H);
    const s = L.s;
    const two = scene.cast >= 2;
    const xmin = W * (L.vertical ? 0.16 : 0.1);
    const xmaxSolo = W * (L.vertical ? 0.84 : 0.9);
    const compX = W * (L.vertical ? 0.72 : 0.68);
    const heroHome = two ? W * (L.vertical ? 0.3 : 0.4) : W * 0.5;

    let acts = scene.actions.slice();
    const maxActs = Math.max(1, Math.floor(dur / 0.9));
    if (acts.length > maxActs) acts = acts.slice(0, maxActs);
    const segDur = dur / acts.length;

    let x = MOVE[acts[0]] ? xmin + W * 0.04 : heroHome;
    let dir = 1;
    let seated = false;
    const segs = acts.map((action, i) => {
      const seg = { action, t0: i * segDur, t1: (i + 1) * segDur, x0: x, dir0: dir, speed: (MOVE[action] || 0) * s };
      const follow = two && COMPANION_MIRROR[action] && MOVE[action];
      seg.xmax = two && !follow ? compX - 130 * s : xmaxSolo;
      seg.xmin = xmin;
      if (seg.speed) {
        seg.dir0 = x < (seg.xmin + seg.xmax) / 2 ? 1 : -1;
        const end = travel(seg, segDur);
        x = end.x; dir = end.dir;
      } else if (two) {
        dir = 1;
      }
      seg.dirStatic = dir;
      if (action === 'sit' || action === 'type') seated = true;
      else if (MOVE[action] || !SEATABLE.has(action)) seated = false;
      seg.seated = seated && action !== 'sit' && action !== 'type';
      return seg;
    });
    return {
      W, H, L, scene, dur, segs, two, compX,
      captions: !!opts.captions, narration: scene.narration,
      props: scene.props.slice(), seed: (scene.n * 7919) % 10007,
    };
  };

  // Actions that can be performed while staying seated after a "sit"
  const SEATABLE = new Set(['read', 'think', 'talk', 'present', 'eat', 'laugh', 'sad', 'wave', 'point', 'idle', 'listen', 'scared']);
  function poseFor(seg, tl) {
    const p = POSES[seg.action](tl, seg.t1 - seg.t0);
    if (!seg.seated) return p;
    const legs = POSES.sit(tl);
    return Object.assign(p, { hF: legs.hF, kF: legs.kF, hB: legs.hB, kB: legs.kB, lean: Math.min(p.lean, 0.2), dx: 0, dy: 0, seat: 1 });
  }

  function travelDist(seg, t) {
    if (seg.action === 'search') {
      const full = Math.floor(t / 3);
      return (full * 1.8 + Math.min(t - full * 3, 1.8)) * seg.speed;
    }
    return t * seg.speed;
  }
  function travel(seg, t) {
    const Lr = Math.max(1, seg.xmax - seg.xmin);
    const x0 = clamp(seg.x0, seg.xmin, seg.xmax);
    const u0 = seg.dir0 > 0 ? x0 - seg.xmin : Lr + (seg.xmax - x0);
    const u = (u0 + travelDist(seg, t)) % (2 * Lr);
    return u < Lr ? { x: seg.xmin + u, dir: 1 } : { x: seg.xmax - (u - Lr), dir: -1 };
  }

  function segAt(script, t) {
    const segs = script.segs;
    let k = segs.length - 1;
    for (let i = 0; i < segs.length; i++) if (t < segs[i].t1) { k = i; break; }
    return k;
  }

  function heroState(script, t) {
    const k = segAt(script, t);
    const seg = script.segs[k];
    const tl = Math.max(0, t - seg.t0);
    let pose = poseFor(seg, tl);
    const pos = seg.speed ? travel(seg, tl) : { x: seg.x0, dir: seg.dirStatic };
    const BL = 0.28;
    if (k > 0 && tl < BL) {
      const prev = script.segs[k - 1];
      const prevPose = poseFor(prev, t - prev.t0);
      pose = lerpPose(prevPose, pose, smooth(tl / BL));
    } else if (k === 0 && seg.action === 'fall') {
      // nothing — falls start from standing by construction
    }
    return { seg, k, tl, pose, x: pos.x, dir: pos.dir };
  }

  function companionState(script, t, hero) {
    const seg = hero.seg;
    const mirror = COMPANION_MIRROR[seg.action];
    let action = mirror || (['talk', 'present', 'point', 'think'].includes(seg.action) ? 'listen' : 'idle');
    let x = script.compX;
    let dir = -1;
    if (mirror && MOVE[seg.action]) {
      x = clamp(hero.x - 120 * script.L.s * hero.dir, script.W * 0.05, script.W * 0.95);
      dir = hero.dir;
    } else if (hero.x > x - 60 * script.L.s) {
      dir = 1;
    }
    // Companion's punches alternate with the hero's.
    const tt = action === 'fight' ? hero.tl + 0.3 : hero.tl + 0.17;
    if (action === 'listen' && seg.action === 'talk' && Math.floor(hero.tl / 2.2) % 2 === 1) action = 'talk';
    return { action, pose: POSES[action](tt, 1), x, dir };
  }

  // ---------- drawing primitives ----------
  function line(ctx, pts, w, color) {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  }
  function circle(ctx, x, y, r, stroke, fill, w) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = w; ctx.stroke(); }
  }
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  function drawFigure(ctx, script, x, dir, pose, color) {
    const s = script.L.s;
    const J = solve(pose, dir, s);
    const ox = x + (pose.dx || 0) * s;
    const oy = script.L.groundY - J.low + (pose.dy || 0) * s - (pose.lying ? 8 * s : 0);
    const T = (p) => [ox + p[0], oy + p[1]];
    const w = SS.RIG.line * s;
    const g = {}; for (const k of Object.keys(J)) if (Array.isArray(J[k])) g[k] = T(J[k]);
    g.dir = dir; g.pose = pose; g.s = s;
    // Seat / bed / desk drawn behind the figure
    if (pose.seat) drawChair(ctx, g, s, dir);
    if (pose.lying) drawBed(ctx, g, s, script.L.groundY);
    if (pose.desk) drawDesk(ctx, g, s, dir, script.L.groundY);
    line(ctx, [g.haB, g.elB, g.sh], w, color);
    line(ctx, [g.ftB, g.knB, g.hip], w, color);
    line(ctx, [g.hip, g.sh, g.neckEnd], w, color);
    circle(ctx, g.head[0], g.head[1], SS.RIG.head * s, color, SS.STYLE.paper, w);
    line(ctx, [g.ftF, g.knF, g.hip], w, color);
    line(ctx, [g.haF, g.elF, g.sh], w, color);
    return g;
  }

  function drawChair(ctx, g, s, dir) {
    const c = SS.STYLE.ink2; const w = 4 * s;
    const seatY = g.hip[1] + 7 * s;
    const back = g.hip[0] - dir * 22 * s;
    const front = g.hip[0] + dir * 40 * s;
    line(ctx, [[back, seatY], [front, seatY]], w, c);
    line(ctx, [[back, seatY - 70 * s], [back, g.ftF[1]]], w, c);
    line(ctx, [[front, seatY], [front, g.ftF[1]]], w, c);
  }
  function drawBed(ctx, g, s, gy) {
    const c = SS.STYLE.ink2; const w = 4 * s;
    const xs = [g.head[0], g.ftF[0], g.ftB[0], g.hip[0]];
    const x0 = Math.min(...xs) - 34 * s; const x1 = Math.max(...xs) + 26 * s;
    const top = gy - 2 * s;
    ctx.fillStyle = SS.STYLE.soft; ctx.fillRect(x0, top - 14 * s, x1 - x0, 14 * s);
    line(ctx, [[x0, top - 14 * s], [x1, top - 14 * s]], w, c);
    const hx = g.head[0];
    ctx.beginPath(); ctx.ellipse(hx, top - 22 * s, 30 * s, 10 * s, 0, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = 3 * s; ctx.stroke();
  }
  function drawDesk(ctx, g, s, dir, gy) {
    const c = SS.STYLE.ink2; const w = 4 * s;
    const y = Math.max(g.haF[1], g.haB[1]) + 5 * s;
    const x0 = g.hip[0] + dir * 30 * s; const x1 = g.hip[0] + dir * 140 * s;
    line(ctx, [[x0, y], [x1, y]], w, c);
    line(ctx, [[x1 - dir * 10 * s, y], [x1 - dir * 10 * s, gy]], w, c);
    // laptop
    const lx = g.haF[0] + dir * 6 * s;
    line(ctx, [[lx - dir * 22 * s, y - 3 * s], [lx + dir * 26 * s, y - 3 * s], [lx + dir * 36 * s, y - 48 * s]], 4 * s, SS.STYLE.ink);
  }

  // ---------- background (identical aesthetic for every scene) ----------
  function drawBackground(ctx, script, t) {
    const { W, H, L } = script; const s = L.s; const S = SS.STYLE;
    ctx.fillStyle = S.paper; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = S.ground; ctx.fillRect(0, L.groundY, W, H - L.groundY);
    const props = script.props;
    const sky = L.groundY;
    // Far layer
    if (props.includes('mountain')) {
      ctx.fillStyle = '#e6e2d6';
      ctx.beginPath(); ctx.moveTo(W * 0.05, sky); ctx.lineTo(W * 0.3, sky - 300 * s); ctx.lineTo(W * 0.55, sky); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(W * 0.4, sky); ctx.lineTo(W * 0.68, sky - 220 * s); ctx.lineTo(W * 0.98, sky); ctx.closePath(); ctx.fill();
      line(ctx, [[W * 0.05, sky], [W * 0.3, sky - 300 * s], [W * 0.55, sky]], 3 * s, S.soft);
      line(ctx, [[W * 0.24, sky - 230 * s], [W * 0.3, sky - 300 * s], [W * 0.36, sky - 230 * s]], 3 * s, S.ink2);
    }
    if (props.includes('city')) {
      const r = rng(script.seed + 3); let x = 0;
      ctx.fillStyle = '#e4e0d4';
      while (x < W) { const bw = (60 + r() * 70) * s; const bh = (120 + r() * 230) * s; ctx.fillRect(x, sky - bh, bw - 6 * s, bh); x += bw; }
    }
    // Sky
    if (props.includes('sun')) {
      const cx = W * 0.84; const cy = H * (L.vertical ? 0.12 : 0.17); const r = 34 * s;
      circle(ctx, cx, cy, r, null, S.warm);
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + t * 0.2; line(ctx, [[cx + Math.cos(a) * r * 1.35, cy + Math.sin(a) * r * 1.35], [cx + Math.cos(a) * r * 1.75, cy + Math.sin(a) * r * 1.75]], 4 * s, S.warm); }
    }
    if (props.includes('moon')) {
      const cx = W * 0.84; const cy = H * (L.vertical ? 0.12 : 0.17); const r = 30 * s;
      circle(ctx, cx, cy, r, null, '#c9c5b9'); circle(ctx, cx + 13 * s, cy - 8 * s, r * 0.9, null, S.paper);
      const r2 = rng(script.seed + 11);
      for (let i = 0; i < 14; i++) { const sx = r2() * W; const sy = r2() * sky * 0.6; const tw = 0.5 + 0.5 * Math.sin(t * 2 + i); circle(ctx, sx, sy, (1.5 + tw * 1.8) * s, null, '#b9b5a8'); }
    }
    if (props.includes('rain')) {
      const r3 = rng(script.seed + 17);
      for (let i = 0; i < 3; i++) drawCloud(ctx, W * (0.2 + i * 0.3), H * 0.12 + i * 10 * s, s * 1.2, '#cfcbbe');
      ctx.strokeStyle = S.cool; ctx.lineWidth = 2.5 * s; ctx.lineCap = 'round';
      for (let i = 0; i < 70; i++) {
        const rx = r3() * W; const sp = 500 + r3() * 300; const ry = ((r3() * sky + t * sp * s) % (sky - H * 0.15)) + H * 0.15;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 4 * s, ry + 16 * s); ctx.stroke();
      }
    }
    // Ground-standing props: assign to left / right slots in order of mention
    const ground = props.filter((p) => ['tree', 'house', 'car', 'door'].includes(p));
    const slots = L.vertical ? [0.12, 0.88, 0.5] : [0.11, 0.89, 0.25, 0.75];
    ground.forEach((p, i) => {
      const x = W * slots[i % slots.length];
      if (p === 'tree') drawTree(ctx, x, sky, s);
      if (p === 'house') drawHouse(ctx, x, sky, s);
      if (p === 'car') drawCar(ctx, x, sky, s);
      if (p === 'door') drawDoor(ctx, x, sky, s);
    });
    if (props.includes('clock')) drawClock(ctx, W * (L.vertical ? 0.18 : 0.14), H * (L.vertical ? 0.12 : 0.17), 30 * s, t, s);
    line(ctx, [[0, sky], [W, sky]], 4 * s, S.ink);
  }
  function drawCloud(ctx, x, y, s, fill) {
    ctx.fillStyle = fill;
    [[0, 0, 30], [32, -12, 34], [66, 0, 28], [30, 10, 30]].forEach(([dx, dy, r]) => { ctx.beginPath(); ctx.arc(x + dx * s, y + dy * s, r * s, 0, TAU); ctx.fill(); });
  }
  function drawTree(ctx, x, gy, s) {
    const S = SS.STYLE;
    ctx.fillStyle = '#dfe7d2';
    ctx.beginPath(); ctx.arc(x, gy - 170 * s, 62 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x - 38 * s, gy - 135 * s, 42 * s, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(x + 40 * s, gy - 135 * s, 44 * s, 0, TAU); ctx.fill();
    line(ctx, [[x, gy], [x, gy - 120 * s]], 7 * s, S.ink2);
    line(ctx, [[x, gy - 80 * s], [x + 26 * s, gy - 110 * s]], 4 * s, S.ink2);
  }
  function drawHouse(ctx, x, gy, s) {
    const S = SS.STYLE; const w = 150 * s; const h = 110 * s;
    ctx.fillStyle = '#ece8dd'; ctx.fillRect(x - w / 2, gy - h, w, h);
    line(ctx, [[x - w / 2, gy], [x - w / 2, gy - h], [x + w / 2, gy - h], [x + w / 2, gy]], 4 * s, S.ink2);
    line(ctx, [[x - w / 2 - 14 * s, gy - h], [x, gy - h - 70 * s], [x + w / 2 + 14 * s, gy - h]], 4 * s, S.ink2);
    line(ctx, [[x - 16 * s, gy], [x - 16 * s, gy - 55 * s], [x + 16 * s, gy - 55 * s], [x + 16 * s, gy]], 4 * s, S.ink2);
    ctx.strokeStyle = S.ink2; ctx.lineWidth = 3 * s; ctx.strokeRect(x + 30 * s, gy - 85 * s, 30 * s, 26 * s); ctx.strokeRect(x - 60 * s, gy - 85 * s, 30 * s, 26 * s);
  }
  function drawCar(ctx, x, gy, s) {
    const S = SS.STYLE;
    ctx.fillStyle = '#e9e5da';
    ctx.beginPath(); ctx.moveTo(x - 80 * s, gy - 18 * s); ctx.lineTo(x - 80 * s, gy - 48 * s); ctx.lineTo(x - 45 * s, gy - 50 * s); ctx.lineTo(x - 25 * s, gy - 80 * s);
    ctx.lineTo(x + 35 * s, gy - 80 * s); ctx.lineTo(x + 58 * s, gy - 50 * s); ctx.lineTo(x + 82 * s, gy - 45 * s); ctx.lineTo(x + 82 * s, gy - 18 * s); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = S.ink2; ctx.lineWidth = 4 * s; ctx.stroke();
    circle(ctx, x - 48 * s, gy - 16 * s, 16 * s, S.ink2, S.paper, 4 * s); circle(ctx, x + 50 * s, gy - 16 * s, 16 * s, S.ink2, S.paper, 4 * s);
  }
  function drawDoor(ctx, x, gy, s) {
    const S = SS.STYLE;
    ctx.fillStyle = '#ece8dd'; ctx.fillRect(x - 36 * s, gy - 150 * s, 72 * s, 150 * s);
    line(ctx, [[x - 36 * s, gy], [x - 36 * s, gy - 150 * s], [x + 36 * s, gy - 150 * s], [x + 36 * s, gy]], 4 * s, S.ink2);
    circle(ctx, x + 22 * s, gy - 72 * s, 4 * s, null, S.ink2);
  }
  function drawClock(ctx, x, y, r, t, s) {
    const S = SS.STYLE;
    circle(ctx, x, y, r, S.ink2, '#fff', 4 * s);
    const a1 = t * 1.2 - HALF; const a2 = t * 0.1 - HALF;
    line(ctx, [[x, y], [x + Math.cos(a1) * r * 0.75, y + Math.sin(a1) * r * 0.75]], 3 * s, S.ink);
    line(ctx, [[x, y], [x + Math.cos(a2) * r * 0.5, y + Math.sin(a2) * r * 0.5]], 4 * s, S.ink);
  }

  // ---------- hand props & effects ----------
  function drawHandProps(ctx, g, action, script, tl) {
    const s = g.s; const S = SS.STYLE; const dir = g.dir;
    if (action === 'read') {
      const hx = (g.haF[0] + g.haB[0]) / 2; const hy = Math.min(g.haF[1], g.haB[1]) - 4 * s;
      ctx.save(); ctx.translate(hx, hy); ctx.rotate(-dir * 0.5);
      ctx.fillStyle = '#fff'; ctx.fillRect(-26 * s, -18 * s, 52 * s, 34 * s);
      ctx.strokeStyle = S.ink; ctx.lineWidth = 3.5 * s; ctx.strokeRect(-26 * s, -18 * s, 52 * s, 34 * s);
      line(ctx, [[0, -18 * s], [0, 16 * s]], 3 * s, S.ink);
      ctx.restore();
    }
    if (action === 'lift') {
      const hx = (g.haF[0] + g.haB[0]) / 2; const hy = (g.haF[1] + g.haB[1]) / 2;
      ctx.fillStyle = '#e8d9b8'; ctx.fillRect(hx - 30 * s, hy - 44 * s, 60 * s, 52 * s);
      ctx.strokeStyle = S.ink; ctx.lineWidth = 4 * s; ctx.strokeRect(hx - 30 * s, hy - 44 * s, 60 * s, 52 * s);
      line(ctx, [[hx - 30 * s, hy - 26 * s], [hx + 30 * s, hy - 26 * s]], 2.5 * s, S.ink2);
    }
    if (action === 'push') {
      const bx = g.haF[0] + dir * 2 * s; const gy = script.L.groundY;
      const x0 = dir > 0 ? bx : bx - 110 * s;
      ctx.fillStyle = '#e8d9b8'; ctx.fillRect(x0, gy - 100 * s, 110 * s, 100 * s);
      ctx.strokeStyle = S.ink; ctx.lineWidth = 4 * s; ctx.strokeRect(x0, gy - 100 * s, 110 * s, 100 * s);
    }
    if (action === 'eat') {
      const hx = g.haF[0]; const hy = g.haF[1];
      ctx.fillStyle = '#fff'; ctx.fillRect(hx - 9 * s, hy - 24 * s, 18 * s, 26 * s);
      ctx.strokeStyle = S.ink; ctx.lineWidth = 3.5 * s; ctx.strokeRect(hx - 9 * s, hy - 24 * s, 18 * s, 26 * s);
      for (let i = 0; i < 2; i++) { const o = (tl * 0.8 + i * 0.5) % 1; ctx.globalAlpha = 1 - o; line(ctx, [[hx - 4 * s + i * 8 * s, hy - 30 * s - o * 30 * s], [hx - 2 * s + i * 8 * s, hy - 40 * s - o * 30 * s]], 2.5 * s, S.ink2); ctx.globalAlpha = 1; }
    }
    if (script.props.includes('phone') && (action === 'talk' || action === 'present' || action === 'idle' || action === 'listen')) {
      // phone held to the ear by the back hand
      const ex = g.head[0] - dir * 6 * s; const ey = g.head[1] + 4 * s;
      ctx.fillStyle = S.ink; ctx.fillRect(ex - 6 * s, ey - 14 * s, 12 * s, 26 * s);
      line(ctx, [[g.sh[0], g.sh[1]], [g.sh[0] + dir * 6 * s, g.sh[1] + 10 * s], [ex, ey + 8 * s]], SS.RIG.line * s, S.ink);
    }
  }

  function drawEffects(ctx, g, action, script, tl, isHero) {
    const s = g.s; const S = SS.STYLE; const dir = g.dir;
    const hx = g.head[0]; const hy = g.head[1]; const R = SS.RIG.head * s;
    const text = (str, x, y, size, color, alpha) => {
      ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.fillStyle = color; ctx.font = '700 ' + Math.round(size) + 'px ui-rounded, "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(str, x, y); ctx.globalAlpha = 1;
    };
    if (action === 'talk') {
      const bx = hx + dir * 62 * s; const by = hy - 52 * s;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = S.ink; ctx.lineWidth = 3.5 * s;
      ctx.beginPath(); ctx.ellipse(bx, by, 44 * s, 28 * s, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx - dir * 18 * s, by + 22 * s); ctx.lineTo(hx + dir * 24 * s, hy - 12 * s); ctx.lineTo(bx - dir * 2 * s, by + 27 * s); ctx.fill(); ctx.stroke();
      for (let i = 0; i < 3; i++) { const on = Math.floor(tl * 3) % 4 > i; circle(ctx, bx + (i - 1) * 14 * s, by, 4 * s, null, on ? S.ink : S.soft); }
    }
    if (action === 'think') {
      const bulb = script.props.includes('bulb');
      const bx = hx + dir * 10 * s; const by = hy - R - 40 * s + 4 * s * Math.sin(tl * 3);
      if (bulb && tl > 0.6) {
        circle(ctx, bx, by, 18 * s, S.ink, S.warm, 3.5 * s);
        ctx.fillStyle = S.ink2; ctx.fillRect(bx - 8 * s, by + 16 * s, 16 * s, 9 * s);
        for (let i = 0; i < 6; i++) { const a = -Math.PI + i * Math.PI / 5; line(ctx, [[bx + Math.cos(a) * 26 * s, by + Math.sin(a) * 26 * s], [bx + Math.cos(a) * 34 * s, by + Math.sin(a) * 34 * s]], 3 * s, S.warm); }
      } else {
        text('?', bx, by, 44 * s, S.ink);
      }
    }
    if (action === 'search' && (tl % 3) > 1.8) text('?', hx + dir * 30 * s, hy - R - 30 * s, 36 * s, S.ink, smooth(((tl % 3) - 1.8) * 3));
    if (action === 'scared') { text('!', hx + dir * 4 * s, hy - R - 36 * s, 50 * s, S.accent); circle(ctx, hx - dir * (R + 8 * s), hy - 4 * s + ((tl * 40) % 20) * s, 4 * s, null, S.cool); }
    if (action === 'sleep') {
      for (let i = 0; i < 3; i++) { const o = (tl * 0.45 + i / 3) % 1; text('Z', hx + (20 + o * 40) * s, hy - (30 + o * 80) * s, (18 + o * 18) * s, S.ink2, 1 - o); }
    }
    if (action === 'sad' && isHero) {
      drawCloud(ctx, hx - 30 * s, hy - R - 70 * s, s * 0.8, '#b8b4a8');
      ctx.strokeStyle = S.cool; ctx.lineWidth = 2.5 * s;
      for (let i = 0; i < 6; i++) { const ry = ((tl * 160 + i * 23) % 60) * s; const rx = hx - 40 * s + i * 13 * s; ctx.beginPath(); ctx.moveTo(rx, hy - R - 50 * s + ry); ctx.lineTo(rx - 2 * s, hy - R - 42 * s + ry); ctx.stroke(); }
      const o = (tl * 0.9) % 1; circle(ctx, hx + dir * 8 * s, hy + 6 * s + o * 30 * s, 3.5 * s, null, S.cool);
    }
    if (action === 'celebrate' && isHero) {
      const r = rng(script.seed + 29); const colors = [S.accent, S.warm, S.cool, '#6aa36f'];
      for (let i = 0; i < 40; i++) {
        const cx = r() * script.W; const sp = 120 + r() * 160; const cy = ((r() * script.H + tl * sp * s) % (script.L.groundY));
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(tl * 4 + i); ctx.fillStyle = colors[i % 4]; ctx.fillRect(-5 * s, -3 * s, 10 * s, 6 * s); ctx.restore();
      }
    }
    if (action === 'fall' && tl > 0.75) {
      for (let i = 0; i < 3; i++) { const a = tl * 4 + i * TAU / 3; drawStar(ctx, hx + Math.cos(a) * 34 * s, hy - 26 * s + Math.sin(a) * 10 * s, 10 * s, S.warm); }
    }
    if (action === 'fight' && g.pose.punch > 0.9) {
      const fx = g.haF[0] + dir * 14 * s; const fy = g.haF[1];
      for (let i = 0; i < 7; i++) { const a = i * TAU / 7; line(ctx, [[fx + Math.cos(a) * 10 * s, fy + Math.sin(a) * 10 * s], [fx + Math.cos(a) * 24 * s, fy + Math.sin(a) * 24 * s]], 3 * s, S.accent); }
    }
    if (action === 'laugh') { const a = Math.floor(tl * 4) % 2; text('HA', hx + dir * 48 * s, hy - 40 * s - a * 6 * s, 24 * s, S.ink); text('HA', hx + dir * 78 * s, hy - 62 * s + a * 6 * s, 20 * s, S.ink2); }
    if (action === 'dance' && isHero) { for (let i = 0; i < 3; i++) { const o = (tl * 0.5 + i / 3) % 1; ctx.globalAlpha = 1 - o; drawNote(ctx, hx + (i - 1) * 60 * s + Math.sin(o * TAU) * 10 * s, hy - 30 * s - o * 90 * s, s, S.ink2); ctx.globalAlpha = 1; } }
    if (action === 'point') {
      const fx = g.haF[0] + dir * 20 * s; const fy = g.haF[1]; const o = 6 * s * Math.sin(tl * 6);
      line(ctx, [[fx + o * dir, fy], [fx + dir * 40 * s + o * dir, fy]], 3.5 * s, S.accent);
      line(ctx, [[fx + dir * 30 * s + o * dir, fy - 8 * s], [fx + dir * 40 * s + o * dir, fy], [fx + dir * 30 * s + o * dir, fy + 8 * s]], 3.5 * s, S.accent);
    }
  }

  function drawSceneEffects(ctx, script, t) {
    const s = script.L.s; const S = SS.STYLE;
    if (script.props.includes('heart')) {
      for (let i = 0; i < 5; i++) {
        const o = (t * 0.25 + i / 5) % 1; const x = script.W * (0.3 + 0.1 * i) + Math.sin(o * TAU + i) * 20 * s; const y = script.L.groundY - 140 * s - o * 220 * s;
        ctx.globalAlpha = Math.sin(o * Math.PI); drawHeart(ctx, x, y, 14 * s, S.accent); ctx.globalAlpha = 1;
      }
    }
    if (script.props.includes('money')) {
      for (let i = 0; i < 6; i++) {
        const o = (t * 0.35 + i / 6) % 1; const x = script.W * (0.2 + 0.12 * i); const y = script.H * 0.08 + o * (script.L.groundY - script.H * 0.08 - 16 * s);
        ctx.save(); ctx.translate(x, y); ctx.scale(Math.abs(Math.cos(t * 3 + i)) + 0.15, 1);
        circle(ctx, 0, 0, 14 * s, S.ink, S.warm, 3 * s); ctx.fillStyle = S.ink; ctx.font = '700 ' + Math.round(16 * s) + 'px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', 0, 1 * s);
        ctx.restore();
      }
    }
  }
  function drawStar(ctx, x, y, r, fill) {
    ctx.fillStyle = fill; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = -HALF + i * Math.PI / 5; const rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  function drawNote(ctx, x, y, s, color) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, 7 * s, 5 * s, -0.4, 0, TAU); ctx.fill();
    line(ctx, [[x + 6 * s, y - 1 * s], [x + 6 * s, y - 26 * s], [x + 16 * s, y - 20 * s]], 3 * s, color);
  }
  function drawHeart(ctx, x, y, r, fill) {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.moveTo(x, y + r * 0.9);
    ctx.bezierCurveTo(x - r * 1.6, y - r * 0.2, x - r * 0.7, y - r * 1.4, x, y - r * 0.5);
    ctx.bezierCurveTo(x + r * 0.7, y - r * 1.4, x + r * 1.6, y - r * 0.2, x, y + r * 0.9); ctx.fill();
  }

  function wrapText(ctx, text, maxW) {
    const words = text.split(/\s+/); const lines = []; let cur = '';
    for (const w of words) { const test = cur ? cur + ' ' + w : w; if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; } else cur = test; }
    if (cur) lines.push(cur);
    return lines;
  }
  function drawCaptions(ctx, script) {
    const { W, H, L } = script; const s = L.s;
    let size = 30 * s; let lines;
    for (let i = 0; i < 6; i++) {
      ctx.font = '600 ' + Math.round(size) + 'px "Segoe UI", system-ui, sans-serif';
      lines = wrapText(ctx, script.narration, W * 0.86);
      if (lines.length <= 3) break; size *= 0.85;
    }
    const lh = size * 1.3; const boxH = lines.length * lh + 24 * s;
    const y0 = L.vertical ? L.groundY + (H - L.groundY - boxH) / 2 : H - boxH - 14 * s;
    ctx.fillStyle = 'rgba(28,28,30,0.82)';
    const bw = Math.min(W * 0.92, Math.max(...lines.map((l) => ctx.measureText(l).width)) + 44 * s);
    roundRect(ctx, (W - bw) / 2, y0, bw, boxH, 12 * s); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + 12 * s + lh * (i + 0.5)));
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /** Draw one frame of a scene at local time t (seconds from scene start). Deterministic. */
  SS.drawScene = function (ctx, script, t) {
    t = clamp(t, 0, Math.max(0, script.dur - 1e-6));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground(ctx, script, t);
    const hero = heroState(script, t);
    if (script.two) {
      const c = companionState(script, t, hero);
      const gC = drawFigure(ctx, script, c.x, c.dir, c.pose, SS.STYLE.ink2);
      drawHandProps(ctx, gC, c.action, script, hero.tl);
      drawEffects(ctx, gC, c.action, script, hero.tl, false);
    }
    const g = drawFigure(ctx, script, hero.x, hero.dir, hero.pose, SS.STYLE.ink);
    drawHandProps(ctx, g, hero.seg.action, script, hero.tl);
    drawEffects(ctx, g, hero.seg.action, script, hero.tl, true);
    drawSceneEffects(ctx, script, t);
    if (script.captions && script.narration) drawCaptions(ctx, script);
    ctx.restore();
  };

  // ------------------------------------------------------------------
  // 5. Audio analysis: onset trimming, fingerprints, duplicate detection
  // ------------------------------------------------------------------
  /** Index of first audible sample (5 ms RMS windows, threshold relative to the clip's own peak). */
  SS.detectOnset = function (pcm, sr) {
    const win = Math.max(1, Math.round(sr * 0.005));
    const n = Math.floor(pcm.length / win);
    if (!n) return 0;
    const rms = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      let acc = 0; const o = i * win;
      for (let j = 0; j < win; j++) { const v = pcm[o + j]; acc += v * v; }
      rms[i] = Math.sqrt(acc / win); if (rms[i] > peak) peak = rms[i];
    }
    if (peak < 1e-4) return -1; // silent clip
    const thr = Math.max(0.004, peak * 0.06);
    for (let i = 0; i < n; i++) if (rms[i] >= thr) return i * win;
    return 0;
  };
  SS.detectEnd = function (pcm, sr) {
    const win = Math.max(1, Math.round(sr * 0.005));
    const n = Math.floor(pcm.length / win);
    let peak = 0; const rms = new Float32Array(n);
    for (let i = 0; i < n; i++) { let acc = 0; const o = i * win; for (let j = 0; j < win; j++) { const v = pcm[o + j]; acc += v * v; } rms[i] = Math.sqrt(acc / win); if (rms[i] > peak) peak = rms[i]; }
    const thr = Math.max(0.004, peak * 0.06);
    for (let i = n - 1; i >= 0; i--) if (rms[i] >= thr) return Math.min(pcm.length, (i + 1) * win);
    return pcm.length;
  };

  /**
   * Prepare a narration clip: cut leading silence (keeping a 10 ms pre-roll so the first
   * consonant is intact), optionally cut trailing silence, add 3 ms fades against clicks.
   */
  SS.prepareClip = function (pcm, sr, opts) {
    opts = opts || {};
    const onset = SS.detectOnset(pcm, sr);
    if (onset < 0) return { pcm: new Float32Array(0), leadTrimmed: 0, tailTrimmed: 0, silent: true };
    const pre = Math.round(sr * 0.01);
    const start = Math.max(0, onset - pre);
    let end = pcm.length;
    if (opts.trimTail) end = Math.min(pcm.length, SS.detectEnd(pcm, sr) + Math.round(sr * 0.12));
    const out = pcm.slice(start, end);
    const f = Math.min(Math.round(sr * 0.003), out.length >> 1);
    for (let i = 0; i < f; i++) { out[i] *= i / f; out[out.length - 1 - i] *= i / f; }
    return { pcm: out, leadTrimmed: start, tailTrimmed: pcm.length - end, silent: false };
  };

  SS.fingerprint = function (pcm, sr) {
    const hop = Math.round(sr / 100);
    const n = Math.max(1, Math.floor(pcm.length / hop));
    const env = new Float32Array(n);
    for (let i = 0; i < n; i++) { let acc = 0; const o = i * hop; for (let j = 0; j < hop && o + j < pcm.length; j++) acc += pcm[o + j] * pcm[o + j]; env[i] = Math.sqrt(acc / hop); }
    return { dur: pcm.length / sr, env };
  };

  function pearsonAtLag(a, b, lag) {
    const start = Math.max(0, -lag); const end = Math.min(a.length, b.length - lag);
    const n = end - start; if (n < 10) return 0;
    let ma = 0; let mb = 0;
    for (let i = start; i < end; i++) { ma += a[i]; mb += b[i + lag]; }
    ma /= n; mb /= n;
    let num = 0; let da = 0; let db = 0;
    for (let i = start; i < end; i++) { const x = a[i] - ma; const y = b[i + lag] - mb; num += x * y; da += x * x; db += y * y; }
    return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
  }

  /** Similarity in [0,1] between two fingerprints (1 = same recording). */
  SS.similarity = function (fa, fb) {
    const dmax = Math.max(fa.dur, fb.dur);
    if (Math.abs(fa.dur - fb.dur) > 0.03 * dmax + 0.06) return 0;
    let best = 0;
    for (let lag = -10; lag <= 10; lag++) best = Math.max(best, pearsonAtLag(fa.env, fb.env, lag));
    return best;
  };
  SS.DUP_SIMILARITY = 0.95;

  /**
   * slots: [{label, hash, fp} | null]  (index = scene order)
   * returns { missing:[label], groups:[{labels, reason}] , ok }
   */
  SS.findDuplicates = function (slots) {
    const parent = slots.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const reason = {};
    const missing = [];
    slots.forEach((sl, i) => { if (!sl) missing.push(i); });
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const a = slots[i]; const b = slots[j];
        if (!a || !b) continue;
        let why = null;
        if (a.hash && a.hash === b.hash) why = 'identical audio file';
        else if (a.fp && b.fp && SS.similarity(a.fp, b.fp) >= SS.DUP_SIMILARITY) why = 'same recording (re-encoded or renamed copy)';
        if (why) { const ri = find(i); const rj = find(j); parent[rj] = ri; reason[ri] = reason[ri] || why; if (reason[rj] && reason[rj] !== why) reason[ri] = 'identical / same recording'; }
      }
    }
    const groups = new Map();
    slots.forEach((sl, i) => { if (!sl) return; const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
    const dup = [];
    for (const [r, idx] of groups) if (idx.length > 1) dup.push({ indices: idx, reason: reason[r] || reason[find(r)] || 'duplicate' });
    return { missing, groups: dup, ok: !missing.length && !dup.length };
  };

  // ------------------------------------------------------------------
  // 6. Timeline planning + alignment verification
  // ------------------------------------------------------------------
  /**
   * clips: [{ samples }] (prepared clip lengths, in samples at sr)
   * Every scene lasts exactly ceil(audio / frame) frames → video is cut/extended to the narration,
   * padded by < 1 frame of silence at the END of the scene, never at the start.
   */
  SS.planTimeline = function (clips, fps, sr) {
    sr = sr || SS.SAMPLE_RATE;
    const spf = sr / fps;
    if (!Number.isInteger(spf)) throw new Error('fps ' + fps + ' does not divide sample rate ' + sr);
    let frame = 0;
    const items = clips.map((c, i) => {
      const frames = Math.max(1, Math.ceil(c.samples / spf));
      const it = { index: i, startFrame: frame, frames, startSample: frame * spf, audioSamples: c.samples, sceneSamples: frames * spf };
      it.start = it.startSample / sr; it.duration = it.sceneSamples / sr; it.audioDuration = c.samples / sr;
      it.padMs = ((it.sceneSamples - it.audioSamples) / sr) * 1000;
      frame += frames;
      return it;
    });
    return { fps, sr, spf, items, totalFrames: frame, totalSamples: frame * spf, duration: (frame * spf) / sr };
  };

  /** Build the mixed narration track: each clip written at its scene's first sample. */
  SS.mixTrack = function (plan, pcms) {
    const out = new Float32Array(plan.totalSamples);
    plan.items.forEach((it, i) => out.set(pcms[i].subarray(0, it.sceneSamples), it.startSample));
    return out;
  };

  /** Structural check of the plan + measured lead silence on the mixed track. */
  SS.checkPlan = function (plan, mixed) {
    const sr = plan.sr;
    const rows = plan.items.map((it, i) => {
      const issues = [];
      if (it.startSample !== it.startFrame * plan.spf) issues.push('audio start not on scene start');
      if (it.audioSamples > it.sceneSamples) issues.push('audio longer than scene');
      if (it.sceneSamples - it.audioSamples >= plan.spf) issues.push('scene longer than audio by ≥ 1 frame');
      const next = plan.items[i + 1];
      if (next && it.startSample + it.audioSamples > next.startSample) issues.push('audio spills into next scene');
      let leadMs = null;
      if (mixed) {
        const seg = mixed.subarray(it.startSample, it.startSample + it.audioSamples);
        const on = SS.detectOnset(seg, sr);
        leadMs = on < 0 ? null : (on / sr) * 1000;
        if (on < 0) issues.push('scene audio is silent');
        else if (leadMs > SS.MAX_LEAD_SILENCE_MS) issues.push('narration starts ' + leadMs.toFixed(0) + ' ms late');
      }
      return { index: i, start: it.start, duration: it.duration, audioDuration: it.audioDuration, padMs: it.padMs, leadMs, ok: !issues.length, issues };
    });
    return { ok: rows.every((r) => r.ok), rows };
  };

  function env1k(pcm, sr, from, len) {
    const hop = Math.round(sr / 1000);
    const n = Math.floor(len / hop);
    const out = new Float32Array(Math.max(0, n));
    for (let i = 0; i < n; i++) {
      let acc = 0; const o = from + i * hop;
      for (let j = 0; j < hop; j++) { const idx = o + j; if (idx >= 0 && idx < pcm.length) acc += Math.abs(pcm[idx]); }
      out[i] = acc / hop;
    }
    return out;
  }

  /**
   * Post-render verification: locate each narration clip inside the DECODED final MP4 audio
   * by envelope cross-correlation (1 ms resolution, ±120 ms search) and report its real offset
   * from the scene's first frame.
   */
  SS.verifyRendered = function (decoded, decodedSr, plan, pcms) {
    const sr = decodedSr;
    const rows = plan.items.map((it, i) => {
      const clip = pcms[i];
      const refLen = Math.min(clip.length, Math.round(plan.sr * 1.5));
      const ref = env1k(clip, plan.sr, 0, refLen);
      const startDec = Math.round(it.start * sr);
      const search = 120;
      const hay = env1k(decoded, sr, startDec - Math.round(search * sr / 1000), Math.round((refLen / plan.sr) * sr) + Math.round(2 * search * sr / 1000));
      let best = -2; let bestLag = 0;
      for (let lag = 0; lag <= 2 * search; lag++) {
        const r = pearsonAtLag(ref, hay, lag);
        if (r > best) { best = r; bestLag = lag; }
      }
      const offsetMs = bestLag - search;
      const ok = best > 0.6 && Math.abs(offsetMs) <= SS.MAX_RENDER_OFFSET_MS;
      return { index: i, offsetMs, confidence: best, ok };
    });
    return { ok: rows.every((r) => r.ok), rows };
  };

  // ------------------------------------------------------------------
  // 7. Hashing
  // ------------------------------------------------------------------
  SS.hashBytes = async function (buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const subtle = root.crypto && root.crypto.subtle;
    if (subtle) {
      const d = await subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback: two independent 32-bit FNV-1a passes
    let h1 = 0x811c9dc5; let h2 = 0x01000193 ^ bytes.length;
    for (let i = 0; i < bytes.length; i++) { h1 = Math.imul(h1 ^ bytes[i], 16777619); h2 = Math.imul(h2 ^ bytes[bytes.length - 1 - i], 16777619); }
    return 'fnv-' + (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0') + '-' + bytes.length;
  };

  /** Rough check that a clip's length is plausible for its narration (catches swapped slots). */
  SS.speechRateWarning = function (narration, seconds) {
    const words = (narration.match(/\S+/g) || []).length;
    if (!words || !seconds) return null;
    const wps = words / seconds;
    if (wps > 5.5) return 'audio is short for its text (' + words + ' words in ' + seconds.toFixed(1) + ' s)';
    if (wps < 0.7 && seconds > 3) return 'audio is long for its text (' + words + ' words in ' + seconds.toFixed(1) + ' s)';
    return null;
  };

  SS.estimateDuration = function (narration) {
    const words = (narration.match(/\S+/g) || []).length;
    return Math.max(2, words / 2.6);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SS;
  else root.StickmanEngine = SS;
})(typeof globalThis !== 'undefined' ? globalThis : this);
