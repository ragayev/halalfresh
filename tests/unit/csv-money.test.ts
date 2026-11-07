import { describe, expect, it } from "vitest";
import { parsePriceToCents } from "@/domain/money";
import { parseCsv, toCsv } from "@/domain/csv";

describe("parsePriceToCents", () => {
  it.each([
    ["12", 1200], ["12,5", 1250], ["12,50", 1250], ["12.50", 1250], ["1.234,50", 123450], ["1,234.50", 123450],
    ["1.234", 123400], ["0,99", 99], ["€ 7,00", 700], ["19,9", 1990],
  ])("parses %s", (raw, cents) => expect(parsePriceToCents(raw)).toBe(cents));
  it.each(["", "abc", "-5", "1,234,56", "1.2.3,4", "12,345", "1,234", "1,5,0", "12,", ",50"])("rejects %j", (raw) => expect(parsePriceToCents(raw)).toBeNull());
});

describe("csv", () => {
  it("round-trips UTF-8, quotes and both delimiters", () => {
    const rows = [["id", "name"], ["1", 'Kuşbaşı "özel"'], ["2", "a,b;c"], ["3", "line\nbreak"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
  it("reads German Excel exports (semicolon, BOM, CRLF)", () => {
    expect(parseCsv("﻿id;price_eur\r\nx1;12,50\r\nx2;3\r\n")).toEqual([["id", "price_eur"], ["x1", "12,50"], ["x2", "3"]]);
  });
  it("neutralises spreadsheet formulas on export", () => {
    expect(toCsv([["=SUM(A1)", "-3", "-evil"]])).toContain("'=SUM(A1),-3,'-evil");
  });
});
