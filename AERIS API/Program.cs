using Aeris.PlanningEngine.Services;
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
builder.Services.AddHttpClient<IMetarService, MetarService>();
builder.Services.AddHttpClient<IOpenSkyLiveService, OpenSkyLiveService>();

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
