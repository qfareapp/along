import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type GestureResponderEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { colors as c } from "../theme";

export type CropRatio = "original" | "square" | "portrait" | "landscape";
export type CroppedPhoto = { uri: string; width: number; height: number };

const RATIOS: { key: CropRatio; label: string; value?: number }[] = [
  { key: "original", label: "Original" },
  { key: "square", label: "1:1", value: 1 },
  { key: "portrait", label: "4:5", value: 4 / 5 },
  { key: "landscape", label: "16:9", value: 16 / 9 },
];
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));
const distance = (event: GestureResponderEvent) => {
  const [a, b] = event.nativeEvent.touches;
  return a && b ? Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) : 0;
};

/**
 * Full-screen crop tool: choose a frame shape, drag to position and pinch
 * (or use the zoom buttons) to scale. Returns a new JPEG of just the framed area.
 */
export function PhotoCropper({
  uri,
  initialRatio = "portrait",
  onCancel,
  onDone,
}: {
  /** Mount with `key={uri}` so each photo starts from a fresh frame. */
  uri: string;
  initialRatio?: CropRatio;
  onCancel: () => void;
  onDone: (photo: CroppedPhoto, ratio: CropRatio) => void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [ratio, setRatio] = useState<CropRatio>(initialRatio);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");

  // Measure in the manipulator's own pixel space so crop coordinates match it.
  useEffect(() => {
    let cancelled = false;
    const context = ImageManipulator.manipulate(uri);
    context
      .renderAsync()
      .then((image) => {
        if (!cancelled) setSize({ width: image.width, height: image.height });
        image.release();
      })
      .catch(() => {
        if (!cancelled) setError("This photo could not be opened.");
      })
      .finally(() => context.release());
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const aspect =
    RATIOS.find((r) => r.key === ratio)?.value ??
    (size ? size.width / size.height : 1);
  // Fit the frame inside the available area, leaving room for the controls.
  const maxWidth = Math.min(window.width - 32, 520);
  const maxHeight = Math.max(
    220,
    window.height - insets.top - insets.bottom - 260,
  );
  const frame =
    maxWidth / aspect <= maxHeight
      ? { width: maxWidth, height: maxWidth / aspect }
      : { width: maxHeight * aspect, height: maxHeight };
  const baseScale = size
    ? Math.max(frame.width / size.width, frame.height / size.height)
    : 1;
  const scale = baseScale * zoom;
  const shown = size
    ? { width: size.width * scale, height: size.height * scale }
    : frame;
  const limit = {
    x: Math.max(0, (shown.width - frame.width) / 2),
    y: Math.max(0, (shown.height - frame.height) / 2),
  };
  const position = {
    x: clamp(offset.x, -limit.x, limit.x),
    y: clamp(offset.y, -limit.y, limit.y),
  };

  // Where the current touch began: offset, zoom and pinch distance.
  const gesture = useRef({
    x: 0,
    y: 0,
    pageX: 0,
    pageY: 0,
    zoom: 1,
    distance: 0,
  });
  const begin = (event: GestureResponderEvent) => {
    const touch = event.nativeEvent.touches[0] ?? event.nativeEvent;
    gesture.current = {
      x: position.x,
      y: position.y,
      pageX: touch.pageX,
      pageY: touch.pageY,
      zoom,
      distance: distance(event),
    };
  };
  const touchHandlers = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: begin,
    onResponderMove: (event: GestureResponderEvent) => {
      const pinch = distance(event);
      if (pinch) {
        if (!gesture.current.distance) begin(event);
        else
          setZoom(
            clamp(
              (gesture.current.zoom * pinch) / gesture.current.distance,
              1,
              MAX_ZOOM,
            ),
          );
        return;
      }
      // A pinch just ended with one finger down: continue dragging from here.
      if (gesture.current.distance) return begin(event);
      const touch = event.nativeEvent.touches[0] ?? event.nativeEvent;
      setOffset({
        x: gesture.current.x + touch.pageX - gesture.current.pageX,
        y: gesture.current.y + touch.pageY - gesture.current.pageY,
      });
    },
    // Settle the stored offset inside the bounds so the next drag starts there.
    onResponderRelease: () => setOffset(position),
  };

  async function finish() {
    if (!size || busy) return;
    setBusy(true);
    setError("");
    const left = frame.width / 2 + position.x - shown.width / 2;
    const top = frame.height / 2 + position.y - shown.height / 2;
    const width = Math.min(size.width, Math.round(frame.width / scale));
    const height = Math.min(size.height, Math.round(frame.height / scale));
    const originX = clamp(Math.round(-left / scale), 0, size.width - width);
    const originY = clamp(Math.round(-top / scale), 0, size.height - height);
    const context = ImageManipulator.manipulate(uri);
    let rendered;
    try {
      const untouched =
        originX === 0 &&
        originY === 0 &&
        width === size.width &&
        height === size.height;
      if (!untouched) context.crop({ originX, originY, width, height });
      rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.92,
      });
      onDone(
        { uri: saved.uri, width: saved.width, height: saved.height },
        ratio,
      );
    } catch {
      setError("Could not crop this photo. Please try again.");
    } finally {
      rendered?.release();
      context.release();
      setBusy(false);
    }
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "#111618",
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 12,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 12,
            minHeight: 56,
          }}
        >
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            hitSlop={8}
            style={{ padding: 8 }}
          >
            <Text style={{ color: c.white, fontSize: 15 }}>Cancel</Text>
          </Pressable>
          <Text style={{ color: c.white, fontSize: 16, fontWeight: "700" }}>
            Crop photo
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={!size || busy}
            onPress={() => void finish()}
            hitSlop={8}
            style={{ padding: 8, opacity: !size ? 0.4 : 1 }}
          >
            {busy ? (
              <ActivityIndicator color={c.coralBright} />
            ) : (
              <Text
                style={{
                  color: c.coralBright,
                  fontSize: 15,
                  fontWeight: "700",
                }}
              >
                Done
              </Text>
            )}
          </Pressable>
        </View>

        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        >
          {!size ? (
            error ? (
              <Text style={{ color: c.white }}>{error}</Text>
            ) : (
              <ActivityIndicator color={c.white} />
            )
          ) : (
            <View
              {...touchHandlers}
              accessibilityLabel="Drag to position the photo, pinch to zoom"
              style={{
                width: frame.width,
                height: frame.height,
                overflow: "hidden",
                borderRadius: 4,
                backgroundColor: "#000",
              }}
            >
              <Image
                source={{ uri }}
                style={{
                  position: "absolute",
                  width: shown.width,
                  height: shown.height,
                  left: frame.width / 2 + position.x - shown.width / 2,
                  top: frame.height / 2 + position.y - shown.height / 2,
                }}
              />
              <Grid />
            </View>
          )}
        </View>

        {!!error && !!size && (
          <Text
            accessibilityRole="alert"
            style={{ color: "#FF9C8F", textAlign: "center", marginBottom: 8 }}
          >
            {error}
          </Text>
        )}

        <View style={{ gap: 14, paddingHorizontal: 16 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 14,
            }}
          >
            <ZoomButton
              icon="remove"
              label="Zoom out"
              disabled={zoom <= 1}
              onPress={() => setZoom((z) => clamp(z - ZOOM_STEP, 1, MAX_ZOOM))}
            />
            <Text
              style={{
                color: "#C9CED0",
                fontSize: 12,
                minWidth: 120,
                textAlign: "center",
              }}
            >
              Drag to position · {zoom.toFixed(1)}×
            </Text>
            <ZoomButton
              icon="add"
              label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onPress={() => setZoom((z) => clamp(z + ZOOM_STEP, 1, MAX_ZOOM))}
            />
          </View>
          <View
            style={{ flexDirection: "row", justifyContent: "center", gap: 8 }}
          >
            {RATIOS.map((option) => {
              const selected = option.key === ratio;
              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Crop ${option.label}`}
                  onPress={() => {
                    setRatio(option.key);
                    setZoom(1);
                    setOffset({ x: 0, y: 0 });
                  }}
                  style={{
                    flex: 1,
                    maxWidth: 96,
                    alignItems: "center",
                    gap: 6,
                    paddingVertical: 10,
                    borderRadius: 14,
                    backgroundColor: selected ? "#FFFFFF1F" : "transparent",
                  }}
                >
                  <RatioIcon
                    aspect={
                      option.value ?? (size ? size.width / size.height : 3 / 4)
                    }
                    selected={selected}
                  />
                  <Text
                    style={{
                      color: selected ? c.white : "#9DA5A8",
                      fontSize: 12,
                      fontWeight: selected ? "700" : "500",
                    }}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Grid() {
  const line = { position: "absolute", backgroundColor: "#FFFFFF55" } as const;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        inset: 0,
        borderWidth: 1,
        borderColor: "#FFFFFFAA",
      }}
    >
      {[1, 2].map((i) => (
        <React.Fragment key={i}>
          <View
            style={[
              line,
              { left: `${(i * 100) / 3}%`, top: 0, bottom: 0, width: 1 },
            ]}
          />
          <View
            style={[
              line,
              { top: `${(i * 100) / 3}%`, left: 0, right: 0, height: 1 },
            ]}
          />
        </React.Fragment>
      ))}
    </View>
  );
}

function RatioIcon({
  aspect,
  selected,
}: {
  aspect: number;
  selected: boolean;
}) {
  const box = 22;
  const width = aspect >= 1 ? box : box * aspect;
  const height = aspect >= 1 ? box / aspect : box;
  return (
    <View
      style={{
        width: box,
        height: box,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width,
          height,
          borderRadius: 3,
          borderWidth: 2,
          borderColor: selected ? c.coralBright : "#9DA5A8",
        }}
      />
    </View>
  );
}

function ZoomButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: "add" | "remove";
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#FFFFFF1A",
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Ionicons name={icon} size={20} color={c.white} />
    </Pressable>
  );
}
