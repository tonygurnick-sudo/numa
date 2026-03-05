# PptxGenJS Tutorial

Create presentations from scratch using PptxGenJS (Node.js). Use `execute_script` with `interpreter="node"` for inline code, or write a `.js` file and run with `node`.

## Setup & Basic Structure

```javascript
const pptxgen = require('pptxgenjs');

let pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10" x 5.625"
pres.author = 'Numa';
pres.title = 'Presentation Title';

let slide = pres.addSlide();
slide.addText('Hello World!', { x: 0.5, y: 0.5, fontSize: 36, color: '363636' });

pres.writeFile({ fileName: '/workdir/outputs/presentation.pptx' });
```

**Preferred:** Use `execute_script(interpreter="node", code="...")` to run this inline.

**Alternative:** Save as `/workdir/outputs/create_deck.js` and run with Bash:

```bash
node /workdir/outputs/create_deck.js
```

## Layout Dimensions

Coordinates are in inches:

- `LAYOUT_16x9`: 10" x 5.625" (default, recommended)
- `LAYOUT_16x10`: 10" x 6.25"
- `LAYOUT_4x3`: 10" x 7.5"
- `LAYOUT_WIDE`: 13.3" x 7.5"

---

## Text & Formatting

```javascript
// Basic text
slide.addText('Simple Text', {
  x: 1,
  y: 1,
  w: 8,
  h: 2,
  fontSize: 24,
  fontFace: 'Arial',
  color: '363636',
  bold: true,
  align: 'center',
  valign: 'middle',
});

// Character spacing (use charSpacing, NOT letterSpacing which is silently ignored)
slide.addText('SPACED TEXT', { x: 1, y: 1, w: 8, h: 1, charSpacing: 6 });

// Rich text arrays
slide.addText(
  [
    { text: 'Bold ', options: { bold: true } },
    { text: 'Italic ', options: { italic: true } },
  ],
  { x: 1, y: 3, w: 8, h: 1 }
);

// Multi-line text (requires breakLine: true)
slide.addText(
  [
    { text: 'Line 1', options: { breakLine: true } },
    { text: 'Line 2', options: { breakLine: true } },
    { text: 'Line 3' }, // Last item doesn't need breakLine
  ],
  { x: 0.5, y: 0.5, w: 8, h: 2 }
);

// Text box margin (internal padding)
slide.addText('Title', {
  x: 0.5,
  y: 0.3,
  w: 9,
  h: 0.6,
  margin: 0, // Use 0 when aligning text with shapes or icons
});
```

**Tip:** Text boxes have internal margin by default. Set `margin: 0` when you need text to align precisely with shapes, lines, or icons at the same x-position.

---

## Lists & Bullets

```javascript
// Correct: Multiple bullets
slide.addText([
  { text: "First item", options: { bullet: true, breakLine: true } },
  { text: "Second item", options: { bullet: true, breakLine: true } },
  { text: "Third item", options: { bullet: true } }
], { x: 0.5, y: 0.5, w: 8, h: 3 });

// NEVER use unicode bullets — creates double bullets
// WRONG: slide.addText("• First item", { ... });

// Sub-items and numbered lists
{ text: "Sub-item", options: { bullet: true, indentLevel: 1 } }
{ text: "First", options: { bullet: { type: "number" }, breakLine: true } }
```

---

## Shapes

```javascript
// Rectangle
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0.5,
  y: 0.8,
  w: 1.5,
  h: 3.0,
  fill: { color: 'FF0000' },
  line: { color: '000000', width: 2 },
});

// Oval
slide.addShape(pres.shapes.OVAL, { x: 4, y: 1, w: 2, h: 2, fill: { color: '0000FF' } });

// Line (dashed)
slide.addShape(pres.shapes.LINE, {
  x: 1,
  y: 3,
  w: 5,
  h: 0,
  line: { color: 'FF0000', width: 3, dashType: 'dash' },
});

// With transparency
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1,
  y: 1,
  w: 3,
  h: 2,
  fill: { color: '0088CC', transparency: 50 },
});

// Rounded rectangle (rectRadius only works with ROUNDED_RECTANGLE)
slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
  x: 1,
  y: 1,
  w: 3,
  h: 2,
  fill: { color: 'FFFFFF' },
  rectRadius: 0.1,
});

// With shadow
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1,
  y: 1,
  w: 3,
  h: 2,
  fill: { color: 'FFFFFF' },
  shadow: { type: 'outer', color: '000000', blur: 6, offset: 2, angle: 135, opacity: 0.15 },
});
```

### Shadow Options

| Property  | Type   | Range                        | Notes                                                    |
| --------- | ------ | ---------------------------- | -------------------------------------------------------- |
| `type`    | string | `"outer"`, `"inner"`         |                                                          |
| `color`   | string | 6-char hex (e.g. `"000000"`) | No `#` prefix, no 8-char hex                             |
| `blur`    | number | 0-100 pt                     |                                                          |
| `offset`  | number | 0-200 pt                     | Must be non-negative                                     |
| `angle`   | number | 0-359 degrees                | 135 = bottom-right, 270 = upward                         |
| `opacity` | number | 0.0-1.0                      | Use this for transparency, never encode in colour string |

