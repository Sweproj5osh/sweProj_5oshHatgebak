# Documents

Every document of the project lives in this folder (ADR-17). Three files stay at the repository root because tools load
them from there: `README.md`, `AGENTS.md` and `CLAUDE.md`; GitHub loads `.github/pull_request_template.md` from its own
folder. A pull request that changes code updates the documents that describe it.

| Folder | What it holds |
|---|---|
| [rules/](rules/ARCHITECTURE_RULES.md) | The binding rules, with their reasons |
| [architecture/](architecture/overview.md) | The overview and folder map, the modules and their owners, the fitness functions, and (as the restructure lands) the controller pattern and the REST route catalogue |
| [setup/](setup/) | Setting up the database, HTTPS and the app (as the restructure lands) |
| [adr/](adr/README.md) | The Architecture Decision Records, ADR-01 to ADR-22 |
| [team/](team/TEAM_TASKS.md) | The task sheet, the open questions, test reports and the restructure plan |
| [demo/](demo/DEMO.md) | How to run and present the demo scripts in `demo/` |
| [pdf/](pdf/) | The component diagrams |
