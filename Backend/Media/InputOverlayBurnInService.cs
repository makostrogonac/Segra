using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using Serilog;

namespace Segra.Backend.Media;

// ponytail: burn-in = render overlay PNGs for the clip's frame range (server-side GDI+), then
// composite them over the clip with a single ffmpeg overlay pass. Re-encodes video (clips are
// short); copies audio. Two-pass keeps it decoupled from ClipService's audio filter graph.
public static class InputOverlayBurnInService
{
    public static async Task<bool> BurnAsync(
        int clipId,
        string clipPath,
        string inputsJsonPath,
        double segStart,
        double segEnd,
        OverlayBurnConfig cfg,
        Action<double>? progress,
        Action<Process>? onProcessStarted)
    {
        var samples = InputOverlayRenderer.ParseInputs(inputsJsonPath);
        if (samples.Count == 0)
        {
            Log.Information("InputOverlay burn-in: no input data at {Path}; skipping overlay", inputsJsonPath);
            return false;
        }

        string meta = await FFmpegService.GetMetadata(clipPath);
        var (w, h, fps) = FFmpegService.ExtractVideoInfo(meta);
        if (w <= 0 || h <= 0)
        {
            Log.Warning("InputOverlay burn-in: could not probe clip dimensions for {Path}", clipPath);
            return false;
        }
        if (fps <= 0) fps = 30;

        double duration = segEnd - segStart;
        int frameCount = (int)Math.Ceiling(duration * fps);
        if (frameCount <= 0)
        {
            Log.Warning("InputOverlay burn-in: non-positive frame count (duration={Dur}, fps={Fps})", duration, fps);
            return false;
        }

        string tempDir = Path.Combine(Path.GetTempPath(), $"segra_overlay_{Guid.NewGuid()}");
        Directory.CreateDirectory(tempDir);

        Log.Information("InputOverlay burn-in: {Frames} frames at {Fps}fps, {W}x{H}, style={Style}", frameCount, fps, w, h, cfg.Style);

        Bitmap? scratch = cfg.Opacity < 0.999 ? new Bitmap(w, h, PixelFormat.Format32bppArgb) : null;
        try
        {
            using var frame = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            for (int i = 0; i < frameCount; i++)
            {
                double tMs = (segStart + i / fps) * 1000.0;
                int idx = InputOverlayRenderer.FindSampleIndex(samples, tMs + cfg.SyncOffsetMs);
                InputSample? sample = idx >= 0 ? samples[idx] : null;
                InputOverlayRenderer.DrawFrame(frame, scratch, cfg, sample, samples, idx);
                frame.Save(Path.Combine(tempDir, $"{i:D6}.png"), ImageFormat.Png);
                progress?.Invoke(0.7 * i / frameCount);
            }

            string outPath = clipPath + ".burn.mp4";
            string pngPattern = Path.Combine(tempDir, "%06d.png");
            string args =
                $"-y -i \"{clipPath}\" -framerate {fps.ToString(CultureInfo.InvariantCulture)} -i \"{pngPattern}\" " +
                $"-filter_complex \"[0:v][1:v]overlay=0:0:format=auto\" " +
                $"-c:a copy -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -movflags +faststart \"{outPath}\"";

            await FFmpegService.RunWithProgress(clipId, args, duration, p => progress?.Invoke(0.7 + 0.3 * p), onProcessStarted);

            if (!File.Exists(outPath))
                throw new Exception("Burn-in output file was not created");

            File.Delete(clipPath);
            File.Move(outPath, clipPath);
            progress?.Invoke(1.0);
            return true;
        }
        finally
        {
            scratch?.Dispose();
            try { Directory.Delete(tempDir, true); } catch { /* best effort */ }
        }
    }
}
