import React from "react";
import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors as c } from "../../theme";
import { useUnreadCount } from "../../services/chat";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  LayoutWidthProvider,
  SIDE_NAV_WIDTH,
  useAppLayout,
} from "../../components/layout";
import { ExpiredPlanPrompt } from "../../features/ExpiredPlanPrompt";
export default function TabLayout() {
  const unread = useUnreadCount();
  const layout = useAppLayout();
  const insets = useSafeAreaInsets();
  const sidebar = layout.isTablet;
  return (
    <LayoutWidthProvider
      width={layout.shellWidth - (sidebar ? SIDE_NAV_WIDTH : 0)}
    >
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.coralBright,
          tabBarInactiveTintColor: "#838787",
          tabBarPosition: sidebar ? "left" : "bottom",
          tabBarVariant: sidebar ? "material" : "uikit",
          tabBarLabelPosition: "below-icon",
          tabBarStyle: sidebar
            ? {
                width: SIDE_NAV_WIDTH,
                backgroundColor: "#FFFBF7",
                borderRightWidth: 1,
                borderRightColor: c.line,
                paddingTop: Math.max(24, insets.top),
                paddingBottom: Math.max(16, insets.bottom),
              }
            : {
                backgroundColor: "#FFFBF7",
                borderTopColor: "#F0E3D9",
                height: Math.max(76, 60 + insets.bottom),
                paddingBottom: Math.max(14, insets.bottom),
                paddingTop: 9,
              },
          tabBarLabelStyle: { fontSize: sidebar ? 12 : 10, marginTop: 3 },
          tabBarItemStyle: sidebar
            ? { minHeight: 76, marginVertical: 4 }
            : undefined,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: "Discover",
            tabBarIcon: ({ color }) => (
              <Ionicons
                name="compass-outline"
                size={23}
                color={String(color)}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="plans"
          options={{
            title: "Plans",
            tabBarIcon: ({ color }) => (
              <Ionicons
                name="calendar-outline"
                size={23}
                color={String(color)}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="social"
          options={{
            title: "Social",
            tabBarIcon: ({ color }) => (
              <Ionicons
                name="sparkles-outline"
                size={25}
                color={String(color)}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="chat"
          options={{
            title: "Chat",
            tabBarBadge: unread ? (unread > 9 ? "9+" : unread) : undefined,
            tabBarBadgeStyle: { backgroundColor: c.coralBright, fontSize: 10 },
            tabBarIcon: ({ color }) => (
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={23}
                color={String(color)}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color }) => (
              <Ionicons name="person-outline" size={23} color={String(color)} />
            ),
          }}
        />
      </Tabs>
      <ExpiredPlanPrompt />
    </LayoutWidthProvider>
  );
}
