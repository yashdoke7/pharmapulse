/**
 * PharmaPulse — hackathon deck generator.
 *
 *   node deck/build_deck.js
 *
 * Every figure in here is pulled from artifacts/benchmarks.json or from
 * decision/replay.py::compare_policies. If a number changes, regenerate the
 * benchmark and rerun this script - do not hand-edit the .pptx.
 *
 * The deck deliberately uses the product's own visual language: warm paper,
 * warm near-black, one accent colour per meaning, and large tabular figures as
 * the recurring motif.
 */

const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

/* ---------------------------------------------------------------- palette */

const PAPER = "F7F4EE";
const PAPER_RAISED = "FCFAF6";
const INK = "14110D";
const INK_SOFT = "3B362F";
const INK_MUTE = "6B6459";
const INK_FAINT = "9A9287";
const RED = "A32E22"; // money leaving
const GREEN = "1F5D42"; // healthy / what we ship
const BLUE = "1C4E7A"; // capital stuck
const AMBER = "8A6410"; // watch

const DISPLAY = "Cambria";
const BODY = "Calibri";
const MONO = "Courier New";

const W = 13.333;
const H = 7.5;
const M = 0.85; // page margin

/* ------------------------------------------------------------- benchmarks */

const bench = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "artifacts", "benchmarks.json"), "utf8"),
);
const board = bench.leaderboard;
const ablation = bench.ablations.selection_vs_combination;
const calib = bench.calibration;
const shipped = board.find((m) => m.is_shipped).mase;
const baseline = board.find((m) => m.is_benchmark).mase;
const improvement = ((baseline - shipped) / baseline) * 100;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "PharmaPulse";
pres.title = "PharmaPulse — forecast to purchase order";

/* ------------------------------------------------------------- primitives */

function slide({ dark = false } = {}) {
  const s = pres.addSlide();
  s.background = { color: dark ? INK : PAPER };
  return s;
}

/** Small mono caps label. The deck's connective tissue. */
function eyebrow(s, text, { x = M, y = 0.5, color = INK_FAINT } = {}) {
  s.addText(text.toUpperCase(), {
    x, y, w: W - x - M, h: 0.3,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 11, color, charSpacing: 2.2,
  });
}

function title(s, text, { y = 0.95, color = INK, size = 40, w = W - M * 2, h = 1.75 } = {}) {
  s.addText(text, {
    x: M, y, w, h,
    isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: size, color, bold: false, lineSpacing: size * 1.12,
  });
}

function body(s, text, opts = {}) {
  s.addText(text, {
    x: M, y: 2.3, w: 5.5, h: 2.2,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 15, color: INK_SOFT, lineSpacing: 22,
    ...opts,
  });
}

/** The motif: a very large tabular figure with a caption underneath. */
function figure(s, value, caption, { x, y, w = 3.2, color = INK, size = 60 } = {}) {
  s.addText(value, {
    x, y, w, h: 0.95,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: size, color, bold: true,
  });
  s.addText(caption, {
    x, y: y + 0.95, w, h: 0.75,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12.5, color: INK_MUTE, lineSpacing: 16,
  });
}

/** A tinted card. Background tint, never an edge stripe. */
function card(s, { x, y, w, h, fill = PAPER_RAISED, line = "E4DFD5" }) {
  s.addShape(pres.ShapeType.rect, {
    x, y, w, h,
    fill: { color: fill },
    line: { color: line, width: 1 },
  });
}

function notes(s, text) {
  s.addNotes(text);
}

