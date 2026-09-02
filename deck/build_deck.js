/**
 * PharmaPulse — hackathon deck generator.
 *
 *   bash deck/shoot.sh        # refresh the product screenshots first
 *   node deck/build_deck.js
 *   python deck/qa_deck.py deck/PharmaPulse.pptx
 *
 * Every figure in here is pulled from artifacts/benchmarks.json or from
 * decision/replay.py::compare_policies. If a number changes, regenerate the
 * benchmark and rerun this script - do not hand-edit the .pptx.
 *
 * The deck uses the product's own visual language: warm paper, warm near-black,
 * one accent colour per meaning, and large tabular figures as the recurring
 * motif. Where a slide can show the running product instead of describing it,
 * it shows the running product - screenshots live in deck/img and are captured
 * by deck/shoot.sh against the live app.
 *
 * Slide order: what it is -> what was asked -> who uses it -> what they see
 * -> how it is built -> what it measures -> what it is worth -> where it
 * fails -> close.
 */

const pptxgen = require("pptxgenjs");
const fs = require("fs");
const path = require("path");

/* ---------------------------------------------------------------- palette */

const PAPER = "F7F4EE";
const PAPER_RAISED = "FCFAF6";
const PAPER_SUNK = "EFEBE2";
const INK = "14110D";
const INK_SOFT = "3B362F";
const INK_MUTE = "6B6459";
const INK_FAINT = "9A9287";
const RULE = "E4DFD5";
const RED = "A32E22"; // money leaving
const GREEN = "1F5D42"; // healthy / what we ship
const GREEN_LIT = "5FD39B"; // the same meaning, on a dark slide
const BLUE = "1C4E7A"; // capital stuck
const AMBER = "8A6410"; // watch

const DISPLAY = "Cambria";
const BODY = "Calibri";
const MONO = "Courier New";

const W = 13.333;
const M = 0.85; // page margin

const IMG = (name) => path.join(__dirname, "img", `${name}.png`);

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

/** The motif: a very large tabular figure with a caption underneath. */
function figure(s, value, cap, { x, y, w = 3.2, color = INK, size = 60, capColor = INK_MUTE } = {}) {
  s.addText(value, {
    x, y, w, h: 0.95,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: size, color, bold: true,
  });
  s.addText(cap, {
    x, y: y + 0.95, w, h: 0.9,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12.5, color: capColor, lineSpacing: 16,
  });
}

/** A tinted card. Background tint, never an edge stripe. */
function card(s, { x, y, w, h, fill = PAPER_RAISED, line = RULE }) {
  s.addShape(pres.ShapeType.rect, {
    x, y, w, h,
    fill: { color: fill },
    line: { color: line, width: 1 },
  });
}

/** A screenshot in a frame. The frame is what stops it reading as clip art. */
function shot(s, name, { x, y, w, h }) {
  s.addShape(pres.ShapeType.rect, {
    x: x - 0.05, y: y - 0.05, w: w + 0.1, h: h + 0.1,
    fill: { color: PAPER_SUNK }, line: { color: INK, width: 1.25 },
  });
  s.addImage({ path: IMG(name), x, y, w, h });
}

function caption(s, text, { x = M, y, w = W - M * 2, color = INK_MUTE, size = 12, h = 0.4 } = {}) {
  s.addText(text, {
    x, y, w, h,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: size, color, italic: true, lineSpacing: size * 1.35,
  });
}

function notes(s, text) {
  s.addNotes(text);
}

/* ================================================ 1 · USP + THE SOLUTION */
{
  const s = slide({ dark: true });
  eyebrow(s, "Cognizant campus drive · healthcare · pharma sales analysis & forecasting", {
    y: 0.55, color: INK_FAINT,
  });

  s.addText("PharmaPulse", {
    x: M, y: 1.2, w: 10, h: 1.3,
    isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: 64, color: PAPER,
  });

  s.addText(
    "Every pharmacy guesses how much to order.\nWe calculate it — with the odds, the cost of being wrong,\nand the reason behind the number.",
    {
      x: M, y: 2.55, w: 9.6, h: 1.5,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 23, color: "C9C2B6", italic: true, lineSpacing: 32,
    },
  );

  s.addText("THE PROPOSED SOLUTION", {
    x: M, y: 4.25, w: 6, h: 0.3,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 10.5, color: INK_MUTE, charSpacing: 2.2,
  });

  const chain = [
    "six years\nof real sales",
    "a demand\ndistribution",
    "intervals we\nchecked and fixed",
    "a purchase order,\nin packs",
  ];
  chain.forEach((c, i) => {
    const x = M + i * 2.15;
    s.addText(c, {
      x, y: 4.62, w: 1.85, h: 0.72,
      isTextBox: true, margin: 0, align: "center", valign: "middle",
      fontFace: BODY, fontSize: 10.5, color: i === 3 ? INK : PAPER, lineSpacing: 14,
      fill: { color: i === 3 ? GREEN_LIT : "2A2521" },
    });
    if (i < chain.length - 1) {
      s.addText("→", {
        x: x + 1.85, y: 4.62, w: 0.3, h: 0.72,
        isTextBox: true, margin: 0, align: "center", valign: "middle",
        fontFace: BODY, fontSize: 14, color: GREEN_LIT,
      });
    }
  });

  s.addText("Almost every tool in this\nmarket stops after box two.", {
    x: 9.35, y: 4.62, w: 3.15, h: 0.72,
    isTextBox: true, margin: 0, valign: "middle",
    fontFace: BODY, fontSize: 11.5, color: INK_FAINT, italic: true, lineSpacing: 15,
  });

  const stats = [
    [shipped.toFixed(3), "ensemble MASE\n" + improvement.toFixed(1) + "% better than the benchmark"],
    ["69.5%", "lower inventory cost than a\nmin/max policy, replayed on real days"],
    ["138", "tests, and a benchmark that\nreruns from a clean clone in CI"],
  ];
  stats.forEach(([v, c], i) => {
    const x = M + i * 3.9;
    s.addText(v, {
      x, y: 5.75, w: 3.6, h: 0.68,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 32, color: PAPER, bold: true,
    });
    s.addText(c, {
      x, y: 6.42, w: 3.6, h: 0.56,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11, color: INK_FAINT, lineSpacing: 14,
    });
  });

  notes(s,
    "Open here. Do not read the slide. Say: every pharmacy makes this decision every week, from memory or a spreadsheet - this is what it looks like when you calculate it instead. The USP is the last box in the chain.");
}

