using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Timer = System.Threading.Timer;
using Serilog;

namespace Segra.Backend.Recorder;

// Records keyboard/mouse/controller input during a session recording as NDJSON snapshots
// (~30Hz) synced to recording start, so the editor can render a toggleable overlay afterwards.
// ponytail: XInput only in v1 (Xbox + DS4Windows-emulated DualSense). Native DualSense needs
// Windows.Gaming.Input; add it if a user runs a pad outside XInput mode. Mouse movement is
// captured as absolute screen position; the overlay can ignore it and use buttons/wheel only.
internal static class InputCaptureService
{
    private const int SnapshotIntervalMs = 33;   // ~30Hz
    private const int FlushIntervalMs = 1000;

    private static Thread? _hookThread;
    private static uint _hookThreadId;
    private static IntPtr _keyboardHook = IntPtr.Zero;
    private static IntPtr _mouseHook = IntPtr.Zero;
    private static Timer? _snapshotTimer;
    private static string? _outputPath;
    private static FileStream? _stream;
    private static StreamWriter? _writer;
    private static long _lastFlushTicks;
    private static Stopwatch? _stopwatch;

    private static readonly object _fileLock = new();
    private static readonly object _stateLock = new();
    private static readonly HashSet<int> _keysDown = new();
    private static int _mouseButtons;
    private static int _mouseX, _mouseY;
    private static int _wheelDelta;
    private static bool _xinputMissing;

    // Kept as static fields so the GC does not collect the delegates while hooks are installed.
    private static readonly LowLevelKeyboardProc _keyboardProc = KeyboardHookCallback;
    private static readonly LowLevelMouseProc _mouseProc = MouseHookCallback;

    public static void Start(string videoFilePath, DateTime recordingStart)
    {
        if (!OperatingSystem.IsWindows())
            return;
        Stop(); // safety: tear down any prior session

        _outputPath = Path.ChangeExtension(videoFilePath, ".inputs.json");
        Directory.CreateDirectory(Path.GetDirectoryName(_outputPath)!);
        _stream = new FileStream(_outputPath, FileMode.Create, FileAccess.Write, FileShare.Read);
        _writer = new StreamWriter(_stream, new UTF8Encoding(false)) { AutoFlush = false };
        _stopwatch = Stopwatch.StartNew();
        ResetState();
        _lastFlushTicks = Environment.TickCount64;

        _hookThread = new Thread(HookThreadStart) { IsBackground = true, Name = "InputCaptureHooks" };
        _hookThread.Start();

        _snapshotTimer = new Timer(SnapshotCallback, null, SnapshotIntervalMs, SnapshotIntervalMs);
        Log.Information($"Input capture started -> {_outputPath}");
    }

    public static void Stop()
    {
        if (_snapshotTimer == null && _hookThread == null)
            return;

        _snapshotTimer?.Dispose();
        _snapshotTimer = null;

        if (_keyboardHook != IntPtr.Zero) { UnhookWindowsHookEx(_keyboardHook); _keyboardHook = IntPtr.Zero; }
        if (_mouseHook != IntPtr.Zero) { UnhookWindowsHookEx(_mouseHook); _mouseHook = IntPtr.Zero; }
        if (_hookThreadId != 0)
            PostThreadMessage(_hookThreadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero);
        _hookThread?.Join(2000);
        _hookThread = null;
        _hookThreadId = 0;

        // One last snapshot + flush so the tail of the recording is captured.
        SnapshotCallback(null);
        lock (_fileLock)
        {
            _writer?.Flush();
            _writer?.Dispose();
            _stream?.Dispose();
            _writer = null;
            _stream = null;
        }
        _stopwatch = null;
        Log.Information("Input capture stopped");
    }

    private static void ResetState()
    {
        lock (_stateLock)
        {
            _keysDown.Clear();
            _mouseButtons = 0;
            _mouseX = 0;
            _mouseY = 0;
            _wheelDelta = 0;
        }
    }

    private static void HookThreadStart()
    {
        _hookThreadId = GetCurrentThreadId();
        IntPtr hMod = GetModuleHandle(null);
        _keyboardHook = SetWindowsHookEx(WH_KEYBOARD_LL, _keyboardProc, hMod, 0);
        _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, hMod, 0);

