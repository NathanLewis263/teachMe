// Move away from highlights; tell the overlay to collapse if the full board cannot fit.
export type Rect = { x: number; y: number; width: number; height: number };
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// Keep the current position unless a highlighted target needs the space.
export function placeBoard(current: Rect, viewport: Rect, targets: Rect[]) {
  const inset = 12;
  const minX = viewport.x + inset,
    minY = viewport.y + inset;
  const maxX = Math.max(
    minX,
    viewport.x + viewport.width - current.width - inset,
  );
  const maxY = Math.max(
    minY,
    viewport.y + viewport.height - current.height - inset,
  );
  const clampX = (x: number) => Math.max(minX, Math.min(x, maxX));
  const clampY = (y: number) => Math.max(minY, Math.min(y, maxY));
  const start = { ...current, x: clampX(current.x), y: clampY(current.y) };
  const score = (rectangle: Rect) =>
    targets.reduce((sum, target) => sum + overlap(rectangle, target), 0);
  let best = start,
    overlapArea = score(start),
    distanceFromStart = 0;
  const candidateXs = [
    start.x,
    minX,
    maxX,
    ...targets.flatMap((target) => [
      clampX(target.x - current.width - inset),
      clampX(target.x + target.width + inset),
    ]),
  ];
  const candidateYs = [
    start.y,
    minY,
    maxY,
    ...targets.flatMap((target) => [
      clampY(target.y - current.height - inset),
      clampY(target.y + target.height + inset),
    ]),
  ];
  for (const x of candidateXs)
    for (const y of candidateYs) {
      const candidate = { ...current, x, y },
        candidateOverlap = score(candidate);
      const candidateDistance = (x - start.x) ** 2 + (y - start.y) ** 2;
      if (
        candidateOverlap < overlapArea ||
        (candidateOverlap === overlapArea &&
          candidateDistance < distanceFromStart)
      ) {
        best = candidate;
        overlapArea = candidateOverlap;
        distanceFromStart = candidateDistance;
      }
    }
  return { x: best.x, y: best.y, blocked: overlapArea > 0 };
}
