// Share lesson data across main and React; visible frames stay separate from generated steps.
import type { WebSource } from "./web-research";
import { validCheckpoint, type ActionCheckpoint } from "./action-checkpoint";
import { validAnnotation, type Annotation } from "./contracts";
import {
  MAX_STEPS,
  applyScene,
  sceneIsCoherent,
  validSceneEdit,
  type Scene,
  type SceneEdit,
} from "./scene";

export const ink = {
  mint: "#83e8cb",
  blue: "#7cbbff",
  amber: "#ffd080",
  coral: "#ff9b91",
  violet: "#c2adff",
  white: "#f1f5f4",
} as const;
// Desktop annotations keep the bright colors; the white board uses darker matching inks.
export const boardInk: Record<Ink, string> = {
  mint: "#1d7f68",
  blue: "#2f68c4",
  amber: "#a8670f",
  coral: "#c2463a",
  violet: "#6d4fc9",
  white: "#203c40",
};
export type Ink = keyof typeof ink;
export type LessonTable = { columns: string[]; rows: string[][] };
export type LessonStep = {
  say: string;
  action?: ActionCheckpoint;
  heading?: string;
  body?: string;
  formula?: string;
  table?: LessonTable;
  scene?: SceneEdit;
  label?: string;
  detail?: string;
  annotations?: Annotation[];
  removeIds?: string[];
};
export type Lesson = {
  kind: "flow" | "drawing" | "notes" | "scene" | "voice";
  rendering?: "none" | "whiteboard" | "screen" | "both";
  title: string;
  sources?: WebSource[];
  researchStatus?: "not-needed" | "verified" | "unavailable";
  color?: Ink;
  steps: LessonStep[];
};
export type LessonFrame = {
  turn: number;
  lesson: Lesson;
  step: number;
  // The step being narrated; step can differ while the learner browses.
  live?: number;
  annotations: Annotation[];
  viewport?: { x: number; y: number; width: number; height: number };
};
const short = (value: unknown, max: number) =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
export function validTable(value: unknown): value is LessonTable {
  if (!value || typeof value !== "object") return false;
  const table = value as LessonTable;
  return (
    Array.isArray(table.columns) &&
    table.columns.length >= 2 &&
    table.columns.length <= 6 &&
    table.columns.every((column) => short(column, 60)) &&
    Array.isArray(table.rows) &&
    table.rows.length >= 1 &&
    table.rows.length <= 8 &&
    table.rows.every(
      (row) =>
        Array.isArray(row) &&
        row.length === table.columns.length &&
        row.every((cell) => short(cell, 100)),
    )
  );
}
export function validLesson(value: unknown): value is Lesson {
  if (!value || typeof value !== "object") return false;
  const a = value as Lesson;
  let scene: Scene = { nodes: [], links: [] };
  return (
    ["flow", "drawing", "notes", "scene", "voice"].includes(a.kind) &&
    short(a.title, 80) &&
    (a.color === undefined || Object.hasOwn(ink, a.color)) &&
    Array.isArray(a.steps) &&
    a.steps.length >= 1 &&
    a.steps.length <= MAX_STEPS &&
    a.steps.every(
      (step) =>
        step &&
        short(step.say, 1000) &&
        (step.action === undefined || validCheckpoint(step.action)) &&
        (step.heading === undefined || short(step.heading, 80)) &&
        (step.body === undefined || short(step.body, 700)) &&
        (step.formula === undefined || short(step.formula, 240)) &&
        (step.table === undefined || validTable(step.table)) &&
        (step.scene === undefined ||
          (a.kind === "scene" && validSceneEdit(step.scene))) &&
        (a.kind === "drawing" ||
          a.rendering === "both" ||
          (!step.annotations?.length && !step.removeIds?.length)) &&
        (a.kind === "flow" ||
          (step.label === undefined && step.detail === undefined)) &&
        (a.kind !== "scene" || (!step.formula && !step.table)) &&
        (a.kind !== "notes" || !!(step.body || step.formula || step.table)) &&
        (a.kind !== "flow" ||
          (!step.body && !step.formula && !step.table && !step.heading)) &&
        (a.kind !== "flow" ||
          (short(step.label, 32) &&
            (step.detail === undefined || short(step.detail, 65)))) &&
        (step.annotations === undefined ||
          (Array.isArray(step.annotations) &&
            step.annotations.length <= 16 &&
            step.annotations.every(validAnnotation))) &&
        (step.removeIds === undefined ||
          (Array.isArray(step.removeIds) &&
            step.removeIds.length <= 32 &&
            step.removeIds.every((id) => short(id, 40)))),
    ) &&
    (a.kind !== "scene" ||
      a.steps.every((step) => {
        if (step.scene) {
          scene = applyScene(scene, step.scene);
          const ids = new Set(scene.nodes.map((n) => n.id));
          if (
            step.scene.links?.some(
              (l) => !ids.has(l.from) || (l.to && !ids.has(l.to)),
            )
          )
            return false;
        }
        return sceneIsCoherent(scene);
      }))
  );
}

// A later step can update a shape by using the same ID.
export function applyDrawingStep(
  previous: Annotation[],
  step: LessonStep,
): Annotation[] {
  const removed = new Set(step.removeIds || []);
  const next = previous.filter((item) => !item.id || !removed.has(item.id));
  for (const annotation of step.annotations || []) {
    const index = annotation.id
      ? next.findIndex((item) => item.id === annotation.id)
      : -1;
    if (index >= 0) next[index] = annotation;
    else next.push(annotation);
  }
  return next.slice(-32);
}
