import "@/app/app.css";
import { SiteNav } from "@/components/site-nav";
import { AttestPanel } from "@/components/attest-panel";

export default function AttestPage() {
  return (
    <div className="app-shell">
      <SiteNav />
      <main className="app-main">
        <AttestPanel />
      </main>
    </div>
  );
}
