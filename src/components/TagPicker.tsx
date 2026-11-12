import { HAZARD_TAG, TRASH_TAGS } from '../config'

export default function TagPicker({ value, onChange, disableHazard = false }: {
  value: string[]; onChange: (v: string[]) => void; disableHazard?: boolean
}) {
  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])
  return (
    <div className="tags">
      {TRASH_TAGS.map((t) => (
        <button type="button" key={t} className={'tag' + (value.includes(t) ? ' on' : '')}
          disabled={disableHazard && t === HAZARD_TAG} onClick={() => toggle(t)}>{t}</button>
      ))}
    </div>
  )
}
