import React, { useEffect, useRef, useState } from 'react';
import { useSettings } from '../Context/SettingsContext';
import { Keyboard, Gamepad2, Eye, EyeOff } from 'lucide-react';

// ponytail: post-hoc input overlay. Reads {recording}.inputs.json (NDJSON snapshots captured
// during recording) and renders a toggleable keyboard/mouse or gamepad overlay over the editor
// <video>, driven by currentTime. Non-destructive: purely an editor preview layer.

interface InputSample {
    t: number;
    k: number[];
    mb: number;
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

// Compact gaming keyboard layout (Windows VK codes).
const KB_LAYOUT: { code: number; label: string; wide?: boolean }[][] = [
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

const POSITION_CLASS: Record<string, string> = {
    TopLeft: 'top-2 left-2',
    TopRight: 'top-2 right-2',
    BottomLeft: 'bottom-2 left-2',
    BottomRight: 'bottom-2 right-2',
};

const POSITION_ORIGIN: Record<string, string> = {
    TopLeft: 'top left',
    TopRight: 'top right',
    BottomLeft: 'bottom left',
    BottomRight: 'bottom right',
};

function inputsJsonPath(filePath: string): string {
    return filePath.replace(/\.[^.]+$/, '.inputs.json');
}

function binarySearchSample(samples: InputSample[], targetMs: number): InputSample | null {
    if (samples.length === 0) return null;
    let lo = 0;
    let hi = samples.length - 1;
    if (targetMs <= samples[0].t) return samples[0];
    if (targetMs >= samples[hi].t) return samples[hi];
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].t <= targetMs && (mid === samples.length - 1 || samples[mid + 1].t > targetMs))
            return samples[mid];
        if (samples[mid].t < targetMs) lo = mid + 1;
        else hi = mid - 1;
    }
    return samples[lo] ?? null;
}

