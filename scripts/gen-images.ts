/**
 * Generates demo product artwork (SVG, studio-shot style: lit 3D meat texture on a ceramic plate).
 * These are PLACEHOLDERS: replace with real photography via Admin → Products.
 */
import { writeFileSync } from "node:fs";

type Kind = "cubes" | "steak" | "mince" | "chicken" | "chops" | "roast" | "box" | "shank";
type Hue = "beef" | "dark" | "chicken" | "lamb";
const items: { file: string; kind: Kind; hue: Hue }[] = [
  { file: "beef-cubes", kind: "cubes", hue: "beef" },
  { file: "ribeye-steak", kind: "steak", hue: "beef" },
  { file: "beef-mince", kind: "mince", hue: "beef" },
  { file: "sirloin-steak", kind: "steak", hue: "dark" },
  { file: "beef-roast", kind: "roast", hue: "dark" },
  { file: "osso-buco", kind: "shank", hue: "beef" },
  { file: "chicken-drumsticks", kind: "chicken", hue: "chicken" },
  { file: "chicken-breast", kind: "steak", hue: "chicken" },
  { file: "whole-chicken", kind: "roast", hue: "chicken" },
  { file: "lamb-chops", kind: "chops", hue: "lamb" },
  { file: "lamb-shoulder", kind: "roast", hue: "lamb" },
  { file: "lamb-mince", kind: "mince", hue: "lamb" },
  { file: "lamb-cubes", kind: "cubes", hue: "lamb" },
  { file: "family-box", kind: "box", hue: "beef" },
  { file: "cat-beef", kind: "steak", hue: "beef" },
  { file: "cat-chicken", kind: "chicken", hue: "chicken" },
  { file: "cat-lamb", kind: "chops", hue: "lamb" },
  { file: "cat-mince", kind: "mince", hue: "beef" },
  { file: "cat-box", kind: "box", hue: "beef" },
];
// base, light, dark
const P: Record<Hue, [string, string, string]> = {
  beef: ["#b3202f", "#d9505c", "#6b0f1b"],
  dark: ["#8f1a28", "#bd3a47", "#4a0912"],
  chicken: ["#eaa48e", "#f6cbb9", "#c77c66"],
  lamb: ["#b02a3a", "#d6606a", "#6c1522"],
};
const BG: Record<Hue, [string, string]> = {
  beef: ["#f7f1e8", "#e6dccb"],
  dark: ["#f3ece2", "#ddd0bb"],
  chicken: ["#f4f1e6", "#e1e3cf"],
  lamb: ["#f5eee6", "#e4d6c6"],
};

function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function blobPath(cx: number, cy: number, r: number, r2: () => number, squash = 0.84) {
  const n = 10;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.86 + r2() * 0.24);
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * squash];
  });
  let d = "";
  for (let i = 0; i < n; i++) {
    const p = pts[i],
      q = pts[(i + 1) % n];
    const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (i === 0) {
      const l = pts[n - 1];
      d += `M${(l[0] + p[0]) / 2},${(l[1] + p[1]) / 2}`;
    }
    d += ` Q${p[0]},${p[1]} ${m[0]},${m[1]}`;
  }
  return d + "Z";
}

function defs(seed: number, hue: Hue) {
  const [b, l, d] = P[hue],
    [bg1, bg2] = BG[hue];
  const fat = hue === "chicken" ? "#fff3e6" : "#fbe7df";
  return `<defs>
<radialGradient id="bg" cx="50%" cy="38%" r="80%"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient>
<radialGradient id="plate" cx="50%" cy="40%" r="60%"><stop offset="0" stop-color="#ffffff"/><stop offset=".8" stop-color="#f1efe9"/><stop offset="1" stop-color="#dcd8ce"/></radialGradient>
<radialGradient id="inner" cx="50%" cy="45%" r="55%"><stop offset="0" stop-color="#fbfaf7"/><stop offset="1" stop-color="#ebe8e0"/></radialGradient>
<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${l}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${d}"/></linearGradient>
<filter id="meat" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency=".022 .045" numOctaves="4" seed="${seed}" result="n"/>
  <feTurbulence type="fractalNoise" baseFrequency=".045 .018" numOctaves="3" seed="${seed + 5}" result="m"/>
  <feColorMatrix in="m" type="matrix" values="0 0 0 0 ${parseInt(fat.slice(1, 3), 16) / 255}  0 0 0 0 ${parseInt(fat.slice(3, 5), 16) / 255}  0 0 0 0 ${parseInt(fat.slice(5, 7), 16) / 255}  9 0 0 0 -6.3" result="fat"/>
  <feComposite in="fat" in2="SourceAlpha" operator="in" result="fatIn"/>
  <feMerge result="col"><feMergeNode in="SourceGraphic"/><feMergeNode in="fatIn"/></feMerge>
  <feDiffuseLighting in="n" surfaceScale="2.6" diffuseConstant="1.1" lighting-color="#fff" result="dl"><feDistantLight azimuth="235" elevation="58"/></feDiffuseLighting>
  <feComposite in="dl" in2="SourceAlpha" operator="in" result="dlIn"/>
  <feBlend in="col" in2="dlIn" mode="multiply" result="lit"/>
  <feSpecularLighting in="n" surfaceScale="5" specularConstant=".75" specularExponent="26" lighting-color="#fff2ee" result="sp"><feDistantLight azimuth="235" elevation="52"/></feSpecularLighting>
  <feComposite in="sp" in2="SourceAlpha" operator="in" result="spIn"/>
  <feComposite in="lit" in2="spIn" operator="arithmetic" k1="0" k2="1" k3=".7" k4="0"/>
</filter>
<filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="16" stdDeviation="14" flood-color="#3a2417" flood-opacity=".32"/></filter>
<filter id="sh2" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#3a2417" flood-opacity=".28"/></filter>
</defs>`;
}

