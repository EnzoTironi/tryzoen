import { useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  ActionButton,
  CompanionShell,
  Welcome,
  type CompanionSection,
} from "@zoen/companion-ui";

const paths: Record<CompanionSection, string> = {
  chat: "/companion",
  search: "/chat/history",
  feed: "/insights",
  ideas: "/recipes",
  goals: "/tasks",
  library: "/space/knowledge",
  settings: "/account",
};

export function App() {
  const [section, setSection] = useState<CompanionSection>("chat");
  const [notice, setNotice] = useState(false);
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        {/* oxlint-disable-next-line react/style-prop-object -- Expo StatusBar uses a named style, not a React Native style object. */}
        <StatusBar style="dark" />
        <Text style={styles.preview}>
          Interface preview · Mobile sign-in is not connected
        </Text>
        <CompanionShell
          section={section}
          onNavigate={setSection}
          onNewConversation={() => {
            setSection("chat");
            setNotice(false);
          }}
        >
          {section === "chat" && !notice ? (
            <Welcome
              onSend={() => {
                setNotice(true);
                return Promise.resolve();
              }}
            />
          ) : (
            <ScrollView contentContainerStyle={styles.page}>
              <View style={styles.card}>
                <Text accessibilityRole="header" style={styles.title}>
                  {notice
                    ? "Your companion, coming with you."
                    : section.charAt(0).toUpperCase() + section.slice(1)}
                </Text>
                <Text style={styles.copy}>
                  This is the shared interface preview. Mobile sign-in and
                  account data are not connected yet. Your existing Zoen
                  workspace is available on the web.
                </Text>
                <ActionButton
                  onPress={() => {
                    void Linking.openURL(
                      `https://app.tryzoen.com${paths[section]}`
                    );
                  }}
                >
                  Open Zoen on the web
                </ActionButton>
                <ActionButton
                  quiet
                  onPress={() => {
                    setSection("chat");
                    setNotice(false);
                  }}
                >
                  Back to conversation
                </ActionButton>
              </View>
            </ScrollView>
          )}
        </CompanionShell>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  preview: {
    padding: 8,
    backgroundColor: "#eef0e7",
    color: "#556b4e",
    textAlign: "center",
    fontSize: 12,
  },
  safeArea: { flex: 1, backgroundColor: "#fcfbf8" },
  page: {
    flexGrow: 1,
    padding: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  card: { maxWidth: 480, gap: 20 },
  title: { fontSize: 28, fontWeight: "500", color: "#242421" },
  copy: { fontSize: 16, lineHeight: 25, color: "#7c7b75" },
});
