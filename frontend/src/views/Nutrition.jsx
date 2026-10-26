import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNutrition } from '../store/useNutrition.js'
import { useUI } from '../store/useUI.js'
import {
  addDays, addEntry, addWater, averageLogged, barPct, dayOf, dayTotals, exportNutrition, fmtLiters,
  importNutrition, overTarget, recentDays, removeEntry, removeFood, saveFood, setTargets,
} from '../lib/nutrition.js'
import { fmtDate, fmtNum, todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, Switch, TextField } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import './Nutrition.css'

// Calories, protein and water per day, kept on this device (lib/nutrition.js, store/useNutrition.js).
const update = fn => useNutrition.getState().update(fn)
const toast = message => useUI.getState().toast(message)

// One bar. `limit` is for a number you should stay under (calories): past the target it turns
// orange. Protein and water have no ceiling worth warning about.
function Meter({ label, value, goal, shown, goalShown, limit = false, className = '' }) {
  const pct = barPct(value, goal)
  return <div className="nut-meter">
    <div className="nut-meter-top">
      <span className="muted small">{label}</span>
      <span><b>{shown}</b> <span className="muted small">/ {goalShown}</span></span>
    </div>
    <div className={'nut-bar ' + className + (limit && overTarget(value, goal) ? ' over' : '')}
      role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
      <i style={{ width: pct + '%' }} />
    </div>
  </div>
}

