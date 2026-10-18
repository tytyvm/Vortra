import { Header } from "@/components/Header";
import { History } from "@/components/History";
import { Login } from "@/components/Login";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  if (!(await currentUser())) return <Login />;
  return (
    <div className="app">
      <Header active="history" />
      <History />
    </div>
  );
}
