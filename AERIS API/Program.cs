using Aeris.PlanningEngine.Services;
using Aeris.PlanningEngine.Services.TrajectorySeparation;
using Aeris.LocalAI;
using System.Reflection;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

// Configurare servicii
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    var xmlFilename = $"{Assembly.GetExecutingAssembly().GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFilename);
    if (File.Exists(xmlPath))
    {
        c.IncludeXmlComments(xmlPath);
    }
});

// ── Servicii existente & Trajectory Separation Engine ─────────────────────────
builder.Services.AddScoped<IPlanningService, PlanningService>();
builder.Services.AddSingleton<TrajectoryPredictor>();
builder.Services.AddScoped<ITrajectorySeparationEngine, TrajectorySeparationEngine>();
builder.Services.AddScoped<SafePlanningCoordinator>();
builder.Services.AddHttpClient<IOpenSkyService, OpenSkyService>();
builder.Services.AddScoped<ICraiovaAdvisoryEngine, CraiovaAdvisoryEngine>();

// ── Servicii METAR + OpenSky Live Positions (cu protecție anti-blacklist) ─────
builder.Services.AddHttpClient("aviation-weather", client =>
{
    client.Timeout = TimeSpan.FromSeconds(8);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("AERIS-Craiova-ATM/1.0 (weather monitoring)");
});
builder.Services.AddSingleton<IResilientWeatherService, ResilientWeatherService>();
builder.Services.AddScoped<IMetarService, AviationWeatherService>();

builder.Services.AddHttpClient("opensky-live", client =>
{
    client.Timeout = TimeSpan.FromSeconds(6);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("AERIS-Craiova-ATM/1.0");
});
builder.Services.AddSingleton<IOpenSkyLiveService>(sp =>
{
    var httpFactory = sp.GetRequiredService<IHttpClientFactory>();
    var logger = sp.GetRequiredService<ILogger<OpenSkyLiveService>>();
    var config = sp.GetRequiredService<IConfiguration>();
    return new OpenSkyFetcher(httpFactory.CreateClient("opensky-live"), logger, config);
});

builder.Services.AddSingleton<VmcChecker>();
builder.Services.AddSingleton<VfrGeofenceEngine>();
builder.Services.AddSingleton<IVfrGeofenceService>(sp => sp.GetRequiredService<VfrGeofenceEngine>());
builder.Services.Configure<OpenAipOptions>(builder.Configuration.GetSection("OpenAIP"));
builder.Services.AddHttpClient<OpenAipService>();
builder.Services.AddSingleton<IOpenAipService>(sp => sp.GetRequiredService<OpenAipService>());
builder.Services.AddHostedService(sp => sp.GetRequiredService<OpenAipService>());
builder.Services.Configure<OgnAprsOptions>(builder.Configuration.GetSection("OGN"));
builder.Services.AddHostedService<OgnAprsListener>();
builder.Services.Configure<Sbs1Options>(builder.Configuration.GetSection("SBS1"));
builder.Services.AddHostedService<Sbs1Listener>();

// ── Local AI grounded explainer (Qwen3-4B-Instruct-2507, doar loopback) ───────
builder.Services.AddHttpClient("local-ai", (sp, client) =>
{
    var config = sp.GetRequiredService<IConfiguration>();
    var baseUrl = config["LocalAI:BaseUrl"];
    client.BaseAddress = new Uri(string.IsNullOrWhiteSpace(baseUrl) ? "http://127.0.0.1:18090/" : baseUrl);
    client.Timeout = Timeout.InfiniteTimeSpan; // deadline-ul este gestionat de GroundedExplainer
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { UseProxy = false });

builder.Services.AddScoped<GroundedExplainer>(sp =>
{
    var httpFactory = sp.GetRequiredService<IHttpClientFactory>();
    var config = sp.GetRequiredService<IConfiguration>();
    var model = config["LocalAI:Model"] ?? "aeris-local";
    var fallbackModel = config["LocalAI:FallbackModel"] ?? "unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_0";
    var timeoutSec = Math.Clamp(config.GetValue("LocalAI:TimeoutSeconds", 15), 2, 60);
    return new GroundedExplainer(
        httpFactory.CreateClient("local-ai"),
        model: model,
        timeout: TimeSpan.FromSeconds(timeoutSec),
        fallbackModel: fallbackModel);
});

var app = builder.Build();

// Configurare pipeline HTTP
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "AERIS Planning API v1");
    });
}

// Redirectare automată din rădăcină (/) către (/swagger)
app.MapGet("/", () => Results.Redirect("/swagger")).ExcludeFromDescription();

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
