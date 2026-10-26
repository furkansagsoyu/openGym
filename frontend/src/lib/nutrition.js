// Nutrition counter: calories, protein and water per day.
//
// Kept on this device only, under its own localStorage key (store/useNutrition.js), so it is not
// part of the synced profile (S): the sync merge and the server never see it. Everything here is a
// pure helper that returns a new object and never edits its input, with a unit test beside it.
//
// Shape:
//   { v: 1,
//     targets: { kcal, protein, water },            // water in millilitres
//     foods:   [{ id, name, kcal, protein }],        // saved foods for one-tap adding
//     days:    { 'YYYY-MM-DD': { entries: [{ id, name, kcal, protein }], water } } }
import { dateLocale } from './i18n-core.js'
import { isoOf, uid } from './format.js'

export const NUTRITION_KEY = 'gym_nutrition_v1'
export const DEFAULT_TARGETS = { kcal: 2300, protein: 130, water: 2500 }
// [min, max] a target may be set to.
export const TARGET_LIMITS = { kcal: [800, 6000], protein: [20, 400], water: [500, 8000] }

const MAX_FOODS = 60
const MAX_ENTRIES = 100
const MAX_DAYS = 400
const MAX_NAME = 60
const MAX_WATER = 20000
const ISO = /^\d{4}-\d{2}-\d{2}$/

// A finite number clamped to [lo, hi] and rounded to `dp` decimals; null for anything else.
function num(v, lo, hi, dp = 0) {
  if (v === '' || v == null || typeof v === 'boolean') return null
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  const f = 10 ** dp
  return Math.round(Math.min(hi, Math.max(lo, n)) * f) / f
}
const cleanName = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)

export const emptyNutrition = () => ({ v: 1, targets: { ...DEFAULT_TARGETS }, foods: [], days: {} })

function normalizeFood(f, i) {
  if (!f || typeof f !== 'object') return null
  const name = cleanName(f.name)
  const kcal = num(f.kcal, 0, 5000)
  const protein = num(f.protein ?? 0, 0, 500, 1)
  if (!name || kcal == null || protein == null) return null
  return { id: typeof f.id === 'string' && f.id ? f.id : 'f' + i, name, kcal, protein }
}
function normalizeEntry(e, i) {
  if (!e || typeof e !== 'object') return null
  const kcal = num(e.kcal, 0, 5000)
  const protein = num(e.protein ?? 0, 0, 500, 1)
  if (kcal == null || protein == null) return null
  return { id: typeof e.id === 'string' && e.id ? e.id : 'e' + i, name: cleanName(e.name), kcal, protein }
}

// Whatever was stored or imported, turned into a valid state: junk is dropped, numbers are
// clamped, caps keep the file small. Never throws.
export function normalizeNutrition(raw) {
  const out = emptyNutrition()
  if (!raw || typeof raw !== 'object') return out
  const tg = raw.targets && typeof raw.targets === 'object' ? raw.targets : {}
  for (const k of Object.keys(DEFAULT_TARGETS)) {
    const [lo, hi] = TARGET_LIMITS[k]
    out.targets[k] = num(tg[k], lo, hi) ?? DEFAULT_TARGETS[k]
  }
  const seen = new Set()
  const foods = Array.isArray(raw.foods) ? raw.foods : []
  for (let i = 0; i < foods.length && out.foods.length < MAX_FOODS; i++) {
    const food = normalizeFood(foods[i], i)
    if (!food || seen.has(food.name.toLowerCase())) continue
    seen.add(food.name.toLowerCase())
    out.foods.push(food)
  }
  const days = raw.days && typeof raw.days === 'object' ? raw.days : {}
  for (const iso of Object.keys(days).filter(k => ISO.test(k)).sort().slice(-MAX_DAYS)) {
    const d = days[iso]
    if (!d || typeof d !== 'object') continue
    const entries = (Array.isArray(d.entries) ? d.entries : []).map(normalizeEntry).filter(Boolean).slice(0, MAX_ENTRIES)
    const water = num(d.water, 0, MAX_WATER) ?? 0
    if (entries.length || water) out.days[iso] = { entries, water }
  }
  return out
}

export const dayOf = (N, iso) => N.days[iso] || { entries: [], water: 0 }

