# DEMONSTRATION — run it, then present it

> Everything needed to get PharmaPulse running from nothing, and to present it in seven minutes.

---

# PART 1 · Execution

## 1.1 From a clean clone — the local path (known to work)

```bash
git clone https://github.com/yashdoke7/pharmapulse.git
cd pharmapulse

python -m venv .venv
source .venv/Scripts/activate            # Windows Git Bash
# source .venv/bin/activate              # macOS / Linux

pip install -r requirements.txt          # ~3 min, includes Prophet
```

**Verify the data before anything else.** `salesdaily.csv` is committed, so this should pass
immediately:

```bash
python scripts/check_data.py
```

```
file          data\observed\salesdaily.csv
snapshot_id   sha256:49e4f1c5c3da
rows          2106   (expected 2106)
all-zero days 26   (expected 26 closures)
daily means   M01AB=5.03, M01AE=3.90, N02BA=3.88, N02BE=29.92, ...
OK.
```

**If the snapshot_id differs, stop.** Every reported number is tied to it.

### Build the pipeline

```bash
python -m pipelines.run_nightly --stage all      # ~3 min
```

Stage 1 (gold) takes 2.6 s. Stage 2 (forecast) takes ~170 s — it fits five model families across
three grains.

### Reproduce every accuracy number

```bash
python scripts/day1_benchmark.py                 # ~45 s
```

Writes `artifacts/benchmarks.json`. **This is the file the Ops Console reads.** Nothing on that
screen is typed by a human, which is why the script has to exist.

### Run it

```bash
uvicorn api.main:app --port 8000                 # terminal 1
cd web && npm install && npm run dev             # terminal 2
```

Open **http://localhost:5173**.

## 1.2 Containers — verified

```bash
docker compose up --build
```

The API **auto-detects**: forecast store present → serve it; absent → fall back to fixtures and say
so in `meta.degraded`. Both services come up on `:8000` and `:5173`.

> The pipeline is a one-shot, not a service:
> ```bash
> docker compose run --rm api python -m pipelines.run_nightly --stage all
> ```

## 1.3 Verify everything

```bash
pytest -q                                        # 138 tests
ruff check .                                     # clean
cd web && npm run build                          # clean
```

## 1.4 Before every rehearsal and before you present

```bash
python scripts/reset_demo.py
docker compose restart api          # or restart uvicorn
```

Accepting an order posts a real goods receipt, so a rehearsal leaves the board wherever the last run
ended. Reset returns it to the seeded mix and **keeps the audit log**, so the hash chain stays
demonstrable.

**The board should read:**

```
4 healthy · 3 needing an order · 1 overstocked · ₹1,099 across 3 exceptions
```

---

# PART 2 · The demonstration

**Seven minutes.** The order below is deliberate: money first, method second, honesty throughout.

## Pre-flight

- [ ] `python scripts/reset_demo.py` and restart the API
- [ ] Both services up; open on `/` and confirm ₹1,099 / 3 exceptions
- [ ] Browser at 100% zoom, one tab, notifications off
- [ ] Terminal ready in a second window with `scripts/day1_benchmark.py` typed but not run
- [ ] Recorded video reachable in two clicks, on a second device

---

## Step 1 · Open on the decision · *45 s*

**Land on `/`. Do not open on a chart.**

> "Every pharmacy makes this decision every week — how much of each medicine to buy. It is done from
> memory or a spreadsheet. This is what it looks like when you calculate it instead."

Point at the headline.

> "Four products need a decision today, ₹1,099 at risk. Not a chart of what happened — a list of what
> needs doing, ranked by money."

> "Ranked by **money**, not probability. A 30% chance on your biggest seller matters more than a 90%
> chance on something that sells twice a month."

---

## Step 2 · The order · *90 s* ← **the core**

**Click the top exception.** It opens Paracetamol on `/orders`.

> "We hold 310. The reorder point is 523. The system says order 220 — twenty-two packs."

**Point at *Where each input came from*.**

> "Black badge means **measured** — that is the forecast, from six years of history. Grey means
> **your setting** — lead time, margin, stock on hand. The grey never trains a model. It enters here,
> at the decision, and nowhere else. That rule is enforced in code, not by discipline."

