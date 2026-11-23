import { AccountsDialog } from '../features/accounts/AccountsDialog';
import { ReportConsentDialog } from '../features/reports/ReportConsentDialog';
import { location } from '../state/navigation';
import { ToastHost } from '../ui';
import { ConsoleDrawer } from './ConsoleDrawer';
import { Konami } from './Konami';
import { NoticeStack } from './NoticeStack';
import { routeOf } from './routes';
import { Sidebar } from './Sidebar';
import { TitleBar } from './TitleBar';
import './App.css';

export function App() {
  const { page, param } = location.value;
  const Current = routeOf(page).component;
  return (
    <div class="shell">
      <TitleBar />
      <div class="shell__body">
        <Sidebar />
        <main class="shell__main">
          <NoticeStack />
          <Current key={page} param={param} />
          <ConsoleDrawer />
        </main>
      </div>
      <AccountsDialog />
      <ReportConsentDialog />
      <ToastHost />
      <Konami />
    </div>
  );
}
