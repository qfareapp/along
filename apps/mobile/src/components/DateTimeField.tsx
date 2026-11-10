import React, { useState } from "react";
import { Keyboard, Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { text } from "./ui";
import { colors as c } from "../theme";
import { parseLocalDate, type DateTimeFieldProps } from "./dateTime";
import { ThemedPickerModal } from "./ThemedPickerModal";

export default function DateTimeField(props: DateTimeFieldProps) {
  const { label, mode, value, onBlur, error } = props;
  const [open, setOpen] = useState(false);
  const close = () => {
    Keyboard.dismiss();
    setOpen(false);
    onBlur?.();
  };
  const formatted = !value
    ? `Choose ${mode}`
    : mode === "date"
      ? (parseLocalDate(value)?.toLocaleDateString(undefined, {
          day: "numeric",
          month: "short",
          year: "numeric",
        }) ?? value)
      : value;
  return (
    <View style={{ gap: 7, marginBottom: 15 }}>
      <Text style={text.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={`Opens the ${mode === "date" ? "calendar" : "clock"}`}
        accessibilityState={{ expanded: open }}
        accessibilityValue={{ text: formatted }}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        style={{
          minHeight: 54,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: error ? "#BA4034" : open ? c.coralBright : c.line,
          backgroundColor: "#FFFCF8",
        }}
      >
        <Text
          style={{
            flex: 1,
            color: value ? c.teal : c.muted,
            fontSize: 14,
            fontWeight: value ? "600" : "400",
          }}
        >
          {formatted}
        </Text>
        <View
          style={{
            width: 32,
            height: 32,
            backgroundColor: c.soft,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={mode === "date" ? "calendar-outline" : "time-outline"}
            size={18}
            color={c.teal}
          />
        </View>
      </Pressable>
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
