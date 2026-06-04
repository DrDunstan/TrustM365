import { X } from 'lucide-react'

export default function Modal({ open, title, children, onClose, actions }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-xl w-full max-w-sm p-6 relative">
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-white"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={18}/>
        </button>
        {title && <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>}
        <div className="mb-4 text-sm text-gray-200">{children}</div>
        <div className="flex justify-end gap-2">
          {actions}
        </div>
      </div>
    </div>
  )
}
