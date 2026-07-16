import "@/app/app.css";
import { SiteNav } from "@/components/site-nav";
import { Dashboard } from "@/components/dashboard";

export default function AppPage() {
  return (
    <div className="app-shell">
      <SiteNav />
      <main className="app-main">
        <Dashboard />
      </main>
    </div>
  );
}
