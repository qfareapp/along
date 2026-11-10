export type DateTimeFieldProps = {
  label: string;
  mode: "date" | "time";
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  minimumDate?: string;
  maximumDate?: string;
};
const pad = (value: number) => String(value).padStart(2, "0");
export const localDate = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const localTime = (date: Date) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}`;
export function parseLocalDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(+date) && localDate(date) === value ? date : undefined;
}
export function pickerValue({
  mode,
  value,
  minimumDate,
  maximumDate,
}: DateTimeFieldProps) {
  let date = parseLocalDate(value) ?? new Date();
  if (mode === "time") {
    const now = new Date();
    // Time-only selections must not normalize an hour during today's DST change.
    date = new Date(2000, 0, 15, now.getHours(), now.getMinutes());
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
      date.setHours(Number(value.slice(0, 2)), Number(value.slice(3)), 0, 0);
  } else {
    const min = parseLocalDate(minimumDate),
      max = parseLocalDate(maximumDate);
    if (min && date < min) date = min;
    if (max && date > max) date = max;
  }
  return date;
}
export function adultBirthDateLimit() {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 18);
  return localDate(date);
}
