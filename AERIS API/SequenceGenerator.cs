namespace Aeris.PlanningEngine;

public class SequenceGenerator
{
    /// <summary>
    /// Generează cele n + 1 ordine candidate prin introducerea zborului VFR în secvența IFR.
    /// Păstrează ordinea relativă a aeronavelor IFR.
    /// </summary>
    public static List<List<AircraftInput>> GenerateCandidates(List<AircraftInput> aircrafts)
    {
        var ifrList = aircrafts.Where(a => a.FlightRules == FlightRules.IFR).ToList();
        var vfrList = aircrafts.Where(a => a.FlightRules == FlightRules.VFR).ToList();

        if (!vfrList.Any())
            return new List<List<AircraftInput>> { ifrList };

        var candidates = new List<List<AircraftInput>>();
        var vfr = vfrList.First();

        for (int i = 0; i <= ifrList.Count; i++)
        {
            var candidate = new List<AircraftInput>();
            candidate.AddRange(ifrList.Take(i));
            candidate.Add(vfr);
            candidate.AddRange(ifrList.Skip(i));
            candidates.Add(candidate);
        }

        return candidates;
    }
}