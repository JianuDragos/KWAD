# AERIS friend handoff — design and execution plan
User requests a ready-to-send folder for the same Windows ARM64 laptop and a more reliable alternative. Earlier explicit authorization is autonomous execution; no new approval dependency. Work stays outside the benchmark source and main AERIS repository.

Approaches: (1) package the existing 3B model unchanged: easy but failed quality; (2) test Qwen3 4B Instruct and use backend-approved statement selection: chosen, better model candidate plus enforceable factual boundary; (3) hosted model: excluded by local/offline requirements.

Deliverables: ARM64 llama.cpp runtime plus selected model, pinned manifest/license notices, Start-LLM.ps1, Stop-LLM.ps1, Test-LLM.ps1, minimal .NET 8-compatible C# adapter and standalone ASP.NET sample, request examples, factual test evidence, transfer ZIP. Inference binds loopback and one slot. Existing models/logs preserved.

Task 1: Download pinned Qwen3-4B-Instruct-2507 Q4_K_M; verify SHA256. Reuse unchanged benchmark DLL against a separate server/results directory. Compare all original cases (3 repeats), keep partial/failure results honest. No score laundering.
Task 2: C# GroundedExplainer.ExplainAsync(question, revision, statements, cancellationToken) returns only exact backend-owned text by selected ID, always including Required statements; all input from backend, never frontend-owned authoritative facts. Test malformed/unknown IDs, missing required statements, server failure, cancellation and duplicate IDs first. LLM may fail relevance; reports disclose fallback, never claim arbitrary prose is validated. No additional NuGet dependency.
Task 3: Build/run sample, integration tests, live selection evaluation with frozen expected IDs and adversarial/missing-data questions. Report relevance separately from factual-preservation and original benchmark score. Runtime scripts own only their process, health check and clear readiness, detect occupied port; test startup and stop.
Task 4: Copy selected model/runtime and license files, pin checksums, write friend instructions, create full offline-ready archive and compact source archive. Verify extracted runtime and project; final independent review.

Review focus: untrusted statement IDs/text; caller vs timeout cancellation; wrong model/service on occupied port; stale revisions; unknown/empty model selections hiding required facts.

Tracking: Task1 in progress. Task2 pending. Task3 pending. Task4 pending.
