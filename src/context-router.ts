// Decides which context a whiteboard question needs before anything is sent.
// ponytail: keyword stand-in for the jev decision model. It leans towards
// sending the screenshot: a false positive only costs tokens, a miss loses the
// screen. Swap the body for a jev call; callers only read these two booleans.
export type ContextRoute = { screen: boolean; course: boolean };

const pointsAtScreen =
  /\b(this|these|those|here|screen|page|slide|window|tab|above|below|highlight\w*|select\w*|shown|showing|look\w*|question|problem|exercise|q\d+|error|code|graph|chart|figure|equation)\b/i;

export function routeContext(
  question: string,
  hasCourse: boolean,
): ContextRoute {
  // The lesson model decides on its own whether to search course files.
  return { screen: pointsAtScreen.test(question), course: hasCourse };
}