export function dayTotals(day) {
  let kcal = 0
  let protein = 0
  for (const e of day.entries) { kcal += e.kcal; protein += e.protein }
  return { kcal: Math.round(kcal), protein: Math.round(protein * 10) / 10, water: day.water || 0, count: day.entries.length }
}

// The day with `fn` applied to it; a day left with nothing in it is dropped from the file.
function withDay(N, iso, fn) {
  const day = dayOf(N, iso)
  const next = fn({ entries: day.entries, water: day.water || 0 })
  const days = { ...N.days }
  if (next.entries.length || next.water) days[iso] = next
  else delete days[iso]
  return { ...N, days }
}

// A food eaten on `iso`. Returns N itself when the input is not usable, so callers can tell
// nothing changed. The name may be empty: "200 kcal" is a fair entry.
export function addEntry(N, iso, { name, kcal, protein }, id = uid()) {
  const k = num(kcal, 0, 5000)
  const p = num(protein ?? 0, 0, 500, 1)
  if (!ISO.test(iso) || k == null || p == null || (k === 0 && p === 0)) return N
  if (dayOf(N, iso).entries.length >= MAX_ENTRIES) return N
  return withDay(N, iso, d => ({ ...d, entries: [...d.entries, { id, name: cleanName(name), kcal: k, protein: p }] }))
}

export const removeEntry = (N, iso, id) => withDay(N, iso, d => ({ ...d, entries: d.entries.filter(e => e.id !== id) }))

// Water in millilitres, added or (negative) taken back; never below 0.
export function addWater(N, iso, ml) {
  const n = Number(ml)
  if (!ISO.test(iso) || !Number.isFinite(n)) return N
  return withDay(N, iso, d => ({ ...d, water: Math.min(MAX_WATER, Math.max(0, Math.round(d.water + n))) }))
}

// Saves a food for one-tap adding. The same name (any case) updates the saved one.
export function saveFood(N, { name, kcal, protein }, id = uid()) {
  const food = normalizeFood({ id, name, kcal, protein }, 0)
  if (!food) return N
  const i = N.foods.findIndex(f => f.name.toLowerCase() === food.name.toLowerCase())
  if (i >= 0) {
    const foods = N.foods.slice()
    foods[i] = { ...food, id: N.foods[i].id }
    return { ...N, foods }
  }
  if (N.foods.length >= MAX_FOODS) return N
  return { ...N, foods: [...N.foods, food] }
}

export const removeFood = (N, id) => ({ ...N, foods: N.foods.filter(f => f.id !== id) })

// Only the targets that are usable change; the rest keep their value.
export function setTargets(N, next) {
  const targets = { ...N.targets }
  for (const k of Object.keys(DEFAULT_TARGETS)) {
    const [lo, hi] = TARGET_LIMITS[k]
    const v = num(next?.[k], lo, hi)
    if (v != null) targets[k] = v
  }
  return { ...N, targets }
}

export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return isoOf(d)
}

// The `n` days ending at `endIso`, oldest first, each with its totals (empty days included).
export function recentDays(N, endIso, n = 7) {
  const out = []
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(endIso, -i)
    out.push({ d, ...dayTotals(dayOf(N, d)) })
  }
  return out
}

// Average calories and protein over the days that have food logged; null when there are none.
export function averageLogged(rows) {
  const logged = rows.filter(r => r.count > 0)
  if (!logged.length) return null
  const sum = key => logged.reduce((a, r) => a + r[key], 0) / logged.length
  return { days: logged.length, kcal: Math.round(sum('kcal')), protein: Math.round(sum('protein') * 10) / 10 }
}

// How full a bar is, 0 to 100, and whether the value is past the target.
export const barPct = (value, target) => (target > 0 ? Math.min(100, Math.round((Math.max(0, value) / target) * 100)) : 0)
export const overTarget = (value, target) => target > 0 && value > target

// Millilitres as litres in the UI language: 1250 reads "1.25" or "1,25", not a rounded "1.3".
export const fmtLiters = ml => new Intl.NumberFormat(dateLocale(), { maximumFractionDigits: 2 }).format(ml / 1000)

export const exportNutrition = N => JSON.stringify(N, null, 2)

// Text from a backup file back into a state. Throws when it is not a JSON object, so the caller
// can say so instead of wiping the data with an empty one.
export function importNutrition(text) {
  const raw = JSON.parse(text)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('not a nutrition backup')
  return normalizeNutrition(raw)
}
