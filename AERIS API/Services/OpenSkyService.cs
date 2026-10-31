using System.Text.Json;
using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

public class OpenSkyService : IOpenSkyService
{
    private readonly HttpClient _httpClient;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    // Bounding box pentru regiunea Craiova / Oltenia (cca. 60-80 NM)
    private const double Lamin = 43.8;
    private const double Lamax = 44.8;
    private const double Lomin = 23.3;
    private const double Lomax = 24.5;

    public OpenSkyService(HttpClient httpClient)
    {
        _httpClient = httpClient;
        _httpClient.Timeout = TimeSpan.FromSeconds(4);
        if (!_httpClient.DefaultRequestHeaders.Contains("User-Agent"))
        {
            _httpClient.DefaultRequestHeaders.Add("User-Agent", "AERIS-Craiova-ATM/1.0");
        }
    }

    public async Task<(List<CraiovaAircraft> Aircrafts, string SourceDescription)> GetCraiovaTrafficAsync(bool forceSimulatedTraffic = false)
    {
        if (forceSimulatedTraffic)
        {
            return (GetRealisticCraiovaTraffic(), "Trafic simulat realist (OpenSky bypass / mod demonstrativ)");
        }

        try
        {
            string url = $"https://opensky-network.org/api/states/all?lamin={Lamin}&lomin={Lomin}&lamax={Lamax}&lomax={Lomax}";
            var response = await _httpClient.GetAsync(url);

            if (response.IsSuccessStatusCode)
            {
                var content = await response.Content.ReadAsStringAsync();
                var openSkyData = JsonSerializer.Deserialize<OpenSkyResponse>(content, JsonOptions);

                if (openSkyData?.States != null && openSkyData.States.Count > 0)
                {
                    var liveAircrafts = ParseOpenSkyStates(openSkyData.States);
                    // Blenduim traficul live din OpenSky cu zborurile locale de agrement/mici solicitate (Savannah, Wilga)
                    // pentru a asigura simularea completă a cazurilor meteo/orbită pe Craiova
                    var blendedTraffic = BlendWithLightTraffic(liveAircrafts);
                    return (blendedTraffic, $"Live OpenSky API ({liveAircrafts.Count} zboruri reale detectate în spațiul Craiova + aeronave mici)");
                }
            }
        }
        catch
        {
            // În caz de rate-limit (HTTP 429), timeout sau lipsă rețea la OpenSky, fallback-ul funcționează instantaneu
        }

        return (GetRealisticCraiovaTraffic(), "Trafic realist Craiova (OpenSky a returnat 0 zboruri active în sectorul LRCV sau rate-limit)");
    }

    private List<CraiovaAircraft> ParseOpenSkyStates(List<List<JsonElement>> states)
    {
        var result = new List<CraiovaAircraft>();
        int index = 1;

        foreach (var state in states)
        {
            if (state.Count < 10) continue;

            string icao24 = state[0].GetString() ?? $"AC{index}";
            string rawCallsign = state[1].GetString()?.Trim() ?? $"FLT{index}";
            string callsign = string.IsNullOrWhiteSpace(rawCallsign) ? $"TFC-{icao24.ToUpper()}" : rawCallsign;
            bool onGround = state[8].ValueKind == JsonValueKind.True;
            
            if (onGround) continue; // Excludem avioanele parcate la sol

            double velocity = (state[9].ValueKind == JsonValueKind.Number) ? state[9].GetDouble() * 1.94384 : 140; // m/s în noduri
            double eta = (index - 1) * 240.0;

            result.Add(new CraiovaAircraft(
                Id: icao24.ToUpper(),
                Callsign: callsign,
                ModelName: DetermineModelFromCallsign(callsign),
                Category: AircraftCategory.CommercialJet,
                FlightRules: FlightRules.IFR,
                HasInstrumentAvionics: true,
                MaxCrosswindKnots: 32,
                EtaSeconds: eta,
                EarliestSeconds: Math.Max(0, eta - 120),
                LatestSeconds: eta + 480,
                SpeedKnots: velocity,
                RemainingFuelMinutes: 120
            ));

            index++;
            if (index > 4) break;
        }

        return result;
    }

    private string DetermineModelFromCallsign(string callsign)
    {
        if (callsign.StartsWith("WZZ") || callsign.StartsWith("W6") || callsign.StartsWith("W4"))
            return "Airbus A320-232 (Wizz Air)";
        if (callsign.StartsWith("ROT") || callsign.StartsWith("RO"))
            return "Boeing 737-800 (TAROM)";
        if (callsign.StartsWith("RYR") || callsign.StartsWith("FR"))
            return "Boeing 737-8200 (Ryanair)";
        return "Aeronava Comercială IFR";
    }

