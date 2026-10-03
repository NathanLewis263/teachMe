import { validAnnotation, type Annotation } from "./contracts";

export const MAX_STEPS = 12;
export const MAX_OBJECTS = 32;
export type SceneNode = Annotation & {
  id: string;
  fill?: boolean;
  effect?: "pulse" | "wave";
  group?: string;
};
export type Anchor = "center" | "top" | "bottom" | "left" | "right";
export type SceneLink = {
  id: string;
  from: string;
  anchor?: Anchor;
  to?: string;
  toAnchor?: Anchor;
  dx?: number;
  dy?: number;
  color?: Annotation["color"];
  label?: string;
  arrow?: boolean;
};
export type SceneEdit = {
  reset?: boolean;
  nodes?: SceneNode[];
  links?: SceneLink[];
  removeIds?: string[];
};
export type Scene = { nodes: SceneNode[]; links: SceneLink[] };
const id = (v: unknown): v is string =>
  typeof v === "string" && /^[a-zA-Z][\w-]{0,39}$/.test(v);
const anchors = ["center", "top", "bottom", "left", "right"];
const colors = ["mint", "blue", "amber", "coral", "violet", "white"];
export function validSceneEdit(value: unknown): value is SceneEdit {
  if (!value || typeof value !== "object") return false;
  const edit = value as SceneEdit;
  return (
    (edit.reset === undefined || typeof edit.reset === "boolean") &&
    (edit.removeIds === undefined ||
      (Array.isArray(edit.removeIds) &&
        edit.removeIds.length <= 64 &&
        edit.removeIds.every(id))) &&
    (edit.nodes === undefined ||
      (Array.isArray(edit.nodes) &&
        edit.nodes.length <= MAX_OBJECTS &&
        edit.nodes.every(
          (n) =>
            validAnnotation(n) &&
            id(n.id) &&
            (n.label === undefined || n.label.length <= 40) &&
            (n.fill === undefined || typeof n.fill === "boolean") &&
            (n.effect === undefined || ["pulse", "wave"].includes(n.effect)) &&
            (n.group === undefined || id(n.group)),
        ))) &&
    (edit.links === undefined ||
      (Array.isArray(edit.links) &&
        edit.links.length <= MAX_OBJECTS &&
        edit.links.every(
          (l) =>
            l &&
            id(l.id) &&
            id(l.from) &&
            (l.anchor === undefined || anchors.includes(l.anchor)) &&
            (l.toAnchor === undefined || anchors.includes(l.toAnchor)) &&
            (l.color === undefined || colors.includes(l.color)) &&
            (l.label === undefined ||
              (typeof l.label === "string" && l.label.length <= 40)) &&
            (l.arrow === undefined || typeof l.arrow === "boolean") &&
            (l.to !== undefined
              ? id(l.to) && l.dx === undefined && l.dy === undefined
              : Number.isFinite(l.dx) &&
                Number.isFinite(l.dy) &&
                Math.abs(l.dx!) <= 0.8 &&
                Math.abs(l.dy!) <= 0.8),
        ))) &&
    new Set(edit.nodes?.map((n) => n.id)).size === (edit.nodes?.length || 0) &&
    new Set(edit.links?.map((l) => l.id)).size === (edit.links?.length || 0)
  );
}
// Reusing an ID updates that shape. Other shapes stay on the board.
export function applyScene(previous: Scene, edit: SceneEdit): Scene {
  const removed = new Set(edit.removeIds || []);
  const merge = <T extends { id: string }>(old: T[], fresh: T[] = []) => {
    const items = new Map(
      (edit.reset ? [] : old)
        .filter((n) => !removed.has(n.id))
        .map((n) => [n.id, n]),
    );
    fresh.forEach((n) => items.set(n.id, n));
    return [...items.values()];
  };
  const nodes = merge(previous.nodes, edit.nodes);
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    links: merge(previous.links, edit.links).filter(
      (l) => ids.has(l.from) && (!l.to || ids.has(l.to)),
    ),
  };
}
export function sceneForSteps(
  steps: { scene?: SceneEdit }[],
  index: number,
): Scene {
  return steps
    .slice(0, index + 1)
    .reduce(
      (scene, step) => (step.scene ? applyScene(scene, step.scene) : scene),
      { nodes: [], links: [] } as Scene,
    );
}
export function sceneIsCoherent(scene: Scene): boolean {
  if (
    !scene.nodes.length ||
    scene.nodes.length > MAX_OBJECTS ||
    scene.links.length > MAX_OBJECTS
  )
    return false;
  const groups = new Map<string, string>();
  for (const node of scene.nodes) {
    if (!node.group) continue;
    const motion = JSON.stringify(node.motion || null);
    if (groups.has(node.group) && groups.get(node.group) !== motion)
      return false;
    groups.set(node.group, motion);
  }
  return scene.links.every((link) => {
    const points = linkPoints(link, scene.nodes);
    if (!points) return false;
    const node = scene.nodes.find((n) => n.id === link.from)!;
    return (
      points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) &&
      (!!link.to ||
        points.every(
          (p) =>
            p.x + (node.motion?.dx || 0) >= 0 &&
            p.x + (node.motion?.dx || 0) <= 1 &&
            p.y + (node.motion?.dy || 0) >= 0 &&
            p.y + (node.motion?.dy || 0) <= 1,
        ))
    );
  });
}
export function motionNode(node: SceneNode, seconds: number): SceneNode {
  const phase = node.motion
    ? (1 - Math.cos((seconds * 2 * Math.PI * 1000) / node.motion.durationMs)) /
      2
    : 0;
  return {
    ...node,
    x: node.x + (node.motion?.dx || 0) * phase,
    y: node.y + (node.motion?.dy || 0) * phase,
  };
}
export function anchorPoint(node: SceneNode, anchor: Anchor = "center") {
  return {
    x:
      node.x +
      node.width * (anchor === "left" ? 0 : anchor === "right" ? 1 : 0.5),
    y:
      node.y +
      node.height * (anchor === "top" ? 0 : anchor === "bottom" ? 1 : 0.5),
  };
}
export function linkPoints(link: SceneLink, nodes: SceneNode[]) {
  const from = nodes.find((n) => n.id === link.from),
    to = nodes.find((n) => n.id === link.to);
  if (!from || (link.to && !to)) return null;
  const a = anchorPoint(from, link.anchor);
  return [
    a,
    to
      ? anchorPoint(to, link.toAnchor)
      : { x: a.x + (link.dx || 0), y: a.y + (link.dy || 0) },
  ];
}
export function tweenNodes(
  previous: SceneNode[],
  next: SceneNode[],
  progress: number,
): SceneNode[] {
  const t = 1 - Math.pow(1 - Math.min(1, Math.max(0, progress)), 3);
  return next.map((n) => {
    const old = previous.find((p) => p.id === n.id);
    if (!old) return n;
    return {
      ...n,
      x: old.x + (n.x - old.x) * t,
      y: old.y + (n.y - old.y) * t,
      width: old.width + (n.width - old.width) * t,
      height: old.height + (n.height - old.height) * t,
    };
  });
}

