import { useEffect, useRef, useState } from "react";
import type { CourseStatus } from "./teacher-types";

export function CourseFiles({
  busy,
  configured,
  onClose,
}: {
  busy: boolean;
  configured: boolean;
  onClose: () => void;
}) {
  const [course, setCourse] = useState<CourseStatus>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"choose" | "rescan" | "remove" | null>(
    null,
  );
  const [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    let mounted = true;
    void window.teachMe
      .course("status")
      .then((value) => {
        if (mounted) setCourse(value);
      })
      .catch(() => {
        if (mounted)
          setError(
            "Could not read your course files. Reopen Eat my files to try again.",
          );
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  async function change(action: "choose" | "rescan" | "remove") {
    if (pending.current || busy || loading) return;
    pending.current = true;
    setWorking(action);
    setError("");
    try {
      setCourse(await window.teachMe.course(action));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace(
              /^Error invoking remote method '[^']+': Error: /,
              "",
            )
          : "Could not update course files. Try again.",
      );
    } finally {
      pending.current = false;
      setWorking(null);
    }
  }
  const locked = loading || !!working || busy;
  const skipped = course?.skipped.reduce((sum, item) => sum + item.count, 0);
  return (
    <main className="files-window">
      <header>
        <h1>Eat my files</h1>
        <button className="quiet-button" onClick={onClose} disabled={!!working}>
          Done
        </button>
      </header>
      <p className="teacher-note">Course notes I can search during lessons.</p>
      <section className="course-section" aria-busy={loading || !!working}>
        {course ? (
          <div className="course-folder">
            <span className="folder-glyph" aria-hidden />
            <div>
              <b>{course.folder}</b>
              <small>
                {course.files} files
                {course.bytes ? ` · ${size(course.bytes)}` : ""}
                {course.updated ? ` · ${when(course.updated)}` : ""}
              </small>
            </div>
            <div className="folder-actions">
              <button
                className="quiet-button"
                disabled={locked || !configured}
                title="Upload this folder again after editing its files"
                onClick={() => void change("rescan")}
              >
                Re-scan
              </button>
              <button
                className="quiet-button"
                disabled={locked || !configured}
                onClick={() => void change("choose")}
              >
                Change
              </button>
              <button
                className="quiet-button"
                disabled={locked}
                onClick={() => void change("remove")}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button
            className="course-drop"
            disabled={locked || !configured}
            onClick={() => void change("choose")}
          >
            <span className="folder-glyph" aria-hidden />
            <b>Choose a folder</b>
            <small>PDF, slides, docs, notes, code · 50 MB each</small>
          </button>
        )}
        <p className="course-summary" role="status">
          {loading
            ? "Checking your files…"
            : working === "remove"
              ? "Removing…"
              : working
                ? "Uploading and indexing…"
                : ""}
        </p>
        {(working || loading) && (
          <progress aria-label="Updating course files" />
        )}
        {!working && course && (!!skipped || !!course.failed) && (
          <details className="course-skipped">
            <summary>
              {[
                skipped ? `${skipped} skipped` : "",
                course.failed ? `${course.failed} failed` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </summary>
            <ul>
              {course.skipped.map((item) => (
                <li key={item.reason}>
                  <span>{item.reason}</span>
                  <span>{item.count}</span>
                </li>
              ))}
              {!!course.failed && (
                <li>
                  <span>OpenAI could not index</span>
                  <span>{course.failed}</span>
                </li>
              )}
            </ul>
          </details>
        )}
        {error && (
          <p className="teacher-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="teacher-note">End your lesson to change files.</p>
        )}
        {!configured && (
          <p className="teacher-error">
            Add your OpenAI key to .env, then restart teachMe.
          </p>
        )}
      </section>
    </main>
  );
}

const size = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${Math.round(bytes / 1024 / 1024)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const when = (time: number) => {
  const days = Math.floor((Date.now() - time) / 86_400_000);
  return days < 1 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};
