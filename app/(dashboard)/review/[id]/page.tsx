"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MediaViewer } from "@/components/review/MediaViewer";
import { LabelPanel } from "@/components/review/LabelPanel";
import { ReviewToolbar } from "@/components/review/ReviewToolbar";
import { KeyboardShortcuts } from "@/components/review/KeyboardShortcuts";
import { useReviewStore } from "@/store/reviewStore";
import type { FrameDTO, LabelSaveResponse } from "@/types";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";

interface FrameResponse {
  frame: FrameDTO;
  queuePosition: number;
  totalPending: number;
}

export default function ReviewFramePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const id = params.id;

  // Context: where the user came from. "labeled" means we should keep navigating
  // through REVIEWED frames (optionally filtered by category) instead of jumping
  // back into the PENDING review queue.
  const from = searchParams.get("from");
  const category = searchParams.get("category") ?? "";
  const isLabeledContext = from === "labeled";
  const contextQS = (() => {
    const p = new URLSearchParams();
    if (from) p.set("from", from);
    if (category) p.set("category", category);
    const s = p.toString();
    return s ? `?${s}` : "";
  })();

  const setCurrentFrame = useReviewStore((s) => s.setCurrentFrame);
  const setQueueInfo = useReviewStore((s) => s.setQueueInfo);
  const selectedLabels = useReviewStore((s) => s.selectedLabels);

  const [saving, setSaving] = useState(false);
  const [flagReason, setFlagReason] = useState("");
  const [flagModal, setFlagModal] = useState(false);
  const [prevId, setPrevId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["frame", id],
    queryFn: async () => {
      const r = await fetch(`/api/items/${id}`);
      if (!r.ok) throw new Error("failed");
      return (await r.json()) as FrameResponse;
    },
  });

  useEffect(() => {
    if (data) {
      setCurrentFrame(data.frame);
      setQueueInfo(data.queuePosition, data.totalPending);
    }
    return () => setCurrentFrame(null);
  }, [data, setCurrentFrame, setQueueInfo]);

  async function submit(action: "save" | "skip" | "flag", reason?: string) {
    setSaving(true);
    try {
      const apiQS = new URLSearchParams();
      if (isLabeledContext) {
        apiQS.set("nextStatus", "REVIEWED");
        if (category) apiQS.set("nextCategory", category);
      }
      const apiUrl = `/api/items/${id}/label${apiQS.toString() ? `?${apiQS}` : ""}`;
      const r = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryIds: Array.from(selectedLabels),
          action,
          flagReason: reason,
        }),
      });
      const res = (await r.json()) as LabelSaveResponse;
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["labeled"] });
      setPrevId(id);
      if (res.nextFrameId) {
        router.push(`/review/${res.nextFrameId}${contextQS}`);
      } else {
        router.push(isLabeledContext ? "/labeled" : "/review");
      }
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-zinc-500">Loading frame...</div>;
  }

  const f = data.frame;
  const timeLabel = f.source.kind === "VIDEO"
    ? `${formatTime(f.timeSec)} / ${formatTime(f.source.duration ?? 0)}  â€¢  frame ${f.frameIndex + 1}/${f.source.frameCount}`
    : "image";

  return (
    <div className="flex h-screen flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 flex-[3] flex-col border-r border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-sm">
            <span className="truncate text-zinc-300" title={f.source.originalName}>
              {f.source.originalName}
            </span>
            <span className="text-xs text-zinc-500">
              {f.width && f.height ? `${f.width}Ã—${f.height} â€¢ ` : ""}
              {timeLabel}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
            <MediaViewer frame={f} />
          </div>
        </div>
        <div className="flex min-h-0 flex-[2] flex-col">
          <div className="border-b border-zinc-800 px-4 py-2 text-sm font-semibold">Labels</div>
          <div className="min-h-0 flex-1">
            <LabelPanel />
          </div>
        </div>
      </div>

      <ReviewToolbar
        position={data.queuePosition || 1}
        total={data.totalPending || 1}
        saving={saving}
        onSave={() => submit("save")}
        onSkip={() => submit("skip")}
        onFlag={() => setFlagModal(true)}
        onPrev={() => {
          if (prevId) router.push(`/review/${prevId}${contextQS}`);
          else router.back();
        }}
      />

      <KeyboardShortcuts
        onSave={() => submit("save")}
        onSkip={() => submit("skip")}
        onFlag={() => setFlagModal(true)}
        onPrev={() => (prevId ? router.push(`/review/${prevId}${contextQS}`) : router.back())}
      />

      <Modal open={flagModal} onClose={() => setFlagModal(false)} title="Flag this frame">
        <div className="space-y-4">
          <textarea
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            rows={3}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="Reason..."
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFlagModal(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                const r = flagReason.trim();
                setFlagReason("");
                setFlagModal(false);
                submit("flag", r);
              }}
            >
              Flag frame
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}
