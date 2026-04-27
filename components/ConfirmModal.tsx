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
    <div className="fixed inset-0 z-[80] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-coco-900 mb-2">{title}</h2>
        <div className="text-coco-700 text-sm mb-5">{message}</div>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="btn-ghost" disabled={loading}>
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={danger ? "btn-danger" : "btn-primary"}
          >
            {loading ? "…" : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
