// Vice Coast Cover Studio — the cover renderer.
//
// Draws a GTA-poster-style multi-panel cover onto a canvas: several photos
// in inked panels, a Vice City sunset or neon grade per panel, a halftone
// title block with Anton display lettering and a Pacifico neon subtitle,
// a star heat meter, a badge ribbon, grain and a vignette. Everything is
// drawn with the 2D canvas API; the same function renders the live preview
// and the exported PNG, so what the editor shows is what the file holds.
//
// No Rockstar Games artwork, logo or font is used anywhere: the lettering
// is Anton and Pacifico, both shipped under the SIL Open Font License.

export const SIZES = {
  square: { w: 1080, h: 1080, label: 'Square 1080 x 1080' },
  portrait: { w: 1080, h: 1350, label: 'Portrait 1080 x 1350' },
  wide: { w: 1920, h: 1080, label: 'Wide 1920 x 1080' },
  story: { w: 1080, h: 1920, label: 'Story 1080 x 1920' },
};

export const LAYOUTS = {
  nine: 'Nine-Panel Grid',
  hero3: 'Hero + Three',
  grid4: 'Four Corners',
  full: 'Full Bleed',
  tilt: 'Tilted Snapshots',
  duo: 'Split Duo',
  strip: 'Sunset Strip',
};

export const GRADES = {
  sunset: 'Vice Sunset',
  neon: 'Neon Nights',
  gold: 'Golden Hour',
  noir: 'Palm Noir',
  bubble: 'Bubblegum',
  teal: 'Teal Heat',
};

// Each grade maps a pixel's luminance through a three-stop gradient, then
// mixes the mapped colour back with the photo's own colour so the picture
// keeps its chroma. `keep` is how much of the original colour survives.
const GRADE_DEFS = {
  sunset: { stops: ['#160a2e', '#ff7e3d', '#ffd166'], keep: 0.45, warm: 0.10 },
  neon: { stops: ['#0b1026', '#ff2e88', '#2de2ff'], keep: 0.30, warm: 0.0 },
  gold: { stops: ['#241a08', '#ffb347', '#fff3c4'], keep: 0.42, warm: 0.12 },
  noir: { stops: ['#000000', '#8a8a8a', '#fff8ec'], keep: 0.08, warm: 0.04 },
  bubble: { stops: ['#2b0f3a', '#ff6ec7', '#ffe3f2'], keep: 0.34, warm: 0.0 },
  teal: { stops: ['#04222b', '#ff8c42', '#ffe9c9'], keep: 0.34, warm: 0.05 },
};

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// A 256-entry lookup table per grade: luminance -> mapped RGB.
const gradeLuts = {};
export function gradeLut(name) {
  if (gradeLuts[name]) return gradeLuts[name];
  const def = GRADE_DEFS[name] ?? GRADE_DEFS.sunset;
  const c0 = hexRgb(def.stops[0]);
  const c1 = hexRgb(def.stops[1]);
  const c2 = hexRgb(def.stops[2]);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const rgb = t < 0.5 ? mixRgb(c0, c1, t * 2) : mixRgb(c1, c2, (t - 0.5) * 2);
    lut[i * 3] = rgb[0];
    lut[i * 3 + 1] = rgb[1];
    lut[i * 3 + 2] = rgb[2];
  }
  gradeLuts[name] = lut;
  return lut;
}

/** A tiny seeded generator, so the grain is identical on every export. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let noiseTile = null;
/** A 128 x 128 grey-noise tile, built once from the seeded generator. */
export function getNoiseTile() {
  if (noiseTile) return noiseTile;
  const rand = mulberry32(1337);
  const tile = document.createElement('canvas');
  tile.width = 128;
  tile.height = 128;
  const tctx = tile.getContext('2d');
  const img = tctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.floor(rand() * 20);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);
  noiseTile = tile;
  return tile;
}

/**
 * Geometry for one layout on a canvas of W x H. Returns the poster frame,
 * the art area, the photo panels (each with a rect in pixels), the title
 * block and the badge ribbon anchor. All coordinates are pixels.
 */
