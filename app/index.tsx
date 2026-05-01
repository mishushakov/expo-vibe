import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExpoLogs } from '@/components/expo-logs';
import { FileExplorer } from '@/components/file-explorer';
import { SandboxPreview } from '@/components/sandbox-preview';
import { ThemedText } from '@/components/themed-text';
import { useThemeMode } from '@/components/theme-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteSession, streamBuild } from '@/lib/build-client';

type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  statusKind?: 'thinking' | 'tool' | 'file';
  error?: boolean;
};

type WorkspaceTab = 'preview' | 'files' | 'logs';

let msgCounter = 0;
const newMsgId = (suffix: string) => `${Date.now()}-${++msgCounter}-${suffix}`;

const SUGGESTIONS = [
  'A landing page for a SaaS product',
  'A todo app with dark mode',
  'A pomodoro timer',
  'A pricing page with three tiers',
];

export default function HomeScreen() {
  const scheme = useColorScheme() ?? 'light';
  const palette = Colors[scheme];
  const isDark = scheme === 'dark';
  const { toggle } = useThemeMode();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [inFlight, setInFlight] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expoUrl, setExpoUrl] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>('preview');
  const sessionIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const hasMessages = messages.length > 0;
  const canSend = input.trim().length > 0 && !inFlight;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  // Insert a message if its id is new, replace it in place if not. Used so
  // that streaming part updates (text growing, tool transitioning
  // pending → running → completed) collapse into a single bubble each.
  const upsertMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx === -1) return [...prev, msg];
      const next = prev.slice();
      next[idx] = msg;
      return next;
    });
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || inFlight) return;

      appendMessage({ id: newMsgId('u'), role: 'user', text: trimmed });
      setInput('');
      setInFlight(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamBuild({
          prompt: trimmed,
          sessionId: sessionIdRef.current,
          signal: controller.signal,
          onEvent: (event) => {
            switch (event.type) {
              case 'meta':
                sessionIdRef.current = event.sessionId;
                setSessionId(event.sessionId);
                setExpoUrl(event.expoUrl);
                break;
              case 'text':
                upsertMessage({
                  id: `part-${event.id}`,
                  role: 'assistant',
                  text: event.text,
                });
                break;
              case 'reasoning':
                upsertMessage({
                  id: `part-${event.id}`,
                  role: 'system',
                  statusKind: 'thinking',
                  text: event.text,
                });
                break;
              case 'tool': {
                let label: string;
                switch (event.status) {
                  case 'pending':
                    label = `${event.name} · queued`;
                    break;
                  case 'running':
                    label = `${event.title ?? event.name}…`;
                    break;
                  case 'completed':
                    label = event.title ?? event.name;
                    break;
                  case 'error':
                    label = `${event.name}: ${event.error ?? 'failed'}`;
                    break;
                }
                upsertMessage({
                  id: `part-${event.id}`,
                  role: 'system',
                  statusKind: 'tool',
                  text: label,
                  error: event.status === 'error',
                });
                break;
              }
              case 'file':
                upsertMessage({
                  id: `part-${event.id}`,
                  role: 'system',
                  statusKind: 'file',
                  text: `Attached: ${event.filename ?? event.url ?? 'file'}`,
                });
                break;
              case 'done':
                if (event.exitCode === 0) {
                  setPreviewReady(true);
                } else {
                  appendMessage({
                    id: newMsgId('s'),
                    role: 'system',
                    statusKind: 'tool',
                    text: `opencode exited ${event.exitCode}`,
                    error: true,
                  });
                }
                break;
              case 'error':
                appendMessage({
                  id: newMsgId('a'),
                  role: 'assistant',
                  text: `Error: ${event.message}`,
                  error: true,
                });
                break;
            }
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message !== 'Aborted') {
          appendMessage({
            id: newMsgId('a'),
            role: 'assistant',
            text: `Error: ${message}`,
            error: true,
          });
        }
      } finally {
        setInFlight(false);
        abortRef.current = null;
      }
    },
    [inFlight, appendMessage, upsertMessage]
  );

  const startNewChat = useCallback(() => {
    abortRef.current?.abort();
    const sid = sessionIdRef.current;
    sessionIdRef.current = undefined;
    setMessages([]);
    setInFlight(false);
    setSessionId(null);
    setExpoUrl(null);
    setPreviewReady(false);
    setActiveWorkspaceTab('preview');
    if (sid) {
      void deleteSession(sid);
    }
  }, []);

  const pasteLogsToChat = useCallback((logs: string) => {
    const trimmedLogs = logs.trim();
    if (!trimmedLogs) return;

    setInput(
      [
        'Please fix the Expo issue shown in these logs:',
        '',
        '```log',
        trimmedLogs,
        '```',
      ].join('\n')
    );
    setActiveWorkspaceTab('preview');
  }, []);

  const subtleBorder = isDark ? '#2a2d30' : '#e6e6e8';
  const mutedText = isDark ? '#9BA1A6' : '#687076';
  const userBubble = isDark ? '#2b6cb0' : '#0a7ea4';
  const assistantBubble = isDark ? '#26292c' : '#f2f3f5';
  const chipBg = isDark ? '#1f2123' : '#f6f7f9';
  const inputBg = isDark ? '#1f2123' : '#f6f7f9';
  const errorColor = isDark ? '#ff6b6b' : '#c92a2a';
  const workspaceBg = isDark ? '#141618' : '#ffffff';
  const workspaceTabBg = isDark ? '#202428' : '#f1f5f9';
  const statusAccent = isDark ? '#7dd3fc' : '#0a7ea4';
  const statusBg = isDark ? '#171b1f' : '#f8fafc';
  const statusBorder = isDark ? '#2f3842' : '#dce6ee';
  const statusIconBg = isDark ? '#212830' : '#eaf4f8';
  const statusErrorBg = isDark ? '#26171a' : '#fff5f5';
  const statusErrorBorder = isDark ? '#5c262d' : '#ffc9c9';
  const statusErrorIconBg = isDark ? '#3b2024' : '#ffe3e3';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: subtleBorder }]}>
        <ThemedText type="defaultSemiBold">Expo Vibe</ThemedText>
        <View style={styles.headerActions}>
          {hasMessages ? (
            <Pressable
              onPress={startNewChat}
              style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="add" size={18} color={palette.text} />
              <ThemedText style={styles.newChatText}>New</ThemedText>
            </Pressable>
          ) : null}
          <Pressable
            onPress={toggle}
            hitSlop={8}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            accessibilityLabel="Toggle dark mode">
            <Ionicons
              name={isDark ? 'sunny-outline' : 'moon-outline'}
              size={20}
              color={palette.text}
            />
          </Pressable>
        </View>
      </View>

      <View style={[styles.body, isWide ? styles.bodyRow : styles.bodyColumn]}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
          {hasMessages ? (
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.messagesContent}
              showsVerticalScrollIndicator={false}>
              {messages.map((m) => {
                if (m.role === 'system') {
                  if (m.text.trim().length === 0) return null;
                  const statusIconName = m.error
                    ? 'alert-circle-outline'
                    : m.statusKind === 'thinking'
                      ? 'sparkles-outline'
                      : m.statusKind === 'file'
                        ? 'document-attach-outline'
                        : 'terminal-outline';
                  const statusTone = m.error ? errorColor : statusAccent;
                  const statusTextColor = m.error ? errorColor : mutedText;
                  return (
                    <View key={m.id} style={styles.systemRow}>
                      <View
                        style={[
                          styles.systemPill,
                          {
                            backgroundColor: m.error ? statusErrorBg : statusBg,
                            borderColor: m.error ? statusErrorBorder : statusBorder,
                          },
                        ]}>
                        <View
                          style={[
                            styles.systemIcon,
                            { backgroundColor: m.error ? statusErrorIconBg : statusIconBg },
                          ]}>
                          <Ionicons name={statusIconName} size={13} color={statusTone} />
                        </View>
                        <ThemedText style={[styles.systemText, { color: statusTextColor }]}>
                          {m.text}
                        </ThemedText>
                      </View>
                    </View>
                  );
                }

                const isUser = m.role === 'user';
                if (!isUser && m.text.length === 0) return null;
                return (
                  <View
                    key={m.id}
                    style={[
                      styles.bubbleRow,
                      isUser ? styles.bubbleRowEnd : styles.bubbleRowStart,
                    ]}>
                    <View
                      style={[
                        styles.bubble,
                        isUser
                          ? { backgroundColor: userBubble, borderBottomRightRadius: 4 }
                          : {
                              backgroundColor: assistantBubble,
                              borderBottomLeftRadius: 4,
                            },
                      ]}>
                      <ThemedText
                        style={[
                          isUser ? { color: '#fff' } : undefined,
                          !isUser && m.error ? { color: errorColor } : undefined,
                          !isUser ? styles.assistantText : undefined,
                        ]}>
                        {m.text}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <ScrollView
              contentContainerStyle={styles.heroContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>
              <View style={styles.hero}>
                <ThemedText style={styles.heroTitle}>What do you want to build?</ThemedText>
                <ThemedText style={[styles.heroSubtitle, { color: mutedText }]}>
                  Describe an app or screen and we&apos;ll build it inside an E2B sandbox.
                </ThemedText>
              </View>

              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => send(s)}
                    disabled={inFlight}
                    style={({ pressed }) => [
                      styles.chip,
                      {
                        backgroundColor: chipBg,
                        borderColor: subtleBorder,
                        opacity: pressed || inFlight ? 0.7 : 1,
                      },
                    ]}>
                    <Ionicons name="sparkles-outline" size={14} color={mutedText} />
                    <ThemedText style={[styles.chipText, { color: palette.text }]}>{s}</ThemedText>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          )}

          <View style={[styles.inputWrap, { borderTopColor: subtleBorder }]}>
            <View
              style={[
                styles.inputBar,
                { backgroundColor: inputBg, borderColor: subtleBorder },
              ]}>
              <Pressable hitSlop={8} style={styles.iconBtn} onPress={() => {}}>
                <Ionicons name="add" size={20} color={mutedText} />
              </Pressable>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask Expo Vibe to build something…"
                placeholderTextColor={mutedText}
                multiline
                editable={!inFlight}
                style={[styles.input, { color: palette.text }]}
                onSubmitEditing={() => send(input)}
                blurOnSubmit={false}
              />
              <Pressable
                disabled={!canSend}
                onPress={() => send(input)}
                style={({ pressed }) => [
                  styles.sendBtn,
                  {
                    backgroundColor: canSend ? palette.tint : subtleBorder,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                {inFlight ? (
                  <ActivityIndicator size="small" color={mutedText} />
                ) : (
                  <Ionicons
                    name="arrow-up"
                    size={18}
                    color={canSend ? (isDark ? '#151718' : '#fff') : mutedText}
                  />
                )}
              </Pressable>
            </View>
            <ThemedText style={[styles.disclaimer, { color: mutedText }]}>
              Expo Vibe runs on E2B. Review generated code before shipping.
            </ThemedText>
          </View>
        </KeyboardAvoidingView>
        {expoUrl || sessionId ? (
          <View
            style={[
              styles.previewPane,
              { borderColor: subtleBorder },
              isWide ? styles.previewPaneWide : styles.previewPaneNarrow,
            ]}>
            <View
              style={[
                styles.workspaceTabs,
                { backgroundColor: workspaceBg, borderBottomColor: subtleBorder },
              ]}>
              {(
                [
                  { id: 'preview', label: 'Preview', icon: 'phone-portrait-outline' },
                  { id: 'files', label: 'Files', icon: 'folder-open-outline' },
                  { id: 'logs', label: 'Logs', icon: 'terminal-outline' },
                ] as const
              ).map((tab) => {
                const selected = activeWorkspaceTab === tab.id;
                return (
                  <Pressable
                    key={tab.id}
                    onPress={() => setActiveWorkspaceTab(tab.id)}
                    style={({ pressed }) => [
                      styles.workspaceTab,
                      {
                        backgroundColor: selected ? workspaceTabBg : 'transparent',
                        opacity: pressed ? 0.75 : 1,
                      },
                    ]}>
                    <Ionicons
                      name={tab.icon}
                      size={15}
                      color={selected ? palette.tint : mutedText}
                    />
                    <ThemedText
                      style={[
                        styles.workspaceTabText,
                        { color: selected ? palette.text : mutedText },
                      ]}>
                      {tab.label}
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>

            {activeWorkspaceTab === 'preview' ? (
              previewReady && expoUrl ? (
                <SandboxPreview url={expoUrl} />
              ) : (
                <View style={[styles.previewPending, { backgroundColor: workspaceBg }]}>
                  <ActivityIndicator size="small" color={palette.tint} />
                  <ThemedText style={[styles.previewPendingText, { color: mutedText }]}>
                    Preview will appear when the build finishes.
                  </ThemedText>
                </View>
              )
            ) : activeWorkspaceTab === 'files' ? (
              <FileExplorer sessionId={sessionId} />
            ) : (
              <ExpoLogs sessionId={sessionId} onPasteToChat={pasteLogsToChat} />
            )}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, minHeight: 0, minWidth: 0 },
  flex: { flex: 1, minHeight: 0, minWidth: 0 },
  body: { flex: 1, minHeight: 0, minWidth: 0 },
  bodyRow: { flexDirection: 'row' },
  bodyColumn: { flexDirection: 'column' },
  previewPane: {
    minHeight: 0,
    minWidth: 0,
    overflow: 'hidden',
  },
  workspaceTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  workspaceTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  workspaceTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  previewPending: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 24,
  },
  previewPendingText: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },
  previewPaneWide: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  previewPaneNarrow: {
    // Narrow layouts (phones) stack chat above preview. Give the preview
    // less space than the chat so the streamed tool-call history stays
    // visible without scrolling — chat: flex 1, preview: flex 0.6 ≈ 62/38.
    flex: 0.6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  newChatText: { fontSize: 14 },
  heroContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
    gap: 28,
  },
  hero: { alignItems: 'center', gap: 10 },
  heroTitle: {
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 360,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 13 },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowStart: { justifyContent: 'flex-start' },
  bubbleRowEnd: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    gap: 6,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusText: { fontSize: 13 },
  assistantText: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 13,
    lineHeight: 18,
  },
  systemRow: {
    alignItems: 'flex-start',
    paddingVertical: 2,
  },
  systemPill: {
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  systemIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
  inputWrap: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 8,
    paddingHorizontal: 4,
    maxHeight: 140,
  },
  sendBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disclaimer: {
    fontSize: 11,
    textAlign: 'center',
  },
});
