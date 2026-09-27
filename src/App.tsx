import { useEffect, useMemo } from 'react';
import { today, weekStart } from './domain/dates';
import { openShoppingCount } from './domain/week';
import { useRoute, type Tab } from './lib/router';
import { closeDays } from './store/actions';
import { isSetupComplete } from './store/persistence';
import { useAppState, useStorageStatus } from './store/store';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TabBar } from './components/TabBar';
import { Banner, ToastHost } from './components/ui/Feedback';
import { CelebrationHost } from './components/ui/Celebration';
import { Onboarding } from './features/onboarding/Onboarding';
import { TodayScreen } from './features/today/TodayScreen';
import { NutritionScreen } from './features/nutrition/NutritionScreen';
import { TrainingScreen } from './features/training/TrainingScreen';
import { SessionScreen } from './features/training/SessionScreen';
import { WorkoutSummary } from './features/training/WorkoutSummary';
import { ShoppingScreen } from './features/shopping/ShoppingScreen';
import { ProgressScreen } from './features/progress/ProgressScreen';
import { ProfileScreen } from './features/profile/ProfileScreen';
import styles from './App.module.css';

export function App() {
  const state = useAppState();
  const route = useRoute();
  const storage = useStorageStatus();

  const shoppingBadge = useShoppingBadge();
  useDayClose();

  // Incomplete saved data also leads here – nothing is deleted, onboarding fills the gaps.
  if (!isSetupComplete(state)) {
    return (
      <>
        <StorageBanner ok={storage.ok} notice={storage.notice} />
        <ErrorBoundary homeLink={false}>
          <Onboarding />
        </ErrorBoundary>
        <ToastHost />
      <CelebrationHost />
      </>
    );
  }

  const fullscreen = route.path === 'session';
  const activeTab: Tab | null = route.path === 'workout' ? 'training' : (['today', 'nutrition', 'training', 'shopping', 'progress'] as Tab[]).includes(route.path as Tab) ? (route.path as Tab) : null;

  return (
    <>
      <StorageBanner ok={storage.ok} notice={storage.notice} />
      <ErrorBoundary resetKey={route.path}>
        {route.path === 'today' && <TodayScreen />}
        {route.path === 'nutrition' && <NutritionScreen />}
        {route.path === 'training' && <TrainingScreen />}
        {route.path === 'session' && <SessionScreen />}
        {route.path === 'workout' && <WorkoutSummary />}
        {route.path === 'shopping' && <ShoppingScreen />}
        {route.path === 'progress' && <ProgressScreen />}
        {route.path === 'profile' && <ProfileScreen />}
      </ErrorBoundary>
      {!fullscreen && <TabBar active={activeTab} badges={{ shopping: shoppingBadge }} />}
      <ToastHost />
      <CelebrationHost />
    </>
  );
}

/**
 * Completed days get their target frozen – on start, when the app comes back
 * to the foreground and when the date changes while it is open. Runs in an
 * effect (never during render) and is idempotent.
 */
function useDayClose() {
  useEffect(() => {
    closeDays();
    const onVisible = () => document.visibilityState === 'visible' && closeDays();
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(closeDays, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);
}

/** Open items of this week's list – shown as a badge on the Einkauf tab. */
function useShoppingBadge(): number {
  const state = useAppState();
  const start = weekStart(today());
  return useMemo(() => openShoppingCount(state, start, today()), [state, start]);
}

function StorageBanner({ ok, notice }: { ok: boolean; notice?: 'recovered' | 'unavailable' }) {
  if (ok && notice !== 'recovered') return null;
  return (
    <div className={styles.banner}>
      {!ok ? (
        <Banner tone="error">Speichern nicht möglich – der Browser blockiert lokalen Speicher (z. B. im privaten Modus). Änderungen gehen beim Schließen verloren.</Banner>
      ) : (
        <Banner tone="warning">Deine gespeicherten Daten waren beschädigt und konnten nicht geladen werden. Eine Sicherungskopie liegt im Browser.</Banner>
      )}
    </div>
  );
}
