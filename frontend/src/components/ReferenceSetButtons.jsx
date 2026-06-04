import React from 'react'

export default function ReferenceSetButtons({ sets = [], selected, onSelect }) {
  if (!sets || sets.length === 0) return null
  return (
    <div className="flex items-center gap-2">
      {sets.map(s => (
        <button
          key={s.key}
          onClick={() => onSelect && onSelect(s.key)}
          aria-pressed={selected === s.key}
          className={`text-xs px-2 py-1 rounded ${selected === s.key ? 'border-brand-700/60 bg-brand-950/20 text-white' : 'border-gray-800 bg-gray-900 text-gray-300 hover:border-gray-700'}`}>
          {s.display}
        </button>
      ))}
    </div>
  )
}
