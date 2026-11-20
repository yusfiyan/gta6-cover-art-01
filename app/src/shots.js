// Fixed scenes for screenshots: ?shot=editor shows the editor with the
// sample photos loaded; ?shot=cover shows one exported-style cover alone,
// sized by the `size` query (square, portrait, wide, story) with the
// layout, grade and caption from the query. window.__shotReady is set once
// the scene has painted, so a screenshot tool can wait on it.
import { SIZES } from './cover.js';

function readState(query) {
  const next = {};
  for (const key of ['layout', 'grade', 'size', 'title', 'subtitle', 'badge']) {
    const v = query.get(key);
    if (v !== null) next[key] = v;
  }
  return next;
}

export async function runShot(shot, query, api) {
  const canvas = document.getElementById('preview');
  if (shot === 'cover') {
    document.body.classList.add('shot-cover');
    const sizeKey = query.get('size') || 'square';
    const size = SIZES[sizeKey] || SIZES.square;
    canvas.width = size.w;
    canvas.height = size.h;
    const next = readState(query);
    next.size = sizeKey;
    api.setState(next);
    const hero = query.get('hero');
    if (hero !== null) {
      const spec = api.state.panels[0];
      if (spec) spec.photo = Number(hero) || 0;
      api.render();
    }
  } else {
    // Editor scene: the app as the user sees it, with a named cover.
    const next = readState(query);
    if (Object.keys(next).length) api.setState(next);
  }
  try {
    await Promise.race([
      document.fonts.ready,
      new Promise((r) => window.setTimeout(r, 2000)),
    ]);
  } catch {
    // Fall back to system fonts; the scene still paints.
  }
  api.render();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__shotReady = true;
  }));
}
