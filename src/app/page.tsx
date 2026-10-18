import { Chat, type UIMessage } from "@/components/Chat";
import { Header } from "@/components/Header";
import { Login } from "@/components/Login";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { todayView } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ login?: string }> }) {
  const user = await currentUser();
  if (!user) return <Login expired={(await searchParams).login === "expired"} />;
  const rows = await prisma.message.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: { id: true, role: true, content: true, hasImage: true, kind: true },
  });
  const messages = rows.reverse() as UIMessage[];
  const today = await todayView(user.id, user.timezone);
  return (
    <div className="app">
      <Header active="chat" />
      <Chat initialMessages={messages} initialToday={today} userTz={user.timezone} />
    </div>
  );
}
