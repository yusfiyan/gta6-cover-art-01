// Vice Coast Cover Studio — the editor wiring.
//
// Owns the cover state, the live preview, the panel tools (click to select,
// drag to move a photo, scroll to zoom), undo/redo, and the PNG export.
// The cover itself is drawn by ./cover.js; this file only drives it.

import { drawCover, hitPanel, layoutGeometry, SIZES, LAYOUTS, GRADES } from './cover.js';
import { runShot } from './shots.js';

const $ = (id) => document.getElementById(id);
const preview = $('preview');
const status = $('status');

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

function defaultPanels() {
  // One spec per panel slot (layouts use at most nine); photos alternate
  // between the first two slots so a fresh cover already looks multi-photo.
  return Array.from({ length: 9 }, (_, i) => ({
    photo: i % 2 === 0 ? 0 : 1,
    zoom: 1,
    ox: 0,
    oy: 0,
  }));
}

function defaultState() {
  return {
    layout: 'nine',
    grade: 'sunset',
    size: 'square',
    title: 'VICE COAST',
    subtitle: 'neon nights',
    badge: 'VICE COAST',
    panels: defaultPanels(),
  };
}

let state = defaultState();
// Three photo slots; each holds {img, name} or null.
const photos = [null, null, null];
const SAMPLES = ['samples/boulevard.jpg', 'samples/pier.jpg', 'samples/boulevard.jpg'];
const SAMPLE_NAMES = ['boulevard', 'pier', 'boulevard'];

let selectedPanel = 0;
let undoStack = [];
let redoStack = [];
let gestureSnapshot = null;
let renderQueued = false;

function serialize() {
  return JSON.stringify(state);
}

function applySnapshot(json) {
  state = JSON.parse(json);
  syncControls();
  render();
}

function commit() {
  undoStack.push(serialize());
  if (undoStack.length > 50) undoStack.shift();
  redoStack = [];
  syncUndoButtons();
}

function beginGesture() {
  gestureSnapshot = serialize();
}

function endGesture() {
  if (gestureSnapshot !== null && gestureSnapshot !== serialize()) {
    undoStack.push(gestureSnapshot);
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
    syncUndoButtons();
  }
  gestureSnapshot = null;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(serialize());
  applySnapshot(undoStack.pop());
  syncUndoButtons();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(serialize());
  applySnapshot(redoStack.pop());
  syncUndoButtons();
}

function syncUndoButtons() {
  $('undoBtn').disabled = undoStack.length === 0;
  $('redoBtn').disabled = redoStack.length === 0;
}

function photoImages() {
  return photos.map((p) => (p ? p.img : null));
}

function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    drawCover(preview, state, photoImages());
  });
}

function fitPreview() {
  const size = SIZES[state.size];
  const long = 760;
  if (size.w >= size.h) {
    preview.width = long;
    preview.height = Math.round((long * size.h) / size.w);
  } else {
    preview.height = long;
    preview.width = Math.round((long * size.w) / size.h);
  }
  render();
}

function panelCount() {
  return layoutGeometry(state.layout, 10, 10).panels.length;
}

function syncControls() {
  document.querySelectorAll('#layoutPicker button').forEach((b) => {
    b.classList.toggle('active', b.dataset.layout === state.layout);
  });
  document.querySelectorAll('#gradePicker button').forEach((b) => {
    b.classList.toggle('active', b.dataset.grade === state.grade);
  });
  document.querySelectorAll('#sizePicker button').forEach((b) => {
    b.classList.toggle('active', b.dataset.size === state.size);
  });
  $('titleInput').value = state.title;
  $('subtitleInput').value = state.subtitle;
  $('badgeInput').value = state.badge;
  if (selectedPanel >= panelCount()) selectedPanel = 0;
  syncPanelControls();
}

