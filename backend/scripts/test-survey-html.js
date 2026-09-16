const { JSDOM } = require("jsdom");
const fs = require("fs");

async function main() {
  const html = fs.readFileSync("/mnt/user-data/outputs/employee-survey.html", "utf-8");

  // Fresh session — no ?t= param, so this simulates a brand-new respondent.
  const url = "http://localhost:9999/employee-survey.html?survey=comercio-alfa-ltda-c688d4c976f1";

  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    resources: "usable",
    pretendToBeVisual: true,
    beforeParse(window) {
      // Must be set before the page's own <script> tag executes, since
      // initSurvey() runs immediately at the bottom of the script.
      window.fetch = fetch;
      window.navigator.clipboard = { writeText: async () => {} };
    },
  });

  const { window } = dom;

  // Give initSurvey() time to run (session create + questions fetch).
  await new Promise(r => setTimeout(r, 1000));

  const doc = window.document;

  const landingFreshVisible = !doc.getElementById("landingFresh").classList.contains("hidden");
  const welcomeTitle = doc.getElementById("welcomeTitle").textContent;
  console.log("Landing (fresh) visible:", landingFreshVisible);
  console.log("Welcome title:", welcomeTitle);
  console.log("Est. time text:", doc.getElementById("estTime").textContent);

  // Click "Começar pesquisa"
  doc.getElementById("startBtn").dispatchEvent(new window.Event("click"));
  await new Promise(r => setTimeout(r, 200));

  const surveyVisible = !doc.getElementById("surveyScreen").classList.contains("hidden");
  console.log("\nSurvey screen visible after Start click:", surveyVisible);
  console.log("First question text:", doc.getElementById("qText").textContent);
  console.log("Progress label:", doc.getElementById("progressLabel").textContent);

  // Answer all 12 questions by clicking the 4th scale option each time,
  // proving both the click handler and the auto-save fetch call work.
  for (let i = 0; i < 12; i++) {
    const options = doc.querySelectorAll(".scale-option");
    if (options.length === 0) { console.log(`No options found at question ${i + 1}`); break; }
    options[3].dispatchEvent(new window.Event("click")); // pick option value 4
    await new Promise(r => setTimeout(r, 150)); // let the answer POST resolve

    const nextBtn = doc.getElementById("qNextBtn");
    console.log(`Q${i + 1} answered, next button label: "${nextBtn.textContent}", disabled: ${nextBtn.disabled}`);
    nextBtn.dispatchEvent(new window.Event("click"));
    await new Promise(r => setTimeout(r, 250));
  }

  // After the 12th "next" click (which was actually submit), give the
  // submit fetch + score recompute a moment to finish.
  await new Promise(r => setTimeout(r, 800));

  const completeVisible = !doc.getElementById("completeScreen").classList.contains("hidden");
  console.log("\nComplete screen visible:", completeVisible);
  console.log("Complete title:", doc.getElementById("completeScreen").querySelector("h1").textContent);
  const rewardYesVisible = !doc.getElementById("rewardYes").classList.contains("hidden");
  console.log("Reward box visible:", rewardYesVisible);
  if (rewardYesVisible) {
    console.log("Reward code shown:", doc.getElementById("rewardCode").textContent);
  }

  console.log("\nURL after flow (should carry ?t= session token):", window.location.href);
}

main().catch(err => { console.error("TEST FAILED:", err); process.exit(1); });
