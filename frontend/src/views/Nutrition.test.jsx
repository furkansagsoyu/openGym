// @vitest-environment happy-dom
/* The nutrition counter, used the way a person uses it: add a food, tap a saved one, add water,
 * delete a mistake, look at another day. The numbers themselves are covered in lib/nutrition.test.js.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: vi.fn(() => Promise.reject(new Error('offline'))), beacon: vi.fn() }))

import { useNutrition } from '../store/useNutrition.js'
import { useUI } from '../store/useUI.js'
import { dayOf, dayTotals, emptyNutrition } from '../lib/nutrition.js'
import { todayISO } from '../lib/format.js'
import Nutrition, { addFoodSheet } from './Nutrition.jsx'

const mounted = []
function render(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<MemoryRouter>{el}</MemoryRouter>))
  return host
}
const topSheet = () => { const s = useUI.getState().sheets.at(-1); return s ? render(s.render(() => useUI.getState().closeSheet(s.id))) : null }
const setValue = (input, v) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const click = (host, text) => act(() => { [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text).click() })
const today = () => dayTotals(dayOf(useNutrition.getState().N, todayISO()))

function seed(patch = {}) { useNutrition.setState({ N: { ...emptyNutrition(), ...patch } }) }

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear()
  useUI.setState({ sheets: [], toastMsg: '' })
  document.body.innerHTML = ''
  seed()
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }) })

describe('the nutrition counter', () => {
  it('starts empty, and a food typed into the sheet lands on today', () => {
    const screen = render(<Nutrition />)
    expect(screen.textContent).toContain('Nothing logged yet.')
    act(() => addFoodSheet())
    const form = topSheet()
    const [kcal, protein] = form.querySelectorAll('input.num')
    setValue(form.querySelector('input.field'), 'Lentil soup')
    setValue(kcal, '180')
    setValue(protein, '11')
    click(form, 'Add')
    expect(today()).toMatchObject({ kcal: 180, protein: 11, count: 1 })
    expect(screen.textContent).toContain('Lentil soup')
    expect(screen.textContent).not.toContain('Nothing logged yet.')
  })

  it('refuses an empty food and says so', () => {
    render(<Nutrition />)
    act(() => addFoodSheet())
    const form = topSheet()
    click(form, 'Add')
    expect(today().count).toBe(0)
    expect(useUI.getState().toastMsg).toBe('Enter calories or protein')
  })

  it('"Save for quick add" keeps the food as a chip that adds it again with one tap', () => {
    const screen = render(<Nutrition />)
    act(() => addFoodSheet())
    const form = topSheet()
    const [kcal, protein] = form.querySelectorAll('input.num')
    setValue(form.querySelector('input.field'), 'Egg')
    setValue(kcal, '78')
    setValue(protein, '6')
    act(() => form.querySelector('[role="switch"]').click())
    click(form, 'Add')
    expect(useNutrition.getState().N.foods.map(f => f.name)).toEqual(['Egg'])
    act(() => screen.querySelector('.nut-chip').click())
    expect(today()).toMatchObject({ kcal: 156, protein: 12, count: 2 })
  })

  it('adds water in steps and takes a step back', () => {
    const screen = render(<Nutrition />)
    click(screen, '+500 ml')
    click(screen, '+250 ml')
    expect(today().water).toBe(750)
    click(screen, '-250 ml')
    expect(today().water).toBe(500)
  })

  it('deletes a mistaken entry', () => {
    seed({ days: { [todayISO()]: { entries: [{ id: 'a', name: 'Cake', kcal: 400, protein: 4 }], water: 0 } } })
    const screen = render(<Nutrition />)
    expect(screen.textContent).toContain('Cake')
    act(() => screen.querySelector('.nut-entry button').click())
    expect(today().count).toBe(0)
    expect(screen.textContent).not.toContain('Cake')
  })

  it('steps back a day to log something forgotten, and cannot go past today', () => {
    const screen = render(<Nutrition />)
    expect(screen.querySelector('[aria-label="Next day"]').disabled).toBe(true)
    act(() => screen.querySelector('[aria-label="Previous day"]').click())
    expect(screen.querySelector('[aria-label="Next day"]').disabled).toBe(false)
    expect(screen.textContent).not.toContain('Today')
    click(screen, '+250 ml')
    expect(today().water).toBe(0)   // it went to yesterday
  })
})
