import React, { useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ScrollViewInstance,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, text } from "./ui";
import { colors as c } from "../theme";
import {
  localDate,
  localTime,
  parseLocalDate,
  pickerValue,
  type DateTimeFieldProps,
} from "./dateTime";

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const weekdays = ["S", "M", "T", "W", "T", "F", "S"];
export function ThemedPickerModal({
  onClose,
  ...props
}: DateTimeFieldProps & { onClose: () => void }) {
  const { mode, label, minimumDate, maximumDate } = props;
  const [draft, setDraft] = useState(() => pickerValue(props));
  const scroller = useRef<ScrollViewInstance>(null);
  const [today] = useState(() => parseLocalDate(localDate())!);
  const [month, setMonth] = useState(
    () => new Date(draft.getFullYear(), draft.getMonth(), 1, 12),
  );
  const [page, setPage] = useState<"days" | "months" | "years">("days");
  const [yearPage, setYearPage] = useState(
    () => draft.getFullYear() - (draft.getFullYear() % 12),
  );
  const [timePart, setTimePart] = useState<"hour" | "minute">("hour");
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      scroller.current?.scrollTo({ y: 0, animated: false }),
    );
    return () => cancelAnimationFrame(frame);
  }, [page, timePart]);
  useEffect(() => {
    if (mode !== "time") return;
    const keyboard = Keyboard.addListener("keyboardDidShow", () =>
      scroller.current?.scrollToEnd({ animated: true }),
    );
    return () => keyboard.remove();
  }, [mode]);
  const [minuteText, setMinuteText] = useState(() =>
    String(draft.getMinutes()).padStart(2, "0"),
  );
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const min = minimumDate ?? "1900-01-01",
    max = maximumDate ?? "2199-12-31";
  const dateAllowed = (date: Date) =>
    localDate(date) >= min && localDate(date) <= max;
  const monthAllowed = (year: number, index: number) =>
    localDate(new Date(year, index + 1, 0, 12)) >= min &&
    localDate(new Date(year, index, 1, 12)) <= max;
  const updateTime = (hour: number, minute: number) => {
    const next = new Date(draft);
    next.setHours(hour, minute, 0, 0);
    setDraft(next);
    setMinuteText(String(minute).padStart(2, "0"));
  };
  const preview =
    mode === "date"
      ? draft.toLocaleDateString(undefined, {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: "numeric",
        })
      : draft.toLocaleTimeString(undefined, {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        });
  const validMinute = /^\d{1,2}$/.test(minuteText) && Number(minuteText) <= 59;
  const confirm = () => {
    Keyboard.dismiss();
    props.onChange(mode === "date" ? localDate(draft) : localTime(draft));
    onClose();
  };
  const monthDelta = (delta: number) =>
    new Date(month.getFullYear(), month.getMonth() + delta, 1, 12);
  const nav = (delta: number) => {
    if (page === "years") setYearPage(yearPage + delta * 12);
    else if (page === "months")
      setMonth(new Date(month.getFullYear() + delta, month.getMonth(), 1, 12));
    else setMonth(monthDelta(delta));
  };
  const canNav = (delta: number) =>
    page === "days"
      ? monthAllowed(
          monthDelta(delta).getFullYear(),
          monthDelta(delta).getMonth(),
        )
      : page === "months"
        ? month.getFullYear() + delta >= Number(min.slice(0, 4)) &&
          month.getFullYear() + delta <= Number(max.slice(0, 4))
        : yearPage + delta * 12 + 11 >= Number(min.slice(0, 4)) &&
          yearPage + delta * 12 <= Number(max.slice(0, 4));
  const size = Math.min(232, width - 64),
    center = size / 2,
    radius = center - 23;
  const selectedNumber =
    timePart === "hour" ? draft.getHours() % 12 || 12 : draft.getMinutes();
  const angle =
    (timePart === "hour" ? (selectedNumber % 12) / 12 : selectedNumber / 60) *
      Math.PI *
      2 -
    Math.PI / 2;
  const hand = radius - 20;
  function choice(
    label: string,
    selected: boolean,
    onPress: () => void,
    disabled = false,
  ) {
    return (
      <Pressable
        key={label}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected, disabled }}
        disabled={disabled}
        onPress={onPress}
        style={[
          s.choice,
          selected && s.choiceSelected,
          disabled && { opacity: 0.3 },
        ]}
      >
        <Text style={[s.choiceText, selected && { color: c.white }]}>
          {label}
        </Text>
      </Pressable>
    );
  }
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={[
        "portrait",
        "landscape",
        "landscape-left",
        "landscape-right",
      ]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={
          Platform.OS === "web"
            ? undefined
            : Platform.OS === "ios"
              ? "padding"
              : "height"
        }
      >
        <View
          style={[
            s.overlay,
            {
              paddingTop: insets.top + 12,
              paddingBottom: insets.bottom + 12,
              paddingHorizontal: width < 360 ? 6 : 16,
            },
          ]}
        >
          <Pressable
            accessible={false}
            focusable={false}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <View
            accessibilityViewIsModal
            role="dialog"
            aria-label={`${label} picker`}
            style={[
              s.modal,
              {
                maxHeight: Math.max(
                  180,
                  height - insets.top - insets.bottom - 24,
                ),
              },
            ]}
          >
            <View style={s.header}>
              <View style={[s.row, { justifyContent: "space-between" }]}>
                <View style={[s.row, { gap: 8, flex: 1 }]}>
                  <Ionicons
                    name={mode === "date" ? "calendar-outline" : "time-outline"}
                    size={18}
                    color={c.peach}
                  />
                  <Text style={s.eyebrow}>
                    {mode === "date"
                      ? "MAKE A LITTLE PLAN"
                      : "FIND YOUR MOMENT"}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close picker"
                  onPress={onClose}
                  style={s.close}
                >
                  <Ionicons name="close" color={c.white} size={21} />
                </Pressable>
              </View>
              <Text style={s.headerLabel}>{label}</Text>
              <Text accessibilityLiveRegion="polite" style={s.preview}>
                {preview}
              </Text>
            </View>
            <ScrollView
              ref={scroller}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={s.body}
            >
              {mode === "date" ? (
                <>
                  <View
                    style={[
                      s.row,
                      { justifyContent: "space-between", marginBottom: 10 },
                    ]}
                  >
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        page === "years"
                          ? "Previous years"
                          : page === "months"
                            ? "Previous year"
                            : "Previous month"
                      }
                      accessibilityState={{ disabled: !canNav(-1) }}
                      disabled={!canNav(-1)}
                      onPress={() => nav(-1)}
                      style={[s.nav, !canNav(-1) && { opacity: 0.25 }]}
                    >
                      <Ionicons name="chevron-back" size={20} color={c.teal} />
                    </Pressable>
                    <View style={[s.row, { gap: 4 }]}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Choose month"
                        onPress={() =>
                          setPage(page === "months" ? "days" : "months")
                        }
                        style={s.monthButton}
                      >
                        <Text style={s.monthText}>
                          {months[month.getMonth()]}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={13}
                          color={c.teal}
                        />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Choose year"
                        onPress={() => {
                          setYearPage(
                            month.getFullYear() - (month.getFullYear() % 12),
                          );
                          setPage(page === "years" ? "days" : "years");
                        }}
                        style={s.monthButton}
                      >
                        <Text style={s.monthText}>
                          {page === "years"
                            ? `${yearPage}–${yearPage + 11}`
                            : month.getFullYear()}
                        </Text>
                        <Ionicons
                          name="chevron-down"
                          size={13}
                          color={c.teal}
                        />
                      </Pressable>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={
                        page === "years"
                          ? "Next years"
                          : page === "months"
                            ? "Next year"
                            : "Next month"
                      }
                      accessibilityState={{ disabled: !canNav(1) }}
                      disabled={!canNav(1)}
                      onPress={() => nav(1)}
                      style={[s.nav, !canNav(1) && { opacity: 0.25 }]}
                    >
                      <Ionicons
                        name="chevron-forward"
                        size={20}
                        color={c.teal}
                      />
                    </Pressable>
                  </View>
                  {page === "days" ? (
                    <>
                      <View style={s.week}>
                        {weekdays.map((day, index) => (
                          <Text key={index} style={s.weekday}>
                            {day}
                          </Text>
                        ))}
                      </View>
                      <View style={s.days}>
                        {Array.from(
                          {
                            length:
                              Math.ceil(
                                (month.getDay() +
                                  new Date(
                                    month.getFullYear(),
                                    month.getMonth() + 1,
                                    0,
                                  ).getDate()) /
                                  7,
                              ) * 7,
                          },
                          (_, index) => {
                            const date = new Date(
                              month.getFullYear(),
                              month.getMonth(),
                              index - month.getDay() + 1,
                              12,
                            );
                            const currentMonth =
                                date.getMonth() === month.getMonth(),
                              selected = localDate(date) === localDate(draft),
                              today = localDate(date) === localDate();
                            return (
                              <View key={localDate(date)} style={s.dayCell}>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={localDate(date)}
                                  accessibilityHint={date.toLocaleDateString(
                                    undefined,
                                    {
                                      weekday: "long",
                                      day: "numeric",
                                      month: "long",
                                      year: "numeric",
                                    },
                                  )}
                                  accessibilityState={{
                                    selected,
                                    disabled: !dateAllowed(date),
                                  }}
                                  disabled={!dateAllowed(date)}
                                  onPress={() => {
                                    setDraft(date);
                                    if (!currentMonth)
                                      setMonth(
                                        new Date(
                                          date.getFullYear(),
                                          date.getMonth(),
                                          1,
                                          12,
                                        ),
                                      );
                                  }}
                                  style={[
                                    s.day,
                                    today && s.today,
                                    selected && s.choiceSelected,
                                    !dateAllowed(date) && { opacity: 0.22 },
                                  ]}
                                >
                                  <Text
                                    style={[
                                      s.dayText,
                                      !currentMonth && { color: c.muted },
                                      selected && { color: c.white },
                                    ]}
                                  >
                                    {date.getDate()}
                                  </Text>
                                  {today && (
                                    <View
                                      style={[
                                        s.todayDot,
                                        selected && {
                                          backgroundColor: c.white,
                                        },
                                      ]}
                                    />
                                  )}
                                </Pressable>
                              </View>
                            );
                          },
                        )}
                      </View>
                      <View style={[s.row, { gap: 8, marginTop: 12 }]}>
                        {[
                          ["Today", today],
                          [
                            "Tomorrow",
                            new Date(
                              today.getFullYear(),
                              today.getMonth(),
                              today.getDate() + 1,
                              12,
                            ),
                          ],
                        ].map(([label, value]) => {
                          const date = value as Date;
                          return dateAllowed(date) ? (
                            <Pressable
                              key={String(label)}
                              accessibilityRole="button"
                              onPress={() => {
                                const next = parseLocalDate(localDate(date))!;
                                setDraft(next);
                                setMonth(
                                  new Date(
                                    next.getFullYear(),
                                    next.getMonth(),
                                    1,
                                    12,
                                  ),
                                );
                              }}
                              style={s.shortcut}
                            >
                              <Text style={s.shortcutText}>
                                {String(label)}
                              </Text>
                            </Pressable>
                          ) : null;
                        })}
                        <Text
                          style={[
                            text.muted,
                            { fontSize: 11, flex: 1, textAlign: "right" },
                          ]}
                        >
                          Choose a day to get started
                        </Text>
                      </View>
                    </>
                  ) : (
                    <View style={s.options}>
                      {page === "months"
                        ? months.map((name, index) => (
                            <View key={name} style={s.option}>
                              {choice(
                                name.slice(0, 3),
                                index === month.getMonth(),
                                () => {
                                  setMonth(
                                    new Date(month.getFullYear(), index, 1, 12),
                                  );
                                  setPage("days");
                                },
                                !monthAllowed(month.getFullYear(), index),
                              )}
                            </View>
                          ))
                        : Array.from(
                            { length: 12 },
                            (_, index) => yearPage + index,
                          ).map((year) => (
                            <View key={year} style={s.option}>
                              {choice(
                                String(year),
                                year === month.getFullYear(),
                                () => {
                                  setMonth(
                                    new Date(year, month.getMonth(), 1, 12),
                                  );
                                  setPage("months");
                                },
                                year < Number(min.slice(0, 4)) ||
                                  year > Number(max.slice(0, 4)),
                              )}
                            </View>
                          ))}
                    </View>
                  )}
                </>
              ) : (
                <>
                  <View style={[s.row, { justifyContent: "center", gap: 10 }]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Select hour"
                      accessibilityState={{ selected: timePart === "hour" }}
                      onPress={() => setTimePart("hour")}
                      style={[s.digitBox, timePart === "hour" && s.digitActive]}
                    >
                      <Text style={s.digit}>
                        {String(draft.getHours() % 12 || 12).padStart(2, "0")}
                      </Text>
                      <Text style={s.digitCaption}>HOUR</Text>
                    </Pressable>
                    <Text style={s.colon}>:</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Select minute"
                      accessibilityState={{ selected: timePart === "minute" }}
                      onPress={() => setTimePart("minute")}
                      style={[
                        s.digitBox,
                        timePart === "minute" && s.digitActive,
                      ]}
                    >
                      <Text style={s.digit}>
                        {String(draft.getMinutes()).padStart(2, "0")}
                      </Text>
                      <Text style={s.digitCaption}>MINUTE</Text>
                    </Pressable>
                    <View style={{ gap: 6 }}>
                      {["AM", "PM"].map((period) =>
                        choice(
                          period,
                          period === (draft.getHours() >= 12 ? "PM" : "AM"),
                          () =>
                            updateTime(
                              (draft.getHours() % 12) +
                                (period === "PM" ? 12 : 0),
                              draft.getMinutes(),
                            ),
                        ),
                      )}
                    </View>
                  </View>
                  <Text
                    style={[
                      text.muted,
                      { textAlign: "center", marginVertical: 12 },
                    ]}
                  >
                    Tap an{" "}
                    {timePart === "hour"
                      ? "hour, then choose the minutes"
                      : "interval, or enter exact minutes below"}
                  </Text>
                  <View style={[s.dial, { width: size, height: size }]}>
                    <View
                      pointerEvents="none"
                      style={{
                        position: "absolute",
                        width: hand,
                        height: 3,
                        backgroundColor: c.coralBright,
                        left: center + (Math.cos(angle) * hand) / 2 - hand / 2,
                        top: center + (Math.sin(angle) * hand) / 2 - 1.5,
                        transform: [{ rotate: `${angle}rad` }],
                      }}
                    />
                    <View
                      pointerEvents="none"
                      style={[s.pivot, { left: center - 5, top: center - 5 }]}
                    />
                    {Array.from({ length: 12 }, (_, index) => {
                      const number =
                        timePart === "hour" ? index || 12 : index * 5;
                      const theta = (index / 12) * Math.PI * 2 - Math.PI / 2;
                      return (
                        <Pressable
                          key={number}
                          accessibilityRole="button"
                          accessibilityLabel={`${timePart === "hour" ? "Hour" : "Minute"} ${number}`}
                          accessibilityState={{
                            selected: selectedNumber === number,
                          }}
                          onPress={() => {
                            if (timePart === "hour") {
                              updateTime(
                                (number % 12) +
                                  (draft.getHours() >= 12 ? 12 : 0),
                                draft.getMinutes(),
                              );
                              setTimePart("minute");
                            } else updateTime(draft.getHours(), number);
                          }}
                          style={[
                            s.dialNumber,
                            {
                              left: center + Math.cos(theta) * radius - 20,
                              top: center + Math.sin(theta) * radius - 20,
                            },
                            selectedNumber === number && s.choiceSelected,
                          ]}
                        >
                          <Text
                            style={[
                              s.dayText,
                              selectedNumber === number && { color: c.white },
                              { fontSize: fontScale > 1.3 ? 13 : 16 },
                            ]}
                          >
                            {timePart === "hour"
                              ? number
                              : String(number).padStart(2, "0")}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {timePart === "minute" && (
                    <View style={[s.row, { gap: 12, marginTop: 14 }]}>
                      <Text style={[text.muted, { flex: 1 }]}>
                        Exact minute (00–59)
                      </Text>
                      <TextInput
                        accessibilityLabel="Exact minute"
                        value={minuteText}
                        onChangeText={(value) => {
                          const next = value.replace(/\D/g, "").slice(0, 2);
                          setMinuteText(next);
                          if (next && Number(next) <= 59) {
                            const date = new Date(draft);
                            date.setMinutes(Number(next));
                            setDraft(date);
                          }
                        }}
                        onBlur={() => {
                          if (validMinute)
                            setMinuteText(
                              String(Number(minuteText)).padStart(2, "0"),
                            );
                        }}
                        selectTextOnFocus
                        keyboardType="number-pad"
                        maxLength={2}
                        style={[
                          s.minuteInput,
                          !validMinute && { borderColor: "#BA4034" },
                        ]}
                      />
                    </View>
                  )}
                  {!validMinute && (
                    <Text
                      accessibilityRole="alert"
                      style={{ color: "#BA4034", marginTop: 6 }}
                    >
                      Choose a minute from 00 to 59.
                    </Text>
                  )}
                  <View
                    style={[s.row, { gap: 8, marginTop: 16, flexWrap: "wrap" }]}
                  >
                    {[
                      ["Morning", 9],
                      ["Afternoon", 13],
                      ["Evening", 18],
                    ].map(([name, hour]) => (
                      <Pressable
                        key={name}
                        accessibilityRole="button"
                        accessibilityLabel={`${name} time`}
                        onPress={() => {
                          updateTime(Number(hour), 0);
                          setTimePart("hour");
                        }}
                        style={s.shortcut}
                      >
                        <Text style={s.shortcutText}>{name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}
            </ScrollView>
            <View style={s.footer}>
              <View style={{ flex: 1 }}>
                <Button variant="outline" onPress={onClose}>
                  Cancel
                </Button>
              </View>
              <View style={{ flex: 1.3 }}>
                <Button
                  variant="coral"
                  disabled={
                    mode === "time" ? !validMinute : !dateAllowed(draft)
                  }
                  onPress={confirm}
                >
                  {mode === "date" ? "Confirm date" : "Set time"}
                </Button>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#093E437A",
  },
  modal: {
    flexShrink: 1,
    width: "100%",
    maxWidth: 440,
    backgroundColor: c.ivory,
    borderRadius: 28,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#FFFFFF88",
  },
  header: {
    backgroundColor: c.tealDark,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
  },
  row: { flexDirection: "row", alignItems: "center" },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#FFFFFF15",
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: "700",
    color: c.peach,
    flexShrink: 1,
  },
  headerLabel: {
    color: "#FFFFFFBB",
    fontSize: 13,
    marginBottom: 6,
    marginTop: 3,
  },
  preview: {
    color: c.white,
    fontSize: 25,
    lineHeight: 33,
    fontWeight: "700",
    letterSpacing: -0.6,
  },
  body: { padding: 16 },
  nav: {
    width: 40,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: c.soft,
  },
  monthButton: {
    minHeight: 44,
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
    paddingHorizontal: 3,
  },
  monthText: { color: c.teal, fontSize: 14, fontWeight: "700" },
  week: { flexDirection: "row", marginBottom: 6 },
  weekday: {
    width: "14.285714%",
    textAlign: "center",
    color: c.muted,
    fontSize: 11,
    fontWeight: "700",
    paddingVertical: 6,
  },
  days: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: "14.285714%", alignItems: "center", paddingVertical: 2 },
  day: {
    minHeight: 44,
    width: "100%",
    maxWidth: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  dayText: { color: c.teal, fontSize: 14, fontWeight: "600" },
  today: { borderColor: c.coralBright },
  todayDot: {
    position: "absolute",
    bottom: 4,
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: c.coralBright,
  },
  choiceSelected: {
    backgroundColor: c.coralBright,
    borderColor: c.coralBright,
  },
  shortcut: {
    borderWidth: 1,
    borderColor: c.line,
    backgroundColor: c.white,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 40,
    justifyContent: "center",
  },
  shortcutText: { color: c.teal, fontSize: 12, fontWeight: "600" },
  options: { flexDirection: "row", flexWrap: "wrap", marginVertical: 12 },
  option: { width: "33.333333%", padding: 4 },
  choice: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.soft,
    borderWidth: 1,
    borderColor: "transparent",
  },
  choiceText: { color: c.teal, fontSize: 13, fontWeight: "700" },
  digitBox: {
    minWidth: 76,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: c.soft,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  digitActive: { backgroundColor: "#FFE1D5", borderColor: c.coralBright },
  digit: { fontSize: 34, fontWeight: "700", color: c.teal },
  digitCaption: {
    fontSize: 9,
    letterSpacing: 1,
    color: c.teal,
    marginTop: 3,
    fontWeight: "700",
  },
  colon: { fontSize: 26, fontWeight: "600", color: c.teal },
  dial: {
    borderRadius: 140,
    backgroundColor: "#F3E7DC",
    alignSelf: "center",
    borderWidth: 1,
    borderColor: c.line,
  },
  dialNumber: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  pivot: {
    position: "absolute",
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: c.coralBright,
  },
  minuteInput: {
    width: 76,
    minHeight: 44,
    minWidth: 64,
    padding: 10,
    borderWidth: 1,
    borderColor: c.line,
    borderRadius: 12,
    backgroundColor: c.white,
    textAlign: "center",
    color: c.teal,
    fontSize: 16,
  },
  footer: {
    flexDirection: "row",
    gap: 10,
    padding: 16,
    borderTopWidth: 1,
    borderColor: c.line,
    backgroundColor: c.ivory,
  },
});