**Now drag the slider.**

> "This is the control: *how often are you willing to run out?* Watch the quantity and the expected
> cost move."

**Then the line that matters:**

> "Open the network tab. Nothing is being fetched. The entire cost curve — sixteen service levels —
> arrived with the recommendation, because the newsvendor calculation is closed form and the demand
> distribution was resolved last night. **No model runs during a request.**"

**Point at the ±1 pack row.**

> "₹38.56 at the recommendation. ₹39.40 one pack fewer, ₹39.02 one pack more. It knows the cost of
> being slightly wrong in each direction."

**Click Accept.**

> "That posts a goods receipt. Stock goes 310 to 530, the status flips to OK, the suggestion drops to
> zero — and it is written to a hash-chained log. **The system recommends; a person commits**, and an
> override requires a reason."

---

## Step 3 · Why · *60 s*

**Go to `/explain`, select Paracetamol.**

> "Paracetamol is up 311 units next month: +310 from the January flu wave, +1 from trend."

> "Feature-importance charts explain the *model*. A buyer needs an explanation of the **quantity** —
> so the answer is in units, and the parts sum to the whole. A test asserts that, because an
> explanation that does not add up to the number it explains is worse than no explanation."

**Scroll to the reliability diagram. This is the differentiator.**

> "We measured whether our own confidence intervals are true. Our nominal 80% band actually covered
> **92%** of outcomes — too wide, which means over-ordering and capital stuck on the shelf. Red is
> before correction, green is after. We corrected it to 82%."

> "Every dashboard in this market draws a confidence band. **Nobody publishes whether theirs is
> right.** And we tell you it rests on 256 points — enough to establish a direction, not enough to
> certify a per-series level."

---

## Step 4 · Replay · *90 s* ← **the strongest evidence**

**Go to `/live`. Press Start.** Let it run ~15 seconds.

> "The data ends in 2019, so showing a live system is hard. We replay it. That is the real January
> 2019, one day per tick — real sales posting, stock depleting, orders going out, deliveries landing
> four days later. Nothing is invented; the screen is watermarked with the window."

**Scroll to *What it was worth*.**

> "Same real days. Same costs, same lead time, same review cadence, same protection interval. The
> only difference is that min/max orders to the **average** and we order to the **quantile your cost
> ratio implies**."

> "₹4,608 against ₹1,479. **Sixty-eight percent lower** — and it holds across three separate
> quarters: 64% and 76%. That is a measurement, not a projection."

**The honest half — say it before anyone asks:**

> "And notice we hold **more** stock and pay **more** holding cost. The entire saving comes from lost
> sales we did not have. That is the cost ratio doing its job."

---

## Step 5 · Evidence · *45 s*

**Go to `/ops`.**

> "Every number on this screen was written by the benchmark script. None of it is typed by a human."

> "Ensemble 0.907 against the seasonal-naive benchmark at 1.117 — 19% better."

**Point at the ablation.**

> "We implemented the obvious approach — pick each product's best model — and **measured it losing**.
> 0.968 against 0.907. With three hundred weekly observations, 'best on the last fold' is mostly
> noise, so selection chases noise. Independent models make independent mistakes and the median
> cancels them."

**Point at the per-series table, at the red rows.**

> "R06 is our worst series at 1.646, and M01AE is effectively a tie with a naive forecast. Both are
> on the screen in red. **A system that only shows you where it wins is not telling you anything.**"

**If you have a spare 20 seconds, run the benchmark live in the second terminal.**

---

## Step 6 · Close · *30 s*

**State the limitation first. It is the strongest thing you say.**

> "The deepest limitation: we forecast **sales**, not demand. A stockout records zero sales, so our
> observations are right-censored — worst on exactly the products that matter most. It is in the
> model card, and it is the first thing a real deployment fixes by joining the pharmacy's own
> inventory ledger."

**Then:**

> "Every pharmacy guesses how much to order. We calculate it — with the odds, the cost of being
> wrong, and the reason behind the number."

---

# PART 3 · How to show ours is better

