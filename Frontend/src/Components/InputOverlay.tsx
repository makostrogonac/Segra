import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Gamepad2, Eye, EyeOff, Settings as SettingsIcon } from 'lucide-react';
import {
  InputOverlayPrefs,
  OverlayPosition,
  OverlayPreset,
  loadPrefs,
  savePrefs,
  presetBox,
} from './inputOverlayPresets';
import InputOverlayEditor from './InputOverlayEditor';

// ponytail: post-hoc input overlay. Reads {recording}.inputs.json (NDJSON captured during
// recording) and renders a toggleable keyboard/mouse or gamepad overlay over the editor <video>,
// driven by currentTime. Non-destructive. Appearance prefs live in localStorage (not settings)
// because capture is always-on and the style is chosen while viewing.

interface InputSample {
  t: number;
  k: number[];
  mb: number;
  mx: number;
  my: number;
  w: number;
  cb: number;
  lt: number;
  rt: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

// XInput wButtons bitmask
const DPAD_UP = 0x0001,
  DPAD_DOWN = 0x0002,
  DPAD_LEFT = 0x0004,
  DPAD_RIGHT = 0x0008,
  BTN_START = 0x0010,
  BTN_BACK = 0x0020,
  LSHOULDER = 0x0100,
  RSHOULDER = 0x0200,
  BTN_A = 0x1000,
  BTN_B = 0x2000,
  BTN_X = 0x4000,
  BTN_Y = 0x8000;

const POSITION_CLASS: Record<OverlayPosition, string> = {
  TopLeft: 'top-2 left-2',
  TopRight: 'top-2 right-2',
  BottomLeft: 'bottom-2 left-2',
  BottomRight: 'bottom-2 right-2',
};

const POSITION_ORIGIN: Record<OverlayPosition, string> = {
  TopLeft: 'top left',
  TopRight: 'top right',
  BottomLeft: 'bottom left',
  BottomRight: 'bottom right',
};

const POSITION_LABEL: Record<OverlayPosition, string> = {
  TopLeft: 'TL',
  TopRight: 'TR',
  BottomLeft: 'BL',
  BottomRight: 'BR',
};

function inputsJsonPath(filePath: string): string {
  return filePath.replace(/\.[^.]+$/, '.inputs.json');
}

function findSampleIndex(samples: InputSample[], targetMs: number): number {
  if (samples.length === 0) return -1;
  let lo = 0;
  let hi = samples.length - 1;
  if (targetMs <= samples[0].t) return 0;
  if (targetMs >= samples[hi].t) return hi;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= targetMs && (mid === samples.length - 1 || samples[mid + 1].t > targetMs))
      return mid;
    if (samples[mid].t < targetMs) lo = mid + 1;
    else hi = mid - 1;
  }
  return lo;
}