/* ==================================================== 2 · THE USE CASE */
{
  const s = slide();
  eyebrow(s, "Use case #14 · what was asked");
  title(s, "Analyse pharmaceutical sales.\nForecast future demand.", { size: 38 });

  card(s, { x: M, y: 2.75, w: 5.6, h: 3.4 });
  s.addText("THE BRIEF", {
    x: M + 0.32, y: 2.97, w: 4.9, h: 0.28,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 10.5, color: INK_FAINT, charSpacing: 2,
  });
  s.addText(
    "Analyse historical pharmaceutical sales, identify demand patterns and seasonality, and forecast future sales so that inventory can be planned.",
    {
      x: M + 0.32, y: 3.32, w: 4.95, h: 1.0,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: INK_SOFT, lineSpacing: 20,
    },
  );
  s.addText("HOW WE READ IT", {
    x: M + 0.32, y: 4.45, w: 4.9, h: 0.28,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 10.5, color: INK_FAINT, charSpacing: 2,
  });
  s.addText(
    "“So that inventory can be planned” is the actual deliverable. A forecast nobody can act on is a chart. We took the brief to its end — the purchase order.",
    {
      x: M + 0.32, y: 4.8, w: 4.95, h: 1.15,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: INK, lineSpacing: 20,
    },
  );

  card(s, { x: 7.05, y: 2.75, w: 5.45, h: 3.4 });
  s.addText("THE DATA WE WERE GIVEN", {
    x: 7.37, y: 2.97, w: 4.8, h: 0.28,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 10.5, color: INK_FAINT, charSpacing: 2,
  });

  const facts = [
    ["2,106", "days · 1 Jan 2014 to 8 Oct 2019"],
    ["8", "ATC drug categories, sold in fractional units"],
    ["3", "grains — daily, weekly, monthly"],
    ["0", "columns for stock, price, promotion or cost"],
  ];
  facts.forEach((f, i) => {
    const y = 3.42 + i * 0.66;
    s.addText(f[0], {
      x: 7.37, y, w: 1.25, h: 0.42,
      isTextBox: true, margin: 0, align: "right",
      fontFace: MONO, fontSize: 20, color: i === 3 ? RED : INK, bold: true,
    });
    s.addText(f[1], {
      x: 8.75, y: y + 0.07, w: 3.5, h: 0.5,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: INK_MUTE, lineSpacing: 16,
    });
  });

  caption(s, "Kaggle · Pharma Sales Data (milanzdravkovic) — a real pharmacy's point-of-sale export. That last row is the constraint the whole architecture is built around.", { y: 6.35 });

  notes(s, "Point at the zero. Everything a judge will ask - where did the cost data come from, how do you know the stock level - traces back to that row, and the lanes slide is the answer.");
}

/* =============================================== 3 · THE DECISION + THESIS */
{
  const s = slide();
  eyebrow(s, "The decision underneath the forecast");
  title(s, "Getting it wrong costs money in two directions at once.", { size: 30, h: 0.85 });

  const cols = [
    {
      x: M, tone: RED, head: "Order too little", tag: "Cu",
      what: "A patient asks for a medicine you do not have. They go to the pharmacy across the road.",
      cost: "The lost gross margin — and often the customer, permanently.",
      how: "In our settings: the unit margin.",
    },
    {
      x: 7.05, tone: BLUE, head: "Order too much", tag: "Co",
      what: "Cash sits on a shelf. Medicines reach their expiry date and are thrown away.",
      cost: "Holding cost on the capital, plus a total write-off at expiry.",
      how: "In our settings: 22% annual holding + 1.5% expiry risk.",
    },
  ];

  cols.forEach((c) => {
    card(s, { x: c.x, y: 1.95, w: 5.45, h: 2.05 });
    s.addText(c.tag, {
      x: c.x + 0.28, y: 2.1, w: 0.9, h: 0.45,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 24, color: c.tone, bold: true,
    });
    s.addText(c.head, {
      x: c.x + 1.2, y: 2.16, w: 4.0, h: 0.4,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 20, color: INK,
    });
    s.addText(c.what, {
      x: c.x + 0.28, y: 2.66, w: 4.9, h: 0.62,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: INK_SOFT, lineSpacing: 17,
    });
    s.addText(c.cost, {
      x: c.x + 0.28, y: 3.3, w: 4.9, h: 0.4,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: c.tone, bold: true, lineSpacing: 16,
    });
    s.addText(c.how, {
      x: c.x + 0.28, y: 3.68, w: 4.9, h: 0.26,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 9, color: INK_FAINT,
    });
  });

  /* ---- the formula */
  card(s, { x: M, y: 4.14, w: W - M * 2, h: 0.92, fill: PAPER_SUNK, line: INK });
  s.addText("q*  =  Cu / (Cu + Co)", {
    x: M + 0.35, y: 4.34, w: 4.4, h: 0.5,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 24, color: INK, bold: true,
  });
  s.addText(
    "The newsvendor fractile. A hundred years old, and exact — not an approximation and not a heuristic. If a shortage costs 3× an excess, order the quantity you exceed only one cycle in four. It is closed form, which is why the slider recomputes in the browser.",
    {
      x: M + 4.95, y: 4.24, w: 6.65, h: 0.76,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, color: INK_SOFT, lineSpacing: 15,
    },
  );

  /* ---- the worked example, end to end */
  s.addText("WORKED, ON PARACETAMOL — EXACTLY WHAT THE PRODUCT DOES ON THE NEXT SLIDE BUT ONE", {
    x: M, y: 5.25, w: W - M * 2, h: 0.26,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 9.5, color: INK_FAINT, charSpacing: 1.6,
  });

  const steps = [
    ["1", "YOUR COSTS", "margin lost if short,\nholding + expiry if long", INK_MUTE],
    ["2", "q* = 94.8%", "the fractile those two\ncosts imply", GREEN],
    ["3", "545 units", "the 94.8th percentile of\ndemand over 11 days", BLUE],
    ["4", "− 310 on hand", "the live shelf position,\nfrom the ledger", INK_MUTE],
    ["5", "240 units", "235 rounded up to 24\nwhole packs", RED],
  ];
  const sw = (W - M * 2 - 4 * 0.32) / 5;
  steps.forEach(([n, big, sub, tone], i) => {
    const x = M + i * (sw + 0.32);
    card(s, { x, y: 5.6, w: sw, h: 1.32 });
    s.addText(n, {
      x, y: 5.6, w: 0.28, h: 0.22,
      isTextBox: true, margin: 0, align: "center", valign: "middle",
      fontFace: MONO, fontSize: 8.5, color: PAPER, bold: true,
      fill: { color: tone },
    });
    s.addText(big, {
      x: x + 0.16, y: 5.86, w: sw - 0.32, h: 0.4,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 16, color: tone, bold: true,
    });
    s.addText(sub, {
      x: x + 0.16, y: 6.28, w: sw - 0.32, h: 0.58,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 10.5, color: INK_MUTE, lineSpacing: 13,
    });
    if (i < steps.length - 1) {
      s.addText("→", {
        x: x + sw, y: 6.0, w: 0.32, h: 0.3,
        isTextBox: true, margin: 0, align: "center",
        fontFace: BODY, fontSize: 13, color: INK_FAINT,
      });
    }
  });

  notes(s, "The maths is not the novelty - shipping it is. Walk the five boxes left to right; that is the entire product in one line. Note step 4: the shelf position is live, not a stored field, so accepting an order changes the next recommendation.");
}

