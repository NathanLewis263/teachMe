# teachMe

Original local Electron teaching overlay with a React renderer and locally compiled Tailwind CSS. No Hey Clicky code or assets are used.

## Run

Use Node.js and npm. On this Mac, add `/usr/local/bin` to PATH if needed.

```sh
cd ~/Desktop/teachMe
npm ci
npm start
```

## Realtime teacher

Create `.env` in this folder, using `.env.example` as a guide:

```dotenv
OPENAI_API_KEY=your-key
OPENAI_REALTIME_MODEL=gpt-realtime-2.1
OPENAI_REALTIME_VOICE=marin
```

Restart the app after editing configuration. `.env` is ignored by Git. The main process reads the key and negotiates a WebRTC session through OpenAI's `/v1/realtime/calls` endpoint. Credentials never enter the React renderer. An API project with model access and API billing is required.

Type a question or click **Try a pendulum explanation** to get spoken teaching and a diagram. Typed questions do not request microphone permission. Hold the talk button, wait for **Listening**, speak, then release. Space also works while the control panel is focused outside editable fields. macOS microphone permission is still required for voice input.

**Include my primary screen** sends one screenshot to OpenAI with each question. It starts off, so original diagrams need no screen capture. macOS Screen Recording permission is required when enabled. There is no additional consent dialog. The screenshot can include other visible apps and the teachMe panel. The app does not watch scrolling or later edits; ask again for a fresh screenshot.

The model calls `teach_lesson` with short spoken steps. Each stage appears on the Realtime `output_audio_buffer.started` event, and the app waits for both response completion and `output_audio_buffer.stopped` before requesting the next narration. This synchronizes teaching stages with playback, not individual words. Earlier stages stay visible.

Lessons support connected pendulum diagrams with continuous small-angle motion, automatically laid-out process flows, and general SVG drawings. Pendulum motion is an ideal illustration without damping. Shapes can use mint, blue, amber, coral, violet or white. Within a drawing lesson, later steps can reuse a shape ID to edit its geometry, color or back-and-forth translation, or remove it by ID. The app validates bounds, colors, paths and motion endpoints. SVG content stays structured; no raw markup or scripts are executed. Text renders in display coordinates, with label collision avoidance.

Screen images are encoded as JPEG and resized as needed to fit the negotiated WebRTC message-size limit, including base64 and JSON overhead. A final UTF-8 size check runs before every send. Compression can reduce readability of tiny text; show the relevant content at a readable size. **Stop & clear** or Escape closes the voice connection, stops microphone tracks and playback, and rejects late drawing calls. Starting a new question during an answer interrupts the previous session; completed conversations can continue in the same session.

Expand **Drawing previews** to try the existing arrow, rectangle highlight, ellipse, line, triangle, star and curve without an API request. Their strokes animate over 850ms. Reduced-motion preferences show completed shapes immediately. Closing the panel exits the app. The overlay ignores mouse input so the student can keep using their own apps. Drawing does not click, type or run commands.

## Current scope

Electron owns two windows, a React control panel and a transparent SVG overlay. Both use isolated, sandboxed preload bridges and have no Node access. Main-process IPC validates the control sender and frame. The model only receives a drawing tool.

The overlay and capture target the primary display. Display bounds refresh at the start of each question. Moving or changing displays mid-explanation is not supported. Global hold shortcuts, uploaded unit documents, source citations, live documentation lookup and selectable teacher characters remain future work. The interfaces in `contracts.ts` retain a place for future unit retrieval.

## Checks

```sh
npm run typecheck
npm run build
```

For a live check, start the app, leave screen sharing off and ask the pendulum example. Verify speech, a diagram outside the panel and Stop & clear. Then test hold/release with microphone permission. Check capture separately using non-sensitive sample material. Live questions use your OpenAI API account.

## Custom SVG paths

Providers can return `kind: "path"` annotations with a `commands` array. Supported commands are `M`, `L`, `Q`, `C`, and `Z`, each with a `points` array of 2, 2, 4, 6, or 0 numbers respectively. Start with `M`. Coordinates and control points are normalized between 0 and 1 within the annotation's `x`, `y`, `width`, and `height` box. Paths are limited to 256 commands and use the same stroke animation as presets. Raw SVG file import is not implemented.

Original subject diagrams now use a shared scene board: stable named shapes, attached arrows, smooth position edits, coordinated translation, pulse and wave effects. Screen annotations remain a separate option for marking a supplied reference. Lessons can have up to 12 stages per section; use **Continue this topic** after completion for another section, or ask to focus on a named structure. Detailed biology uses schematic explanations unless a labeled reference is supplied. The app does not include an anatomy atlas or course-file retrieval.
