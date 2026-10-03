# UI notes

The seal is the default view. Keep the question form and settings in Teaching controls so they don't take over the desktop. Closing the controls hides them.

Use the teal-grey seal on a transparent window, a light background for controls and a dark whiteboard. The seal reacts to microphone level and changes colour with its current state. Keep reduced motion and keyboard focus styles working.

The whiteboard title bar is draggable. Its slide buttons change the visible page without interrupting speech or generation. Let clicks outside the board and seal reach the student's apps.

`src/styles.css` owns the colours and layout. `teacher-controls.tsx` handles questions, status and playback. `overlay.tsx` displays lessons, and `scene-view.tsx` draws the animated diagrams.
