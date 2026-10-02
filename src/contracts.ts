export type Phase = "idle" | "listening" | "explaining";
export type Annotation = {
  kind: "arrow" | "highlight";
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
): value is "press" | "release" | "clear" | "highlight" {
  return (
    typeof value === "string" &&
    ["press", "release", "clear", "highlight"].includes(value)
  );
}
// Reject coordinates that would draw outside the selected display.
export function validAnnotation(value: unknown): value is Annotation {
  if (!value || typeof value !== 'object') return false;
  const a = value as Annotation;
  return (
    ["arrow", "highlight"].includes(a.kind) &&
    [a.x, a.y, a.width, a.height].every(
      (n) => Number.isFinite(n) && n >= 0 && n <= 1,
    ) &&
    a.x + a.width <= 1 &&
    a.y + a.height <= 1
  );
}
