"use client";

export default function ConfirmModal({
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  danger = false,
  onConfirm,
  onCancel,
  loading = false,
}: {
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop !z-[80]" role="dialog" aria-modal="true">
      <div className="modal-card modal-card--md modal-pad">
        <h2 className="text-xl font-bold text-coco-900 mb-2">{title}</h2>
        <div className="text-coco-700 text-sm mb-5">{message}</div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            onClick={onCancel}
            className="btn-ghost btn-touch"
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={
              (danger ? "btn-danger" : "btn-primary") + " btn-touch"
            }
          >
            {loading ? "Salvando…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
