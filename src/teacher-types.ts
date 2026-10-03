import type { Lesson } from "./lesson";

export type DisplayChoice = {
  id: number;
  name: string;
};
export type LessonRequest = {
  requestId: number;
  question: string;
  includeScreen: boolean;
  displayId: number;
  mode: "whiteboard" | "screen";
};
export type CourseStatus = { folder: string; files: number } | null;
export type PlannedLesson = {
  turn: number;
  lesson: Lesson;
};
export interface AppBridge {
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
