namespace Aeris.PlanningEngine.Models.TrajectorySeparation;

/// <summary>
/// Starea 3D a unei aeronave la un moment dat în timp.
/// </summary>
public record Aircraft3DState(
    string AircraftId,
    string Callsign,
    FlightRules FlightRules,
    AircraftCategory Category,
    double Latitude,
    double Longitude,
    double AltitudeFeet,
    double SpeedKnots,
    double HeadingDegrees,
    double TimestampSeconds
)
{
    public WakeCategory WakeCategory => Category switch
    {
        AircraftCategory.CommercialJet => WakeCategory.Medium,
        AircraftCategory.RegionalTurboprop => WakeCategory.Medium,
        AircraftCategory.GeneralAviation => WakeCategory.Light,
        AircraftCategory.UltralightAndGlider => WakeCategory.Light,
        _ => WakeCategory.Light
    };
}
