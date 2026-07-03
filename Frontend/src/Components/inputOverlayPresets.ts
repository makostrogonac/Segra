// ponytail: input overlay layout presets + per-user prefs (localStorage). Capture is always-on
// in the backend; the editor overlay appearance (style/position/size/opacity/layout) lives here.
// Built-in layouts are based on standard streamer/mechanical-keyboard form factors (NohBoard-style
// full, 60% ANSI / Wooting, TKL, FPS cluster, numpad).

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

export interface InputOverlayPrefs {
  enabled: boolean;
  style: OverlayStyle;
  posX: number; // 0..1 fraction of (videoW - overlayW); 0 = left edge, 1 = right edge
  posY: number; // 0..1 fraction of (videoH - overlayH); 0 = top edge, 1 = bottom edge
  scale: number;
  opacity: number;
  syncOffsetMs: number; // + delays the overlay (fixes "early"), - advances it (fixes "late")
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
      { vk: 192, label: '`' },
      { vk: 189, label: '-' },
      { vk: 187, label: '=' },
      { vk: 219, label: '[' },
      { vk: 221, label: ']' },
      { vk: 220, label: '\\' },
      { vk: 186, label: ';' },
      { vk: 222, label: "'" },
      { vk: 188, label: ',' },
      { vk: 190, label: '.' },
      { vk: 191, label: '/' },
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
  {
    group: 'Numpad',
    items: [
      { vk: 144, label: 'Num' },
      { vk: 111, label: '/' },
      { vk: 106, label: '*' },
      { vk: 109, label: '-' },
      { vk: 107, label: '+' },
      { vk: 13, label: '↵' },
      { vk: 96, label: '0' },
      { vk: 110, label: '.' },
      { vk: 97, label: '1' },
      { vk: 98, label: '2' },
      { vk: 99, label: '3' },
      { vk: 100, label: '4' },
      { vk: 101, label: '5' },
      { vk: 102, label: '6' },
      { vk: 103, label: '7' },
      { vk: 104, label: '8' },
      { vk: 105, label: '9' },
    ],
  },
];

export const UNIT = 36;
const GAP = 4;

interface RowKey {
  code: number;
  label: string;
  /** Width in key units (1 = UNIT). Real ANSI proportions: 1.25/1.5/1.75/2/2.25/2.75/6.25. */
  span?: number;
}

function keyWidth(span = 1): number {
  return span * UNIT + (span - 1) * GAP;
}

// Lay out a block of rows starting at (originX, originY). Returns the keys and the block width.
function layoutBlock(
  rows: RowKey[][],
  originX: number,
  originY: number,
): { keys: OverlayKey[]; width: number } {
  const keys: OverlayKey[] = [];
  let width = 0;
  rows.forEach((row, ry) => {
    let x = originX;
    row.forEach((k) => {
      const w = keyWidth(k.span);
      keys.push({ vk: k.code, label: k.label, x, y: originY + ry * (UNIT + GAP), w, h: UNIT });
      x += w + GAP;
    });
    width = Math.max(width, x - originX);
  });
  return { keys, width: Math.max(0, width - GAP) };
}

// Build a preset from rows, placing the mouse (optional) to the right of the keyboard.
function fromRows(rows: RowKey[][], withMouse = true): OverlayPreset {
  const { keys, width } = layoutBlock(rows, GAP, GAP);
  const mouse: OverlayMouse | null = withMouse
    ? {
        x: GAP + width + GAP,
        y: GAP,
        w: UNIT + 10,
        h: UNIT * 3 + GAP * 2,
        showMovement: true,
      }
    : null;
  return { keys, mouse };
}

