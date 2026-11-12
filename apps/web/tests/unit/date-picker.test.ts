import { describe, expect, it } from "vite-plus/test";
import {
  calendarDays,
  dateValue,
  isPickerValue,
  normalizePickerValue,
  parseDate,
  pickerError,
  shiftDay,
  shiftMonth,
} from "../../src/components/ui/datePicker.ts";

describe("自定义日期时间控件的日历和输入契约", () => {
  it("无效日期不滚动为下一月，闰年与早期年份准确", () => {
    expect(parseDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDate("2026-02-29")).toBeNull();
    expect(parseDate("2026-04-31")).toBeNull();
    expect(parseDate("2026-00-01")).toBeNull();
    expect(parseDate("0000-01-01")).toBeNull();
    expect(parseDate("0099-01-01")).toEqual({ year: 99, month: 1, day: 1 });
  });
  it("时间必须为24小时分钟精度，日期时间保留本地墙钟语义", () => {
    expect(isPickerValue("23:59", "time")).toBe(true);
    expect(isPickerValue("24:00", "time")).toBe(false);
    expect(isPickerValue("9:00", "time")).toBe(false);
    expect(isPickerValue("2026-11-14T21:30", "datetime-local")).toBe(true);
    expect(isPickerValue("2026-11-14T21:60", "datetime-local")).toBe(false);
    expect(normalizePickerValue(" 2026-11-14 21:30 ", "datetime-local")).toBe("2026-11-14T21:30");
  });
  it("空输入、上下界及跨午夜时间范围分别处理", () => {
    expect(pickerError("", "date")).toBe("");
    expect(pickerError("", "date", "", "", true)).not.toBe("");
    expect(pickerError("2026-11-13", "date", "2026-11-14")).toContain("早于");
    expect(pickerError("2026-11-15", "date", "", "2026-11-14")).toContain("晚于");
    expect(pickerError("2026-11-14", "date", "2026-11-14", "2026-11-14")).toBe("");
    expect(pickerError("23:30", "time", "22:00", "06:00")).toBe("");
    expect(pickerError("05:30", "time", "22:00", "06:00")).toBe("");
    expect(pickerError("12:00", "time", "22:00", "06:00")).not.toBe("");
  });
  it("日期时间上下界按完整时间比较，坏限制不污染合法输入", () => {
    expect(pickerError("2026-11-14T12:29", "datetime-local", "2026-11-14T12:30")).toContain("早于");
    expect(pickerError("2026-11-14T12:30", "datetime-local", "2026-11-14T12:30")).toBe("");
    expect(pickerError("2026-11-14", "date", "invalid")).toBe("");
    expect(pickerError("2026-02-31", "date")).toContain("尚未更新");
  });
  it("月历从周一开始，42格连续且区分相邻月份", () => {
    const days = calendarDays(2026, 11);
    expect(days).toHaveLength(42);
    expect(days[0]?.value).toBe("2026-10-26");
    expect(days[6]?.value).toBe("2026-11-01");
    expect(days.filter((day) => day.currentMonth)).toHaveLength(30);
    for (let i = 1; i < days.length; i++) expect(days[i]?.value).toBe(shiftDay(days[i - 1]!.value, 1));
  });
  it("键盘跨月与年界移动，31号换短月保持可用日期", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDay("2024-03-01", -1)).toBe("2024-02-29");
    expect(dateValue(shiftMonth({ year: 2026, month: 1, day: 31 }, 1))).toBe("2026-02-28");
    expect(dateValue(shiftMonth({ year: 2024, month: 1, day: 31 }, 1))).toBe("2024-02-29");
    expect(shiftDay("0001-01-01", -1)).toBe("0001-01-01");
  });
});
