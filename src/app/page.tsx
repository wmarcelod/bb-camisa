import { StudioShell } from "@/components/studio-shell";

export default function HomePage() {
  return (
    <StudioShell
      baseShirtPath="/base-shirt.jpeg"
      openAiConfigured={Boolean(process.env.OPENAI_API_KEY)}
    />
  );
}