function AddFood({ day, close }) {
  const [name, setName] = useState('')
  const [kcal, setKcal] = useState(null)
  const [protein, setProtein] = useState(null)
  const [keep, setKeep] = useState(false)
  const save = () => {
    const food = { name, kcal: kcal ?? 0, protein: protein ?? 0 }
    if (!(food.kcal > 0) && !(food.protein > 0)) { toast(t('Enter calories or protein')); return }
    if (keep && !name.trim()) { toast(t('Give it a name to save it')); return }
    update(N => {
      const next = addEntry(N, day, food)
      return keep && next !== N ? saveFood(next, food) : next
    })
    close()
    toast(t('Added'))
  }
  return <>
    <h3>{t('Add food')}</h3>
    <TextField value={name} maxLength={60} placeholder={t('What did you eat?')} autoFocus
      onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
    <div style={{ height: 12 }} />
    <div className="measure-form">
      <label className="measure-field">
        <span>{t('Calories')}</span>
        <span className="measure-input"><NumberField nullable decimal={false} value={kcal} onChange={setKcal} placeholder="0" /><i>kcal</i></span>
      </label>
      <label className="measure-field">
        <span>{t('Protein')}</span>
        <span className="measure-input"><NumberField nullable value={protein} onChange={setProtein} placeholder="0" /><i>g</i></span>
      </label>
    </div>
    <div className="lrow" style={{ marginTop: 8 }}>
      <span className="lrow-m"><span className="lrow-t">{t('Save for quick add')}</span></span>
      <Switch checked={keep} onChange={setKeep} aria-label={t('Save for quick add')} />
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={save}>{t('Add')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </>
}

export function addFoodSheet(day = todayISO()) {
  return useUI.getState().openSheet(close => <AddFood day={day} close={close} />)
}

function Manage({ close }) {
  const N = useNutrition(s => s.N)
  const [kcal, setKcal] = useState(N.targets.kcal)
  const [protein, setProtein] = useState(N.targets.protein)
  const [water, setWater] = useState(N.targets.water)
  const fileRef = useRef(null)

  const saveTargets = () => {
    // An emptied field reads 0: it keeps the target it had instead of snapping to the lowest.
    update(cur => setTargets(cur, { kcal: kcal || null, protein: protein || null, water: water || null }))
    toast(t('Targets saved'))
    close()
  }
  const exportFile = () => {
    const blob = new Blob([exportNutrition(useNutrition.getState().N)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'opengym-nutrition-' + todayISO() + '.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }
  // The file is read first and only a good one reaches the question: picking the wrong file
  // must not wipe the data that is here.
  const onFile = async e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    let next
    try { next = importNutrition(await file.text()) } catch { toast(t('That file is not a nutrition backup.')); return }
    confirmSheet({
      title: t('Replace your nutrition data?'),
      message: t('Restoring a backup replaces what is on this device now.'),
      confirmText: t('Restore'), danger: true,
      onConfirm: () => { useNutrition.getState().replace(next); toast(t('Backup restored')); close() },
    })
  }

  return <>
    <h3>{t('Targets')}</h3>
    <div className="measure-form">
      <label className="measure-field">
        <span>{t('Daily calories')}</span>
        <span className="measure-input"><NumberField decimal={false} value={kcal} onChange={setKcal} /><i>kcal</i></span>
      </label>
      <label className="measure-field">
        <span>{t('Daily protein')}</span>
        <span className="measure-input"><NumberField decimal={false} value={protein} onChange={setProtein} /><i>g</i></span>
      </label>
      <label className="measure-field">
        <span>{t('Daily water')}</span>
        <span className="measure-input"><NumberField decimal={false} value={water} onChange={setWater} /><i>ml</i></span>
      </label>
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" onClick={saveTargets}>{t('Save')}</Button>

    <h4 className="sec" style={{ margin: '20px 2px 6px' }}>{t('Saved foods')}</h4>
    {N.foods.length ? N.foods.map(f => <div className="nut-saved" key={f.id}>
      <div style={{ minWidth: 0 }}>
        <b style={{ overflowWrap: 'anywhere' }}>{f.name}</b>
        <div className="small dim">{fmtNum(f.kcal)} kcal · {fmtNum(f.protein)} g</div>
      </div>
      <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => update(cur => removeFood(cur, f.id))} aria-label={t('Delete')}><Icon name="trash" /></button>
    </div>) : <div className="muted small">{t('No saved foods yet. Turn on "Save for quick add" when you add one.')}</div>}

    <h4 className="sec" style={{ margin: '20px 2px 6px' }}>{t('Backup')}</h4>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('This data lives only in this browser. Back it up now and then.')}</div>
    <div className="row" style={{ gap: 8 }}>
      <Button icon="download" onClick={exportFile}>{t('Export')}</Button>
      <Button icon="folder" onClick={() => fileRef.current?.click()}>{t('Restore from file')}</Button>
    </div>
    <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onFile} />
    <div style={{ height: 14 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Done')}</Button>
  </>
}

export function manageNutritionSheet() {
  return useUI.getState().openSheet(close => <Manage close={close} />)
}

export default function Nutrition() {
  const nav = useNavigate()
  const N = useNutrition(s => s.N)
  const today = todayISO()
  const [day, setDay] = useState(today)
  const isToday = day >= today
  const entries = dayOf(N, day).entries
  const totals = dayTotals(dayOf(N, day))
  const { kcal, protein, water } = N.targets
  const week = recentDays(N, today, 7)
  const avg = averageLogged(week)

  const quickAdd = food => {
    update(cur => addEntry(cur, day, food))
    toast(t('Added {0}', food.name))
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" data-back="/home" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginInlineStart: 12 }}><h1>{t('Nutrition')}</h1><div className="sub">{t('Calories, protein and water')}</div></div>
      <button className="iconbtn" onClick={manageNutritionSheet} aria-label={t('Targets and backup')}><Icon name="gear" /></button>
    </div>

    <div className="card">
      <div className="row between nut-day">
        <button className="iconbtn" onClick={() => setDay(addDays(day, -1))} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
        <b>{isToday ? t('Today') : fmtDate(day, true, true)}</b>
        <button className="iconbtn" disabled={isToday} onClick={() => setDay(addDays(day, 1))} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
      </div>
      <Meter label={t('Calories')} value={totals.kcal} goal={kcal} limit
        shown={fmtNum(totals.kcal)} goalShown={fmtNum(kcal) + ' kcal'} />
      <Meter label={t('Protein')} value={totals.protein} goal={protein}
        shown={fmtNum(totals.protein)} goalShown={fmtNum(protein) + ' g'} />
      <Meter label={t('Water')} value={totals.water} goal={water} className="water"
        shown={fmtLiters(totals.water)} goalShown={fmtLiters(water) + ' L'} />
      <div className="nut-water-btns">
        <Button size="sm" icon="plus" onClick={() => update(cur => addWater(cur, day, 250))}>{t('+{0} ml', 250)}</Button>
        <Button size="sm" icon="plus" onClick={() => update(cur => addWater(cur, day, 500))}>{t('+{0} ml', 500)}</Button>
        <Button size="sm" variant="ghost" className="dim" icon="undo" disabled={!totals.water} onClick={() => update(cur => addWater(cur, day, -250))}>{t('-{0} ml', 250)}</Button>
      </div>
    </div>

    <Button variant="primary" icon="plus" onClick={() => addFoodSheet(day)}>{t('Add food')}</Button>

    {N.foods.length > 0 && <>
      <h4 className="sec" style={{ margin: '18px 2px 10px' }}>{t('Quick add')}</h4>
      <div className="nut-chips">{N.foods.map(f => <button className="nut-chip" key={f.id} onClick={() => quickAdd(f)}>
        <span>{f.name}</span>
        <small>{fmtNum(f.kcal)} kcal · {fmtNum(f.protein)} g</small>
      </button>)}</div>
    </>}

    <h4 className="sec" style={{ margin: '18px 2px 10px' }}>{t('Eaten')}</h4>
    {entries.length ? <div className="list">{entries.map(e => <div className="card nut-entry" key={e.id}>
      <div className="nut-entry-main">
        <b>{e.name || t('Food')}</b>
        <div className="small dim" style={{ marginTop: 2 }}>{fmtNum(e.kcal)} kcal · {fmtNum(e.protein)} g {t('protein')}</div>
      </div>
      <button className="iconbtn" style={{ color: 'var(--red)' }} onClick={() => update(cur => removeEntry(cur, day, e.id))} aria-label={t('Delete')}><Icon name="trash" /></button>
    </div>)}</div> : <div className="muted small" style={{ margin: '0 2px' }}>{t('Nothing logged yet.')}</div>}

    <h4 className="sec" style={{ margin: '18px 2px 10px' }}>{t('Last 7 days')}</h4>
    <div className="card">
      {week.map(r => <button className={'nut-week-row' + (r.d === day ? ' sel' : '')} key={r.d} onClick={() => setDay(r.d)}>
        <span className="small">{fmtDate(r.d, true)}</span>
        <span className={'nut-bar' + (overTarget(r.kcal, kcal) ? ' over' : '')}><i style={{ width: barPct(r.kcal, kcal) + '%' }} /></span>
        <span className="small dim nut-week-v">{r.count ? fmtNum(r.kcal) + ' kcal · ' + fmtNum(r.protein) + ' g' : '–'}</span>
      </button>)}
      {avg && <div className="muted small" style={{ marginTop: 8 }}>{t('Average over {0} days with food logged: {1} kcal, {2} g protein', avg.days, fmtNum(avg.kcal), fmtNum(avg.protein))}</div>}
    </div>
  </div>
}