/* ==================================================== 4 · THE END USERS */
{
  const s = slide();
  eyebrow(s, "Who this is for");
  title(s, "Three people open it, and each one\nopens a different screen.", { size: 34 });

  const users = [
    {
      who: "The purchasing buyer", when: "Monday morning · ten minutes",
      q: "What do I order this week?",
      need: "A quantity, in packs, with the money at risk if they ignore it. Not a chart.",
      screen: "Decisions → Order",
      tone: RED,
    },
    {
      who: "The pharmacy owner", when: "End of month",
      q: "Is my capital in the right stock?",
      need: "The cost of the current policy against the alternative, over real days, in rupees.",
      screen: "Replay → the business case",
      tone: BLUE,
    },
    {
      who: "Whoever signs it off", when: "Before it goes live",
      q: "Why should I trust this number?",
      need: "Attribution in units, calibration measured against outcomes, and the series where it loses.",
      screen: "Why → Evidence",
      tone: GREEN,
    },
  ];

  users.forEach((u, i) => {
    const x = M + i * 3.95;
    card(s, { x, y: 2.75, w: 3.6, h: 3.55 });
    s.addShape(pres.ShapeType.rect, {
      x, y: 2.75, w: 3.6, h: 0.055,
      fill: { color: u.tone }, line: { color: u.tone },
    });
    s.addText(u.who, {
      x: x + 0.28, y: 3.0, w: 3.05, h: 0.45,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 19, color: INK,
    });
    s.addText(u.when.toUpperCase(), {
      x: x + 0.28, y: 3.48, w: 3.05, h: 0.28,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 9, color: INK_FAINT, charSpacing: 1.4,
    });
    s.addText("“" + u.q + "”", {
      x: x + 0.28, y: 3.86, w: 3.05, h: 0.78,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 16, color: u.tone, italic: true, lineSpacing: 21,
    });
    s.addText(u.need, {
      x: x + 0.28, y: 4.72, w: 3.05, h: 1.05,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: INK_SOFT, lineSpacing: 16,
    });
    s.addText(u.screen, {
      x: x + 0.28, y: 5.85, w: 3.05, h: 0.3,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 11, color: INK_MUTE,
    });
  });

  caption(s, "Seven screens, but nobody has to visit all seven. The navigation is ordered the way the questions actually arrive: decide, order, forecast, why, replay, evidence, settings.", { y: 6.5 });

  notes(s, "Name the buyer first. The whole product is built for ten minutes on a Monday morning; the other two roles exist so that somebody will let the buyer use it.");
}

/* ============================================= 5 · THE PRODUCT · DECISIONS */
{
  const s = slide();
  eyebrow(s, "The product · what the buyer sees first");
  s.addText("It opens on the decision, not on a chart.", {
    x: M, y: 0.86, w: W - M * 2, h: 0.55,
    isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: 32, color: INK,
  });

  // 3000 x 1900 -> 1.579 ; 8.35in wide -> 5.29in tall
  shot(s, "dashboard_hero", { x: M, y: 1.6, w: 8.35, h: 5.29 });

  const points = [
    ["Ranked by money", "₹276 at 34% likely is ranked above ₹163 at 99%. Probability is not the ranking a buyer needs — exposure is.", RED],
    ["One click to the fix", "Every row links straight to the order that resolves it — there is no hunting.", GREEN],
    ["Live, not nightly", "Position = seeded opening stock + every ledger movement since. Accept an order and the shelf actually moves.", BLUE],
  ];
  points.forEach((p, i) => {
    const y = 1.72 + i * 1.68;
    s.addText(p[0], {
      x: 9.55, y, w: 2.95, h: 0.35,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: p[2], bold: true,
    });
    s.addText(p[1], {
      x: 9.55, y: y + 0.38, w: 2.95, h: 1.05,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: INK_MUTE, lineSpacing: 16,
    });
  });

  s.addText("live screenshot", {
    x: 9.55, y: 6.62, w: 2.95, h: 0.28,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 9.5, color: INK_FAINT, charSpacing: 1.4,
  });

  notes(s, "Do not narrate the screen. One sentence - it opens on what needs a decision, ranked by rupees - then move. The live demo is where this lands.");
}

/* ================================================ 6 · THE PRODUCT · ORDER */
{
  const s = slide();
  eyebrow(s, "The product · the screen the whole system exists for");
  s.addText("The slider is the cost ratio. Drag it, the order moves.", {
    x: M, y: 0.86, w: W - M * 2, h: 0.55,
    isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: 30, color: INK,
  });

  // 3000 x 2160 -> 1.389 ; 7.55in wide -> 5.44in tall
  shot(s, "orders", { x: M, y: 1.55, w: 7.47, h: 5.38 });

  const points = [
    ["The quantile, made physical", "Service level, stockout risk, cost this cycle and the distance from optimal — all recomputed as you drag.", GREEN],
    ["±1 pack, priced", "One pack fewer and one pack more, each with what it costs. That is a sensitivity a buyer can argue with.", INK_SOFT],
    ["The position is auditable", "Opening stock, then every receipt and sale, summing to the number on the shelf.", BLUE],
  ];
  points.forEach((p, i) => {
    const y = 1.72 + i * 1.72;
    s.addText(p[0], {
      x: 8.8, y, w: 3.7, h: 0.35,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: p[2], bold: true,
    });
    s.addText(p[1], {
      x: 8.8, y: y + 0.38, w: 3.7, h: 1.1,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: INK_MUTE, lineSpacing: 16,
    });
  });

  s.addText("zero network calls while dragging", {
    x: 8.8, y: 6.68, w: 3.7, h: 0.28,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 9.5, color: INK_FAINT, charSpacing: 1.4,
  });

  notes(s, "This is the demo moment. Drag from 80 to 95 and let them watch the quantity and the cost move together. Then say: that is the newsvendor formula from three slides ago, and nothing was fetched.");
}

/* ========================================== 7 · THE SEVEN SCREENS, IN FULL */
{
  const s = slide();
  eyebrow(s, "The product · all of it");
  s.addText("Seven screens, in the order the questions arrive.", {
    x: M, y: 0.82, w: W - M * 2, h: 0.5,
    isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: 27, color: INK,
  });

  // 3000 x 1875 -> 1.6
  const TW = 2.7725;
  const TH = TW / 1.6;

  const grid = [
    ["thumb_dashboard", "Decisions", "What needs my decision today?", RED],
    ["thumb_orders", "Order", "What do I actually buy?", GREEN],
    ["thumb_forecast", "Forecast", "What will sell, and how sure are we?", BLUE],
    ["thumb_why", "Why", "Where did that number come from?", BLUE],
    ["thumb_liveops", "Replay", "What would it have been worth?", AMBER],
    ["thumb_ops", "Evidence", "Prove the accuracy claims.", GREEN],
    ["thumb_settings", "Settings", "These are my shop's numbers.", INK_MUTE],
  ];

  grid.forEach(([img, name, q, tone], i) => {
    const top = i < 4;
    const col = top ? i : i - 4;
    const x = top ? M + col * (TW + 0.18) : 2.328 + col * (TW + 0.18);
    const y = top ? 1.5 : 3.95;

    shot(s, img, { x, y, w: TW, h: TH });
    s.addText(String(i + 1).padStart(2, "0") + "  " + name, {
      x, y: y + TH + 0.1, w: TW, h: 0.26,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: tone, bold: true,
    });
    s.addText(q, {
      x, y: y + TH + 0.34, w: TW, h: 0.4,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 10, color: INK_MUTE, lineSpacing: 13,
    });
  });

  caption(s, "Nobody has to visit all seven. A buyer lives in the first two; the other five exist so that somebody will let them.", { y: 6.45, h: 0.35 });

  notes(s, "One slide so the panel can see the whole surface at once. Do not talk through it - name the first two and move on, or go to the live demo.");
}

