import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

const api = process.env.EXPO_PUBLIC_SESSIONS_API_URL ?? "http://localhost:4000";

type Session = {
  id: string;
  objective: string;
  repository_id: string;
  status: string;
  created_at: string;
};

export default function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch(`${api}/api/sessions`);
      if (!response.ok) throw new Error(`API ${response.status}`);
      setSessions(await response.json());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <View><Text style={styles.eyebrow}>SESSIONS</Text><Text style={styles.title}>Engineering status</Text></View>
        <Pressable style={styles.refresh} onPress={() => void load()}><Text style={styles.refreshText}>Refresh</Text></Pressable>
      </View>
      <Text style={styles.subtitle}>Approvals, failures, verification, and recovery context while you are away from your workstation.</Text>
      {loading ? <ActivityIndicator style={styles.loader} /> : error ? <Text style={styles.error}>{error}</Text> : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Text style={styles.empty}>No Sessions yet.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}><Text style={styles.repo}>{item.repository_id}</Text><Text style={styles.status}>{item.status}</Text></View>
              <Text style={styles.objective}>{item.objective}</Text>
              <Text style={styles.meta}>{new Date(item.created_at).toLocaleString()}</Text>
              <Text style={styles.actionHint}>Open the web or VS Code surface for detailed replay and rollback controls.</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#090d14", paddingHorizontal: 18 },
  header: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  eyebrow: { color: "#60a5fa", fontSize: 12, fontWeight: "700", letterSpacing: 2 },
  title: { color: "#f8fafc", fontSize: 28, fontWeight: "700", marginTop: 4 },
  subtitle: { color: "#94a3b8", lineHeight: 21, marginTop: 12, marginBottom: 18 },
  refresh: { borderWidth: 1, borderColor: "#334155", borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  refreshText: { color: "#e2e8f0", fontWeight: "600" },
  loader: { marginTop: 48 },
  error: { color: "#fca5a5", marginTop: 24 },
  list: { paddingBottom: 32, gap: 12 },
  empty: { color: "#94a3b8", marginTop: 24 },
  card: { backgroundColor: "#111827", borderWidth: 1, borderColor: "#1f2937", borderRadius: 16, padding: 16 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  repo: { color: "#93c5fd", fontSize: 12, fontWeight: "700" },
  status: { color: "#fbbf24", fontSize: 12, textTransform: "uppercase" },
  objective: { color: "#f8fafc", fontSize: 17, fontWeight: "700", marginTop: 10, lineHeight: 23 },
  meta: { color: "#64748b", fontSize: 12, marginTop: 8 },
  actionHint: { color: "#94a3b8", fontSize: 13, lineHeight: 18, marginTop: 14 },
});
