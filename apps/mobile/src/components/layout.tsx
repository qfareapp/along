import React, { createContext, useContext, type ReactNode } from "react";
import { useWindowDimensions } from "react-native";

export const APP_MAX_WIDTH = 1440;
export const SIDE_NAV_WIDTH = 104;
const ContentWidth = createContext<number | undefined>(undefined);

/** Actual available scene width, including when a tablet is in split-screen mode. */
export function LayoutWidthProvider({
  width,
  children,
}: {
  width: number;
  children: ReactNode;
}) {
  return (
    <ContentWidth.Provider value={width}>{children}</ContentWidth.Provider>
  );
}
export function useAppLayout() {
  const window = useWindowDimensions();
  const sceneWidth = useContext(ContentWidth);
  const shellWidth = Math.min(window.width, APP_MAX_WIDTH);
  const width = sceneWidth ?? shellWidth;
  const isTablet = shellWidth >= 768;
  const padding = isTablet ? 28 : 22;
  const gridWidth = Math.min(width, 1200) - padding * 2;
  const minTileWidth = window.fontScale > 1.3 ? 220 : 180;
  const categoryColumns = Math.max(
    width < 360 || window.fontScale >= 1.6 ? 1 : 2,
    Math.min(4, Math.floor((gridWidth + 16) / (minTileWidth + 16))),
  );
  const planColumns = gridWidth >= 720 && window.fontScale <= 1.3 ? 2 : 1;
  return {
    width,
    shellWidth,
    height: window.height,
    fontScale: window.fontScale,
    isTablet,
    padding,
    categoryColumns,
    planColumns,
    gridWidth,
  };
}
