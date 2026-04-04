"use client";

import type { ReactNode } from "react";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";

const theme = createTheme({
  primaryColor: "cyan",
  defaultRadius: "md",
  fontFamily: "var(--font-geist-sans), sans-serif",
  fontFamilyMonospace: "var(--font-geist-mono), monospace",
  headings: {
    fontFamily: "var(--font-geist-sans), sans-serif",
  },
  colors: {
    dark: [
      "#c5d0db",
      "#a7b3c0",
      "#8896a6",
      "#6d7988",
      "#53606f",
      "#3b4654",
      "#29313c",
      "#171d24",
      "#11161d",
      "#0a0f14",
    ],
  },
});

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <MantineProvider theme={theme} forceColorScheme="dark">
      <Notifications position="bottom-right" />
      {children}
    </MantineProvider>
  );
}
