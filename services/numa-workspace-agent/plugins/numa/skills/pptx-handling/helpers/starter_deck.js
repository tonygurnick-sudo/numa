#!/usr/bin/env node
// starter_deck.js — build a branded PPTX from a JSON spec, no shape-constant churn.
//
// GENERIC HELPER (pptx-handling skill). Pass a spec describing slides; this
// renders them with consistent Numa-branded masters (title / section / content /
// chart / table / stat). It exists because hand-coding deck layout from scratch
// — shape constants, spacing, palette, value labels — was the biggest single
// time sink in deck benchmarks (53–69 turns for one generic board deck). Start
// from this; if a user needs a bespoke look, copy it to /workdir/chat-workflows/
// and adapt the masters there.
//
// Usage:
//   node starter_deck.js --spec @/workdir/tmp/deck.json
//   node starter_deck.js --spec '{"title":"Q2 Board Deck","slides":[...]}'
//
// Spec:
//   { "title": "...", "subtitle": "...", "out": "/workdir/outputs/deck.pptx",
//     "palette": { "primary":"9949AC", ... },   // optional override
//     "slides": [
//       {"type":"title","title":"...","subtitle":"..."},
//       {"type":"section","title":"Financials"},
//       {"type":"content","title":"...","bullets":["a","b"]},          // or "body":"..."
//       {"type":"chart","title":"...","image":"/workdir/outputs/c.png","caption":"..."},
//       {"type":"table","title":"...","headers":["A","B"],"rows":[["1","2"]]},
//       {"type":"stat","title":"...","stats":[{"value":"23%","label":"YoY growth"}]}
//     ] }
//
// Charts: render them first with make_chart.py, then reference the PNG via the
// "image" field — never draw chart bars as shapes/text.

const fs = require('fs');
const path = require('path');
const PptxGenJS = require('pptxgenjs');
const { PALETTE: BASE, TYPE, shape, SHAPES } = require(path.join(__dirname, 'constants.js'));

function parseArgs() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--spec');
  if (i === -1 || !argv[i + 1]) {
    console.error('Usage: node starter_deck.js --spec <json|@file>');
    process.exit(2);
  }
  let raw = argv[i + 1];
  if (raw.startsWith('@')) raw = fs.readFileSync(raw.slice(1), 'utf8');
  return JSON.parse(raw);
}

const spec = parseArgs();
const P = Object.assign({}, BASE, spec.palette || {});
const out = spec.out || '/workdir/outputs/deck.pptx';

const pptx = new PptxGenJS();
pptx.defineLayout({ name: 'NUMA', width: 13.333, height: 7.5 });
pptx.layout = 'NUMA';
const W = 13.333,
  H = 7.5,
  M = 0.6; // slide w/h and margin (inches)

// Title bar + a thin purple motif rule, repeated on content slides.
function titleBar(slide, title) {
  slide.addText(title || '', {
    x: M,
    y: 0.4,
    w: W - 2 * M,
    h: 0.9,
    fontFace: TYPE.fontHead,
    fontSize: TYPE.sectionSize,
    bold: true,
    color: P.primary,
    align: 'left',
  });
  slide.addShape(shape('rect'), { x: M, y: 1.32, w: 1.4, h: 0.05, fill: { color: P.primary } });
}

function addTitle(s) {
  const slide = pptx.addSlide();
  slide.background = { color: P.charcoal };
  slide.addShape(shape('rect'), { x: 0, y: H - 0.5, w: W, h: 0.5, fill: { color: P.primary } });
  slide.addText(s.title || spec.title || '', {
    x: M,
    y: 2.4,
    w: W - 2 * M,
    h: 1.8,
    fontFace: TYPE.fontHead,
    fontSize: TYPE.titleSize,
    bold: true,
    color: P.white,
    align: 'left',
  });
  if (s.subtitle || spec.subtitle) {
    slide.addText(s.subtitle || spec.subtitle, {
      x: M,
      y: 4.2,
      w: W - 2 * M,
      h: 0.8,
      fontFace: TYPE.fontBody,
      fontSize: TYPE.headingSize,
      color: P.lavender,
      align: 'left',
    });
  }
}

function addSection(s) {
  const slide = pptx.addSlide();
  slide.background = { color: P.primary };
  slide.addText(s.title || '', {
    x: M,
    y: 3.0,
    w: W - 2 * M,
    h: 1.4,
    fontFace: TYPE.fontHead,
    fontSize: 36,
    bold: true,
    color: P.white,
    align: 'left',
  });
}

