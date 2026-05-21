/**
 * Constellation — generic SVG renderer for "things orbiting a center" maps.
 *
 * Data-agnostic: takes pre-computed planets (with ring index, fill, size,
 * badge, tooltip lines) plus the four ring labels. Used by:
 *   - FleetMapTab at aggregate level → planets are clients
 *   - FleetMapTab at single-client level → planets are users of that client
 *
 * Owns geometry (ring radii, planet positioning, label placement, hover/
 * select interactions). Doesn't know about FleetMapMetrics or UserMapMetrics
 * — the caller does the encoding.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { ND_COLORS } from './theme';

export type BadgeDirection = 'up' | 'down' | null;

/** Pre-computed planet ready for SVG rendering. */
export interface ConstellationPlanet {
  /** Stable identity for selection + React keys. */
  key: string;
  /** 0 = innermost ring, 3 = outermost. Out-of-range values are dropped. */
  ringIndex: number;
  /** SVG pixel radius (already √-scaled and clamped by the caller). */
  sizeR: number;
  /** Planet fill colour. */
  fillColor: string;
  /** Optional directional badge for "something shifted recently". */
  badge: BadgeDirection;
  /** Optional short label rendered next to the planet (radially outward). */
  label?: string;
  /** Lines for the hover tooltip. First line is rendered as a title. */
  tooltipLines: string[];
}

