import { routes } from '../../../ipc/contract';
import type { RouteRegistry } from '../../ipc/IpcRouter';
import type { ReportManager } from './ReportManager';

export function registerReportRoutes(router: RouteRegistry, reports: ReportManager): void {
  router.handle(routes.sendManualReport, () => reports.sendManual());
  router.handle(routes.answerReportConsent, ({ reportId, send, always }) => reports.answerConsent(reportId, send, always));
}