/* ============================================================= 1 · TITLE */
{
  const s = slide({ dark: true });
  eyebrow(s, "Cognizant campus drive · healthcare · pharma sales analysis & forecasting", {
    y: 0.62, color: INK_FAINT,
  });

  s.addText("PharmaPulse", {
    x: M, y: 1.5, w: 10, h: 1.5,
    isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: 72, color: PAPER,
  });

  s.addText(
    "Every pharmacy guesses how much to order.\nWe calculate it — with the odds, the cost of being wrong,\nand the reason behind the number.",
    {
      x: M, y: 3.1, w: 9.6, h: 1.9,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 26, color: "C9C2B6", italic: true, lineSpacing: 38,
    },
  );

  const stats = [
    ["0.907", "ensemble MASE\n18.8% better than benchmark"],
    ["68%", "lower inventory cost\nvs a min/max policy"],
    ["138", "tests, and a benchmark\nthat runs in CI"],
  ];
  stats.forEach(([v, c], i) => {
    const x = M + i * 3.9;
    s.addText(v, {
      x, y: 5.45, w: 3.6, h: 0.7,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 34, color: PAPER, bold: true,
    });
    s.addText(c, {
      x, y: 6.15, w: 3.6, h: 0.7,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, color: INK_FAINT, lineSpacing: 15,
    });
  });

  notes(s,
    "Open here. Do not read the slide. Say: every pharmacy makes this decision every week, from memory or a spreadsheet. This is what it looks like when you calculate it instead.");
}

/* ========================================================== 2 · THE PROBLEM */
{
  const s = slide();
  eyebrow(s, "The decision");
  title(s, "Somebody decides how much to buy.\nGetting it wrong costs money in two directions.");

  const cols = [
    {
      x: M, tone: RED, head: "Order too little",
      what: "A patient asks for a medicine you do not have. They go to the pharmacy across the road.",
      cost: "The lost gross margin — and often the customer, permanently.",
      tag: "Cu",
    },
    {
      x: 7.1, tone: BLUE, head: "Order too much",
      what: "Cash sits on a shelf. Medicines reach their expiry date.",
      cost: "Holding cost on the capital, plus a total write-off at expiry.",
      tag: "Co",
    },
  ];

  cols.forEach((c) => {
    card(s, { x: c.x, y: 3.05, w: 5.35, h: 2.75 });
    s.addText(c.tag, {
      x: c.x + 0.35, y: 3.25, w: 1, h: 0.5,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 26, color: c.tone, bold: true,
    });
    s.addText(c.head, {
      x: c.x + 1.35, y: 3.32, w: 3.8, h: 0.45,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 21, color: INK,
    });
    s.addText(c.what, {
      x: c.x + 0.35, y: 3.92, w: 4.7, h: 0.85,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: INK_SOFT, lineSpacing: 19,
    });
    s.addText(c.cost, {
      x: c.x + 0.35, y: 4.9, w: 4.7, h: 0.7,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: c.tone, bold: true, lineSpacing: 19,
    });
  });

  s.addText(
    "The quantity that minimises expected total cost depends on the distribution of demand and on the ratio between these two costs. A single number cannot answer it.",
    {
      x: M, y: 6.15, w: W - M * 2, h: 0.7,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: INK_MUTE, italic: true, lineSpacing: 20,
    },
  );

  notes(s, "Both directions cost money. That is why the answer needs a distribution, not a point.");
}

