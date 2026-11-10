import React from "react";
import { Text, View } from "react-native";
import { Chip, Field, text } from "../components/ui";
import DateTimeField from "../components/DateTimeField";
import { localDate } from "../components/dateTime";
import {
  fieldsForCategory,
  type PlanDetails,
} from "../../../../packages/plan-details/index.js";

export function CategoryPlanFields({
  category,
  details,
  onChange,
  errors,
  minimumDate,
}: {
  category: string;
  details: PlanDetails;
  onChange: (details: PlanDetails) => void;
  errors: Record<string, string>;
  minimumDate?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      {fieldsForCategory(category).map((field) => {
        const value = details[field.key];
        if (field.kind === "date" || field.kind === "time")
          return (
            <DateTimeField
              key={field.key}
              label={field.label}
              mode={field.kind}
              value={typeof value === "string" ? value : ""}
              onChange={(next) => onChange({ ...details, [field.key]: next })}
              minimumDate={
                field.kind === "date" ? minimumDate || localDate() : undefined
              }
              error={errors[field.key]}
            />
          );
        if (field.kind === "choice" || field.kind === "days") {
          return (
            <View key={field.key} style={{ marginBottom: 20 }}>
              <Text style={[text.label, { marginBottom: 10 }]}>
                {field.label}
              </Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {field.options?.map((option) => (
                  <Chip
                    key={option}
                    selected={
                      Array.isArray(value)
                        ? value.includes(option)
                        : value === option
                    }
                    onPress={() =>
                      onChange({
                        ...details,
                        [field.key]:
                          field.kind === "days"
                            ? Array.isArray(value) && value.includes(option)
                              ? value.filter((day) => day !== option)
                              : [...(Array.isArray(value) ? value : []), option]
                            : option,
                      })
                    }
                  >
                    {option}
                  </Chip>
                ))}
              </View>
              {!!errors[field.key] && (
                <Text
                  accessibilityRole="alert"
                  style={{ color: "#BA4034", marginTop: 6 }}
                >
                  {errors[field.key]}
                </Text>
              )}
            </View>
          );
        }
        return (
          <Field
            key={field.key}
            label={field.label}
            placeholder={field.placeholder}
            value={typeof value === "string" ? value : ""}
            onChangeText={(next) => onChange({ ...details, [field.key]: next })}
            maxLength={300}
            keyboardType={field.kind === "number" ? "number-pad" : "default"}
            autoCapitalize="sentences"
            error={errors[field.key]}
          />
        );
      })}
    </View>
  );
}

export function CategoryPlanSummary({
  category,
  details,
}: {
  category: string;
  details?: PlanDetails;
}) {
  if (!details || !Object.keys(details).length) return null;
  return (
    <View style={{ gap: 13, marginBottom: 24 }}>
      <Text style={[text.title, { fontSize: 21 }]}>Plan details</Text>
      {fieldsForCategory(category).map((field) => {
        const value = details[field.key];
        if (!value || (Array.isArray(value) && !value.length)) return null;
        return (
          <View key={field.key}>
            <Text style={text.muted}>
              {field.label.replace(" (optional)", "")}
            </Text>
            <Text style={text.body}>
              {Array.isArray(value)
                ? field.options?.filter((day) => value.includes(day)).join(", ")
                : value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
