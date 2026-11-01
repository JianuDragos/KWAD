using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Services;
using Aeris.LocalAI;

namespace AERIS_API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Produces("application/json")]
public class CraiovaController : ControllerBase
{
    private const double BaseTimeOffsetSeconds = 50400.0; // 14:00:00

    private readonly IOpenSkyService _openSkyService;
    private readonly IOpenSkyLiveService _openSkyLiveService;
    private readonly ICraiovaAdvisoryEngine _advisoryEngine;
    private readonly IMetarService _metarService;
    private readonly GroundedExplainer _groundedExplainer;
    private readonly IVfrGeofenceService _vfrGeofenceService;
    private readonly IOpenAipService _openAipService;
    private readonly IResilientWeatherService _weatherService;
    private readonly IWebHostEnvironment _env;

    public CraiovaController(
        IOpenSkyService openSkyService,
        IOpenSkyLiveService openSkyLiveService,
        ICraiovaAdvisoryEngine advisoryEngine,
        IMetarService metarService,
        GroundedExplainer groundedExplainer,
        IVfrGeofenceService vfrGeofenceService,
        IOpenAipService openAipService,
        IResilientWeatherService weatherService,
        IWebHostEnvironment env)
    {
        _openSkyService = openSkyService;
        _openSkyLiveService = openSkyLiveService;
        _advisoryEngine = advisoryEngine;
        _metarService = metarService;
        _groundedExplainer = groundedExplainer;
        _vfrGeofenceService = vfrGeofenceService;
        _openAipService = openAipService;
        _weatherService = weatherService;
        _env = env;
    }

    /// <summary>
    /// Execută simularea de aterizare pe Aeroportul Craiova (LRCV), colectând date OpenSky și evaluând aeronavele mari (IFR) și mici (Savannah, Wilga, etc.).
    /// În caz de vânt lateral critic, calculează sfaturi de orbită paralelă cu pista sau deviere către Balta Verde / Podari.
    /// </summary>
    [HttpGet("simulation")]
    public async Task<IActionResult> RunSimulation(
        [FromQuery] double windSpeed = 22,
        [FromQuery] double windDirection = 180,
        [FromQuery] double windGust = 26,
        [FromQuery] bool forceSimulated = false,
        [FromQuery] bool useTrajectoryEngine = true)
    {
        var weather = new WeatherCondition(
            WindDirectionDegrees: windDirection,
            WindSpeedKnots: windSpeed,
            WindGustKnots: windGust
        );

        var (traffic, sourceDesc) = await _openSkyService.GetCraiovaTrafficAsync(forceSimulated);
        var result = _advisoryEngine.EvaluateSimulation(traffic, weather, sourceDesc, useTrajectoryEngine);

        return Ok(result);
    }

    /// <summary>
    /// Evaluează un scenariu personalizat pentru Craiova transmis în corpul cererii (vreme custom și listă aeronave).
    /// </summary>
    [HttpPost("evaluate")]
    public IActionResult EvaluateCustomScenario([FromBody] CraiovaCustomEvaluationDto request)
    {
        var weather = request.Weather ?? new WeatherCondition();
        var traffic = request.Aircrafts ?? OpenSkyService.GetRealisticCraiovaTraffic();

        var result = _advisoryEngine.EvaluateSimulation(traffic, weather, "Scenariu personalizat utilizator", request.UseTrajectoryEngine);
        return Ok(result);
    }

    /// <summary>
    /// Returnează lista aerodromurilor alternative din jurul Craiovei (Balta Verde, Podari, Slatina) și calculează compatibilitatea lor matematică.
    /// </summary>
    [HttpGet("alternates")]
    public IActionResult GetAlternates(
        [FromQuery] double windSpeed = 20,
        [FromQuery] double windDirection = 180,
        [FromQuery] double cruiseSpeedKnots = 70)
    {
        var weather = new WeatherCondition(WindDirectionDegrees: windDirection, WindSpeedKnots: windSpeed);
        var alternates = _advisoryEngine.GetAlternateAerodromes(weather, cruiseSpeedKnots);
        return Ok(alternates);
    }

