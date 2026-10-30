using Microsoft.AspNetCore.Mvc;
using Aeris.PlanningEngine.Models;
using Aeris.PlanningEngine.Services;

namespace AERIS_API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PlanningController : ControllerBase
{
    private readonly IPlanningService _planningService;

    public PlanningController(IPlanningService planningService)
    {
        _planningService = planningService;
    }

    /// <summary>
    /// Evaluează scenariul demonstrativ predefinit (IFR1, IFR2, IFR3, VFR) și returnează toate variantele calculate.
    /// </summary>
    [HttpGet("sample")]
    public IActionResult GetSample()
    {
        var response = _planningService.GetSampleScenario();
        return Ok(response);
    }

    /// <summary>
    /// Evaluează un scenariu personalizat (listă aeronave și reguli) și returnează variantele valide clasificate și cele respinse.
    /// </summary>
    [HttpPost("evaluate")]
    public IActionResult Evaluate([FromBody] EvaluationRequestDto request)
    {
        try
        {
            var response = _planningService.EvaluateScenario(request.Aircrafts, request.Rules);
            return Ok(response);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }
}
