import { SceneView } from "./scene-view";
import React, { useEffect, useRef, useState } from "react";
import { validAnnotation, type Annotation } from "./contracts";
import { annotationPath, layoutLabels } from "./drawing";
import { ink, pendulumPose, validLesson, type Lesson, type LessonFrame } from "./lesson";

function Stroke({ a, index, width, height }: { a: Annotation; index: number; width: number; height: number }) {
  const path = useRef<SVGPathElement>(null);
  useEffect(() => {
    if (!path.current) return;
    const duration = Math.max(240, Math.min(800, path.current.getTotalLength() * 1.4));
    path.current.style.setProperty("--draw-duration", `${duration}ms`);
  }, [a, width, height]);
  const color = ink[a.color || "mint"];
  const style = { "--draw-delay": `${Math.min(index * 90, 360)}ms`,
    "--motion-x": `${(a.motion?.dx || 0) * width}px`, "--motion-y": `${(a.motion?.dy || 0) * height}px`,
    "--motion-duration": `${a.motion?.durationMs || 2000}ms` } as React.CSSProperties;
  return <g className={a.motion ? "svg-motion" : undefined} style={style}>
    {a.kind === "highlight" && <path d={annotationPath(a, width, height)} className="annotation-fill" fill={color} fillOpacity=".12" />}
    <path ref={path} key={JSON.stringify(a)} d={annotationPath(a, width, height)} className="annotation-stroke" pathLength={1}
      fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </g>;
}
export function AnnotationLayer({ annotations, width, height }: { annotations: Annotation[]; width: number; height: number }) {
  const labels = layoutLabels(annotations, width, height);
  return <svg className="desktop-annotations" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    {annotations.map((a, index) => <Stroke key={a.id || JSON.stringify(a)} a={a} index={index} width={width} height={height} />)}
    {labels.map(label => <g key={annotations[label.index].id || label.index} className="annotation-label">
      <rect x={label.x} y={label.y} width={label.width} height={label.height} rx="8" fill="#172d33" stroke="#ffffff24" />
      <text x={label.x + 12} y={label.y + 20} fill={ink[annotations[label.index].color || "white"]} fontSize="13" fontWeight="550" fontFamily="system-ui">{label.text}</text>
    </g>)}
  </svg>;
}
function useMotionClock(enabled: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, start = 0;
    const update = (now: number) => {
      if (!start) start = now;
      setSeconds((now - start) / 1000);
      frame = requestAnimationFrame(update);
    };
    const sync = () => {
      cancelAnimationFrame(frame); start = 0; setSeconds(0);
      if (enabled && !preference.matches) frame = requestAnimationFrame(update);
    };
    sync(); preference.addEventListener("change", sync);
    return () => { cancelAnimationFrame(frame); preference.removeEventListener("change", sync); };
  }, [enabled]);
  return seconds;
}
function Pendulum({ lesson, step }: { lesson: Lesson; step: number }) {
  const seen = new Set(lesson.steps.slice(0, step + 1).map(item => item.focus));
  const moving = seen.has("swing") || seen.has("gravity") || seen.has("energy");
  const hasBob = seen.has("bob") || moving;
  const seconds = useMotionClock(moving);
  const pose = pendulumPose(seconds, lesson.lengthMeters || 1, lesson.amplitudeDegrees || 20);
  const edge = pendulumPose(0, lesson.lengthMeters || 1, lesson.amplitudeDegrees || 20).bob;
  const color = ink[lesson.color || "mint"];
  return <svg className="lesson-svg" viewBox="0 0 600 410" role="img" aria-label="A pendulum with its string connected to the pivot and moving bob">
    <defs><marker id="force-tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={ink.amber} strokeWidth="1.5" /></marker></defs>
    <g className="lesson-part">
      <path d="M 218 62 H 382 M 300 62 V 86" fill="none" stroke={ink.white} strokeWidth="3" strokeLinecap="round" />
      <circle cx="300" cy="86" r="6" fill={ink.white} />
      <path d="M 309 88 L 395 88" stroke="#ffffff36" />
      <text x="407" y="93" className="diagram-label">Fixed pivot</text>
    </g>
    {moving && <g className="lesson-part">
      <path d={`M ${600 - edge.x} ${edge.y} A ${pose.length} ${pose.length} 0 0 0 ${edge.x} ${edge.y}`} fill="none" stroke={ink.blue} strokeWidth="2" strokeDasharray="4 7" opacity=".65" />
      <path d="M 300 108 V 283" stroke="#ffffff24" strokeDasharray="3 7" />
      <text x="300" y="378" textAnchor="middle" fill={ink.blue} fontSize="13">The bob follows a circular arc</text>
    </g>}
    {hasBob && <g className="lesson-part">
      <line x1={pose.pivot.x} y1={pose.pivot.y} x2={pose.bob.x} y2={pose.bob.y} stroke={color} strokeWidth="3" />
      <circle cx={pose.bob.x} cy={pose.bob.y} r="15" fill={color} stroke="#ffffff60" strokeWidth="1.5" />
      <path d={`M ${pose.bob.x - 21} ${pose.bob.y} H 135`} fill="none" stroke="#ffffff36" />
      <text x="120" y={pose.bob.y + 4} textAnchor="end" className="diagram-label">Bob</text>
      {!moving && <><path d={`M ${(pose.bob.x + 300) / 2 + 8} ${(pose.bob.y + 86) / 2} H 432`} stroke="#ffffff36" />
        <text x="445" y={(pose.bob.y + 86) / 2 + 4} className="diagram-label">String</text></>}
    </g>}
    {seen.has("gravity") && <g className="lesson-part">
      <path d={`M ${pose.bob.x} ${pose.bob.y + 23} v 49`} stroke={ink.amber} strokeWidth="2.5" markerEnd="url(#force-tip)" />
      <text x={pose.bob.x + 14} y={pose.bob.y + 61} fill={ink.amber} fontSize="12">Gravity</text>
    </g>}
    {seen.has("energy") && <g className="lesson-part">
      <text x="442" y="163" fill={ink.violet} fontSize="12">Potential</text>
      <rect x="442" y="174" width="100" height="5" rx="2.5" fill="#ffffff12" />
      <rect x="442" y="174" width={Math.max(0, pose.potential * 100)} height="5" rx="2.5" fill={ink.violet} />
      <text x="442" y="208" fill={ink.blue} fontSize="12">Kinetic</text>
      <rect x="442" y="219" width="100" height="5" rx="2.5" fill="#ffffff12" />
      <rect x="442" y="219" width={Math.max(0, pose.kinetic * 100)} height="5" rx="2.5" fill={ink.blue} />
    </g>}
    <text x="36" y="28" fill="#97b0b5" fontSize="12">{lesson.lengthMeters || 1} m string · ideal small-angle motion</text>
  </svg>;
}
function Flow({ lesson, step }: { lesson: Lesson; step: number }) {
  const colors = ["mint", "blue", "violet", "amber", "coral", "blue"] as const;
  return <svg className="lesson-svg" viewBox="0 0 600 410" role="img" aria-label={lesson.title}>
    {lesson.steps.slice(Math.max(0, step - 5), step + 1).map((item, index) => {
      const y = 16 + index * 65, color = ink[colors[index]];
      return <g key={index} className="lesson-part" opacity={index === Math.min(step, 5) ? 1 : .68}>
        {index > 0 && <path d={`M 88 ${y - 12} V ${y - 3} m -4 -4 l 4 4 l 4 -4`} fill="none" stroke={color} strokeWidth="1.8" />}
        <rect x="58" y={y} width="484" height="52" rx="12" fill="#ffffff05" stroke={index === Math.min(step, 5) ? color : "#ffffff20"} />
        <circle cx="88" cy={y + 26} r="4" fill={color} />
        <text x="108" y={y + 22} fill={color} fontSize="15" fontWeight="600">{item.label}</text>
        {item.detail && <text x="108" y={y + 40} fill="#c0cfd1" fontSize="11">{item.detail}</text>}
      </g>;
    })}
  </svg>;
}
export function Notes({ lesson, step }: { lesson: Lesson; step: number }) {
  const item = lesson.steps[step];
  return <article className="lesson-notes lesson-part" key={step}>
    {item.heading && <h3>{item.heading}</h3>}
    {item.body && <p>{item.body}</p>}
    {item.formula && <pre className="lesson-formula">{item.formula}</pre>}
    {item.table && <table className="lesson-table">
      <thead><tr>{item.table.columns.map((column, index) => <th scope="col" key={index}>{column}</th>)}</tr></thead>
      <tbody>{item.table.rows.map((row, index) => <tr key={index}>
        {row.map((cell, column) => <td key={column}>{cell}</td>)}
      </tr>)}</tbody>
    </table>}
  </article>;
}
export function Overlay() {
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [lesson, setLesson] = useState<LessonFrame | null>(null);
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight });
  useEffect(() => {
    const resize = () => setSize({ width: innerWidth, height: innerHeight });
    window.addEventListener("resize", resize);
    const drawing = window.teachMe.subscribe("drawing", (value: unknown) => {
      setLesson(null); setAnnotations(Array.isArray(value) ? value.filter(validAnnotation) : []);
    });
    const frames = window.teachMe.subscribe("lesson", (value: LessonFrame) => {
      if (!value || !validLesson(value.lesson) || !Number.isInteger(value.step) || value.step < 0 || value.step >= value.lesson.steps.length) return;
      setLesson(value); setAnnotations(value.annotations.filter(validAnnotation));
    });
    return () => { window.removeEventListener("resize", resize); drawing(); frames(); };
  }, []);
  return <>
    <AnnotationLayer annotations={annotations} {...size} />
    {lesson && lesson.lesson.kind !== "drawing" && <section className="lesson-board" aria-label={lesson.lesson.title}>
      <header className="lesson-heading"><h2>{lesson.lesson.title}</h2><span>{lesson.step + 1} / {lesson.lesson.steps.length}</span></header>
      {lesson.lesson.kind === "pendulum" ? <Pendulum lesson={lesson.lesson} step={lesson.step} /> :
        lesson.lesson.kind === "scene" ? <><SceneView lesson={lesson.lesson} step={lesson.step} /><p className="scene-caption">{lesson.lesson.steps[lesson.step].heading || lesson.lesson.steps[lesson.step].body || "Schematic illustration"}</p></> :
        lesson.lesson.kind === "notes" ? <Notes lesson={lesson.lesson} step={lesson.step} /> : <Flow lesson={lesson.lesson} step={lesson.step} />}
      <footer className="lesson-progress">{lesson.lesson.steps.map((_, index) => <i key={index} className={index <= lesson.step ? "shown" : ""} />)}</footer>
    </section>}
  </>;
}
