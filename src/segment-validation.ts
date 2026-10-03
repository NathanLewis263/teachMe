// Check provider JSON before showing it; TypeScript types alone cannot make it safe to draw.
import { validAnnotation, type Annotation } from "./contracts";
import {
  validLesson,
  validQuiz,
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
  if (step.quiz !== undefined) {
    if (step.action !== undefined)
      return "quiz and action checkpoints need separate segments";
    if (lesson.kind !== "scene" && lesson.kind !== "notes")
      return "quiz belongs only to scene or notes lessons";
    if (!validQuiz(step.quiz))
      return "quiz needs a question and 3–4 options with exactly one correct, each with a why";
  }
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
  if (
    lesson.kind === "notes" &&
    !(step.body || step.formula || step.table || step.quiz)
  )
    return "notes need visible body, formula, table or quiz content";
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
    "quiz",
    "scene",
    "annotations",
    "removeIds",
  ])
    if (step[field] === null || step[field] === "") delete step[field];
  const scene = step.scene as { nodes?: unknown; links?: unknown } | undefined;
  if (scene && typeof scene === "object" && Array.isArray(scene.nodes)) {
    const repaired = scene.nodes.map((node) => repairShape(node, 40));
    const nodes = keepDrawable(repaired);
    // Drop this step's links to any shape that was just dropped.
    const dropped = new Set(
      repaired
        .filter((node) => !nodes.includes(node))
        .map((n) => (n as { id?: unknown })?.id),
    );
    step.scene = {
      ...scene,
      nodes,
      ...(Array.isArray(scene.links)
        ? {
            links: scene.links.filter(
              (l: { from?: unknown; to?: unknown }) =>
                !dropped.has(l?.from) && !(l?.to && dropped.has(l.to)),
            ),
          }
        : {}),
    };
  }
  if (Array.isArray(step.annotations))
    step.annotations = keepDrawable(
      step.annotations.map((n) => repairShape(n, 80)),
    );
  if (step.quiz) step.quiz = repairQuiz(step.quiz);
  return step;
}

const clip = (value: unknown, limit: number) =>
  typeof value === "string" && value.length > limit
    ? value.slice(0, limit - 1).trimEnd() + "…"
    : value;
// Fix quiz slips with one clear repair: overlong text, or extra options beside a single correct one.
// Anything else, such as two correct answers, still fails validation.
function repairQuiz(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const quiz = { ...value } as Record<string, unknown>;
  quiz.question = clip(quiz.question, 200);
  if (!Array.isArray(quiz.options)) return quiz;
  let options = quiz.options.map((entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? {
          ...entry,
          text: clip((entry as Record<string, unknown>).text, 100),
          why: clip((entry as Record<string, unknown>).why, 240),
        }
      : entry,
  );
  const correct = options.findIndex(
    (entry) => (entry as { correct?: unknown })?.correct === true,
  );
  // Only trim when the answer is unambiguous; never hide a second correct option.
  const correctCount = options.filter(
    (entry) => (entry as { correct?: unknown })?.correct === true,
  ).length;
  if (options.length > 4 && correctCount === 1)
    options = options.filter(
      (_, index) => index === correct || index < (correct < 3 ? 4 : 3),
    );
  quiz.options = options;
  return quiz;
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
// Map common color names onto the six inks.
const colorAliases: Record<string, Annotation["color"]> = {
  green: "mint",
  teal: "mint",
  cyan: "blue",
  navy: "blue",
  yellow: "amber",
  orange: "amber",
  gold: "amber",
  red: "coral",
  pink: "coral",
  purple: "violet",
  black: "white",
  gray: "white",
  grey: "white",
};
const inks = ["mint", "blue", "amber", "coral", "violet", "white"];
// Keep usable shapes, but let validation reject a step with no usable shapes.
function keepDrawable(shapes: unknown[]) {
  const kept = shapes.filter(validAnnotation);
  return kept.length ? kept : shapes;
}

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
  if (typeof shape.color === "string") {
    const color = shape.color.toLowerCase();
    shape.color = inks.includes(color) ? color : colorAliases[color];
  }
  if (shape.color === null || shape.color === undefined) delete shape.color;
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
      durationMs: Math.min(
        10000,
        Math.max(
          500,
          typeof motion.durationMs === "number" &&
            Number.isFinite(motion.durationMs)
            ? motion.durationMs
            : 1500,
        ),
      ),
    };
  // Motion the repair cannot read is dropped; the shape stays still.
  else if (shape.motion !== undefined) delete shape.motion;
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
