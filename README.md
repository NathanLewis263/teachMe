# teachMe

Original local Electron teaching overlay with a React renderer and locally compiled Tailwind CSS. No Hey Clicky code or assets are used.

## Run

Use Node.js and npm. On this Mac, add `/usr/local/bin` to PATH if needed.

```sh
cd ~/Desktop/teachMe
npm ci
npm start
```

Hold Space while the control panel has focus, or hold its button, then release to draw a mock arrow toward the center of the primary display. Draw highlight replaces it with a rectangle. Dismiss or Escape clears it. Closing the panel exits the app. The overlay ignores mouse input so the student can keep using their own apps.

## Current scope

All teaching responses are local mocks. No microphone, screen capture, speech playback, uploaded files or external model calls run. The unit and teacher menus are placeholders. Space is panel-local; a global hold shortcut needs a later native key handler. The overlay uses the primary display and Electron logical coordinates, independent of Retina pixel scaling. Display changes and multiple-display targeting remain future work.

`contracts.ts` defines teaching, voice and unit retrieval interfaces. A future capture adapter must request permission only after an explicit student action, report denial without retry loops, and pass a single capture to the selected provider only after consent. Current Electron permission requests are denied. Do not put provider credentials in the renderer.

The main process owns windows and validates the control sender, frame and action enum. The isolated sandboxed preload exposes actions and three event subscriptions. The renderer has no Node access. Annotation coordinates are normalized and checked before drawing. New provider output must pass the same validation.

## Checks

```sh
npm run typecheck
npm run build
npm test
npm audit
```

Contract tests cover rejected IPC actions and out-of-bounds annotations. macOS visual verification should cover hold/release, arrow positioning, highlight replacement, dismissal and repeat drawing. No automatic permissions are accepted.