// --- 60% ANSI (Wooting-style, 61 keys) ---
const SIXTY_ROWS: RowKey[][] = [
  [
    { code: 192, label: '`' },
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
    { code: 189, label: '-' },
    { code: 187, label: '=' },
    { code: 8, label: 'Bksp', span: 2 },
  ],
  [
    { code: 9, label: 'Tab', span: 1.5 },
    { code: 81, label: 'Q' },
    { code: 87, label: 'W' },
    { code: 69, label: 'E' },
    { code: 82, label: 'R' },
    { code: 84, label: 'T' },
    { code: 89, label: 'Y' },
    { code: 85, label: 'U' },
    { code: 73, label: 'I' },
    { code: 79, label: 'O' },
    { code: 80, label: 'P' },
    { code: 219, label: '[' },
    { code: 221, label: ']' },
    { code: 220, label: '\\', span: 1.5 },
  ],
  [
    { code: 20, label: 'Caps', span: 1.75 },
    { code: 65, label: 'A' },
    { code: 83, label: 'S' },
    { code: 68, label: 'D' },
    { code: 70, label: 'F' },
    { code: 71, label: 'G' },
    { code: 72, label: 'H' },
    { code: 74, label: 'J' },
    { code: 75, label: 'K' },
    { code: 76, label: 'L' },
    { code: 186, label: ';' },
    { code: 222, label: "'" },
    { code: 13, label: 'Enter', span: 2.25 },
  ],
  [
    { code: 16, label: 'Shift', span: 2.25 },
    { code: 90, label: 'Z' },
    { code: 88, label: 'X' },
    { code: 67, label: 'C' },
    { code: 86, label: 'V' },
    { code: 66, label: 'B' },
    { code: 78, label: 'N' },
    { code: 77, label: 'M' },
    { code: 188, label: ',' },
    { code: 190, label: '.' },
    { code: 191, label: '/' },
    { code: 16, label: 'Shift', span: 2.75 },
  ],
  [
    { code: 17, label: 'Ctrl', span: 1.25 },
    { code: 91, label: 'Win', span: 1.25 },
    { code: 18, label: 'Alt', span: 1.25 },
    { code: 32, label: 'Space', span: 6.25 },
    { code: 18, label: 'Alt', span: 1.25 },
    { code: 255, label: 'Fn', span: 1.25 },
    { code: 17, label: 'Ctrl', span: 1.25 },
  ],
];

// --- TKL: function row + 60% block + arrow cluster ---
function buildTkl(): OverlayPreset {
  const fRow: RowKey[] = [
    { code: 27, label: 'Esc' },
    ...Array.from({ length: 12 }, (_, i) => ({ code: 112 + i, label: `F${i + 1}` })),
  ];
  const fBlock = layoutBlock([fRow], GAP, GAP);
  const mainBlock = layoutBlock(SIXTY_ROWS, GAP, GAP + (UNIT + GAP) * 1);
  const blockWidth = Math.max(fBlock.width, mainBlock.width);

  // Arrow cluster at the bottom-right of the main block.
  const ax = GAP + blockWidth - (3 * UNIT + 2 * GAP);
  const ay = GAP + (UNIT + GAP) * 4; // aligns with the 5th row (Shift row) area, below it
  const arrows: OverlayKey[] = [
    { vk: 38, label: '↑', x: ax + UNIT + GAP, y: ay, w: UNIT, h: UNIT },
    { vk: 37, label: '←', x: ax, y: ay + UNIT + GAP, w: UNIT, h: UNIT },
    { vk: 40, label: '↓', x: ax + UNIT + GAP, y: ay + UNIT + GAP, w: UNIT, h: UNIT },
    { vk: 39, label: '→', x: ax + 2 * (UNIT + GAP), y: ay + UNIT + GAP, w: UNIT, h: UNIT },
  ];

  const keys = [...fBlock.keys, ...mainBlock.keys, ...arrows];
  return { keys, mouse: null };
}

// --- Compact gaming (5-row) ---
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
    { code: 9, label: 'Tab', span: 1.5 },
    { code: 81, label: 'Q' },
    { code: 87, label: 'W' },
    { code: 69, label: 'E' },
    { code: 82, label: 'R' },
  ],
  [
    { code: 20, label: 'Caps', span: 1.75 },
    { code: 65, label: 'A' },
    { code: 83, label: 'S' },
    { code: 68, label: 'D' },
    { code: 70, label: 'F' },
  ],
  [
    { code: 16, label: 'Shift', span: 2.25 },
    { code: 90, label: 'Z' },
    { code: 88, label: 'X' },
    { code: 67, label: 'C' },
    { code: 86, label: 'V' },
  ],
  [
    { code: 17, label: 'Ctrl', span: 1.25 },
    { code: 18, label: 'Alt', span: 1.25 },
    { code: 32, label: 'Space', span: 3 },
  ],
];

// --- WASD movement cluster ---
const WASD_ROWS: RowKey[][] = [
  [{ code: 87, label: 'W' }],
  [
    { code: 65, label: 'A' },
    { code: 83, label: 'S' },
    { code: 68, label: 'D' },
  ],
  [
    { code: 16, label: 'Shift', span: 1.5 },
    { code: 32, label: 'Space', span: 2 },
  ],
];

