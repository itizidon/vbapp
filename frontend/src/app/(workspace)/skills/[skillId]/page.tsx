import { TrainingSkillPage } from "@/components/training-videos";
export default async function Page({
  params,
}: {
  params: Promise<{ skillId: string }>;
}) {
  const { skillId } = await params;
  return <TrainingSkillPage skillId={skillId} />;
}
