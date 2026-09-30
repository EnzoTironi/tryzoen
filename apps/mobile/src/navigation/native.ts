import * as Linking from "expo-linking";
import { BackHandler, Keyboard, Platform } from "react-native";

/** Warm links supersede startup discovery without retaining any URL payload. */
export function subscribeContentLinks(
  onLink: (url: string, source: "initial" | "event") => boolean,
  onError: () => void
): () => void {
  if (Platform.OS !== "ios" && Platform.OS !== "android")
    return () => undefined;
  let active = true;
  let receivedWarmLink = false;
  let subscription: ReturnType<typeof Linking.addEventListener>;
  try {
    subscription = Linking.addEventListener("url", ({ url }) => {
      if (!active) return;
      if (onLink(url, "event")) receivedWarmLink = true;
    });
  } catch {
    onError();
    return () => undefined;
  }
  const fail = () => {
    if (active && !receivedWarmLink) onError();
  };
  try {
    void Linking.getInitialURL().then((url) => {
      if (active && !receivedWarmLink && url !== null) onLink(url, "initial");
    }, fail);
  } catch {
    fail();
  }
  return () => {
    if (!active) return;
    active = false;
    subscription.remove();
  };
}

/** React Native Modal retains ownership of its own back/dismiss handling. */
export function subscribeAndroidBack(onBack: () => boolean): () => void {
  if (Platform.OS !== "android") return () => undefined;
  let active = true;
  const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
    if (!active) return false;
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      return true;
    }
    return onBack();
  });
  return () => {
    if (!active) return;
    active = false;
    subscription.remove();
  };
}