export function layoutGeometry(layout, W, H) {
  const frame = Math.round(Math.max(10, W * 0.018));
  const art = { x: frame, y: frame, w: W - frame * 2, h: H - frame * 2 };
  const titleH = Math.round(art.h * 0.17);
  const photoArea = { x: art.x, y: art.y, w: art.w, h: art.h - titleH };
  const g = Math.max(6, Math.round(W * 0.011)); // gutter between panels
  const title = { x: art.x, y: art.y + art.h - titleH, w: art.w, h: titleH };
  const badge = { x: W - frame, y: frame };
  const panels = [];
  const px = photoArea.x;
  const py = photoArea.y;
  const pw = photoArea.w;
  const ph = photoArea.h;

  if (layout === 'nine') {
    const cw = (pw - g * 2) / 3;
    const ch = (ph - g * 2) / 3;
    panels.push({ x: px, y: py, w: cw * 2 + g, h: ch * 2 + g });
    panels.push({ x: px + cw * 2 + g * 2, y: py, w: cw, h: ch });
    panels.push({ x: px + cw * 2 + g * 2, y: py + ch + g, w: cw, h: ch });
    panels.push({ x: px + cw * 2 + g * 2, y: py + ch * 2 + g * 2, w: cw, h: ch });
    panels.push({ x: px, y: py + ch * 2 + g * 2, w: cw, h: ch });
    panels.push({ x: px + cw + g, y: py + ch * 2 + g * 2, w: cw, h: ch });
  } else if (layout === 'hero3') {
    const heroW = Math.round(pw * 0.62);
    const sideW = pw - heroW - g;
    const sh = (ph - g * 2) / 3;
    panels.push({ x: px, y: py, w: heroW, h: ph });
    panels.push({ x: px + heroW + g, y: py, w: sideW, h: sh });
    panels.push({ x: px + heroW + g, y: py + sh + g, w: sideW, h: sh });
    panels.push({ x: px + heroW + g, y: py + sh * 2 + g * 2, w: sideW, h: sh });
  } else if (layout === 'grid4') {
    const cw = (pw - g) / 2;
    const ch = (ph - g) / 2;
    panels.push({ x: px, y: py, w: cw, h: ch });
    panels.push({ x: px + cw + g, y: py, w: cw, h: ch });
    panels.push({ x: px, y: py + ch + g, w: cw, h: ch });
    panels.push({ x: px + cw + g, y: py + ch + g, w: cw, h: ch });
  } else if (layout === 'full') {
    panels.push({ x: px, y: py, w: pw, h: ph });
  } else if (layout === 'tilt') {
    // A full-bleed background plus three tilted snapshot frames.
    panels.push({ x: px, y: py, w: pw, h: ph, background: true });
    const fw = pw * 0.42;
    const fh = ph * 0.42;
    panels.push({ x: px + pw * 0.06, y: py + ph * 0.10, w: fw, h: fh, tilt: -6, polaroid: true });
    panels.push({ x: px + pw * 0.52, y: py + ph * 0.06, w: fw, h: fh, tilt: 4, polaroid: true });
    panels.push({ x: px + pw * 0.28, y: py + ph * 0.46, w: fw, h: fh, tilt: -2, polaroid: true });
  } else if (layout === 'duo') {
    const cw = (pw - g) / 2;
    panels.push({ x: px, y: py, w: cw, h: ph });
    panels.push({ x: px + cw + g, y: py, w: cw, h: ph });
  } else if (layout === 'strip') {
    const bh = (ph - g * 2) / 3;
    panels.push({ x: px, y: py, w: pw, h: bh });
    panels.push({ x: px, y: py + bh + g, w: pw, h: bh });
    panels.push({ x: px, y: py + bh * 2 + g * 2, w: pw, h: bh });
  } else {
    panels.push({ x: px, y: py, w: pw, h: ph });
  }
  return { frame, art, photoArea, title, badge, panels, gutter: g };
}

/** Which panel (by index) holds point (x, y) in canvas pixels, or -1. */
export function hitPanel(layout, W, H, x, y) {
  const geo = layoutGeometry(layout, W, H);
  for (let i = geo.panels.length - 1; i >= 0; i--) {
    const p = geo.panels[i];
    if (p.background) continue;
    if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return i;
  }
  return -1;
}

