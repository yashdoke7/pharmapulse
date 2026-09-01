# deck/

`PharmaPulse.pptx` — the presentation. **Do not hand-edit it.**

```bash
npm install pptxgenjs          # once
node build_deck.js             # regenerate
python qa_deck.py PharmaPulse.pptx
```

Every accuracy figure is read from `../artifacts/benchmarks.json` at build time, so the deck cannot
drift from the benchmark. If a number changes, rerun `scripts/day1_benchmark.py` and rebuild.

**13 slides, ~7 minutes.** Speaker notes are on every slide — the words to say are in
`../docs/DEMONSTRATION.md` Part 2.

| # | Slide |
|---|---|
| 1 | Title — the claim and three proof figures |
| 2 | The problem — both directions cost money |
| 3 | The thesis — forecast → order, and the newsvendor fractile |
| 4 | What we measured before designing anything |
| 5 | The three provenance lanes |
| 6 | Result 1 — accuracy leaderboard |
| 7 | **Result 2 — selection lost to combination** (lead the technical case here) |
| 8 | Result 3 — calibration, before and after |
| 9 | Result 4 — the measured business case |
| 10 | The product — seven screens |
| 11 | Where it does not work |
| 12 | The deepest limitation — censored demand |
| 13 | Close |

## QA

`qa_deck.py` checks geometry analytically — off-slide shapes, margin violations, estimated text
overflow and overlapping frames. It exists because LibreOffice was not available on the build
machine, so slides could not be rendered to images.

**Open the deck once in PowerPoint before presenting.** The generator uses Cambria, Calibri and
Courier New — all ship with Office — but a visual pass on the real renderer has not been done.
