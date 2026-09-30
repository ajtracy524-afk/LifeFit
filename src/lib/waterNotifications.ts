import { useEffect } from 'react';
import { today } from '../domain/dates';
import { waterReminder } from '../domain/water';
import { markWaterReminderSent } from '../store/actions';
import { getState } from '../store/store';

/** How often the app looks whether a water reminder is due while it is in the background. */
const CHECK_MS = 5 * 60_000;

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

/** Asks the browser for permission – only ever from a tap of the user. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  return (await Notification.requestPermission()) === 'granted';
}

/**
 * Water reminders as system notifications – the SAME decision as the hint in
 * the app (domain/water.ts waterReminder), only a different way to deliver it.
 * Only when the user chose "Auch als Mitteilung", the browser allows it and
 * the app is in the background (while it is open, the hint in the app is
 * enough). Without a service worker this works as long as LifeFit is open in
 * a tab or as an installed app.
 */
export function useWaterNotifications(): void {
  useEffect(() => {
    if (!notificationsSupported()) return;
    const check = () => {
      const state = getState();
      if (state.nutritionProfile?.waterReminders !== 'notify' || Notification.permission !== 'granted') return;
      if (document.visibilityState !== 'hidden') return;
      const now = new Date();
      const reminder = waterReminder(state, today(), now);
      if (!reminder) return;
      try {
        new Notification('LifeFit · Wasser', { body: reminder.text, tag: 'lifefit-water', icon: '/icon.svg' });
        markWaterReminderSent(now);
      } catch {
        // Some browsers only allow notifications from a service worker – the hint in the app stays.
      }
    };
    const id = setInterval(check, CHECK_MS);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
}
