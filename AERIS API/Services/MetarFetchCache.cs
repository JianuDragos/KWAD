using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>Shares one upstream METAR request across API clients, with a minimum five-minute interval.</summary>
public sealed class MetarFetchCache
{
    private static readonly TimeSpan RefreshInterval = TimeSpan.FromMinutes(5);
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private MetarRaw? _latest;
    private long _nextFetchUtcTicks;

    public async Task<MetarRaw?> GetLatestAsync(Func<Task<MetarRaw?>> fetch)
    {
        if (DateTime.UtcNow.Ticks < Interlocked.Read(ref _nextFetchUtcTicks)) return _latest;

        await _refreshLock.WaitAsync();
        try
        {
            if (DateTime.UtcNow.Ticks < Interlocked.Read(ref _nextFetchUtcTicks)) return _latest;
            var result = await fetch();
            if (result is not null) _latest = result;
            return _latest;
        }
        finally
        {
            // Throttle failures too, otherwise multiple clients can immediately retry a rate-limited source.
            Interlocked.Exchange(ref _nextFetchUtcTicks, DateTime.UtcNow.Add(RefreshInterval).Ticks);
            _refreshLock.Release();
        }
    }
}
