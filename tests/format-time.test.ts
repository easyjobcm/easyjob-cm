import { describe, expect, it } from "vitest";
import { formatTime, TIME_PLACEHOLDER } from "@/lib/utils";

// F-38 : les colonnes SQL `time` (jobs.start_time…) arrivent en « HH:MM:SS ».
describe("formatTime", () => {
  it.each([
    ["09:00:00", "09:00"],
    ["13:30:00", "13:30"],
    ["00:00:00", "00:00"],
    ["23:59:59", "23:59"],
    ["07:05", "07:05"],
    ["18:45:00.123456", "18:45"],
  ])("heure SQL %s → %s (fr)", (value, expected) => {
    expect(formatTime(value)).toBe(expected);
  });

  it("heure SQL en anglais, sans décalage horaire", () => {
    expect(formatTime("09:00:00", "en")).toBe("09:00 AM");
    expect(formatTime("00:00:00", "en")).toBe("12:00 AM");
    expect(formatTime("21:15:00", "en")).toBe("09:15 PM");
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
    "abc",
    "25:00:00",
    "24:00:00",
    "9h",
    "12:60",
  ])("valeur absente ou invalide %o → placeholder", (value) => {
    expect(formatTime(value)).toBe(TIME_PLACEHOLDER);
  });

  it("un instant (Date ou ISO) suit le fuseau local, comme avant", () => {
    const d = new Date(2026, 9, 31, 14, 5);
    expect(formatTime(d)).toBe("14:05");
    expect(formatTime(d.toISOString())).toBe("14:05");
    expect(formatTime(new Date(Number.NaN))).toBe(TIME_PLACEHOLDER);
  });
});
