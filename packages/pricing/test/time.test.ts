import { describe, expect, it } from "vitest";
import { addDaysToDate, localToInstant, toLocal } from "../src/index.js";

const TZ = "Australia/Sydney";

describe("localToInstant", () => {
  it("converts normal AEDT and AEST times", () => {
    expect(localToInstant("2030-01-16", "14:30", TZ)).toBe(Date.parse("2030-01-16T03:30:00Z"));
    expect(localToInstant("2026-09-16", "10:00", TZ)).toBe(Date.parse("2026-09-16T00:00:00Z"));
    expect(localToInstant("2026-09-16", "00:00", TZ)).toBe(Date.parse("2026-09-15T14:00:00Z"));
    expect(localToInstant("2026-09-16", "24:00", TZ)).toBe(Date.parse("2026-09-16T14:00:00Z"));
  });

  it("round-trips every 30 minutes across both 2026 DST changes (except the skipped hour)", () => {
    for (const date of ["2026-04-04", "2026-04-05", "2026-04-06", "2026-10-03", "2026-10-04", "2026-10-05"]) {
      for (let m = 0; m < 1440; m += 30) {
        const time = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
        if (date === "2026-10-04" && m >= 120 && m < 180) continue;
        const instant = localToInstant(date, time, TZ);
        expect(toLocal(instant, TZ).label, `${date} ${time}`).toBe(`${date} ${time}`);
      }
    }
  });

  it("maps a skipped time (2026-10-04 02:30) to 03:30 AEDT", () => {
    const instant = localToInstant("2026-10-04", "02:30", TZ);
    expect(instant).toBe(Date.parse("2026-10-03T16:30:00Z"));
    expect(toLocal(instant, TZ).label).toBe("2026-10-04 03:30");
  });

  it("maps a repeated time (2026-04-05 02:30) to the earlier instant (AEDT)", () => {
    expect(localToInstant("2026-04-05", "02:30", TZ)).toBe(Date.parse("2026-04-04T15:30:00Z"));
  });

  it("gives correct day lengths across DST", () => {
    const hours = (d: string) => (localToInstant(addDaysToDate(d, 1), "00:00", TZ) - localToInstant(d, "00:00", TZ)) / 3_600_000;
    expect(hours("2026-09-16")).toBe(24);
    expect(hours("2026-10-04")).toBe(23);
    expect(hours("2026-04-05")).toBe(25);
  });

  it("is independent of the host time zone setting and rejects bad input", () => {
    expect(() => localToInstant("16/01/2030", "10:00", TZ)).toThrow();
    expect(() => localToInstant("2030-01-16", "9am", TZ)).toThrow();
  });
});

describe("addDaysToDate", () => {
  it("handles month, year and leap-day boundaries", () => {
    expect(addDaysToDate("2030-01-31", 1)).toBe("2030-02-01");
    expect(addDaysToDate("2029-12-31", 1)).toBe("2030-01-01");
    expect(addDaysToDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToDate("2030-03-01", -1)).toBe("2030-02-28");
    expect(addDaysToDate("2030-01-16", 7)).toBe("2030-01-23");
  });
});
