import { chromium } from "@playwright/test";
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const p = await b.newPage();
  p.on("console", (m) => m.type() === "error" && console.log(m.text().slice(0, 1800)));
  await p.goto(process.argv[2], { waitUntil: "networkidle" });
  await b.close();
})();
