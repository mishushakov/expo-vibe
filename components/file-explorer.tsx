import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  listSessionFiles,
  readSessionFile,
  type SandboxFileEntry,
  type SandboxFileContent,
  type SandboxFileList,
} from '@/lib/build-client';

const DEFAULT_PATH = '/home/user/app';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatModified(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getParentPath(path: string, root: string): string {
  if (path === root) return root;
  const parent = path.slice(0, path.lastIndexOf('/'));
  return parent.startsWith(root) ? parent : root;
}

function displayPath(path: string, root: string): string {
  if (path === root) return 'app';
  return `app/${path.slice(root.length + 1)}`;
}

export function FileExplorer({ sessionId }: { sessionId: string | null }) {
  const scheme = useColorScheme() ?? 'light';
  const palette = Colors[scheme];
  const isDark = scheme === 'dark';
  const [path, setPath] = useState(DEFAULT_PATH);
  const [fileList, setFileList] = useState<SandboxFileList | null>(null);
  const [openFile, setOpenFile] = useState<SandboxFileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setPath(DEFAULT_PATH);
    setFileList(null);
    setOpenFile(null);
    setOpeningPath(null);
    setError(null);
    setFileError(null);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    listSessionFiles(sessionId, path)
      .then((nextFileList) => {
        if (cancelled) return;
        setFileList(nextFileList);
        setPath(nextFileList.path);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, path, refreshKey]);

  const subtleBorder = isDark ? '#2a2d30' : '#e6e6e8';
  const mutedText = isDark ? '#9BA1A6' : '#687076';
  const paneBg = isDark ? '#17191b' : '#ffffff';
  const rowBg = isDark ? '#1f2327' : '#f8fafc';
  const iconBg = isDark ? '#27313a' : '#eaf4f8';
  const accent = isDark ? '#7dd3fc' : palette.tint;
  const root = fileList?.root ?? DEFAULT_PATH;
  const entries = fileList?.entries ?? [];
  const canGoUp = path !== root;

  if (!sessionId) {
    return (
      <View style={[styles.emptyState, { backgroundColor: paneBg }]}>
        <Ionicons name="folder-open-outline" size={26} color={mutedText} />
        <ThemedText style={[styles.emptyTitle, { color: palette.text }]}>No sandbox yet</ThemedText>
        <ThemedText style={[styles.emptyText, { color: mutedText }]}>
          Run a build to browse generated files.
        </ThemedText>
      </View>
    );
  }

  const openEntry = (entry: SandboxFileEntry) => {
    const isDirectory = entry.type === 'dir';

    if (isDirectory) {
      setOpenFile(null);
      setFileError(null);
      setPath(entry.path);
      return;
    }
    if (!sessionId) return;

    setFileLoading(true);
    setOpeningPath(entry.path);
    setFileError(null);

    readSessionFile(sessionId, entry.path)
      .then((content) => {
        setOpenFile(content);
      })
      .catch((err) => {
        setFileError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setFileLoading(false);
        setOpeningPath(null);
      });
  };

  const refreshOpenFile = () => {
    if (!sessionId || !openFile) return;

    setFileLoading(true);
    setFileError(null);

    readSessionFile(sessionId, openFile.path)
      .then((content) => {
        setOpenFile(content);
      })
      .catch((err) => {
        setFileError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setFileLoading(false));
  };

  if (openFile) {
    return (
      <View style={[styles.container, { backgroundColor: paneBg }]}>
        <View style={[styles.toolbar, { borderBottomColor: subtleBorder }]}>
          <Pressable
            onPress={() => {
              setOpenFile(null);
              setFileError(null);
            }}
            style={({ pressed }) => [
              styles.toolbarButton,
              { borderColor: subtleBorder, opacity: pressed ? 0.7 : 1 },
            ]}>
            <Ionicons name="chevron-back-outline" size={17} color={palette.text} />
          </Pressable>

          <View style={styles.pathWrap}>
            <ThemedText numberOfLines={1} style={[styles.pathLabel, { color: palette.text }]}>
              {openFile.name}
            </ThemedText>
            <ThemedText numberOfLines={1} style={[styles.pathSubLabel, { color: mutedText }]}>
              {openFile.path}
            </ThemedText>
          </View>

          <Pressable
            onPress={refreshOpenFile}
            style={({ pressed }) => [
              styles.toolbarButton,
              { borderColor: subtleBorder, opacity: pressed ? 0.7 : 1 },
            ]}>
            {fileLoading ? (
              <ActivityIndicator size="small" color={accent} />
            ) : (
              <Ionicons name="refresh-outline" size={16} color={palette.text} />
            )}
          </Pressable>
        </View>

        {fileError ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={18} color="#ff6b6b" />
            <ThemedText style={[styles.errorText, { color: '#ff6b6b' }]}>{fileError}</ThemedText>
          </View>
        ) : null}

        <ScrollView
          style={[styles.codePane, { backgroundColor: isDark ? '#101214' : '#f8fafc' }]}
          contentContainerStyle={styles.codeContent}
          showsVerticalScrollIndicator={false}>
          <ThemedText selectable style={[styles.codeText, { color: palette.text }]}>
            {openFile.content || ' '}
          </ThemedText>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: paneBg }]}>
      <View style={[styles.toolbar, { borderBottomColor: subtleBorder }]}>
        <Pressable
          disabled={!canGoUp}
          onPress={() => setPath(getParentPath(path, root))}
          style={({ pressed }) => [
            styles.toolbarButton,
            {
              borderColor: subtleBorder,
              opacity: !canGoUp ? 0.35 : pressed ? 0.7 : 1,
            },
          ]}>
          <Ionicons name="arrow-up-outline" size={16} color={palette.text} />
        </Pressable>

        <View style={styles.pathWrap}>
          <ThemedText numberOfLines={1} style={[styles.pathLabel, { color: palette.text }]}>
            {displayPath(path, root)}
          </ThemedText>
          <ThemedText numberOfLines={1} style={[styles.pathSubLabel, { color: mutedText }]}>
            {path}
          </ThemedText>
        </View>

        <Pressable
          onPress={() => setRefreshKey((key) => key + 1)}
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

      {error || fileError ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={18} color="#ff6b6b" />
          <ThemedText style={[styles.errorText, { color: '#ff6b6b' }]}>
            {error ?? fileError}
          </ThemedText>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
        {!loading && entries.length === 0 ? (
          <View style={styles.emptyFolder}>
            <Ionicons name="folder-open-outline" size={22} color={mutedText} />
            <ThemedText style={[styles.emptyText, { color: mutedText }]}>This folder is empty.</ThemedText>
          </View>
        ) : null}

        {entries.map((entry) => {
          const isDir = entry.type === 'dir';
          const modified = formatModified(entry.modifiedTime);

          return (
            <Pressable
              key={entry.path}
              onPress={() => openEntry(entry)}
              style={({ pressed }) => [
                styles.fileRow,
                {
                  backgroundColor: rowBg,
                  borderColor: subtleBorder,
                  opacity: pressed || openingPath === entry.path ? 0.75 : 1,
                },
              ]}>
              <View style={[styles.fileIcon, { backgroundColor: iconBg }]}>
                <Ionicons
                  name={isDir ? 'folder-outline' : 'document-text-outline'}
                  size={17}
                  color={isDir ? accent : mutedText}
                />
              </View>
              <View style={styles.fileTextWrap}>
                <ThemedText numberOfLines={1} style={[styles.fileName, { color: palette.text }]}>
                  {entry.name}
                </ThemedText>
                <ThemedText numberOfLines={1} style={[styles.fileMeta, { color: mutedText }]}>
                  {isDir ? 'Folder' : formatBytes(entry.size)}
                  {modified ? ` - ${modified}` : ''}
                </ThemedText>
              </View>
              {isDir ? (
                <Ionicons name="chevron-forward-outline" size={16} color={mutedText} />
              ) : fileLoading && openingPath === entry.path ? (
                <ActivityIndicator size="small" color={accent} />
              ) : null}
            </Pressable>
          );
        })}
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
  toolbarButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pathWrap: {
    flex: 1,
    minWidth: 0,
  },
  pathLabel: {
    fontSize: 14,
    fontWeight: '700',
  },
  pathSubLabel: {
    fontSize: 11,
    marginTop: 1,
  },
  codePane: {
    flex: 1,
  },
  codeContent: {
    padding: 14,
  },
  codeText: {
    minWidth: '100%',
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    fontSize: 12,
    lineHeight: 18,
  },
  listContent: {
    padding: 12,
    gap: 8,
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  fileIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 13,
    fontWeight: '700',
  },
  fileMeta: {
    fontSize: 11,
    marginTop: 2,
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
  emptyFolder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 42,
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