/* ======================================= 8 · THE COMPONENT MAP (as built) */
{
  const s = slide();
  eyebrow(s, "Architecture · every component, and where it lives", { y: 0.5 });
  s.addText("The system as built — not as designed.", {
    x: M, y: 0.77, w: W - M * 2, h: 0.38,
    isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: 25, color: INK,
  });

  const GX = 0.5;          // label gutter
  const GW = 1.52;
  const CX = 2.12;         // cards start
  const CW = 10.71;        // cards total width

  /** One numbered component card. */
  function comp(x, y, w, h, num, name, bullets, tone) {
    card(s, { x, y, w, h });
    s.addShape(pres.ShapeType.rect, {
      x, y, w: 0.34, h: 0.24,
      fill: { color: tone }, line: { color: tone },
    });
    s.addText(num, {
      x, y: y + 0.005, w: 0.34, h: 0.23,
      isTextBox: true, margin: 0, align: "center", valign: "middle",
      fontFace: MONO, fontSize: 8.5, color: PAPER, bold: true,
    });
    s.addText(name, {
      x: x + 0.42, y: y + 0.02, w: w - 0.5, h: 0.24,
      isTextBox: true, margin: 0, valign: "middle",
      fontFace: BODY, fontSize: 11, color: INK, bold: true,
    });
    s.addText(bullets.map((b) => "· " + b).join("\n"), {
      x: x + 0.09, y: y + 0.29, w: w - 0.18, h: h - 0.34,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 8.5, color: INK_MUTE, lineSpacing: 11,
    });
  }

  /** The layer label in the gutter. */
  function gutter(y, n, name, dir, tone) {
    s.addText("LAYER " + n, {
      x: GX, y: y + 0.02, w: GW, h: 0.22,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 8.5, color: INK_FAINT, charSpacing: 1.4,
    });
    s.addText(name, {
      x: GX, y: y + 0.24, w: GW, h: 0.3,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: tone, bold: true,
    });
    s.addText(dir, {
      x: GX, y: y + 0.55, w: GW, h: 0.22,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 9, color: INK_FAINT,
    });
  }

  function row(y, h, items, tone) {
    const gap = 0.1;
    const w = (CW - (items.length - 1) * gap) / items.length;
    items.forEach((it, i) => {
      comp(CX + i * (w + gap), y, w, h, it[0], it[1], it[2], tone);
    });
  }

  /* ---- Layer 1 */
  let y = 1.18;
  gutter(y, "1", "DATA", "pipelines/", INK_MUTE);
  row(y, 1.06, [
    ["1.1", "Ingester", ["daily file only", "append-only, idempotent", "SHA-256 snapshot id"]],
    ["1.2", "Validator", ["9 quality gates", "day/week/month must agree", "raises, never warns"]],
    ["1.3", "Cleaner", ["26 closure days masked", "outliers flagged, not cut", "partial periods flagged"]],
    ["1.4", "Feature Builder", ["lags and rolling means", "calendar and holidays", "truncate, then compute"]],
    ["1.5", "Gold Store", ["Parquet + DuckDB", "3 grains from the daily", "origin lane on every row"]],
  ], INK_MUTE);

  /* ---- Layer 2 */
  y = 2.42;
  gutter(y, "2", "FORECAST", "core/", GREEN);
  row(y, 1.06, [
    ["2.1", "Classifier", ["ADI / CV² quadrants", "recomputed per grain", "a rule, not a setting"]],
    ["2.2", "Portfolio", ["11 models, 5 shipped", "routed by demand class", "ARIMA LGBM MSTL", "Prophet Croston"]],
    ["2.3", "Combiner", ["median of five", "not best-of-five", "quantiles stay monotonic"]],
    ["2.4", "Calibrator", ["conformal, so assumes", "no residual shape", "92.2% → 82.0% coverage"]],
    ["2.5", "Forecast Store", ["versioned, immutable", "CURRENT written last", "so a read is never torn"]],
    ["2.6", "Attribution ◂", ["Prophet's components", "expressed in units", "parts must sum to whole"]],
  ], GREEN);

  /* ---- the batch / serve divider */
  s.addShape(pres.ShapeType.line, {
    x: CX, y: 3.62, w: CW, h: 0,
    line: { color: INK, width: 1.25, dashType: "dash" },
  });
  s.addText("ABOVE  runs offline, once, about 4 minutes          BELOW  runs per request, under a second", {
    x: CX, y: 3.64, w: CW, h: 0.24,
    isTextBox: true, margin: 0, align: "center",
    fontFace: MONO, fontSize: 8.5, color: INK_MUTE, charSpacing: 0.8,
  });

  /* ---- Layer 3 */
  y = 3.94;
  gutter(y, "3", "DECISION", "decision/", BLUE);
  row(y, 1.06, [
    ["3.1", "Order Calculator", ["newsvendor fractile, closed form", "protection interval = lead + review gap", "rounded up to whole packs"]],
    ["3.2", "Risk Detector", ["4 rules, read at the current position", "before any order is placed", "ranked by rupee exposure"]],
    ["3.3", "Stock Ledger", ["opening stock + every movement since", "hash-chained order log", "accepting an order moves the shelf"]],
    ["3.4", "Replay ◂", ["real 2019 days, one per tick", "serialised under a per-session lock", "carries a rival min/max policy"]],
  ], BLUE);

  /* ---- Layer 5 */
  y = 5.18;
  gutter(y, "5", "SERVICE", "api/", AMBER);
  card(s, { x: CX, y, w: CW, h: 0.66 });
  s.addText("FastAPI · 16 endpoints · one provenance envelope on every response · fixture fallback when the store is missing, so the app always runs", {
    x: CX + 0.12, y: y + 0.05, w: CW - 0.24, h: 0.3,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 9, color: INK,
  });
  s.addText("/forecast   /explain   /risk   /recommend   /orders   /ledger   /replay   /benchmarks   /series   /settings   /health   /metrics", {
    x: CX + 0.12, y: y + 0.36, w: CW - 0.24, h: 0.24,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 9.5, color: INK_MUTE,
  });

  /* ---- Layer 6 */
  y = 5.94;
  gutter(y, "6", "PRODUCT", "web/", RED);
  const screens = ["Decisions", "Order", "Forecast", "Why", "Replay", "Evidence", "Settings"];
  const sw = (CW - 6 * 0.08) / 7;
  screens.forEach((sc, i) => {
    s.addText(sc, {
      x: CX + i * (sw + 0.08), y: y + 0.06, w: sw, h: 0.38,
      isTextBox: true, margin: 0, align: "center", valign: "middle",
      fontFace: BODY, fontSize: 11, color: INK,
      fill: { color: PAPER_SUNK },
    });
  });

  s.addText(
    "◂ moved down a layer from the submitted design.   Removed and not built: the reconciler (2.5), the scenario engine, the assistant, the stress harness — and with attribution and replay moved down, LAYER 4 · INTELLIGENCE no longer exists as a layer. Redis became an in-process cache, Postgres became SQLite, MLflow became one JSON file the API can only read.",
    {
      x: CX, y: 6.55, w: CW, h: 0.44,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 9.5, color: INK_MUTE, lineSpacing: 12,
    },
  );

  notes(s, "The honest architecture slide. Every other team shows the design; this shows the build and names what is missing. Do not read the cards - point at the dashed line and say the split, then point at the footnote and say what was cut. Full delta is docs/ARCHITECTURE_DELTA.md.");
}