    [HttpGet("romatsa/vfr")]
    public IActionResult GetRomatsaVfrDatabase()
    {
        var path = Path.Combine(_env.ContentRootPath, "data", "romatsa-vfr-mock-db.json");
        if (!System.IO.File.Exists(path))
            return NotFound(new { error = "Baza de date ROMATSA VFR nu a fost găsită." });
        var json = System.IO.File.ReadAllText(path);
        return Content(json, "application/json");
    }

    [HttpGet("romatsa/ifr")]
    public IActionResult GetRomatsaIfrDatabase()
    {
        var path = Path.Combine(_env.ContentRootPath, "data", "romatsa-ifr-mock-db.json");
        if (!System.IO.File.Exists(path))
            return NotFound(new { error = "Baza de date ROMATSA IFR nu a fost găsită." });
        var json = System.IO.File.ReadAllText(path);
        return Content(json, "application/json");
    }

    [HttpGet("romatsa/summary")]
    public IActionResult GetRomatsaSummary()
    {
        var vfrPath = Path.Combine(_env.ContentRootPath, "data", "romatsa-vfr-mock-db.json");
        var ifrPath = Path.Combine(_env.ContentRootPath, "data", "romatsa-ifr-mock-db.json");

        using var vfrDoc = System.IO.File.Exists(vfrPath) ? JsonDocument.Parse(System.IO.File.ReadAllText(vfrPath)) : null;
        using var ifrDoc = System.IO.File.Exists(ifrPath) ? JsonDocument.Parse(System.IO.File.ReadAllText(ifrPath)) : null;

        int vfrAircraftTypes = vfrDoc?.RootElement.TryGetProperty("aircraftDatabase", out var vfrAc) == true ? vfrAc.GetArrayLength() : 0;
        int vfrLiveFlights = vfrDoc?.RootElement.TryGetProperty("mockLiveVfrFlights", out var vfrFl) == true ? vfrFl.GetArrayLength() : 0;
        int ifrAircraftTypes = ifrDoc?.RootElement.TryGetProperty("ifrAircraftPerformanceDatabase", out var ifrAc) == true ? ifrAc.GetArrayLength() : 0;
        int ifrLiveFlights = ifrDoc?.RootElement.TryGetProperty("mockLiveIfrFlights", out var ifrFl) == true ? ifrFl.GetArrayLength() : 0;

        return Ok(new
        {
            provider = "ROMATSA R.A. (FIR București LRBB — Craiova LRCV)",
            airacCycle = "2026-10",
            databases = new
            {
                vfr = new { file = "romatsa-vfr-mock-db.json", available = vfrDoc != null, aircraftProfilesCount = vfrAircraftTypes, mockFlightsCount = vfrLiveFlights },
                ifr = new { file = "romatsa-ifr-mock-db.json", available = ifrDoc != null, aircraftProfilesCount = ifrAircraftTypes, mockFlightsCount = ifrLiveFlights }
            }
        });
    }

    [HttpGet("live-traffic")]
    public async Task<IActionResult> GetLiveTraffic(
        [FromQuery] bool forceSimulated = false,
        [FromQuery] string? preset = null)
    {
        if (forceSimulated && string.Equals(preset, "eurasia", StringComparison.OrdinalIgnoreCase))
        {
            var eurasia = OpenSkyService.GetEurasiaLongHaulTraffic();
            return Ok(new
            {
                source = "Scenariu intercontinental Eurasia (ZBAA Beijing · EGGW Londra · LIME Milano · LROP București + VFR)",
                count = eurasia.Count,
                traffic = eurasia
            });
        }

        var (traffic, source) = await _openSkyService.GetCraiovaTrafficAsync(forceSimulated);
        return Ok(new { source, count = traffic.Count, traffic });
    }

    [HttpGet("live-positions")]
    [ProducesResponseType(typeof(object), 200)]
    public async Task<IActionResult> GetLivePositions()
    {
        var result = await _openSkyLiveService.GetLivePositionsAsync();
        return Ok(result);
    }

    [HttpGet("vfr/reporting-points")]
    public IActionResult GetVfrReportingPoints() => Ok(new { source = _openAipService.DataSource, points = _vfrGeofenceService.ReportingPoints, airspaces = _openAipService.Airspaces });

    [HttpGet("vfr/tracks")]
    public IActionResult GetVfrTracks() => Ok(new { tracks = _vfrGeofenceService.Tracks, sources = new { openSky = "OpenSky REST (15s cached + ADSB.lol fallback)", ogn = "OGN APRS-IS TCP (configurable)", sbs1 = "Local SBS-1 (configurable)" } });