interface ConstellationProps {
  planets: ConstellationPlanet[];
  /** Ring labels innermost → outermost (length 4). */
  ringLabels: readonly [string, string, string, string];
  /** Label rendered inside the central sun. */
  centerLabel: string;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

// ─── geometry ───────────────────────────────────────────────────────────

const VIEWBOX_W = 900;
const VIEWBOX_H = 700;
const CX = VIEWBOX_W / 2;
const CY = VIEWBOX_H / 2;

// Ring centre radii (closer to center = healthier / more efficient).
const RING_RADII = [100, 170, 235, 295] as const;
// Visual ring boundary radii (drawn as faint dashed circles).
const RING_BOUNDARIES = [70, 135, 200, 265, 320] as const;

const NUMA_RADIUS = 38;

const MIN_PLANET_R = 5;
const MAX_PLANET_R = 24;

/** √-scaled planet pixel radius given a raw metric value and its fleet max.
 *  Exposed so callers can prepare planet sizes without duplicating the math. */
export function scalePlanetRadius(value: number, max: number): number {
  if (max <= 0) return MIN_PLANET_R;
  const norm = Math.sqrt(Math.max(0, value) / max);
  return MIN_PLANET_R + norm * (MAX_PLANET_R - MIN_PLANET_R);
}

// ─── layout ─────────────────────────────────────────────────────────────

interface PlacedPlanet extends ConstellationPlanet {
  x: number;
  y: number;
  /** Angle from constellation centre — used to position the label radially
   *  outward on whichever side of the centre the planet sits on. */
  angle: number;
}

function placePlanets(planets: ConstellationPlanet[]): PlacedPlanet[] {
  // Group by ring, sort alphabetically (by key) within ring for stable layout.
  const buckets: ConstellationPlanet[][] = RING_RADII.map(() => []);
  for (const p of planets) {
    if (p.ringIndex < 0 || p.ringIndex >= buckets.length) continue;
    buckets[p.ringIndex].push(p);
  }
  for (const b of buckets) b.sort((a, c) => a.key.localeCompare(c.key));

  const out: PlacedPlanet[] = [];
  buckets.forEach((bucket, ringIdx) => {
    const radius = RING_RADII[ringIdx];
    const n = bucket.length;
    bucket.forEach((p, i) => {
      // Start at top (-π/2), evenly distribute around the ring.
      const angle = -Math.PI / 2 + ((i + 0.5) / n) * Math.PI * 2;
      const x = CX + Math.cos(angle) * radius;
      const y = CY + Math.sin(angle) * radius;
      out.push({ ...p, x, y, angle });
    });
  });
  return out;
}

// ─── component ──────────────────────────────────────────────────────────

interface HoverState {
  key: string;
}

export function Constellation({ planets, ringLabels, centerLabel, selectedKey, onSelect }: ConstellationProps) {
  const placed = useMemo(() => placePlanets(planets), [planets]);
  const [hover, setHover] = useState<HoverState | null>(null);

  const isolating = selectedKey !== null;
  const hoveredPlanet = hover ? placed.find((p) => p.key === hover.key) : null;

  // Shrink the centre label / glyph when the label is long (e.g. a 25-char
  // client name) so it still fits inside the sun.
  const centerFontSize = centerLabel.length > 10 ? 11 : centerLabel.length > 6 ? 13 : 16;

  return (
    <div className="fm-constellation-wrap">
      <svg
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        className="fm-constellation-svg"
        preserveAspectRatio="xMidYMid meet"
        onClick={() => onSelect(null)}
      >
        <defs>
          <radialGradient id="fm-numa-grad" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="#DFBDE7" />
            <stop offset="60%" stopColor="#9949AC" />
            <stop offset="100%" stopColor="#7D3490" />
          </radialGradient>
          <radialGradient id="fm-numa-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(153, 73, 172, 0.35)" />
            <stop offset="100%" stopColor="rgba(153, 73, 172, 0)" />
          </radialGradient>
        </defs>

        {/* Subtle background glow behind the centre */}
        <circle cx={CX} cy={CY} r={NUMA_RADIUS + 60} fill="url(#fm-numa-glow)" />

        {/* Concentric ring boundaries — faint dashed guides */}
        {RING_BOUNDARIES.map((r) => (
          <circle
            key={r}
            cx={CX}
            cy={CY}
            r={r}
            fill="none"
            stroke="rgba(31, 31, 31, 0.08)"
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        ))}

        {/* Planets */}
        {placed.map((p) => {
          const isSelected = p.key === selectedKey;
          const isHovered = hover?.key === p.key;
          const dim = isolating && !isSelected;
          const opacity = dim ? 0.15 : isHovered || isSelected ? 1 : 0.92;
          return (
            <g
              key={p.key}
              transform={`translate(${p.x}, ${p.y})`}
              className="fm-planet-group"
              opacity={opacity}
              onMouseEnter={() => setHover({ key: p.key })}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(p.key === selectedKey ? null : p.key);
              }}
              style={{ cursor: 'pointer' }}
            >
              {isSelected && (
                <circle
                  r={p.sizeR + 10}
                  fill="none"
                  stroke={p.fillColor}
                  strokeWidth={2}
                  opacity={0.45}
                  className="fm-selected-halo"
                />
              )}
              <circle
                r={p.sizeR}
                fill={p.fillColor}
                stroke={isSelected || isHovered ? '#1F1F1F' : 'rgba(255,255,255,0.85)'}
                strokeWidth={isSelected ? 2 : 1}
                style={{ transition: 'r 150ms ease' }}
              />
              <circle
                r={p.sizeR * 0.5}
                cx={-p.sizeR * 0.25}
                cy={-p.sizeR * 0.25}
                fill="rgba(255, 255, 255, 0.25)"
                pointerEvents="none"
              />
              {p.badge && <ChevronBadge direction={p.badge} planetR={p.sizeR} />}
              {p.label && <PlanetLabel label={p.label} planetR={p.sizeR} angle={p.angle} />}
            </g>
          );
        })}

        {/* Ring labels — render AFTER planets so they sit on top, with pill
            backgrounds so any incidental planet overlap stays readable. All
            stacked straight above the centre, in the gap between planet
            bands. */}
        {RING_RADII.map((_r, i) => {
          const labelText = ringLabels[i];
          const labelR =
            i < RING_BOUNDARIES.length - 1 ? RING_BOUNDARIES[i + 1] : RING_BOUNDARIES[RING_BOUNDARIES.length - 1] + 15;
          const lx = CX;
          const ly = CY - labelR;
          const w = labelText.length * 6.8 + 18;
          const h = 18;
          return (
            <g key={`label-${i}`} opacity={isolating ? 0.3 : 1} className="fm-ring-label-group" pointerEvents="none">
              <rect
                x={lx - w / 2}
                y={ly - h / 2}
                width={w}
                height={h}
                rx={9}
                fill="rgba(247, 245, 241, 0.94)"
                stroke="rgba(31, 31, 31, 0.10)"
                strokeWidth={1}
              />
              <text x={lx} y={ly + 4} textAnchor="middle" className="fm-ring-label">
                {labelText}
              </text>
            </g>
          );
        })}