function syncPanelControls() {
  const spec = state.panels[selectedPanel];
  const label = $('panelLabel');
  const names = {
    nine: 'Nine-Panel Grid',
    hero3: 'Hero + Three',
    grid4: 'Four Corners',
    full: 'Full Bleed',
    tilt: 'Tilted Snapshots',
    duo: 'Split Duo',
    strip: 'Sunset Strip',
  };
  label.textContent = `Panel ${selectedPanel + 1} of ${panelCount()} · ${names[state.layout]} — drag the photo to move it, scroll to zoom.`;
  const select = $('panelPhoto');
  select.innerHTML = '';
  photos.forEach((p, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = p ? `Photo ${i + 1} — ${p.name}` : `Photo ${i + 1} — empty`;
    select.appendChild(opt);
  });
  const empty = document.createElement('option');
  empty.value = '-1';
  empty.textContent = 'Empty panel';
  select.appendChild(empty);
  select.value = String(spec.photo);
  $('zoomRange').value = String(spec.zoom);
  $('oxRange').value = String(spec.ox);
  $('oyRange').value = String(spec.oy);
}

function syncThumbs() {
  photos.forEach((p, i) => {
    const thumb = $(`thumb${i}`);
    if (p) {
      thumb.src = p.img.src;
      thumb.classList.add('filled');
    } else {
      thumb.removeAttribute('src');
      thumb.classList.remove('filled');
    }
  });
}

async function setSlot(i, img, name) {
  photos[i] = img ? { img, name } : null;
  syncThumbs();
  syncPanelControls();
  render();
}

async function loadSample(i) {
  try {
    const img = await loadImage(SAMPLES[i]);
    await setSlot(i, img, SAMPLE_NAMES[i]);
    status.textContent = `Photo ${i + 1}: sample ${SAMPLE_NAMES[i]} loaded.`;
  } catch {
    status.textContent = `Could not load sample ${SAMPLE_NAMES[i]}.`;
  }
}

