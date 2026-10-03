export type Phase = "idle" | "listening" | "explaining";
export const shapeKinds = ["arrow", "highlight", "ellipse", "line", "triangle", "star", "curve"] as const;
export type ShapeKind = typeof shapeKinds[number];
// Custom SVG path coordinates use a local 0..1 box. Commands stay structured
// so provider data never becomes raw SVG markup.
export type PathCommand =
  | { command: "M" | "L"; points: [number, number] }
  | { command: "Q"; points: [number, number, number, number] }
  | { command: "C"; points: [number, number, number, number, number, number] }
  | { command: "Z"; points: [] };
export type Annotation = {
  kind: ShapeKind | "path";
  commands?: PathCommand[];
  label?: string;
  id?: string;
  color?: "mint" | "blue" | "amber" | "coral" | "violet" | "white";
  motion?: { dx: number; dy: number; durationMs: number };
  x: number;
  y: number;
  width: number;
  height: number;
};
// Provider contracts stay independent of Electron and the renderer.
export interface TeachingRequest {
  question: string;
  unitId: string;
  screen?: { png: Uint8Array; width: number; height: number };
}
export interface TeachingResponse {
  explanation: string;
  annotations: Annotation[];
}
export interface TeachingProvider {
  explain(request: TeachingRequest): Promise<TeachingResponse>;
}
export interface VoiceProvider {
  transcribe(audio: Uint8Array): Promise<string>;
  speak(text: string): Promise<void>;
}
export interface UnitRetrieval {
  retrieve(
    unitId: string,
    query: string,
  ): Promise<{ text: string; source: string }[]>;
}
export function isAction(
  value: unknown,
): value is "press" | "release" | "clear" | ShapeKind {
  return (
    typeof value === "string" &&
    ["press", "release", "clear", ...shapeKinds].includes(value)
  );
}
// Reject coordinates that would draw outside the selected display.
export function validAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Annotation;
  return (
    (a.id === undefined || (typeof a.id === "string" && a.id.length > 0 && a.id.length <= 40)) &&
    (a.color === undefined || ["mint", "blue", "amber", "coral", "violet", "white"].includes(a.color)) &&
    (a.motion === undefined || (a.motion !== null && typeof a.motion === "object" &&
      Number.isFinite(a.motion.dx) && Number.isFinite(a.motion.dy) &&
      Number.isFinite(a.motion.durationMs) && a.motion.durationMs >= 500 && a.motion.durationMs <= 10000 &&
      a.x + a.motion.dx >= 0 && a.y + a.motion.dy >= 0 &&
      a.x + a.width + a.motion.dx <= 1 && a.y + a.height + a.motion.dy <= 1)) &&
    (a.label === undefined || (typeof a.label === "string" && a.label.length <= 80)) &&
    (shapeKinds.includes(a.kind as ShapeKind) ||
      (a.kind === "path" && validCommands(a.commands))) &&
    [a.x, a.y, a.width, a.height].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    ) &&
    a.x + a.width <= 1 &&
    a.y + a.height <= 1
  );
}

function validCommands(value: unknown): value is PathCommand[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 256) return false;
  if (value[0]?.command !== "M") return false;
  const counts: Record<string, number> = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
  return value.every((entry) => entry &&
    Object.hasOwn(counts, entry.command) &&
    Array.isArray(entry.points) && entry.points.length === counts[entry.command] &&
    entry.points.every((n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1));
}
