import type { GesturePreferenceStorage } from "@zoen/companion-ui";

// Cosmetic device preference, with no account content or credentials.
const key = "zoen.message-gesture.v1";
export const browserGestureStorage: GesturePreferenceStorage = {
  read: () => Promise.resolve(localStorage.getItem(key)),
  write: (value) => {
    localStorage.setItem(key, value);
    return Promise.resolve();
  },
};