// Find space for each label without covering shapes or labels already placed.
export function sceneLabels(sources: Annotation[], width = 800, height = 480) {
  type Box = { x: number; y: number; width: number; height: number };
  const intersects = (a: Box, b: Box) =>
    a.x < b.x + b.width + 6 &&
    a.x + a.width + 6 > b.x &&
    a.y < b.y + b.height + 6 &&
    a.y + a.height + 6 > b.y;
  const obstacles = sources
    .filter((n) => n.width > 0 && n.height > 0)
    .map((n) => ({
      x: n.x * width,
      y: n.y * height,
      width: n.width * width,
      height: n.height * height,
    }));
  const labels: (Box & { text: string; index: number })[] = [];
  sources.forEach((source, index) => {
    if (!source.label) return;
    const w = Math.min(width - 24, source.label.length * 7.8 + 24),
      h = 30;
    const x = source.x * width,
      y = source.y * height,
      sw = source.width * width,
      sh = source.height * height;
    const positions = [
      [x, y + sh + 12],
      [x + sw + 22, y + sh / 2 - h / 2],
      [x - w - 22, y + sh / 2 - h / 2],
      [x, y - h - 12],
    ];
    for (let dy = 0; dy < height; dy += 38)
      positions.push([x, y + sh + 12 + dy], [x, y - h - 12 - dy]);
    for (const [px, py] of positions) {
      const box = {
        x: Math.max(12, Math.min(width - w - 12, px)),
        y: py,
        width: w,
        height: h,
        text: source.label,
        index,
      };
      if (
        py < 12 ||
        py + h > height - 12 ||
        labels.some((l) => intersects(box, l)) ||
        obstacles.some((o) => intersects(box, o))
      )
        continue;
      labels.push(box);
      return;
    }
    // Keep the label even if the board is too crowded to find a clear spot.
    labels.push({
      x: 12,
      y: Math.min(height - h - 12, 12 + labels.length * 38),
      width: w,
      height: h,
      text: source.label,
      index,
    });
  });
  return labels;
}