/* =========================================== 8 · BATCH / SERVE + THE STACK */
{
  const s = slide();
  eyebrow(s, "Architecture · the split that makes it fast");
  title(s, "No model runs inside a request.", { size: 36, h: 0.8 });

  s.addText(
    "Everything expensive happens in a batch that writes a versioned forecast store. Everything a screen does is a read. The two halves are joined by a single pointer file, written last — so a reader is never caught mid-publish.",
    {
      x: M, y: 2.35, w: 11.4, h: 0.6,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: INK_SOFT, lineSpacing: 20,
    },
  );

  const lanes = [
    {
      x: M, tone: GREEN, head: "BATCH · minutes, offline",
      steps: [
        "ingest 2,106 days, validate, derive grains",
        "fit 11 models across 3 grains",
        "combine by median, calibrate conformally",
        "write a new version, then swap CURRENT",
      ],
      foot: "python -m pipelines.run_nightly --stage all",
    },
    {
      x: 7.05, tone: BLUE, head: "SERVE · milliseconds, per request",
      steps: [
        "read the version CURRENT points at",
        "scale to the protection interval",
        "newsvendor fractile → order quantity",
        "wrap in the provenance envelope",
      ],
      foot: "uvicorn api.main:app --port 8000",
    },
  ];

  lanes.forEach((L) => {
    card(s, { x: L.x, y: 3.1, w: 5.45, h: 2.7 });
    s.addText(L.head, {
      x: L.x + 0.3, y: 3.3, w: 4.9, h: 0.3,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 11, color: L.tone, bold: true, charSpacing: 1.6,
    });
    L.steps.forEach((st, j) => {
      s.addText(String(j + 1), {
        x: L.x + 0.3, y: 3.75 + j * 0.42, w: 0.3, h: 0.3,
        isTextBox: true, margin: 0,
        fontFace: MONO, fontSize: 11, color: INK_FAINT,
      });
      s.addText(st, {
        x: L.x + 0.66, y: 3.75 + j * 0.42, w: 4.55, h: 0.3,
        isTextBox: true, margin: 0,
        fontFace: BODY, fontSize: 12.5, color: INK_SOFT,
      });
    });
    s.addText(L.foot, {
      x: L.x + 0.3, y: 5.44, w: 4.9, h: 0.28,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 10, color: INK_FAINT,
    });
  });

  s.addText("CURRENT", {
    x: 6.32, y: 4.25, w: 0.72, h: 0.4,
    isTextBox: true, margin: 0, align: "center", valign: "middle",
    fontFace: MONO, fontSize: 7.5, color: INK_MUTE,
  });

  const stack = [
    ["data", "pandas · DuckDB · Parquet · SQLite"],
    ["models", "statsforecast · mlforecast · LightGBM · Prophet"],
    ["service", "FastAPI · Pydantic v2"],
    ["product", "React 18 · TypeScript · Vite · Tailwind"],
    ["ship", "Docker Compose · GitHub Actions · ruff · pytest"],
  ];
  stack.forEach((t, i) => {
    const x = M + i * 2.34;
    s.addText(t[0].toUpperCase(), {
      x, y: 6.1, w: 2.2, h: 0.26,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 9.5, color: INK_FAINT, charSpacing: 1.6,
    });
    s.addText(t[1], {
      x, y: 6.38, w: 2.2, h: 0.58,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11, color: INK_SOFT, lineSpacing: 14,
    });
  });

  notes(s, "If a judge asks about latency or scale, this is the slide. The store is immutable per version and the pointer swap is atomic, so publishing during a live demo cannot corrupt a screen.");
}

/* ============================================================= 9 · THE DATA */
{
  const s = slide();
  eyebrow(s, "What we measured before designing anything");
  title(s, "Six properties of the file\nthat drove every design decision.", { size: 36 });

  const finds = [
    ["The supplied monthly file is corrupt", "53 series-months disagree with a daily rollup by more than 5%. We ingest the daily file only and derive the rest.", RED],
    ["26 days are closures, not zero demand", "21 map to the Serbian Orthodox calendar. Masked from the loss — never imputed, never deleted.", AMBER],
    ["The last bucket is truncated", "October 2019 looks like a 70% collapse and is not. Partial periods stay visible, and hatched.", AMBER],
    ["One series is genuinely intermittent", "N05C sells nothing on 67.9% of days, ADI 3.12. It routes to Croston/TSB automatically.", BLUE],
    ["Seasonality has a different phase per drug", "Antihistamines peak in May, paracetamol in January. One global profile would smear both.", BLUE],
    ["Weekday effects run in opposite directions", "OTC sells more at weekends, prescription less. A shared coefficient would cancel them out.", BLUE],
  ];

  finds.forEach((f, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = M + col * 6.05;
    const y = 2.82 + row * 1.32;
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
      x: x + 0.6, y: y + 0.36, w: 4.85, h: 0.74,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, color: INK_MUTE, lineSpacing: 15,
    });
  });

  caption(s, "Two of these contradict our own submitted design document. Both corrections are written down rather than quietly fixed.", { y: 6.62, h: 0.3 });

  notes(s, "Every architectural choice traces to a measured property of the file. This is what stops it being a generic pipeline with a pharma label on it.");
}

/* ============================================================ 10 · LANES */
{
  const s = slide();
  eyebrow(s, "The rule that protects the project");
  title(s, "The file has dates and units sold.\nIt has no stock, costs or lead times.", { size: 34 });

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

  caption(s, "Enforced, not intended: the ingest entrypoint raises on a synthetic path, every row carries its origin, the API returns it, and the interface renders a badge from it.", { y: 6.55 });

  notes(s, "This converts the project's biggest vulnerability into its most credible feature. Say it before a judge asks where the cost data came from.");
}