export default function InputOverlay({
    videoRef,
    filePath,
}: {
    videoRef: { current: HTMLVideoElement | null };
    filePath: string;
}) {
    const settings = useSettings();
    const [samples, setSamples] = useState<InputSample[]>([]);
    const [available, setAvailable] = useState(false);
    const [enabled, setEnabled] = useState(settings.inputOverlayEnabled);
    const [current, setCurrent] = useState<InputSample | null>(null);
    const rafRef = useRef<number | null>(null);
    const lastUpdateRef = useRef(0);

    // Load the captured input stream for this recording.
    useEffect(() => {
        let cancelled = false;
        setAvailable(false);
        setSamples([]);
        const url = `http://localhost:2222/api/content?input=${encodeURIComponent(inputsJsonPath(filePath))}`;
        fetch(url)
            .then((r) => {
                if (!r.ok) return null;
                return r.text();
            })
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
        if (!enabled || !available) {
            setCurrent(null);
            return;
        }
        const loop = () => {
            const now = performance.now();
            if (now - lastUpdateRef.current >= 33) {
                lastUpdateRef.current = now;
                const v = videoRef.current;
                if (v && samples.length) {
                    setCurrent(binarySearchSample(samples, v.currentTime * 1000));
                }
            }
            rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
    }, [enabled, available, samples, videoRef]);

    if (!available) return null;

    const style = settings.inputOverlayStyle;
    const posClass = POSITION_CLASS[settings.inputOverlayPosition] ?? POSITION_CLASS.BottomLeft;
    const origin = POSITION_ORIGIN[settings.inputOverlayPosition] ?? 'bottom left';
    const scale = settings.inputOverlayScale;
    const opacity = settings.inputOverlayOpacity;

    const keysDown = new Set(current?.k ?? []);
    const mb = current?.mb ?? 0;
    const wheel = current?.w ?? 0;
    const cb = current?.cb ?? 0;
    const lt = current?.lt ?? 0;
    const rt = current?.rt ?? 0;
    const lx = current?.lx ?? 0;
    const ly = current?.ly ?? 0;
    const rx = current?.rx ?? 0;
    const ry = current?.ry ?? 0;

    const isPlayStation = style === 'PlayStationController';
    const isController = style === 'XboxController' || style === 'PlayStationController';

    return (
        <>
            {/* Toggle button (always available when inputs were captured) */}
            <button
                onClick={() => setEnabled((e) => !e)}
                title={enabled ? 'Hide input overlay' : 'Show input overlay'}
                className={`absolute top-2 right-2 z-20 btn btn-xs gap-1 ${enabled ? 'btn-primary' : 'btn-ghost bg-black/60 text-white'}`}
            >
                {enabled ? <Eye size={14} /> : <EyeOff size={14} />}
                {isController ? <Gamepad2 size={14} /> : <Keyboard size={14} />}
            </button>

            {enabled && current && (
                <div
                    className={`absolute z-10 pointer-events-none ${posClass}`}
                    style={{
                        opacity,
                        transform: `scale(${scale})`,
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
                            playstation={isPlayStation}
                        />
                    ) : (
                        <KeyboardMouse keysDown={keysDown} mb={mb} wheel={wheel} />
                    )}
                </div>
            )}
        </>
    );
}

function Key({
    label,
    pressed,
    wide,
}: {
    label: string;
    pressed: boolean;
    wide?: boolean;
}) {
    return (
        <div
            className={`flex items-center justify-center rounded border text-[10px] font-semibold leading-none transition-colors ${
                wide ? 'w-9 h-7' : 'w-7 h-7'
            } ${
                pressed
                    ? 'bg-yellow-400 text-black border-yellow-300'
                    : 'bg-black/60 text-white/80 border-white/20'
            }`}
        >
            {label}
        </div>
    );
}

function KeyboardMouse({
    keysDown,
    mb,
    wheel,
}: {
    keysDown: Set<number>;
    mb: number;
    wheel: number;
}) {
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex flex-col gap-1 bg-black/40 p-1.5 rounded-lg">
                {KB_LAYOUT.map((row, i) => (
                    <div key={i} className="flex gap-1">
                        {row.map((k) => (
                            <Key key={k.code} label={k.label} wide={k.wide} pressed={keysDown.has(k.code)} />
                        ))}
                    </div>
                ))}
            </div>
            {/* Mouse: left/right buttons + wheel */}
            <div className="flex items-center gap-1 bg-black/40 p-1.5 rounded-lg w-fit">
                <div
                    className={`w-7 h-9 rounded-l-lg border ${
                        mb & 1 ? 'bg-yellow-400 border-yellow-300' : 'bg-black/60 border-white/20'
                    }`}
                />
                <div className="flex flex-col items-center gap-0.5">
                    <div
                        className={`w-1.5 h-3 rounded-full ${
                            wheel !== 0 ? 'bg-yellow-400' : 'bg-white/30'
                        }`}
                        title="scroll wheel"
                    />
                </div>
                <div
                    className={`w-7 h-9 rounded-r-lg border ${
                        mb & 2 ? 'bg-yellow-400 border-yellow-300' : 'bg-black/60 border-white/20'
                    }`}
                />
                {(mb & 4) > 0 && (
                    <div className="w-3 h-3 rounded-full bg-yellow-400" title="middle button" />
                )}
            </div>
        </div>
    );
}

