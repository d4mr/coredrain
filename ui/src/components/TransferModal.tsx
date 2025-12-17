import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TransferDetail } from "./TransferDetail";
import type { Transfer } from "@/types";

interface TransferModalProps {
  transfer: Transfer | null;
  onClose: () => void;
}

export function TransferModal({ transfer, onClose }: TransferModalProps) {
  return (
    <Dialog open={!!transfer} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="bg-bg-secondary border-border-accent max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
        showCloseButton={false}
      >
        {transfer && (
          <TransferDetail
            transfer={transfer}
            onClose={onClose}
            expanded
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
