import { useEffect, useState } from 'react';
import { Vibration } from 'react-native';

export type Phase = 'focus' | 'shortBreak' | 'longBreak';

export const PhaseDurations: Record<Phase, number> = {
  focus: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

const SESSIONS_BEFORE_LONG_BREAK = 4;

export function usePomodoro() {
  const [phase, setPhase] = useState<Phase>('focus');
  const [remaining, setRemaining] = useState(PhaseDurations.focus);
  // Timestamp (ms) when the current phase ends; null while paused.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [completedSessions, setCompletedSessions] = useState(0);

  const isRunning = endsAt !== null;

  useEffect(() => {
    if (endsAt === null) return;

    const tick = () => {
      const secondsLeft = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setRemaining(secondsLeft);
      if (secondsLeft === 0) {
        Vibration.vibrate([0, 400, 200, 400]);
        setEndsAt(null);
        if (phase === 'focus') {
          const done = completedSessions + 1;
          setCompletedSessions(done);
          switchTo(done % SESSIONS_BEFORE_LONG_BREAK === 0 ? 'longBreak' : 'shortBreak');
        } else {
          switchTo('focus');
        }
      }
    };

    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [endsAt, phase, completedSessions]);

  function switchTo(next: Phase) {
    setEndsAt(null);
    setPhase(next);
    setRemaining(PhaseDurations[next]);
  }

  function toggle() {
    if (isRunning) {
      setEndsAt(null);
    } else {
      setEndsAt(Date.now() + remaining * 1000);
    }
  }

  function reset() {
    switchTo(phase);
  }

  return {
    phase,
    remaining,
    progress: 1 - remaining / PhaseDurations[phase],
    isRunning,
    completedSessions,
    toggle,
    reset,
    switchTo,
  };
}
