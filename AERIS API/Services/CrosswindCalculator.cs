using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>
/// Calculează componentele de vânt lateral (crosswind) și de față/spate (headwind/tailwind)
/// utilizând trigonometria unghiulară și constantele verificate din <see cref="RunwayConfiguration"/>.
/// </summary>
public class CrosswindCalculator
{
    /// <summary>
    /// Calculează componentele de vânt lateral și de față/spate față de un cap de pistă dat.
    /// Notă referință: Dacă windDirectionDegrees provine din METAR (True North), runwayHeadingDegrees trebuie să fie True Bearing (ex: 88.93°).
    /// Dacă provine din turnul de control/ATIS (Magnetic), runwayHeadingDegrees trebuie să fie Magnetic Heading (ex: 83.93° / 084°).
    /// </summary>
    public static (double CrosswindKnots, double HeadwindKnots) Calculate(double windDirectionDegrees, double windSpeedKnots, double runwayHeadingDegrees)
    {
        double angleDiffDegrees = (windDirectionDegrees - runwayHeadingDegrees) % 360;
        if (angleDiffDegrees < -180) angleDiffDegrees += 360;
        if (angleDiffDegrees > 180) angleDiffDegrees -= 360;

        double angleRadians = angleDiffDegrees * Math.PI / 180.0;

        double crosswind = Math.Abs(windSpeedKnots * Math.Sin(angleRadians));
        double headwind = windSpeedKnots * Math.Cos(angleRadians);

        return (Math.Round(crosswind, 1), Math.Round(headwind, 1));
    }

    /// <summary>
    /// Determină pista activă (08 sau 26) la Craiova (LRCV) în funcție de vântul de față maxim.
    /// Pista 08 are orientare adevărată 88.93° (magnetic 084°), pista 26 are 268.95° (magnetic 264°).
    /// </summary>
    public static (string ActiveRunway, double RunwayHeading, double CrosswindKnots, double HeadwindKnots) DetermineActiveRunwayCraiova(
        double windDirectionDegrees, double windSpeedKnots, bool isWindDirectionTrueNorth = true)
    {
        double heading08 = RunwayConfiguration.GetHeading(RunwayConfiguration.Runway08, trueNorth: isWindDirectionTrueNorth);
        double heading26 = RunwayConfiguration.GetHeading(RunwayConfiguration.Runway26, trueNorth: isWindDirectionTrueNorth);

        var (cross08, head08) = Calculate(windDirectionDegrees, windSpeedKnots, heading08);
        var (cross26, head26) = Calculate(windDirectionDegrees, windSpeedKnots, heading26);

        if (head26 > head08)
        {
            return (RunwayConfiguration.Runway26, heading26, cross26, head26);
        }

        return (RunwayConfiguration.Runway08, heading08, cross08, head08);
    }

    /// <summary>
    /// Returnează identificatorul pistei opuse (sens invers / reciprocal).
    /// </summary>
    public static string GetReciprocalRunway(string runwayId) => RunwayConfiguration.GetReciprocal(runwayId);

    /// <summary>
    /// Returnează capul pentru pistele din zona Craiova și aerodromurile locale.
    /// </summary>
    public static double GetRunwayHeading(string runwayId, bool trueNorth = true) => RunwayConfiguration.GetHeading(runwayId, trueNorth);
}
