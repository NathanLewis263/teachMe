import { validAnnotation } from "./contracts";
import {
  validLesson,
  validTable,
  type Lesson,
  type LessonStep,
} from "./lesson";
import { MAX_STEPS, validSceneEdit } from "./scene";

export function segmentIssue(lesson: Lesson): string | undefined {
  const step = lesson.steps.at(-1);
  if (!step || typeof step !== "object") return "step must be an object";
  if (lesson.steps.length > MAX_STEPS) return "the lesson exceeds 12 segments";
  if (
    typeof step.say !== "string" ||
    !step.say.trim() ||
    step.say.length > 1000
  )
    return "say must contain 1–1000 characters";
  for (const [field, limit] of Object.entries({
    heading: 80,
    body: 700,
    formula: 240,
    label: 32,
    detail: 65,
  })) {
    const value = step[field as keyof LessonStep];
    if (
      value !== undefined &&
      (typeof value !== "string" || !value.trim() || value.length > limit)
    )
      return `${field} must contain 1–${limit} characters`;
  }
  if (step.table !== undefined && !validTable(step.table))
    return "table columns and rows do not match";
  if (step.scene !== undefined) {
    if (lesson.kind !== "scene")
      return "scene geometry requires a scene lesson";
    if (!validSceneEdit(step.scene as unknown)) {
      if (Array.isArray(step.scene?.nodes)) {
        const index = step.scene.nodes.findIndex((n) => !validAnnotation(n));
        if (index >= 0)
          return `scene.nodes[${index}] has an invalid shape, path, color, coordinate or motion`;
      }
      return "scene contains invalid IDs, links or object fields";
    }
  }
  if (
    step.annotations !== undefined &&
    (!Array.isArray(step.annotations) ||
      !step.annotations.every(validAnnotation))
  )
    return "annotations contain invalid shapes or coordinates";
  if (
    lesson.kind !== "drawing" &&
    (step.annotations?.length || step.removeIds?.length)
  )
    return "desktop annotations require a drawing lesson";
  if (lesson.kind === "scene" && (step.formula || step.table))
    return "scene pages cannot display formulas or tables";
  if (
    lesson.kind !== "flow" &&
    (step.label !== undefined || step.detail !== undefined)
  )
    return "label/detail belong to flow steps; use heading/body for scene captions";
  if (lesson.kind === "notes" && !(step.body || step.formula || step.table))
    return "notes need visible body, formula or table content";
  if (lesson.kind === "flow" && !step.label) return "flow steps need a label";
  if (
    (lesson.kind === "flow" || lesson.kind === "drawing") &&
    (step.heading || step.body || step.formula || step.table)
  )
    return `${lesson.kind} steps contain text fields this view cannot display`;
  if (!validLesson(lesson as unknown))
    return lesson.kind === "scene"
      ? "scene must have visible nodes, connected links and consistent in-bounds motion"
      : "lesson fields or visible content do not match the selected view";
}

export function normalizeStep(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const step = { ...value } as Record<string, unknown>;
  // Empty optional fields carry no content; do not discard geometry or narration.
  for (const field of [
    "heading",
    "body",
    "formula",
    "label",
    "detail",
    "table",
    "scene",
    "annotations",
    "removeIds",
  ])
    if (step[field] === null || step[field] === "") delete step[field];
  return step;
}
