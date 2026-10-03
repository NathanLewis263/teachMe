// Remember the display at key-down, then consume it once so the next question starts fresh.
let heldDisplay: { id: number; at: number } | undefined;
export function latchDisplay(id: number) {
  heldDisplay = { id, at: Date.now() };
}
export function clearDisplay() {
  heldDisplay = undefined;
}
export function takeDisplay() {
  const held = heldDisplay;
  clearDisplay();
  return held && Date.now() - held.at < 90_000 ? held.id : undefined;
}
let screenOnce = false;
let invalidator:
  | ((
      point?: { x: number; y: number },
      kind?: "scroll" | "switch" | "typing",
    ) => void)
  | undefined;
export function useScreenOnce(value?: boolean) {
  if (value !== undefined) screenOnce = value;
  return screenOnce;
}
export function takeScreenOverride() {
  const value = screenOnce;
  screenOnce = false;
  return value;
}
export function onScreenInput(callback: typeof invalidator) {
  invalidator = callback;
}
export function screenInput(
  point?: { x: number; y: number },
  kind?: "scroll" | "switch" | "typing",
) {
  invalidator?.(point, kind);
}

let inputGuardRunning = false;
export function setInputGuardRunning(value: boolean) {
  inputGuardRunning = value;
}
export function hasInputGuard() {
  return inputGuardRunning;
}