    private List<CraiovaAircraft> BlendWithLightTraffic(List<CraiovaAircraft> commercialTraffic)
    {
        var list = new List<CraiovaAircraft>(commercialTraffic);
        list.AddRange(GetStandardLightAircraftTraffic(baseOffsetSeconds: 180));
        return list;
    }

    public static List<CraiovaAircraft> GetRealisticCraiovaTraffic()
    {
        var list = new List<CraiovaAircraft>
        {
            // 1. Zbor comercial mare - Wizz Air din Londra Luton (Prioritate maximă IFR)
            new(
                Id: "W4-3751",
                Callsign: "WZZ3751",
                ModelName: "Airbus A320-232",
                Category: AircraftCategory.CommercialJet,
                FlightRules: FlightRules.IFR,
                HasInstrumentAvionics: true,
                MaxCrosswindKnots: 33, // A320 suportă până la 33-35 kts
                EtaSeconds: 0,         // 14:00
                EarliestSeconds: 0,
                LatestSeconds: 240,
                SpeedKnots: 145,
                RemainingFuelMinutes: 110
            ),

            // 2. Zbor comercial - Wizz Air din Milano Bergamo
            new(
                Id: "W4-3762",
                Callsign: "WZZ3762",
                ModelName: "Airbus A321neo",
                Category: AircraftCategory.CommercialJet,
                FlightRules: FlightRules.IFR,
                HasInstrumentAvionics: true,
                MaxCrosswindKnots: 35,
                EtaSeconds: 360,       // 14:06
                EarliestSeconds: 300,
                LatestSeconds: 720,
                SpeedKnots: 150,
                RemainingFuelMinutes: 125
            )
        };

        // Adăugăm aeronavele mici de agrement locale (Savannah, Wilga, Cessna)
        list.AddRange(GetStandardLightAircraftTraffic(baseOffsetSeconds: 120));
        return list;
    }

    private static List<CraiovaAircraft> GetStandardLightAircraftTraffic(double baseOffsetSeconds)
    {
        return new List<CraiovaAircraft>
        {
            // 3. Aeronava mică de agrement ULM - ICP Savannah (fără instrumentație IFR, vânt lateral foarte sensibil)
            new(
                Id: "YR-SAV",
                Callsign: "YR-5123",
                ModelName: "ICP Savannah S (Ultralight STOL)",
                Category: AircraftCategory.UltralightAndGlider,
                FlightRules: FlightRules.VFR,
                HasInstrumentAvionics: false, // Fără avionice IFR, doar zbor vizual
                MaxCrosswindKnots: 11,        // Limită vânt lateral: 11 noduri!
                EtaSeconds: baseOffsetSeconds, // ex: 14:02
                EarliestSeconds: Math.Max(0, baseOffsetSeconds - 60),
                LatestSeconds: baseOffsetSeconds + 300,
                SpeedKnots: 65,
                RemainingFuelMinutes: 75
            ),

            // 4. Aeronava utilitară / agrement - PZL-104 Wilga
            new(
                Id: "YR-WILG",
                Callsign: "YR-WLG",
                ModelName: "PZL-104 Wilga 35A (STOL)",
                Category: AircraftCategory.UltralightAndGlider,
                FlightRules: FlightRules.VFR,
                HasInstrumentAvionics: false,
                MaxCrosswindKnots: 13,        // Limită vânt lateral: 13 noduri
                EtaSeconds: baseOffsetSeconds + 180, // ex: 14:05
                EarliestSeconds: baseOffsetSeconds + 120,
                LatestSeconds: baseOffsetSeconds + 480,
                SpeedKnots: 75,
                RemainingFuelMinutes: 80
            ),

            // 5. Aviație generală / Școală - Cessna 172 Skyhawk
            new(
                Id: "YR-C172",
                Callsign: "YR-CRA",
                ModelName: "Cessna 172N Skyhawk",
                Category: AircraftCategory.GeneralAviation,
                FlightRules: FlightRules.VFR,
                HasInstrumentAvionics: true,  // Are radio și instrumente de bază
                MaxCrosswindKnots: 15,        // Limită vânt lateral: 15 noduri
                EtaSeconds: baseOffsetSeconds + 360, // ex: 14:08
                EarliestSeconds: baseOffsetSeconds + 300,
                LatestSeconds: baseOffsetSeconds + 660,
                SpeedKnots: 95,
                RemainingFuelMinutes: 90
            )
        };
    }

    private class OpenSkyResponse
    {
        public int Time { get; set; }
        public List<List<JsonElement>>? States { get; set; }
    }
}
