// ponytail: input overlay layout presets + per-user prefs (localStorage). Capture is always-on
// in the backend; the editor overlay appearance (style/position/size/opacity/layout) lives here.

export interface OverlayKey {
  vk: number;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayMouse {
  x: number;
  y: number;
  w: number;
  h: number;
  showMovement: boolean;
}

export interface OverlayPreset {
  keys: OverlayKey[];
  mouse: OverlayMouse | null;
}

export type OverlayStyle = 'KeyboardMouse' | 'XboxController' | 'PlayStationController';
export type OverlayPosition = 'TopLeft' | 'TopRight' | 'BottomLeft' | 'BottomRight';

export interface InputOverlayPrefs {
  enabled: boolean;
  style: OverlayStyle;
  position: OverlayPosition;
  scale: number;
  opacity: number;
  preset: OverlayPreset;
}

export interface VkOption {
  vk: number;
  label: string;
}

// Keys available in the layout editor palette.
export const VK_GROUPS: { group: string; items: VkOption[] }[] = [
  {
    group: 'Letters',
    items: Array.from({ length: 26 }, (_, i) => ({
      vk: 65 + i,
      label: String.fromCharCode(65 + i),
    })),
  },
  {
    group: 'Numbers',
    items: Array.from({ length: 10 }, (_, i) => ({
      vk: 48 + i,
      label: String.fromCharCode(48 + i),
    })),
  },
  {
    group: 'Function',
    items: Array.from({ length: 12 }, (_, i) => ({ vk: 112 + i, label: `F${i + 1}` })),
  },
  {
    group: 'Modifiers',
    items: [
      { vk: 16, label: 'Shift' },
      { vk: 17, label: 'Ctrl' },
      { vk: 18, label: 'Alt' },
      { vk: 91, label: 'Win' },
      { vk: 32, label: 'Space' },
    ],
  },
  {
    group: 'Special',
    items: [
      { vk: 9, label: 'Tab' },
      { vk: 20, label: 'Caps' },
      { vk: 13, label: 'Enter' },
      { vk: 27, label: 'Esc' },
      { vk: 8, label: 'Bksp' },
      { vk: 46, label: 'Del' },
    ],
  },
  {
    group: 'Arrows',
    items: [
      { vk: 37, label: '←' },
      { vk: 38, label: '↑' },
      { vk: 39, label: '→' },
      { vk: 40, label: '↓' },
    ],
  },
];

const UNIT = 36;
const GAP = 4;
const WIDE = 52;

interface RowKey {
  code: number;
  label: string;
  wide?: boolean;
}

// Build a preset from rows of keys (left-to-right), placing the mouse to the right of the keyboard.
function fromRows(rows: RowKey[][]): OverlayPreset {
  const keys: OverlayKey[] = [];
  let maxX = 0;
  rows.forEach((row, ry) => {
    let x = GAP;
    row.forEach((k) => {
      const w = k.wide ? WIDE : UNIT;
      keys.push({ vk: k.code, label: k.label, x, y: GAP + ry * (UNIT + GAP), w, h: UNIT });
      x += w + GAP;
    });
    maxX = Math.max(maxX, x);
  });
  const mouse: OverlayMouse = {
    x: maxX + GAP,
    y: GAP,
    w: UNIT + 8,
    h: UNIT * 3 + GAP * 2,
    showMovement: true,
  };
  return { keys, mouse };
}

const COMPACT_ROWS: RowKey[][] = [
  [
    { code: 27, label: 'Esc' },
    { code: 49, label: '1' },
    { code: 50, label: '2' },
    { code: 51, label: '3' },
    { code: 52, label: '4' },
    { code: 53, label: '5' },
    { code: 54, label: '6' },
  ],
  [
    { code: 9, label: 'Tab', wide: true },
    { code: 81, label: 'Q' },
    { code: 87, label: 'W' },
    { code: 69, label: 'E' },
    { code: 82, label: 'R' },
  ],
  [
    { code: 20, label: 'Caps', wide: true },
    { code: 65, label: 'A' },
    { code: 83, label: 'S' },
    { code: 68, label: 'D' },
    { code: 70, label: 'F' },
  ],
  [
    { code: 16, label: 'Shift', wide: true },
    { code: 90, label: 'Z' },
    { code: 88, label: 'X' },
    { code: 67, label: 'C' },
    { code: 86, label: 'V' },
  ],
  [
    { code: 17, label: 'Ctrl', wide: true },
    { code: 18, label: 'Alt', wide: true },
    { code: 32, label: 'Space', wide: true },
  ],
];

const WASD_ROWS: RowKey[][] = [
  [
    { code: 87, label: 'W' },
    { code: 65, label: 'A' },
    { code: 83, label: 'S' },
    { code: 68, label: 'D' },
  ],
  [
    { code: 16, label: 'Shift', wide: true },
    { code: 32, label: 'Space', wide: true },
  ],
];

const FULL_ROWS: RowKey[][] = [
  [
    { code: 27, label: 'Esc' },
    { code: 49, label: '1' },
    { code: 50, label: '2' },
    { code: 51, label: '3' },
    { code: 52, label: '4' },
    { code: 53, label: '5' },
    { code: 54, label: '6' },
    { code: 55, label: '7' },
    { code: 56, label: '8' },
    { code: 57, label: '9' },
    { code: 48, label: '0' },
  ],
  [
    { code: 9, label: 'Tab', wide: true },
    { code: 81, label: 'Q' },
    { code: 87, label: 'W' },
    { code: 69, label: 'E' },
    { code: 82, label: 'R' },
    { code: 84, label: 'T' },
    { code: 89, label: 'Y' },
    { code: 85, label: 'U' },
  ],
  [
    { code: 20, label: 'Caps', wide: true },
    { code: 65, label: 'A' },
    { code: 83, label: 'S' },
    { code: 68, label: 'D' },
    { code: 70, label: 'F' },
    { code: 71, label: 'G' },
    { code: 72, label: 'H' },
    { code: 74, label: 'J' },
  ],
  [
    { code: 16, label: 'Shift', wide: true },
    { code: 90, label: 'Z' },
    { code: 88, label: 'X' },
    { code: 67, label: 'C' },
    { code: 86, label: 'V' },
    { code: 66, label: 'B' },
    { code: 78, label: 'N' },
    { code: 77, label: 'M' },
  ],
  [
    { code: 17, label: 'Ctrl', wide: true },
    { code: 18, label: 'Alt', wide: true },
    { code: 32, label: 'Space', wide: true },
  ],
];

const ARROW_ROWS: RowKey[][] = [
  [{ code: 38, label: '↑' }],
  [
    { code: 37, label: '←' },
    { code: 40, label: '↓' },
    { code: 39, label: '→' },
  ],
];

export const COMPACT = fromRows(COMPACT_ROWS);
export const WASD = fromRows(WASD_ROWS);
export const FULL = fromRows(FULL_ROWS);
export const ARROWS = fromRows(ARROW_ROWS);

export const BUILTIN_PRESETS: { name: string; preset: OverlayPreset }[] = [
  { name: 'Compact', preset: COMPACT },
  { name: 'WASD', preset: WASD },
  { name: 'Full', preset: FULL },
  { name: 'Arrows', preset: ARROWS },
];

export const DEFAULT_PREFS: InputOverlayPrefs = {
  enabled: true,
  style: 'KeyboardMouse',
  position: 'BottomLeft',
  scale: 1,
  opacity: 1,
  preset: COMPACT,
};

const PREFS_KEY = 'segra.inputOverlay.v1';

export function clonePreset(p: OverlayPreset): OverlayPreset {
  return JSON.parse(JSON.stringify(p)) as OverlayPreset;
}

export function loadPrefs(): InputOverlayPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<InputOverlayPrefs>;
      return {
        ...DEFAULT_PREFS,
        ...parsed,
        preset: parsed.preset ? normalizePreset(parsed.preset) : COMPACT,
      };
    }
  } catch {
    // ignore corrupt prefs
  }
  return { ...DEFAULT_PREFS, preset: clonePreset(COMPACT) };
}

