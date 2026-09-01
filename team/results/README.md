# Per-workstream results

The original briefs in `../` said what each pod should build. These say what was actually built,
what it measured, what broke, and where the code is.

| Doc | Workstream | Headline |
|---|---|---|
| [POD_A_DATA_PLATFORM.md](POD_A_DATA_PLATFORM.md) | Data & platform | 9 gates green, 26 closures, one source of truth, Docker verified |
| [POD_B_FORECAST_ENGINE.md](POD_B_FORECAST_ENGINE.md) | Forecast engine | Ensemble 0.907, selection measured losing, calibration corrected |
| [POD_C_DECISION_API.md](POD_C_DECISION_API.md) | Decision & API | Protection-interval fix, 16 endpoints, business case measured |
| [POD_D_PRODUCT.md](POD_D_PRODUCT.md) | Product | Seven screens, two bespoke charts, full re-theme |

Each follows the same shape: **scorecard → decisions with the alternative they beat → code →
measured impact → tests owned → honest gaps.**

For the whole system in one document, read `../../docs/PHARMAPULSE_SYSTEM.md`.
