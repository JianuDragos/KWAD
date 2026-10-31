using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public interface IVfrGeofenceService
{
    event Action<VfrPointEnteredEventArgs>? OnVfrPointEntered;
    IReadOnlyList<VfrReportingPoint> ReportingPoints { get; }
    void ReplaceReportingPoints(IEnumerable<VfrReportingPoint> points);
    void UpsertTrack(VfrTrackState track);
    void RegisterFlightPlan(VfrFlightPlan flightPlan);
    IReadOnlyList<VfrFlightPlan> FlightPlans { get; }
    bool TryCorrelate(string trackId, string flightPlanId, string callsign);
    IReadOnlyList<VfrTrackState> Tracks { get; }
    IReadOnlyList<VfrTrackingState> Evaluate(LivePositionsResponse positions, MetarDecoded metar, string runway);
}
