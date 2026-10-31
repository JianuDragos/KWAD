using Aeris.PlanningEngine.Services;
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

// ── Servicii existente (legacy – neatinse) ────────────────────────────────────
builder.Services.AddScoped<IPlanningService, PlanningService>();
builder.Services.AddHttpClient<IOpenSkyService, OpenSkyService>();
builder.Services.AddScoped<ICraiovaAdvisoryEngine, CraiovaAdvisoryEngine>();

// ── Servicii noi: METAR + OpenSky Live Positions ──────────────────────────────
builder.Services.AddHttpClient("aviation-weather", client =>
{
    client.Timeout = TimeSpan.FromSeconds(8);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("AERIS-Craiova-ATM/1.0 (weather monitoring)");
});
builder.Services.AddSingleton<IResilientWeatherService, ResilientWeatherService>();
builder.Services.AddScoped<IMetarService, AviationWeatherService>();
builder.Services.AddHttpClient<IOpenSkyLiveService, OpenSkyFetcher>();
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

// ── Local AI grounded explainer (inferență separată, doar loopback) ──────────
builder.Services.AddHttpClient<GroundedExplainer>(client =>
{
    client.BaseAddress = new Uri("http://127.0.0.1:18090/");
    client.Timeout = Timeout.InfiniteTimeSpan; // deadline-ul de 30s este gestionat de helper
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler { UseProxy = false });

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