export default function InputOverlay({
  videoRef,
  filePath,
}: {
  videoRef: { current: HTMLVideoElement | null };
  filePath: string;
}) {
  const [prefs, setPrefs] = useState<InputOverlayPrefs>(() => loadPrefs());
  const [samples, setSamples] = useState<InputSample[]>([]);
  const [available, setAvailable] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1);
  const [panelOpen, setPanelOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastUpdateRef = useRef(0);

  const setPref = (patch: Partial<InputOverlayPrefs>) =>
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      savePrefs(next);
      return next;
    });

  // Load the captured input stream for this recording.
  useEffect(() => {
    let cancelled = false;
    setAvailable(false);
    setSamples([]);
    const url = `http://localhost:2222/api/content?input=${encodeURIComponent(inputsJsonPath(filePath))}`;
    fetch(url)
      .then((r) => (r.ok ? r.text() : null))
      .then((text) => {
        if (cancelled || !text) return;
        const parsed: InputSample[] = [];
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            parsed.push(JSON.parse(trimmed) as InputSample);
          } catch {
            // skip malformed/partial trailing line
          }
        }
        parsed.sort((a, b) => a.t - b.t);
        setSamples(parsed);
        setAvailable(parsed.length > 0);
      })
      .catch(() => setAvailable(false));
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  // Drive the overlay from the video's currentTime.
  useEffect(() => {
    if (!prefs.enabled || !available) {
      setCurrentIdx(-1);
      return;
    }
    const loop = () => {
      const now = performance.now();
      if (now - lastUpdateRef.current >= 33) {
        lastUpdateRef.current = now;
        const v = videoRef.current;
        if (v && samples.length) setCurrentIdx(findSampleIndex(samples, v.currentTime * 1000));
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [prefs.enabled, available, samples, videoRef]);

  if (!available) return null;

  const isController = prefs.style === 'XboxController' || prefs.style === 'PlayStationController';
  const posClass = POSITION_CLASS[prefs.position];
  const origin = POSITION_ORIGIN[prefs.position];
  const cur = currentIdx >= 0 ? samples[currentIdx] : null;
  const keysDown = new Set(cur?.k ?? []);
  const mb = cur?.mb ?? 0;
  const wheel = cur?.w ?? 0;
  const cb = cur?.cb ?? 0;
  const lt = cur?.lt ?? 0;
  const rt = cur?.rt ?? 0;
  const lx = cur?.lx ?? 0;
  const ly = cur?.ly ?? 0;
  const rx = cur?.rx ?? 0;
  const ry = cur?.ry ?? 0;

  const btn = (active: boolean) =>
    active ? 'btn btn-xs btn-primary' : 'btn btn-xs btn-ghost bg-black/60 text-white';

  return (
    <>
      {/* Controls (always available when inputs were captured) */}
      <div className="absolute right-2 top-2 z-30 flex flex-col items-end gap-1.5">
        <div className="flex gap-1">
          <button
            onClick={() => setPref({ enabled: !prefs.enabled })}
            title={prefs.enabled ? 'Hide input overlay' : 'Show input overlay'}
            className={btn(prefs.enabled)}
          >
            {prefs.enabled ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
          <button
            onClick={() => setPref({ style: 'KeyboardMouse' })}
            title="Keyboard + mouse"
            className={btn(prefs.style === 'KeyboardMouse')}
          >
            <Keyboard size={14} />
          </button>
          <button
            onClick={() => setPref({ style: 'XboxController' })}
            title="Xbox controller"
            className={btn(prefs.style === 'XboxController')}
          >
            <Gamepad2 size={14} />
          </button>
          <button
            onClick={() => setPref({ style: 'PlayStationController' })}
            title="PlayStation controller"
            className={btn(prefs.style === 'PlayStationController')}
          >
            <Gamepad2 size={14} />
          </button>
          <button
            onClick={() => setPanelOpen((o) => !o)}
            title="Overlay options"
            className={btn(panelOpen)}
          >
            <SettingsIcon size={14} />
          </button>
        </div>

        {panelOpen && (
          <div className="flex w-52 flex-col gap-2 rounded-lg bg-black/80 p-3">
            <div>
              <div className="mb-1 text-xs font-semibold text-white/70">Position</div>
              <div className="grid grid-cols-2 gap-1">
                {(Object.keys(POSITION_LABEL) as OverlayPosition[]).map((p) => (
                  <button
                    key={p}
                    onClick={() => setPref({ position: p })}
                    className={btn(prefs.position === p)}
                  >
                    {POSITION_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs text-white/70">
                <span>Size</span>
                <span>{prefs.scale.toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={prefs.scale}
                onChange={(e) => setPref({ scale: Number(e.target.value) })}
                className="range range-xs range-primary"
              />
            </div>
            <div>
              <div className="flex justify-between text-xs text-white/70">
                <span>Opacity</span>
                <span>{Math.round(prefs.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={prefs.opacity}
                onChange={(e) => setPref({ opacity: Number(e.target.value) })}
                className="range range-xs range-primary"
              />
            </div>
            {!isController && (
              <button
                onClick={() => setEditorOpen(true)}
                className="btn btn-xs btn-outline text-white"
              >
                Edit layout…
              </button>
            )}
          </div>
        )}
      </div>

      {editorOpen && (
        <InputOverlayEditor
          initial={prefs.preset}
          onSave={(p) => {
            setPref({ preset: p });
            setEditorOpen(false);
          }}
          onClose={() => setEditorOpen(false)}
        />
      )}

      {prefs.enabled && cur && (
        <div
          className={`pointer-events-none absolute z-10 ${posClass}`}
          style={{
            opacity: prefs.opacity,
            transform: `scale(${prefs.scale})`,
            transformOrigin: origin,
          }}
        >
          {isController ? (
            <Gamepad
              cb={cb}
              lt={lt}
              rt={rt}
              lx={lx}
              ly={ly}
              rx={rx}
              ry={ry}
              playstation={prefs.style === 'PlayStationController'}
            />
          ) : (
            <KeyboardMouse
              preset={prefs.preset}
              keysDown={keysDown}
              mb={mb}
              wheel={wheel}
              samples={samples}
              idx={currentIdx}
            />
          )}
        </div>
      )}
    </>
  );
}

function KeyDiv({
  k,
  pressed,
}: {
  k: { vk: number; label: string; x: number; y: number; w: number; h: number };
  pressed: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-[5px] text-[10px] font-bold leading-none ${
        pressed ? 'text-black' : 'text-white/70'
      }`}
      style={{
        position: 'absolute',
        left: k.x,
        top: k.y,
        width: k.w,
        height: k.h,
        background: pressed
          ? 'linear-gradient(180deg, #fde047 0%, #f59e0b 100%)'
          : 'linear-gradient(180deg, rgba(40,42,54,0.85) 0%, rgba(20,21,30,0.9) 100%)',
        border: pressed ? '1px solid #fcd34d' : '1px solid rgba(255,255,255,0.10)',
        boxShadow: pressed
          ? '0 0 8px 1px rgba(251,191,36,0.7), inset 0 1px 0 rgba(255,255,255,0.4)'
          : 'inset 0 1px 0 rgba(255,255,255,0.06)',
      }}
    >
      {k.label}
    </div>
  );
}

// Mouse movement direction: a fading comet trail of recent positions relative to the current one.
// The head sits at the mouse centre; the tail extends opposite to the direction of motion.
function MouseMovement({
  samples,
  idx,
  w,
  h,
}: {
  samples: InputSample[];
  idx: number;
  w: number;
  h: number;
}) {
  const N = 10;
  const start = Math.max(0, idx - N);
  const cur = samples[idx];
  const raw: { x: number; y: number }[] = [];
  for (let j = start; j <= idx; j++) {
    raw.push({ x: samples[j].mx - cur.mx, y: samples[j].my - cur.my });
  }
  const PX = 0.05; // overlay px per screen px
  const scaled = raw.map((p) => ({ x: p.x * PX, y: p.y * PX }));
  let maxScaled = 0;
  for (const p of scaled) maxScaled = Math.max(maxScaled, Math.hypot(p.x, p.y));
  const maxR = Math.min(w, h) / 2 - 3;
  const k = maxScaled > maxR ? maxR / maxScaled : 1;
  const moved = maxScaled * k > 2;
  const cx = w / 2;
  const cy = h / 2;
  return (
    <svg
      className="pointer-events-none absolute inset-0"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
    >
      {moved &&
        scaled.slice(0, -1).map((p, i) => {
          const nxt = scaled[i + 1];
          return (
            <line
              key={i}
              x1={cx + p.x * k}
              y1={cy + p.y * k}
              x2={cx + nxt.x * k}
              y2={cy + nxt.y * k}
              stroke="#fde047"
              strokeWidth={2}
              strokeOpacity={(i + 1) / scaled.length}
              strokeLinecap="round"
            />
          );
        })}
      <circle
        cx={cx}
        cy={cy}
        r={moved ? 2.5 : 1.8}
        fill={moved ? '#fde047' : 'rgba(255,255,255,0.35)'}
      />
    </svg>
  );
}

function KeyboardMouse({
  preset,
  keysDown,
  mb,
  wheel,
  samples,
  idx,
}: {
  preset: OverlayPreset;
  keysDown: Set<number>;
  mb: number;
  wheel: number;
  samples: InputSample[];
  idx: number;
}) {
  const box = presetBox(preset);
  return (
    <div className="relative" style={{ width: box.w, height: box.h }}>
      {preset.keys.map((k, i) => (
        <KeyDiv key={i} k={k} pressed={keysDown.has(k.vk)} />
      ))}
      {preset.mouse && (
        <div
          className="absolute"
          style={{
            left: preset.mouse.x,
            top: preset.mouse.y,
            width: preset.mouse.w,
            height: preset.mouse.h,
          }}
        >
          <div className="relative h-full w-full overflow-hidden rounded-[10px] border border-white/10 bg-gradient-to-b from-[#28242e]/90 to-[#15121a]/95">
            <div
              className="absolute left-0 top-0 h-[55%] w-1/2 rounded-tl-[10px]"
              style={{
                background: mb & 1 ? 'linear-gradient(180deg,#fde047,#f59e0b)' : 'transparent',
              }}
            />
            <div
              className="absolute right-0 top-0 h-[55%] w-1/2 rounded-tr-[10px]"
              style={{
                background: mb & 2 ? 'linear-gradient(180deg,#fde047,#f59e0b)' : 'transparent',
              }}
            />
            <div className="absolute left-1/2 top-0 h-[55%] w-px -translate-x-1/2 bg-white/15" />
            <div
              className="absolute left-1/2 top-[16%] h-3 w-1.5 -translate-x-1/2 rounded-full"
              style={{
                background: wheel !== 0 || mb & 4 ? '#fde047' : 'rgba(255,255,255,0.25)',
              }}
            />
            <div
              className="absolute -left-[3px] top-[28%] h-2 w-1.5 rounded-l-sm"
              style={{ background: mb & 8 ? '#fde047' : 'rgba(255,255,255,0.18)' }}
            />
            <div
              className="absolute -left-[3px] top-[44%] h-2 w-1.5 rounded-l-sm"
              style={{ background: mb & 16 ? '#fde047' : 'rgba(255,255,255,0.18)' }}
            />
          </div>
          {preset.mouse.showMovement && (
            <MouseMovement samples={samples} idx={idx} w={preset.mouse.w} h={preset.mouse.h} />
          )}
        </div>
      )}
    </div>
  );
}

function Stick({ x, y, label }: { x: number; y: number; label: string }) {
  const left = 50 + x * 35;
  const top = 50 - y * 35;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative h-10 w-10 rounded-full border border-white/20 bg-black/60">
        <div
          className="absolute h-3 w-3 rounded-full bg-yellow-400"
          style={{ left: `${left}%`, top: `${top}%`, transform: 'translate(-50%, -50%)' }}
        />
      </div>
      <span className="text-[8px] text-white/60">{label}</span>
    </div>
  );
}

function PadButton({
  pressed,
  children,
  className = '',
}: {
  pressed: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-bold ${
        pressed
          ? 'bg-yellow-400 text-black border-yellow-300'
          : 'bg-black/60 text-white/80 border-white/20'
      } ${className}`}
    >
      {children}
    </div>
  );
}

function Gamepad({
  cb,
  lt,
  rt,
  lx,
  ly,
  rx,
  ry,
  playstation,
}: {
  cb: number;
  lt: number;
  rt: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  playstation: boolean;
}) {
  const a = playstation ? '✕' : 'A';
  const b = playstation ? '○' : 'B';
  const x = playstation ? '□' : 'X';
  const y = playstation ? '△' : 'Y';
  return (
    <div className="flex w-[200px] flex-col gap-1 rounded-lg bg-black/40 p-2">
      <div className="flex justify-between">
        <div className="flex flex-col items-center gap-0.5">
          <div
            className={`h-3 w-12 rounded text-center text-[8px] ${
              lt > 0.05 ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white/60'
            }`}
          >
            LT
          </div>
          <div
            className={`h-3 w-12 rounded text-center text-[8px] ${
              cb & LSHOULDER ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white/60'
            }`}
          >
            LB
          </div>
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <div
            className={`h-3 w-12 rounded text-center text-[8px] ${
              rt > 0.05 ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white/60'
            }`}
          >
            RT
          </div>
          <div
            className={`h-3 w-12 rounded text-center text-[8px] ${
              cb & RSHOULDER ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white/60'
            }`}
          >
            RB
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col items-center gap-1">
          <Stick x={lx} y={ly} label="L" />
          <div className="relative h-12 w-12">
            <div
              className={`absolute left-1/2 top-0 h-4 w-3 -translate-x-1/2 rounded ${
                cb & DPAD_UP ? 'bg-yellow-400' : 'border border-white/20 bg-black/60'
              }`}
            />
            <div
              className={`absolute bottom-0 left-1/2 h-4 w-3 -translate-x-1/2 rounded ${
                cb & DPAD_DOWN ? 'bg-yellow-400' : 'border border-white/20 bg-black/60'
              }`}
            />
            <div
              className={`absolute left-0 top-1/2 h-3 w-4 -translate-y-1/2 rounded ${
                cb & DPAD_LEFT ? 'bg-yellow-400' : 'border border-white/20 bg-black/60'
              }`}
            />
            <div
              className={`absolute right-0 top-1/2 h-3 w-4 -translate-y-1/2 rounded ${
                cb & DPAD_RIGHT ? 'bg-yellow-400' : 'border border-white/20 bg-black/60'
              }`}
            />
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className="relative h-14 w-14">
            <PadButton
              pressed={(cb & BTN_Y) > 0}
              className="absolute left-1/2 top-0 -translate-x-1/2"
            >
              {y}
            </PadButton>
            <PadButton
              pressed={(cb & BTN_A) > 0}
              className="absolute bottom-0 left-1/2 -translate-x-1/2"
            >
              {a}
            </PadButton>
            <PadButton
              pressed={(cb & BTN_X) > 0}
              className="absolute left-0 top-1/2 -translate-y-1/2"
            >
              {x}
            </PadButton>
            <PadButton
              pressed={(cb & BTN_B) > 0}
              className="absolute right-0 top-1/2 -translate-y-1/2"
            >
              {b}
            </PadButton>
          </div>
          <Stick x={rx} y={ry} label="R" />
        </div>
      </div>
      <div className="flex justify-center gap-3">
        <div
          className={`h-4 w-4 rounded-full ${
            cb & BTN_BACK ? 'bg-yellow-400' : 'border border-white/20 bg-black/60'
          }`}
          title="Back"
        />
        <div
          className={`h-4 w-4 rounded-full ${
            cb & BTN_START ? 'bg-yellow-400' : 'border border-white/20 bg-black/60'
          }`}
          title="Start"
        />
      </div>
    </div>
  );
}