/* ================================== 11 · THE PORTFOLIO AND HOW IT IS ROUTED */
{
  const s = slide();
  eyebrow(s, "Inside the forecast engine");
  title(s, "Nothing is hardcoded to a product name.\nThe data decides which models it gets.", { size: 30, h: 1.3 });

  s.addText(
    "Two numbers describe how a medicine sells. ADI is the average gap between sales — irregular TIMING. CV² is how much the sale sizes vary — erratic SIZE. They put every product in one of four quadrants, and the quadrant chooses the models. It is recomputed every night, per grain, so when a product's behaviour changes its model family changes with it.",
    {
      x: M, y: 2.3, w: 6.6, h: 1.05,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: INK_SOFT, lineSpacing: 17,
    },
  );

  /* ---- the 2x2 */
  const QX = 1.6;
  const QY = 3.42;
  const QW = 2.65;
  const QH = 1.45;

  const quads = [
    // col, row (row 0 = top = high CV2)
    [0, 0, "ERRATIC", "steady timing,\nwild sizes", "LightGBM · MSTL\nSeasonalNaive · ARIMA", AMBER],
    [1, 0, "LUMPY", "irregular timing\nAND wild sizes", "Croston · LightGBM\nSeasonalNaive", RED],
    [0, 1, "SMOOTH", "sells most days,\nstable sizes", "Prophet · ARIMA · MSTL\nSeasonalNaive · LightGBM", GREEN],
    [1, 1, "INTERMITTENT", "long gaps between\nsales", "Croston · SeasonalNaive\nLightGBM", BLUE],
  ];

  quads.forEach(([c, r, name, what, models, tone]) => {
    const x = QX + c * (QW + 0.1);
    const y = QY + r * (QH + 0.1);
    card(s, { x, y, w: QW, h: QH });
    s.addShape(pres.ShapeType.rect, {
      x, y, w: QW, h: 0.045, fill: { color: tone }, line: { color: tone },
    });
    s.addText(name, {
      x: x + 0.14, y: y + 0.13, w: QW - 0.28, h: 0.26,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: tone, bold: true,
    });
    s.addText(what, {
      x: x + 0.14, y: y + 0.4, w: QW - 0.28, h: 0.42,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 10, color: INK_MUTE, lineSpacing: 13,
    });
    s.addText(models, {
      x: x + 0.14, y: y + 0.88, w: QW - 0.28, h: 0.45,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 8.5, color: INK, lineSpacing: 11,
    });
  });

  /* axes */
  s.addText("CV² ↑\nsale size\nvaries\n\ncut at\n0.49", {
    x: 0.52, y: QY, w: 1.0, h: 1.55,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 8, color: INK_FAINT, lineSpacing: 10,
  });
  s.addText("ADI  →  gaps between sales get longer          cut at 1.32", {
    x: QX, y: QY + 2 * QH + 0.14, w: QW * 2 + 0.1, h: 0.2,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 8.5, color: INK_FAINT,
  });

  /* ---- right column: what is in the portfolio */
  const RX = 7.6;
  s.addText("THE ELEVEN MODELS, BY FAMILY", {
    x: RX, y: 2.42, w: 4.9, h: 0.26,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 10, color: INK_FAINT, charSpacing: 1.8,
  });

  const families = [
    ["Baselines", "Naive · SeasonalNaive · WindowAverage", "SeasonalNaive is the one to beat, not a strawman", INK_MUTE],
    ["Statistical", "AutoARIMA · AutoETS · DynamicOptimizedTheta", "short-run autocorrelation, fitted per series", INK_MUTE],
    ["Decomposition", "MSTL", "pulls trend and multiple seasonalities apart", INK_MUTE],
    ["Intermittent", "CrostonOptimized · TSB", "models sale size and sale timing separately", BLUE],
    ["Machine learning", "LightGBM (global, quantile)", "one model across all series, learns shared shape", GREEN],
    ["Structural", "Prophet", "trend, yearly season, holidays — and it explains", GREEN],
  ];
  families.forEach(([fam, models, why, tone], i) => {
    const y = 2.76 + i * 0.66;
    s.addText(fam, {
      x: RX, y, w: 4.9, h: 0.24,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, color: tone === INK_MUTE ? INK : tone, bold: true,
    });
    s.addText(models, {
      x: RX, y: y + 0.22, w: 4.9, h: 0.22,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 9, color: INK_SOFT,
    });
    s.addText(why, {
      x: RX, y: y + 0.42, w: 4.9, h: 0.22,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 9.5, color: INK_MUTE,
    });
  });

  caption(s, "Five of the eleven make the shipped ensemble. At weekly grain all eight classify as smooth; at daily grain the sedatives route to Croston. Measured, not asserted.", { y: 6.72, h: 0.26, size: 10.5 });

  notes(s, "This is the slide for the question 'why so many models'. The answer is that they are not interchangeable - a Croston model exists because averaging methods return a flat fractional line on a series that is zero most days, which is useless to a buyer.");
}

/* ======================================================= 11 · ACCURACY */
{
  const s = slide();
  eyebrow(s, "Result 1 · forecast accuracy");
  title(s, improvement.toFixed(1) + "% better than the benchmark\neverything has to beat.", { size: 36, w: 7.4 });

  const shown = board.slice(0, 9);
  const worst = Math.max(...shown.map((m) => m.mase));
  const barW = 5.6;
  const rowH = 0.42;

  shown.forEach((m, i) => {
    const y = 2.75 + i * rowH;
    const tone = m.is_shipped ? GREEN : m.is_benchmark ? AMBER : m.name === "Oracle" ? INK_FAINT : "B8B0A3";
    s.addText(m.name, {
      x: M, y, w: 2.0, h: 0.32,
      isTextBox: true, margin: 0, valign: "middle",
      fontFace: BODY, fontSize: 12.5,
      color: m.is_shipped ? GREEN : m.is_benchmark ? AMBER : INK_SOFT,
      bold: m.is_shipped || m.is_benchmark,
    });
    s.addShape(pres.ShapeType.rect, {
      x: M + 2.1, y: y + 0.08, w: barW, h: 0.17,
      fill: { color: PAPER_SUNK }, line: { color: PAPER_SUNK },
    });
    s.addShape(pres.ShapeType.rect, {
      x: M + 2.1, y: y + 0.08, w: (m.mase / worst) * barW, h: 0.17,
      fill: { color: tone }, line: { color: tone },
    });
    s.addText(m.mase.toFixed(3), {
      x: M + 2.1 + barW + 0.15, y, w: 0.95, h: 0.32,
      isTextBox: true, margin: 0, valign: "middle",
      fontFace: MONO, fontSize: 12,
      color: m.is_shipped ? GREEN : INK_MUTE, bold: m.is_shipped,
    });
  });

  figure(s, shipped.toFixed(3), "what we ship — the median of\nfive independent models", {
    x: 9.85, y: 2.7, w: 2.65, color: GREEN, size: 44,
  });
  figure(s, baseline.toFixed(3), "SeasonalNaive — repeat what happened\nthis week last year. The honest\nbenchmark, and a hard one.", {
    x: 9.85, y: 4.5, w: 2.65, color: AMBER, size: 44,
  });

  caption(s, "Weekly grain · horizon 8 · rolling-origin CV over 4 non-overlapping folds · MASE against an in-sample naive denominator · 8 series · seed 42. MAPE is undefined on a series with zero-sale days, and one of ours has them on 67.9% of days.", { y: 6.5, size: 11, h: 0.45 });

  notes(s, "Lead with the benchmark, not with our number. SeasonalNaive is hard to beat on retail pharmacy data, and any team that does not name its baseline is hiding one.");
}

