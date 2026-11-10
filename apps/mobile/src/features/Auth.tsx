import React, { useRef, useState } from "react";
import DateTimeField from "../components/DateTimeField";
import { adultBirthDateLimit, parseLocalDate } from "../components/dateTime";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Field,
  IconButton,
  Logo,
  Notice,
  Screen,
  text,
} from "../components/ui";
import { api, demoMode, storeSession } from "../services/api";
import { useAlong } from "../store/useAlong";
import { colors as c } from "../theme";
import { useOnboarding } from "../store/useOnboarding";
import {
  draftFromServer,
  syncDraft,
  type Completion,
} from "../services/onboarding";
import { useQueryClient } from "@tanstack/react-query";

const formSchema = z.object({
  email: z
    .string()
    .trim()
    .pipe(z.email("Enter a valid email.").max(254))
    .transform((value) => value.toLowerCase()),
  password: z.string().min(10, "Use at least 10 characters.").max(72),
  name: z.string().trim().min(2, "Enter at least 2 characters.").max(60),
  birthDate: z.string().refine((value) => {
    const date = parseLocalDate(value);
    return (
      !!date &&
      value <= adultBirthDateLimit() &&
      date.getFullYear() >= new Date().getFullYear() - 120
    );
  }, "Enter a valid date of birth. Along is for adults 18 and over."),
});
type Values = z.infer<typeof formSchema>;
export default function Auth() {
  const params = useLocalSearchParams<{
    mode?: string;
    reason?: string;
    onboarding?: string;
  }>();
  const client = useQueryClient();
  const [register, setRegister] = useState(params.mode === "register");
  const [step, setStep] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const steps: (keyof Values)[] = register
    ? ["email", "password", "name", "birthDate"]
    : ["email", "password"];
  const fieldName = steps[step];
  const lastStep = step === steps.length - 1;
  const [error, setError] = useState(
    params.reason === "access_changed"
      ? "Your account access or session has changed. Sign in again, or contact support to appeal a restriction."
      : "",
  );
  const {
    control,
    trigger,
    getValues,
    clearErrors,
    setValue,
    formState: { errors },
  } = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "", name: "", birthDate: "" },
  });
  const [busy, setBusy] = useState(false);
  const advancing = useRef(false);
  const titles = {
    email: register ? "Let’s start with your email." : "Welcome back.",
    password: register ? "Make it yours." : "Your password?",
    name: "What should we call you?",
    birthDate: "When’s your birthday?",
  };
  const descriptions = {
    email: register
      ? "A little closer to your kind of people."
      : "Sign in to pick up where you left off.",
    password: register
      ? "Choose a password with 10–72 characters."
      : `Signing in as ${getValues("email").trim()}`,
    name: "Your first name is all we need.",
    birthDate: "Your birthday stays private. Along is for adults 18 and over.",
  };
  async function next() {
    if (advancing.current) return;
    advancing.current = true;
    setBusy(true);
    try {
      if (!(await trigger(fieldName))) return;
      setError("");
      if (!lastStep) {
        setStep(step + 1);
        setShowPassword(false);
        return;
      }
      await submit(getValues());
    } finally {
      advancing.current = false;
      setBusy(false);
    }
  }
  function back() {
    if (busy) return;
    setError("");
    setShowPassword(false);
    if (step > 0) setStep(step - 1);
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  }
  async function submit(values: Values) {
    setError("");
    const parsed = (
      register ? formSchema : formSchema.pick({ email: true, password: true })
    ).safeParse(values);
    if (!parsed.success) {
      const invalid = parsed.error.issues[0]?.path[0] as keyof Values;
      const index = steps.indexOf(invalid);
      if (index >= 0) setStep(index);
      await trigger(invalid);
      return;
    }
    try {
      const result = await api<{
        accessToken: string;
        refreshToken: string;
        user: { name: string };
      }>(`/auth/${register ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify(parsed.data),
      });
      await storeSession(result.accessToken, result.refreshToken);
      client.clear();
      const draft = useOnboarding.getState().draft;
      if (register && draft.completed) {
        try {
          await syncDraft(draft);
        } catch {
          /* The persisted draft is retried from the preview; registration has succeeded. */
        }
      } else {
        useOnboarding.getState().reset();
        try {
          const value = await api<Completion>("/onboarding");
          useOnboarding.getState().patch(draftFromServer(value));
        } catch {
          /* Profile reload offers retry after authentication. */
        }
      }
      useAlong.getState().update({ name: result.user.name, welcomed: true });
      router.replace(
        useOnboarding.getState().draft.completed ? "/(tabs)" : "/onboarding",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to sign in.");
    }
  }
  return (
    <Screen width="reading" contentStyle={{ flexGrow: 1 }}>
      <View
        style={{ flex: 1, width: "100%", maxWidth: 440, alignSelf: "center" }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 28,
          }}
        >
          <IconButton icon="chevron-back" label="Back" onPress={back} />
          <Logo />
          <Text style={text.muted}>
            {step + 1} of {steps.length}
          </Text>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel={
            register ? "Create account progress" : "Sign in progress"
          }
          accessibilityValue={{ min: 0, max: steps.length, now: step + 1 }}
          style={{ flexDirection: "row", gap: 6, marginBottom: 36 }}
        >
          {steps.map((name, index) => (
            <View
              key={name}
              style={{
                height: 4,
                borderRadius: 2,
                flex: 1,
                backgroundColor: index <= step ? c.teal : c.line,
              }}
            />
          ))}
        </View>
        <Text
          accessibilityRole="header"
          style={[
            text.title,
            { fontSize: 30, lineHeight: 37, marginBottom: 12 },
          ]}
        >
          {titles[fieldName]}
        </Text>
        <Text style={[text.muted, { marginBottom: 30 }]}>
          {descriptions[fieldName]}
        </Text>
        {[fieldName].map((name) => {
          return (
            <Controller
              key={name}
              control={control}
              name={name}
              render={({ field: { value, onChange, onBlur } }) =>
                name === "birthDate" ? (
                  <DateTimeField
                    label="Date of birth"
                    mode="date"
                    value={value}
                    onChange={(value) => {
                      onChange(value);
                      clearErrors(name);
                      setError("");
                    }}
                    onBlur={onBlur}
                    maximumDate={adultBirthDateLimit()}
                    error={errors[name]?.message}
                  />
                ) : (
                  <Field
                    label={
                      {
                        name: "First name",
                        birthDate: "Date of birth",
                        email: "Email address",
                        password: "Password",
                      }[name]
                    }
                    value={value}
                    onChangeText={(value) => {
                      onChange(value);
                      clearErrors(name);
                      setError("");
                    }}
                    onBlur={onBlur}
                    placeholder={
                      name === "email"
                        ? "you@example.com"
                        : name === "password"
                          ? "At least 10 characters"
                          : "Your first name"
                    }
                    autoCapitalize={name === "name" ? "words" : "none"}
                    keyboardType={
                      name === "email" ? "email-address" : "default"
                    }
                    secureTextEntry={name === "password" && !showPassword}
                    editable={!busy}
                    autoCorrect={false}
                    autoComplete={
                      name === "email"
                        ? "email"
                        : name === "password"
                          ? register
                            ? "new-password"
                            : "current-password"
                          : "given-name"
                    }
                    returnKeyType={lastStep ? "go" : "next"}
                    onSubmitEditing={() => void next()}
                    error={errors[name]?.message}
                  />
                )
              }
            />
          );
        })}
        {fieldName === "password" && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              showPassword ? "Hide password" : "Show password"
            }
            onPress={() => setShowPassword(!showPassword)}
            style={{
              alignSelf: "flex-end",
              minHeight: 44,
              justifyContent: "center",
              marginBottom: 12,
            }}
          >
            <Text style={{ color: c.teal, fontWeight: "600" }}>
              {showPassword ? "Hide password" : "Show password"}
            </Text>
          </Pressable>
        )}
        {error ? (
          <Text
            accessibilityRole="alert"
            style={{ color: "#BA4034", marginBottom: 16 }}
          >
            {error}
          </Text>
        ) : null}
        <Button loading={busy} onPress={() => void next()}>
          {lastStep ? (register ? "Create Account" : "Sign In") : "Continue"}
        </Button>
        <Pressable
          accessibilityRole="button"
          style={{ padding: 20 }}
          disabled={busy}
          onPress={() => {
            setRegister(!register);
            setStep(0);
            setValue("password", "");
            setShowPassword(false);
            clearErrors();
            setError("");
          }}
        >
          <Text style={{ textAlign: "center", color: c.coralBright }}>
            {register
              ? "Already a member? Sign in"
              : "New here? Create an account"}
          </Text>
        </Pressable>
        {demoMode && (
          <Notice>
            Sign in uses your connected server. You can also explore the design
            preview without an account.
          </Notice>
        )}
        {demoMode && (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/onboarding")}
            style={{ padding: 16 }}
          >
            <Text style={{ color: c.teal, textAlign: "center" }}>
              Explore the preview
            </Text>
          </Pressable>
        )}
        {register && lastStep && (
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/policies")}
            style={{ paddingVertical: 16 }}
          >
            <Text style={[text.muted, { textAlign: "center", fontSize: 12 }]}>
              By creating an account, you agree to our Terms & Community
              Guidelines.
            </Text>
          </Pressable>
        )}
        <Text
          style={[
            text.muted,
            {
              textAlign: "center",
              fontSize: 11,
              marginTop: "auto",
              paddingTop: 24,
            },
          ]}
        >
          Adults 18+ only. Be kind. Respect every boundary.
        </Text>
      </View>
    </Screen>
  );
}
