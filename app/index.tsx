import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
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
type MobileTab = 'chat' | WorkspaceTab;
type MessageScrollMetrics = { contentHeight: number; layoutHeight: number; y: number };

let msgCounter = 0;
const newMsgId = (suffix: string) => `${Date.now()}-${++msgCounter}-${suffix}`;

const SUGGESTIONS = [
  'A landing page for a SaaS product',
  'A todo app with dark mode',
  'A pomodoro timer',
  'A pricing page with three tiers',
];

const BOTTOM_PIN_THRESHOLD = 48;

const toExpoGoUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      const path = parsed.pathname === '/' ? '' : parsed.pathname;
      return `exp://${parsed.host}${path}${parsed.search}`;
    }
  } catch {
    // Keep the original value if the URL is already a custom scheme.
  }

  return url;
};

const qrImageUrl = (value: string) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(
    value
  )}`;

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
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>('chat');
  const [showQr, setShowQr] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const messagesScrollRef = useRef<ScrollView | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const messagesScrollMetricsRef = useRef<MessageScrollMetrics>({
    contentHeight: 0,
    layoutHeight: 0,
    y: 0,
  });
  const sessionIdRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);

  const hasMessages = messages.length > 0;
  const canSend = input.trim().length > 0 && !inFlight;
  const expoGoUrl = expoUrl ? toExpoGoUrl(expoUrl) : null;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!hasMessages) {
      shouldStickToBottomRef.current = true;
      messagesScrollMetricsRef.current = {
        contentHeight: 0,
        layoutHeight: messagesScrollMetricsRef.current.layoutHeight,
        y: 0,
      };
      setShowScrollToBottom(false);
    }
  }, [hasMessages]);

  const scrollMessagesToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      messagesScrollRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const updateMessageScrollPin = useCallback((metrics: Partial<MessageScrollMetrics>) => {
    const nextMetrics = { ...messagesScrollMetricsRef.current, ...metrics };
    messagesScrollMetricsRef.current = nextMetrics;

    const distanceFromBottom = Math.max(
      0,
      nextMetrics.contentHeight - nextMetrics.layoutHeight - nextMetrics.y
    );
    const canScroll = nextMetrics.contentHeight > nextMetrics.layoutHeight + BOTTOM_PIN_THRESHOLD;
    const isPinned = distanceFromBottom <= BOTTOM_PIN_THRESHOLD;

    shouldStickToBottomRef.current = isPinned;
    setShowScrollToBottom(canScroll && !isPinned);
  }, []);

  const handleMessagesLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const layoutHeight = event.nativeEvent.layout.height;
      messagesScrollMetricsRef.current = {
        ...messagesScrollMetricsRef.current,
        layoutHeight,
      };

      if (shouldStickToBottomRef.current) {
        setShowScrollToBottom(false);
        scrollMessagesToBottom(false);
        return;
      }

      updateMessageScrollPin({ layoutHeight });
    },
    [scrollMessagesToBottom, updateMessageScrollPin]
  );

  const handleMessagesContentSizeChange = useCallback(
    (_width: number, contentHeight: number) => {
      const wasPinned = shouldStickToBottomRef.current;
      messagesScrollMetricsRef.current = {
        ...messagesScrollMetricsRef.current,
        contentHeight,
      };

      if (wasPinned) {
        setShowScrollToBottom(false);
        scrollMessagesToBottom(true);
        return;
      }

      updateMessageScrollPin({ contentHeight });
    },
    [scrollMessagesToBottom, updateMessageScrollPin]
  );

  const handleMessagesScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      updateMessageScrollPin({
        contentHeight: contentSize.height,
        layoutHeight: layoutMeasurement.height,
        y: contentOffset.y,
      });
    },
    [updateMessageScrollPin]
  );

  const pinMessagesToBottom = useCallback(() => {
    shouldStickToBottomRef.current = true;
    setShowScrollToBottom(false);
    scrollMessagesToBottom(true);
  }, [scrollMessagesToBottom]);

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
    shouldStickToBottomRef.current = true;
    setMessages([]);
    setInFlight(false);
    setSessionId(null);
    setExpoUrl(null);
    setPreviewReady(false);
    setActiveWorkspaceTab('preview');
    setActiveMobileTab('chat');
    setShowQr(false);
    setShowScrollToBottom(false);
    setPreviewReloadKey(0);
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
    setActiveMobileTab('chat');
    setActiveWorkspaceTab('preview');
  }, []);

  const openPreviewUrl = useCallback(() => {
    if (!expoUrl) return;
    void Linking.openURL(expoUrl);
  }, [expoUrl]);

  const reloadPreview = useCallback(() => {
    setPreviewReloadKey((key) => key + 1);
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

  const renderChatPane = () => (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
      {hasMessages ? (
        <View style={styles.messagesViewport}>
          <ScrollView
            ref={messagesScrollRef}
            style={styles.flex}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={handleMessagesContentSizeChange}
            onLayout={handleMessagesLayout}
            onScroll={handleMessagesScroll}
            scrollEventThrottle={16}
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
          {showScrollToBottom ? (
            <Pressable
              accessibilityLabel="Scroll to latest message"
              accessibilityRole="button"
              hitSlop={8}
              onPress={pinMessagesToBottom}
              style={({ pressed }) => [
                styles.scrollToBottomButton,
                {
                  backgroundColor: inputBg,
                  borderColor: subtleBorder,
                  opacity: pressed ? 0.82 : 1,
                },
              ]}>
              <Ionicons name="arrow-down" size={20} color={palette.text} />
            </Pressable>
          ) : null}
        </View>
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
          <View style={styles.inputControls}>
            <Pressable hitSlop={8} style={styles.iconBtn} onPress={() => {}}>
              <Ionicons name="add" size={20} color={mutedText} />
            </Pressable>
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
        </View>
        <ThemedText style={[styles.disclaimer, { color: mutedText }]}>
          Expo Vibe runs on E2B. Review generated code before shipping.
        </ThemedText>
      </View>
    </KeyboardAvoidingView>
  );

  const renderMobileTabs = () => (
    <View
      style={[
        styles.mobileTabs,
        { backgroundColor: palette.background, borderBottomColor: subtleBorder },
      ]}>
      {(
        [
          { id: 'chat', label: 'Chat', icon: 'chatbubble-ellipses-outline' },
          { id: 'preview', label: 'Preview', icon: 'phone-portrait-outline' },
          { id: 'files', label: 'Files', icon: 'folder-open-outline' },
          { id: 'logs', label: 'Logs', icon: 'terminal-outline' },
        ] as const
      ).map((tab) => {
        const selected = activeMobileTab === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => setActiveMobileTab(tab.id)}
            style={({ pressed }) => [
              styles.mobileTab,
              {
                backgroundColor: selected ? workspaceTabBg : 'transparent',
                opacity: pressed ? 0.75 : 1,
              },
            ]}>
            <Ionicons name={tab.icon} size={15} color={selected ? palette.tint : mutedText} />
            <ThemedText
              numberOfLines={1}
              style={[styles.mobileTabText, { color: selected ? palette.text : mutedText }]}>
              {tab.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );

  const renderPreviewContent = () => (
    <View style={[styles.previewContent, { backgroundColor: workspaceBg }]}>
      {expoUrl ? (
        <View
          style={[
            styles.previewToolbar,
            { backgroundColor: workspaceBg, borderBottomColor: subtleBorder },
          ]}>
          <View
            style={[
              styles.previewUrlPill,
              { backgroundColor: inputBg, borderColor: subtleBorder },
            ]}>
            <Ionicons name="link-outline" size={14} color={mutedText} />
            <ThemedText numberOfLines={1} style={[styles.previewUrlText, { color: mutedText }]}>
              {expoUrl}
            </ThemedText>
          </View>
          <Pressable
            onPress={reloadPreview}
            accessibilityLabel="Reload preview"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.previewAction,
              { borderColor: subtleBorder, opacity: pressed ? 0.75 : 1 },
            ]}>
            <Ionicons name="refresh-outline" size={17} color={palette.text} />
          </Pressable>
          <Pressable
            onPress={openPreviewUrl}
            accessibilityLabel="Open preview"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.previewAction,
              { borderColor: subtleBorder, opacity: pressed ? 0.75 : 1 },
            ]}>
            <Ionicons name="open-outline" size={17} color={palette.text} />
          </Pressable>
          <Pressable
            onPress={() => setShowQr(true)}
            accessibilityLabel="Show Expo Go QR code"
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.previewAction,
              { borderColor: subtleBorder, opacity: pressed ? 0.75 : 1 },
            ]}>
            <Ionicons name="qr-code-outline" size={17} color={palette.text} />
          </Pressable>
        </View>
      ) : null}

      {previewReady && expoUrl ? (
        <SandboxPreview key={`${expoUrl}-${previewReloadKey}`} url={expoUrl} />
      ) : !expoUrl && !sessionId ? (
        <View style={styles.previewPending}>
          <Ionicons name="phone-portrait-outline" size={28} color={mutedText} />
          <ThemedText style={[styles.previewPendingText, { color: mutedText }]}>
            Run a build to start a preview.
          </ThemedText>
        </View>
      ) : (
        <View style={styles.previewPending}>
          <ActivityIndicator size="small" color={palette.tint} />
          <ThemedText style={[styles.previewPendingText, { color: mutedText }]}>
            Preview will appear when the build finishes.
          </ThemedText>
        </View>
      )}
    </View>
  );

  const renderWorkspaceContent = (tab: WorkspaceTab) => {
    if (tab === 'preview') return renderPreviewContent();
    if (tab === 'files') return <FileExplorer sessionId={sessionId} />;
    return <ExpoLogs sessionId={sessionId} onPasteToChat={pasteLogsToChat} />;
  };

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
        {isWide ? (
          <>
            {renderChatPane()}
            {expoUrl || sessionId ? (
              <View
                style={[
                  styles.previewPane,
                  { borderColor: subtleBorder },
                  styles.previewPaneWide,
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

                {renderWorkspaceContent(activeWorkspaceTab)}
              </View>
            ) : null}
          </>
        ) : (
          <View style={styles.mobileShell}>
            {renderMobileTabs()}
            <View style={styles.mobileTabContent}>
              {activeMobileTab === 'chat'
                ? renderChatPane()
                : renderWorkspaceContent(activeMobileTab)}
            </View>
          </View>
        )}
      </View>

      <Modal
        visible={showQr && Boolean(expoGoUrl)}
        transparent
        animationType="fade"
        onRequestClose={() => setShowQr(false)}>
        <Pressable style={styles.qrBackdrop} onPress={() => setShowQr(false)}>
          <Pressable
            style={[
              styles.qrCard,
              { backgroundColor: workspaceBg, borderColor: subtleBorder },
            ]}
            onPress={(event) => event.stopPropagation()}>
            <View style={styles.qrHeader}>
              <View>
                <ThemedText style={styles.qrTitle}>Expo Go QR</ThemedText>
                <ThemedText style={[styles.qrSubtitle, { color: mutedText }]}>
                  Scan this from Expo Go on your phone.
                </ThemedText>
              </View>
              <Pressable
                hitSlop={8}
                onPress={() => setShowQr(false)}
                style={({ pressed }) => [styles.qrClose, pressed && { opacity: 0.65 }]}>
                <Ionicons name="close" size={20} color={palette.text} />
              </Pressable>
            </View>

            {expoGoUrl ? (
              <>
                <View style={styles.qrImageFrame}>
                  <Image
                    source={{ uri: qrImageUrl(expoGoUrl) }}
                    style={styles.qrImage}
                    resizeMode="contain"
                  />
                </View>
                <View
                  style={[
                    styles.expoGoUrlPill,
                    { backgroundColor: inputBg, borderColor: subtleBorder },
                  ]}>
                  <Ionicons name="phone-portrait-outline" size={14} color={mutedText} />
                  <ThemedText
                    numberOfLines={2}
                    style={[styles.expoGoUrlText, { color: mutedText }]}>
                    {expoGoUrl}
                  </ThemedText>
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, minHeight: 0, minWidth: 0 },
  flex: { flex: 1, minHeight: 0, minWidth: 0 },
  body: { flex: 1, minHeight: 0, minWidth: 0 },
  bodyRow: { flexDirection: 'row' },
  bodyColumn: { flexDirection: 'column' },
  mobileShell: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  mobileTabContent: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  mobileTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mobileTab: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  mobileTabText: {
    minWidth: 0,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
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
  previewContent: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
  },
  previewToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  previewUrlPill: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  previewUrlText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 15,
  },
  previewAction: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 17,
  },
  qrBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.58)',
    padding: 20,
  },
  qrCard: {
    width: '100%',
    maxWidth: 380,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    padding: 18,
    gap: 16,
  },
  qrHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
  },
  qrTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '800',
  },
  qrSubtitle: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  qrClose: {
    padding: 2,
  },
  qrImageFrame: {
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 12,
  },
  qrImage: {
    width: 260,
    height: 260,
  },
  expoGoUrlPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  expoGoUrlText: {
    flex: 1,
    minWidth: 0,
    fontSize: 11,
    lineHeight: 15,
  },
  previewPaneWide: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
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
  messagesViewport: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    position: 'relative',
  },
  messagesContent: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  scrollToBottomButton: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 5,
    zIndex: 2,
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
    gap: 4,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 6,
    paddingHorizontal: 2,
    maxHeight: 140,
  },
  inputControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
