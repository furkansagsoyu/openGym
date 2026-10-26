import { create } from 'zustand'
import { NUTRITION_KEY, emptyNutrition, normalizeNutrition } from '../lib/nutrition.js'

// The nutrition counter's data, on this device only (lib/nutrition.js says why it is not in the
// synced profile). A damaged or missing value reads as an empty counter.
const read = () => {
  try {
    const raw = localStorage.getItem(NUTRITION_KEY)
    return raw ? normalizeNutrition(JSON.parse(raw)) : emptyNutrition()
  } catch { return emptyNutrition() }
}
const write = N => { try { localStorage.setItem(NUTRITION_KEY, JSON.stringify(N)) } catch { /* storage full or blocked: the screen still works for this visit */ } }

export const useNutrition = create(set => ({
  N: read(),
  // `fn` gets the current data and returns the next one, as the helpers in lib/nutrition.js do.
  // A helper that returns its input unchanged writes nothing.
  update: fn => set(s => {
    const N = fn(s.N)
    if (N === s.N) return s
    write(N)
    return { N }
  }),
  // A restored backup replaces everything.
  replace: next => set(() => {
    const N = normalizeNutrition(next)
    write(N)
    return { N }
  }),
}))
