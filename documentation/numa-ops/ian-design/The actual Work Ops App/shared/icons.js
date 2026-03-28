/**
 * Shared Icon Components
 *
 * Lucide-style SVG icons as React components.
 * Uses React.createElement (no JSX) so no Babel needed.
 *
 * Version: v172c
 *
 * v172c Changes:
 * - Added Users, Building2, Phone, Mail, Star, ChevronRight for CRM Mirror
 *
 * v153 Changes:
 * - Added component version registry support
 *
 * Exported via: window.Icons
 */
(function () {
  'use strict';

  // v153: Component version for registry
  const COMPONENT_VERSION = 'v172c';

  const h = React.createElement;

  const svgProps = (size, className) => ({
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '2',
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    className: className,
  });

  const Plus = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('line', { x1: '12', y1: '5', x2: '12', y2: '19' }),
      h('line', { x1: '5', y1: '12', x2: '19', y2: '12' })
    );

  const Edit2 = ({ size = 24, className = '' }) =>
    h('svg', svgProps(size, className), h('path', { d: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z' }));

  const Trash2 = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('polyline', { points: '3 6 5 6 21 6' }),
      h('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }),
      h('line', { x1: '10', y1: '11', x2: '10', y2: '17' }),
      h('line', { x1: '14', y1: '11', x2: '14', y2: '17' })
    );

  const Search = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('circle', { cx: '11', cy: '11', r: '8' }),
      h('line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' })
    );

  const BarChart3 = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('path', { d: 'M3 3v18h18' }),
      h('path', { d: 'M18 17V9' }),
      h('path', { d: 'M13 17V5' }),
      h('path', { d: 'M8 17v-3' })
    );

  const Settings = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('path', {
        d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      }),
      h('circle', { cx: '12', cy: '12', r: '3' })
    );

  const Play = ({ size = 24, className = '' }) =>
    h('svg', svgProps(size, className), h('polygon', { points: '5 3 19 12 5 21 5 3' }));

  const Check = ({ size = 24, className = '' }) =>
    h('svg', svgProps(size, className), h('polyline', { points: '20 6 9 17 4 12' }));

  const AlertCircle = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('circle', { cx: '12', cy: '12', r: '10' }),
      h('line', { x1: '12', y1: '8', x2: '12', y2: '12' }),
      h('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' })
    );

  const ChevronUp = ({ size = 24, className = '' }) =>
    h('svg', svgProps(size, className), h('polyline', { points: '18 15 12 9 6 15' }));

  const ChevronDown = ({ size = 24, className = '' }) =>
    h('svg', svgProps(size, className), h('polyline', { points: '6 9 12 15 18 9' }));

  const ArrowRight = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('line', { x1: '5', y1: '12', x2: '19', y2: '12' }),
      h('polyline', { points: '12 5 19 12 12 19' })
    );

  const Square = ({ size = 24, className = '' }) =>
    h('svg', svgProps(size, className), h('rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', ry: '2' }));

  const X = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
      h('line', { x1: '6', y1: '6', x2: '18', y2: '18' })
    );

  const ArrowLeft = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('line', { x1: '19', y1: '12', x2: '5', y2: '12' }),
      h('polyline', { points: '12 19 5 12 12 5' })
    );

  const Copy = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('rect', { x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' }),
      h('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
    );

  const GripVertical = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('circle', { cx: '9', cy: '5', r: '1' }),
      h('circle', { cx: '9', cy: '12', r: '1' }),
      h('circle', { cx: '9', cy: '19', r: '1' }),
      h('circle', { cx: '15', cy: '5', r: '1' }),
      h('circle', { cx: '15', cy: '12', r: '1' }),
      h('circle', { cx: '15', cy: '19', r: '1' })
    );

  const RotateCcw = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }),
      h('path', { d: 'M3 3v5h5' })
    );

  const Save = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('path', { d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z' }),
      h('polyline', { points: '17 21 17 13 7 13 7 21' }),
      h('polyline', { points: '7 3 7 8 15 8' })
    );

  const FolderOpen = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v11z' }),
      h('path', { d: 'M2 10h20' })
    );

  const Users = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
      h('circle', { cx: '9', cy: '7', r: '4' }),
      h('path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }),
      h('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' })
    );

  const Building2 = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('path', { d: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z' }),
      h('path', { d: 'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2' }),
      h('path', { d: 'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2' }),
      h('path', { d: 'M10 6h4' }),
      h('path', { d: 'M10 10h4' }),
      h('path', { d: 'M10 14h4' }),
      h('path', { d: 'M10 18h4' })
    );

  const Phone = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('path', {
        d: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z',
      })
    );

  const Mail = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('rect', { width: '20', height: '16', x: '2', y: '4', rx: '2' }),
      h('path', { d: 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' })
    );

  const Star = ({ size = 24, className = '' }) =>
    h(
      'svg',
      svgProps(size, className),
      h('polygon', {
        points: '12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2',
      })
    );

  const ChevronRight = ({ size = 24, className = '' }) =>
    h('svg', svgProps(size, className), h('polyline', { points: '9 18 15 12 9 6' }));

  // Export to window namespace
  window.Icons = {
    Plus,
    Edit2,
    Trash2,
    Search,
    BarChart3,
    Settings,
    Play,
    Check,
    AlertCircle,
    ChevronUp,
    ChevronDown,
    ChevronRight,
    ArrowRight,
    ArrowLeft,
    Square,
    X,
    Copy,
    GripVertical,
    RotateCcw,
    Save,
    FolderOpen,
    Users,
    Building2,
    Phone,
    Mail,
    Star,
  };

  // v153: Register component version
  window.ComponentVersions = window.ComponentVersions || {};
  window.ComponentVersions['shared/icons'] = COMPONENT_VERSION;

  console.log(`[icons.js] Icons loaded (${COMPONENT_VERSION})`);
})();
