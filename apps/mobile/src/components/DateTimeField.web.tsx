import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { text } from "./ui";
import { colors as c } from "../theme";
import type { DateTimeFieldProps } from "./dateTime";
import { ThemedPickerModal } from "./ThemedPickerModal";

export default function DateTimeField(props: DateTimeFieldProps) {
  const {
    label,
    mode,
    value,
    onChange,
    onBlur,
    error,
    minimumDate,
    maximumDate,
  } = props;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        onBlur?.();
      }
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [open, onBlur]);
  const close = () => {
    setOpen(false);
    onBlur?.();
  };
  return (
    <View style={{ gap: 7, marginBottom: 15 }}>
      <Text style={text.label}>{label}</Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          minHeight: 54,
          paddingRight: 10,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: error ? "#BA4034" : open ? c.coralBright : c.line,
          backgroundColor: "#FFFCF8",
        }}
      >
        <style>{`.along-date-time::-webkit-calendar-picker-indicator { display: none; }`}</style>
        <input
          className="along-date-time"
          type={mode}
          aria-label={label}
          aria-invalid={!!error}
          aria-haspopup="dialog"
          aria-expanded={open}
          value={value}
          min={mode === "date" ? minimumDate : undefined}
          max={mode === "date" ? maximumDate : undefined}
          onChange={(event) => onChange(event.currentTarget.value)}
          onBlur={onBlur}
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" ||
              event.key === " " ||
              (event.altKey && event.key === "ArrowDown")
            ) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          style={{
            boxSizing: "border-box",
            flex: 1,
            width: "100%",
            minWidth: 0,
            minHeight: 52,
            padding: "12px",
            border: 0,
            outlineOffset: -3,
            borderRadius: 16,
            backgroundColor: "transparent",
            color: c.teal,
            fontFamily: "inherit",
            fontSize: 14,
            fontWeight: 600,
            colorScheme: "light",
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Choose ${label}`}
          onPress={() => setOpen(true)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 11,
            backgroundColor: c.soft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={mode === "date" ? "calendar-outline" : "time-outline"}
            size={18}
            color={c.teal}
          />
        </Pressable>
      </View>
      {!!error && (
        <Text
          accessibilityRole="alert"
          style={{ color: "#BA4034", fontSize: 12 }}
        >
          {error}
        </Text>
      )}
      {open && <ThemedPickerModal {...props} onClose={close} />}
    </View>
  );
}
