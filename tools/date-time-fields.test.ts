import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localDate,
  localTime,
  parseLocalDate,
  pickerValue,
} from "../apps/mobile/src/components/dateTime.ts";

test("calendar selections keep the chosen local day in eastern and western time zones", () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of [
      "Asia/Kolkata",
      "America/Los_Angeles",
      "Pacific/Auckland",
    ]) {
      process.env.TZ = timezone;
      for (const date of ["2028-02-29", "2026-11-01", "1998-01-01"]) {
        assert.equal(localDate(parseLocalDate(date)), date, timezone);
        assert.equal(
          localDate(
            pickerValue({
              label: "Date",
              mode: "date",
              value: date,
              onChange() {},
            }),
          ),
          date,
        );
      }
      assert.equal(
        localTime(
          pickerValue({
            label: "Time",
            mode: "time",
            value: "08:30",
            onChange() {},
          }),
        ),
        "08:30",
      );
      assert.equal(
        localTime(
          pickerValue({
            label: "Time",
            mode: "time",
            value: "00:05",
            onChange() {},
          }),
        ),
        "00:05",
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test("invalid calendar days are rejected and picker starting values respect bounds", () => {
  for (const invalid of ["2026-02-30", "2026-13-01", "", "not a date"])
    assert.equal(parseLocalDate(invalid), undefined);
  const base = { label: "Date", mode: "date" as const, onChange() {} };
  assert.equal(
    localDate(
      pickerValue({ ...base, value: "2020-01-01", minimumDate: "2026-11-01" }),
    ),
    "2026-11-01",
  );
  assert.equal(
    localDate(
      pickerValue({ ...base, value: "2026-11-01", maximumDate: "2008-11-01" }),
    ),
    "2008-11-01",
  );
});
