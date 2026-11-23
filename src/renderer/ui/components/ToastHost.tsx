import { cx } from '../cx';
import { dismissToast, toasts } from '../toast';
import { StatusDot } from './Tag';
import './ToastHost.css';

const toneDot = { success: 'success', error: 'danger', info: 'accent' } as const;

export function ToastHost() {
  return (
    <div class="ui-toasts" role="status" aria-live="polite">
      {toasts.value.map((item) => (
        <button
          key={item.id}
          type="button"
          class={cx('ui-toast', 'surface', `ui-toast--${item.tone}`)}
          onClick={() => dismissToast(item.id)}
        >
          <StatusDot tone={toneDot[item.tone]} />
          <span>{item.text}</span>
        </button>
      ))}
    </div>
  );
}
