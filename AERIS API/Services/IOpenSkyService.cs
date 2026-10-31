using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public interface IOpenSkyService
{
    Task<(List<CraiovaAircraft> Aircrafts, string SourceDescription)> GetCraiovaTrafficAsync(bool forceSimulatedTraffic = false);
}
