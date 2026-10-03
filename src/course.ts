import { app } from "electron";
import { createReadStream } from "node:fs";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type OpenAI from "openai";
import { openaiClient } from "./providers";

// The folder is indexed in an OpenAI vector store; only its ID is kept locally.
export type Course = {
  folder: string;
  vectorStoreId: string;
  files: number;
  bytes?: number;
  updated?: number;
  failed?: number;
  // Each entry names what was left out, such as ".png" or "Over 50 MB".
  skipped?: { reason: string; count: number }[];
};

// File types OpenAI file search can read.
const readable = new Set(
  ".c .cpp .cs .css .doc .docx .go .html .java .js .json .md .pdf .php .pptx .py .rb .sh .tex .ts .txt".split(
    " ",
  ),
);
const statePath = () => path.join(app.getPath("userData"), "course.json");
let indexing = false;

export async function loadCourse(): Promise<Course | undefined> {
  try {
    const course = JSON.parse(await readFile(statePath(), "utf8"));
    return typeof course?.vectorStoreId === "string" ? course : undefined;
  } catch {
    return undefined;
  }
}

async function removeStore(client: OpenAI, id: string, strict = false) {
  try {
    for await (const file of client.vectorStores.files.list(id))
      await client.files.delete(file.id).catch((error) => {
        if (strict && error?.status !== 404) throw error;
      });
    await client.vectorStores.delete(id);
  } catch (error) {
    if (strict && (error as { status?: number })?.status !== 404)
      throw new Error(
        "Course removal did not finish. Its saved reference is kept so you can retry Remove.",
      );
  }
}

export async function indexCourse(folder: string): Promise<void> {
  if (indexing) throw new Error("Course files are already being indexed.");
  indexing = true;
  try {
    const files: string[] = [];
    const skipped = new Map<string, number>();
    const skip = (reason: string) =>
      skipped.set(reason, (skipped.get(reason) || 0) + 1);
    let bytes = 0;
    for (const entry of await readdir(folder, {
      recursive: true,
      withFileTypes: true,
    })) {
      const full = path.join(entry.parentPath, entry.name);
      // Skip hidden files and folders such as .git without reporting them.
      if (
        !entry.isFile() ||
        path
          .relative(folder, full)
          .split(path.sep)
          .some((part) => part.startsWith("."))
      )
        continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (!readable.has(extension)) {
        skip(extension || "No extension");
        continue;
      }
      const size = (await stat(full)).size;
      if (size > 50 * 1024 * 1024) {
        skip("Over 50 MB");
        continue;
      }
      files.push(full);
      bytes += size;
    }
    if (!files.length)
      throw new Error(
        "No readable course files found. Use PDF, slides, docs or text files.",
      );
    if (files.length > 500)
      throw new Error("That folder has over 500 files. Choose one course.");
    const client = openaiClient();
    const store = await client.vectorStores.create({
      name: `teachMe: ${path.basename(folder)}`,
    });
    let batch;
    try {
      batch = await client.vectorStores.fileBatches.uploadAndPoll(store.id, {
        files: files.map((file) => createReadStream(file)),
      });
      if (!batch.file_counts.completed)
        throw new Error("OpenAI could not index any of these files.");
    } catch (error) {
      await removeStore(client, store.id);
      throw error;
    }
    const previous = await loadCourse();
    await writeFile(
      statePath(),
      JSON.stringify({
        folder,
        vectorStoreId: store.id,
        files: batch.file_counts.completed,
        bytes,
        updated: Date.now(),
        failed: batch.file_counts.failed,
        skipped: [...skipped]
          .map(([reason, count]) => ({ reason, count }))
          .sort((a, b) => b.count - a.count),
      } satisfies Course),
    );
    if (previous) await removeStore(client, previous.vectorStoreId);
  } finally {
    indexing = false;
  }
}

export async function removeCourse(): Promise<void> {
  const course = await loadCourse();
  if (!course) return;
  if (indexing)
    throw new Error("Wait for course indexing to finish before removing it.");
  await removeStore(openaiClient(), course.vectorStoreId, true);
  await rm(statePath(), { force: true });
}
