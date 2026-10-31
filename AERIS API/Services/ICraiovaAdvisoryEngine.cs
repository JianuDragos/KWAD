using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public interface ICraiovaAdvisoryEngine
{
    CraiovaSimulationResult EvaluateSimulation(
        List<CraiovaAircraft> aircrafts,
        WeatherCondition weather,
        string dataSource = "OpenSky Live / Craiova Simulation",
        bool useTrajectoryEngine = true
    );

    List<AlternateAerodrome> GetAlternateAerodromes(WeatherCondition weather, double aircraftCruiseSpeedKnots = 70);
}
