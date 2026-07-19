import "@/app/app.css";
import { SiteNav } from "@/components/site-nav";
import { ConnectPanel } from "@/components/connect-panel";
import { RequestChainForm } from "@/components/request-chain-form";

export default function ConnectPage() {
  return (
    <div className="app-shell">
      <SiteNav />
      <main className="app-main connect-page">
        <ConnectPanel />
        <RequestChainForm />
      </main>
    </div>
  );
}
