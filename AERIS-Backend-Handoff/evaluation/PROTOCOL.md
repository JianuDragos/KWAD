# Separate, narrow-task evaluation

Frozen before live selection runs. Forty questions: planning, arrival times, observation versus hypothetical weather, supplied aircraft properties, missing capability, terminology, operational authority, combinations, six Romanian paraphrases, four adversarial requests, four unrelated requests, and two exact repeats.

Target: >=36/40 exact relevance passes. A pass requires the precise expected statement set plus the two backend-required statements. For unrelated questions, the expected result is explicitly `no_matching_statement`, not an inference failure. Every response must retain required statements, exact backend text, and revision. Required statements are always inserted by C#, so their preservation is an architecture property, not model knowledge.

Input statement text is supplied by the backend. The LLM selects IDs only, under JSON schema constraints, 160 output tokens, requested temperature zero, 30-second deadline. Fallback returns all approved statements and a reason. The UI must disclose that fallback is a general scenario report and may not answer the question. Raw model HTTP responses and per-case timings are saved. No prompt edits or replacing failures during the measured run. Relevance is not free-form aviation intelligence; this score cannot replace the original benchmark.
