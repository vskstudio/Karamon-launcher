import { $ } from '../util/dom';

export class Navigation {
  private static onChange: ((panel: string) => void) | undefined;

  static attach(onChange?: (panel: string) => void): void {
    Navigation.onChange = onChange;
    document.querySelectorAll<HTMLElement>('.nav-btn[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = btn.dataset.panel;
        if (panel) Navigation.go(panel);
      });
    });
  }

  static go(panel: string): void {
    document.querySelectorAll<HTMLElement>('.nav-btn[data-panel]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.panel === panel);
    });
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    $('panel-' + panel).classList.add('active');
    Navigation.onChange?.(panel);
  }
}