async function exportCover(sizeKey) {
  const size = SIZES[sizeKey];
  const off = document.createElement('canvas');
  off.width = size.w;
  off.height = size.h;
  drawCover(off, { ...state, size: sizeKey }, photoImages());
  const blob = await new Promise((resolve) => off.toBlob(resolve, 'image/png'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vice-coast-${sizeKey}-${size.w}x${size.h}.png`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  status.textContent = `Saved vice-coast-${sizeKey}-${size.w}x${size.h}.png`;
  return blob;
}

// --- controls ------------------------------------------------------------

document.querySelectorAll('#layoutPicker button').forEach((b) => {
  b.addEventListener('click', () => {
    if (state.layout === b.dataset.layout) return;
    commit();
    state.layout = b.dataset.layout;
    selectedPanel = 0;
    syncControls();
    render();
  });
});

document.querySelectorAll('#gradePicker button').forEach((b) => {
  b.addEventListener('click', () => {
    if (state.grade === b.dataset.grade) return;
    commit();
    state.grade = b.dataset.grade;
    syncControls();
    render();
  });
});

document.querySelectorAll('#sizePicker button').forEach((b) => {
  b.addEventListener('click', () => {
    if (state.size === b.dataset.size) return;
    commit();
    state.size = b.dataset.size;
    fitPreview();
    syncControls();
  });
});

$('titleInput').addEventListener('input', () => {
  state.title = $('titleInput').value;
  render();
});
$('titleInput').addEventListener('change', () => {
  if (gestureSnapshot !== null) endGesture();
});
$('titleInput').addEventListener('focus', () => beginGesture());
$('subtitleInput').addEventListener('input', () => {
  state.subtitle = $('subtitleInput').value;
  render();
});
$('subtitleInput').addEventListener('focus', () => beginGesture());
$('subtitleInput').addEventListener('change', () => endGesture());
$('badgeInput').addEventListener('input', () => {
  state.badge = $('badgeInput').value;
  render();
});
$('badgeInput').addEventListener('focus', () => beginGesture());
$('badgeInput').addEventListener('change', () => endGesture());

$('panelPhoto').addEventListener('change', () => {
  commit();
  state.panels[selectedPanel].photo = Number($('panelPhoto').value);
  render();
});

for (const [id, key] of [['zoomRange', 'zoom'], ['oxRange', 'ox'], ['oyRange', 'oy']]) {
  const el = $(id);
  el.addEventListener('pointerdown', () => beginGesture());
  el.addEventListener('input', () => {
    state.panels[selectedPanel][key] = Number(el.value);
    render();
  });
  el.addEventListener('change', () => endGesture());
}

$('fillAllBtn').addEventListener('click', () => {
  commit();
  const photo = state.panels[selectedPanel].photo;
  state.panels.forEach((p) => { p.photo = photo; });
  render();
  status.textContent = 'Every panel now uses the selected photo.';
});

for (let i = 0; i < 3; i++) {
  $(`file${i}`).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const img = await loadImage(URL.createObjectURL(file));
      await setSlot(i, img, file.name.replace(/\.[^.]+$/, ''));
      status.textContent = `Photo ${i + 1}: ${file.name} loaded.`;
    } catch {
      status.textContent = `Could not read ${file.name}.`;
    }
  });
  $(`sample${i}`).addEventListener('click', () => loadSample(i));
}

$('undoBtn').addEventListener('click', undo);
$('redoBtn').addEventListener('click', redo);
$('resetBtn').addEventListener('click', () => {
  commit();
  state = defaultState();
  selectedPanel = 0;
  fitPreview();
  syncControls();
  status.textContent = 'Back to the starting cover.';
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  }
});

$('exportBtn').addEventListener('click', () => exportCover(state.size));
$('exportAllBtn').addEventListener('click', async () => {
  status.textContent = 'Exporting all four sizes…';
  for (const key of Object.keys(SIZES)) {
    await exportCover(key);
    await new Promise((r) => window.setTimeout(r, 250));
  }
  status.textContent = 'Saved all four sizes as PNG.';
});

// --- canvas interaction: click to select, drag to move, scroll to zoom ---

function canvasPoint(e) {
  const rect = preview.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) * preview.width) / rect.width,
    y: ((e.clientY - rect.top) * preview.height) / rect.height,
  };
}

let dragging = null;
preview.addEventListener('pointerdown', (e) => {
  const p = canvasPoint(e);
  const hit = hitPanel(state.layout, preview.width, preview.height, p.x, p.y);
  if (hit >= 0) {
    selectedPanel = hit;
    syncPanelControls();
  }
  beginGesture();
  dragging = { x: p.x, y: p.y, panel: hit };
  preview.setPointerCapture(e.pointerId);
});

preview.addEventListener('pointermove', (e) => {
  if (!dragging || dragging.panel < 0) return;
  const p = canvasPoint(e);
  const geo = layoutGeometry(state.layout, preview.width, preview.height);
  const rect = geo.panels[dragging.panel];
  const spec = state.panels[dragging.panel];
  spec.ox += ((p.x - dragging.x) / (rect.w * 0.5));
  spec.oy += ((p.y - dragging.y) / (rect.h * 0.5));
  spec.ox = Math.max(-1, Math.min(1, spec.ox));
  spec.oy = Math.max(-1, Math.min(1, spec.oy));
  dragging.x = p.x;
  dragging.y = p.y;
  syncPanelControls();
  render();
});

preview.addEventListener('pointerup', () => {
  dragging = null;
  endGesture();
});

preview.addEventListener('wheel', (e) => {
  e.preventDefault();
  const p = canvasPoint(e);
  const hit = hitPanel(state.layout, preview.width, preview.height, p.x, p.y);
  if (hit < 0) return;
  beginGesture();
  const spec = state.panels[hit];
  spec.zoom = Math.max(0.6, Math.min(3, spec.zoom * Math.exp(-e.deltaY * 0.0012)));
  selectedPanel = hit;
  syncPanelControls();
  render();
  endGesture();
}, { passive: false });

// --- start ---------------------------------------------------------------

const query = new URLSearchParams(location.search);
const shot = query.get('shot');

async function start() {
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('40px Anton'),
        document.fonts.load('40px Pacifico'),
        document.fonts.ready,
      ]),
      new Promise((r) => window.setTimeout(r, 3000)),
    ]);
  } catch {
    // A missing font falls back to the system sans; the cover still draws.
  }
  await loadSample(0);
  await loadSample(1);
  fitPreview();
  syncControls();
  syncUndoButtons();
  status.textContent = 'Two sample photos loaded — pick a layout, a grade, and export.';
  window.__appReady = true;
  if (shot) {
    runShot(shot, query, {
      state,
      setState(next) {
        // Mutate in place so the api object always sees the live state.
        Object.assign(state, next);
        selectedPanel = 0;
        fitPreview();
        syncControls();
      },
      exportCover,
      render,
    });
  }
}

start();