function Stick({
    x,
    y,
    label,
}: {
    x: number;
    y: number;
    label: string;
}) {
    // y is negative=up in XInput; flip for screen.
    const left = 50 + x * 35;
    const top = 50 - y * 35;
    return (
        <div className="flex flex-col items-center gap-0.5">
            <div className="relative w-10 h-10 rounded-full bg-black/60 border border-white/20">
                <div
                    className="absolute w-3 h-3 rounded-full bg-yellow-400"
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
            className={`flex items-center justify-center w-6 h-6 rounded-full border text-[10px] font-bold ${
                pressed ? 'bg-yellow-400 text-black border-yellow-300' : 'bg-black/60 text-white/80 border-white/20'
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
        <div className="flex flex-col gap-1 bg-black/40 p-2 rounded-lg w-[200px]">
            {/* Bumpers + triggers */}
            <div className="flex justify-between">
                <div className="flex flex-col items-center gap-0.5">
                    <div
                        className={`w-12 h-3 rounded text-[8px] text-center ${
                            lt > 0.05 ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white/60'
                        }`}
                    >
                        LT
                    </div>
                    <div
                        className={`w-12 h-3 rounded text-[8px] text-center ${
                            cb & LSHOULDER ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white/60'
                        }`}
                    >
                        LB
                    </div>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                    <div
                        className={`w-12 h-3 rounded text-[8px] text-center ${
                            rt > 0.05 ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white/60'
                        }`}
                    >
                        RT
                    </div>
                    <div
                        className={`w-12 h-3 rounded text-[8px] text-center ${
                            cb & RSHOULDER ? 'bg-yellow-400 text-black' : 'bg-black/60 text-white/60'
                        }`}
                    >
                        RB
                    </div>
                </div>
            </div>
            {/* Main body: left stick, dpad, face buttons, right stick */}
            <div className="flex justify-between items-center">
                <div className="flex flex-col gap-1 items-center">
                    <Stick x={lx} y={ly} label="L" />
                    {/* D-pad */}
                    <div className="relative w-12 h-12">
                        <div
                            className={`absolute left-1/2 top-0 -translate-x-1/2 w-3 h-4 rounded ${
                                cb & DPAD_UP ? 'bg-yellow-400' : 'bg-black/60 border border-white/20'
                            }`}
                        />
                        <div
                            className={`absolute left-1/2 bottom-0 -translate-x-1/2 w-3 h-4 rounded ${
                                cb & DPAD_DOWN ? 'bg-yellow-400' : 'bg-black/60 border border-white/20'
                            }`}
                        />
                        <div
                            className={`absolute top-1/2 left-0 -translate-y-1/2 w-4 h-3 rounded ${
                                cb & DPAD_LEFT ? 'bg-yellow-400' : 'bg-black/60 border border-white/20'
                            }`}
                        />
                        <div
                            className={`absolute top-1/2 right-0 -translate-y-1/2 w-4 h-3 rounded ${
                                cb & DPAD_RIGHT ? 'bg-yellow-400' : 'bg-black/60 border border-white/20'
                            }`}
                        />
                    </div>
                </div>
                <div className="flex flex-col gap-1 items-center">
                    {/* Face buttons diamond */}
                    <div className="relative w-14 h-14">
                        <PadButton pressed={(cb & BTN_Y) > 0} className="absolute left-1/2 top-0 -translate-x-1/2">
                            {y}
                        </PadButton>
                        <PadButton
                            pressed={(cb & BTN_A) > 0}
                            className="absolute left-1/2 bottom-0 -translate-x-1/2"
                        >
                            {a}
                        </PadButton>
                        <PadButton pressed={(cb & BTN_X) > 0} className="absolute top-1/2 left-0 -translate-y-1/2">
                            {x}
                        </PadButton>
                        <PadButton
                            pressed={(cb & BTN_B) > 0}
                            className="absolute top-1/2 right-0 -translate-y-1/2"
                        >
                            {b}
                        </PadButton>
                    </div>
                    <Stick x={rx} y={ry} label="R" />
                </div>
            </div>
            {/* Start / Back */}
            <div className="flex justify-center gap-3">
                <div
                    className={`w-4 h-4 rounded-full ${
                        cb & BTN_BACK ? 'bg-yellow-400' : 'bg-black/60 border border-white/20'
                    }`}
                    title="Back"
                />
                <div
                    className={`w-4 h-4 rounded-full ${
                        cb & BTN_START ? 'bg-yellow-400' : 'bg-black/60 border border-white/20'
                    }`}
                    title="Start"
                />
            </div>
        </div>
    );
}
