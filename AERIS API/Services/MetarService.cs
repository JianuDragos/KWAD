using System.Text.Json;
using System.Text.Json.Serialization;
using Aeris.PlanningEngine.Models;

namespace Aeris.PlanningEngine.Services;

/// <summary>
/// Serviciu care obține date METAR pentru LRCV (Craiova International Airport)
/// de la aviationweather.gov JSON API și le decodează prin <see cref="MetarParser"/>.
/// </summary>
public class MetarService : IMetarService
{
    private readonly HttpClient _httpClient;
    private readonly ILogger<MetarService> _logger;

    // aviationweather.gov API – endpoint JSON pentru METAR
    // Docs: https://aviationweather.gov/api/doc/metar
    private const string MetarApiUrl =
        "https://aviationweather.gov/api/data/metar?ids=LRCV&format=json&taf=false&hours=2";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString
    };

    public MetarService(HttpClient httpClient, ILogger<MetarService> logger)
    {
        _httpClient = httpClient;
        _logger = logger;
        _httpClient.Timeout = TimeSpan.FromSeconds(8);
        if (!_httpClient.DefaultRequestHeaders.Contains("User-Agent"))
            _httpClient.DefaultRequestHeaders.Add("User-Agent", "AERIS-Craiova-ATM/1.0 (atm-aeris@lrcv.ro)");
    }

    /// <inheritdoc/>
    public async Task<string?> GetRawMetarAsync()
    {
        var raw = await FetchLatestMetarAsync();
        return raw?.RawObservation;
    }

    /// <inheritdoc/>
    public async Task<MetarDecoded?> GetDecodedMetarAsync()
    {
        var raw = await FetchLatestMetarAsync();
        if (raw is null) return null;
        return MetarParser.Decode(raw);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internals
    // ─────────────────────────────────────────────────────────────────────────

    private async Task<MetarRaw?> FetchLatestMetarAsync()
    {
        try
        {
            var response = await _httpClient.GetAsync(MetarApiUrl);
            response.EnsureSuccessStatusCode();
            var content = await response.Content.ReadAsStringAsync();
            var list = JsonSerializer.Deserialize<List<AvwxMetarDto>>(content, JsonOptions);

            if (list is null || list.Count == 0)
            {
                _logger.LogWarning("aviationweather.gov a returnat 0 METAR-uri pentru LRCV.");
                return null;
            }

            // Luăm cel mai recent METAR (primul din listă, ordonat descrescător de API)
            var dto = list[0];
            return MapToMetarRaw(dto);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Eroare la obținerea METAR-ului de la aviationweather.gov.");
            return null;
        }
    }

    /// <summary>
    /// Mapează DTO-ul intern al aviationweather.gov la modelul nostru <see cref="MetarRaw"/>.
    /// </summary>
    private static MetarRaw MapToMetarRaw(AvwxMetarDto dto)
    {
        // Cloud layers – aviationweather.gov returnează baza direct în ft (ex: 300, 600, 800)
        // Convertim la sute de ft pentru MetarRaw (ex: 300ft → 3, 600ft → 6)
        var clouds = dto.Clouds?
            .Where(c => c.Cover is not null)
            .Select(c => new CloudLayerRaw(
                Cover: c.Cover,
                Base: c.Base.HasValue ? c.Base.Value / 100 : null))
            .ToList();

        // Vizibilitate: poate fi număr (statute miles) sau string "6+"
        double? visibSmiles = null;
        if (dto.Visib.ValueKind == System.Text.Json.JsonValueKind.Number)
            visibSmiles = dto.Visib.GetDouble();
        else if (dto.Visib.ValueKind == System.Text.Json.JsonValueKind.String)
        {
            string vs = dto.Visib.GetString() ?? "";
            if (vs.EndsWith("+")) vs = vs[..^1];
            if (double.TryParse(vs, System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out double vd))
                visibSmiles = vd;
        }

        // QNH: aviationweather.gov returnează altim direct în hPa (ex: 1020)
        // Nu trebuie conversie – valorile sunt deja în hPa pentru METAR-uri europene
        int qnh = dto.Altim.HasValue ? (int)Math.Round(dto.Altim.Value) : 1013;
        string qnhStr = $"Q{qnh}";

        // Timp observație: obsTime este Unix timestamp, reportTime este ISO string
        string? obsTimeStr = dto.ReportTime; // "2026-10-31T08:30:00.000Z"

        return new MetarRaw(
            RawObservation: dto.RawOb,
            IcaoId: dto.IcaoId ?? "LRCV",
            ObsTime: obsTimeStr,
            Temp: dto.Temp,
            Dewp: dto.Dewp,
            Altim: dto.Altim,       // hPa – MetarParser va interpreta corect
            Altim_hpa: qnhStr,
            Wspd: dto.Wspd,
            Wdir: dto.Wdir,
            Wgst: dto.Wgst,
            Visib: visibSmiles,
            WxString: dto.WxString,
            SkyCondition: dto.Cover,
            FlightCategory: dto.FltCat,
            Clouds: clouds?.Count > 0 ? clouds : null
        );
    }

    private static void AddCloud(List<CloudLayerRaw> list, int? baseFtAgl, string? cover)
    {
        if (!string.IsNullOrEmpty(cover) && cover != "CLR" && cover != "SKC")
            list.Add(new CloudLayerRaw(cover, baseFtAgl.HasValue ? baseFtAgl.Value / 100 : null));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DTO intern – câmpurile returnate de aviationweather.gov JSON API
    // Documentație: https://aviationweather.gov/api/doc/metar#fields
    // ─────────────────────────────────────────────────────────────────────────

    private class AvwxMetarDto
    {
        // Câmpurile reale returnate de aviationweather.gov JSON API
        public string? RawOb { get; set; }              // "METAR LRCV 310830Z 25009KT..."
        public string? IcaoId { get; set; }             // "LRCV"
        public long? ObsTime { get; set; }              // Unix timestamp UTC
        public string? ReportTime { get; set; }         // "2026-10-31T08:30:00.000Z"
        public double? Temp { get; set; }               // Temperatura °C
        public double? Dewp { get; set; }               // Punct rouă °C
        public double? Altim { get; set; }              // QNH în hPa (nu inHg!)
        public double? Wspd { get; set; }               // Viteza vânt noduri
        public double? Wdir { get; set; }               // Direcția vânt grade
        public double? Wgst { get; set; }               // Rafale noduri
        // visib poate fi număr sau string (ex: "6+") → deserializăm ca JsonElement
        public System.Text.Json.JsonElement Visib { get; set; }
        public string? WxString { get; set; }           // "BR", "RA", "TSRA", etc.
        public string? Cover { get; set; }              // Cover dominant
        public string? FltCat { get; set; }             // "VFR", "IFR", "LIFR", "MVFR"
        public List<AvwxCloudDto>? Clouds { get; set; }
    }

    private class AvwxCloudDto
    {
        public string? Cover { get; set; }   // "BKN", "OVC", "SCT", "FEW"
        public int? Base { get; set; }       // Baza în ft (ex: 300, 600, 800) – NU în sute!
    }
}
