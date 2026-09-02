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

**19 slides, ~11 minutes.** Speaker notes are on every slide - the words to say are in
`../docs/DEMONSTRATION.md` Part 2, and the screen-by-screen guide is `../docs/SCREEN_GUIDE.txt`.

| # | Slide |
|---|---|
| 1 | **USP and the proposed solution** - the claim, the four-box chain, three proof figures |
| 2 | The use case - what was asked, and the data we were given |
| 3 | **The decision underneath it** - Cu / Co, the fractile, and the five-step worked example |
| 4 | The end users - three people, three questions, three screens |
| 5 | The product - Decisions *(screenshot)* |
| 6 | The product - Order, the screen the system exists for *(screenshot)* |
| 7 | **All seven screens** - the contact sheet *(seven screenshots)* |
| 8 | **The component map** - every component, its bullets, and what was cut |
| 9 | Architecture - the batch/serve split, and the stack |
| 10 | What we measured before designing anything |
| 11 | The three provenance lanes |
| 12 | **The portfolio and how it is routed** - ADI/CV squared quadrants, eleven models |
| 13 | Result 1 - accuracy leaderboard |
| 14 | **Result 2 - selection lost to combination** (lead the technical case here) |
| 15 | Result 3 - calibration, before and after *(screenshot)* |
| 16 | Result 4 - the measured business case *(screenshot)* |
| 17 | Where it does not work |
| 18 | The deepest limitation - censored demand |
| 19 | Conclusion |

### Why the architecture slide is drawn, not an image

`docs/Arch Diagram1.png` is the diagram submitted with the original design. It is not used
in the deck, for two reasons: its labels are garbled (`aalesdally.sev`, `Ldompotent`,
`newsvender formula`, `eapiry exposure`, `DuskDB`) and legible at projector size, and it
shows Layer 4, the scenario engine, the assistant and the stress harness - none of which
exist in the build. Slide 8 draws the same information in native shapes, from the code that
is actually there, and names what was removed.

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
