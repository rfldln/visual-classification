"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

interface Props {
  onSave: () => void;
  onSkip: () => void;
  onFlag: (reason: string) => void;
  onPrev: () => void;
  position: number;
  total: number;
  saving?: boolean;
  disabled?: boolean;
}

export function ReviewToolbar({ onSave, onSkip, onFlag, onPrev, position, total, saving, disabled }: Props) {
  const [flagOpen, setFlagOpen] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="flex items-center justify-between border-t border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onPrev} disabled={disabled}>
          ← Previous
        </Button>
        <span className="text-sm text-zinc-400">
          Item <span className="text-zinc-100">{position}</span> of <span className="text-zinc-100">{total}</span> pending
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setFlagOpen(true)} disabled={disabled}>
          Flag (F)
        </Button>
        <Button variant="secondary" size="sm" onClick={onSkip} disabled={disabled}>
          Skip (S)
        </Button>
        <Button variant="primary" onClick={onSave} disabled={disabled || saving}>
          {saving ? "Saving..." : "Save & Next (Enter)"}
        </Button>
      </div>

      <Modal open={flagOpen} onClose={() => setFlagOpen(false)} title="Flag this item">
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">Add a short reason. This item will be moved to the Flagged queue.</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="e.g., not sure of category, low quality, duplicate..."
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFlagOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={() => {
                onFlag(reason.trim());
                setReason("");
                setFlagOpen(false);
              }}
            >
              Flag item
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
