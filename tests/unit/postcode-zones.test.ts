import { describe, expect, it } from "vitest";
import { allZones, classify, POSTCODE_DATA, sectorForBearing, tierForDistance, zoneForPostcode, type GeneratedPostcode } from "@/domain/delivery-zones";
import { bearingDeg, distanceKm } from "@/domain/geo";
import { SHOP } from "@/config/delivery";

const row = (over: Partial<GeneratedPostcode>): GeneratedPostcode => ({ postcode: "99999", state: "BE", place: "x", lat: 0, lon: 0, distanceKm: 10, bearingDeg: 90, ...over });

describe("geometry", () => {
  it("distance and bearing from the shop", () => {
    expect(distanceKm(SHOP.lat, SHOP.lon, SHOP.lat, SHOP.lon)).toBe(0);
    expect(distanceKm(52.4757, 13.4267, 52.5200, 13.4050)).toBeCloseTo(5.0, 0);
    expect(bearingDeg(52, 13, 53, 13)).toBeCloseTo(0, 5); // due north
    expect(bearingDeg(52, 13, 52, 14)).toBeCloseTo(90, 0); // east
    expect(bearingDeg(52, 13, 51, 13)).toBeCloseTo(180, 5);
    expect(bearingDeg(52, 13, 52, 12)).toBeCloseTo(270, 0);
  });
});

describe("tier boundaries (upper bound inclusive)", () => {
  it.each([
    [0, "core"],
    [9, "core"],
    [9.001, "tier_100"],
    [27, "tier_100"],
    [27.001, "tier_150"],
    [42, "tier_150"],
    [42.001, "waitlist"],
  ])("%s km -> %s", (km, tier) => expect(tierForDistance(km)).toBe(tier));
});

describe("sector boundaries (from inclusive, to exclusive, north wraps past 360)", () => {
  it.each([
    [265, "west"],
    [264.99, "southwest"],
    [311.99, "west"],
    [312, "north"],
    [359.9, "north"],
    [0, "north"],
    [4.99, "north"],
    [5, "northeast"],
    [79.99, "northeast"],
    [80, "southeast"],
    [184.99, "southeast"],
    [185, "southwest"],
  ])("%s° -> %s", (deg, sector) => expect(sectorForBearing(deg)).toBe(sector));

  it("every degree maps to exactly one sector", () => {
    for (let d = 0; d < 360; d += 0.5) expect(() => sectorForBearing(d)).not.toThrow();
  });
});

describe("classification", () => {
  it("core has no sector and delivers Monday to Saturday", () => {
    expect(classify(row({ distanceKm: 3, bearingDeg: 200 }))).toMatchObject({ tier: "core", sector: null, minOrderCents: 6000, weekdays: [1, 2, 3, 4, 5, 6] });
  });
  it("tours deliver on their sector weekday with the tier minimum", () => {
    expect(classify(row({ distanceKm: 20, bearingDeg: 290 }))).toMatchObject({ tier: "tier_100", sector: "west", minOrderCents: 10000, weekdays: [2] });
    expect(classify(row({ distanceKm: 30, bearingDeg: 350 }))).toMatchObject({ tier: "tier_150", sector: "north", minOrderCents: 15000, weekdays: [3] });
    expect(classify(row({ distanceKm: 20, bearingDeg: 40 }))).toMatchObject({ sector: "northeast", weekdays: [4] });
    expect(classify(row({ distanceKm: 20, bearingDeg: 120 }))).toMatchObject({ sector: "southeast", weekdays: [1] });
    expect(classify(row({ distanceKm: 20, bearingDeg: 220 }))).toMatchObject({ sector: "southwest", weekdays: [5] });
  });
  it("waitlist has no sector and no delivery days", () => {
    expect(classify(row({ distanceKm: 60 }))).toMatchObject({ tier: "waitlist", sector: null, weekdays: [], minOrderCents: 0 });
  });
  it("overrides take precedence over generated values", () => {
    expect(classify(row({ distanceKm: 20, bearingDeg: 290 }), { tier: "tier_150", sector: "north" })).toMatchObject({ tier: "tier_150", sector: "north", minOrderCents: 15000, weekdays: [3], overridden: true });
    expect(classify(row({ distanceKm: 60 }), { tier: "tier_100", sector: "west" })).toMatchObject({ tier: "tier_100", weekdays: [2] });
  });
  it("14089 (Kladow/Gatow) is marked needs_review in the overrides file", () => {
    expect(zoneForPostcode("14089")).toMatchObject({ needsReview: true, overridden: true });
    expect(zoneForPostcode("12049")?.needsReview).toBe(false);
  });
  it("unknown or malformed postcodes resolve to null", () => {
    expect(zoneForPostcode("80331")).toBeNull();
    expect(zoneForPostcode("abc")).toBeNull();
  });
});

describe("generated data", () => {
  it("only Berlin and Brandenburg, unique postcodes, sane values", () => {
    expect(new Set(POSTCODE_DATA.map((p) => p.postcode)).size).toBe(POSTCODE_DATA.length);
    expect(POSTCODE_DATA.every((p) => ["BE", "BB"].includes(p.state) && p.bearingDeg >= 0 && p.bearingDeg < 360 && p.distanceKm >= 0)).toBe(true);
    expect(allZones().length).toBe(POSTCODE_DATA.length);
  });
  it("stored distance and bearing match the coordinates", () => {
    for (const p of POSTCODE_DATA.slice(0, 50)) {
      expect(p.distanceKm).toBeCloseTo(distanceKm(SHOP.lat, SHOP.lon, p.lat, p.lon), 1);
    }
  });
});

// Expected values from the brief. If one fails, the data or the rule is wrong, not the test: report it, do not adjust either.
describe("postcode assertions from the brief", () => {
  const cases: [string, string, string | null][] = [
    ["12049", "core", null],
    ["13581", "tier_100", "west"],
    ["14612", "tier_100", "west"],
    ["14624", "tier_100", "west"],
    ["14641", "tier_150", "west"],
    ["16761", "tier_100", "north"],
    ["16515", "tier_150", "north"],
    ["16321", "tier_100", "northeast"],
    ["12555", "tier_100", "southeast"],
    ["15711", "tier_100", "southeast"],
    ["14467", "tier_100", "southwest"],
    ["14513", "tier_100", "southwest"],
  ];
  it.each(cases)("%s -> %s %s", (pc, tier, sector) => {
    const z = zoneForPostcode(pc);
    expect(z, `${pc}: ${z?.distanceKm} km, ${z?.bearingDeg}°`).toMatchObject({ tier, sector });
  });
});
