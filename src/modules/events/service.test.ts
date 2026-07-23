import { describe, it, expect } from 'vitest'
import { matchesPattern } from './service.js'

describe('matchesPattern', () => {
  // Wildcard total: "*" casa com qualquer coisa
  it('* matches everything', () => {
    expect(matchesPattern('payment.approved', '*')).toBe(true)
    expect(matchesPattern('order.created', '*')).toBe(true)
    expect(matchesPattern('x', '*')).toBe(true)
  })

  // Match exato
  it('exact match', () => {
    expect(matchesPattern('payment.approved', 'payment.approved')).toBe(true)
  })

  // Wildcard parcial: "payment.*" casa com qualquer sub-tipo de payment
  it('partial wildcard payment.*', () => {
    expect(matchesPattern('payment.approved', 'payment.*')).toBe(true)
    expect(matchesPattern('payment.failed', 'payment.*')).toBe(true)
  })

  // NÃO casa: domínio diferente
  it('does not match different domain', () => {
    expect(matchesPattern('order.created', 'payment.*')).toBe(false)
  })

  // NÃO casa: profundidade diferente (2 segmentos vs 3)
  it('does not match different depth', () => {
    expect(matchesPattern('payment.card.approved', 'payment.*')).toBe(false)
  })

  // NÃO casa: pattern mais específico que o type
  it('does not match when pattern is more specific', () => {
    expect(matchesPattern('payment', 'payment.approved')).toBe(false)
  })
})