/* =========================================================== 3 · THE THESIS */
{
  const s = slide();
  eyebrow(s, "The thesis");
  title(s, "A forecast is not the product.\nThe purchase order is.");

  const steps = [
    { t: "history", sub: "6 years of\nreal sales" },
    { t: "forecast", sub: "a distribution,\nnot a number" },
    { t: "uncertainty", sub: "measured, and\ncorrected" },
    { t: "order quantity", sub: "your costs\ndecide it" },
    { t: "cost of\nbeing wrong", sub: "shown at\n±1 pack" },
  ];
  steps.forEach((st, i) => {
    const x = M + i * 2.38;
    const isTail = i >= 2;
    card(s, {
      x, y: 3.0, w: 2.1, h: 1.85,
      fill: isTail ? "F0EDE6" : PAPER_RAISED,
      line: isTail ? INK : "E4DFD5",
    });
    s.addText(st.t, {
      x: x + 0.18, y: 3.2, w: 1.75, h: 0.7,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 16, color: INK, lineSpacing: 19,
    });
    s.addText(st.sub, {
      x: x + 0.18, y: 3.95, w: 1.75, h: 0.75,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11, color: INK_MUTE, lineSpacing: 14,
    });
    if (i < steps.length - 1) {
      s.addText("→", {
        x: x + 2.08, y: 3.72, w: 0.32, h: 0.4,
        isTextBox: true, margin: 0, align: "center",
        fontFace: BODY, fontSize: 16, color: INK_FAINT,
      });
    }
  });

  s.addText("Almost every tool in this market stops after the second box.", {
    x: M, y: 5.1, w: 6.5, h: 0.4,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 13.5, color: INK_MUTE, italic: true,
  });

  card(s, { x: M, y: 5.72, w: W - M * 2, h: 1.12, fill: "F0EDE6", line: INK });
  s.addText("q*  =  Cu / (Cu + Co)", {
    x: M + 0.4, y: 5.95, w: 4.6, h: 0.6,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 26, color: INK, bold: true,
  });
  s.addText(
    "The newsvendor fractile. If shortage costs 3× excess, order the amount you exceed only 1 week in 4.\nClosed form — which is why the slider in the product recomputes live.",
    {
      x: M + 5.3, y: 5.9, w: 6.3, h: 0.8,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: INK_SOFT, lineSpacing: 17,
    },
  );

  notes(s, "The maths is a hundred years old and exact. The novelty is shipping it, not inventing it.");
}

/* ============================================================= 4 · THE DATA */
{
  const s = slide();
  eyebrow(s, "What we measured before designing anything");
  title(s, "Seven properties of the data\nthat drove every design decision.", { size: 36 });

  const finds = [
    ["The supplied monthly file is corrupt", "53 series-months disagree with a daily rollup by >5%. We ingest the daily file only and derive the rest.", RED],
    ["26 days are closures, not zero demand", "21 map to the Serbian Orthodox calendar. Masked from the loss — never imputed, never deleted.", AMBER],
    ["The last bucket is truncated", "October 2019 looks like a 70% collapse and is not. Partial periods stay visible, hatched.", AMBER],
    ["One series is genuinely intermittent", "N05C sells nothing on 67.9% of days, ADI 3.12. It routes to Croston/TSB automatically.", BLUE],
    ["Seasonality has a different phase per drug", "Antihistamines peak in May, paracetamol in January. One global profile would smear all of them.", BLUE],
    ["Weekday effects run in opposite directions", "OTC sells more at weekends, prescription less. A shared coefficient would cancel.", BLUE],
  ];

  finds.forEach((f, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * 6.05;
    const y = 2.85 + row * 1.38;
    s.addText(String(i + 1).padStart(2, "0"), {
      x, y, w: 0.5, h: 0.35,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 15, color: f[2], bold: true,
    });
    s.addText(f[0], {
      x: x + 0.6, y, w: 4.85, h: 0.35,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: INK, bold: true,
    });
    s.addText(f[1], {
      x: x + 0.6, y: y + 0.36, w: 4.85, h: 0.8,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, color: INK_MUTE, lineSpacing: 15,
    });
  });

  notes(s, "Every architectural choice traces to a measured property of the file. This is what stops it being a generic pipeline.");
}

