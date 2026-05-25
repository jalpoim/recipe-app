import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UserProtein } from '../types/db'

export const PROTEIN_TIER1 = ['chicken', 'beef', 'pork', 'salmon', 'tuna', 'cod', 'eggs', 'shrimp']
export const PROTEIN_TIER2 = ['turkey', 'lamb', 'sardine', 'hake', 'sea-bream', 'sea-bass', 'mackerel', 'octopus', 'tofu', 'legumes', 'whey']
export const ALL_PROTEIN_SLUGS = [...PROTEIN_TIER1, ...PROTEIN_TIER2]

export function ProteinPicker({
  selected,
  onToggle,
  userProteins,
  onAddCustom,
  onDeleteUserProtein,
}: {
  selected: string[]
  onToggle: (slug: string) => void
  userProteins: UserProtein[]
  onAddCustom: (displayName: string) => void
  onDeleteUserProtein: (id: string) => void
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [customInput, setCustomInput] = useState('')
  const chipBase = 'text-xs px-3 py-1.5 rounded-full border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none'
  const chipActive = 'bg-[#FEE9E1] border-[#F4623A] text-[#D94F2B]'
  const chipInactive = 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#F4623A]'
  const visible = expanded ? ALL_PROTEIN_SLUGS : PROTEIN_TIER1
  const canAdd = customInput.trim().length > 0

  function handleAddCustom() {
    if (!customInput.trim()) return
    onAddCustom(customInput.trim())
    setCustomInput('')
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {visible.map((slug) => (
          <button
            key={slug}
            type="button"
            onClick={() => onToggle(slug)}
            aria-pressed={selected.includes(slug)}
            className={`${chipBase} ${selected.includes(slug) ? chipActive : chipInactive}`}
          >
            {t(`proteins.${slug}`, slug)}
          </button>
        ))}
      </div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((e) => !e)}
        className="text-xs text-[#F4623A] font-medium focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none"
      >
        {expanded ? t('tagSections.verMenos') : t('tagSections.verMais')}
      </button>
      {userProteins.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-[#9CA3AF] uppercase tracking-wider mb-2">
            {t('create.myProteins', 'Os meus')}
          </p>
          <div className="flex flex-wrap gap-2">
            {userProteins.map((p) => (
              <span
                key={p.slug}
                className={`${chipBase} flex items-center gap-1 ${selected.includes(p.slug) ? chipActive : chipInactive}`}
              >
                <button
                  type="button"
                  onClick={() => onToggle(p.slug)}
                  aria-pressed={selected.includes(p.slug)}
                  className="focus:outline-none"
                >
                  {p.display_name}
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteUserProtein(p.id)}
                  aria-label={`Remover proteína ${p.display_name}`}
                  className="focus:outline-none opacity-60 hover:opacity-100 transition-opacity"
                >
                  <X size={10} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={customInput}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddCustom() } }}
          placeholder={t('create.addProteinPlaceholder', 'Adicionar proteína…')}
          className="flex-1 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[16px] text-[#1A1A1A] placeholder:text-[#9CA3AF] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:border-[#F4623A] transition-colors"
        />
        <button
          type="button"
          onClick={handleAddCustom}
          disabled={!canAdd}
          className="w-9 h-9 rounded-xl border border-[#E5E7EB] bg-white flex items-center justify-center text-[#F4623A] hover:bg-[#FFF5F2] disabled:opacity-40 transition-colors focus-visible:ring-2 focus-visible:ring-[#F4623A]/40 focus:outline-none shrink-0"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