        {/* Centre — render LAST so it sits on top of overlapping planets. */}
        <g>
          <circle cx={CX} cy={CY} r={NUMA_RADIUS} fill="url(#fm-numa-grad)" stroke="#7D3490" strokeWidth={1.5} />
          <text x={CX} y={CY + 5} textAnchor="middle" className="fm-numa-label" fontSize={centerFontSize}>
            {centerLabel}
          </text>
        </g>

        {hoveredPlanet && hoveredPlanet.tooltipLines.length > 0 && (
          <g pointerEvents="none">
            <TooltipBlock
              x={hoveredPlanet.x}
              y={hoveredPlanet.y}
              planetR={hoveredPlanet.sizeR}
              lines={hoveredPlanet.tooltipLines}
            />
          </g>
        )}
      </svg>
    </div>
  );
}

// ─── badge ──────────────────────────────────────────────────────────────

interface ChevronBadgeProps {
  direction: 'up' | 'down';
  planetR: number;
}

function ChevronBadge({ direction, planetR }: ChevronBadgeProps) {
  const offset = planetR * 0.7;
  const badgeR = 7;
  const isUp = direction === 'up';
  const fill = isUp ? ND_COLORS.good : ND_COLORS.bad;
  const path = isUp ? 'M -3 1.5 L 0 -1.5 L 3 1.5' : 'M -3 -1.5 L 0 1.5 L 3 -1.5';
  return (
    <g transform={`translate(${offset}, ${-offset})`} pointerEvents="none" className="fm-badge">
      <circle r={badgeR} fill="#FFFFFF" stroke={fill} strokeWidth={1.5} />
      <path d={path} stroke={fill} strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

interface PlanetLabelProps {
  label: string;
  planetR: number;
  /** Angle of the planet from the constellation centre — drives which side
   *  of the planet the label sits on. */
  angle: number;
}

/**
 * Small label rendered next to the planet, on whichever side faces away
 * from the constellation centre (so the labels don't crowd the middle).
 * Coordinates are local to the planet's group (already translated).
 */
function PlanetLabel({ label, planetR, angle }: PlanetLabelProps) {
  const onRightSide = Math.cos(angle) >= 0;
  const dx = onRightSide ? planetR + 4 : -(planetR + 4);
  return (
    <text x={dx} y={3.5} textAnchor={onRightSide ? 'start' : 'end'} className="fm-planet-label" pointerEvents="none">
      {label}
    </text>
  );
}

// ─── tooltip ────────────────────────────────────────────────────────────

interface TooltipBlockProps {
  x: number;
  y: number;
  planetR: number;
  lines: string[];
}

function TooltipBlock({ x, y, planetR, lines }: TooltipBlockProps) {
  const maxChars = Math.max(...lines.map((l) => l.length));
  const w = Math.max(120, maxChars * 6.5 + 18);
  const h = lines.length * 16 + 14;
  let bx = x + planetR + 12;
  if (bx + w > VIEWBOX_W - 8) bx = x - planetR - 12 - w;
  let by = y - h / 2;
  if (by < 8) by = 8;
  if (by + h > VIEWBOX_H - 8) by = VIEWBOX_H - 8 - h;

  const titleStyle: CSSProperties = { fontWeight: 600, fill: '#1F1F1F' };
  const lineStyle: CSSProperties = { fill: '#323232' };

  return (
    <g transform={`translate(${bx}, ${by})`} className="fm-tooltip">
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={8}
        ry={8}
        fill="#FFFFFF"
        stroke="rgba(31, 31, 31, 0.18)"
        strokeWidth={1}
        style={{ filter: 'drop-shadow(0 4px 18px rgba(0,0,0,0.10))' }}
      />
      {lines.map((line, i) => (
        <text
          key={i}
          x={10}
          y={20 + i * 16}
          style={i === 0 ? titleStyle : lineStyle}
          fontSize={i === 0 ? 13 : 12}
          fontFamily="var(--nd-font-body)"
        >
          {line}
        </text>
      ))}
    </g>
  );
}