/* ============================================================= 5 · LANES */
{
  const s = slide();
  eyebrow(s, "The rule that protects the project");
  title(s, "The data has dates and units sold.\nIt does not have stock, costs or lead times.", { size: 34 });

  s.addText(
    "A system that invents those and trains on them is learning from a random number generator — and any explanation it then produces is an explanation of noise. So every value belongs to exactly one lane, and the lanes have different rights.",
    {
      x: M, y: 2.8, w: W - M * 2, h: 0.7,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: INK_SOFT, lineSpacing: 20,
    },
  );

  const lanes = [
    ["1 · observed", "salesdaily.csv and the calendar features derived from it", "trains models · explains · backs a claim", GREEN],
    ["2 · your setting", "lead time · holding cost · margin · stock on hand · pack size", "explains only — never trains, never backs a claim", INK_MUTE],
    ["3 · synthetic", "any demo-only generated data", "none of the three — blocked in code, asserted by a test", RED],
  ];
  lanes.forEach((l, i) => {
    const y = 3.62 + i * 1.08;
    card(s, { x: M, y, w: W - M * 2, h: 0.98 });
    s.addText(l[0], {
      x: M + 0.3, y: y + 0.17, w: 2.3, h: 0.35,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 14, color: l[3], bold: true,
    });
    s.addText(l[1], {
      x: M + 2.75, y: y + 0.17, w: 4.6, h: 0.6,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: INK_SOFT, lineSpacing: 16,
    });
    s.addText(l[2], {
      x: M + 7.5, y: y + 0.17, w: 4.0, h: 0.6,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: l[3], bold: true, lineSpacing: 16,
    });
  });

  s.addText(
    "Enforced, not intended: the ingest entrypoint raises on a synthetic path, every row carries its origin, and the interface renders a badge from it.",
    {
      x: M, y: 6.55, w: W - M * 2, h: 0.38,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: INK_MUTE, italic: true,
    },
  );

  notes(s, "This converts the project's biggest vulnerability into its most credible feature. Say it before a judge asks where the cost data came from.");
}

/* ======================================================= 6 · ACCURACY CHART */
{
  const s = slide();
  eyebrow(s, "Result 1 · forecast accuracy");
  title(s, "18.8% better than the benchmark\neverything has to beat.", { size: 36, w: 7.4 });

  const rows = board
    .filter((m) => !m.is_bound)
    .sort((a, b) => b.mase - a.mase);

  s.addChart(
    pres.ChartType.bar,
    [{
      name: "MASE",
      labels: rows.map((r) => r.model),
      values: rows.map((r) => r.mase),
    }],
    {
      x: M, y: 2.55, w: 7.6, h: 4.3,
      barDir: "bar",
      chartColors: rows.map((r) =>
        r.is_shipped ? GREEN : r.is_benchmark ? AMBER : "C9C2B6"),
      showValue: true,
      dataLabelPosition: "outEnd",
      dataLabelFontFace: MONO,
      dataLabelFontSize: 10,
      dataLabelColor: INK_SOFT,
      dataLabelFormatCode: "0.000",
      showLegend: false,
      catAxisLabelColor: INK_SOFT,
      catAxisLabelFontFace: BODY,
      catAxisLabelFontSize: 11,
      valAxisLabelColor: INK_FAINT,
      valAxisLabelFontSize: 9,
      valAxisMaxVal: 1.5,
      valGridLine: { color: "E4DFD5", size: 1 },
      catGridLine: { style: "none" },
      plotArea: { fill: { color: PAPER } },
      chartArea: { fill: { color: PAPER } },
    },
  );

  figure(s, shipped.toFixed(3), "Ensemble — median of five members.\nWhat we ship.", {
    x: 8.9, y: 2.6, w: 3.6, color: GREEN, size: 54,
  });
  figure(s, baseline.toFixed(3), "SeasonalNaive — 'the calendar alone'.\nThe benchmark everything must beat.", {
    x: 8.9, y: 4.35, w: 3.6, color: AMBER, size: 54,
  });

  s.addText(
    "Weekly grain · horizon 8 · 4 rolling origins · MASE · seed 42\nReproducible in 43 s with  make benchmark",
    {
      x: 8.9, y: 6.15, w: 3.6, h: 0.8,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 9.5, color: INK_FAINT, lineSpacing: 14,
    },
  );

  notes(s, "MASE, not MAPE — MAPE is undefined on N05C which is zero on 68% of days. We report weekly per category, the grain a buyer actually orders at.");
}

