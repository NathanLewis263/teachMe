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
  const [working, setWorking] = useState<"choose" | "remove" | null>(null);
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
  async function change(action: "choose" | "remove") {
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
  return (
    <main className="files-window">
      <header>
        <h1>Eat my files</h1>
        <button className="quiet-button" onClick={onClose} disabled={!!working}>
          Done
        </button>
      </header>
      <p>Feed me your course notes. I’ll use them when we learn together.</p>
      <section className="course-section" aria-busy={loading || !!working}>
        <h2>Course files</h2>
        <p className="teacher-note">
          Choose a folder to upload to OpenAI for lesson search. PDF, slides,
          docs and text; up to 500 files, 50 MB each.
        </p>
        <p className="course-summary" role="status">
          {loading
            ? "Checking your files…"
            : working === "choose"
              ? "Choosing, uploading and indexing your folder…"
              : working === "remove"
                ? "Removing course files…"
                : course
                  ? `${course.folder} · ${course.files} files ready`
                  : "No files yet"}
        </p>
        {(working || loading) && (
          <progress aria-label="Updating course files" />
        )}
        {error && (
          <p className="teacher-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="teacher-note">
            End your lesson before changing course files.
          </p>
        )}
        {!configured && (
          <p className="teacher-error">
            Add your OpenAI key in the local configuration, then restart
            teachMe.
          </p>
        )}
        <div className="file-actions">
          <button
            className="ask-button"
            disabled={loading || !!working || busy || !configured}
            onClick={() => void change("choose")}
          >
            {course ? "Change folder" : "Choose folder"}
          </button>
          {course && (
            <button
              className="quiet-button"
              disabled={loading || !!working || busy}
              onClick={() => void change("remove")}
            >
              Remove
            </button>
          )}
        </div>
      </section>
      <p className="teacher-note">
        Files stay indexed between lessons. Re-choose your folder after editing
        its contents.
      </p>
    </main>
  );
}
