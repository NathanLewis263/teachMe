// Turn validated shapes into SVG paths so the board and desktop use the same drawing rules.
import type { Annotation } from "./contracts";

// Every shape becomes a path so the same stroke animation works for all shapes.
export function annotationPath(
  a: Annotation,
  viewportWidth = 1000,
  viewportHeight = 1000,
): string {
  const x = a.x * viewportWidth,
    y = a.y * viewportHeight;
  const w = a.width * viewportWidth,
    h = a.height * viewportHeight;
  const point = (u: number, v: number) => `${x + u * w} ${y + v * h}`;
  switch (a.kind) {
    case "path":
      return a
        .commands!.map(({ command, points }) => {
          const pairs = [];
          for (let i = 0; i < points.length; i += 2)
            pairs.push(point(points[i], points[i + 1]));
          return `${command} ${pairs.join(" ")}`;
        })
        .join(" ");
    case "line":
      return `M ${point(0, 0)} L ${point(1, 1)}`;
    case "arrow": {
      const length = Math.hypot(w, h);
      if (!length) return `M ${point(0, 0)}`;
      const ux = w / length,
        uy = h / length;
      const head = Math.min(24, length * 0.25);
      const tipX = x + w,
        tipY = y + h;
      return `M ${x} ${y} L ${tipX} ${tipY} M ${tipX - head * ux - head * 0.5 * uy} ${tipY - head * uy + head * 0.5 * ux} L ${tipX} ${tipY} L ${tipX - head * ux + head * 0.5 * uy} ${tipY - head * uy - head * 0.5 * ux}`;
    }
    case "highlight":
      return `M ${point(0, 0)} H ${x + w} V ${y + h} H ${x} Z`;
    case "ellipse":
      return `M ${point(0.5, 0)} C ${point(0.776, 0)} ${point(1, 0.224)} ${point(1, 0.5)} C ${point(1, 0.776)} ${point(0.776, 1)} ${point(0.5, 1)} C ${point(0.224, 1)} ${point(0, 0.776)} ${point(0, 0.5)} C ${point(0, 0.224)} ${point(0.224, 0)} ${point(0.5, 0)} Z`;
    case "triangle":
      return `M ${point(0.5, 0)} L ${point(1, 1)} L ${point(0, 1)} Z`;
    case "curve":
      return `M ${point(0, 0.8)} C ${point(0.25, 0)} ${point(0.75, 1)} ${point(1, 0.2)}`;
    case "star":
      return (
        Array.from({ length: 10 }, (_, i) => {
          const angle = (i * Math.PI) / 5 - Math.PI / 2;
          const radius = i % 2 ? 0.22 : 0.5;
          return `${i ? "L" : "M"} ${point(0.5 + Math.cos(angle) * radius, 0.5 + Math.sin(angle) * radius)}`;
        }).join(" ") + " Z"
      );
  }
}

export type LabelBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  index: number;
};
export function layoutLabels(
  annotations: Annotation[],
  width: number,
  height: number,
): LabelBox[] {
  const labels: LabelBox[] = [];
  const gap = 12;
  const intersects = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width + 8 &&
    a.x + a.width + 8 > b.x &&
    a.y < b.y + b.height + 8 &&
    a.y + a.height + 8 > b.y;
  const targets = annotations.map((a) => ({
    x: a.x * width,
    y: a.y * height,
    width: a.width * width,
    height: a.height * height,
  }));
  annotations.forEach((a, index) => {
    if (!a.label) return;
    const text = a.label.length > 30 ? a.label.slice(0, 29) + "…" : a.label;
    const w = Math.min(width - 24, text.length * 7.8 + 24),
      h = 30;
    const target = targets[index];
    const left = Math.max(gap, Math.min(width - w - gap, target.x));
    const right = Math.max(
      gap,
      Math.min(width - w - gap, target.x + target.width - w),
    );
    // Keep labels next to their target, with the empty space above preferred.
    const positions = [
      { x: left, y: target.y - h - gap },
      { x: right, y: target.y - h - gap },
      { x: left, y: target.y + target.height + gap },
      { x: right, y: target.y + target.height + gap },
      { x: target.x - w - gap, y: target.y },
      { x: target.x + target.width + gap, y: target.y },
    ];
    const position = positions.find(({ x, y }) => {
      const candidate = { x, y, width: w, height: h };
      return (
        x >= gap &&
        x + w <= width - gap &&
        y >= gap &&
        y + h <= height - gap &&
        !targets.some((target) => intersects(candidate, target)) &&
        !labels.some((label) => intersects(candidate, label))
      );
    });
    if (position)
      labels.push({ ...position, width: w, height: h, text, index });
  });
  return labels;
}

