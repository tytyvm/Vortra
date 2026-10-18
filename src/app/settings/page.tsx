import { Header } from "@/components/Header";
import { Login } from "@/components/Login";
import { Settings } from "@/components/Settings";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  if (!(await currentUser())) return <Login />;
  return (
    <div className="app">
      <Header active="settings" />
      <Settings />
    </div>
  );
}