| Against | The line | The evidence to point at |
|---|---|---|
| **A forecasting dashboard** | "They stop at the chart. The buyer still has to decide what 187 units means at a 4-day lead time with 40 in stock." | `/orders` — the slider, the ±1 pack cost |
| **A wholesaler's min/max tool** | "They order to the average. Average demand is met half the time." | `/live` — 67.9% lower cost on identical real days |
| **A better single model** | "Picking the best model is the obvious move. We implemented it and it lost." | `/ops` — 0.968 vs 0.907, oracle at 0.843 |
| **Any of them** | "Ours tells you when it is wrong." | `/explain` — the reliability diagram |

---

# PART 4 · If something breaks

| Failure | Response | Rehearse it? |
|---|---|---|
| **API dies** | `PHARMAPULSE_FIXTURES=1` — the app runs fully on fixtures and labels itself degraded | **yes** |
| **Deployed URL is cold** | Local `docker compose up` already running as hot standby | yes |
| **Replay misbehaves** | Skip it. The business-case card at the bottom of `/live` loads independently | yes |
| **A screen errors** | Every screen is independent; move on and come back | no |
| **Everything** | Recorded video, offline, on two devices | **yes** |

**Rehearse the fallback switch itself**, not just the demo. Knowing the video exists is not the same
as reaching it in eight seconds with a projector attached.

---

# PART 5 · Q&A drill

**"Isn't a median of five models just an average?"**
> The combination is one step. The ML is the global LightGBM quantile model, the conformal
> calibration, and the ADI/CV² router. But lead with the *result*: we tested selection against
> combination and measured selection losing. That is a finding, not a technique.

**"Eight products from one pharmacy. That's not a forecasting problem."**
> The problem is small; the failure modes are not. Intermittency, censoring, level shifts, closure
> days, multi-phase seasonality and calibration failure are all present here and all appear at scale.
> The global LightGBM member exists because per-series fitting is O(series) and dies at twenty
> million — on eight series it is unnecessary, and including it is the design decision.

**"How do I know your numbers are real?"**
> `git clone && pip install -r requirements.txt && python scripts/day1_benchmark.py`. Forty-five
> seconds, from a clean clone, on the committed dataset. It runs in CI on every push.

**"Your intervals were wrong."**
> They were, and we are the ones who found it. A nominal 80% band covered 92%. We corrected it and we
> show you both curves. The alternative was not measuring.

**"Why is R06 so bad?"**
> The May pollen peak is sharp and its timing moves year to year, and we have six observations of it.
> It is our worst series at 1.646, it still beats the benchmark's 1.880, and it is on screen in red.

**"Where's the ROI number?"**
> On the Replay screen, and it is a simulation over real days rather than an assumption. We
> deliberately do not quote a headline rupee-per-store-per-year figure, because that would be an
> argument dressed as a measurement.

**"What about authentication / multi-tenancy?"**
> Designed and specified, not built. Tenant isolation is the one failure whose consequence is
> disclosing another pharmacy's commercial data, so it belongs in the database, not in application
> code — and half-building that is worse than not building it.

**"What would you build next?"**
> Join a real inventory ledger, to fix the censoring. Then temporal reconciliation so the three
> grains are coherent. Then the stress-test harness.

---

# PART 6 · Fact sheet

Keep this visible while presenting.

| | |
|---|---|
| Ensemble MASE | **0.907** vs SeasonalNaive **1.117** — 18.8% better |
| Selection vs combination | 0.968 vs **0.907**, oracle bound 0.843 |
| Calibration | 80% nominal → **92.2%** raw → **82.0%** corrected, n=256 |
| Business case | **67.9% / 64.3% / 75.5%** lower cost across three quarters |
| Worst series | **R06 at 1.646** (benchmark 1.880) |
| Weakest win | **M01AE 1.000** vs 1.019 — effectively a tie |
| Protection interval | lead time 4 + review 7 = **11 days** |
| Backtest runtime | **43 s**, 292 series-model-folds, one CPU |
| Nightly batch | ~3 min → **7,056** quantile rows |
| Tests | **138** — unit, property, contract, concurrency |
| Dataset | 2,106 days · 8 series · `sha256:49e4f1c5c3da` |
| Closures | **26**, 21 mapped to the Serbian Orthodox calendar |
| Endpoints / screens | 16 / 7 |