**Note**: Gradient fills are not natively supported. Use a gradient image as a background instead.

---

## Images

```javascript
// From file path
slide.addImage({ path: '/workdir/uploads/chart.png', x: 1, y: 1, w: 5, h: 3 });

// From base64 (faster, no file I/O — preferred for icons)
slide.addImage({ data: 'image/png;base64,iVBORw0KGgo...', x: 1, y: 1, w: 5, h: 3 });
```

### Image Options

```javascript
slide.addImage({
  path: '/workdir/uploads/image.png',
  x: 1,
  y: 1,
  w: 5,
  h: 3,
  rotate: 45, // 0-359 degrees
  rounding: true, // Circular crop
  transparency: 50, // 0-100
  altText: 'Description', // Accessibility
});
```

### Image Sizing Modes

```javascript
// Contain — fit inside, preserve ratio
{ sizing: { type: "contain", w: 4, h: 3 } }

// Cover — fill area, preserve ratio (may crop)
{ sizing: { type: "cover", w: 4, h: 3 } }

// Crop — cut specific portion
{ sizing: { type: "crop", x: 0.5, y: 0.5, w: 2, h: 2 } }
```

### Calculate Dimensions (preserve aspect ratio)

```javascript
const origWidth = 1978,
  origHeight = 923,
  maxHeight = 3.0;
const calcWidth = maxHeight * (origWidth / origHeight);
const centerX = (10 - calcWidth) / 2;

slide.addImage({ path: '/workdir/uploads/image.png', x: centerX, y: 1.2, w: calcWidth, h: maxHeight });
```

---

## Icons (SVG + sharp)

Use inline SVGs and rasterise with `sharp` for crisp icons. No react-icons needed.

```javascript
const sharp = require('sharp');

async function svgToBase64(svgString, size = 256) {
  const buf = await sharp(Buffer.from(svgString)).resize(size, size).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}

// Example icons
const icons = {
  check: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="11" fill="#4472C4"/>
    <path d="M7 12l3 3 7-7" stroke="white" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  </svg>`,
  arrow: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="11" fill="#0D9488"/>
    <path d="M8 12h8m-3-3l3 3-3 3" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/>
  </svg>`,
  chart: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="11" fill="#065A82"/>
    <rect x="5" y="13" width="3" height="5" rx="0.5" fill="white"/>
    <rect x="10" y="9" width="3" height="9" rx="0.5" fill="white"/>
    <rect x="15" y="6" width="3" height="12" rx="0.5" fill="white"/>
  </svg>`,
  person: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="11" fill="#6D2E46"/>
    <circle cx="12" cy="9" r="3" fill="white"/>
    <path d="M6 19c0-3.3 2.7-6 6-6s6 2.7 6 6" fill="white"/>
  </svg>`,
  star: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="11" fill="#F96167"/>
    <path d="M12 4l2.5 5.1 5.6.8-4 3.9 1 5.6L12 16.8l-5.1 2.6 1-5.6-4-3.9 5.6-.8z" fill="white"/>
  </svg>`,
  lightbulb: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="11" fill="#B85042"/>
    <path d="M9 18h6m-5 2h4M12 4a5 5 0 013 9v2H9v-2a5 5 0 013-9z" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/>
  </svg>`,
};

// Usage
const iconData = await svgToBase64(icons.check);
slide.addImage({ data: iconData, x: 1, y: 1, w: 0.5, h: 0.5 });
```

Use size 256 or higher for crisp icons. The size parameter controls rasterisation resolution, not display size on the slide (which is set by `w` and `h` in inches).

To change icon colour, modify the `fill` attribute in the SVG string.

---

## Slide Backgrounds

```javascript
// Solid colour
slide.background = { color: 'F1F1F1' };

// Colour with transparency
slide.background = { color: 'FF3399', transparency: 50 };

// Image
slide.background = { data: 'image/png;base64,iVBORw0KGgo...' };
```

---

## Tables

```javascript
// Basic table
slide.addTable(
  [
    ['Header 1', 'Header 2'],
    ['Cell 1', 'Cell 2'],
  ],
  {
    x: 1,
    y: 1,
    w: 8,
    h: 2,
    border: { pt: 1, color: '999999' },
    fill: { color: 'F1F1F1' },
  }
);

// Advanced with merged cells and styling
let tableData = [
  [{ text: 'Header', options: { fill: { color: '6699CC' }, color: 'FFFFFF', bold: true } }, 'Cell'],
  [{ text: 'Merged across two columns', options: { colspan: 2 } }],
];
slide.addTable(tableData, { x: 1, y: 3.5, w: 8, colW: [4, 4] });
```

---

## Charts

