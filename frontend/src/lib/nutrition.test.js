import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TARGETS, addDays, addEntry, addWater, averageLogged, barPct, dayOf, dayTotals, emptyNutrition,
  exportNutrition, fmtLiters, importNutrition, normalizeNutrition, overTarget, recentDays, removeEntry,
  removeFood, saveFood, setTargets,
} from './nutrition.js'

const D = '2026-10-26'

describe('normalizeNutrition', () => {
  it('turns nothing, junk and the wrong type into an empty counter with the default targets', () => {
    for (const raw of [null, undefined, 'x', 5, [], {}]) {
      expect(normalizeNutrition(raw)).toEqual({ v: 1, targets: DEFAULT_TARGETS, foods: [], days: {} })
    }
  })

  it('keeps good data, clamps numbers and drops what cannot be read', () => {
    const N = normalizeNutrition({
      targets: { kcal: 99999, protein: 'abc', water: 3000 },
      foods: [
        { id: 'a', name: '  Egg ', kcal: 78, protein: 6.26 },
        { id: 'b', name: 'egg', kcal: 1, protein: 1 },      // same name, any case
        { id: 'c', name: '', kcal: 10 },                      // no name
        { id: 'd', name: 'Bad', kcal: 'many' },               // no calories
        null,
      ],
      days: {
        [D]: { entries: [{ id: 'x', name: 'Rice', kcal: 200, protein: 4 }, { kcal: -5 }, 'junk'], water: 1250.4 },
        'not-a-date': { entries: [{ kcal: 1 }], water: 1 },
        '2026-10-25': { entries: [], water: 0 },             // nothing in it
      },
    })
    expect(N.targets).toEqual({ kcal: 6000, protein: DEFAULT_TARGETS.protein, water: 3000 })
    expect(N.foods).toEqual([{ id: 'a', name: 'Egg', kcal: 78, protein: 6.3 }])
    expect(Object.keys(N.days)).toEqual([D])
    expect(N.days[D].water).toBe(1250)
    // the negative calorie value is clamped to 0, which is still a readable entry
    expect(N.days[D].entries.map(e => e.name)).toEqual(['Rice', ''])
  })

  it('survives a round trip through JSON', () => {
    let N = emptyNutrition()
    N = addEntry(N, D, { name: 'Yogurt', kcal: 120, protein: 10 }, 'e1')
    N = addWater(N, D, 500)
    N = saveFood(N, { name: 'Yogurt', kcal: 120, protein: 10 }, 'f1')
    expect(normalizeNutrition(JSON.parse(JSON.stringify(N)))).toEqual(N)
  })
})

describe('entries', () => {
  it('adds up calories and protein for the day', () => {
    let N = emptyNutrition()
    N = addEntry(N, D, { name: 'Eggs', kcal: 156, protein: 12.5 }, 'a')
    N = addEntry(N, D, { name: 'Ayran', kcal: 60, protein: 3.2 }, 'b')
    expect(dayTotals(dayOf(N, D))).toEqual({ kcal: 216, protein: 15.7, water: 0, count: 2 })
  })

  it('does not change the old state', () => {
    const N = emptyNutrition()
    const next = addEntry(N, D, { name: 'x', kcal: 10 }, 'a')
    expect(N.days).toEqual({})
    expect(next).not.toBe(N)
  })

  it('refuses an empty or unreadable entry and returns the same object', () => {
    const N = emptyNutrition()
    expect(addEntry(N, D, { name: 'x', kcal: 0, protein: 0 })).toBe(N)
    expect(addEntry(N, D, { name: 'x', kcal: 'abc' })).toBe(N)
    expect(addEntry(N, 'yesterday', { name: 'x', kcal: 100 })).toBe(N)
  })

  it('accepts protein without calories and a name that is empty', () => {
    const N = addEntry(emptyNutrition(), D, { name: '  ', kcal: 0, protein: 25 }, 'a')
    expect(N.days[D].entries).toEqual([{ id: 'a', name: '', kcal: 0, protein: 25 }])
  })

  it('removes an entry and drops the day once nothing is left', () => {
    let N = addEntry(emptyNutrition(), D, { name: 'x', kcal: 100 }, 'a')
    N = addEntry(N, D, { name: 'y', kcal: 50 }, 'b')
    N = removeEntry(N, D, 'a')
    expect(N.days[D].entries.map(e => e.id)).toEqual(['b'])
    N = removeEntry(N, D, 'b')
    expect(N.days).toEqual({})
  })
})

