# teachMe

A little seal that sits on your desktop and helps explain what you're looking at. Hold Control + Shift to ask a question, then release to send it. It chooses whether a screenshot is needed, then talks through the answer with optional whiteboard or screen drawings.

Built with Electron, React and TypeScript. Jev chooses context and drawing independently. OpenAI interprets images and generates the lesson. ElevenLabs handles transcription and speech.

## Run it

You'll need Node.js, npm and API access for TypeSafe, OpenAI and ElevenLabs.

```sh
npm ci
cp .env.example .env
```

Skip the copy if you already have a `.env`. Fill in `TYPESAFE_API_KEY`, `OPENAI_API_KEY`, `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`, then run:

```sh
npm start
```

The ElevenLabs key needs Speech-to-Text and Text-to-Speech permissions, plus access to the chosen voice. API calls cost money. Restart after changing `.env`. Shell environment variables take priority.

The defaults are `gpt-6.1-sol` for lessons and `eleven_flash_v2_5` for speech. `OPENAI_MODEL` and `ELEVENLABS_MODEL` override them. `OPENAI_FAST_MODE=true` requests premium Fast Mode; it's off by default. Speech plays at normal speed.

On this Mac, add `/usr/local/bin` to your PATH if Node or npm isn't found.

## Using it

- Hold Control + Shift anywhere to record. Release either key to ask. Very short taps are ignored, and recording stops after 60 seconds.
- Drag the seal to move it. Right-click it, or use its menu bar icon, to enable wandering or open Eat my files. Wandering is off by default.
- Automatic routing chooses question-only or screenshot, separately from no drawing, whiteboard, screen annotations, or both. A screenshot can lead to a whiteboard explanation.
- Screen-reading instructions ignore teachMe’s own seal, bubble, board and windows unless your question explicitly asks about them. Screenshots are not redacted.
- Context and drawing are always chosen automatically. Explicit instructions in your question take priority.
- Voice questions use the display under the pointer when Control–Shift is pressed.
- Ambiguous or low-confidence routing defaults to a screenshot and both drawing options. Explicit context and drawing restrictions still apply. A routing service failure stops before capture.
- Choose **Eat my files…** from the seal or menu bar icon, then choose a folder of PDFs, slides, docs, notes or code. Supported files in its subfolders are uploaded too. The lesson model searches the index when useful. Re-choose the folder after changing its files.
- Drag the blackboard by its title bar. Previous and Next only change the visible slide. Speech and lesson generation keep going.
- Use the minus button to minimize the whiteboard or speech bubble. Show board and Show restore them without clearing the lesson or stopping audio.
- End lesson on the board, the bubble’s close button, and Stop & clear in the seal menu cancel recording, requests and playback and clear annotations. Command/Ctrl + Shift + Escape does the same. Plain Escape is not mapped.
- A small bubble above the seal shows listening, thinking, planning and narration as lesson steps arrive. Continue appears for reading, and Check screen can retry an automatic check. There is no Teaching controls pane.

A slide appears when its speech starts. If speech isn't configured or fails, use Continue in the seal bubble to read through the lesson. If generation stops early, the valid slides already received stay available.

## macOS permissions

Enable Accessibility for Electron/teachMe so the global shortcut works. macOS may also ask for Input Monitoring. Use Enable voice permissions in the seal menu after granting access. Microphone permission is requested when you start recording.

Screen Recording permission is needed only for routed screenshots. Grant it yourself in System Settings and restart if capture still fails. Sleep, lock and Stop & clear cancel recording. The key hook tracks shortcut state and does not store typed text.

## A few limits

Jev receives the question and up to four recent conversation excerpts. Its two Choice answers must each reach 0.75 confidence unless overridden; otherwise the default above applies. OpenAI receives the question, recent lesson and a screenshot only when requested by the route or override. Chosen course files are uploaded to your OpenAI account and stay indexed across app restarts. Voice recordings go to ElevenLabs, as does narration text. Check the chosen display before sharing it. There are no raw context logs. API keys stay in Electron’s main process, outside React, and `.env` is ignored by Git.

Lessons stream as validated JSON. The model cannot run code or control your apps. Requests have timeouts and no automatic retries. Screen annotations expire after two minutes and clear on external clicks or typing without stopping narration. Scrolling hides marks while local pixel matching looks for their new positions, up to 30 captures per turn. Display changes cancel the lesson. Programmatic window movement and page animation can still stale the image; ask again for a fresh capture. Electron captures displays; only the chosen display image is sent to OpenAI.

Diagrams are generated schematics. Complex anatomy can still look wrong, so use a clear labeled reference on screen when detail matters. Small screen text can be hard to read after compression. Course search returns up to five passages per search, and course files are capped at 500 per folder and 50 MB each. Ask another question to continue a topic.

Guided lessons pause after each action and automatically check the result on screen. Once verified, the app captures the new page and plans the next explanation and pointers using the original question and completed steps. You do not need to press a completion button. Checks allow up to five attempts per checkpoint and 20 automatic checks per turn, within a two-minute watch window. Incomplete results retry within those limits; an uncertain result or app switch can resume on the next interaction. Check screen retries directly, without a confirmation checkbox. Sensitive steps and questions that prohibit screenshots do not send checking screenshots; ask a new question when ready. Lessons remain bounded to 12 segments. The app never clicks for you.

Before a lesson, OpenAI checks whether the question needs public web research, using only the question and at most two search tool calls. Screenshots and lesson history are not sent to research. App-layout research is disabled by default; it runs only if explicitly requested. App guidance uses the lesson screenshot to identify the app and visible controls. Verified sources appear as clickable links. Research, lesson planning and checkpoint verification use medium reasoning.

Course removal retains the saved reference when remote cleanup fails, so Remove can be retried. Replacement cleanup and partial uploads remain best-effort and can leave files in OpenAI; this UI update does not resolve those broader cleanup paths.

## Architecture

[Editable Excalidraw scene](docs/architecture/teachme-architecture.excalidraw) · [SVG preview](docs/architecture/teachme-architecture.svg)

## Checks

```sh
npm run typecheck
npm run build
npx --no-install prettier --check src README.md DESIGN.md package.json tsconfig.json
```

These don't call the providers. Checking real answers, voice quality and screen placement needs a live run.
