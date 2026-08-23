import { NewPullRequestClient } from "./NewPullRequestClient";

export default async function NewPullRequestPage({ params }: { params: Promise<{ id:string }> }) {
  const { id } = await params;
  return <NewPullRequestClient id={id} />;
}
