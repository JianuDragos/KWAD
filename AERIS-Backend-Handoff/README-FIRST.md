# AERIS — backend handoff for Windows ARM64

This folder is for the same Snapdragon X Elite / 16 GB Windows ARM64 class of laptop. It includes the real model weights, native llama.cpp runtime, startup scripts, a C# backend adapter, and a runnable sample API. No cloud account, API key, Python, Foundry installation or model download is required to run the complete offline package.

**Model:** Qwen3-4B-Instruct-2507, Q4_K_M, via llama.cpp b11960 on CPU. This is a new 4B model; it is not the earlier Qwen2.5 3B model. NPU acceleration is not used by this package.

The recommended statement-selection workflow passed **37/40 relevance tests (92.5%)**, with all backend facts preserved and a **4.43-second median** response. Unrestricted report generation passed only 15/30 tests. Use the C# adapter below for the measured reliable workflow; see [RESULTS.md](RESULTS.md) for the distinction.

## Run the LLM

Extract the entire ZIP to a local folder. Open PowerShell in that folder:

```powershell
powershell -NoProfile -File .\Start-LLM.ps1
powershell -NoProfile -File .\Test-LLM.ps1
```

No Windows execution-policy change is required by this package. If your computer blocks PowerShell scripts, follow its existing policy or run the native server directly from the terminal:

```powershell
.\runtime\llama-server.exe -m ".\models\qwen3-4b-instruct-2507-q4_k_m.gguf" -c 4096 -ngl 0 -t 8 -tb 8 --parallel 1 --host 127.0.0.1 --port 18090 --alias aeris-local --jinja --no-webui --offline --cache-ram 0
```

This direct command stays in the terminal; Ctrl+C stops it. The background ownership scripts apply only when Start-LLM.ps1 started the server.

The script waits for readiness and then returns. The inference process stays in the background. Connection settings:

```json
{
  "baseUrl": "http://127.0.0.1:18090/",
  "chatCompletionsPath": "v1/chat/completions",
  "model": "aeris-local"
}
```

Stop it with:

```powershell
powershell -NoProfile -File .\Stop-LLM.ps1
```

## Run on the Snapdragon X Elite NPU

The CPU script above remains the fallback. For Hexagon NPU inference, this machine uses Qualcomm GenieX CLI v0.10.0 and the Qualcomm Hexagon NPU Driver. Windows must list `Snapdragon(R) X Elite - X1E80100 - Qualcomm(R) Hexagon(TM) NPU` as started in `pnputil /enum-devices /connected`.

The NPU needs the Q4_0 variant of the same pinned Qwen3-4B-Instruct-2507 checkpoint. GenieX stores it in the per-user cache; the first pull downloads about 2.2 GiB:

```powershell
powershell -NoProfile -File .\Download-Model-NPU.ps1
```

Start the NPU server on the AERIS API's configured loopback port:

```powershell
.\Start-LLM-NPU.ps1
```

The server binds only to `127.0.0.1:18090`, and logs device selection to `logs/geniex.stderr.log`. Confirm `Found device: HTP0` and `Using 1 device(s): HTP0` after the first request. Stop only this owned server with `.\Stop-LLM-NPU.ps1`.

The model's Q4_0 file SHA-256 is `e0ba675d86ab277c61701c6793659b2ae801d95e3be791464c321e6fbf613be2`. Q4_K_M is not the NPU variant; it typically falls back to CPU/GPU. For driver installation and supported Windows builds, use Qualcomm's [GenieX Windows ARM64 install guide](https://geniex.aihub.qualcomm.com/en/run/cli/install).

Only one instance should run. Startup refuses an occupied port; shutdown verifies both process path and start time before stopping its owned process. Logs go to `logs/`. Keep at least several GiB of free RAM and avoid loading another LLM at the same time. The context is 4096 tokens, eight CPU threads, one inference slot. All listeners bind to this computer only. `127.0.0.1` is not accessible from another laptop.

The native runtime depends on Microsoft's Visual C++ ARM64 runtime, which was already present on the test laptop. If Windows reports a missing `MSVCP140.dll`/`VCRUNTIME140.dll` or a runtime entry point, run the included Microsoft-signed `prerequisites/vc_redist.arm64.exe`, then retry. It may request administrator approval. This installer is provided for offline setup and was not executed by this task. [Microsoft's runtime download documentation](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/).

## Recommended backend integration

Use `backend/GroundedExplainer.cs` in the ASP.NET backend. It is .NET 8-compatible and uses only standard .NET libraries. [BACKEND-INTEGRATION.md](BACKEND-INTEGRATION.md) has the exact registration and call example.

The reliable mode gives the model a limited job: **select relevant approved statements by ID**. Your backend renders those statements from planner results and typed weather/aircraft data. C# preserves their exact wording, inserts required engine/limitation statements even if the model omits them, and supplies all approved statements on failure. The model does not generate the factual sentences. It can still choose an irrelevant statement; test relevance on your own scenarios.

This is intentionally narrower than arbitrary aviation chat. Questions outside the supplied information produce a general scenario fallback, marked as such. Do not describe that fallback as a direct answer. No RAG text, user input or external unvalidated prose belongs in the approved statements list.

## Try the complete example API

After starting the LLM, run this in a second PowerShell terminal:

```powershell
powershell -NoProfile -File .\Start-Sample.ps1
```

The included `demo/Sample.exe` carries its own .NET runtime for ARM64; no SDK is needed to run it. You can also run `.\demo\Sample.exe` directly. Call it from a third terminal:

```powershell
$body = @{ question='What wind direction and wind speed were observed?'; scenarioRevision=42 } | ConvertTo-Json
Invoke-RestMethod 'http://127.0.0.1:5088/api/aeris/explain' -Method Post -ContentType 'application/json' -Body $body
```

Expected: mode `grounded_selection`, revision 42, and the unchanged backend decision, weather and limitation sentences. If the LLM is unavailable, mode becomes `deterministic_fallback`; it returns the complete approved scenario report. Revision 41 receives HTTP 409. Empty questions receive HTTP 400. Ctrl+C stops the sample API.

The sample uses fixed synthetic data from `sample/Fixture.cs`; it is not the real AERIS planner or a real weather feed. Replace that adapter in your backend. The sample has no authentication and is loopback-only; integrate authentication and scenario authorization from your existing backend before deployment.

## Contents and reproduction

- `models/`: the 2.50 GB GGUF file; exact revision and SHA-256 in `model.json`.
- `runtime/`: Windows ARM64 CPU runtime; `licenses/`: upstream notices and model card.
- `backend/`: drop-in helper and a net8.0 library project.
- `sample/` and `demo/`: example API source and self-contained ARM64 executable.
- `checks/`: adversarial/error-handling checks; `evaluation/`: frozen live relevance questions.
- `evidence/`: raw measured results and integration checks; `RESULTS.md`: findings and limits.
- `benchmarks/`: original unrestricted AERIS benchmark source for reproducibility.

Developers with a native .NET 10 SDK can run:

```powershell
dotnet run --project .\checks -c Release
dotnet run --project .\sample -c Release
# With the LLM running; use a NEW output directory to preserve supplied evidence:
dotnet run --project .\evaluation -c Release -- .\evaluation\questions.json .\my-evaluation aeris-local
```

The companion compact archive excludes only the large GGUF weights and generated build directories. Use `Download-Model.ps1` once with internet if choosing that archive. After downloading, it becomes equivalent for inference. The full offline archive needs no download. Updating a model or runtime invalidates the measured results; rerun the tests.
