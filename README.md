# teachMe

A little seal that sits on your desktop and helps explain what you're looking at. Hold Control + Shift to ask a question, then release to send it. It reads the selected screen, talks through the answer and draws on a whiteboard or over the screen.

Built with Electron, React and TypeScript. OpenAI generates the lesson. ElevenLabs handles transcription and speech.

## Run it

You'll need Node.js, npm and API access for OpenAI and ElevenLabs.

```sh
npm ci
cp .env.example .env
```

Skip the copy if you already have a `.env`. Fill in `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`, then run:

```sh
npm start
```

The ElevenLabs key needs Speech-to-Text and Text-to-Speech permissions, plus access to the chosen voice. API calls cost money. Restart after changing `.env`. Shell environment variables take priority.

The defaults are `gpt-6.1-sol` for lessons and `eleven_flash_v2_5` for speech. `OPENAI_MODEL` and `ELEVENLABS_MODEL` override them. `OPENAI_FAST_MODE=true` requests premium Fast Mode; it's off by default. Speech plays at normal speed.

On this Mac, add `/usr/local/bin` to your PATH if Node or npm isn't found.

## Using it

- Hold Control + Shift anywhere to record. Release either key to ask. Very short taps are ignored, and recording stops after 60 seconds.
- Drag the seal to move it. Right-click it, or use its menu bar icon, to turn wandering off or open Teaching controls.
- In Teaching controls, type a question, choose a display and pick Whiteboard or Screen. Screen mode always includes a screenshot.
- Under Settings → Course files, choose a folder of course materials (PDF, slides, docs, notes, code). teachMe uploads them to an OpenAI vector store, and the model searches them when they'd help with an answer. Choosing another folder replaces the old index. Remove deletes the uploaded files from OpenAI. Re-choose the folder after its files change.
- In Whiteboard mode, a question that doesn't seem to refer to the screen (no "this", "here", "question 3" and so on) is sent without a screenshot. The check lives in `src/context-router.ts` and is a stand-in for a proper decision model.
- Drag the whiteboard by its title bar. Previous and Next only change the visible slide. Speech and lesson generation keep going.
- Stop & clear cancels recording, requests and playback. Command/Ctrl + Shift + Escape does the same.

A slide appears when its speech starts. If speech isn't configured or fails, use Continue in the controls to read through the lesson. If generation stops early, the valid slides already received stay available.

## macOS permissions

Enable Accessibility for Electron/teachMe so the global shortcut works. macOS may also ask for Input Monitoring. Use Enable voice permissions in the seal menu after granting access. Microphone permission is requested when you start recording.

Screen Recording permission is needed to capture the selected display. Restart after granting it if capture still fails. Sleep, lock and Stop & clear cancel recording. The key hook tracks the shortcut state and doesn't store typed text.

## A few limits

Each question sends the question text, plus a screenshot when needed, to OpenAI. Chosen course files are uploaded to your OpenAI account. Voice recordings go to ElevenLabs, as does narration text. Check what's on the selected screen before asking. API keys stay in Electron's main process, outside React, and `.env` is ignored by Git.

Lessons stream as validated JSON. The model can't run code or control your apps. Requests have timeouts and no automatic retries. Screen annotations expire after two minutes because the screenshot may no longer match what's on screen.

Diagrams are generated schematics. Complex anatomy can still look wrong, so use a clear labeled reference on screen when detail matters. Small screen text can be hard to read after compression. Course search returns up to five passages per question, and course files are capped at 500 per folder and 50 MB each. Ask another question to continue a topic.

## Checks

```sh
npm run typecheck
npm run build
node --test tests/contracts.test.cjs
npx --no-install prettier --check src tests/contracts.test.cjs README.md DESIGN.md package.json tsconfig.json
```

These don't call the providers. Checking real answers, voice quality and screen placement needs a live run.
