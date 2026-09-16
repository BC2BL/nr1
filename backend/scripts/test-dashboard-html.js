const { JSDOM } = require("jsdom");
const fs = require("fs");

async function main() {
  const html = fs.readFileSync("/mnt/user-data/outputs/admin-dashboard.html", "utf-8");
  const url = "http://localhost:9998/admin-dashboard.html";

  const dom = new JSDOM(html, {
    url, runScripts: "dangerously", resources: "usable", pretendToBeVisual: true,
    beforeParse(window) { window.fetch = fetch; },
  });
  const doc = dom.window.document;

  await new Promise(r => setTimeout(r, 300));

  console.log("Login screen visible:", !doc.getElementById("loginScreen").classList.contains("hidden"));
  console.log("Dashboard hidden:", doc.getElementById("dashboardWrap").classList.contains("hidden"));

  // Wrong password first
  doc.getElementById("loginEmail").value = "teste-acoes@example.com";
  doc.getElementById("loginPassword").value = "wrongpassword";
  doc.getElementById("loginBtn").dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 500));
  console.log("\nAfter wrong password:");
  console.log("  Error shown:", !doc.getElementById("loginError").classList.contains("hidden"));
  console.log("  Error text:", doc.getElementById("loginError").textContent);
  console.log("  Still on login screen:", !doc.getElementById("loginScreen").classList.contains("hidden"));

  // Correct password
  doc.getElementById("loginPassword").value = "senha1234";
  doc.getElementById("loginBtn").dispatchEvent(new dom.window.Event("click"));
  await new Promise(r => setTimeout(r, 800));

  console.log("\nAfter correct login:");
  console.log("  Login screen hidden:", doc.getElementById("loginScreen").classList.contains("hidden"));
  console.log("  Dashboard visible:", !doc.getElementById("dashboardWrap").classList.contains("hidden"));
  console.log("  Response rate shown:", doc.querySelector(".rate-value").textContent);
  console.log("  Seats completed text:", doc.getElementById("seatsCompleted").textContent);
  console.log("  Reward count shown:", doc.querySelector(".reward-count").textContent);

  const domainCards = doc.querySelectorAll(".domain-card");
  console.log(`\n  Domain cards rendered: ${domainCards.length}`);
  domainCards.forEach(card => {
    const label = card.querySelector(".domain-label")?.textContent;
    const suppressed = card.querySelector(".suppressed-msg") !== null;
    const gaugeVal = card.querySelector(".gauge-value")?.textContent;
    const badge = card.querySelector(".risk-badge")?.textContent;
    console.log(`    ${label}: ${suppressed ? "SUPPRESSED" : `score=${gaugeVal} risk=${badge}`}`);
  });

  const mockNote = doc.getElementById("actionMockNote");
  console.log("\n  Action plan mock-data disclosure shown:", mockNote ? mockNote.textContent : "(none — using real data)");

  const actionRows = doc.querySelectorAll(".action-row");
  console.log(`\n  Action plan rows rendered: ${actionRows.length}`);
  actionRows.forEach(row => {
    const title = row.querySelector(".action-title")?.textContent;
    const status = row.querySelector(".status-pill")?.textContent;
    console.log(`    "${title}" — ${status}`);
  });
}

main().catch(err => { console.error("TEST FAILED:", err); process.exit(1); });