```javascript
// Bar chart
slide.addChart(
  pres.charts.BAR,
  [
    {
      name: 'Sales',
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      values: [4500, 5500, 6200, 7100],
    },
  ],
  {
    x: 0.5,
    y: 0.6,
    w: 6,
    h: 3,
    barDir: 'col',
    showTitle: true,
    title: 'Quarterly Sales',
  }
);

// Line chart
slide.addChart(
  pres.charts.LINE,
  [
    {
      name: 'Temp',
      labels: ['Jan', 'Feb', 'Mar'],
      values: [32, 35, 42],
    },
  ],
  { x: 0.5, y: 4, w: 6, h: 3, lineSize: 3, lineSmooth: true }
);

// Pie chart
slide.addChart(
  pres.charts.PIE,
  [
    {
      name: 'Share',
      labels: ['A', 'B', 'Other'],
      values: [35, 45, 20],
    },
  ],
  { x: 7, y: 1, w: 5, h: 4, showPercent: true }
);

// Doughnut chart
slide.addChart(
  pres.charts.DOUGHNUT,
  [
    {
      name: 'Usage',
      labels: ['Active', 'Inactive'],
      values: [72, 28],
    },
  ],
  { x: 1, y: 1, w: 4, h: 4, showPercent: true }
);
```

### Better-Looking Charts

Default charts look dated. Apply these options for a modern appearance:

```javascript
slide.addChart(pres.charts.BAR, chartData, {
  x: 0.5,
  y: 1,
  w: 9,
  h: 4,
  barDir: 'col',

  // Custom colours (match your presentation palette)
  chartColors: ['0D9488', '14B8A6', '5EEAD4'],

  // Clean background
  chartArea: { fill: { color: 'FFFFFF' }, roundedCorners: true },

  // Muted axis labels
  catAxisLabelColor: '64748B',
  valAxisLabelColor: '64748B',

  // Subtle grid (value axis only)
  valGridLine: { color: 'E2E8F0', size: 0.5 },
  catGridLine: { style: 'none' },

  // Data labels on bars
  showValue: true,
  dataLabelPosition: 'outEnd',
  dataLabelColor: '1E293B',

  // Hide legend for single series
  showLegend: false,
});
```

---

## Slide Masters

```javascript
pres.defineSlideMaster({
  title: 'TITLE_SLIDE',
  background: { color: '283A5E' },
  objects: [
    {
      placeholder: { options: { name: 'title', type: 'title', x: 1, y: 2, w: 8, h: 2 } },
    },
  ],
});

let titleSlide = pres.addSlide({ masterName: 'TITLE_SLIDE' });
titleSlide.addText('My Title', { placeholder: 'title' });
```

---

## Common Pitfalls

These issues cause file corruption, visual bugs, or broken output. Avoid them.

1. **NEVER use "#" with hex colours** — causes file corruption

   ```javascript
   color: 'FF0000'; // CORRECT
   color: '#FF0000'; // WRONG — corrupts file
   ```

2. **NEVER encode opacity in hex colour strings** — 8-char colours (e.g., `"00000020"`) corrupt the file. Use the `opacity` property instead.

   ```javascript
   shadow: { color: "00000020" }                     // WRONG — corrupts file
   shadow: { color: "000000", opacity: 0.12 }        // CORRECT
   ```

3. **Use `bullet: true`** — NEVER unicode symbols like `"•"` (creates double bullets)

4. **Use `breakLine: true`** between array items or text runs together

5. **Avoid `lineSpacing` with bullets** — causes excessive gaps; use `paraSpaceAfter` instead

6. **Each presentation needs a fresh instance** — don't reuse `pptxgen()` objects

7. **NEVER reuse option objects across calls** — PptxGenJS mutates objects in-place. Share one object between multiple calls corrupts the second shape.

   ```javascript
   // WRONG — second call gets already-converted values
   const shadow = { type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.15 };
   slide.addShape(pres.shapes.RECTANGLE, { shadow, ... });
   slide.addShape(pres.shapes.RECTANGLE, { shadow, ... });

   // CORRECT — fresh object each time
   const makeShadow = () => ({ type: "outer", blur: 6, offset: 2, color: "000000", opacity: 0.15 });
   slide.addShape(pres.shapes.RECTANGLE, { shadow: makeShadow(), ... });
   slide.addShape(pres.shapes.RECTANGLE, { shadow: makeShadow(), ... });
   ```

8. **Don't use `ROUNDED_RECTANGLE` with accent borders** — rectangular overlay bars won't cover rounded corners. Use `RECTANGLE` instead.

9. **Shadow offset must be non-negative** — negative values corrupt the file. To cast a shadow upward, use `angle: 270` with a positive offset.

---

## Quick Reference

- **Shapes**: RECTANGLE, OVAL, LINE, ROUNDED_RECTANGLE
- **Charts**: BAR, LINE, PIE, DOUGHNUT, SCATTER, BUBBLE, RADAR
- **Layouts**: LAYOUT_16x9 (10"x5.625"), LAYOUT_16x10, LAYOUT_4x3, LAYOUT_WIDE
- **Alignment**: "left", "center", "right"
- **Vertical alignment**: "top", "middle", "bottom"
- **Chart data labels**: "outEnd", "inEnd", "center"