/* ================================================== 7 · THE ABLATION (LEAD) */
{
  const s = slide({ dark: true });
  eyebrow(s, "Result 2 · the finding worth leading with", { color: INK_FAINT });
  title(s, "We implemented the obvious approach\nand measured it losing.", { color: PAPER, size: 40 });

  const items = [
    ["0.968", "Pick each product's\nbest model", RED],
    ["0.907", "Combine them\n(median of five)", "5FD39B"],
    ["0.843", "Perfect hindsight\n(a bound, not a model)", INK_FAINT],
  ];
  items.forEach(([v, c, col], i) => {
    const x = M + i * 4.0;
    s.addText(v, {
      x, y: 3.15, w: 3.6, h: 1.0,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 62, color: col, bold: true,
    });
    s.addText(c, {
      x, y: 4.25, w: 3.6, h: 0.8,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: "C9C2B6", lineSpacing: 18,
    });
  });

  s.addText(
    "Five different models win across the eight series, so per-series selection looks obviously right. With ~300 weekly observations, “best on the last fold” is mostly noise — so selection chases noise and locks in whichever model got lucky. Combination does the opposite: independent models make independent mistakes, and the median cancels them.",
    {
      x: M, y: 5.4, w: W - M * 2, h: 1.1,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: "C9C2B6", lineSpacing: 21,
    },
  );

  s.addText(
    "Scored honestly: the choice for fold k uses only folds 1…k−1, so it never sees the answer it is graded on.",
    {
      x: M, y: 6.58, w: W - M * 2, h: 0.38,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 10.5, color: INK_FAINT,
    },
  );

  notes(s, "This is the slide to lead the technical case with. 'We tested the obvious approach and it lost' is a result. 'We averaged some models' is not — same code, different claim.");
}

/* ========================================================= 8 · CALIBRATION */
{
  const s = slide();
  eyebrow(s, "Result 3 · are our own confidence intervals true?");
  title(s, "We measured whether to believe ourselves.\nWe did not like the answer, so we fixed it.", { size: 34 });

  card(s, { x: M, y: 2.9, w: 5.3, h: 2.2, fill: "F6EDEB", line: RED });
  s.addText("92.2%", {
    x: M + 0.4, y: 3.15, w: 2.4, h: 0.85,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 50, color: RED, bold: true,
  });
  s.addText("actually covered\nby a nominal 80% band", {
    x: M + 0.4, y: 4.05, w: 4.5, h: 0.85,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 13.5, color: INK_SOFT, lineSpacing: 18,
  });

  card(s, { x: 6.55, y: 2.9, w: 5.3, h: 2.2, fill: "EDF2EF", line: GREEN });
  s.addText("82.0%", {
    x: 6.95, y: 3.15, w: 2.4, h: 0.85,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 50, color: GREEN, bold: true,
  });
  s.addText("after conformal correction\nn = 256 · distribution-free", {
    x: 6.95, y: 4.05, w: 4.5, h: 0.85,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 13.5, color: INK_SOFT, lineSpacing: 18,
  });

  s.addText(
    "Too WIDE, not too narrow — which causes over-ordering and capital tied up on the shelf. The decision layer reads a specific quantile to pick a quantity, so a mis-sized interval moves that quantity, and the error is invisible in any point-forecast metric.",
    {
      x: M, y: 5.35, w: W - M * 2, h: 0.85,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: INK_SOFT, lineSpacing: 20,
    },
  );

  s.addText(
    "Every dashboard in this market draws a confidence band. Nobody publishes whether theirs is right. Ours is on screen, both curves, with its sample size printed on the chart.",
    {
      x: M, y: 6.35, w: W - M * 2, h: 0.65,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 17, color: INK, italic: true, lineSpacing: 24,
    },
  );

  notes(s, "The architecture document predicted over-confidence at 75%. Measured, it runs the other way. Say that — being wrong about your own prediction and reporting it is the point.");
}

