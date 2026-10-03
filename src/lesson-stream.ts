// Turn partial model text into valid steps; a network chunk is not a whole teaching step.
import { type Lesson, type LessonStep } from "./lesson";
import { normalizeStep, segmentIssue } from "./segment-validation";
import type { RoutedLessonRequest } from "./teacher-types";

export class LessonStream {
  private buffer = "";
  private size = 0;
  private ended = false;
  private header: Omit<Lesson, "steps"> | undefined;
  // Quizzes that arrive after an explanation wait here so they always come last.
  private quizzes: LessonStep[] = [];
  lesson: Lesson | undefined;
  constructor(
    private mode: RoutedLessonRequest["mode"],
    private visual: boolean,
  ) {}

  push(text: string): Lesson[] {
    this.size += text.length;
    if (this.size > 180_000) throw new Error("Lesson stream is too large.");
    // A network chunk can stop halfway through JSON; keep the unfinished line.
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
          !["notes", "scene", "flow", "drawing", "voice"].includes(
            record.kind,
          ) ||
          (this.mode === "none"
            ? record.kind !== "voice"
            : this.mode === "screen"
              ? record.kind !== "drawing"
              : this.mode === "whiteboard" &&
                ["drawing", "voice"].includes(record.kind)) ||
          (this.visual && record.kind === "notes")
        )
          throw new Error(
            "This request needs a visual lesson, not text-only notes.",
          );
        this.header = {
          kind: record.kind,
          rendering: this.mode,
          title: record.title,
          color: record.color,
        };
      } else if (record.type === "end") {
        for (const step of this.quizzes.splice(0))
          lessons.push(this.commit(step));
        if (!this.lesson)
          throw new Error("The lesson had no teaching segments.");
        this.ended = true;
      } else {
        if (record.type !== "step")
          throw new Error("Invalid teaching segment.");
        record.step = normalizeStep(record.step);
        const explained = this.lesson?.steps.some((step) => !step.quiz);
        if (record.step?.quiz && !record.step.action && explained) {
          // Check it now so a broken quiz still fails at its own position.
          this.check([...this.lesson!.steps, ...this.quizzes, record.step]);
          this.quizzes.push(record.step);
          continue;
        }
        // An action ends this page, so held quizzes go out before it rather than being lost.
        if (record.step?.action)
          for (const step of this.quizzes.splice(0))
            lessons.push(this.commit(step));
        lessons.push(this.commit(record.step));
        // Later pages need a new screenshot after this action finishes.
        if (record.step.action) {
          this.ended = true;
          this.buffer = "";
          return lessons;
        }
      }
    }
    if (this.buffer.length > 40_000)
      throw new Error("Teaching segment is too large.");
    return lessons;
  }
  private check(steps: LessonStep[]) {
    const lesson: Lesson = { ...this.header!, steps };
    const issue = segmentIssue(lesson);
    if (issue)
      throw new Error(
        `Teaching segment ${steps.length}: ${issue}.${this.lesson ? " Earlier valid parts remain available." : ""}`,
      );
    if (
      (this.mode === "screen" || this.mode === "both") &&
      steps.at(-1)?.annotations?.some((a) => a.motion)
    )
      throw new Error("Screen annotations must be static.");
    return lesson;
  }
  private commit(step: LessonStep) {
    this.lesson = this.check([...(this.lesson?.steps || []), step]);
    return this.lesson;
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

export const requestsQuiz = (question: string) =>
  /\b(?:quiz(?:zes)?|test me|test my (?:knowledge|understanding))\b/i.test(
    question,
  );
export const requestsVisual = (question: string) =>
  /\b(draw|diagram|illustrat\w*|visuali[sz]\w*|sketch|anatom\w*|flow\s?chart|map)\b/i.test(
    question,
  );
