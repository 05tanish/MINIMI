# Minimi answer quality evaluation

`scenarios.json` is the fixed evaluation set. Each case defines setup, user query, and observable checks or reference assertions. Keep scenarios stable when comparing model or orchestration changes; add new cases instead of rewriting old ones.

For a provider-backed run, seed the stated setup into an isolated test account, replay each query once with the same configured model/provider set and retrieval corpus, and record the returned answer, resolved citation URLs, route decisions, retrieval IDs, and end-to-end latency. Score outputs against the case's reference assertions without showing reviewers which version produced them.

Score each dimension from 0 to 2 (0 = failed, 1 = partly met, 2 = met): factual accuracy (30%), relevance and intent (20%), citation/source correctness (15%), completeness (10%), uncertainty and premise handling (10%), memory relevance (10%), and formatting (5%). Report median and p95 latency separately. For image and PDF cases, also record upload success, vision-provider success, and whether claims match visible image or document content. Do not count missing external credentials as a successful benchmark run.

The local Vitest suite checks deterministic routing, safe image/PDF type validation, citation IDs, temporal parsing, retrieval utilities, and provider fallback behavior. It does not claim to measure live model factual accuracy.
