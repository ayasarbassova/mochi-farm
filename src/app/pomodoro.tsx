import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { type Phase, usePomodoro } from '@/hooks/use-pomodoro';
import { useTheme } from '@/hooks/use-theme';

const PhaseInfo: Record<Phase, { label: string; accent: string; message: string }> = {
  focus: { label: 'Focus', accent: '#E5484D', message: 'Time to focus.' },
  shortBreak: { label: 'Short break', accent: '#30A46C', message: 'Take a breather.' },
  longBreak: { label: 'Long break', accent: '#208AEF', message: 'Great work — rest up.' },
};

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function TimerScreen() {
  const theme = useTheme();
  const { phase, remaining, progress, isRunning, completedSessions, toggle, reset, switchTo } =
    usePomodoro();
  const { accent, message } = PhaseInfo[phase];

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle" style={styles.heading}>
          Pomodoro
        </ThemedText>

        <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
          {(Object.keys(PhaseInfo) as Phase[]).map((p) => {
            const selected = p === phase;
            return (
              <Pressable
                key={p}
                onPress={() => switchTo(p)}
                style={[styles.segment, selected && { backgroundColor: PhaseInfo[p].accent }]}>
                <ThemedText
                  type="smallBold"
                  style={selected ? styles.selectedText : { color: theme.textSecondary }}>
                  {PhaseInfo[p].label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.timerSection}>
          <ThemedText style={[styles.time, { color: accent }]}>{formatTime(remaining)}</ThemedText>
          <View style={[styles.track, { backgroundColor: theme.backgroundElement }]}>
            <View
              style={[styles.fill, { backgroundColor: accent, width: `${progress * 100}%` }]}
            />
          </View>
          <ThemedText themeColor="textSecondary">{message}</ThemedText>
        </View>

        <View style={styles.controls}>
          <Pressable
            onPress={toggle}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: accent, opacity: pressed ? 0.8 : 1 },
            ]}>
            <ThemedText style={styles.primaryButtonText}>{isRunning ? 'Pause' : 'Start'}</ThemedText>
          </Pressable>
          <Pressable
            onPress={reset}
            style={({ pressed }) => [
              styles.secondaryButton,
              { backgroundColor: theme.backgroundElement, opacity: pressed ? 0.8 : 1 },
            ]}>
            <ThemedText type="smallBold">Reset</ThemedText>
          </Pressable>
        </View>

        <ThemedText type="small" themeColor="textSecondary">
          Sessions completed: {completedSessions}
        </ThemedText>      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.four,
  },
  heading: {
    marginTop: Spacing.three,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: Spacing.one,
    gap: Spacing.one,
  },
  segment: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: 999,
  },
  selectedText: {
    color: '#ffffff',
  },
  timerSection: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.four,
  },
  time: {
    fontSize: 88,
    lineHeight: 96,
    fontWeight: 700,
    fontFamily: Fonts?.rounded,
    fontVariant: ['tabular-nums'],
  },
  track: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 4,
  },
  controls: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  primaryButton: {
    minWidth: 160,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: 999,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 700,
  },
  secondaryButton: {
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    borderRadius: 999,
  },
});
