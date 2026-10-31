namespace Aeris.PlanningEngine.Services;

public class CrosswindCalculator
{
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
    /// Determină pista activă (09 sau 27) la Craiova (LRCV) în funcție de vântul de față maxim.
    /// Pista 09 are cap magnetic 092°, pista 27 are cap magnetic 272°.
    /// </summary>
    public static (string ActiveRunway, double RunwayHeading, double CrosswindKnots, double HeadwindKnots) DetermineActiveRunwayCraiova(double windDirectionDegrees, double windSpeedKnots)
    {
        var (cross09, head09) = Calculate(windDirectionDegrees, windSpeedKnots, 92.0);
        var (cross27, head27) = Calculate(windDirectionDegrees, windSpeedKnots, 272.0);

        if (head27 > head09)
        {
            return ("27", 272.0, cross27, head27);
        }

        return ("09", 92.0, cross09, head09);
    }
}
