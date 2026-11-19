import { DrillVideoPage } from "@/components/training-videos";
export default async function Page({
  params,
}: {
  params: Promise<{ drillId: string }>;
}) {
  const { drillId } = await params;
  return <DrillVideoPage drillId={drillId} admin />;
}
