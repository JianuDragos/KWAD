using Aeris.LocalAI;

public static class Fixture {
    // Replace this with statements rendered from your deterministic planner and typed repositories.
    // Never copy a user message, RAG passage or external weather prose into approved statements.
    public static readonly ApprovedStatement[] Statements = [
        new("decision", "The engine selected P2 for this simulated arrival scenario; its total delay is 5 minutes.", "ENGINE-42", true),
        new("delays", "The supplied plans have total delays of 8 minutes for P1 and 5 minutes for P2. P2 has the lower total delay.", "ENGINE-42"),
        new("arrivals", "The planned arrival order is IFR101 at 10:00, VFR201 at 10:03, then IFR102 at 10:06. VFR201's ETA is 10:01.", "ENGINE-42"),
        new("weather", "The synthetic weather observation reports wind from 240 degrees at 12 knots and visibility of 6000 metres. It is not a forecast.", "WEATHER-42"),
        new("hypothetical", "Visibility of 3000 metres is a hypothetical change, not an observation or forecast.", "SCENARIO-42"),
        new("aircraft", "Supplied simulated approach speeds are A320: 135 knots, C172: 65 knots, ATR72: 110 knots. C172 is slowest; ATR72 uses turboprop propulsion.", "AIRCRAFT-42"),
        new("crosswind", "Maximum demonstrated crosswind for this C172 is not supplied. No crosswind capability is inferred.", "AIRCRAFT-42"),
        new("terms", "IFR means instrument flight rules; VFR means visual flight rules. ETA is estimated arrival time; planned landing is the engine-assigned time.", "DEFINITIONS-42"),
        new("limits", "Simulation only. Operational criteria are missing; this report grants no real-world flight permission or clearance.", "RULES-42", true)
    ];
}
