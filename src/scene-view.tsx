import { useEffect, useMemo, useRef, useState } from "react";
import { annotationPath } from "./drawing";
import { ink, type Lesson } from "./lesson";
import {
  linkPoints,
  sceneLabels,
  motionNode,
  sceneForSteps,
  tweenNodes,
  type SceneNode,
} from "./scene";

// Use the same clock for shapes and arrows so they move together.
export function SceneView({ lesson, step }: { lesson: Lesson; step: number }) {
  const scene = useMemo(
    () => sceneForSteps(lesson.steps, step),
    [lesson, step],
  );
  const rendered = useRef<SceneNode[]>([]);
  const [frame, setFrame] = useState({ nodes: scene.nodes, seconds: 0 });
  const epoch = useRef(0);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const previous = rendered.current;
    let raf = 0;
    const started = performance.now();
    if (!epoch.current) epoch.current = started;
    const tick = (now: number) => {
      const seconds = preference.matches ? 0 : (now - epoch.current) / 1000;
      const target = scene.nodes.map((n) => motionNode(n, seconds));
      // Take 450ms to move from the old layout to the new one.
      const nodes = tweenNodes(
        previous,
        target,
        preference.matches ? 1 : (now - started) / 450,
      );
      rendered.current = nodes;
      setFrame({ nodes, seconds });
      if (!preference.matches) raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      tick(performance.now());
    };
    sync();
    preference.addEventListener("change", sync);
    return () => {
      cancelAnimationFrame(raf);
      preference.removeEventListener("change", sync);
    };
  }, [scene]);
  const links = scene.links
    .map((link) => ({ link, points: linkPoints(link, frame.nodes) }))
    .filter((item) => item.points !== null);
  const labelSources = [
    ...frame.nodes,
    ...links.map(({ link, points }) => ({
      kind: "line" as const,
      x: Math.max(points![0].x, points![1].x) + 0.02,
      y: Math.min(points![0].y, points![1].y),
      width: 0,
      height: 0,
      label: link.label,
      id: `link-${link.id}`,
      color: link.color,
    })),
  ];
  const labels = sceneLabels(labelSources, 800, 480);
  return (
    <svg
      className="scene-svg"
      viewBox="0 0 800 480"
      role="img"
      aria-label={lesson.title}
    >
      <defs>
        <pattern
          id="scene-grid"
          width="24"
          height="24"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r=".7" fill="#ffffff0b" />
        </pattern>
      </defs>
      <rect width="800" height="480" fill="url(#scene-grid)" />
      {frame.nodes.map((node) => {
        const color = ink[node.color || "mint"];
        const pulse =
          node.effect === "pulse"
            ? 0.65 + 0.35 * Math.cos((frame.seconds * Math.PI * 2) / 2)
            : 1;
        return (
          <g
            key={node.id}
            data-object={node.id}
            className="scene-object"
            opacity={pulse}
          >
            <path
              d={annotationPath(node, 800, 480)}
              stroke={color}
              strokeWidth="2.5"
              fill={node.fill ? color : "none"}
              fillOpacity=".14"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {node.effect === "wave" &&
              [0, 0.33, 0.66].map((offset) => {
                const phase = (frame.seconds / 2.4 + offset) % 1;
                return (
                  <ellipse
                    key={offset}
                    cx={(node.x + node.width / 2) * 800}
                    cy={(node.y + node.height / 2) * 480}
                    rx={node.width * 400 * (1 + phase)}
                    ry={node.height * 240 * (1 + phase)}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    opacity={(1 - phase) * 0.65}
                  />
                );
              })}
          </g>
        );
      })}
      {links.map(({ link, points }) => {
        const [a, b] = points!;
        const x1 = a.x * 800,
          y1 = a.y * 480,
          x2 = b.x * 800,
          y2 = b.y * 480;
        const angle = Math.atan2(y2 - y1, x2 - x1),
          color = ink[link.color || "blue"];
        const tip = (offset: number) =>
          `${x2 - 9 * Math.cos(angle + offset)} ${y2 - 9 * Math.sin(angle + offset)}`;
        return (
          <g
            key={link.id}
            data-link={link.id}
            className="scene-object"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={`M ${x1} ${y1} L ${x2} ${y2}`} />
            {link.arrow !== false && (
              <path d={`M ${tip(-0.5)} L ${x2} ${y2} L ${tip(0.5)}`} />
            )}
          </g>
        );
      })}
      {labels.map((label) => {
        const source = labelSources[label.index],
          color = ink[source.color || "white"];
        const cx = label.x + label.width / 2,
          cy = label.y + label.height / 2;
        const sx = Math.max(
          source.x * 800,
          Math.min((source.x + source.width) * 800, cx),
        );
        const sy = Math.max(
          source.y * 480,
          Math.min((source.y + source.height) * 480, cy),
        );
        const ex = Math.max(label.x, Math.min(label.x + label.width, sx));
        const ey = Math.max(label.y, Math.min(label.y + label.height, sy));
        return (
          <g key={source.id} className="scene-label">
            <path
              d={`M ${sx} ${sy} L ${ex} ${ey}`}
              stroke={color}
              opacity=".35"
              fill="none"
            />
            <rect
              x={label.x}
              y={label.y}
              width={label.width}
              height={label.height}
              rx="7"
              fill="#14282f"
              stroke="#ffffff1c"
            />
            <text
              x={label.x + 12}
              y={label.y + 20}
              fill={color}
              fontSize="13"
              fontWeight="550"
            >
              {label.text}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
