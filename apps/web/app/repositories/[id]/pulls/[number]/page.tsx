import { PullRequestClient } from "./PullRequestClient";

export default async function PullRequestPage({ params }: { params: Promise<{ id:string; number:string }> }) {
  const { id, number } = await params;
  return <PullRequestClient id={id} number={Number(number)} />;
}
