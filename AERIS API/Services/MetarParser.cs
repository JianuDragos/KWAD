using System.Globalization;
using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>
/// Parser static, pur (fără side effects), care traduce un <see cref="MetarRaw"/>
/// în <see cref="MetarDecoded"/> cu descrieri human-readable în română și
/// un prompt structurat gata pentru injecție în LLM.
/// </summary>
public static class MetarParser
{
    // Coordonate LRCV pentru calculul vectorilor vânt pe pistă
    private const double LrcvRunwayHeadingDeg = RunwayConfiguration.Runway08TrueBearingDeg; // Pista 08 → true bearing 88.93° conform AIP AIRAC

    /// <summary>
    /// Decodează un <see cref="MetarRaw"/> în <see cref="MetarDecoded"/>.
    /// Returnează null dacă rawul nu conține date minime valide.
    /// </summary>
    public static MetarDecoded? Decode(MetarRaw raw)
    {
        if (raw.RawObservation is null) return null;

        // ── Timp observație ───────────────────────────────────────────────────
        DateTime obsUtc = ParseObsTime(raw.ObsTime);
        // România: UTC+2 EET (iarnă) / UTC+3 EEST (vară)
        // Folosim TimeZoneInfo pentru conversie corectă DST
        TimeZoneInfo romaniaZone;
        try { romaniaZone = TimeZoneInfo.FindSystemTimeZoneById("E. Europe Standard Time"); }
        catch { romaniaZone = TimeZoneInfo.FindSystemTimeZoneById("Europe/Bucharest"); }
        DateTime obsLocal = TimeZoneInfo.ConvertTimeFromUtc(obsUtc, romaniaZone);
        string obsLocalStr = obsLocal.ToString("HH:mm 'ora locală' (dd MMM yyyy)", new CultureInfo("ro-RO"));

        // ── Vânt ──────────────────────────────────────────────────────────────
        bool isVariable = raw.Wdir is null || raw.Wdir == 0 && raw.Wspd == 0;
        int? windDir = raw.Wdir.HasValue ? (int)Math.Round(raw.Wdir.Value) : null;
        int windSpd = raw.Wspd.HasValue ? (int)Math.Round(raw.Wspd.Value) : 0;
        int? windGust = raw.Wgst.HasValue ? (int)Math.Round(raw.Wgst.Value) : null;
        string windDesc = BuildWindDescription(windDir, windSpd, windGust, isVariable);

        // ── Vizibilitate ──────────────────────────────────────────────────────
        // aviationweather.gov returnează vizibilitatea în statute miles
        int visMeters = raw.Visib.HasValue
            ? (int)Math.Min(raw.Visib.Value * 1609.34, 9999)
            : 9999;
        string visDesc = visMeters >= 9999
            ? "9999 m sau mai mult (vizibilitate excelentă)"
            : $"{visMeters} m ({visMeters / 1000.0:0.#} km)";

        // ── Nori ──────────────────────────────────────────────────────────────
        var cloudLayers = DecodeCloudLayers(raw.Clouds);
        string skyDesc = BuildSkyDescription(cloudLayers);

        // ── Temperatură & Rouă ────────────────────────────────────────────────
        double temp = raw.Temp ?? 0;
        double dewp = raw.Dewp ?? temp;
        int humidity = CalculateHumidity(temp, dewp);
        string tempDpDesc = BuildTempDewPointDescription(temp, dewp, humidity);

        // ── Presiune ──────────────────────────────────────────────────────────
        int qnh = ParseQnh(raw);
        string pressDesc = $"QNH {qnh} hPa";

        // ── Fenomene meteo ────────────────────────────────────────────────────
        string? phenomena = DecodeWeatherPhenomena(raw.WxString);
        bool hasSignificant = phenomena != null;

        // ── Categoria de zbor ─────────────────────────────────────────────────
        string flightCat = DetermineFlightCategory(raw.FlightCategory, visMeters, cloudLayers);
        string flightCatDesc = BuildFlightCategoryDescription(flightCat);

        // ── Rezumat controller ────────────────────────────────────────────────
        string summary = BuildControllerSummary(windDir, windSpd, windGust, isVariable,
            visMeters, cloudLayers, temp, dewp, qnh, phenomena, flightCat);

        string aiPrompt = BuildAiPrompt(raw.RawObservation, obsUtc, obsLocalStr,
            windDir, windSpd, windGust, isVariable, visMeters, cloudLayers,
            temp, dewp, humidity, qnh, phenomena, flightCat, summary);

        return new MetarDecoded(
            Station: raw.IcaoId ?? "LRCV",
            RawMetar: raw.RawObservation,
            ObservationTimeUtc: obsUtc,
            ObservationTimeLocal: obsLocalStr,
            WindDirectionDegrees: windDir,
            WindSpeedKnots: windSpd,
            WindGustKnots: windGust,
            WindDescription: windDesc,
            IsWindVariable: isVariable,
            VisibilityMeters: visMeters,
            VisibilityDescription: visDesc,
            CloudLayers: cloudLayers,
            SkyConditionDescription: skyDesc,
            TemperatureCelsius: temp,
            DewPointCelsius: dewp,
            HumidityPercent: humidity,
            TemperatureDewPointDescription: tempDpDesc,
            QnhHpa: qnh,
            PressureDescription: pressDesc,
            WeatherPhenomena: phenomena,
            HasSignificantWeather: hasSignificant,
            FlightCategory: flightCat,
            FlightCategoryDescription: flightCatDesc,
            ControllerSummary: summary,
            AiContextPrompt: aiPrompt
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Timp
    // ─────────────────────────────────────────────────────────────────────────

    private static DateTime ParseObsTime(string? obsTime)
    {
        if (obsTime is null) return DateTime.UtcNow;
        if (DateTime.TryParse(obsTime, null, System.Globalization.DateTimeStyles.RoundtripKind, out var dt))
            return dt.ToUniversalTime();
        return DateTime.UtcNow;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Vânt
    // ─────────────────────────────────────────────────────────────────────────

    private static string BuildWindDescription(int? dir, int spd, int? gust, bool isVariable)
    {
        string dirName = dir.HasValue ? $"{CardinalDirection(dir.Value)} ({dir.Value}°)" : "variabil";
        string gustStr = gust.HasValue ? $", rafale {gust.Value} kts" : "";
        return isVariable
            ? $"Vânt variabil {spd} kts{gustStr}"
            : $"{dirName} – {spd} kts{gustStr}";
    }

    private static string CardinalDirection(int degrees)
    {
        string[] dirs = { "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                          "S", "SSV", "SV", "VSV", "V", "VNV", "NV", "NNV" };
        int idx = (int)((degrees + 11.25) / 22.5) % 16;
        return dirs[idx];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Nori
    // ─────────────────────────────────────────────────────────────────────────

    private static List<CloudLayerDecoded> DecodeCloudLayers(List<CloudLayerRaw>? layers)
    {
        if (layers == null || layers.Count == 0)
            return new List<CloudLayerDecoded>();

        return layers
            .Where(l => l.Cover is not null && l.Cover != "CLR" && l.Cover != "CAVOK" && l.Cover != "NCD" && l.Cover != "NSC")
            .Select(l =>
            {
                // Base în MetarRaw este în SUTE de ft (ex: 3 = 300 ft, 6 = 600 ft, 8 = 800 ft)
                int baseHundreds = l.Base ?? 0;
                int baseFt = baseHundreds * 100;
                int baseM = FeetToRoundedMeters(baseFt);
                bool isCeiling = l.Cover == "BKN" || l.Cover == "OVC" || l.Cover == "OVX";
                string coverName = l.Cover switch
                {
                    "FEW" => "Câțiva nori",
                    "SCT" => "Nori împrăștiați",
                    "BKN" => "Cer mai mult acoperit (plafon)",
                    "OVC" => "Cer acoperit complet (plafon)",
                    "OVX" => "Cer acoperit – vizibilitate obscurată",
                    _ => l.Cover!
                };
                return new CloudLayerDecoded(
                    Code: l.Cover!,
                    CoverName: coverName,
                    BaseHundredsFeet: baseHundreds,
                    BaseFeet: baseFt,
                    BaseMeters: baseM,
                    IsCeiling: isCeiling
                );
            })
            .ToList();
    }

    /// <summary>Picioare → metri rotunjiți la 10 m, pentru textele afișate (METAR raportează plafonul în sute de ft).</summary>
    private static int FeetToRoundedMeters(int feet) => (int)Math.Round(feet * 0.3048 / 10.0) * 10;

    private static string BuildSkyDescription(List<CloudLayerDecoded> layers)
    {
        if (layers.Count == 0) return "Cer senin";
        var parts = layers.Select(l => $"{l.CoverName} la {l.BaseMeters} m");
        return string.Join("; ", parts);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Temperatură & umiditate
    // ─────────────────────────────────────────────────────────────────────────

    private static int CalculateHumidity(double temp, double dewp)
    {
        // Formula Magnus aproximativă
        double a = 17.625, b = 243.04;
        double gammaT = a * temp / (b + temp);
        double gammaDp = a * dewp / (b + dewp);
        double rh = 100.0 * Math.Exp(gammaDp - gammaT);
        return (int)Math.Clamp(Math.Round(rh), 0, 100);
    }

    private static string BuildTempDewPointDescription(double temp, double dewp, int humidity)
    {
        double spread = temp - dewp;
        string fogWarning = spread <= 2 ? " – ATENȚIE: spread mic, ceață probabilă!" : "";
        return $"{temp:0.#}°C / punct de rouă {dewp:0.#}°C – umiditate {humidity}%{fogWarning}";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: QNH
    // ─────────────────────────────────────────────────────────────────────────

    private static int ParseQnh(MetarRaw raw)
    {
        // aviationweather.gov returnează altim direct în hPa pentru aeroporturi europene
        // (ex: 1020 pentru Q1020). Valori rezonabile QNH: 950–1050 hPa.
        if (raw.Altim.HasValue && raw.Altim.Value >= 900 && raw.Altim.Value <= 1100)
            return (int)Math.Round(raw.Altim.Value); // deja în hPa

        // Fallback: dacă e inHg (valori ~28–31), convertim
        if (raw.Altim.HasValue && raw.Altim.Value > 20 && raw.Altim.Value < 40)
            return (int)Math.Round(raw.Altim.Value * 33.8639);

        // Parsăm din string-ul "Q1020"
        if (raw.Altim_hpa is { Length: > 1 } q && q.StartsWith('Q'))
            if (int.TryParse(q[1..], out int hpa)) return hpa;

        return 1013; // standard atmosphere fallback
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Fenomene meteo
    // ─────────────────────────────────────────────────────────────────────────

    private static string? DecodeWeatherPhenomena(string? wx)
    {
        if (string.IsNullOrWhiteSpace(wx)) return null;

        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { "RA",   "Ploaie" },
            { "-RA",  "Ploaie slabă" },
            { "+RA",  "Ploaie abundentă" },
            { "SN",   "Ninsoare" },
            { "-SN",  "Ninsoare slabă" },
            { "+SN",  "Ninsoare abundentă" },
            { "FG",   "Ceață (FG) – vizibilitate sub 1 km" },
            { "MIFG", "Ceață joasă (MIFG)" },
            { "BCFG", "Ceață în pete" },
            { "BR",   "Ceață ușoară (BR) – vizibilitate 1-8 km" },
            { "TS",   "Furtună (TS)" },
            { "TSRA", "Furtună cu ploaie (TSRA)" },
            { "DZ",   "Burnițăr (DZ)" },
            { "FZRA", "Ploaie înghețată (FZRA) – pericol givraj" },
            { "FZDZ", "Burnițăr înghețat (FZDZ) – pericol givraj" },
            { "GR",   "Grindină (GR)" },
            { "PL",   "Gheață granulată (PL)" },
            { "SQ",   "Rafale puternice (SQ)" },
            { "FC",   "Tornadă / trombă marină (FC)" },
            { "DS",   "Furtună de praf" },
            { "HZ",   "Ceață uscată (HZ)" },
            { "FU",   "Fum" },
            { "VA",   "Cenușă vulcanică (VA) – pericol motoare" },
        };

        // Caută cel mai lung match (ex: TSRA înainte de RA)
        foreach (var kv in map.OrderByDescending(k => k.Key.Length))
            if (wx.Contains(kv.Key, StringComparison.OrdinalIgnoreCase))
                return kv.Value;

        return $"Fenomen meteo: {wx}";
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Categoria de zbor
    // ─────────────────────────────────────────────────────────────────────────

    private static string DetermineFlightCategory(string? reported, int visMeters, List<CloudLayerDecoded> clouds)
    {
        // Preferăm valoarea raportată de aviationweather.gov dacă există
        if (!string.IsNullOrWhiteSpace(reported))
            return reported.ToUpperInvariant();

        // Calculăm manual din vizibilitate și plafon
        int ceilingFt = clouds.Where(c => c.IsCeiling).Select(c => c.BaseFeet).DefaultIfEmpty(9999).Min();
        double visSmiles = visMeters / 1609.34;

        if (visSmiles < 1 || ceilingFt < 500) return "LIFR";
        if (visSmiles < 3 || ceilingFt < 1000) return "IFR";
        if (visSmiles < 5 || ceilingFt < 3000) return "MVFR";
        return "VFR";
    }

    private static string BuildFlightCategoryDescription(string cat) => cat switch
    {
        "VFR"  => "VFR – Condiții vizuale, zbor VFR permis fără restricții",
        "MVFR" => "MVFR – Condiții marginale VFR: vizibilitate 3-5 km sau plafon 300-900 m",
        "IFR"  => "IFR – Condiții instrumentale: vizibilitate sub 3 km sau plafon sub 300 m",
        "LIFR" => "LIFR – Condiții IFR severe: vizibilitate sub 1 km sau plafon sub 150 m",
        _      => cat
    };

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Rezumat controller
    // ─────────────────────────────────────────────────────────────────────────

    private static string BuildControllerSummary(
        int? windDir, int windSpd, int? windGust, bool isVariable,
        int visMeters, List<CloudLayerDecoded> clouds,
        double temp, double dewp, int qnh,
        string? phenomena, string flightCat)
    {
        var sb = new System.Text.StringBuilder();

        sb.Append($"LRCV – Categoria: {flightCat}. ");

        if (isVariable)
            sb.Append($"Vânt variabil {windSpd} kts. ");
        else if (windDir.HasValue)
            sb.Append($"Vânt {windDir.Value}° / {windSpd} kts{(windGust.HasValue ? $" (rafale {windGust.Value} kts)" : "")}. ");

        // Vânt lateral față de pista 08/26
        if (!isVariable && windDir.HasValue && windSpd > 0)
        {
            double xw = Math.Abs(windSpd * Math.Sin((windDir.Value - LrcvRunwayHeadingDeg) * Math.PI / 180));
            sb.Append($"Vânt lateral pista 08: {xw:0.#} kts. ");
        }

        int ceilingFt = clouds.Where(c => c.IsCeiling).Select(c => c.BaseFeet).DefaultIfEmpty(0).Min();
        if (ceilingFt > 0)
            sb.Append($"Plafon {FeetToRoundedMeters(ceilingFt)} m. ");

        sb.Append($"Vizibilitate {visMeters} m. ");

        if (phenomena != null)
            sb.Append($"Fenomene: {phenomena}. ");

        sb.Append($"Temp {temp:0.#}°C, QNH {qnh} hPa.");

        return sb.ToString();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper: Prompt AI
    // ─────────────────────────────────────────────────────────────────────────

    private static string BuildAiPrompt(
        string rawMetar, DateTime obsUtc, string obsLocal,
        int? windDir, int windSpd, int? windGust, bool isVariable,
        int visMeters, List<CloudLayerDecoded> clouds,
        double temp, double dewp, int humidity, int qnh,
        string? phenomena, string flightCat, string summary)
    {
        int ceilingFt = clouds.Where(c => c.IsCeiling).Select(c => c.BaseFeet).DefaultIfEmpty(0).Min();
        double xw = (!isVariable && windDir.HasValue)
            ? Math.Abs(windSpd * Math.Sin((windDir.Value - LrcvRunwayHeadingDeg) * Math.PI / 180))
            : 0;

        return $"""
            [AERIS – Date meteo în timp real pentru LRCV Craiova]
            METAR: {rawMetar}
            Ora observație: {obsUtc:yyyy-MM-dd HH:mm}Z ({obsLocal})
            ---
            VÂNT: {(isVariable ? $"variabil {windSpd} kts" : $"{windDir}° / {windSpd} kts")}{(windGust.HasValue ? $", rafale {windGust} kts" : "")}
            Vânt lateral față de pista 08/26: {xw:0.#} kts
            VIZIBILITATE: {visMeters} m
            PLAFON: {(ceilingFt > 0 ? $"{FeetToRoundedMeters(ceilingFt)} m" : "Nelimitat")}
            NORI: {string.Join(", ", clouds.Select(c => $"{c.CoverName} la {c.BaseMeters} m"))}
            TEMPERATURĂ: {temp}°C | Punct de rouă: {dewp}°C | Umiditate: {humidity}%
            QNH: {qnh} hPa
            FENOMENE: {phenomena ?? "Fără"}
            CATEGORIE ZBOR: {flightCat}
            ---
            REZUMAT OPERAȚIONAL: {summary}
            """;
    }
}
