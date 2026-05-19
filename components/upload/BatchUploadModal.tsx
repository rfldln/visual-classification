"use client";

import { Modal } from "@/components/ui/Modal";
import { DropZone } from "./DropZone";
import { UploadQueue } from "./UploadQueue";

export function BatchUploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Upload files">
      <DropZone />
      <UploadQueue />
    </Modal>
  );
}
