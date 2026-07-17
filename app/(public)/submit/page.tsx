import type { Metadata } from "next";
import { SubmitClient } from "./submit-client";

export const metadata: Metadata = {
  title: "Send us a video",
};

export default function SubmitPage() {
  return (
    <div className="container mx-auto max-w-md px-4 py-10">
      <h1 className="text-3xl font-bold">Send us a video</h1>
      <p className="mt-2 mb-8 text-muted-foreground">
        Record the river where you are. We process it and send the result back to
        this page — you don&apos;t need an account.
      </p>
      <SubmitClient />
    </div>
  );
}
