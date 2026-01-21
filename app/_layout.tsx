import * as NavigationBar from 'expo-navigation-bar';
import { Stack } from "expo-router";
import { useEffect } from "react";

export default function RootLayout() {
  
  useEffect(() => {
    // Android alt barını (siyah navigasyon) gizle
    NavigationBar.setVisibilityAsync("hidden");
    NavigationBar.setBehaviorAsync("overlay-swipe");
    NavigationBar.setBackgroundColorAsync("#00000000");
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Burası senin index.tsx dosyanı tam ekran gösterecek */}
      <Stack.Screen name="index" />
    </Stack>
  );
}