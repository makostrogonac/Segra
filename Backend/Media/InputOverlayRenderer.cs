using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.Text.Json;
using Serilog;

namespace Segra.Backend.Media;

// ponytail: burn-in renderer. Mirrors Frontend/src/Components/InputOverlay.tsx drawing so the
// burned overlay matches the editor preview. Overlay size is relative to the source video width
// (BASELINE=1280), so preview and burn-in stay consistent regardless of editor size.

public enum OverlayBurnStyle { KeyboardMouse, XboxController, PlayStationController }

public class OverlayBurnKey
{
    public int Vk { get; set; }
    public string Label { get; set; } = "";
    public double X { get; set; }
    public double Y { get; set; }
    public double W { get; set; }
    public double H { get; set; }
}

public class OverlayBurnMouse
{
    public double X { get; set; }
    public double Y { get; set; }
    public double W { get; set; }
    public double H { get; set; }
    public bool ShowMovement { get; set; }
}

public class OverlayBurnPreset
{
    public List<OverlayBurnKey> Keys { get; set; } = new();
    public OverlayBurnMouse? Mouse { get; set; }
}

public class OverlayBurnConfig
{
    public OverlayBurnStyle Style { get; set; } = OverlayBurnStyle.KeyboardMouse;
    public double PosX { get; set; } = 0;
    public double PosY { get; set; } = 1;
    public double Scale { get; set; } = 1;
    public double Opacity { get; set; } = 1;
    public double SyncOffsetMs { get; set; } = 0;
    public OverlayBurnPreset Preset { get; set; } = new();
}

public struct InputSample
{
    public double T;
    public int[] K;
    public int Mb;
    public double Mx;
    public double My;
    public int W;
    public int Cb;
    public double Lt;
    public double Rt;
    public double Lx;
    public double Ly;
    public double Rx;
    public double Ry;
}

public static class InputOverlayRenderer
{
    private const double BASELINE = 1280.0;

    // XInput wButtons bitmask (mirrors the frontend).
    private const int DPAD_UP = 0x0001, DPAD_DOWN = 0x0002, DPAD_LEFT = 0x0004, DPAD_RIGHT = 0x0008;
    private const int BTN_START = 0x0010, BTN_BACK = 0x0020;
    private const int LSHOULDER = 0x0100, RSHOULDER = 0x0200;
    private const int BTN_A = 0x1000, BTN_B = 0x2000, BTN_X = 0x4000, BTN_Y = 0x8000;

    // Palette (mirrors InputOverlay.tsx).
    private static readonly Color PressedTop = Color.FromArgb(253, 224, 71);    // #fde047
    private static readonly Color PressedBot = Color.FromArgb(245, 158, 11);    // #f59e0b
    private static readonly Color PressedBorder = Color.FromArgb(252, 211, 77); // #fcd34d
    private static readonly Color IdleTop = Color.FromArgb(217, 40, 42, 54);    // rgba(40,42,54,0.85)
    private static readonly Color IdleBot = Color.FromArgb(230, 20, 21, 30);    // rgba(20,21,30,0.9)
    private static readonly Color IdleBorder = Color.FromArgb(26, 255, 255, 255);
    private static readonly Color IdleText = Color.FromArgb(179, 255, 255, 255);
    private static readonly Color MouseBodyTop = Color.FromArgb(230, 40, 36, 46); // #28242e/0.9
    private static readonly Color MouseBodyBot = Color.FromArgb(242, 21, 18, 26); // #15121a/0.95
    private static readonly Color MouseBorder = Color.FromArgb(26, 255, 255, 255);
    private static readonly Color Groove = Color.FromArgb(38, 255, 255, 255);
    private static readonly Color WheelIdle = Color.FromArgb(64, 255, 255, 255);
    private static readonly Color SideIdle = Color.FromArgb(46, 255, 255, 255);
    private static readonly Color TrailHead = Color.FromArgb(253, 224, 71);
    private static readonly Color TrailDim = Color.FromArgb(120, 253, 224, 71);

