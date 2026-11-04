# ADR-11: Providers sit behind ports frozen before any provider is chosen

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
The database, server host, map, photo storage, payment provider, push or SMS provider and language-model provider are
all undecided. Free tools only, with no credit card, and every free tier must be verified against the vendor's own page.
Depending on a provider's special feature would make the choice irreversible.

## Decision
**Rule B**: every outside provider sits behind a port (an interface owned by the module that uses it), and the ports are
frozen before any provider is chosen. Ports: database access (repositories), payment gateway, photo store, map tiles and
boundaries, notification delivery, language model. Adapters are the only code that knows a provider's name. Candidates
named in earlier documents (Neon, Cloudflare Workers) are candidates, not choices.

## Alternatives rejected
- Choosing providers first and designing around them: fast, but the free tier or the provider can vanish.

## Consequences
- Easier: a provider swap is one adapter; tests run against in-memory adapters.
- Harder: a port must be designed without the comfort of a concrete provider; the port may need a feature the chosen
  provider lacks (then the adapter, not the port, absorbs it).

## Related
ADR-02, ADR-03, ADR-04.
