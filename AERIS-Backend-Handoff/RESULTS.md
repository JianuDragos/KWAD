# Model choice and reliability — 31 October 2026

**Recommendation for this handoff: Qwen3-4B-Instruct-2507 Q4_K_M on llama.cpp ARM64 CPU, used for selecting backend-approved statements.** Keep planner facts and final factual wording in C#. Unrestricted generated aviation explanations still do not pass the original reliability gate.

## New model versus previous best

The new model was downloaded from [Unsloth's GGUF repository](https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF), pinned to revision `a06e946bb6b655725eafa393f4a9745d460374c9` and SHA-256 verified. The [upstream Qwen model](https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507) is an instruction model with Apache 2.0 licensing. Copies of the model card and license are included. Its architecture avoids requiring a separate long reasoning response for this task; local results determine the recommendation, not advertised benchmark scores.

| Original full aviation benchmark | Previous Qwen2.5 3B Q4_K_M | New Qwen3 4B Instruct Q4_K_M |
|---|---:|---:|
| Runtime/provider | llama.cpp ARM64 CPU | llama.cpp ARM64 CPU |
| Weighted score | 69.0/100 | **72.9/100** |
| Full reports passing | 9/30 | **15/30** |
| Automated grounding passes | 21/30 | **24/30** |
| Normal completions | 30/30 | 30/30 |
| Simple mock tool requests | 3/3 | 3/3 |
| Median first content | 1.40 s | 1.79 s |
| Median total generation | 11.73 s | 17.63 s |
| Peak inference-process working set | 3.87 GiB | 5.34 GiB |
| Original >=90% reliability gate | Fail | Fail |

Both used the same original prompts, 512-token maximum, requested temperature zero, 45-second request deadline, eight threads and 4096-token llama.cpp context. The 4B model's baseline cold load took 9.41 seconds. Minimum available system RAM during that run was 1.04 GiB; close unnecessary applications and keep one model loaded. Working set does not measure total allocation or energy efficiency. No GPU/NPU execution is claimed here.

The new model passed A (arrival order), C (weather distinction), E (missing capability), H (terminology) and I (prompt injection) in all three repetitions. It failed B by identifying B2 instead of B3 as the plan with the lowest maximum individual delay. D contained one extra closing brace, making its JSON invalid. G/J/J2 omitted required source or missing-information fields. These failures remain in the recorded score; no repaired outputs replaced them. Raw evidence: `evidence/full-suite/qwen3-4b-cpu`; computed metrics: `evidence/full-suite/summary.json`.

Three successful tool calls are only a simple capability check. The shipped adapter deliberately retrieves facts in C#; no model-selected tool is executed.

## Why the recommended workflow is different

An unrestricted model has to understand the question, choose facts, preserve all numbers, write prose, maintain source IDs and obey the schema. The prior evidence showed repeated failures across those responsibilities. In this handoff, C# performs deterministic rendering and schema/source management. The model only selects statement IDs relevant to the question.

Every output sentence is copied unchanged from a backend-approved sentence. Required decision and limitation statements are inserted regardless of the model's choices. Invalid, empty, truncated or failed selections produce the complete approved scenario report, with `mode=deterministic_fallback`. The model can still choose irrelevant statements; factual preservation alone does not prove that the answer addresses the question. Backend-approved statements must themselves be correct and current.

This is a useful AERIS integration pattern when users ask about facts your backend already knows. It is not a general-purpose aviation chatbot and does not establish real-world operational permission. Unsupported questions need an explicit unavailable/fallback state. RAG prose and user notes cannot become approved statements without backend validation.

## Narrow evaluation

See `evaluation/PROTOCOL.md` and the 40 questions frozen before live measurement. Relevance uses exact expected IDs plus required statements, with an acceptance target of 36/40. The suite includes single-topic questions, combined questions, six Romanian paraphrases, four adversarial prompts, four unrelated prompts, and two repeated questions. Factual preservation is checked independently. Raw responses and timings are saved in `evidence/selection-qwen4`.

**Measured result: 37/40 exact relevance passes (92.5%), meeting the 36/40 target; 40/40 responses preserved the backend's exact facts and required statements.** Median end-to-end helper time was **4.43 seconds**, range 4.12–5.73 seconds, excluding model loading. Four unrelated questions correctly produced `no_matching_statement` fallback. All six Romanian paraphrases and all four adversarial questions passed. The two repeated questions passed again.

The three relevance misses were cases 06 and 19 (extra statements), and case 22 (the delay comparison was omitted from a combined delay-and-wind question). They remain failures; the model/prompt was not retuned against them. See `evidence/selection-metrics.json`, `evidence/selection-qwen4/summary.json` and the raw response files. **92.5% describes this narrow selection task on one synthetic snapshot, not the model's general aviation accuracy.** The 40/40 factual-preservation result is primarily enforced by C#, not evidence that the model independently knows those facts.

The complete packaged flow passed: model startup, direct HTTP smoke test, live sample API with the expected decision/weather/limitation statements, stale revision rejection (409), empty question rejection (400), owned-process shutdown, and fallback after the server stopped. See `evidence/integration-checks.json`, `api-live.json`, `api-fallback.json`, and `shutdown.txt`. Fourteen library checks passed, including caller cancellation before and during inference. Independent code review found no Critical/Important C# defects. Packaging review improvements protect ownership-record failures and prevent evaluation reruns from overwriting existing results; a PowerShell ISO timestamp conversion issue was corrected and process identity checked by UTC ticks.

## Scope and operating limits

The packaged model/runtime have actually run on the supplied Snapdragon X Elite laptop. C# library checks cover exact text preservation, required facts, invalid/duplicate/unknown IDs, extra generated prose, HTTP failure, invalid backend input, remote endpoints and both timeout and caller cancellation. The source compiles for .NET 8; the included example executable is self-contained .NET 10 ARM64.

Initial provisioning used internet downloads. Model inference is local, the runtime is started with `--offline`, and the packaged synthetic example needs no external data. We did not physically disconnect networking or audit all outbound traffic; no cloud inference contributed to the results. The runtime's CPU path is intentional: tested NPU packages had substantially worse reliability, and another larger model would add memory pressure to this 16 GB laptop.

All selection questions use one synthetic snapshot. The measured relevance rate is not a guarantee on unseen airport scenarios, longer contexts or other languages. Test your real backend's rendered facts, unknown-data handling, stale revisions and user questions before using the assistant beyond this demonstration.

The included runtime, model and sample were executed successfully from the handoff folder. An additional extract-and-launch transfer test was rejected by automatic approval review with only “blocked by policy”; it was not completed. Archive content is checked separately against the SHA-256 manifest. No claim of execution on the friend's physical laptop is made.
