import "@/app/app.css";
import { SiteNav } from "@/components/site-nav";
import { ConnectPanel } from "@/components/connect-panel";

export default function ConnectPage() {
  return (
    <div className="app-shell">
      <SiteNav />
      <main className="app-main">
        <ConnectPanel />
      </main>
    </div>
  );
}