const piece = (cx: number, cy: number, r: number, r2: () => number, squash = 0.84) =>
  `<g filter="url(#sh2)"><path d="${blobPath(cx, cy, r, r2, squash)}" fill="url(#g)" filter="url(#meat)"/></g>`;

function sprig(x: number, y: number, rot: number, r2: () => number) {
  let s = `<g transform="translate(${x} ${y}) rotate(${rot})"><path d="M0 0 L150 -8" stroke="#6a5a3a" stroke-width="3" stroke-linecap="round"/>`;
  for (let i = 0; i < 26; i++) {
    const t = 12 + i * 5.2,
      side = i % 2 ? 1 : -1,
      len = 20 + r2() * 12;
    s += `<path d="M${t} ${-t * 0.053} l${6 + r2() * 3} ${side * len}" stroke="#3f7a47" stroke-width="2.6" stroke-linecap="round" opacity=".92"/>`;
  }
  return s + "</g>";
}

function art(kind: Kind, hue: Hue, seed: number) {
  const r2 = rng(seed);
  let body = "";
  if (kind === "cubes")
    for (const [x, y, r] of [
      [330, 330, 62],
      [418, 300, 66],
      [500, 345, 60],
      [372, 410, 64],
      [462, 420, 58],
      [282, 410, 54],
      [545, 290, 50],
      [350, 245, 54],
      [440, 215, 46],
    ])
      body += piece(x, y, r, r2, 0.88);
  if (kind === "steak")
    body +=
      piece(400, 345, 195, r2, 0.78) +
      `<path d="M520 300 q40 20 20 70" stroke="#fbf0e8" stroke-width="16" fill="none" stroke-linecap="round" opacity=".75"/>`;
  if (kind === "roast")
    body +=
      piece(400, 345, 185, r2, 0.8) +
      `<path d="M265 290 Q400 235 535 292 M255 372 Q400 322 545 380" stroke="#d6bd8d" stroke-width="5" fill="none" opacity=".75" stroke-linecap="round"/>`;
  if (kind === "shank")
    for (const [x, y] of [
      [310, 365],
      [500, 335],
    ])
      body +=
        piece(x, y, 108, r2, 0.9) +
        `<ellipse cx="${x}" cy="${y}" rx="38" ry="30" fill="#f6ead9" filter="url(#sh2)"/><ellipse cx="${x}" cy="${y}" rx="16" ry="12" fill="#e2c7a0"/>`;
  if (kind === "mince") {
    let s = "";
    for (let i = 0; i < 150; i++) {
      const a = r2() * 6.28,
        dist = Math.sqrt(r2()) * 185;
      s += `<ellipse cx="${400 + Math.cos(a) * dist * 1.25}" cy="${338 + Math.sin(a) * dist * 0.74}" rx="${13 + r2() * 12}" ry="${9 + r2() * 8}" transform="rotate(${r2() * 180} ${400 + Math.cos(a) * dist * 1.25} ${338 + Math.sin(a) * dist * 0.74})" fill="url(#g)"/>`;
    }
    body = `<g filter="url(#sh2)"><g filter="url(#meat)">${s}</g></g>`;
  }
  if (kind === "chicken")
    for (const [x, y, rot] of [
      [320, 350, -28],
      [485, 330, 22],
      [400, 430, 4],
    ])
      body += `<g transform="rotate(${rot} ${x} ${y})"><g filter="url(#sh2)"><rect x="${x - 11}" y="${y + 40}" width="22" height="92" rx="11" fill="#f3e6da"/><circle cx="${x - 8}" cy="${y + 134}" r="16" fill="#f7eee5"/><circle cx="${x + 10}" cy="${y + 134}" r="16" fill="#f7eee5"/></g>${piece(x, y - 18, 88, r2, 0.9)}</g>`;
  if (kind === "chops")
    for (const [x, y, rot] of [
      [290, 385, -14],
      [420, 350, 3],
      [550, 385, 15],
    ])
      body += `<g transform="rotate(${rot} ${x} ${y})"><g filter="url(#sh2)"><rect x="${x - 11}" y="${y - 165}" width="22" height="120" rx="11" fill="#f6ecdd"/></g>${piece(x, y, 84, r2, 0.9)}</g>`;
  if (kind === "box")
    body +=
      `<g filter="url(#sh)"><path d="M185 285 L615 285 L585 515 L215 515Z" fill="#c8a06a"/><path d="M185 285 L615 285 L605 330 L195 330Z" fill="#dcb883"/></g>` +
      [
        [290, 400, 54],
        [395, 380, 58],
        [498, 405, 56],
        [345, 466, 48],
        [452, 470, 50],
      ]
        .map(([x, y, r]) => piece(x, y, r, r2, 0.9))
        .join("");
  const plate =
    kind === "box"
      ? ""
      : `<g filter="url(#sh)"><ellipse cx="400" cy="372" rx="352" ry="226" fill="url(#plate)"/></g><ellipse cx="400" cy="366" rx="296" ry="184" fill="url(#inner)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" role="img">${defs(seed, hue)}<rect width="800" height="600" fill="url(#bg)"/>${plate}${sprig(580, 150, 12, r2)}${body}${sprig(110, 520, -18, r2).replace(/#3f7a47/g, "#4a8a52")}</svg>`;
}

items.forEach((it, i) => writeFileSync(`public/products/${it.file}.svg`, art(it.kind, it.hue, 11 + i * 17)));
console.log("wrote", items.length);
