using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Models.TrajectorySeparation;

namespace Aeris.PlanningEngine.Services.TrajectorySeparation;

/// <summary>
/// Interfața motorului de separare 3D și siguranță a traiectoriilor (Trajectory &amp; Separation Engine).
/// </summary>
public interface ITrajectorySeparationEngine
{
    /// <summary>
    /// Evaluează separarea și siguranța unei liste de traiectorii calculate.
    /// </summary>
    SafetyAssessmentResult ValidateSeparation(List<AircraftTrajectory> trajectories, SeparationSettings? settings = null);

    /// <summary>
    /// Prezice traiectoriile și validează programarea propusă de PlanningEngine pentru aeroportul Craiova.
    /// </summary>
    SafetyAssessmentResult ValidateSchedule(
        List<CraiovaAircraft> aircrafts,
        List<ScheduleSlot> schedule,
        string runwayId = "09",
        SeparationSettings? settings = null);

    /// <summary>
    /// Validează separarea directă între stări instantanee sau puncte cunoscute de aeronave.
    /// </summary>
    SafetyAssessmentResult ValidateDirectStates(List<Aircraft3DState> states, SeparationSettings? settings = null);

    /// <summary>
    /// Verifică siguranța pistei: ocupare și intervale de siaj (Wake Turbulence) între aterizări consecutive.
    /// </summary>
    List<SeparationConflict> CheckRunwaySafety(
        List<(string AircraftId, AircraftCategory Category, FlightRules Rules, double LandingTimeSeconds)> landings,
        SeparationSettings settings);
}
