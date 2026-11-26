import { AuroraBackground } from './AuroraBackground';
import { OverlayHosts } from './OverlayHosts';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

/**
 * Application chrome. Legacy CRM logic (`features/legacy/app.js`) renders into
 * `#nav`, `#view`, and overlay hosts via delegated click handlers and innerHTML.
 */
export function AppLayout() {
  return (
    <>
      <AuroraBackground />
      <div className="shell" id="shell">
        <Sidebar />
        <main className="main">
          <TopBar />
          <section id="view" className="view" />
        </main>
      </div>
      <OverlayHosts />
    </>
  );
}