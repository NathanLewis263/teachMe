// Check provider JSON before showing it; TypeScript types alone cannot make it safe to draw.
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
    lesson.rendering !== "both" &&
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
    lesson.kind === "flow" &&
    (step.heading || step.body || step.formula || step.table)
  )
    return `${lesson.kind} steps contain text fields this view cannot display`;
  if (
    lesson.kind === "voice" &&
    Object.keys(step).some((key) => key !== "say" && key !== "action")
  )
    return "spoken replies contain only say";
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
  const scene = step.scene as { nodes?: unknown } | undefined;
  if (scene && typeof scene === "object" && Array.isArray(scene.nodes))
    step.scene = {
      ...scene,
      nodes: scene.nodes.map((n) => repairShape(n, 40)),
    };
  if (Array.isArray(step.annotations))
    step.annotations = step.annotations.map((n) => repairShape(n, 80));
  return step;
}

const kindAliases: Record<string, string> = {
  rect: "highlight",
  rectangle: "highlight",
  box: "highlight",
  square: "highlight",
  circle: "ellipse",
  oval: "ellipse",
};
const pointCounts: Record<number, string> = { 2: "L", 4: "Q", 6: "C" };
const clamp = (n: number) => Math.min(1, Math.max(0, n));

// Fix small, unambiguous slips in model geometry; anything else still fails validation.
function repairShape(value: unknown, labelLimit: number): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const shape = { ...value } as Record<string, unknown>;
  const numbers = ["x", "y", "width", "height"].map((k) => shape[k]);
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n)))
    return value;
  if (typeof shape.kind === "string") {
    const kind = shape.kind.toLowerCase();
    shape.kind = kindAliases[kind] ?? kind;
  }
  // Keep the box on the board by shrinking it rather than moving it.
  const x = clamp(shape.x as number),
    y = clamp(shape.y as number);
  shape.x = x;
  shape.y = y;
  shape.width = Math.min(clamp(shape.width as number), 1 - x);
  shape.height = Math.min(clamp(shape.height as number), 1 - y);
  if (shape.color === null) delete shape.color;
  if (shape.motion === null) delete shape.motion;
  // Shorten motion that would carry the shape off the board.
  const motion = shape.motion as Record<string, unknown> | undefined;
  if (
    motion &&
    typeof motion === "object" &&
    typeof motion.dx === "number" &&
    typeof motion.dy === "number"
  )
    shape.motion = {
      ...motion,
      dx: Math.min(1 - x - (shape.width as number), Math.max(-x, motion.dx)),
      dy: Math.min(1 - y - (shape.height as number), Math.max(-y, motion.dy)),
    };
  if (typeof shape.label === "string" && shape.label.length > labelLimit)
    shape.label = shape.label.slice(0, labelLimit - 1) + "…";
  if (shape.kind === "path" && Array.isArray(shape.commands)) {
    const commands = shape.commands
      .map((entry: unknown) => {
        if (!entry || typeof entry !== "object") return entry;
        const command = { ...(entry as Record<string, unknown>) };
        if (typeof command.command === "string")
          command.command = command.command.toUpperCase();
        if (command.command === "Z") return { command: "Z", points: [] };
        if (
          !Array.isArray(command.points) ||
          !command.points.every(
            (n) => typeof n === "number" && Number.isFinite(n),
          )
        )
          return command;
        const points = (command.points as number[]).map(clamp);
        // A point count that fits a different command is a mislabeled command.
        if (command.command !== "M" && pointCounts[points.length])
          command.command = pointCounts[points.length];
        return { ...command, points };
      })
      .filter(
        (entry: unknown) =>
          !!entry &&
          typeof entry === "object" &&
          (entry as { command?: unknown }).command !== undefined,
      );
    // A path must start by moving to its first point.
    const first = commands[0] as
      { command?: string; points?: number[] } | undefined;
    if (first && first.command !== "M" && first.points?.length)
      commands[0] = {
        command: "M",
        points: first.points.slice(-2),
      };
    shape.commands = commands;
  }
  return shape;
}
