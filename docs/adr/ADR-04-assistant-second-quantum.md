# ADR-04: The AI Assistant is a second, separate service

**Status:** Accepted · **Date:** 2026-11-04 · **Decided by:** Zeyad Khaled

## Context
A driver should be able to write "find me parking near the AUC gate" and have it done. A language-model call is slow
(seconds) and may fail (provider down). The requirement set by Zeyad: "if the AI fails, nothing else fails." A module
inside the monolith behind a port with a timeout isolates provider failures, but a bug in the assistant's own code
(a crash, a memory leak) would share the process with Ticketing.

## Decision
- The Assistant is a **second architecture quantum**: a small separate service with its own deployment and its own
  database (conversation history, keyed by the driver's pseudonym, with a "delete my history" action).
- It calls the main server's **public interface over HTTPS with the driver's own token**, exactly as the Driver App
  does, so it can never do anything the driver could not do by tapping. It never holds a staff token.
- **Scope**: actions with a confirm tap. It finds parking, quotes prices, gives directions, reports ticket status, and
  can prepare "open my ticket" or "pay", which the main system applies only after the driver taps confirm in the app.
- **Language**: English for now; the standing exclusion on Arabic-language processing stays.
- "Frequent places" are read from the driver's own ticket history through the public interface; chat history gives
  in-conversation context only.
- The language-model provider sits behind a port (ADR-11); a free tier must be verified against the vendor's own page.
- Replaces the deferred Voice Assistant; voice becomes an input method on top later.

## Alternatives rejected
- **In-process module behind a port**: isolates the provider but not our own bugs; redeploying the assistant would
  redeploy ticketing.
- **Read-only scope**: safer, but Zeyad chose actions with a confirm tap; the confirm step keeps integrity.
- **No stored history**: Zeyad wants history for frequent places; it is stored in the assistant's own database only.

## Consequences
- Easier: the assistant can die, be slow or be redeployed without touching the main system (fitness function F9).
- Harder: a second deployable, a second free tier, a second small database; the confirm-tap flow needs a pending-action
  endpoint in the main system.

## Related
ADR-01 (availability), ADR-03, ADR-06 (personal data in history), ADR-11.