/**
 * Draws `img` into an offscreen context of ow x oh, cover-fitting with a
 * focus point in the photo's own fractions, then the user's zoom and pan
 * offsets. The focus keeps heads in frame when a portrait photo fills a
 * wide panel: a face sits in the photo's top third, and a wide panel only
 * shows about a third of the photo's height, so fy 0.05 anchors the crop
 * near the top of the photo instead of the middle. (fy 0.35 put the band
 * below the face: only the mouth and chin showed in the hero panel.)
 */
export function coverDrawImage(octx, img, ow, oh, zoom, ox, oy) {
  const base = Math.max(ow / img.naturalWidth, oh / img.naturalHeight);
  const scale = base * (zoom || 1);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  const fx = 0.5;
  const fy = 0.05;
  let dx = dw > ow ? -(dw - ow) * fx : (ow - dw) / 2;
  let dy = dh > oh ? -(dh - oh) * fy : (oh - dh) / 2;
  dx += (ox || 0) * ow * 0.5;
  dy += (oy || 0) * oh * 0.5;
  octx.drawImage(img, dx, dy, dw, dh);
}

/**
 * Draws one photo into a panel rect, graded, with an inked outline and a
 * hard offset shadow. `panel` is {photo, zoom, ox, oy} plus the geometry
 * rect; `img` is the loaded image (or null for an empty panel).
 */
