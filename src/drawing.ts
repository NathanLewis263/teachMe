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
  const intersects = (a: LabelBox, b: LabelBox) =>
    a.x < b.x + b.width + 8 &&
    a.x + a.width + 8 > b.x &&
    a.y < b.y + b.height + 8 &&
    a.y + a.height + 8 > b.y;
  annotations.forEach((a, index) => {
    if (!a.label) return;
    const text = a.label.length > 30 ? a.label.slice(0, 29) + "…" : a.label;
    const w = Math.min(width - 24, text.length * 7.8 + 24),
      h = 30;
    const x = Math.max(12, Math.min(width - w - 12, a.x * width));
    const desiredY = Math.min(height - h - 12, (a.y + a.height) * height + 12);
    for (let offset = 0; offset < height; offset += 38) {
      for (const direction of [1, -1]) {
        const y = desiredY + offset * direction;
        const candidate = { x, y, width: w, height: h, text, index };
        if (
          y >= 12 &&
          y + h <= height - 12 &&
          !labels.some((label) => intersects(candidate, label))
        ) {
          labels.push(candidate);
          return;
        }
      }
    }
  });
  return labels;
}
