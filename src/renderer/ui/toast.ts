import { signal } from '@preact/signals';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  text: string;
  tone: ToastTone;
}

const DURATION_MS = 3200;
const MAX_VISIBLE = 3;

export const toasts = signal<ToastMessage[]>([]);

let nextId = 1;

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((toast) => toast.id !== id);
}

export function toast(text: string, tone: ToastTone = 'success'): void {
  const id = nextId++;
  toasts.value = [...toasts.value, { id, text, tone }].slice(-MAX_VISIBLE);
  setTimeout(() => dismissToast(id), DURATION_MS);
}
