"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Video, Upload, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadWithProgress } from "@/lib/supabase/upload-direct";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

interface Submission {
  id: string;
  storage_path: string;
  result_path: string | null;
  status: "queued" | "processing" | "done" | "failed";
  error: string | null;
  created_at: string;
}

const STATUS_TEXT: Record<Submission["status"], string> = {
  queued: "Waiting to be processed…",
  processing: "Processing your video…",
  done: "Ready",
  failed: "Processing failed",
};

export function SubmitClient() {
  const supabase = useRef(createClient()).current;
  const inputRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [resultUrls, setResultUrls] = useState<Record<string, string>>({});

  // Anonymous sign-in: the volunteer arrives from a QR code with no account.
  // signInAnonymously() mints a real auth.users row, so auth.uid() — and every
  // RLS policy built on it — works with no special cases. The session persists
  // in this browser, which is how they find their result again later.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        if (!cancelled) setUserId(session.user.id);
        return;
      }
      const { data, error } = await supabase.auth.signInAnonymously();
      if (cancelled) return;
      if (error) {
        // Overwhelmingly the cause: ENABLE_ANONYMOUS_USERS is not set on GoTrue.
        setAuthError(error.message);
        return;
      }
      setUserId(data.user?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [supabase]);

  const loadSubmissions = useCallback(async () => {
    const { data } = await supabase
      .from("submissions")
      .select("*")
      .order("created_at", { ascending: false });
    setSubmissions((data as Submission[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    if (!userId) return;
    loadSubmissions();

    // The worker updates our row; Realtime pushes it here. RLS is applied per
    // subscriber, so this only ever delivers our own rows.
    const channel = supabase
      .channel("my-submissions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submissions", filter: `user_id=eq.${userId}` },
        () => loadSubmissions()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, supabase, loadSubmissions]);

  // `results` is a private bucket, so playback needs a short-lived signed URL.
  useEffect(() => {
    const done = submissions.filter((s) => s.status === "done" && s.result_path);
    if (!done.length) return;
    (async () => {
      const entries = await Promise.all(
        done.map(async (s) => {
          const { data } = await supabase.storage
            .from("results")
            .createSignedUrl(s.result_path!, 3600);
          return [s.id, data?.signedUrl] as const;
        })
      );
      setResultUrls((prev) => ({
        ...prev,
        ...Object.fromEntries(entries.filter(([, url]) => url)) as Record<string, string>,
      }));
    })();
  }, [submissions, supabase]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setUploadError(null);
    setProgress(0);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setUploadError("Session expired — reload the page");
      setProgress(null);
      return;
    }

    // The leading path segment MUST be the user id: it's what the storage RLS
    // policy checks, and what tells the worker whose result this is.
    const ext = file.name.split(".").pop()?.toLowerCase() || "mp4";
    const path = `${userId}/${Date.now()}.${ext}`;

    const { error } = await uploadWithProgress(
      supabase, "submissions", path, file, session.access_token, setProgress
    );

    if (error) {
      setUploadError(error);
      setProgress(null);
      return;
    }

    // Only now record it — a row with no file behind it would be a job the
    // worker can never complete.
    const { error: insertError } = await supabase
      .from("submissions")
      .insert({ user_id: userId, storage_path: path });

    setProgress(null);
    if (insertError) {
      setUploadError(insertError.message);
      return;
    }
    if (inputRef.current) inputRef.current.value = "";
    loadSubmissions();
  }

  if (authError) {
    return (
      <div className="rounded-lg border border-destructive/50 p-4 text-sm">
        <p className="font-medium text-destructive">Could not start a session</p>
        <p className="mt-1 text-muted-foreground">{authError}</p>
      </div>
    );
  }

  const busy = progress !== null;

  return (
    <div className="space-y-6">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        // `capture` hands off to the phone's own camera app — it deals with
        // codecs, orientation and permissions. Desktop browsers ignore it and
        // fall back to a file picker, which is what we want there.
        capture="environment"
        className="hidden"
        onChange={handleFile}
        disabled={busy || !userId}
      />

      {busy ? (
        <div className="space-y-2">
          <Progress value={progress ?? 0} />
          <p className="text-sm text-muted-foreground">
            Uploading… {progress}% — keep this page open
          </p>
        </div>
      ) : (
        <Button
          size="lg"
          className="h-16 w-full text-base"
          onClick={() => inputRef.current?.click()}
          disabled={!userId}
        >
          {userId ? (
            <>
              <Video className="mr-2 h-5 w-5" />
              Record a video
            </>
          ) : (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Starting…
            </>
          )}
        </Button>
      )}

      {uploadError && (
        <p className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {uploadError}
        </p>
      )}

      {submissions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Your videos</h2>
          {submissions.map((s) => (
            <div key={s.id} className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-sm">
                {s.status === "done" ? (
                  <CheckCircle2 className="h-4 w-4 text-primary" />
                ) : s.status === "failed" ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                <span>{STATUS_TEXT[s.status]}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {new Date(s.created_at).toLocaleString("nl-NL", {
                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>

              {s.status === "failed" && s.error && (
                <p className="mt-2 text-xs text-muted-foreground">{s.error}</p>
              )}

              {s.status === "done" && resultUrls[s.id] && (
                <video
                  src={resultUrls[s.id]}
                  controls
                  playsInline
                  preload="metadata"
                  className="mt-3 w-full rounded"
                />
              )}
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Your videos stay on this device&apos;s session. Clearing your browser data
        will lose access to them.
      </p>
    </div>
  );
}
