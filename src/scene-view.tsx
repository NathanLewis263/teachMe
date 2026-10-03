// Animate the scene for the visible step; shapes and arrows share a clock so they stay together.
import { useEffect, useMemo, useRef, useState } from "react";
import { annotationPath } from "./drawing";
import { boardInk as ink, type Lesson } from "./lesson";
import {
  linkSegment,
  sceneLabels,
  motionNode,
  sceneForSteps,
  tweenNodes,
  type SceneNode,
} from "./scene";

let context: CanvasRenderingContext2D | null | undefined;
// Measure label text in the pill font so pills fit their words.
function measureLabel(text: string) {
  context ??= document.createElement("canvas").getContext("2d");
  if (!context) return text.length * 7.8;
  context.font = "550 13px system-ui, sans-serif";
  return context.measureText(text).width;
}

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
    .map((link) => ({ link, points: linkSegment(link, frame.nodes) }))
    .filter((item) => item.points !== null);
  const labelSources = [
    ...frame.nodes,
    // Link labels sit beside the arrow's midpoint.
    ...links.map(({ link, points }) => ({
      kind: "line" as const,
      x: (points![0].x + points![1].x) / 1600,
      y: (points![0].y + points![1].y) / 960,
      width: 0,
      height: 0,
      label: link.label,
      id: `link-${link.id}`,
      color: link.color || "blue",
    })),
  ];
  const labels = sceneLabels(labelSources, 800, 480, measureLabel);
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
          <circle cx="1" cy="1" r=".7" fill="#203c4014" />
        </pattern>
        <filter id="scene-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
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
            filter={node.effect === "pulse" ? "url(#scene-glow)" : undefined}
          >
            <path
              className="scene-stroke"
              pathLength={1}
              d={annotationPath(node, 800, 480)}
              stroke={color}
              strokeWidth={node.color === "white" ? 2 : 2.5}
              fill={node.fill ? color : "none"}
              fillOpacity=".16"
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
        const angle = Math.atan2(b.y - a.y, b.x - a.x),
          color = ink[link.color || "blue"];
        const arrow = link.arrow !== false;
        // Stop the line at the base of a filled head so the tip stays sharp.
        const head = Math.min(12, Math.hypot(b.x - a.x, b.y - a.y) * 0.4);
        const base = {
          x: b.x - head * Math.cos(angle),
          y: b.y - head * Math.sin(angle),
        };
        const wing = (side: number) =>
          `${base.x + head * 0.42 * Math.sin(angle) * side} ${base.y - head * 0.42 * Math.cos(angle) * side}`;
        const end = arrow ? base : b;
        return (
          <g
            key={link.id}
            data-link={link.id}
            className="scene-object"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              className="scene-stroke"
              pathLength={1}
              fill="none"
              d={`M ${a.x} ${a.y} L ${end.x} ${end.y}`}
            />
            {arrow && (
              <path
                className="scene-head"
                fill={color}
                strokeWidth="1.5"
                d={`M ${b.x} ${b.y} L ${wing(1)} L ${wing(-1)} Z`}
              />
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
        const leader = Math.hypot(ex - sx, ey - sy) > 4;
        return (
          <g key={source.id} className="scene-label">
            {leader && (
              <>
                <path
                  d={`M ${sx} ${sy} L ${ex} ${ey}`}
                  stroke={color}
                  strokeWidth="1.2"
                  opacity=".45"
                  fill="none"
                />
                <circle cx={sx} cy={sy} r="2.6" fill={color} />
              </>
            )}
            <rect
              x={label.x}
              y={label.y}
              width={label.width}
              height={label.height}
              rx={label.height / 2}
              fill="#ffffff"
              fillOpacity=".94"
              stroke={color}
              strokeOpacity=".38"
            />
            <circle
              cx={label.x + 13}
              cy={label.y + label.height / 2}
              r="3.2"
              fill={color}
            />
            <text
              x={label.x + 22}
              y={label.y + label.height / 2}
              dominantBaseline="central"
              fill="#203c40"
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
