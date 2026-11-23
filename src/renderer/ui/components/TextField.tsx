import type { Ref } from 'preact';
import { useId } from 'preact/hooks';
import { cx } from '../cx';
import { Glyph } from './Glyph';
import './Controls.css';

interface TextFieldProps {
  value: string;
  onInput: (value: string) => void;
  label: string;
  hideLabel?: boolean;
  placeholder?: string;
  type?: 'text' | 'search' | 'password';
  hint?: string;
  error?: string | null;
  maxLength?: number;
  autoFocus?: boolean;
  spellcheck?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onEnter?: () => void;
  mono?: boolean;
  class?: string;
}

export function TextField({
  value,
  onInput,
  label,
  hideLabel = false,
  placeholder,
  type = 'text',
  hint,
  error,
  maxLength,
  autoFocus,
  spellcheck = false,
  inputRef,
  onEnter,
  mono = false,
  class: className,
}: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const isSearch = type === 'search';
  return (
    <div class={cx('ui-field', className)}>
      <label for={id} class={cx('ui-field__label', hideLabel && 'visually-hidden')}>
        {label}
      </label>
      <div class={cx('ui-field__box', isSearch && 'ui-field__box--search', error && 'is-invalid')}>
        {isSearch ? <Glyph name="search" size={16} class="ui-field__icon" /> : null}
        <input
          ref={inputRef}
          id={id}
          class={cx('ui-field__input', mono && 'mono')}
          type={type as 'text'}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          autoFocus={autoFocus}
          spellcheck={spellcheck}
          autocomplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={hint || error ? hintId : undefined}
          onInput={(event) => onInput((event.currentTarget as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onEnter) {
              event.preventDefault();
              onEnter();
            }
          }}
        />
        {isSearch && value ? (
          <button type="button" class="ui-field__clear" aria-label="Effacer la recherche" onClick={() => onInput('')}>
            <Glyph name="close" size={14} />
          </button>
        ) : null}
      </div>
      {error || hint ? (
        <p id={hintId} class={cx('ui-field__hint', error && 'is-error')}>
          {error ?? hint}
        </p>
      ) : null}
    </div>
  );
}