    [HttpPost("vfr/tracks/{trackId}/correlate")]
    public IActionResult CorrelateVfrTrack(string trackId, [FromBody] VfrCorrelationRequest request) =>
        _vfrGeofenceService.TryCorrelate(trackId, request.FlightPlanId, request.Callsign) ? NoContent() : NotFound();

    [HttpGet("vfr/flight-plans")]
    public IActionResult GetVfrFlightPlans() => Ok(_vfrGeofenceService.FlightPlans);

    [HttpPost("vfr/flight-plans")]
    public IActionResult RegisterVfrFlightPlan([FromBody] VfrFlightPlan flightPlan)
    {
        _vfrGeofenceService.RegisterFlightPlan(flightPlan);
        return Accepted(new { flightPlan.FlightPlanId, flightPlan.Callsign });
    }

    [HttpPost("vfr/reporting-points/refresh")]
    public async Task<IActionResult> RefreshOpenAip(CancellationToken cancellationToken)
    {
        await _openAipService.RefreshAsync(cancellationToken);
        return Ok(new { source = _openAipService.DataSource, points = _vfrGeofenceService.ReportingPoints.Count, airspaces = _openAipService.Airspaces.Count });
    }

    [HttpGet("vfr/status")]
    [ProducesResponseType(typeof(VmcStatusResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> GetVfrStatus()
    {
        var weather = await _weatherService.GetAirportWeatherAsync("LRCV", 44.318056, 23.888611);
        return Ok(VmcChecker.ToResponse(weather));
    }

    [HttpGet("vfr/status/detail")]
    public async Task<IActionResult> GetVfrStatusDetail()
    {
        var weather = await _weatherService.GetAirportWeatherAsync("LRCV", 44.318056, 23.888611);
        return Ok(new { vmc = VmcChecker.ToStatus(weather), runwayWindComponents = VmcChecker.GetRunwayComponents(weather), rawMetar = weather.RawMetar, sourceProvider = weather.SourceProvider, isStale = weather.IsStale });
    }

    [HttpGet("vfr/tracking")]
    public async Task<IActionResult> GetVfrTracking([FromQuery] string runway = "08")
    {
        var weather = await _weatherService.GetAirportWeatherAsync("LRCV", 44.318056, 23.888611);
        var positions = await _openSkyLiveService.GetLivePositionsAsync();
        var states = _vfrGeofenceService.Evaluate(positions, weather, RunwayConfiguration.Normalize(runway));
        var trackingFlights = states.ToDictionary(s => s.FlightId, StringComparer.OrdinalIgnoreCase);
        var enrichedFlights = positions.Flights.Select(f => trackingFlights.TryGetValue(f.Icao24, out var state)
            ? f with { VfrEtaMinutes = state.EtaViaPointMinutes, VfrEntryPointCode = state.PointCode }
            : f);
        return Ok(new { queryTimeUtc = DateTime.UtcNow, source = positions.Source, totalCount = positions.TotalCount, airborneCount = positions.AirborneCount, boundingBoxLamin = positions.BoundingBoxLamin, boundingBoxLamax = positions.BoundingBoxLamax, boundingBoxLomin = positions.BoundingBoxLomin, boundingBoxLomax = positions.BoundingBoxLomax, flights = enrichedFlights, vmc = VmcChecker.ToResponse(weather), points = _vfrGeofenceService.ReportingPoints, vfrFlights = states });
    }

    /// <summary>
    /// Răspunde direct și conversațional în limba română la întrebările controlorului folosind modelul local 4B
    /// (Qwen3-4B-Instruct-2507 pe llama.cpp local) + verificare anti-halucinație C# pe cifrele din motorul AERIS.
    /// </summary>
    [HttpPost("explain")]
    [ProducesResponseType(typeof(Explanation), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status503ServiceUnavailable)]
    public async Task<IActionResult> Explain([FromBody] CraiovaExplainRequest request, CancellationToken cancellationToken)
    {
        WeatherCondition weather;
        List<CraiovaAircraft> traffic;
        string source;
        Aeris.PlanningEngine.Models.MetarDecoded? metar = null;

        if (request.Weather is not null)
        {
            weather = request.Weather;
            traffic = request.Aircrafts is { Count: > 0 } ? request.Aircrafts : OpenSkyService.GetRealisticCraiovaTraffic();
            source = "Simulare Matematică Demo LRCV";
        }
        else
        {
            metar = await _metarService.GetDecodedMetarAsync();
            if (metar is null)
                return StatusCode(StatusCodes.Status503ServiceUnavailable,
                    new { error = "METAR LRCV indisponibil; explicația nu poate fi generată fără context meteo curent." });

            weather = new WeatherCondition(
                WindDirectionDegrees: metar.WindDirectionDegrees ?? 0,
                WindSpeedKnots: metar.WindSpeedKnots,
                WindGustKnots: metar.WindGustKnots ?? metar.WindSpeedKnots,
                VisibilityMeters: metar.VisibilityMeters);

            var livePositions = await _openSkyLiveService.GetLivePositionsAsync();
            source = livePositions.Source;
            traffic = MapLivePositionsToAircraft(livePositions.Flights);
        }

        var simulation = _advisoryEngine.EvaluateSimulation(traffic, weather, source);
        var revision = checked((int)DateTimeOffset.UtcNow.ToUnixTimeSeconds());
        var statements = BuildApprovedStatements(simulation, traffic, metar, revision);
        var report = await _groundedExplainer.ExplainAsync(
            new ExplanationRequest(request.Question, revision, statements), cancellationToken);
        return Ok(report);
    }

    private static List<CraiovaAircraft> MapLivePositionsToAircraft(IReadOnlyList<LiveFlightState> liveFlights)
    {
        var airborne = liveFlights.Where(f => !f.OnGround).Take(12).ToList();
        var mapped = new List<CraiovaAircraft>(airborne.Count);
        int idx = 0;

        foreach (var f in airborne)
        {
            bool isVfr = f.FlightRules == FlightRules.VFR;
            double gsKt = Math.Max(60.0, f.VelocityKnots ?? (isVfr ? 85.0 : 180.0));
            double distNm = (f.DistanceFromLrcvKm ?? 25.0) / 1.852;
            double etaSec = f.VfrEtaMinutes.HasValue
                ? Math.Max(0, Math.Round(f.VfrEtaMinutes.Value * 60.0))
                : Math.Max(60.0 * idx, Math.Round((distNm / gsKt) * 3600.0));

            mapped.Add(new CraiovaAircraft(
                Id: f.Icao24.ToUpperInvariant(),
                Callsign: f.Callsign,
                ModelName: isVfr ? "Aeronavă VFR Live" : "Aeronavă IFR Live",
                Category: isVfr ? AircraftCategory.GeneralAviation : AircraftCategory.CommercialJet,
                FlightRules: isVfr ? FlightRules.VFR : FlightRules.IFR,
                HasInstrumentAvionics: !isVfr,
                MaxCrosswindKnots: isVfr ? 14 : 33,
                EtaSeconds: etaSec,
                EarliestSeconds: Math.Max(0, etaSec - 120),
                LatestSeconds: etaSec + 600,
                SpeedKnots: gsKt,
                RemainingFuelMinutes: isVfr ? 75 : 110
            ));
            idx++;
        }

        return mapped;
    }

    private static ApprovedStatement[] BuildApprovedStatements(
        CraiovaSimulationResult simulation,
        IReadOnlyList<CraiovaAircraft> traffic,
        Aeris.PlanningEngine.Models.MetarDecoded? metar,
        int revision)
    {
        var source = $"MATH-SIM-{revision}";
        var acById = traffic.ToDictionary(a => a.Id, StringComparer.OrdinalIgnoreCase);

        bool isForecastFallback = metar is not null && metar.SourceProvider.Contains("Open-Meteo", StringComparison.OrdinalIgnoreCase);
        var weatherSource = metar is not null
            ? (isForecastFallback || string.IsNullOrWhiteSpace(metar.RawMetar) ? $"{metar.SourceProvider}-{revision}" : metar.RawMetar)
            : $"SIM-WX-{simulation.Weather.WindDirectionDegrees:000}/{simulation.Weather.WindSpeedKnots:00}G{simulation.Weather.WindGustKnots:00}KT";

        string staleNotice = metar?.IsStale == true ? " [ATENȚIE: date meteo expirate/stale — VMC neverificat]" : "";
        string weatherText = metar is not null
            ? (isForecastFallback
                ? $"Model meteo prognozat ({metar.SourceProvider}, NU este METAR oficial){staleNotice}: {metar.ControllerSummary} Categorie: {metar.FlightCategory}."
                : $"METAR LRCV ({metar.SourceProvider}){staleNotice}: {metar.ControllerSummary} Categorie: {metar.FlightCategory}.")
            : string.Create(CultureInfo.InvariantCulture,
                $"Condiții meteo LRCV: vânt din {simulation.Weather.WindDirectionDegrees:000}° cu {simulation.Weather.WindSpeedKnots:0.#} kt (rafale {simulation.Weather.WindGustKnots:0.#} kt), vizibilitate {simulation.Weather.VisibilityMeters} m. Pe pista activă RWY {simulation.ActiveRunway}: vânt lateral {simulation.ActiveRunwayCrosswindKnots:0.#} kt, vânt frontal {simulation.ActiveRunwayHeadwindKnots:+0.#;-0.#;0} kt.");

        var statements = new List<ApprovedStatement>
        {
            new("decision", string.Create(CultureInfo.InvariantCulture,
                $"Situație generală LRCV ({simulation.DataSource}): pista activă RWY {simulation.ActiveRunway} (vânt lateral {simulation.ActiveRunwayCrosswindKnots:0.#} kt, vânt frontal {simulation.ActiveRunwayHeadwindKnots:+0.#;-0.#;0} kt); din {simulation.Stats.TotalInbounds} aeronave în sector, {simulation.Stats.ClearedToLandCount} sunt aprobate pentru apropiere, {simulation.Stats.HoldingInOrbitCount} în așteptare (holding) și {simulation.Stats.DivertAdvisedCount} redirecționate la aerodromuri alternative."), source),
            new("weather", Clip(weatherText, 800), weatherSource)
        };

        // Ordinea cronologică la aterizare + starea celorlalte aeronave
        var sequenced = simulation.Advisories
            .Where(a => a.AssignedLandingSlot != null)
            .OrderBy(a => a.AssignedLandingSlot!.CalculatedTimeSeconds)
            .Select((a, i) =>
            {
                var slot = a.AssignedLandingSlot!;
                return string.Create(CultureInfo.InvariantCulture,
                    $"#{i + 1} {a.Callsign} ({a.FlightRules}) la {slot.FormattedTime} pe RWY {a.AssignedRunway} (întârziere {slot.DelayMinutes:0.#} min)");
            })
            .ToList();
        var nonSequenced = simulation.Advisories
            .Where(a => a.AssignedLandingSlot == null)
            .Select(a => $"{a.Callsign}: {a.AdvisoryStatus}")
            .ToList();

        string seqSummary = sequenced.Count > 0
            ? $"Ordinea programată la aterizare pe LRCV: {string.Join("; ", sequenced)}." +
              (nonSequenced.Count > 0 ? $" Aeronave fără slot pe LRCV: {string.Join(", ", nonSequenced)}." : "")
            : (simulation.Advisories.Count == 0
                ? "Nu există nicio aeronavă în zbor în zona monitorizată acum."
                : $"Nicio aeronavă nu are slot de aterizare activ: {string.Join(", ", nonSequenced)}.");
        statements.Add(new ApprovedStatement("landing_sequence", Clip(seqSummary, 800), $"SEQ-{revision}"));

        if (simulation.FuturePrediction is { } fp)
        {
            statements.Add(new ApprovedStatement(
                "future_prediction",
                Clip($"Prognoză Meteo pe 45 de minute (T+0..T+45m, altitudine densitate {fp.DensityAltitudeFeet} ft, vânt 2000ft {fp.WindAt2000FtDegrees}°/{fp.WindAt2000FtKnots} kt, 5000ft {fp.WindAt5000FtDegrees}°/{fp.WindAt5000FtKnots} kt): {fp.TrendSummary} Fereastra optimă VFR pe LRCV: {fp.OptimalVfrLandingWindow}.", 800),
                $"FORECAST-{revision}"));
        }

        var stepTexts = simulation.Advisories
            .Where(a => a.TwoStepsAhead != null)
            .Select(a => $"{a.Callsign}: {a.TwoStepsAhead!.PredictiveSummary}")
            .ToList();
        if (stepTexts.Count > 0)
        {
            statements.Add(new ApprovedStatement(
                "two_steps_ahead",
                Clip($"Analiză Anticipativă (2 Pași Înaintea Avionului): {string.Join(" | ", stepTexts)}", 800),
                $"PRED-2STEPS-{revision}"));
        }

        var ttlTexts = simulation.Advisories
            .Where(a => a.TakeoffToLanding != null)
            .Select(a =>
            {
                var t = a.TakeoffToLanding!;
                return string.Create(CultureInfo.InvariantCulture,
                    $"{a.Callsign} ({t.DepartureAerodromeName} {t.DepartureAerodromeIcao}->LRCV, {t.TotalRouteDistanceNm:0} NM, croazieră {t.CruiseAltitudeFeet} ft): TOD la {t.TopOfDescentDistanceNm:0.0} NM, glisadă 3° ROD -{t.RequiredRateOfDescentFpm:0} fpm, crab {t.WindCorrectionAngleCrabDegrees:+0.0;-0.0;0}°, LDR {t.LandingDistanceRequiredMeters:0}m/{t.LandingDistanceAvailableMeters:0}m ({t.RunwayUsedPercent:0.0}%), ROT {t.PredictedRunwayOccupancySeconds:0}s");
            })
            .ToList();
        if (ttlTexts.Count > 0)
        {
            statements.Add(new ApprovedStatement(
                "takeoff_to_landing",
                Clip($"Calcul Cinematic De-la-Decolare-la-Aterizare (Takeoff-to-Landing): {string.Join("; ", ttlTexts)}.", 800),
                $"KINEMATICS-TTL-{revision}"));
        }

        var vfrRedirTexts = simulation.Advisories
            .Where(a => a.VfrRedirection != null)
            .Select(a =>
            {
                var vr = a.VfrRedirection!;
                acById.TryGetValue(a.AircraftId, out var rawAc);
                string fuelStr = rawAc is not null && rawAc.RemainingFuelMinutes > 0 ? $"combustibil rămas {rawAc.RemainingFuelMinutes:0} min, " : "";
                return string.Create(CultureInfo.InvariantCulture,
                    $"{a.Callsign} ({a.ModelName}, lateral {a.CurrentCrosswindKnots:0.#}/{a.MaxCrosswindLimitKnots:0.#} kt): {fuelStr}recomandare={(vr.RecommendedDecision == "LAND_LRCV_PRIMARY" ? $"aterizare directă LRCV RWY {a.AssignedRunway}" : vr.RecommendedDecision == "LAND_LRCV_RECIPROCAL" ? $"aterizare sens opus LRCV RWY {a.AssignedRunway}" : vr.RecommendedDecision == "ORBIT_THEN_LAND_LRCV" ? $"așteptare rând în orbită ({vr.EstimatedWaitTimeAtLrcvMinutes:0} min) apoi aterizare LRCV RWY {a.AssignedRunway}" : $"redirecționare către {vr.BestAlternateName} RWY {vr.BestAlternateRunway}")}, PNR={vr.PointOfNoReturnMinutes:0.0} min, alternativă {vr.BestAlternateName} ({vr.BestAlternateCode}) RWY {vr.BestAlternateRunway} scor {vr.BestAlternateScore:0.0}/100, cap {vr.RedirectionHeadingToFlyDegrees:000}°, ETE {vr.RedirectionEtaMinutes:0.0} min, rezervă la sosire {vr.FuelRemainingAtAlternateMinutes:0.0} min");
            })
            .ToList();
        if (vfrRedirTexts.Count > 0)
        {
            statements.Add(new ApprovedStatement(
                "vfr_redirection",
                Clip($"Calcul Decizional VFR (Combustibil, PNR & Redirecționare Piste Apropiate): {string.Join(" | ", vfrRedirTexts)}.", 800),
                $"VFR-DIVERT-CALC-{revision}"));
        }

        if (simulation.SafetyAssessment is { } sa)
        {
            statements.Add(new ApprovedStatement(
                "trajectory_separation",
                Clip($"Verificare Separare Traiectorii & Siaj: Status {sa.Status} ({sa.Summary}). Perechi evaluate: {sa.TotalEvaluatedPairs}, puncte de traiectorie: {sa.TotalTrajectoryPoints}, conflicte active: {sa.Conflicts.Count}.", 800),
                $"SEP-{revision}"));
        }

        foreach (var advisory in simulation.Advisories.Take(20))
        {
            var id = "flight_" + new string(advisory.AircraftId.Where(char.IsLetterOrDigit).Take(48).ToArray());
            if (id == "flight_") id += statements.Count;

            acById.TryGetValue(advisory.AircraftId, out var rawAc);
            string etaClock = rawAc is not null ? FormatSimClock(rawAc.EtaSeconds) : "—";
            string slotInfo = advisory.AssignedLandingSlot is { } slot
                ? string.Create(CultureInfo.InvariantCulture, $"slot aterizare {slot.FormattedTime} (întârziere {slot.DelayMinutes:0.#} min)")
                : $"fără slot pe LRCV (ETA inițial {etaClock})";
            string fuelAndSpeed = rawAc is not null
                ? string.Create(CultureInfo.InvariantCulture,
                    $", viteză {rawAc.SpeedKnots:0} kt, combustibil rămas {rawAc.RemainingFuelMinutes:0} min, ETA {etaClock}, {slotInfo}")
                : $", {slotInfo}";

            string extraMath = "";
            if (advisory.TakeoffToLanding is { } t)
            {
                extraMath += string.Create(CultureInfo.InvariantCulture,
                    $" Origine: {t.DepartureAerodromeName} ({t.DepartureAerodromeIcao}) -> LRCV ({t.TotalRouteDistanceNm:0} NM, croazieră {t.CruiseAltitudeFeet} ft, TOD la {t.TopOfDescentDistanceNm:0.0} NM, cap {t.HeadingToFlyDegrees:000}°, crab {t.WindCorrectionAngleCrabDegrees:+0.0;-0.0;0}°, LDR {t.LandingDistanceRequiredMeters:0}m, ROT {t.PredictedRunwayOccupancySeconds:0}s).");
            }
            if (advisory.VfrRedirection is { } vr)
            {
                extraMath += string.Create(CultureInfo.InvariantCulture,
                    $" Calcul VFR: PNR {vr.PointOfNoReturnMinutes:0.0} min; alternativă optimă {vr.BestAlternateName} ({vr.BestAlternateCode}) RWY {vr.BestAlternateRunway}, scor {vr.BestAlternateScore:0.0}/100, cap {vr.RedirectionHeadingToFlyDegrees:000}°, ETE {vr.RedirectionEtaMinutes:0.0} min, combustibil la alternativă {vr.FuelRemainingAtAlternateMinutes:0.0} min.");
            }

            statements.Add(new ApprovedStatement(
                id,
                Clip(string.Create(CultureInfo.InvariantCulture,
                    $"{advisory.Callsign} (ID {advisory.AircraftId}, {advisory.ModelName}, reguli {advisory.FlightRules}): stare {advisory.AdvisoryStatus}, pista {advisory.AssignedRunway}, vânt lateral {advisory.CurrentCrosswindKnots:0.#} kt din limita max {advisory.MaxCrosswindLimitKnots:0.#} kt{fuelAndSpeed}.{extraMath} Motiv: {advisory.AdvisoryReason}"), 800),
                source));
        }

        statements.Add(new("limits", "Rezultat de simulare matematică și suport decizional AERIS; nu reprezintă o autorizare ATC directă.", $"RULES-{revision}"));

        return statements.ToArray();
    }

    private static string FormatSimClock(double simSeconds)
    {
        var total = TimeSpan.FromSeconds(Math.Max(0, BaseTimeOffsetSeconds + simSeconds));
        return string.Create(CultureInfo.InvariantCulture, $"{(int)total.TotalHours % 24:00}:{total.Minutes:00}");
    }

    private static string Clip(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..(maxLength - 1)] + "…";
}

public sealed record CraiovaExplainRequest(
    [param: System.ComponentModel.DataAnnotations.Required]
    [param: System.ComponentModel.DataAnnotations.StringLength(1200, MinimumLength = 1)]
    string Question,
    WeatherCondition? Weather = null,
    List<CraiovaAircraft>? Aircrafts = null);

public record CraiovaCustomEvaluationDto(
    WeatherCondition? Weather,
    List<CraiovaAircraft>? Aircrafts,
    bool UseTrajectoryEngine = true
);

public sealed record VfrCorrelationRequest(string FlightPlanId, string Callsign);
