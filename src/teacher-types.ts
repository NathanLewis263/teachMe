// Keep React's bridge types lined up with the commands exposed by preload.ts.
import type { ContextChoice, RenderChoice } from "./routing";
import type { Lesson } from "./lesson";

export type DisplayChoice = {
  id: number;
  name: string;
};
export type LessonRequest = {
  requestId: number;
  question: string;
  context: ContextChoice | "auto";
  voice?: boolean;
  displayId: number;
  mode: RenderChoice | "auto";
};
export type RoutedLessonRequest = Omit<LessonRequest, "mode" | "context"> & {
  mode: RenderChoice;
  context: ContextChoice;
};
export type CourseStatus = { folder: string; files: number } | null;
export type PlannedLesson = {
  turn: number;
  lesson: Lesson;
};
export interface AppBridge {
  openSource(turn: number, url: string): Promise<void>;
  watch(turn: number, index: number): Promise<void>;
  check(
    turn: number,
    index: number,
    method: "check" | "manual",
    safeScreen: boolean,
  ): Promise<{ complete: boolean; message: string }>;
  browse(turn: number, index: number): Promise<void>;
  boardRegion(
    region: {
      x: number;
      y: number;
      width: number;
      height: number;
      dragging: boolean;
    } | null,
  ): void;
  action(action: string): Promise<void>;
  step(turn: number, index: number): Promise<{ ok: boolean; error?: string }>;
  subscribe(channel: string, callback: (value: any) => void): () => void;
  transcribe(bytes: Uint8Array): Promise<string>;
  petCommand(command: string, value?: unknown): Promise<void>;
  teacherStatus(): Promise<{
    openai: boolean;
    elevenlabs: boolean;
    voice: boolean;
  }>;
  displays(): Promise<DisplayChoice[]>;
  course(action: "status" | "choose" | "remove"): Promise<CourseStatus>;
  plan(request: LessonRequest): Promise<PlannedLesson>;
  speech(
    turn: number,
    step: number,
  ): Promise<{ done: boolean; audio?: Uint8Array }>;
  stopSpeech(turn: number): Promise<void>;
}