export function drawPanel(ctx, geo, panel, img, gradeName) {
  const { x, y, w, h } = panel;
  const ink = Math.max(3, Math.round(geo.art.w * 0.006));
  // Hard poster shadow, offset down-right.
  ctx.fillStyle = 'rgba(16, 12, 26, 0.85)';
  ctx.fillRect(x + ink, y + ink, w, h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (img) {
    const off = document.createElement('canvas');
    const ow = Math.max(2, Math.round(w));
    const oh = Math.max(2, Math.round(h));
    off.width = ow;
    off.height = oh;
    const octx = off.getContext('2d');
    coverDrawImage(octx, img, ow, oh, panel.zoom, panel.ox, panel.oy);
    applyGrade(octx, ow, oh, gradeName);
    ctx.drawImage(off, x, y);
  } else {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, '#3a2b52');
    grad.addColorStop(1, '#1c1428');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `600 ${Math.max(14, Math.round(h * 0.09))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ADD A PHOTO', x + w / 2, y + h / 2);
  }
  ctx.restore();
  // Inked outline around the panel.
  ctx.lineWidth = ink;
  ctx.strokeStyle = '#100c1a';
  ctx.strokeRect(x + ink / 2, y + ink / 2, w - ink, h - ink);
}

/** Applies a grade's gradient map to the pixels of an offscreen context. */
export function applyGrade(octx, w, h, gradeName) {
  const def = GRADE_DEFS[gradeName] ?? GRADE_DEFS.sunset;
  const lut = gradeLut(gradeName);
  const keep = def.keep;
  const img = octx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    const li = lum * 3;
    d[i] = lut[li] * (1 - keep) + r * keep;
    d[i + 1] = lut[li + 1] * (1 - keep) + g * keep;
    d[i + 2] = lut[li + 2] * (1 - keep) + b * keep;
  }
  octx.putImageData(img, 0, 0);
  // Warm wash over the top for the sunset grades.
  if (def.warm > 0) {
    const wash = octx.createLinearGradient(0, 0, 0, h);
    wash.addColorStop(0, `rgba(255, 150, 60, ${def.warm})`);
    wash.addColorStop(1, 'rgba(255, 60, 140, 0)');
    octx.fillStyle = wash;
    octx.fillRect(0, 0, w, h);
  }
}

/** A five-point star path centred at (cx, cy) with outer radius r. */
export function starPath(ctx, cx, cy, r) {
  const inner = r * 0.42;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const sx = cx + Math.cos(a) * rad;
    const sy = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
}

/** Draws the heat meter: five stars, `filled` of them lit gold. */
export function drawHeatMeter(ctx, x, y, size, filled) {
  for (let i = 0; i < 5; i++) {
    const cx = x + i * size * 1.25 + size / 2;
    starPath(ctx, cx, y + size / 2, size / 2);
    if (i < filled) {
      ctx.fillStyle = '#ffd166';
      ctx.fill();
      ctx.lineWidth = Math.max(1, size * 0.08);
      ctx.strokeStyle = '#100c1a';
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.lineWidth = Math.max(1, size * 0.08);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.stroke();
    }
  }
}

/** Halftone dots across a band: rows of dots that grow toward the bottom. */
export function drawHalftone(ctx, x, y, w, h, color, maxR) {
  const step = Math.max(10, maxR * 2.4);
  ctx.fillStyle = color;
  let row = 0;
  for (let cy = y + step / 2; cy < y + h; cy += step, row++) {
    const t = (cy - y) / h;
    const r = Math.max(0.6, maxR * (0.25 + t * 0.9));
    const off = row % 2 === 0 ? 0 : step / 2;
    for (let cx = x + step / 2 + off; cx < x + w; cx += step) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Fits the title to the band width and draws it in Anton with a sunset fill. */
export function drawTitleText(ctx, text, x, y, w, h, gradeName) {
  const words = (text || 'VICE COAST').trim().toUpperCase();
  let size = h * 0.62;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const setFont = () => { ctx.font = `${size}px Anton, 'Arial Black', sans-serif`; };
  setFont();
  while (ctx.measureText(words).width > w && size > 10) {
    size -= 2;
    setFont();
  }
  const grad = ctx.createLinearGradient(x, y - h / 2, x, y + h / 2);
  if (gradeName === 'neon') {
    grad.addColorStop(0, '#7df9ff');
    grad.addColorStop(0.55, '#ff5da2');
    grad.addColorStop(1, '#ffd166');
  } else if (gradeName === 'noir') {
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, '#cfc4ae');
  } else {
    grad.addColorStop(0, '#ffe9a8');
    grad.addColorStop(0.5, '#ff8a3d');
    grad.addColorStop(1, '#ff2e88');
  }
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.015);
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(words, 0, 0);
  ctx.fillStyle = grad;
  ctx.fillText(words, 0, 0);
  ctx.restore();
}

/** The title block: dark ink, halftone dots, title, script subtitle, stars. */
export function drawTitleBlock(ctx, geo, state) {
  const t = geo.title;
  const pad = Math.max(10, geo.art.w * 0.02);
  ctx.fillStyle = '#14101f';
  ctx.fillRect(t.x, t.y, t.w, t.h);
  // Accent stripe along the top of the block.
  const stripe = ctx.createLinearGradient(t.x, 0, t.x + t.w, 0);
  stripe.addColorStop(0, '#ff5e62');
  stripe.addColorStop(0.5, '#ff9a3d');
  stripe.addColorStop(1, '#ff2e88');
  ctx.fillStyle = stripe;
  ctx.fillRect(t.x, t.y, t.w, Math.max(3, t.h * 0.06));
  drawHalftone(ctx, t.x, t.y + t.h * 0.45, t.w, t.h * 0.55, 'rgba(255, 94, 98, 0.20)', Math.max(2, t.h * 0.05));

  const leftW = t.w * 0.68;
  drawTitleText(ctx, state.title, t.x + pad, t.y + t.h * 0.42, leftW - pad, t.h * 0.52, state.grade);

  const sub = (state.subtitle || '').trim();
  if (sub) {
    ctx.font = `${Math.max(12, t.h * 0.24)}px Pacifico, cursive`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff2e88';
    ctx.shadowBlur = Math.max(6, t.h * 0.12);
    ctx.fillStyle = '#ff8ac2';
    ctx.fillText(sub, t.x + pad + 4, t.y + t.h * 0.82);
    ctx.shadowBlur = 0;
  }

  // Right side: heat meter and badge line.
  const rightX = t.x + t.w * 0.72;
  const starSize = Math.max(12, t.h * 0.2);
  drawHeatMeter(ctx, rightX, t.y + t.h * 0.22, starSize, 4);
  ctx.font = `600 ${Math.max(10, t.h * 0.16)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText((state.badge || 'VICE COAST').toUpperCase(), rightX, t.y + t.h * 0.74);
}

/** The corner ribbon: a tilted pill with the badge text. */
export function drawBadgeRibbon(ctx, geo, state) {
  const text = (state.badge || 'VICE COAST').trim().toUpperCase();
  if (!text) return;
  const h = Math.max(18, geo.art.w * 0.038);
  ctx.font = `${Math.round(h * 0.52)}px Anton, 'Arial Black', sans-serif`;
  const tw = ctx.measureText(text).width;
  const w = tw + h * 1.6;
  const cx = geo.art.x + geo.art.w - w / 2 + h * 0.4;
  const cy = geo.art.y + h * 0.4;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(0.06);
  ctx.fillStyle = '#ff2e88';
  ctx.beginPath();
  ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
  ctx.fill();
  ctx.lineWidth = Math.max(2, h * 0.08);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, 1);
  ctx.restore();
}

/**
 * Draws the whole cover. `state` is {layout, grade, title, subtitle, badge,
 * panels: [{photo, zoom, ox, oy}]}; `photos` maps a photo index to a loaded
 * image (or null). The canvas keeps its own pixel size.
 */
export function drawCover(canvas, state, photos) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const geo = layoutGeometry(state.layout, W, H);

  // Poster frame: white border around everything.
  ctx.fillStyle = '#f7f2ea';
  ctx.fillRect(0, 0, W, H);

  // Panels, background first.
  const panels = geo.panels;
  for (let i = 0; i < panels.length; i++) {
    const p = panels[i];
    const spec = state.panels[i] || { photo: 0, zoom: 1, ox: 0, oy: 0 };
    const img = photos[spec.photo] ?? null;
    if (p.background) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x, p.y, p.w, p.h);
      ctx.clip();
      if (img) {
        const off = document.createElement('canvas');
        off.width = Math.max(2, Math.round(p.w));
        off.height = Math.max(2, Math.round(p.h));
        const octx = off.getContext('2d');
        coverDrawImage(octx, img, p.w, p.h, 1, 0, 0);
        applyGrade(octx, off.width, off.height, state.grade);
        ctx.drawImage(off, p.x, p.y);
      } else {
        ctx.fillStyle = '#241a33';
        ctx.fillRect(p.x, p.y, p.w, p.h);
      }
      ctx.fillStyle = 'rgba(10, 6, 20, 0.42)';
      ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.restore();
      continue;
    }
    if (p.polaroid) {
      // Tilted snapshot: white polaroid border, slight rotation, shadow.
      const bw = Math.max(4, Math.round(p.w * 0.045));
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate(((p.tilt || 0) * Math.PI) / 180);
      ctx.fillStyle = 'rgba(16, 12, 26, 0.5)';
      ctx.fillRect(-p.w / 2 + 8, -p.h / 2 + 10, p.w, p.h);
      ctx.fillStyle = '#fdfbf6';
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
      const inner = {
        x: p.x + bw,
        y: p.y + bw,
        w: p.w - bw * 2,
        h: p.h - bw * 2 - bw * 1.4,
      };
      const tilted = { ...inner, tilt: p.tilt };
      ctx.save();
      ctx.translate(p.x + p.w / 2, p.y + p.h / 2);
      ctx.rotate(((p.tilt || 0) * Math.PI) / 180);
      ctx.translate(-(p.x + p.w / 2), -(p.y + p.h / 2));
      drawPanel(ctx, geo, tilted, img, state.grade);
      ctx.restore();
      continue;
    }
    drawPanel(ctx, geo, p, img, state.grade);
  }

  drawTitleBlock(ctx, geo, state);
  drawBadgeRibbon(ctx, geo, state);

  // Grain, then a vignette, so the whole poster feels printed.
  const tile = getNoiseTile();
  const pattern = ctx.createPattern(tile, 'repeat');
  ctx.save();
  ctx.globalAlpha = 0.05;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  const vig = ctx.createRadialGradient(
    W / 2, H / 2, Math.min(W, H) * 0.42,
    W / 2, H / 2, Math.max(W, H) * 0.72,
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(10,5,20,0.30)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);
}