    public static List<InputSample> ParseInputs(string path)
    {
        var list = new List<InputSample>();
        if (!File.Exists(path)) return list;
        foreach (var raw in File.ReadAllLines(path))
        {
            var line = raw.Trim();
            if (line.Length == 0) continue;
            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var s = new InputSample
                {
                    T = root.TryGetProperty("t", out var t) ? t.GetDouble() : 0,
                    Mb = root.TryGetProperty("mb", out var mb) ? mb.GetInt32() : 0,
                    Mx = root.TryGetProperty("mx", out var mx) ? mx.GetDouble() : 0,
                    My = root.TryGetProperty("my", out var my) ? my.GetDouble() : 0,
                    W = root.TryGetProperty("w", out var w) ? w.GetInt32() : 0,
                    Cb = root.TryGetProperty("cb", out var cb) ? cb.GetInt32() : 0,
                    Lt = root.TryGetProperty("lt", out var lt) ? lt.GetDouble() : 0,
                    Rt = root.TryGetProperty("rt", out var rt) ? rt.GetDouble() : 0,
                    Lx = root.TryGetProperty("lx", out var lx) ? lx.GetDouble() : 0,
                    Ly = root.TryGetProperty("ly", out var ly) ? ly.GetDouble() : 0,
                    Rx = root.TryGetProperty("rx", out var rx) ? rx.GetDouble() : 0,
                    Ry = root.TryGetProperty("ry", out var ry) ? ry.GetDouble() : 0,
                };
                if (root.TryGetProperty("k", out var karr) && karr.ValueKind == JsonValueKind.Array)
                    s.K = karr.EnumerateArray().Select(e => e.GetInt32()).ToArray();
                else
                    s.K = Array.Empty<int>();
                list.Add(s);
            }
            catch (Exception ex)
            {
                Log.Warning("InputOverlay: skipping malformed NDJSON line: {Msg}", ex.Message);
            }
        }
        list.Sort((a, b) => a.T.CompareTo(b.T));
        return list;
    }

    public static int FindSampleIndex(List<InputSample> samples, double targetMs)
    {
        if (samples.Count == 0) return -1;
        int lo = 0, hi = samples.Count - 1;
        if (targetMs <= samples[0].T) return 0;
        if (targetMs >= samples[hi].T) return hi;
        while (lo <= hi)
        {
            int mid = (lo + hi) >> 1;
            if (samples[mid].T <= targetMs && (mid == samples.Count - 1 || samples[mid + 1].T > targetMs))
                return mid;
            if (samples[mid].T < targetMs) lo = mid + 1;
            else hi = mid - 1;
        }
        return lo;
    }

    // Render one transparent overlay frame (video-sized) into `frame`, with opacity baked into alpha.
    // `scratch` is an optional reusable bitmap for the opacity-compositing path.
    public static void DrawFrame(Bitmap frame, Bitmap? scratch, OverlayBurnConfig cfg, InputSample? sample, List<InputSample> samples, int idx)
    {
        int W = frame.Width, H = frame.Height;
        double videoScale = W / BASELINE;
        double renderScale = videoScale * Math.Max(0.05, cfg.Scale);

        if (cfg.Opacity >= 0.999)
        {
            using var g = Graphics.FromImage(frame);
            SetupGraphics(g);
            g.Clear(Color.Transparent);
            DrawOverlay(g, cfg, sample, samples, idx, W, H, renderScale);
        }
        else
        {
            // Draw at full opacity onto an intermediate, then composite with alpha so the PNG
            // carries overlay pixels at alpha == Opacity (ffmpeg overlay then composites over video).
            bool ownsScratch = scratch == null;
            Bitmap inter = scratch ?? new Bitmap(W, H, PixelFormat.Format32bppArgb);
            try
            {
                using (var g = Graphics.FromImage(inter))
                {
                    SetupGraphics(g);
                    g.Clear(Color.Transparent);
                    DrawOverlay(g, cfg, sample, samples, idx, W, H, renderScale);
                }
                using var g2 = Graphics.FromImage(frame);
                SetupGraphics(g2);
                g2.Clear(Color.Transparent);
                var cm = new ColorMatrix { Matrix33 = (float)Math.Clamp(cfg.Opacity, 0, 1) };
                using var ia = new ImageAttributes();
                ia.SetColorMatrix(cm);
                g2.DrawImage(inter, new Rectangle(0, 0, W, H), 0, 0, W, H, GraphicsUnit.Pixel, ia);
            }
            finally
            {
                if (ownsScratch) inter.Dispose();
            }
        }
    }

    private static void SetupGraphics(Graphics g)
    {
        g.PageUnit = GraphicsUnit.Pixel;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
    }

    // Free-form position: posX/posY are fractions of (canvas - box), so 0 = flush left/top, 1 = flush
    // right/bottom. Mirrors Frontend/src/Components/InputOverlay.tsx so burn-in matches the preview.
    private static (double ox, double oy) PositionOffset(double posX, double posY, int canvasW, int canvasH, double boxW, double boxH)
    {
        double denomX = canvasW - boxW;
        double denomY = canvasH - boxH;
        double ox = denomX > 0 ? posX * denomX : denomX / 2;
        double oy = denomY > 0 ? posY * denomY : denomY / 2;
        return (ox, oy);
    }

    private static (double w, double h) PresetBox(OverlayBurnPreset preset)
    {
        double maxX = 0, maxY = 0;
        foreach (var k in preset.Keys)
        {
            maxX = Math.Max(maxX, k.X + k.W);
            maxY = Math.Max(maxY, k.Y + k.H);
        }
        if (preset.Mouse != null)
        {
            maxX = Math.Max(maxX, preset.Mouse.X + preset.Mouse.W);
            maxY = Math.Max(maxY, preset.Mouse.Y + preset.Mouse.H);
        }
        return (maxX + 4, maxY + 4);
    }

    private static void DrawOverlay(Graphics g, OverlayBurnConfig cfg, InputSample? sample, List<InputSample> samples, int idx, int W, int H, double rs)
    {
        if (cfg.Style == OverlayBurnStyle.KeyboardMouse)
        {
            var box = PresetBox(cfg.Preset);
            var (ox, oy) = PositionOffset(cfg.PosX, cfg.PosY, W, H, box.w * rs, box.h * rs);
            DrawKeyboardMouse(g, cfg.Preset, sample, samples, idx, ox, oy, rs);
        }
        else
        {
            const double gw = 200, gh = 170;
            var (ox, oy) = PositionOffset(cfg.PosX, cfg.PosY, W, H, gw * rs, gh * rs);
            DrawGamepad(g, sample, ox, oy, rs, cfg.Style == OverlayBurnStyle.PlayStationController);
        }
    }

    private static void DrawKeyboardMouse(Graphics g, OverlayBurnPreset preset, InputSample? sample, List<InputSample> samples, int idx, double ox, double oy, double rs)
    {
        var down = sample.HasValue ? new HashSet<int>(sample.Value.K) : new HashSet<int>();
        int mb = sample?.Mb ?? 0;
        int wheel = sample?.W ?? 0;

        float fontSize = Math.Max(5f, (float)(10 * rs));
        using var font = new Font("Segoe UI", fontSize, FontStyle.Bold, GraphicsUnit.Pixel);
        using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };

        foreach (var k in preset.Keys)
            DrawKey(g, k, down.Contains(k.Vk), ox, oy, rs, font, sf);

        if (preset.Mouse != null)
            DrawMouse(g, preset.Mouse, mb, wheel, samples, idx, ox, oy, rs);
    }

    private static void DrawKey(Graphics g, OverlayBurnKey k, bool pressed, double ox, double oy, double rs, Font font, StringFormat sf)
    {
        float x = (float)(ox + k.X * rs);
        float y = (float)(oy + k.Y * rs);
        float w = (float)(k.W * rs);
        float h = (float)(k.H * rs);
        float radius = (float)(5 * rs);

        RectangleF rect = new(x, y, w, h);

        if (pressed)
        {
            // Glow approximation: a slightly larger translucent amber rounded rect behind.
            float pad = (float)(2 * rs);
            using var glowPath = RoundedRectPath(x - pad, y - pad, w + 2 * pad, h + 2 * pad, radius + pad);
            using var glowBrush = new SolidBrush(Color.FromArgb(90, 251, 191, 36));
            g.FillPath(glowBrush, glowPath);
        }

        using var path = RoundedRectPath(x, y, w, h, radius);
        var top = pressed ? PressedTop : IdleTop;
        var bot = pressed ? PressedBot : IdleBot;
        using var fill = new LinearGradientBrush(rect, top, bot, LinearGradientMode.Vertical);
        g.FillPath(fill, path);

        using var border = new Pen(pressed ? PressedBorder : IdleBorder, (float)Math.Max(0.5, rs * 0.75));
        g.DrawPath(border, path);

        var textColor = pressed ? Color.Black : IdleText;
        using var textBrush = new SolidBrush(textColor);
        var labelRect = new RectangleF(x, y, w, h);
        g.DrawString(string.IsNullOrEmpty(k.Label) ? " " : k.Label, font, textBrush, labelRect, sf);
    }

    private static void DrawMouse(Graphics g, OverlayBurnMouse mouse, int mb, int wheel, List<InputSample> samples, int idx, double ox, double oy, double rs)
    {
        float x = (float)(ox + mouse.X * rs);
        float y = (float)(oy + mouse.Y * rs);
        float w = (float)(mouse.W * rs);
        float h = (float)(mouse.H * rs);
        float radius = (float)(10 * rs);

        // Body
        RectangleF body = new(x, y, w, h);
        using (var path = RoundedRectPath(x, y, w, h, radius))
        {
            using var fill = new LinearGradientBrush(body, MouseBodyTop, MouseBodyBot, LinearGradientMode.Vertical);
            g.FillPath(fill, path);
            using var border = new Pen(MouseBorder, (float)Math.Max(0.5, rs * 0.75));
            g.DrawPath(border, path);
        }

        float halfW = w / 2f;
        float btnH = h * 0.55f;

        // Left button highlight
        if ((mb & 1) != 0)
        {
            using var p = RoundedRectPath(x, y, halfW, btnH, radius, roundRight: false);
            using var b = new LinearGradientBrush(new RectangleF(x, y, halfW, btnH), PressedTop, PressedBot, LinearGradientMode.Vertical);
            g.FillPath(b, p);
        }
        // Right button highlight
        if ((mb & 2) != 0)
        {
            using var p = RoundedRectPath(x + halfW, y, halfW, btnH, radius, roundLeft: false);
            using var b = new LinearGradientBrush(new RectangleF(x + halfW, y, halfW, btnH), PressedTop, PressedBot, LinearGradientMode.Vertical);
            g.FillPath(b, p);
        }

        // Split groove
        using (var groovePen = new Pen(Groove, (float)Math.Max(0.5, rs)))
            g.DrawLine(groovePen, x + halfW, y, x + halfW, y + btnH);

        // Scroll wheel
        float wheelW = (float)(1.5 * rs);
        float wheelH = (float)(3 * rs);
        var wheelColor = (wheel != 0 || (mb & 4) != 0) ? PressedTop : WheelIdle;
        using (var wheelBrush = new SolidBrush(wheelColor))
            g.FillRectangle(wheelBrush, x + halfW - wheelW / 2, y + h * 0.16f, wheelW, wheelH);

        // Side buttons X1 (mb&8) / X2 (mb&16) — match the preview: 8x12 overlay-px on the left edge.
        float sideW = (float)(8 * rs);
        float sideH = (float)(12 * rs);
        float sideX = x - (float)(4 * rs);
        using (var b1 = new SolidBrush((mb & 8) != 0 ? PressedTop : SideIdle))
            g.FillRectangle(b1, sideX, y + h * 0.26f, sideW, sideH);
        using (var b2 = new SolidBrush((mb & 16) != 0 ? PressedTop : SideIdle))
            g.FillRectangle(b2, sideX, y + h * 0.44f, sideW, sideH);

        if (mouse.ShowMovement)
            DrawMouseTrail(g, samples, idx, x, y, w, h, rs);
    }

    // Mirrors the frontend MouseMovement comet trail. All math in overlay-px (mouse-local), scaled by rs.
    private static void DrawMouseTrail(Graphics g, List<InputSample> samples, int idx, float mx, float my, float mw, float mh, double rs)
    {
        const int N = 10;
        if (idx < 0 || idx >= samples.Count) return;
        int start = Math.Max(0, idx - N);
        var cur = samples[idx];
        const double PX = 0.05;
        var scaled = new List<(double x, double y)>();
        double maxScaled = 0;
        for (int j = start; j <= idx; j++)
        {
            double dx = (samples[j].Mx - cur.Mx) * PX;
            double dy = (samples[j].My - cur.My) * PX;
            scaled.Add((dx, dy));
            maxScaled = Math.Max(maxScaled, Math.Sqrt(dx * dx + dy * dy));
        }
        double maxR = Math.Min(mw, mh) / 2 - 3 * rs;
        double k = maxScaled > maxR ? maxR / maxScaled : 1;
        bool moved = maxScaled * k > 2 * rs;
        float cx = mx + mw / 2f;
        float cy = my + mh / 2f;

        if (moved)
        {
            for (int i = 0; i < scaled.Count - 1; i++)
            {
                double alpha = (double)(i + 1) / scaled.Count;
                var c = Color.FromArgb((int)(alpha * 253), 253, 224, 71);
                using var pen = new Pen(c, (float)Math.Max(1, 2 * rs));
                pen.StartCap = LineCap.Round;
                pen.EndCap = LineCap.Round;
                g.DrawLine(pen,
                    cx + (float)(scaled[i].x * k * rs),
                    cy + (float)(scaled[i].y * k * rs),
                    cx + (float)(scaled[i + 1].x * k * rs),
                    cy + (float)(scaled[i + 1].y * k * rs));
            }
        }
        float headR = (float)((moved ? 2.5 : 1.8) * rs);
        using var headBrush = new SolidBrush(moved ? TrailHead : Color.FromArgb(89, 255, 255, 255));
        g.FillEllipse(headBrush, cx - headR, cy - headR, headR * 2, headR * 2);
    }

    private static void DrawGamepad(Graphics g, InputSample? sample, double ox, double oy, double rs, bool playstation)
    {
        int cb = sample?.Cb ?? 0;
        double lt = sample?.Lt ?? 0;
        double rt = sample?.Rt ?? 0;
        double lx = sample?.Lx ?? 0, ly = sample?.Ly ?? 0;
        double rx = sample?.Rx ?? 0, ry = sample?.Ry ?? 0;

        string a = playstation ? "✕" : "A";
        string b = playstation ? "○" : "B";
        string x = playstation ? "□" : "X";
        string y = playstation ? "△" : "Y";

        float fontSize = Math.Max(5f, (float)(9 * rs));
        using var font = new Font("Segoe UI", fontSize, FontStyle.Bold, GraphicsUnit.Pixel);
        using var sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };

        // Triggers / bumpers (top)
        Bar(g, ox + 8 * rs, oy + 8 * rs, 48 * rs, 12 * rs, lt > 0.05, "LT", font, sf);
        Bar(g, ox + 200 * rs - 8 * rs - 48 * rs, oy + 8 * rs, 48 * rs, 12 * rs, rt > 0.05, "RT", font, sf);
        Bar(g, ox + 8 * rs, oy + 22 * rs, 48 * rs, 12 * rs, (cb & LSHOULDER) != 0, "LB", font, sf);
        Bar(g, ox + 200 * rs - 8 * rs - 48 * rs, oy + 22 * rs, 48 * rs, 12 * rs, (cb & RSHOULDER) != 0, "RB", font, sf);

        // Left stick
        Stick(g, ox + 8 * rs, oy + 40 * rs, 40 * rs, lx, ly, "L", font, sf, rs);
        // D-pad
        double dpx = ox + 8 * rs, dpy = oy + 94 * rs, dps = 48 * rs;
        DPadButton(g, dpx + dps / 2 - 6 * rs, dpy, 12 * rs, 16 * rs, (cb & DPAD_UP) != 0);
        DPadButton(g, dpx + dps / 2 - 6 * rs, dpy + dps - 16 * rs, 12 * rs, 16 * rs, (cb & DPAD_DOWN) != 0);
        DPadButton(g, dpx, dpy + dps / 2 - 6 * rs, 16 * rs, 12 * rs, (cb & DPAD_LEFT) != 0);
        DPadButton(g, dpx + dps - 16 * rs, dpy + dps / 2 - 6 * rs, 16 * rs, 12 * rs, (cb & DPAD_RIGHT) != 0);

        // Face buttons (right)
        double fbx = ox + 200 * rs - 8 * rs - 56 * rs, fby = oy + 40 * rs, fbs = 56 * rs;
        FaceButton(g, fbx + fbs / 2 - 12 * rs, fby, 24 * rs, (cb & BTN_Y) != 0, y, font, sf);
        FaceButton(g, fbx + fbs / 2 - 12 * rs, fby + fbs - 24 * rs, 24 * rs, (cb & BTN_A) != 0, a, font, sf);
        FaceButton(g, fbx, fby + fbs / 2 - 12 * rs, 24 * rs, (cb & BTN_X) != 0, x, font, sf);
        FaceButton(g, fbx + fbs - 24 * rs, fby + fbs / 2 - 12 * rs, 24 * rs, (cb & BTN_B) != 0, b, font, sf);
        // Right stick
        Stick(g, ox + 200 * rs - 8 * rs - 40 * rs, oy + 100 * rs, 40 * rs, rx, ry, "R", font, sf, rs);

        // Back / Start
        Circle(g, ox + 200 * rs / 2 - 18 * rs, oy + 150 * rs, 16 * rs, (cb & BTN_BACK) != 0);
        Circle(g, ox + 200 * rs / 2 + 2 * rs, oy + 150 * rs, 16 * rs, (cb & BTN_START) != 0);
    }

    private static void Bar(Graphics g, double x, double y, double w, double h, bool pressed, string label, Font font, StringFormat sf)
    {
        var rect = new RectangleF((float)x, (float)y, (float)w, (float)h);
        using var brush = new SolidBrush(pressed ? PressedTop : Color.FromArgb(153, 0, 0, 0));
        g.FillRectangle(brush, rect);
        using var pen = new Pen(IdleBorder, 0.5f);
        g.DrawRectangle(pen, rect.X, rect.Y, rect.Width, rect.Height);
        using var tb = new SolidBrush(pressed ? Color.Black : IdleText);
        g.DrawString(label, font, tb, rect, sf);
    }

    private static void Stick(Graphics g, double x, double y, double s, double ax, double ay, string label, Font font, StringFormat sf, double rs)
    {
        var rect = new RectangleF((float)x, (float)y, (float)s, (float)s);
        using var body = new SolidBrush(Color.FromArgb(153, 0, 0, 0));
        g.FillEllipse(body, rect);
        using var pen = new Pen(IdleBorder, 0.5f);
        g.DrawEllipse(pen, rect);
        float dotR = (float)(6 * rs);
        float dotX = (float)(x + s / 2 + ax * (s / 2 - dotR));
        float dotY = (float)(y + s / 2 - ay * (s / 2 - dotR));
        using var dot = new SolidBrush(TrailHead);
        g.FillEllipse(dot, dotX - dotR, dotY - dotR, dotR * 2, dotR * 2);
        var labelRect = new RectangleF((float)x, (float)(y + s + 2 * rs), (float)s, 12 * (float)rs);
        using var tb = new SolidBrush(IdleText);
        g.DrawString(label, font, tb, labelRect, sf);
    }

    private static void DPadButton(Graphics g, double x, double y, double w, double h, bool pressed)
    {
        var rect = new RectangleF((float)x, (float)y, (float)w, (float)h);
        using var brush = new SolidBrush(pressed ? PressedTop : Color.FromArgb(153, 0, 0, 0));
        g.FillRectangle(brush, rect);
        using var pen = new Pen(IdleBorder, 0.5f);
        g.DrawRectangle(pen, rect.X, rect.Y, rect.Width, rect.Height);
    }

    private static void FaceButton(Graphics g, double x, double y, double s, bool pressed, string label, Font font, StringFormat sf)
    {
        var rect = new RectangleF((float)x, (float)y, (float)s, (float)s);
        using var brush = new SolidBrush(pressed ? PressedTop : Color.FromArgb(153, 0, 0, 0));
        g.FillEllipse(brush, rect);
        using var pen = new Pen(IdleBorder, 0.5f);
        g.DrawEllipse(pen, rect);
        using var tb = new SolidBrush(pressed ? Color.Black : IdleText);
        g.DrawString(label, font, tb, rect, sf);
    }

    private static void Circle(Graphics g, double x, double y, double s, bool pressed)
    {
        var rect = new RectangleF((float)x, (float)y, (float)s, (float)s);
        using var brush = new SolidBrush(pressed ? PressedTop : Color.FromArgb(153, 0, 0, 0));
        g.FillEllipse(brush, rect);
        using var pen = new Pen(IdleBorder, 0.5f);
        g.DrawEllipse(pen, rect);
    }

    private static GraphicsPath RoundedRectPath(double x, double y, double w, double h, double r, bool roundLeft = true, bool roundRight = true)
    {
        var path = new GraphicsPath();
        float fx = (float)x, fy = (float)y, fw = (float)w, fh = (float)h;
        float fr = (float)Math.Min(r, Math.Min(fw, fh) / 2f);
        float d = fr * 2;
        if (fr <= 0)
        {
            path.AddRectangle(new RectangleF(fx, fy, fw, fh));
            return path;
        }
        var tl = roundLeft;
        var tr = roundRight;
        var br = roundRight;
        var bl = roundLeft;
        // Top
        if (tl) path.AddArc(fx, fy, d, d, 180, 90); else path.AddLine(fx, fy, fx + (tr ? fr : 0), fy);
        if (tr) path.AddArc(fx + fw - d, fy, d, d, 270, 90); else path.AddLine(fx + fw, fy, fx + fw, fy + (br ? fr : 0));
        if (br) path.AddArc(fx + fw - d, fy + fh - d, d, d, 0, 90); else path.AddLine(fx + fw, fy + fh, fx + fw - (bl ? fr : 0), fy + fh);
        if (bl) path.AddArc(fx, fy + fh - d, d, d, 90, 90); else path.AddLine(fx, fy + fh, fx, fy + (tl ? fr : 0));
        path.CloseFigure();
        return path;
    }
}
