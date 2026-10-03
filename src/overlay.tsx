// Draw main's lesson frames; moving or browsing the board does not change the speech queue.
import { placeBoard } from "./board-placement";
import { SceneView } from "./scene-view";
import React, { useEffect, useRef, useState } from "react";
import { validAnnotation, type Annotation } from "./contracts";
import { annotationPath, layoutLabels } from "./drawing";
import {
  ink,
  boardInk,
  validLesson,
  type Lesson,
  type LessonFrame,
} from "./lesson";

function Stroke({
  a,
  index,
  width,
  height,
}: {
  a: Annotation;
  index: number;
  width: number;
  height: number;
}) {
  const path = useRef<SVGPathElement>(null);
  useEffect(() => {
    if (!path.current) return;
    const duration = Math.max(
      240,
      Math.min(800, path.current.getTotalLength() * 1.4),
    );
    path.current.style.setProperty("--draw-duration", `${duration}ms`);
  }, [a, width, height]);
  const color = ink[a.color || "mint"];
  const style = {
    "--draw-delay": `${Math.min(index * 90, 360)}ms`,
    "--motion-x": `${(a.motion?.dx || 0) * width}px`,
    "--motion-y": `${(a.motion?.dy || 0) * height}px`,
    "--motion-duration": `${a.motion?.durationMs || 2000}ms`,
  } as React.CSSProperties;
  return (
    <g className={a.motion ? "svg-motion" : undefined} style={style}>
      {a.kind === "highlight" && (
        <path
          d={annotationPath(a, width, height)}
          className="annotation-fill"
          fill={color}
          fillOpacity=".12"
        />
      )}
      <path
        ref={path}
        key={JSON.stringify(a)}
        d={annotationPath(a, width, height)}
        className="annotation-stroke"
        pathLength={1}
        fill="none"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
}
function AnnotationLayer({
  annotations,
  width,
  height,
  offset = { x: 0, y: 0 },
}: {
  annotations: Annotation[];
  width: number;
  height: number;
  offset?: { x: number; y: number };
}) {
  const labels = layoutLabels(annotations, width, height);
  return (
    <svg
      className="desktop-annotations"
      style={{ left: offset.x, top: offset.y, width, height }}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      {annotations.map((a, index) => (
        <Stroke
          key={a.id || JSON.stringify(a)}
          a={a}
          index={index}
          width={width}
          height={height}
        />
      ))}
      {labels.map((label) => (
        <g
          key={annotations[label.index].id || label.index}
          className="annotation-label"
        >
          <rect
            x={label.x}
            y={label.y}
            width={label.width}
            height={label.height}
            rx="8"
            fill="#172d33"
            stroke="#ffffff24"
          />
          <text
            x={label.x + 12}
            y={label.y + 20}
            fill={ink[annotations[label.index].color || "white"]}
            fontSize="13"
            fontWeight="550"
            fontFamily="system-ui"
          >
            {label.text}
          </text>
        </g>
      ))}
    </svg>
  );
}
function Flow({ lesson, step }: { lesson: Lesson; step: number }) {
  const colors = ["mint", "blue", "violet", "amber", "coral", "blue"] as const;
  return (
    <svg
      className="lesson-svg"
      viewBox="0 0 600 410"
      role="img"
      aria-label={lesson.title}
    >
      {lesson.steps
        .slice(Math.max(0, step - 5), step + 1)
        .map((item, index) => {
          const y = 16 + index * 65,
            color = boardInk[colors[index]];
          return (
            <g
              key={index}
              className="lesson-part"
              opacity={index === Math.min(step, 5) ? 1 : 0.68}
            >
              {index > 0 && (
                <path
                  d={`M 88 ${y - 12} V ${y - 3} m -4 -4 l 4 4 l 4 -4`}
                  fill="none"
                  stroke={color}
                  strokeWidth="1.8"
                />
              )}
              <rect
                x="58"
                y={y}
                width="484"
                height="52"
                rx="12"
                fill="#ffffff05"
                stroke={index === Math.min(step, 5) ? color : "#ffffff20"}
              />
              <circle cx="88" cy={y + 26} r="4" fill={color} />
              <text
                x="108"
                y={y + 22}
                fill={color}
                fontSize="15"
                fontWeight="600"
              >
                {item.label}
              </text>
              {item.detail && (
                <text x="108" y={y + 40} fill="#c0cfd1" fontSize="11">
                  {item.detail}
                </text>
              )}
            </g>
          );
        })}
    </svg>
  );
}
function Notes({ lesson, step }: { lesson: Lesson; step: number }) {
  const item = lesson.steps[step];
  return (
    <article className="lesson-notes lesson-part" key={step}>
      {item.heading && <h3>{item.heading}</h3>}
      {item.body && <p>{item.body}</p>}
      {item.formula && <pre className="lesson-formula">{item.formula}</pre>}
      {item.table && (
        <table className="lesson-table">
          <thead>
            <tr>
              {item.table.columns.map((column, index) => (
                <th scope="col" key={index}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {item.table.rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, column) => (
                  <td key={column}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </article>
  );
}
export function Overlay() {
  const board = useRef<HTMLElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [compact, setCompact] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const fullBoardSize = useRef({ width: 680, height: 400 });
  const arrange = useRef<() => void>(() => {});
  const reportRegion = () => {
    const boardBounds = board.current?.getBoundingClientRect();
    window.teachMe.boardRegion(
      boardBounds
        ? {
            x: boardBounds.x,
            y: boardBounds.y,
            width: boardBounds.width,
            height: boardBounds.height,
            dragging: !!drag.current,
          }
        : null,
    );
  };
  const [lesson, setLesson] = useState<LessonFrame | null>(null);
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight });
  useEffect(() => {
    const resize = () => setSize({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    const clear = window.teachMe.subscribe("lesson-clear", () => {
      drag.current = null;
      setLesson(null);
      setPosition(null);
      setCompact(false);
      setMinimized(false);
      setExpanded(false);
    });
    const frames = window.teachMe.subscribe("lesson", (value: LessonFrame) => {
      if (
        !value ||
        !validLesson(value.lesson) ||
        !Number.isInteger(value.step) ||
        value.step < 0 ||
        value.step >= value.lesson.steps.length
      )
        return;
      setLesson(value);
    });
    return () => {
      window.removeEventListener("resize", resize);
      clear();
      frames();
    };
  }, []);
  useEffect(() => {
    reportRegion();
    const observer = new ResizeObserver(() => {
      reportRegion();
      arrange.current();
    });
    if (board.current) observer.observe(board.current);
    return () => {
      observer.disconnect();
      window.teachMe.boardRegion(null);
    };
  }, [lesson, position, size]);
  useEffect(() => {
    setExpanded(false);
  }, [lesson?.turn, lesson?.step]);
  arrange.current = () => {
    if (!lesson || !board.current || drag.current) return;
    const boardBounds = board.current.getBoundingClientRect();
    if (!compact)
      fullBoardSize.current = {
        width: boardBounds.width,
        height: boardBounds.height,
      };
    const viewport = lesson.viewport || { x: 0, y: 0, ...size };
    const annotations = lesson.annotations.filter(validAnnotation);
    const targets = annotations.map((a) => ({
      x: viewport.x + a.x * viewport.width - 16,
      y: viewport.y + a.y * viewport.height - 16,
      width: a.width * viewport.width + 32,
      height: a.height * viewport.height + 32,
    }));
    targets.push(
      ...layoutLabels(annotations, viewport.width, viewport.height).map(
        (label) => ({
          x: viewport.x + label.x - 8,
          y: viewport.y + label.y - 8,
          width: label.width + 16,
          height: label.height + 16,
        }),
      ),
    );
    const full = placeBoard(
      { x: boardBounds.x, y: boardBounds.y, ...fullBoardSize.current },
      viewport,
      targets,
    );
    const shouldCompact = minimized || (full.blocked && !expanded);
    const next = shouldCompact
      ? placeBoard(
          {
            x: boardBounds.x,
            y: boardBounds.y,
            width: Math.min(360, viewport.width - 40),
            height: 56,
          },
          viewport,
          targets,
        )
      : full;
    setCompact(shouldCompact);
    setPosition((old) =>
      old && Math.abs(old.x - next.x) < 1 && Math.abs(old.y - next.y) < 1
        ? old
        : { x: next.x, y: next.y },
    );
  };
  useEffect(() => {
    arrange.current();
  }, [lesson, size, expanded, minimized]);
  const browse = (index: number) => {
    if (lesson) void window.teachMe.browse(lesson.turn, index);
  };
  return (
    <>
      <AnnotationLayer
        annotations={lesson?.annotations.filter(validAnnotation) || []}
        width={lesson?.viewport?.width || size.width}
        height={lesson?.viewport?.height || size.height}
        offset={lesson?.viewport}
      />
      {lesson &&
        (lesson.lesson.kind !== "drawing" ||
          lesson.lesson.steps.some(
            (step) => step.heading || step.body || step.formula || step.table,
          )) &&
        lesson.lesson.kind !== "voice" && (
          <section
            ref={board}
            className={`lesson-board${lesson.lesson.kind === "drawing" ? " screen-caption" : ""}${compact ? " board-compact" : ""}`}
            aria-label={lesson.lesson.title}
            style={position ? { left: position.x, top: position.y } : undefined}
          >
            <header
              className="lesson-heading board-drag-handle"
              title="Drag to move"
              onPointerDown={(e) => {
                if (e.button !== 0 || !board.current) return;
                const boardBounds = board.current.getBoundingClientRect();
                drag.current = {
                  x: e.clientX,
                  y: e.clientY,
                  left: boardBounds.left,
                  top: boardBounds.top,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
                reportRegion();
              }}
              onPointerMove={(e) => {
                const dragStart = drag.current,
                  boardBounds = board.current?.getBoundingClientRect();
                if (!dragStart || !boardBounds) return;
                setPosition({
                  x: Math.max(
                    0,
                    Math.min(
                      dragStart.left + e.clientX - dragStart.x,
                      innerWidth - boardBounds.width,
                    ),
                  ),
                  y: Math.max(
                    0,
                    Math.min(
                      dragStart.top + e.clientY - dragStart.y,
                      innerHeight - boardBounds.height,
                    ),
                  ),
                });
              }}
              onPointerUp={(e) => {
                drag.current = null;
                e.currentTarget.releasePointerCapture(e.pointerId);
                reportRegion();
              }}
              onLostPointerCapture={() => {
                drag.current = null;
                reportRegion();
              }}
            >
              <h2>{lesson.lesson.title}</h2>
              <button
                className="board-end"
                title="Stop audio and clear this lesson"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => void window.teachMe.action("clear")}
              >
                End lesson
              </button>
              {compact ? (
                <button
                  className="board-expand"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setMinimized(false);
                    setExpanded(true);
                  }}
                >
                  Show board
                </button>
              ) : (
                <button
                  className="board-expand"
                  title="Minimize whiteboard"
                  aria-label="Minimize whiteboard"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setMinimized(true)}
                >
                  −
                </button>
              )}
            </header>
            <div className="board-content">
              {lesson.lesson.kind === "scene" ? (
                <>
                  <SceneView lesson={lesson.lesson} step={lesson.step} />
                  <p className="scene-caption">
                    Schematic illustration
                    {(lesson.lesson.steps[lesson.step].heading ||
                      lesson.lesson.steps[lesson.step].body) &&
                      ` · ${lesson.lesson.steps[lesson.step].heading || lesson.lesson.steps[lesson.step].body}`}
                  </p>
                </>
              ) : lesson.lesson.kind === "notes" ||
                lesson.lesson.kind === "drawing" ? (
                <Notes lesson={lesson.lesson} step={lesson.step} />
              ) : (
                <Flow lesson={lesson.lesson} step={lesson.step} />
              )}
            </div>
            <nav className="board-navigation" aria-label="Slides">
              <button
                onClick={() => browse(lesson.step - 1)}
                disabled={lesson.step === 0}
              >
                ← Previous
              </button>
              <span>
                Slide {lesson.step + 1} of {lesson.lesson.steps.length}
              </span>
              <button
                onClick={() => browse(lesson.step + 1)}
                disabled={lesson.step === lesson.lesson.steps.length - 1}
              >
                Next →
              </button>
            </nav>
            {!!lesson.lesson.sources?.length && (
              <details className="lesson-sources">
                <summary>Web sources</summary>
                <ul>
                  {lesson.lesson.sources.map((source) => (
                    <li key={source.url}>
                      <button
                        onClick={() =>
                          void window.teachMe
                            .openSource(lesson.turn, source.url)
                            .catch(() => {})
                        }
                      >
                        {source.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <footer className="lesson-progress">
              {lesson.lesson.steps.map((_, index) => (
                <i
                  key={index}
                  className={index <= lesson.step ? "shown" : ""}
                />
              ))}
            </footer>
          </section>
        )}
    </>
  );
}