describe('water', () => {
  it('adds and takes back, never below zero or above the cap', () => {
    let N = addWater(emptyNutrition(), D, 250)
    N = addWater(N, D, 500)
    expect(dayOf(N, D).water).toBe(750)
    N = addWater(N, D, -1000)
    expect(N.days[D]).toBeUndefined()   // back to nothing: the day leaves the file
    N = addWater(N, D, 99999)
    expect(dayOf(N, D).water).toBe(20000)
  })

  it('ignores a bad amount or date', () => {
    const N = emptyNutrition()
    expect(addWater(N, D, NaN)).toBe(N)
    expect(addWater(N, 'x', 250)).toBe(N)
  })

  it('keeps water and food of one day together', () => {
    let N = addWater(emptyNutrition(), D, 250)
    N = addEntry(N, D, { name: 'x', kcal: 100 }, 'a')
    N = removeEntry(N, D, 'a')
    expect(dayOf(N, D).water).toBe(250)
  })
})

describe('saved foods and targets', () => {
  it('saves a food once per name and updates it in place', () => {
    let N = saveFood(emptyNutrition(), { name: 'Egg', kcal: 78, protein: 6 }, 'a')
    N = saveFood(N, { name: 'EGG', kcal: 80, protein: 6.5 }, 'b')
    expect(N.foods).toEqual([{ id: 'a', name: 'EGG', kcal: 80, protein: 6.5 }])
  })

  it('refuses a food without a name or calories, and removes by id', () => {
    const N = emptyNutrition()
    expect(saveFood(N, { name: '', kcal: 10 })).toBe(N)
    expect(saveFood(N, { name: 'x' })).toBe(N)
    const one = saveFood(N, { name: 'x', kcal: 10 }, 'a')
    expect(removeFood(one, 'a').foods).toEqual([])
  })

  it('changes the targets that are usable and keeps the rest', () => {
    const N = setTargets(emptyNutrition(), { kcal: 2100, protein: '', water: 'lots' })
    expect(N.targets).toEqual({ kcal: 2100, protein: DEFAULT_TARGETS.protein, water: DEFAULT_TARGETS.water })
    expect(setTargets(N, { kcal: 10 }).targets.kcal).toBe(800)
  })
})

describe('the week', () => {
  it('addDays crosses months and years', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('addDays is not thrown off by a clock change', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
  })

  it('lists the last days oldest first, empty days included', () => {
    let N = addEntry(emptyNutrition(), '2026-10-24', { name: 'x', kcal: 500, protein: 30 }, 'a')
    N = addEntry(N, D, { name: 'y', kcal: 700, protein: 40 }, 'b')
    const rows = recentDays(N, D, 4)
    expect(rows.map(r => r.d)).toEqual(['2026-10-23', '2026-10-24', '2026-10-25', D])
    expect(rows.map(r => r.kcal)).toEqual([0, 500, 0, 700])
  })

  it('averages only the days with food logged', () => {
    let N = addEntry(emptyNutrition(), '2026-10-24', { name: 'x', kcal: 2000, protein: 100 }, 'a')
    N = addEntry(N, D, { name: 'y', kcal: 2400, protein: 131 }, 'b')
    expect(averageLogged(recentDays(N, D, 7))).toEqual({ days: 2, kcal: 2200, protein: 115.5 })
    expect(averageLogged(recentDays(emptyNutrition(), D, 7))).toBeNull()
    // a day with only water is not a day of eating
    expect(averageLogged(recentDays(addWater(emptyNutrition(), D, 500), D, 7))).toBeNull()
  })
})

describe('bars and units', () => {
  it('fills a bar up to 100 and flags going past the target', () => {
    expect(barPct(1150, 2300)).toBe(50)
    expect(barPct(5000, 2300)).toBe(100)
    expect(barPct(-5, 2300)).toBe(0)
    expect(barPct(10, 0)).toBe(0)
    expect(overTarget(2301, 2300)).toBe(true)
    expect(overTarget(2300, 2300)).toBe(false)
    expect(overTarget(5, 0)).toBe(false)
  })

  it('writes litres with two decimals when it needs them', () => {
    expect(fmtLiters(1250)).toBe('1.25')
    expect(fmtLiters(2000)).toBe('2')
    expect(fmtLiters(0)).toBe('0')
  })
})

describe('backup', () => {
  it('exports and imports the same data', () => {
    let N = addEntry(emptyNutrition(), D, { name: 'Lentil soup', kcal: 180, protein: 11 }, 'a')
    N = saveFood(setTargets(N, { kcal: 2200 }), { name: 'Egg', kcal: 78, protein: 6 }, 'f')
    expect(importNutrition(exportNutrition(N))).toEqual(N)
  })

  it('throws on text that is not a backup, so nothing gets wiped', () => {
    expect(() => importNutrition('not json')).toThrow()
    expect(() => importNutrition('[]')).toThrow()
    expect(() => importNutrition('null')).toThrow()
  })

  it('cleans an imported file instead of trusting it', () => {
    const N = importNutrition(JSON.stringify({ targets: { kcal: -1 }, days: { [D]: { entries: [{ name: 'x'.repeat(200), kcal: 5 }] } } }))
    expect(N.targets.kcal).toBe(800)
    expect(N.days[D].entries[0].name).toHaveLength(60)
  })
})
