# deck/

`PharmaPulse.pptx` — the presentation. **Do not hand-edit it.**

```bash
npm install pptxgenjs                # once

# 1. refresh the product screenshots (needs both servers up - see below)
bash shoot.sh

# 2. rebuild and check
node build_deck.js
python qa_deck.py PharmaPulse.pptx
```

Every accuracy figure is read from `../artifacts/benchmarks.json` at build time, so the deck cannot
drift from the benchmark. If a number changes, rerun `scripts/day1_benchmark.py` and rebuild.

**17 slides, ~10 minutes.** Speaker notes are on every slide — the words to say are in
`../docs/DEMONSTRATION.md` Part 2.

| # | Slide |
|---|---|
| 1 | **USP and the proposed solution** — the claim, the four-box chain, three proof figures |
| 2 | The use case — what was asked, and the data we were given |
| 3 | The decision underneath it — Cu / Co, and the newsvendor fractile |
| 4 | **The end users** — three people, three questions, three screens |
| 5 | The product — Decisions *(screenshot)* |
| 6 | The product — Order, the screen the system exists for *(screenshot)* |
| 7 | **Architecture diagram** — five layers, and the one that no longer exists |
| 8 | Architecture — the batch/serve split, and the stack |
| 9 | What we measured before designing anything |
| 10 | The three provenance lanes |
| 11 | Result 1 — accuracy leaderboard |
| 12 | **Result 2 — selection lost to combination** (lead the technical case here) |
| 13 | Result 3 — calibration, before and after *(screenshot)* |
| 14 | Result 4 — the measured business case *(screenshot)* |
| 15 | Where it does not work |
| 16 | The deepest limitation — censored demand |
| 17 | Conclusion |

## Screenshots

`shoot.sh` drives headless Chrome against the running app at 2× device scale, trims the dead space
below the content, and cuts the derived crops the slides actually use. It needs:

```bash
uvicorn api.main:app --port 8000     # terminal 1
cd web && npm run dev                # terminal 2
python scripts/reset_demo.py         # so the Order screen is not already filled
```

`img/` is committed, so the deck rebuilds without the servers — rerun `shoot.sh` only when the
interface changes.

## QA

`qa_deck.py` checks geometry analytically — off-slide shapes, margin violations, estimated text
overflow and overlapping frames. It is a first pass, not a substitute for looking at the slides.

Every slide in this build **was** rendered and reviewed, by exporting through PowerPoint itself:

```powershell
$ppt = New-Object -ComObject PowerPoint.Application
$p = $ppt.Presentations.Open("$PWD\deck\PharmaPulse.pptx", $true, $false, $false)
foreach ($s in $p.Slides) { $s.Export("$PWD\out\slide$($s.SlideIndex).png", "PNG", 1600, 900) }
$p.Close(); $ppt.Quit()
```
