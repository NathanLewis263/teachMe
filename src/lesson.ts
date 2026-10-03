import { validAnnotation, type Annotation } from "./contracts";
import { MAX_STEPS, applyScene, sceneIsCoherent, validSceneEdit, type Scene, type SceneEdit } from './scene';

export const ink = { mint: "#83e8cb", blue: "#7cbbff", amber: "#ffd080", coral: "#ff9b91", violet: "#c2adff", white: "#f1f5f4" } as const;
export type Ink = keyof typeof ink;
export type LessonTable = { columns: string[]; rows: string[][] };
export type LessonStep = {
  say: string;
  heading?: string;
  body?: string;
  formula?: string;
  table?: LessonTable;
  scene?: SceneEdit;
  focus?: "support" | "bob" | "swing" | "gravity" | "energy";
  label?: string;
  detail?: string;
  annotations?: Annotation[];
  removeIds?: string[];
};
export type Lesson = {
  kind: "pendulum" | "flow" | "drawing" | "notes" | "scene";
  title: string;
  color?: Ink;
  lengthMeters?: number;
  amplitudeDegrees?: number;
  steps: LessonStep[];
};
export type LessonFrame = { lesson: Lesson; step: number; annotations: Annotation[] };
const short = (value: unknown, max: number) => typeof value === "string" && value.trim().length > 0 && value.length <= max;
export function validTable(value: unknown): value is LessonTable {
  if (!value || typeof value !== "object") return false;
  const table = value as LessonTable;
  return Array.isArray(table.columns) && table.columns.length >= 2 && table.columns.length <= 6 &&
    table.columns.every(column => short(column, 60)) && Array.isArray(table.rows) &&
    table.rows.length >= 1 && table.rows.length <= 8 && table.rows.every(row =>
      Array.isArray(row) && row.length === table.columns.length && row.every(cell => short(cell, 100)));
}
export function validLesson(value: unknown): value is Lesson {
  if (!value || typeof value !== "object") return false;
  const a = value as Lesson;
  let scene: Scene = { nodes: [], links: [] };
  return ["pendulum", "flow", "drawing", "notes", "scene"].includes(a.kind) && short(a.title, 80) &&
    (a.color === undefined || Object.hasOwn(ink, a.color)) &&
    (a.lengthMeters === undefined || (Number.isFinite(a.lengthMeters) && a.lengthMeters >= .25 && a.lengthMeters <= 4)) &&
    (a.amplitudeDegrees === undefined || (Number.isFinite(a.amplitudeDegrees) && a.amplitudeDegrees >= 5 && a.amplitudeDegrees <= 25)) &&
    Array.isArray(a.steps) && a.steps.length >= 1 && a.steps.length <= MAX_STEPS &&
    a.steps.every(step => step && short(step.say, 1000) &&
      (step.heading === undefined || short(step.heading, 80)) &&
      (step.body === undefined || short(step.body, 700)) &&
      (step.formula === undefined || short(step.formula, 240)) &&
      (step.table === undefined || validTable(step.table)) &&
      (step.scene === undefined || validSceneEdit(step.scene)) &&
      (a.kind !== "notes" || !!(step.body || step.formula || step.table)) &&
      (a.kind !== "pendulum" || ["support", "bob", "swing", "gravity", "energy"].includes(step.focus || "")) &&
      (a.kind !== "flow" || (short(step.label, 32) && (step.detail === undefined || short(step.detail, 65)))) &&
      (step.annotations === undefined || (Array.isArray(step.annotations) && step.annotations.length <= 16 && step.annotations.every(validAnnotation))) &&
      (step.removeIds === undefined || (Array.isArray(step.removeIds) && step.removeIds.length <= 32 && step.removeIds.every(id => short(id, 40))))) &&
    (a.kind !== "drawing" || a.steps.some(step => (step.annotations?.length || 0) > 0)) &&
    (a.kind !== "scene" || a.steps.every(step => {
      if (step.scene) {
        scene = applyScene(scene, step.scene);
        const ids = new Set(scene.nodes.map(n => n.id));
        if (step.scene.links?.some(l => !ids.has(l.from) || (l.to && !ids.has(l.to)))) return false;
      }
      return sceneIsCoherent(scene);
    }));
}

// A later step can update a shape by using the same ID.
export function applyDrawingStep(previous: Annotation[], step: LessonStep): Annotation[] {
  const removed = new Set(step.removeIds || []);
  const next = previous.filter(item => !item.id || !removed.has(item.id));
  for (const annotation of step.annotations || []) {
    const index = annotation.id ? next.findIndex(item => item.id === annotation.id) : -1;
    if (index >= 0) next[index] = annotation;
    else next.push(annotation);
  }
  return next.slice(-32);
}

export function pendulumPose(seconds: number, lengthMeters = 1, amplitudeDegrees = 20) {
  const pivot = { x: 300, y: 86 };
  const length = 192;
  // Small-angle pendulum formula: a longer string gives a slower swing.
  const period = 2 * Math.PI * Math.sqrt(lengthMeters / 9.81);
  const angle = amplitudeDegrees * Math.PI / 180 * Math.cos(seconds * 2 * Math.PI / period);
  const bob = { x: pivot.x + length * Math.sin(angle), y: pivot.y + length * Math.cos(angle) };
  const potential = (1 - Math.cos(angle)) / (1 - Math.cos(amplitudeDegrees * Math.PI / 180));
  return { pivot, bob, length, angle, period, potential, kinetic: 1 - potential };
}

