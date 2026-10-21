import './ReportConsent.css';
import type { LauncherApi, ReportConsentRequest } from '../../../ipc/contract';
import { button, h, openDialog, Toast } from '../../lib/ui';
import { CONSENT_TEXT, reportResultMessage } from './ReportMessages';

/**
 * Asks the player before a report leaves the PC. One dialog at a time: the
 * other requests wait. Closing without answering keeps the report on disk, it
 * is asked again at the next launch.
 */
export class ReportConsent {
  private readonly api: LauncherApi;
  private readonly waiting: ReportConsentRequest[] = [];
  private open = false;

  constructor(api: LauncherApi, private readonly onMessage?: (text: string, tone: 'ok' | 'info') => void) {
    this.api = api;
    api.onReportConsent((request) => this.enqueue(request));
  }

  private enqueue(request: ReportConsentRequest): void {
    if (this.waiting.some((item) => item.reportId === request.reportId)) return;
    this.waiting.push(request);
    this.showNext();
  }

  private showNext(): void {
    if (this.open) return;
    const request = this.waiting.shift();
    if (!request) return;
    this.open = true;

    const always = h('input', { attrs: { type: 'checkbox' } });
    const answer = (send: boolean): void => {
      dialog.close();
      void this.api
        .answerReportConsent({ reportId: request.reportId, send, always: send && always.checked })
        .then((result) => {
          const message = reportResultMessage(result);
          if (!send || !message) return;
          Toast.show(message.text, message.tone);
          this.onMessage?.(message.text, message.tone);
        })
        .catch(() => {
          // Sending a report must never bother the player.
        });
    };

    const dialog = openDialog({
      title: CONSENT_TEXT.title,
      body: [
        h('p', { text: CONSENT_TEXT.question }),
        request.summary.length > 0 ? h('p', { className: 'report-consent__summary', text: request.summary.slice(0, 3).join(' · ') }) : null,
        h('p', { className: 'report-consent__detail', text: CONSENT_TEXT.detail }),
        h('label', { className: 'report-consent__always' }, always, h('span', { text: CONSENT_TEXT.always })),
      ],
      foot: [
        button({ label: CONSENT_TEXT.later, variant: 'ghost', onClick: () => answer(false) }),
        button({ label: CONSENT_TEXT.send, variant: 'primary', onClick: () => answer(true) }),
      ],
      // Closed without an answer: the report stays on disk and is asked again at the next launch.
      onClose: () => {
        this.open = false;
        this.showNext();
      },
    });
  }
}
