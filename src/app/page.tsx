import { StudioShell } from "@/components/studio-shell";

export default function HomePage() {
  return <StudioShell openAiConfigured={Boolean(process.env.OPENAI_API_KEY)} />;
}
