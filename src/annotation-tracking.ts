// Match local image patches after scrolling; hide marks when we cannot find their target.
import type { Annotation } from "./contracts";
export type ScreenPixels = { width: number; height: number; data: Uint8Array };

// Match each target separately so fixed toolbars and scrolling content can coexist.
export function trackAnnotation(
  annotation: Annotation,
  before: ScreenPixels,
  after: ScreenPixels,
): Annotation | undefined {
  if (before.width !== after.width || before.height !== after.height) return;
  const { width, height } = before;
  const centerX = Math.round((annotation.x + annotation.width / 2) * width);
  const centerY = Math.round((annotation.y + annotation.height / 2) * height);
  const sampleRadiusX = Math.max(
    6,
    Math.min(45, Math.round((annotation.width * width) / 2)),
  );
  const sampleRadiusY = Math.max(
    6,
    Math.min(35, Math.round((annotation.height * height) / 2)),
  );
  if (
    centerX < sampleRadiusX ||
    centerY < sampleRadiusY ||
    centerX + sampleRadiusX >= width ||
    centerY + sampleRadiusY >= height
  )
    return;
  const samples: { x: number; y: number; value: number }[] = [];
  const grayscale = (image: ScreenPixels, x: number, y: number) => {
    const pixelOffset = (y * width + x) * 4;
    return (
      (image.data[pixelOffset] +
        image.data[pixelOffset + 1] +
        image.data[pixelOffset + 2]) /
      3
    );
  };
  for (
    let y = -sampleRadiusY;
    y <= sampleRadiusY;
    y += Math.max(1, Math.floor(sampleRadiusY / 4))
  )
    for (
      let x = -sampleRadiusX;
      x <= sampleRadiusX;
      x += Math.max(1, Math.floor(sampleRadiusX / 4))
    )
      samples.push({
        x,
        y,
        value: grayscale(before, centerX + x, centerY + y),
      });
  // Flat patches cannot identify a target reliably after scrolling.
  const mean =
    samples.reduce((total, sample) => total + sample.value, 0) / samples.length;
  if (
    samples.reduce((total, sample) => total + (sample.value - mean) ** 2, 0) /
      samples.length <
    100
  )
    return;
  const score = (x: number, y: number) =>
    samples.reduce(
      (total, sample) =>
        total +
        Math.abs(sample.value - grayscale(after, x + sample.x, y + sample.y)),
      0,
    ) / samples.length;
  let best = { x: centerX, y: centerY, error: Infinity };
  const candidates: (typeof best)[] = [];
  // Scrolling moves content vertically or horizontally, not to arbitrary windows.
  for (let y = sampleRadiusY; y < height - sampleRadiusY; y++) {
    const candidate = { x: centerX, y, error: score(centerX, y) };
    candidates.push(candidate);
    if (candidate.error < best.error) best = candidate;
  }
  for (let x = sampleRadiusX; x < width - sampleRadiusX; x++) {
    const candidate = { x, y: centerY, error: score(x, centerY) };
    candidates.push(candidate);
    if (candidate.error < best.error) best = candidate;
  }
  const axisMatch = best;
  for (
    let y = Math.max(sampleRadiusY, axisMatch.y - 1);
    y <= Math.min(height - sampleRadiusY - 1, axisMatch.y + 1);
    y++
  )
    for (
      let x = Math.max(sampleRadiusX, axisMatch.x - 1);
      x <= Math.min(width - sampleRadiusX - 1, axisMatch.x + 1);
      x++
    ) {
      const error = score(x, y);
      if (error < best.error) best = { x, y, error };
    }
  const nextBestError = candidates
    .filter(
      (candidate) =>
        Math.abs(candidate.x - best.x) + Math.abs(candidate.y - best.y) > 10,
    )
    .reduce((total, candidate) => Math.min(total, candidate.error), Infinity);
  // Hide the mark when another location looks almost as likely.
  if (best.error > 12 || nextBestError < best.error + 6) return;
  const x = annotation.x + (best.x - centerX) / width,
    y = annotation.y + (best.y - centerY) / height;
  if (x < 0 || y < 0 || x + annotation.width > 1 || y + annotation.height > 1)
    return;
  return { ...annotation, x, y };
}
