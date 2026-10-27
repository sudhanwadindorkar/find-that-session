import { SessionDetailClient } from "@/components/SessionDetailClient";

type Props = {
  params: Promise<{ projectSlug: string; sessionId: string }>;
};

export default async function SessionPage({ params }: Props) {
  const { projectSlug, sessionId } = await params;
  return (
    <SessionDetailClient
      projectSlug={decodeURIComponent(projectSlug)}
      sessionId={decodeURIComponent(sessionId)}
    />
  );
}