/* ============================================== 12 · THE ABLATION (LEAD) */
{
  const s = slide({ dark: true });
  eyebrow(s, "Result 2 · the finding worth leading with", { color: INK_FAINT });
  title(s, "We implemented the obvious approach\nand measured it losing.", { color: PAPER, size: 40 });

  const items = [
    [ablation.selection.toFixed(3), "Pick each product's\nbest model", RED, "the intuitive answer — and\nthe one most teams ship"],
    [ablation.combination.toFixed(3), "Combine them\n(median of five)", GREEN_LIT, "what we ship"],
    [ablation.oracle.toFixed(3), "Perfect hindsight", INK_FAINT, "a bound, not a model"],
  ];
  items.forEach(([v, c, col, sub], i) => {
    const x = M + i * 4.0;
    s.addText(v, {
      x, y: 3.0, w: 3.7, h: 1.0,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 56, color: col, bold: true,
    });
    s.addText(c, {
      x, y: 4.05, w: 3.7, h: 0.7,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: "C9C2B6", lineSpacing: 19,
    });
    s.addText(sub, {
      x, y: 4.78, w: 3.7, h: 0.6,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11, color: INK_MUTE, lineSpacing: 15,
    });
  });

  s.addText(
    "Five different models win across the eight series, so per-series selection looks obviously right. But with ~300 weekly observations, “best on the last fold” is mostly noise — selection chases the noise and locks in whichever model got lucky. Combination does the opposite: independent models make independent mistakes, and the median cancels them.",
    {
      x: M, y: 5.5, w: W - M * 2, h: 1.05,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: "C9C2B6", lineSpacing: 21,
    },
  );

  s.addText(
    "Scored honestly: the choice for fold k uses only folds 1…k−1, so it never sees the answer it is graded on.",
    {
      x: M, y: 6.62, w: W - M * 2, h: 0.38,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 10.5, color: INK_FAINT,
    },
  );

  notes(s, "This is the strongest slide in the deck. 'We tested the obvious approach and it lost' is a result. 'We averaged some models' is not - same code, different claim.");
}

/* ========================================================= 13 · CALIBRATION */
{
  const s = slide();
  eyebrow(s, "Result 3 · are our own confidence intervals true?");
  title(s, "We measured whether to believe\nourselves, then corrected it.", { size: 30, w: 6.6, h: 1.2 });

  s.addText(
    "A stated 80% interval actually covered " + (calib.achieved_before * 100).toFixed(1) + "% of outcomes. Too wide — which sounds like the safe direction and is not: an over-wide interval pushes the order quantity up, and the buyer pays holding cost for confidence the model has not earned.",
    {
      x: M, y: 2.5, w: 6.4, h: 1.15,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: INK_SOFT, lineSpacing: 19,
    },
  );

  figure(s, (calib.achieved_before * 100).toFixed(1) + "%", "the raw model interval,\nat a stated 80%", {
    x: M, y: 3.8, w: 2.9, color: RED, size: 44,
  });
  figure(s, (calib.achieved_after * 100).toFixed(1) + "%", "after conformal correction —\ndistribution-free, assuming nothing\nabout the shape of the residuals", {
    x: M + 3.15, y: 3.8, w: 3.25, color: GREEN, size: 44,
  });

  s.addText(
    "Our own design document predicted the opposite direction — 75%, over-confident. The measurement contradicts it. The lesson is unchanged; the business story flips, and we say so out loud.",
    {
      x: M, y: 5.8, w: 6.4, h: 0.9,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: INK_MUTE, italic: true, lineSpacing: 17,
    },
  );

  // 1200 x 1005 -> 1.194 ; 4.95in wide -> 4.15in tall
  shot(s, "why_calibration", { x: 7.55, y: 1.85, w: 4.95, h: 4.15 });
  s.addText("the same diagram, inside the product's Why screen", {
    x: 7.55, y: 6.25, w: 4.95, h: 0.3,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 9.5, color: INK_FAINT, charSpacing: 1.2,
  });

  notes(s, "Most teams never check calibration at all. Point out that the diagram lives in the product, not just the deck - the buyer can see it too.");
}

/* ======================================================= 14 · BUSINESS CASE */
{
  const s = slide();
  eyebrow(s, "Result 4 · what it is actually worth");
  title(s, "Against four policies, including the two\nthat are hard to beat.", { size: 30, h: 1.25 });

  s.addText(
    "Every policy sizes off the same trailing window of real sales, so the only thing being compared is how the quantity is chosen. The rung that carries the claim is the third one: it gets our forecast and our service level, and differs in exactly one thing — it sizes with a normal approximation instead of reading the quantile off the calibrated distribution.",
    {
      x: M, y: 2.28, w: W - M * 2, h: 0.7,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12.5, color: INK_SOFT, lineSpacing: 17,
    },
  );

  // Straight from decision/replay.py::compare_policies. Losing rungs included:
  // a ladder edited down to the flattering rungs is worth nothing.
  const LADDER = [
    ["Min/max on the mean", "no system at all", [6.0, 48.8, 61.1]],
    ["(s, S) safety stock", "what an ERP does", [-2.9, 23.1, -1.8]],
    ["Our forecast, normal sizing", "the claim", [17.9, 8.1, 0.4]],
  ];
  const WINDOWS = ["Jan–Mar 19", "Apr–Jun 19", "Oct–Dec 18"];

  const cw = (W - M * 2 - 2 * 0.3) / 3;
  LADDER.forEach(([name, sub, pcts], i) => {
    const x = M + i * (cw + 0.3);
    const carries = i === 2;
    card(s, {
      x, y: 3.15, w: cw, h: 2.5,
      fill: carries ? PAPER_SUNK : PAPER_RAISED,
      line: carries ? INK : RULE,
    });
    s.addText(name, {
      x: x + 0.25, y: 3.32, w: cw - 0.5, h: 0.32,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13.5, color: INK, bold: true,
    });
    s.addText(sub, {
      x: x + 0.25, y: 3.63, w: cw - 0.5, h: 0.26,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 9.5, color: carries ? GREEN : INK_FAINT,
    });
    pcts.forEach((pct, j) => {
      const y = 4.0 + j * 0.5;
      const win = pct > 0;
      s.addText(WINDOWS[j], {
        x: x + 0.25, y, w: 1.7, h: 0.3,
        isTextBox: true, margin: 0, valign: "middle",
        fontFace: BODY, fontSize: 11, color: INK_MUTE,
      });
      s.addText(`${win ? "+" : ""}${pct.toFixed(1)}%`, {
        x: x + 1.95, y, w: 1.3, h: 0.3,
        isTextBox: true, margin: 0, align: "right", valign: "middle",
        fontFace: MONO, fontSize: 13, color: win ? GREEN : AMBER, bold: true,
      });
    });
    s.addText(
      pcts.every((p) => p > 0) ? "we win all three" : "we lose two of three",
      {
        x: x + 0.25, y: 5.28, w: cw - 0.5, h: 0.26,
        isTextBox: true, margin: 0,
        fontFace: BODY, fontSize: 10.5,
        color: pcts.every((p) => p > 0) ? GREEN : AMBER, italic: true,
      },
    );
  });

  card(s, { x: M, y: 5.85, w: W - M * 2, h: 1.1, fill: PAPER_SUNK, line: INK });
  s.addText("What this says, and what it does not", {
    x: M + 0.3, y: 5.98, w: 4.2, h: 0.28,
    isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 12, color: INK, bold: true,
  });
  s.addText(
    "We beat the normal approximation on every window with forecast quality held constant — so the distribution is earning its place. Against a well-tuned ERP policy we are level, winning one and losing two by a couple of percent, and we say so. What separates us there is not cost: it is that z comes from the pharmacy's own margins instead of a consultant, the interval behind it is calibrated, and the number explains itself.",
    {
      x: M + 4.55, y: 5.95, w: 6.85, h: 0.9,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 10.5, color: INK_SOFT, lineSpacing: 13.5,
    },
  );

  notes(s, "Do not lead on min/max - anyone who works in inventory discounts it instantly, because every ERP carries safety stock. Lead on the third card. If asked why we do not dominate the ERP column: every policy here sizes off a trailing window, so none of them can anticipate a seasonal turn - on 1 January the last 180 days are autumn. Anticipating it is what the forecast layer is for, and exercising it needs a forecast produced at each review point rather than one vintage. That is the next piece of work and it is written down.");
}

