import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { readSessionLogs, type SandboxLogs } from '@/lib/build-client';

const LOG_LINES = 400;
const REFRESH_INTERVAL_MS = 2500;

function formatTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatBytes(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ExpoLogs({
  sessionId,
  onPasteToChat,
}: {
  sessionId: string | null;
  onPasteToChat: (logs: string) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const palette = Colors[scheme];
  const isDark = scheme === 'dark';
  const [logState, setLogState] = useState<SandboxLogs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subtleBorder = isDark ? '#2a2d30' : '#e6e6e8';
  const mutedText = isDark ? '#9BA1A6' : '#687076';
  const paneBg = isDark ? '#17191b' : '#ffffff';
  const codeBg = isDark ? '#101214' : '#f8fafc';
  const accent = isDark ? '#7dd3fc' : palette.tint;

  const refresh = useCallback(async () => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);

    try {
      setLogState(await readSessionLogs(sessionId, LOG_LINES));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setLogState(null);
    setError(null);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [sessionId, refresh]);

  if (!sessionId) {
    return (
      <View style={[styles.emptyState, { backgroundColor: paneBg }]}>
        <Ionicons name="terminal-outline" size={26} color={mutedText} />
        <ThemedText style={[styles.emptyTitle, { color: palette.text }]}>No sandbox yet</ThemedText>
        <ThemedText style={[styles.emptyText, { color: mutedText }]}>
          Run a build to start collecting Expo logs.
        </ThemedText>
      </View>
    );
  }

  const logText = typeof logState?.logs === 'string' ? logState.logs.trimEnd() : '';
  const fallbackMessage =
    logState?.message ??
    'No Expo output yet. Trigger a reload or edit a file in the generated app to produce logs.';

  return (
    <View style={[styles.container, { backgroundColor: paneBg }]}>
      <View style={[styles.toolbar, { borderBottomColor: subtleBorder }]}>
        <View style={styles.titleWrap}>
          <ThemedText style={[styles.title, { color: palette.text }]}>Expo logs</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.subtitle, { color: mutedText }]}>
            {logState?.missing
              ? logState.path
              : `Last ${LOG_LINES} lines${logState?.size ? ` - ${formatBytes(logState.size)}` : ''}${logState?.updatedAt ? ` - ${formatTime(logState.updatedAt)}` : ''}`}
          </ThemedText>
        </View>

        <Pressable
          disabled={!logText}
          onPress={() => onPasteToChat(logText)}
          style={({ pressed }) => [
            styles.pasteButton,
            {
              borderColor: subtleBorder,
              opacity: !logText ? 0.35 : pressed ? 0.7 : 1,
            },
          ]}>
          <Ionicons name="chatbox-ellipses-outline" size={15} color={palette.text} />
          <ThemedText style={[styles.pasteButtonText, { color: palette.text }]}>
            Paste
          </ThemedText>
        </Pressable>

        <Pressable
          onPress={() => void refresh()}
          style={({ pressed }) => [
            styles.toolbarButton,
            { borderColor: subtleBorder, opacity: pressed ? 0.7 : 1 },
          ]}>
          {loading ? (
            <ActivityIndicator size="small" color={accent} />
          ) : (
            <Ionicons name="refresh-outline" size={16} color={palette.text} />
          )}
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color="#ff6b6b" />
          <ThemedText style={[styles.errorText, { color: '#ff6b6b' }]}>{error}</ThemedText>
        </View>
      ) : null}

      <ScrollView
        style={[styles.logPane, { backgroundColor: codeBg }]}
        contentContainerStyle={styles.logContent}
        showsVerticalScrollIndicator>
        {logText ? (
          <ThemedText selectable style={[styles.logText, { color: palette.text }]}>
            {logText}
          </ThemedText>
        ) : (
          <View style={styles.emptyLogs}>
            <Ionicons name="terminal-outline" size={22} color={mutedText} />
            <ThemedText style={[styles.emptyText, { color: mutedText }]}>
              {fallbackMessage}
            </ThemedText>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    minHeight: 0,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  toolbarButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pasteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
  },
  pasteButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  logPane: {
    flex: 1,
  },
  logContent: {
    flexGrow: 1,
    padding: 14,
  },
  logText: {
    minWidth: '100%',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 12,
    lineHeight: 18,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  emptyLogs: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
});
