import { useLateMount } from '../../lib/motion';
import styles from './Motion.module.css';

/**
 * A text that is "set in" when it changes – a replaced meal's new title slides
 * in instead of just swapping. Keyed by the text: a new text is a new element;
 * it animates only if it appeared after the screen was shown (not on arrival).
 */
export function SwapText({ text, className }: { text: string; className?: string }) {
  return <SwapInner key={text} text={text} className={className} />;
}

function SwapInner({ text, className }: { text: string; className?: string }) {
  const late = useLateMount();
  return <span className={[className, late && styles.swapIn].filter(Boolean).join(' ')}>{text}</span>;
}

export const motionStyles = styles;
