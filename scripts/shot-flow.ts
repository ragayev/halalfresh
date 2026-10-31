import { chromium } from "@playwright/test";
(async () => {
  const b = await chromium.launch({ channel: "chrome" });
  for (const [name, vp] of [
    ["m", { width: 390, height: 844 }],
    ["d", { width: 1280, height: 860 }],
  ] as const) {
    const p = await b.newPage({ viewport: vp });
    await p.goto("http://localhost:3000/en/shop?category=beef", { waitUntil: "networkidle" });
    await p.screenshot({ path: `/tmp/hfshots/shop-${name}.png` });
    await p.evaluate(() => localStorage.setItem("hf_cart_v1", JSON.stringify([])));
    for (const slug of ["premium-beef-cubes", "lamb-chops"]) {
      await p.goto(`http://localhost:3000/en/products/${slug}`, { waitUntil: "networkidle" });
      for (let i = 0; i < 4; i++) await p.getByRole("button", { name: "Increase quantity" }).click();
      await p.getByTestId("add-to-cart").click();
    }
    await p.goto("http://localhost:3000/en/cart", { waitUntil: "networkidle" });
    await p.waitForSelector("[data-testid=cart-line]");
    await p.screenshot({ path: `/tmp/hfshots/cart-${name}.png` });
    await p.goto("http://localhost:3000/en/checkout", { waitUntil: "networkidle" });
    await p.screenshot({ path: `/tmp/hfshots/checkout-${name}.png`, fullPage: true });
    await p.close();
  }
  await b.close();
})();