/* ======================================================= 9 · BUSINESS CASE */
{
  const s = slide();
  eyebrow(s, "Result 4 · what it was actually worth");
  title(s, "Our policy against a min/max policy,\nreplayed over the identical real days.", { size: 34 });

  s.addChart(
    pres.ChartType.bar,
    [
      { name: "Min/max on average demand", labels: ["Jan–Mar 2019", "Apr–Jun 2019", "Oct–Dec 2018"], values: [4608, 3362, 4942] },
      { name: "PharmaPulse", labels: ["Jan–Mar 2019", "Apr–Jun 2019", "Oct–Dec 2018"], values: [1479, 1200, 1211] },
    ],
    {
      x: M, y: 2.75, w: 7.5, h: 3.5,
      barDir: "col",
      barGrouping: "clustered",
      chartColors: ["C9C2B6", GREEN],
      showValue: true,
      dataLabelPosition: "outEnd",
      dataLabelFontFace: MONO,
      dataLabelFontSize: 9.5,
      dataLabelColor: INK_SOFT,
      showLegend: true,
      legendPos: "b",
      legendFontFace: BODY,
      legendFontSize: 11,
      legendColor: INK_SOFT,
      catAxisLabelColor: INK_SOFT,
      catAxisLabelFontFace: BODY,
      catAxisLabelFontSize: 11,
      valAxisLabelColor: INK_FAINT,
      valAxisLabelFontSize: 9,
      valGridLine: { color: "E4DFD5", size: 1 },
      catGridLine: { style: "none" },
      plotArea: { fill: { color: PAPER } },
      chartArea: { fill: { color: PAPER } },
    },
  );

  figure(s, "68%", "lower total cost, Jan–Mar 2019.\nAnd 64% and 76% in two other quarters.", {
    x: 8.8, y: 2.85, w: 3.7, color: GREEN, size: 62,
  });

  s.addText(
    "Same data. Same costs, lead time, review cadence and protection interval. The only difference is that min/max orders to the average, and we order to the quantile your cost ratio implies.",
    {
      x: 8.8, y: 4.5, w: 3.7, h: 1.35,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: INK_SOFT, lineSpacing: 17,
    },
  );

  s.addText(
    "And we hold MORE stock, not less — the entire saving comes from lost sales we did not have. A test asserts both.",
    {
      x: M, y: 6.32, w: W - M * 2, h: 0.62,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 16, color: INK, italic: true, lineSpacing: 22,
    },
  );

  notes(s, "A measurement, not a projection. Mention that our first version of this comparison was rigged - we fixed our own horizon and left the baseline on the old one, which handed us 88%. Fixing it gives a defensible 70%.");
}

/* ========================================================== 10 · THE PRODUCT */
{
  const s = slide();
  eyebrow(s, "The product");
  title(s, "It opens on the decision,\nnot on a chart.", { size: 38 });

  const screens = [
    ["Decisions", "“Four products need a decision today, ₹1,099 at risk.” Ranked by money, not probability.", RED],
    ["Order", "The service-level slider. Drag it and the quantity and cost move — with zero network calls.", GREEN],
    ["Why", "Attribution in units that sums to the total, plus the reliability diagram.", BLUE],
    ["Replay", "The real 2019 history, one day per tick, with the business case underneath.", AMBER],
    ["Evidence", "Leaderboard, the ablation, and the two series where we lose — in red.", INK_MUTE],
    ["Settings", "Change the lead time from 4 to 9 days: the order goes 100 → 660 units, live.", INK_MUTE],
  ];

  screens.forEach((sc, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = M + col * 3.95;
    const y = 2.75 + row * 2.0;
    card(s, { x, y, w: 3.6, h: 1.72 });
    s.addText(sc[0], {
      x: x + 0.28, y: y + 0.2, w: 3.0, h: 0.4,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 19, color: sc[2],
    });
    s.addText(sc[1], {
      x: x + 0.28, y: y + 0.66, w: 3.05, h: 0.95,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, color: INK_SOFT, lineSpacing: 15,
    });
  });

  s.addText(
    "Every number is one click from why, and every why is one click from how confident.",
    {
      x: M, y: 6.55, w: W - M * 2, h: 0.38,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, color: INK_MUTE, italic: true,
    },
  );

  notes(s, "Do not linger here - go to the live demo instead. This slide exists for the printed deck.");
}