export function savePrefs(p: InputOverlayPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // ignore quota errors
  }
}

// Bounding box of a preset (used to size the render canvas).
export function presetBox(p: OverlayPreset): { w: number; h: number } {
  let maxX = 0;
  let maxY = 0;
  for (const k of p.keys) {
    maxX = Math.max(maxX, k.x + k.w);
    maxY = Math.max(maxY, k.y + k.h);
  }
  if (p.mouse) {
    maxX = Math.max(maxX, p.mouse.x + p.mouse.w);
    maxY = Math.max(maxY, p.mouse.y + p.mouse.h);
  }
  return { w: maxX + GAP, h: maxY + GAP };
}

// Defensively coerce a loaded preset into a valid shape.
function normalizePreset(p: OverlayPreset): OverlayPreset {
  const keys = Array.isArray(p.keys)
    ? p.keys
        .filter((k) => k && typeof k.vk === 'number')
        .map((k) => ({
          vk: k.vk,
          label: String(k.label ?? ''),
          x: Number(k.x) || 0,
          y: Number(k.y) || 0,
          w: Number(k.w) || UNIT,
          h: Number(k.h) || UNIT,
        }))
    : [];
  const mouse =
    p.mouse && typeof p.mouse.x === 'number'
      ? {
          x: Number(p.mouse.x) || 0,
          y: Number(p.mouse.y) || 0,
          w: Number(p.mouse.w) || UNIT,
          h: Number(p.mouse.h) || UNIT,
          showMovement: p.mouse.showMovement !== false,
        }
      : null;
  return { keys, mouse };
}
