# teachMe design

## Direction

A quiet desktop companion and a readable teaching canvas. The teal-grey seal on a transparent window remains the default; a small bubble above it shows activity and narration. There is no teaching controls or settings pane. Keep interaction minimal and preserve global Control–Shift voice input.

## Visual system

`src/styles.css` owns runtime tokens: paper #f2f6f5, ink #203c40, muted #587074, accent #24675f, line #d5e1df. The blackboard uses #14282f with a quiet dark frame and bright chalk colors from `boardInk` in `lesson.ts`, shared with desktop annotation ink. System sans-serif keeps the desktop feel; 16px board prose with generous line spacing supports reading. Left-align content. Use separators for settings groups and one inset panel for a checkpoint, rather than cards around every field.

## Layout and behavior

`teacher-runtime.tsx` runs recording, playback and checkpoint logic invisibly. Context and drawing stay automatic; display stays under pointer. `pet.tsx` renders a bounded, scrollable status/narration bubble above the seal, with reading Continue and a Check screen retry when needed. The seal does not wander by default. Wander is an opt-in menu toggle and pauses while lesson text is visible. `course-files.tsx` owns the file-only Eat my files window opened from the seal or tray menu. `overlay.tsx` owns the draggable whiteboard, slide navigation and sources; `scene-view.tsx` owns animated diagrams. Board width follows available viewport space, not an assumed permanently open controls panel.

End lesson, Stop & clear, and the bubble close button cancel and clear. The Eat my files window has Done; it does not expose lesson controls. Previous/Next only browse; speech and generation continue. Plain Escape is not mapped; Command/Ctrl–Shift–Escape remains the global stop shortcut.

Keep visible focus, reduced motion, accessible status text and keyboard-operable bubble controls. Credentials and OS permissions remain user-controlled.

## Inspected references

- [Delphi settings](https://mobbin.com/screens/8a7bfb60-8400-4ee9-808e-72488812036c): labelled groups and short supporting text.
- [Chatbase settings](https://mobbin.com/screens/92eac512-7164-453f-ac81-9ee5ac611311): distinct settings navigation and content hierarchy.
- [Uxcel lesson detail](https://mobbin.com/flows/dfc9a583-d2ba-4bc1-a71d-e33a5b73e04c): readable lesson content, progress context and separate references.

These informed hierarchy and behavior; teachMe retains its existing seal and palette.

Screen questions ignore teachMe’s own seal, bubble, board, marks and windows unless the current question explicitly asks about them. This is a model context instruction, not screenshot redaction. The board has no slide-browsing explanatory hint.
