# Per-workstream results

The original briefs in `../` said what each pod should build. These say what was actually built,
what it measured, what broke, and where the code is.

| Doc | Workstream | Headline |
|---|---|---|
| [POD_A_DATA_PLATFORM.md](POD_A_DATA_PLATFORM.md) | Data & platform | 9 gates green, 26 closures, one source of truth — now **many datasets, any as-of date** (§8) |
| [POD_B_FORECAST_ENGINE.md](POD_B_FORECAST_ENGINE.md) | Forecast engine | Ensemble 0.907, selection measured losing, calibration corrected — and the **last hardcoded claim removed** (§11) |
| [POD_C_DECISION_API.md](POD_C_DECISION_API.md) | Decision & API | Protection-interval fix, 17 endpoints — and the **business case corrected downward** after it was found measuring the wrong thing (§11) |
| [POD_D_PRODUCT.md](POD_D_PRODUCT.md) | Product | **Eight** screens, **four** bespoke charts, full re-theme (§11) |

Each follows the same shape: **scorecard → decisions with the alternative they beat → code →
measured impact → tests owned → honest gaps.**

Each doc ends with a **§ Second pass** section covering everything after the first review.
Those sections are where the corrections live, and the corrections are the more instructive half:
a business case that was inflated, a season label that was typed rather than measured, a test
suite that was writing to the demo database.

For the whole system in one document, read `../../docs/PHARMAPULSE_SYSTEM.md` — §10 is the same
delta at system level. For the running interface panel by panel, read
`../../docs/WEB_REFERENCE.md`.
