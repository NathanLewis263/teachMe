// Keep React's bridge types lined up with the commands exposed by preload.ts.
import type { ContextChoice, RenderChoice } from "./routing";
import type { Lesson } from "./lesson";

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
export type CourseStatus = {
  folder: string;
  files: number;
  bytes: number;
  updated: number;
  failed: number;
  skipped: { reason: string; count: number }[];
} | null;
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
  ): Promise<{ complete: boolean; message: string }>;
  browse(turn: number, index: number): Promise<void>;
  quizContinue(turn: number, index: number): Promise<void>;
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
  course(
    action: "status" | "choose" | "rescan" | "remove",
  ): Promise<CourseStatus>;
  confirm(turn: number, index: number): Promise<boolean>;
  plan(request: LessonRequest): Promise<PlannedLesson>;
  speech(
    turn: number,
    step: number,
  ): Promise<{ done: boolean; audio?: Uint8Array }>;
  stopSpeech(turn: number): Promise<void>;
}

export type PetBubble = {
  operation: number;
  step: number;
  status: string;
  error?: string;
  text: string;
  waiting: boolean;
  checking: boolean;
  checkpoint?: import("./action-checkpoint").ActionCheckpoint;
  sources: NonNullable<Lesson["sources"]>;
  researchUnavailable?: boolean;
  // Steps received so far; the count grows while the lesson generates.
  total: number;
  paused: boolean;
  // Earlier guided actions in this lesson, oldest first.
  done: string[];
};
