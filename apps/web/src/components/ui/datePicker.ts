export type PickerType = "date" | "time" | "datetime-local";
export interface DateParts {
  year: number;
  month: number;
  day: number;
}
export interface CalendarDay extends DateParts {
  value: string;
  currentMonth: boolean;
}
const pad = (n: number) => String(n).padStart(2, "0");
export function dateValue(parts: DateParts): string {
  return `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}`;
}
function utcDate(parts: DateParts): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  return date;
}
export function parseDate(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  if (parts.year < 1 || parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) return null;
  const date = utcDate(parts);
  return date.getUTCFullYear() === parts.year && date.getUTCMonth() + 1 === parts.month && date.getUTCDate() === parts.day ? parts : null;
}
export function validTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}
export function normalizePickerValue(value: string, type: PickerType): string {
  const trimmed = value.trim();
  return type === "datetime-local" ? trimmed.replace(/^(\d{4}-\d{2}-\d{2})[ ]+(\d{2}:\d{2})$/, "$1T$2") : trimmed;
}
export function isPickerValue(value: string, type: PickerType): boolean {
  if (type === "date") return !!parseDate(value);
  if (type === "time") return validTime(value);
  return value.length === 16 && value[10] === "T" && !!parseDate(value.slice(0, 10)) && validTime(value.slice(11));
}
export function pickerError(value: string, type: PickerType, min = "", max = "", required = false): string {
  if (!value) return required ? "请填写日期或时间。" : "";
  if (!isPickerValue(value, type)) {
    const format = type === "date" ? "YYYY-MM-DD" : type === "time" ? "HH:mm" : "YYYY-MM-DDTHH:mm";
    return `请输入有效的${type === "time" ? "时间" : "日期"}（${format}），当前输入尚未更新。`;
  }
  const validMin = isPickerValue(min, type);
  const validMax = isPickerValue(max, type);
  if (type === "time" && validMin && validMax && min > max) {
    return value >= min || value <= max ? "" : `请选择 ${min} 至次日 ${max} 之间的时间。`;
  }
  if (validMin && value < min) return `不能早于 ${min.replace("T", " ")}。`;
  if (validMax && value > max) return `不能晚于 ${max.replace("T", " ")}。`;
  return "";
}
export function localToday(now = new Date()): string {
  return dateValue({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}
export function localTime(now = new Date()): string {
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}
export function shiftDay(value: string, amount: number): string {
  const parts = parseDate(value);
  if (!parts) return value;
  const date = utcDate(parts);
  date.setUTCDate(date.getUTCDate() + amount);
  if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return value;
  return dateValue({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
}
export function shiftMonth(parts: DateParts, amount: number): DateParts {
  const first = utcDate({ ...parts, day: 1 });
  first.setUTCMonth(first.getUTCMonth() + amount);
  if (first.getUTCFullYear() < 1 || first.getUTCFullYear() > 9999) return parts;
  const last = utcDate({ year: first.getUTCFullYear(), month: first.getUTCMonth() + 2, day: 0 });
  return { year: first.getUTCFullYear(), month: first.getUTCMonth() + 1, day: Math.min(parts.day, last.getUTCDate()) };
}
export function calendarDays(year: number, month: number): CalendarDay[] {
  const first = utcDate({ year, month, day: 1 });
  const lead = (first.getUTCDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, i) => {
    const date = utcDate({ year, month, day: 1 - lead + i });
    const parts = { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    return { ...parts, value: dateValue(parts), currentMonth: parts.year === year && parts.month === month };
  });
}
