import { RepositoryClient } from "./RepositoryClient";

export default async function RepositoryPage({ params }: { params: Promise<{ id:string }> }) {
  const { id } = await params;
  return <RepositoryClient id={id} />;
}