// Aim arrows at marked controls because the model can misjudge their boxes.
export function aimArrows(
  annotations: Annotation[],
  width: number,
  height: number,
): Annotation[] {
  const targets = annotations
    .filter(
      (annotation) =>
        (annotation.kind === "highlight" || annotation.kind === "ellipse") &&
        annotation.width > 0 &&
        annotation.height > 0,
    )
    .map((annotation) => ({
      kind: annotation.kind,
      x: annotation.x * width,
      y: annotation.y * height,
      width: annotation.width * width,
      height: annotation.height * height,
    }));
  return annotations.map((a) => {
    if (a.kind !== "arrow" || !targets.length) return a;
    const tail = { x: a.x * width, y: a.y * height };
    const tip = { x: (a.x + a.width) * width, y: (a.y + a.height) * height };
    const length = Math.hypot(tip.x - tail.x, tip.y - tail.y);
    const distance = (box: (typeof targets)[number]) =>
      Math.hypot(
        Math.max(box.x - tip.x, 0, tip.x - (box.x + box.width)),
        Math.max(box.y - tip.y, 0, tip.y - (box.y + box.height)),
      );
    const target = targets.reduce((best, candidate) =>
      distance(candidate) < distance(best) ? candidate : best,
    );
    // Leave arrows that clearly point somewhere else alone.
    if (distance(target) > Math.max(200, length * 1.5)) return a;
    const center = {
      x: target.x + target.width / 2,
      y: target.y + target.height / 2,
    };
    let start = tail;
    let dx = start.x - center.x,
      dy = start.y - center.y;
    // A tail inside the target cannot aim at it, so start from just outside instead.
    const inside =
      Math.abs(dx) <= target.width / 2 && Math.abs(dy) <= target.height / 2;
    if (inside) {
      dx = -(tip.x - tail.x);
      dy = -(tip.y - tail.y);
      if (!dx && !dy) dx = -1;
    }
    const rx = target.width / 2,
      ry = target.height / 2;
    const edgeScale =
      target.kind === "ellipse"
        ? 1 / Math.hypot(dx / rx, dy / ry)
        : Math.min(
            dx ? rx / Math.abs(dx) : Infinity,
            dy ? ry / Math.abs(dy) : Infinity,
          );
    const directionLength = Math.hypot(dx, dy);
    const edge = {
      x: center.x + dx * edgeScale + (dx / directionLength) * 8,
      y: center.y + dy * edgeScale + (dy / directionLength) * 8,
    };
    // Keep the arrow long enough to read as an arrow.
    const reach = Math.max(70, Math.min(length, 220));
    if (inside || Math.hypot(start.x - edge.x, start.y - edge.y) < 50)
      start = {
        x: edge.x + (dx / directionLength) * reach,
        y: edge.y + (dy / directionLength) * reach,
      };
    start = {
      x: Math.min(width - 4, Math.max(4, start.x)),
      y: Math.min(height - 4, Math.max(4, start.y)),
    };
    return {
      ...a,
      x: start.x / width,
      y: start.y / height,
      width: (edge.x - start.x) / width,
      height: (edge.y - start.y) / height,
    };
  });
}
