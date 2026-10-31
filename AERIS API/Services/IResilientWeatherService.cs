using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public interface IResilientWeatherService
{
    Task<MetarData> GetAirportWeatherAsync(string icaoCode, double lat, double lon);
}
