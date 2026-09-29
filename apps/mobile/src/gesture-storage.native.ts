import * as SecureStore from "expo-secure-store";
import type { GesturePreferenceStorage } from "@zoen/companion-ui";

const key = "zoen.message-gesture.v1";
export const gestureStorage: GesturePreferenceStorage = {
  read: () => SecureStore.getItemAsync(key),
  write: (value) => SecureStore.setItemAsync(key, value),
};
