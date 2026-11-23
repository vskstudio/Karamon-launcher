import { routes } from '../../../ipc/contract.ts';
import type { RouteRegistry } from '../../ipc/IpcRouter.ts';
import type { ReportManager } from './ReportManager.ts';

export function registerReportRoutes(router: RouteRegistry, reports: ReportManager): void {
  router.handle(routes.sendManualReport, () => reports.sendManual());
  router.handle(routes.answerReportConsent, ({ reportId, send, always }) => reports.answerConsent(reportId, send, always));
}