function addContent(s) {
  const slide = pptx.addSlide();
  slide.background = { color: P.white };
  titleBar(slide, s.title);
  if (Array.isArray(s.bullets)) {
    slide.addText(
      s.bullets.map((b) => ({ text: b, options: { bullet: { code: '2022' }, color: P.bodyText } })),
      {
        x: M,
        y: 1.7,
        w: W - 2 * M,
        h: H - 2.4,
        fontFace: TYPE.fontBody,
        fontSize: TYPE.bodySize + 2,
        color: P.bodyText,
        lineSpacingMultiple: 1.3,
        valign: 'top',
      }
    );
  } else if (s.body) {
    slide.addText(s.body, {
      x: M,
      y: 1.7,
      w: W - 2 * M,
      h: H - 2.4,
      fontFace: TYPE.fontBody,
      fontSize: TYPE.bodySize + 2,
      color: P.bodyText,
      align: 'left',
      valign: 'top',
    });
  }
}

function addChart(s) {
  const slide = pptx.addSlide();
  slide.background = { color: P.white };
  titleBar(slide, s.title);
  if (s.image && fs.existsSync(s.image)) {
    // Fit within the content area, preserving aspect ratio.
    slide.addImage({
      path: s.image,
      x: M,
      y: 1.7,
      w: W - 2 * M,
      h: H - 2.6,
      sizing: { type: 'contain', w: W - 2 * M, h: H - 2.6 },
    });
  } else {
    slide.addText('[chart image missing — render it with make_chart.py first]', {
      x: M,
      y: 3.2,
      w: W - 2 * M,
      h: 0.6,
      fontSize: TYPE.bodySize,
      color: P.error,
      align: 'center',
    });
  }
  if (s.caption) {
    slide.addText(s.caption, {
      x: M,
      y: H - 0.7,
      w: W - 2 * M,
      h: 0.4,
      fontFace: TYPE.fontBody,
      fontSize: TYPE.captionSize,
      italic: true,
      color: P.bodyText,
      align: 'left',
    });
  }
}

function addTable(s) {
  const slide = pptx.addSlide();
  slide.background = { color: P.white };
  titleBar(slide, s.title);
  const header = (s.headers || []).map((h) => ({
    text: String(h),
    options: { bold: true, color: P.white, fill: { color: P.primary } },
  }));
  const body = (s.rows || []).map((row, ri) =>
    row.map((c) => ({
      text: String(c),
      options: { color: P.bodyText, fill: { color: ri % 2 ? P.warmWhite : P.white } },
    }))
  );
  slide.addTable([header, ...body], {
    x: M,
    y: 1.7,
    w: W - 2 * M,
    fontFace: TYPE.fontBody,
    fontSize: TYPE.bodySize,
    border: { type: 'solid', color: 'E5E5E5', pt: 0.5 },
    valign: 'middle',
    autoPage: true,
  });
}

function addStat(s) {
  const slide = pptx.addSlide();
  slide.background = { color: P.white };
  titleBar(slide, s.title);
  const stats = s.stats || [];
  const n = Math.max(stats.length, 1);
  const gap = 0.3;
  const cardW = (W - 2 * M - gap * (n - 1)) / n;
  stats.forEach((st, i) => {
    const x = M + i * (cardW + gap);
    slide.addShape(shape('roundRect'), {
      x,
      y: 2.2,
      w: cardW,
      h: 2.6,
      fill: { color: P.warmWhite },
      line: { color: P.lavender, width: 1 },
      rectRadius: 0.1,
    });
    slide.addText(String(st.value), {
      x,
      y: 2.7,
      w: cardW,
      h: 1.0,
      fontFace: TYPE.fontHead,
      fontSize: 44,
      bold: true,
      color: P.primary,
      align: 'center',
    });
    slide.addText(String(st.label || ''), {
      x,
      y: 3.8,
      w: cardW,
      h: 0.7,
      fontFace: TYPE.fontBody,
      fontSize: TYPE.bodySize,
      color: P.bodyText,
      align: 'center',
    });
  });
}

const RENDERERS = {
  title: addTitle,
  section: addSection,
  content: addContent,
  chart: addChart,
  table: addTable,
  stat: addStat,
};

const slides = spec.slides || [];
if (slides.length === 0 && spec.title) slides.push({ type: 'title' });
for (const s of slides) {
  const fn = RENDERERS[s.type];
  if (!fn) {
    console.error(`Unknown slide type: ${s.type} (use ${Object.keys(RENDERERS).join('/')})`);
    continue;
  }
  fn(s);
}

pptx
  .writeFile({ fileName: out })
  .then(() => {
    console.log(`Wrote deck: ${out} (${slides.length} slides)`);
  })
  .catch((err) => {
    console.error('Failed to write deck:', err.message);
    process.exit(1);
  });
