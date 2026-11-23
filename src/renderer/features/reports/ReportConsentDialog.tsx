import { useEffect, useState } from 'preact/hooks';
import type { ReportConsentRequest } from '../../../ipc/contract';
import { api } from '../../state/api';
import { config } from '../../state/config';
import { log } from '../../state/console';
import { consentRequests, takeConsentRequest } from '../../state/notices';
import { Button, Checkbox, Dialog, toast } from '../../ui';
import { CONSENT_TEXT, reportResultMessage } from './ReportMessages';
import './ReportConsentDialog.css';

async function answer(request: ReportConsentRequest, send: boolean, always: boolean): Promise<void> {
  takeConsentRequest(request.reportId);
  try {
    const result = await api.answerReportConsent({ reportId: request.reportId, send, always: send && always });
    if (send && always && !result.autoSendNotSaved && config.value) config.value = { ...config.value, autoSendReports: true };
    const message = reportResultMessage(result);
    if (send && message) {
      const tone = message.tone === 'ok' ? 'success' : 'info';
      toast(message.text, tone);
      log(message.text, tone);
    }
    if (result.autoSendNotSaved) {
      const text = `Envoi automatique non enregistré : ${result.autoSendNotSaved}`;
      toast(text, 'error');
      log(text, 'error');
    }
  } catch (error) {
    const text = `Réponse au rapport impossible : ${error instanceof Error ? error.message : String(error)}`;
    toast(text, 'error');
    log(text, 'error');
  }
}

export function ReportConsentDialog() {
  const request = consentRequests.value[0] ?? null;
  const [always, setAlways] = useState(false);

  useEffect(() => {
    setAlways(false);
  }, [request?.reportId]);

  return (
    <Dialog
      key={request?.reportId ?? 'none'}
      open={request !== null}
      onClose={() => {
        if (request) takeConsentRequest(request.reportId);
      }}
      title={CONSENT_TEXT.title}
      description={CONSENT_TEXT.question}
      footer={
        request ? (
          <>
            <Button variant="ghost" onClick={() => void answer(request, false, false)}>
              {CONSENT_TEXT.later}
            </Button>
            <Button variant="primary" onClick={() => void answer(request, true, always)}>
              {CONSENT_TEXT.send}
            </Button>
          </>
        ) : null
      }
    >
      {request && request.summary.length > 0 ? (
        <p class="report-consent__summary mono selectable">{request.summary.slice(0, 3).join(' · ')}</p>
      ) : null}
      <p class="report-consent__detail">{CONSENT_TEXT.detail}</p>
      <Checkbox checked={always} onChange={setAlways}>
        {CONSENT_TEXT.always}
      </Checkbox>
    </Dialog>
  );
}
