/**
 * Internal switches for work in progress. The new onboarding stays behind
 * `?onboarding=v2` (development builds only) until Prompt 9 removes the old
 * one together with this switch (docs/ONBOARDING_PLAN.md, E8).
 */

const KEY = 'lifefit:onboarding-v2';

export function onboardingV2Enabled(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  try {
    const param = new URLSearchParams(window.location.search).get('onboarding');
    if (param === 'v2') sessionStorage.setItem(KEY, '1');
    if (param === 'v1') sessionStorage.removeItem(KEY);
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return new URLSearchParams(window.location.search).get('onboarding') === 'v2';
  }
}
