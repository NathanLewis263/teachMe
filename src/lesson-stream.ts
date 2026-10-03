import { type Lesson } from "./lesson";
import { normalizeStep, segmentIssue } from "./segment-validation";
import type { LessonRequest } from "./teacher-types";

// Only complete JSON lines can become visible or spoken.
export class LessonStream {
  private buffer = "";
  private size = 0;
  private ended = false;
  private header: Omit<Lesson, "steps"> | undefined;
  lesson: Lesson | undefined;
  constructor(
    private mode: LessonRequest["mode"],
    private visual: boolean,
  ) {}

  push(text: string): Lesson[] {
    this.size += text.length;
    if (this.size > 180_000) throw new Error("Lesson stream is too large.");
    this.buffer += text;
    const lessons: Lesson[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (!line) continue;
      if (line.length > 40_000 || this.ended)
        throw new Error("Invalid lesson stream.");
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw new Error(
          "The lesson stream contained incomplete or invalid JSON. Earlier validated parts remain available.",
        );
      }
      if (!record || typeof record !== "object")
        throw new Error("Invalid segment.");
      if (!this.header) {
        if (
          record.type !== "lesson" ||
          typeof record.title !== "string" ||
          !record.title.trim() ||
          record.title.length > 80 ||
          !["notes", "scene", "flow", "drawing"].includes(record.kind) ||
          (this.mode === "screen"
            ? record.kind !== "drawing"
            : record.kind === "drawing") ||
          (this.visual && record.kind === "notes")
        )
          throw new Error(
            "This request needs a visual lesson, not text-only notes.",
          );
        this.header = {
          kind: record.kind,
          title: record.title,
          color: record.color,
        };
      } else if (record.type === "end") {
        if (!this.lesson)
          throw new Error("The lesson had no teaching segments.");
        this.ended = true;
      } else {
        if (record.type !== "step")
          throw new Error("Invalid teaching segment.");
        record.step = normalizeStep(record.step);
        const lesson: Lesson = {
          ...this.header,
          steps: [...(this.lesson?.steps || []), record.step],
        };
        const issue = segmentIssue(lesson);
        if (issue)
          throw new Error(
            `Teaching segment ${lesson.steps.length}: ${issue}. Earlier valid parts remain available.`,
          );
        if (
          this.mode === "screen" &&
          record.step.annotations?.some((a: { motion?: unknown }) => a.motion)
        )
          throw new Error("Screen annotations must be static.");
        this.lesson = lesson;
        lessons.push(lesson);
      }
    }
    if (this.buffer.length > 40_000)
      throw new Error("Teaching segment is too large.");
    return lessons;
  }
  finish() {
    const last = this.push("\n");
    if (!this.ended || !this.lesson)
      throw new Error(
        "The lesson ended early. Earlier validated parts are still available.",
      );
    return last;
  }
}

export const requestsVisual = (question: string) =>
  /\b(draw|diagram|illustrat\w*|visuali[sz]\w*|sketch|anatom\w*|flow\s?chart|map)\b/i.test(
    question,
  );
