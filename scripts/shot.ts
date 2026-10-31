import { chromium } from "@playwright/test";
const [, , url, out, w = "390", h = "844", full = "0"] = process.argv;
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  const p = await b.newPage({
    viewport: { width: +w, height: +h },
    deviceScaleFactor: 1,
  });
  p.on("console", (m) => m.type() === "error" && console.log("console error:", m.text().slice(0, 200)));
  await p.goto(url, { waitUntil: "networkidle" });
  await p.screenshot({ path: out, fullPage: full === "1" });
  await b.close();
})();
