# Stickman Studio

Paste a multi-scene story, give every scene its own voice clip, get one MP4 where each narration line starts on the first frame of its own scene. Everything runs in the browser: no server, no account, no credits, no watermark.

**Use it:** open `dist/stickman-studio.html` in Chrome, Edge or Safari. It is one self-contained file and works offline. For development, run `npm run serve` and open `http://localhost:8080/`.

## Pipeline

| Step | What happens | Guarantee |
|---|---|---|
| 1. Story input | One text box. Headers `Scene 1:` / `Scena 1:` / `## Scene 1` split the scenes. | Duplicate scene numbers and empty scenes block generation. |
| 2. Visual engine | Each scene's text is mapped to up to 3 ordered actions (24 available), props and cast (1–2 figures). The sentence order sets the action order. | One frozen rig (`SS.RIG`) and one style (`SS.STYLE`) for every scene. Rendering is deterministic, so the same input gives identical frames. |
| 3. Voice slots | One slot per scene: upload, drag-drop, record from the mic, or bulk upload (`scene_03.mp3` goes to Scene 3). | **Start is locked** if any slot is empty or undecodable, or if two slots hold the same audio. The error names the conflicting scenes. |
| 4. Timing + assembly | Leading silence is cut from every clip. Each scene lasts exactly `ceil(audio / frame)` frames. Audio is placed at the scene's first sample. Video is H.264 and audio is AAC (Opus when AAC is missing), muxed into one MP4. | Each scene is padded by less than 1 frame, and only at its end. |
| 5. Verification | The finished MP4 is decoded again and every narration clip is located by envelope cross-correlation. | **Alignment OK** shows only when every clip measures within ±25 ms of its scene start. Otherwise a per-scene failure report appears. |

### Duplicate detection (the "no wasted credits" lock)
Two checks run on every pair of slots:
1. **Exact bytes.** The SHA-256 of each file is compared, which catches the same file uploaded twice even under a different name.
2. **Same recording.** A 10 ms RMS fingerprint is compared with lag search. A Pearson correlation of 0.95 or more, at nearly the same duration, flags the pair. This catches the same take saved as a re-encoded MP3/OGG or a renamed copy.

Two different takes of different lines never correlate that high. A real re-recording of the same sentence is a distinct recording, so it is allowed.

The lock also reports slots that are missing, silent, still being analyzed or undecodable. A speech-rate check gives a non-blocking warning when a clip's length doesn't fit its text (for example, 40 words in 2 s), which usually means the clip is in the wrong slot.

## Controlling the visuals

```
Scene 1: The Morning                 ← short header text = title (not narrated)
Narration: Sam wakes up and walks to the park.
Visual: he walks, then waves         ← optional: drives the animation instead of the narration
Scene 2: He trips and falls! [fall, sad] [props: rain] [cast: 1]
```

- **Actions:** idle, present, talk, walk, run, jump, wave, sit, sleep, type, read, eat, think, point, search, lift, push, celebrate, laugh, sad, scared, fall, dance, fight
- **Props:** tree, house, city, mountain, sun, moon, rain, car, door, heart, money, clock, phone, bulb. Book, chair, bed, desk/laptop, box and cup appear automatically with their actions.
- Keywords are recognized in English and Italian. After `sit`, the actions read, think, talk and similar stay seated.

## Agent / automation API

```js
StickmanStudio.setStory(text)                 // → parsed scenes with actions/props/cast
await StickmanStudio.setAudio(3, blobOrArrayBuffer, 'scene3.wav')
StickmanStudio.status()                       // → { locked, errors[], warnings[] }
StickmanStudio.settings({ format: '1080p', fps: 30, captions: true })   // formats: 720p | 1080p | vertical
const r = await StickmanStudio.start()        // → { ok, report }
const mp4 = StickmanStudio.getMp4()           // Blob
```

## Limits (stated plainly)
- **Visual mapping is rule-based, not generative.** Keywords map to a fixed action library. It is predictable and free, but it won't invent new motions. Use `[actions]` / `Visual:` when the text is ambiguous.
- **No text-to-speech.** You provide the voice files, one per scene.
- **Audio codec:** browsers with proprietary codecs (Chrome, Edge, Safari) write AAC. Open-source Chromium builds write Opus-in-MP4, which plays in browsers, VLC and YouTube but not in old QuickTime versions. The status line under the Start button shows which codec is in use.
- Rendering needs WebCodecs (Chrome/Edge 94+, Safari 16.4+ for video, recent Firefox).

## Development
- `src/engine.js`: parser, action/prop lexicon, rig and poses, renderer, onset trimming, fingerprints, duplicate finder, timeline planner, alignment verification. It is pure, and the non-drawing parts run in Node.
- `src/app.js`: UI, slots, lock, WebCodecs encode and MP4 mux.
- `vendor/mp4-muxer.js`: [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 5.2.1, MIT.
- `npm test` runs the unit tests (parsing, duplicate lock, timeline invariants, verification catching an 80 ms shift).
- `npm run build` regenerates `dist/stickman-studio.html`.