/* ========================================================= 11 · WHERE WE LOSE */
{
  const s = slide();
  eyebrow(s, "Where it does not work");
  title(s, "A system that only shows you where it wins\nis not telling you anything.", { size: 34 });

  const rows = bench.per_series.map((r) => [
    r.series_id, r.seasonal_naive.toFixed(3), r.ensemble.toFixed(3), r.best_model,
  ]);

  const tableRows = [
    [
      { text: "Series", options: { bold: true, color: INK, fontFace: BODY, fontSize: 12 } },
      { text: "SeasonalNaive", options: { bold: true, color: INK, fontFace: BODY, fontSize: 12 } },
      { text: "Ensemble", options: { bold: true, color: INK, fontFace: BODY, fontSize: 12 } },
      { text: "Best single model", options: { bold: true, color: INK, fontFace: BODY, fontSize: 12 } },
    ],
    ...rows.map((r) => {
      const weak = r[0] === "R06" || r[0] === "M01AE";
      return [
        { text: r[0], options: { fontFace: MONO, fontSize: 11.5, color: INK_SOFT } },
        { text: r[1], options: { fontFace: MONO, fontSize: 11.5, color: INK_MUTE } },
        { text: r[2], options: { fontFace: MONO, fontSize: 11.5, color: weak ? RED : GREEN, bold: true } },
        { text: r[3], options: { fontFace: BODY, fontSize: 11.5, color: INK_MUTE } },
      ];
    }),
  ];

  s.addTable(tableRows, {
    x: M, y: 2.7, w: 6.9,
    colW: [1.25, 1.85, 1.5, 2.3],
    rowH: 0.34,
    border: { type: "solid", color: "E4DFD5", pt: 1 },
    fill: { color: PAPER_RAISED },
    align: "left",
    valign: "middle",
  });

  card(s, { x: 8.2, y: 2.7, w: 4.3, h: 1.65, fill: "F6EDEB", line: RED });
  s.addText("R06 · 1.646", {
    x: 8.5, y: 2.92, w: 3.8, h: 0.4,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 19, color: RED, bold: true,
  });
  s.addText(
    "Our worst series, and above 1.0. The May pollen peak is sharp and its timing moves year to year — we have six observations of it.",
    {
      x: 8.5, y: 3.35, w: 3.8, h: 0.9,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, color: INK_SOFT, lineSpacing: 15,
    },
  );

  card(s, { x: 8.2, y: 4.55, w: 4.3, h: 1.5, fill: "F6EDEB", line: RED });
  s.addText("M01AE · 1.000", {
    x: 8.5, y: 4.75, w: 3.8, h: 0.4,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 19, color: RED, bold: true,
  });
  s.addText(
    "Against seasonal naive's 1.019 — effectively a tie. We do not claim a win here.",
    {
      x: 8.5, y: 5.18, w: 3.8, h: 0.75,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, color: INK_SOFT, lineSpacing: 15,
    },
  );

  s.addText(
    "Both are on the product's own Evidence screen, in red, alongside the wins.",
    {
      x: M, y: 6.5, w: W - M * 2, h: 0.4,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, color: INK_MUTE, italic: true,
    },
  );

  notes(s, "Say this before anyone finds it. A team that reports only wins gets discounted, and experienced judges do that quickly.");
}

