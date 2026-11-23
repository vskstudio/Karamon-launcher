import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useId } from 'preact/hooks';
import { cx } from '../cx';
import { useFocusTrap, useOverlayLayer } from '../overlayStack';
import { IconButton } from './Button';
import './Dialog.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ComponentChildren;
  description?: ComponentChildren;
  children?: ComponentChildren;
  footer?: ComponentChildren;
  hero?: ComponentChildren;
  size?: 'sm' | 'md' | 'lg';
  dismissible?: boolean;
  role?: 'dialog' | 'alertdialog';
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  hero,
  size = 'md',
  dismissible = true,
  role = 'dialog',
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const token = useOverlayLayer(open, dismissible ? onClose : null);
  const containerRef = useFocusTrap(open, token);

  if (!open) return null;

  return createPortal(
    <div
      class="ui-dialog-scrim"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        class={cx('ui-dialog', 'surface', `ui-dialog--${size}`)}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        {hero ? <div class="ui-dialog__hero">{hero}</div> : null}
        {dismissible ? <IconButton glyph="close" label="Fermer" size="sm" class="ui-dialog__close" onClick={onClose} /> : null}
        <div class="ui-dialog__body">
          <h2 id={titleId} class="ui-dialog__title">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} class="ui-dialog__description">
              {description}
            </p>
          ) : null}
          {children}
        </div>
        {footer ? <footer class="ui-dialog__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}
