import React, { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import {
  BUILTIN_PRESETS,
  OverlayKey,
  OverlayPreset,
  VK_GROUPS,
  clonePreset,
  presetBox,
} from './inputOverlayPresets';

const ZOOM = 1.6;
const UNIT = 36;

type Selection = number | 'mouse' | null;

interface Props {
  initial: OverlayPreset;
  onSave: (preset: OverlayPreset) => void;
  onClose: () => void;
}

export default function InputOverlayEditor({ initial, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<OverlayPreset>(() => clonePreset(initial));
  const [selected, setSelected] = useState<Selection>(null);
  const [addVk, setAddVk] = useState<string>('87');
  const dragRef = useRef<{ target: 'key' | 'mouse'; id: number; dx: number; dy: number } | null>(
    null,
  );
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // Delete the selected element with the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected != null) {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, draft]);

  const box = presetBox(draft);

  const startDrag =
    (target: 'key' | 'mouse', id: number) => (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setSelected(target === 'mouse' ? 'mouse' : id);
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = (e.clientX - rect.left) / ZOOM;
      const cy = (e.clientY - rect.top) / ZOOM;
      const elem = target === 'mouse' ? draft.mouse! : draft.keys[id];
      // eslint-disable-next-line react-hooks/refs -- startDrag is an event handler; writing a ref here is correct.
      dragRef.current = { target, id, dx: cx - elem.x, dy: cy - elem.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = (e.clientX - rect.left) / ZOOM;
    const cy = (e.clientY - rect.top) / ZOOM;
    const nx = Math.max(0, Math.round(cx - d.dx));
    const ny = Math.max(0, Math.round(cy - d.dy));
    setDraft((prev) => {
      const next = clonePreset(prev);
      if (d.target === 'mouse' && next.mouse) {
        next.mouse = { ...next.mouse, x: nx, y: ny };
      } else {
        next.keys = next.keys.map((k, i) => (i === d.id ? { ...k, x: nx, y: ny } : k));
      }
      return next;
    });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const addKey = () => {
    const vk = Number(addVk);
    const opt = VK_GROUPS.flatMap((g) => g.items).find((i) => i.vk === vk);
    if (!opt) return;
    setDraft((prev) => ({
      ...prev,
      keys: [...prev.keys, { vk, label: opt.label, x: 8, y: 8, w: UNIT, h: UNIT }],
    }));
    setSelected(draft.keys.length);
  };

  const deleteSelected = () => {
    if (selected === 'mouse') {
      setDraft((prev) => ({ ...prev, mouse: null }));
    } else if (typeof selected === 'number') {
      setDraft((prev) => ({ ...prev, keys: prev.keys.filter((_, i) => i !== selected) }));
    }
    setSelected(null);
  };

  const toggleMovement = () => {
    setDraft((prev) => ({
      ...prev,
      mouse: prev.mouse ? { ...prev.mouse, showMovement: !prev.mouse.showMovement } : null,
    }));
  };

  const addMouse = () => {
    setDraft((prev) => ({
      ...prev,
      mouse: { x: box.w + 8, y: 8, w: UNIT + 8, h: UNIT * 3 + 8, showMovement: true },
    }));
  };

  const loadBuiltin = (preset: OverlayPreset) => {
    setDraft(clonePreset(preset));
    setSelected(null);
  };

  const selectedLabel =
    selected === 'mouse'
      ? 'Mouse'
      : typeof selected === 'number'
        ? `Key "${draft.keys[selected]?.label ?? ''}"`
        : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-[920px] max-w-[95vw] flex-col rounded-lg border border-custom bg-base-200 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Edit keyboard &amp; mouse layout</h2>
          <button className="btn btn-xs btn-circle btn-ghost" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Canvas */}
          <div className="flex-1 overflow-auto rounded-lg bg-base-300 p-4">
            <div
              ref={canvasRef}
              className="relative"
              style={{ width: box.w * ZOOM, height: box.h * ZOOM }}
              onPointerDown={() => setSelected(null)}
            >
              {draft.keys.map((k, i) => (
                <KeyEditor
                  key={i}
                  k={k}
                  selected={selected === i}
                  onPointerDown={startDrag('key', i)}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                />
              ))}
              {draft.mouse && (
                <MouseEditor
                  mouse={draft.mouse}
                  selected={selected === 'mouse'}
                  onPointerDown={startDrag('mouse', 0)}
                  onPointerMove={onMove}
                  onPointerUp={endDrag}
                />
              )}
            </div>
            <p className="mt-2 text-xs text-base-content/60">
              Drag to move. Click empty space to deselect. Delete/Backspace removes the selected
              element.
            </p>
          </div>

          {/* Panel */}
          <div className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto">
            <div>
              <label className="text-xs font-semibold text-base-content/70">Add key</label>
              <div className="mt-1 flex gap-1">
                <select
                  className="select select-bordered select-xs flex-1"
                  value={addVk}
                  onChange={(e) => setAddVk(e.target.value)}
                >
                  {VK_GROUPS.map((g) => (
                    <optgroup key={g.group} label={g.group}>
                      {g.items.map((it) => (
                        <option key={it.vk} value={it.vk}>
                          {it.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <button className="btn btn-xs btn-primary" onClick={addKey}>
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-base-content/70">Selected</label>
              <div className="mt-1 flex items-center justify-between gap-1">
                <span className="text-xs text-base-content/80">
                  {selectedLabel ?? 'Nothing selected'}
                </span>
                <button
                  className="btn btn-xs btn-error"
                  disabled={selected == null}
                  onClick={deleteSelected}
                >
                  <Trash2 size={14} /> Del
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-base-content/70">Mouse</label>
              <div className="mt-1 flex flex-col gap-1">
                {draft.mouse ? (
                  <>
                    <label className="label cursor-pointer justify-start gap-2 py-0">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs checkbox-primary"
                        checked={draft.mouse.showMovement}
                        onChange={toggleMovement}
                      />
                      <span className="text-xs">Show movement direction</span>
                    </label>
                    <button className="btn btn-xs btn-ghost" onClick={deleteSelected}>
                      Remove mouse
                    </button>
                  </>
                ) : (
                  <button className="btn btn-xs btn-outline" onClick={addMouse}>
                    Add mouse
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-base-content/70">Built-in presets</label>
              <div className="mt-1 grid grid-cols-2 gap-1">
                {BUILTIN_PRESETS.map((b) => (
                  <button
                    key={b.name}
                    className="btn btn-xs btn-outline"
                    onClick={() => loadBuiltin(b.preset)}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex justify-end gap-2">
          <button className="btn btn-sm btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => onSave(draft)}>
            Save layout
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyEditor({
  k,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  k: OverlayKey;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`flex cursor-move touch-none select-none items-center justify-center rounded border text-[11px] font-semibold ${
        selected
          ? 'border-primary ring-2 ring-primary'
          : 'border-white/30 bg-black/70 text-white/80'
      }`}
      style={{
        position: 'absolute',
        left: k.x * ZOOM,
        top: k.y * ZOOM,
        width: k.w * ZOOM,
        height: k.h * ZOOM,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {k.label}
    </div>
  );
}

function MouseEditor({
  mouse,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  mouse: { x: number; y: number; w: number; h: number };
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={`flex cursor-move touch-none select-none overflow-hidden rounded-lg border ${
        selected ? 'border-primary ring-2 ring-primary' : 'border-white/30 bg-black/70'
      }`}
      style={{
        position: 'absolute',
        left: mouse.x * ZOOM,
        top: mouse.y * ZOOM,
        width: mouse.w * ZOOM,
        height: mouse.h * ZOOM,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="flex-1 border-r border-white/20" />
      <div className="w-3" />
      <div className="flex-1 border-l border-white/20" />
    </div>
  );
}