        MSG msg;
        while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessage(ref msg);
        }
    }

    private static IntPtr KeyboardHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HC_ACTION)
        {
            int vk = Marshal.ReadInt32(lParam); // KBDLLHOOKSTRUCT.vkCode is the first field
            int msg = wParam.ToInt32();
            lock (_stateLock)
            {
                if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
                    _keysDown.Add(vk);
                else if (msg == WM_KEYUP || msg == WM_SYSKEYUP)
                    _keysDown.Remove(vk);
            }
        }
        return CallNextHookEx(_keyboardHook, nCode, wParam, lParam);
    }

    private static IntPtr MouseHookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode == HC_ACTION)
        {
            var msll = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
            int msg = wParam.ToInt32();
            lock (_stateLock)
            {
                _mouseX = msll.pt.x;
                _mouseY = msll.pt.y;
                short hi = (short)(msll.mouseData >> 16);
                switch (msg)
                {
                    case WM_LBUTTONDOWN: _mouseButtons |= 1; break;
                    case WM_LBUTTONUP:   _mouseButtons &= ~1; break;
                    case WM_RBUTTONDOWN: _mouseButtons |= 2; break;
                    case WM_RBUTTONUP:   _mouseButtons &= ~2; break;
                    case WM_MBUTTONDOWN: _mouseButtons |= 4; break;
                    case WM_MBUTTONUP:   _mouseButtons &= ~4; break;
                    case WM_XBUTTONDOWN: _mouseButtons |= (hi == 1) ? 8 : 16; break;
                    case WM_XBUTTONUP:   _mouseButtons &= ~24; break;
                    case WM_MOUSEWHEEL:  _wheelDelta += hi; break;
                }
            }
        }
        return CallNextHookEx(_mouseHook, nCode, wParam, lParam);
    }

    private static void SnapshotCallback(object? _)
    {
        try
        {
            if (_writer == null || _stopwatch == null)
                return;

            double t = _stopwatch.Elapsed.TotalMilliseconds;

            // Poll controller (XInput slot 0). Silent if xinput1_4.dll is absent.
            ushort cb = 0;
            float lt = 0f, rt = 0f, lx = 0f, ly = 0f, rx = 0f, ry = 0f;
            if (!_xinputMissing)
            {
                try
                {
                    if (XInputGetState(0, out XINPUT_STATE state) == ERROR_SUCCESS)
                    {
                        cb = state.Gamepad.wButtons;
                        lt = state.Gamepad.bLeftTrigger / 255f;
                        rt = state.Gamepad.bRightTrigger / 255f;
                        lx = NormStick(state.Gamepad.sThumbLX);
                        ly = NormStick(state.Gamepad.sThumbLY);
                        rx = NormStick(state.Gamepad.sThumbRX);
                        ry = NormStick(state.Gamepad.sThumbRY);
                    }
                }
                catch (DllNotFoundException)
                {
                    _xinputMissing = true; // don't keep retrying a missing DLL
                }
            }

            int[] keys;
            int mb, mx, my, w;
            lock (_stateLock)
            {
                keys = _keysDown.ToArray();
                mb = _mouseButtons;
                mx = _mouseX;
                my = _mouseY;
                w = _wheelDelta;
                _wheelDelta = 0;
            }

            var sb = new StringBuilder(128);
            sb.Append("{\"t\":").Append(t.ToString("0.##", CultureInfo.InvariantCulture));
            sb.Append(",\"k\":[");
            for (int i = 0; i < keys.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(keys[i]);
            }
            sb.Append("],\"mb\":").Append(mb);
            sb.Append(",\"mx\":").Append(mx).Append(",\"my\":").Append(my).Append(",\"w\":").Append(w);
            sb.Append(",\"cb\":").Append(cb);
            sb.Append(",\"lt\":").Append(lt.ToString("0.##", CultureInfo.InvariantCulture));
            sb.Append(",\"rt\":").Append(rt.ToString("0.##", CultureInfo.InvariantCulture));
            sb.Append(",\"lx\":").Append(lx.ToString("0.###", CultureInfo.InvariantCulture));
            sb.Append(",\"ly\":").Append(ly.ToString("0.###", CultureInfo.InvariantCulture));
            sb.Append(",\"rx\":").Append(rx.ToString("0.###", CultureInfo.InvariantCulture));
            sb.Append(",\"ry\":").Append(ry.ToString("0.###", CultureInfo.InvariantCulture));
            sb.Append("}\n");

            lock (_fileLock)
                _writer.Write(sb.ToString());

            if (Environment.TickCount64 - _lastFlushTicks >= FlushIntervalMs)
            {
                lock (_fileLock)
                    _writer.Flush();
                _lastFlushTicks = Environment.TickCount64;
            }
        }
        catch (Exception ex)
        {
            Log.Warning($"Input capture snapshot error: {ex.Message}");
        }
    }

    private static float NormStick(short v)
    {
        const int dead = 7849; // XINPUT_GAMEPAD_LEFT_THUMB_DEADZONE
        if (v > -dead && v < dead)
            return 0f;
        return Math.Clamp(v / 32768f, -1f, 1f);
    }

    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const int HC_ACTION = 0;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_SYSKEYUP = 0x0105;
    private const int WM_LBUTTONDOWN = 0x0201;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_RBUTTONDOWN = 0x0204;
    private const int WM_RBUTTONUP = 0x0205;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_MBUTTONUP = 0x0208;
    private const int WM_XBUTTONDOWN = 0x020B;
    private const int WM_XBUTTONUP = 0x020C;
    private const int WM_MOUSEWHEEL = 0x020A;
    private const int WM_QUIT = 0x0012;
    private const uint ERROR_SUCCESS = 0;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);
    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT
    {
        public POINT pt;
        public uint mouseData;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct XINPUT_GAMEPAD
    {
        public ushort wButtons;
        public byte bLeftTrigger;
        public byte bRightTrigger;
        public short sThumbLX;
        public short sThumbLY;
        public short sThumbRX;
        public short sThumbRY;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct XINPUT_STATE
    {
        public uint dwPacketNumber;
        public XINPUT_GAMEPAD Gamepad;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [DllImport("xinput1_4.dll")]
    private static extern uint XInputGetState(uint dwUserIndex, out XINPUT_STATE pState);
}