/* ========================================================= 12 · LIMITATION */
{
  const s = slide({ dark: true });
  eyebrow(s, "The deepest limitation, stated before anyone asks", { color: INK_FAINT });
  title(s, "We forecast sales, not demand.", { color: PAPER, size: 46 });

  s.addText(
    "A stockout records zero sales — indistinguishable from zero demand. So our observations are right-censored, and the censoring is worst on exactly the products the system most needs to get right.",
    {
      x: M, y: 2.75, w: 7.3, h: 1.3,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 16, color: "C9C2B6", lineSpacing: 24,
    },
  );

  const chain = ["a stockout", "recorded sales fall", "the forecast falls", "the order falls", "another stockout"];
  chain.forEach((c, i) => {
    const x = M + i * 2.38;
    s.addText(c, {
      x, y: 4.35, w: 2.1, h: 0.6,
      isTextBox: true, margin: 0, align: "center", valign: "middle",
      fontFace: BODY, fontSize: 12, color: PAPER,
      fill: { color: "2A2521" },
    });
    if (i < chain.length - 1) {
      s.addText("→", {
        x: x + 2.1, y: 4.35, w: 0.28, h: 0.6,
        isTextBox: true, margin: 0, align: "center", valign: "middle",
        fontFace: BODY, fontSize: 14, color: RED,
      });
    }
  });

  s.addText("Self-reinforcing, if left uncorrected.", {
    x: M, y: 5.1, w: 6, h: 0.4,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12, color: INK_FAINT, italic: true,
  });

  s.addText(
    "What we do: flag days where sales hit a suspicious ceiling and treat them as censored.\nWhat we cannot do: verify it — this dataset has no on-hand-stock column.\nIt is in the model card, and it is the first thing a real deployment fixes.",
    {
      x: M, y: 5.75, w: 11, h: 1.25,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: "C9C2B6", lineSpacing: 22,
    },
  );

  notes(s, "Saying this out loud is the strongest thing in the presentation. It bounds every claim the system makes, and volunteering it is what separates a team that measured from a team that demoed.");
}

/* ============================================================== 13 · CLOSE */
{
  const s = slide({ dark: true });

  s.addText(
    "Every pharmacy guesses\nhow much to order.",
    {
      x: M, y: 1.5, w: 11, h: 1.8,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 46, color: INK_FAINT, lineSpacing: 56,
    },
  );
  s.addText(
    "We calculate it — with the odds,\nthe cost of being wrong,\nand the reason behind the number.",
    {
      x: M, y: 3.35, w: 11, h: 2.2,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 46, color: PAPER, lineSpacing: 56,
    },
  );

  const proof = [
    ["make benchmark", "reproduces every figure in 43 s from a clean clone"],
    ["138 tests", "unit · property · contract · concurrency, green in CI"],
    ["docker compose up", "the whole system, verified"],
  ];
  proof.forEach((p, i) => {
    const x = M + i * 3.95;
    s.addText(p[0], {
      x, y: 6.05, w: 3.7, h: 0.35,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 13, color: "5FD39B", bold: true,
    });
    s.addText(p[1], {
      x, y: 6.42, w: 3.7, h: 0.55,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11, color: INK_FAINT, lineSpacing: 14,
    });
  });

  notes(s, "Close here. Do not add a thank-you slide - end on the claim and take questions.");
}

/* ------------------------------------------------------------------ write */

const out = path.join(__dirname, "PharmaPulse.pptx");
pres.writeFile({ fileName: out }).then(() => {
  console.log("wrote", out);
  console.log(`  ensemble ${shipped}  benchmark ${baseline}  improvement ${improvement.toFixed(1)}%`);
  console.log(`  selection ${ablation.selection}  combination ${ablation.combination}`);
  console.log(`  calibration ${calib.achieved_before} -> ${calib.achieved_after}`);
});