// --- FPS cluster: movement + actions + mouse ---
const FPS_ROWS: RowKey[][] = [
  [
    { code: 27, label: 'Esc' },
    { code: 49, label: '1' },
    { code: 50, label: '2' },
    { code: 51, label: '3' },
    { code: 52, label: '4' },
  ],
  [
    { code: 9, label: 'Tab', span: 1.5 },
    { code: 81, label: 'Q' },
    { code: 87, label: 'W' },
    { code: 69, label: 'E' },
    { code: 82, label: 'R' },
  ],
  [
    { code: 16, label: 'Shift', span: 1.5 },
    { code: 65, label: 'A' },
    { code: 83, label: 'S' },
    { code: 68, label: 'D' },
    { code: 70, label: 'F' },
  ],
  [
    { code: 17, label: 'Ctrl', span: 1.5 },
    { code: 32, label: 'Space', span: 2 },
  ],
];

// --- Arrow cluster ---
const ARROW_ROWS: RowKey[][] = [
  [{ code: 38, label: '↑' }],
  [
    { code: 37, label: '←' },
    { code: 40, label: '↓' },
    { code: 39, label: '→' },
  ],
];

// --- Numpad ---
const NUMPAD_ROWS: RowKey[][] = [
  [
    { code: 144, label: 'Num' },
    { code: 111, label: '/' },
    { code: 106, label: '*' },
    { code: 109, label: '-' },
  ],
  [
    { code: 103, label: '7' },
    { code: 104, label: '8' },
    { code: 105, label: '9' },
    { code: 107, label: '+' },
  ],
  [
    { code: 100, label: '4' },
    { code: 101, label: '5' },
    { code: 102, label: '6' },
  ],
  [
    { code: 97, label: '1' },
    { code: 98, label: '2' },
    { code: 99, label: '3' },
    { code: 13, label: '↵' },
  ],
  [
    { code: 96, label: '0', span: 2 },
    { code: 110, label: '.' },
  ],
];

export const COMPACT = fromRows(COMPACT_ROWS);
export const WASD = fromRows(WASD_ROWS);
export const SIXTY = fromRows(SIXTY_ROWS);
export const TKL = buildTkl();
export const FPS = fromRows(FPS_ROWS);
export const ARROWS = fromRows(ARROW_ROWS, false);
export const NUMPAD = fromRows(NUMPAD_ROWS, false);

export const BUILTIN_PRESETS: { name: string; preset: OverlayPreset }[] = [
  { name: '60%', preset: SIXTY },
  { name: 'Compact', preset: COMPACT },
  { name: 'FPS', preset: FPS },
  { name: 'WASD', preset: WASD },
  { name: 'TKL', preset: TKL },
  { name: 'Arrows', preset: ARROWS },
  { name: 'Numpad', preset: NUMPAD },
];

export const DEFAULT_PREFS: InputOverlayPrefs = {
  enabled: true,
  style: 'KeyboardMouse',
  posX: 0,
  posY: 1,
  scale: 1,
  opacity: 1,
  syncOffsetMs: 0,
  preset: SIXTY,
};

const PREFS_KEY = 'segra.inputOverlay.v1';

export function clonePreset(p: OverlayPreset): OverlayPreset {
  return JSON.parse(JSON.stringify(p)) as OverlayPreset;
}

// Accept the new posX/posY fractions (0..1) or migrate the legacy corner enum.
function migratePosition(parsed: { posX?: unknown; posY?: unknown; position?: unknown }): {
  posX: number;
  posY: number;
} {
  if (typeof parsed.posX === 'number' && typeof parsed.posY === 'number') {
    return { posX: parsed.posX, posY: parsed.posY };
  }
  switch (parsed.position) {
    case 'TopLeft':
      return { posX: 0, posY: 0 };
    case 'TopRight':
      return { posX: 1, posY: 0 };
    case 'BottomRight':
      return { posX: 1, posY: 1 };
    default:
      return { posX: 0, posY: 1 }; // BottomLeft / unknown
  }
}

export function loadPrefs(): InputOverlayPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<InputOverlayPrefs> & { position?: string };
      const { posX, posY } = migratePosition(parsed);
      delete parsed.position; // drop legacy corner enum so it isn't re-saved
      return {
        ...DEFAULT_PREFS,
        ...parsed,
        posX,
        posY,
        preset: parsed.preset ? normalizePreset(parsed.preset) : SIXTY,
      };
    }
  } catch {
    // ignore corrupt prefs
  }
  return { ...DEFAULT_PREFS, preset: clonePreset(SIXTY) };
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
