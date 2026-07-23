using Segra.Backend.Core.Models;

namespace Segra.Backend.Games.Fortnite
{
    internal class FortniteIntegration : OcrIntegration
    {
        protected override OcrConfig GetConfig() => new()
        {
            LogPrefix = "Fortnite",
            CropRegion = new CropRegion(X: 0.25, Y: 0.40, Width: 0.50, Height: 0.35),
            Keywords =
            [
                new() { Text = "ELIMINATED BY", BookmarkType = BookmarkType.Death, ExactMatch = true },
                new()
                {
                    Text = "ELIMINATED",
                    BookmarkType = BookmarkType.Kill,
                    ExcludeFragments = ["ELIMINATED BY"]
                },
            ],
            PollIntervalMs = 200,
            EventCooldown = TimeSpan.FromSeconds(3),
        };
    }
}