/* ======================================================= 15 · WHERE WE LOSE */
{
  const s = slide();
  eyebrow(s, "Where it does not work");
  title(s, "A system that only shows you where it wins\nis not telling you anything.", { size: 32 });

  const tableRows = [
    [
      { text: "Series", options: { bold: true, color: INK, fontFace: BODY, fontSize: 12 } },
      { text: "SeasonalNaive", options: { bold: true, color: INK, fontFace: BODY, fontSize: 12 } },
      { text: "Ensemble", options: { bold: true, color: INK, fontFace: BODY, fontSize: 12 } },
      { text: "Best single model", options: { bold: true, color: INK, fontFace: BODY, fontSize: 12 } },
    ],
    ...bench.per_series.map((r) => {
      const weak = r.ensemble >= 1;
      return [
        { text: r.series_id, options: { fontFace: MONO, fontSize: 11.5, color: INK_SOFT } },
        { text: r.seasonal_naive.toFixed(3), options: { fontFace: MONO, fontSize: 11.5, color: INK_MUTE } },
        { text: r.ensemble.toFixed(3), options: { fontFace: MONO, fontSize: 11.5, color: weak ? RED : GREEN, bold: true } },
        { text: r.best_model, options: { fontFace: BODY, fontSize: 11.5, color: INK_MUTE } },
      ];
    }),
  ];

  s.addTable(tableRows, {
    x: M, y: 2.7, w: 6.9,
    colW: [1.25, 1.85, 1.5, 2.3],
    rowH: 0.34,
    border: { type: "solid", color: RULE, pt: 1 },
    fill: { color: PAPER_RAISED },
    align: "left",
    valign: "middle",
  });

  s.addText(
    "The ensemble beats seasonal-naive on all eight, so the relative column is not the interesting one. MASE above 1.000 means worse than simply repeating last week — and two series are.",
    {
      x: M, y: 5.85, w: 6.9, h: 0.75,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 12, color: INK_SOFT, lineSpacing: 17,
    },
  );

  const losses = [
    ["R06 · 1.646", "Our worst series, and well above 1.0. The May pollen peak is sharp and its timing moves year to year — we have six observations of it.", 2.7],
    ["R03 · 1.137", "Asthma / COPD. Better than the 1.294 seasonal-naive manages, but still above 1.0. We do not claim a win here.", 4.6],
  ];
  losses.forEach(([head, text, y]) => {
    card(s, { x: 8.2, y, w: 4.3, h: 1.7, fill: "F6EDEB", line: RED });
    s.addText(head, {
      x: 8.5, y: y + 0.2, w: 3.8, h: 0.4,
      isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 19, color: RED, bold: true,
    });
    s.addText(text, {
      x: 8.5, y: y + 0.65, w: 3.8, h: 0.95,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 11.5, color: INK_SOFT, lineSpacing: 15,
    });
  });

  caption(s, "Both are on the product's own Evidence screen, flagged, alongside the wins.", { y: 6.65, h: 0.3 });

  notes(s, "Say this before anyone finds it. A team that reports only wins gets discounted, and experienced judges do that quickly.");
}

/* ========================================================= 16 · LIMITATION */
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
    "What we do: flag days where sales hit a suspicious ceiling and treat them as censored.\nWhat we cannot do: verify it — this dataset has no on-hand-stock column.\nIt is named in the model card, and it is the first thing a real deployment fixes.",
    {
      x: M, y: 5.75, w: 11, h: 1.25,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: "C9C2B6", lineSpacing: 22,
    },
  );

  notes(s, "Saying this out loud is the strongest thing in the presentation. It bounds every claim the system makes, and volunteering it separates a team that measured from a team that demoed.");
}

/* ========================================================== 17 · CONCLUSION */
{
  const s = slide({ dark: true });
  eyebrow(s, "In conclusion", { color: INK_MUTE });

  s.addText("Every pharmacy guesses how much to order.", {
    x: M, y: 1.05, w: 11.4, h: 0.85,
    isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: 38, color: INK_MUTE,
  });
  s.addText(
    "We calculate it — with the odds,\nthe cost of being wrong, and\nthe reason behind the number.",
    {
      x: M, y: 1.9, w: 11.4, h: 1.85,
      isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 34, color: PAPER, lineSpacing: 44,
    },
  );

  const closing = [
    ["It forecasts", "MASE " + shipped.toFixed(3) + " — " + improvement.toFixed(1) + "% better than the seasonal-naive benchmark, over 4 rolling-origin folds."],
    ["It decides", "The forecast becomes a purchase order through the newsvendor fractile, sized against the full protection interval."],
    ["It is honest", "Calibration measured and corrected, the two series where it loses shown inside the product, and the censoring limitation named."],
    ["It is real", "138 tests, a benchmark that reruns from a clean clone in CI, and docker compose up."],
  ];
  closing.forEach((c, i) => {
    const y = 4.1 + i * 0.65;
    s.addText(c[0], {
      x: M, y, w: 1.9, h: 0.35,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 14, color: GREEN_LIT, bold: true,
    });
    s.addText(c[1], {
      x: M + 2.0, y, w: 9.4, h: 0.55,
      isTextBox: true, margin: 0,
      fontFace: BODY, fontSize: 13, color: "C9C2B6", lineSpacing: 17,
    });
  });

  s.addText("github.com/yashdoke7/pharmapulse    ·    docs/PHARMAPULSE_SYSTEM.md    ·    docs/ARCHITECTURE_DELTA.md", {
    x: M, y: 6.72, w: 11.4, h: 0.28,
    isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 10.5, color: INK_MUTE, charSpacing: 1.2,
  });

  notes(s, "End on the claim and take questions. Do not add a thank-you slide.");
}

/* ------------------------------------------------------------------ write */

const out = path.join(__dirname, "PharmaPulse.pptx");
pres.writeFile({ fileName: out }).then(() => {
  console.log("wrote", out);
  console.log("  ensemble " + shipped + "  benchmark " + baseline + "  improvement " + improvement.toFixed(1) + "%");
  console.log("  selection " + ablation.selection + "  combination " + ablation.combination);
  console.log("  calibration " + calib.achieved_before + " -> " + calib.achieved_after);
});
