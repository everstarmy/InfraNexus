import { describe, expect, it } from "vitest"
import { generatePassword, meetsPolicy, scorePassword } from "./password"

describe("password policy mirrors the backend rule (>= 8 chars and 3 of 4 classes)", () => {
  it("rejects short or low-variety passwords", () => {
    for (const pw of ["", "Ab1!", "abcdefgh", "abcdefg1", "ABCDEFGH1", "admin123456"]) {
      expect(meetsPolicy(pw), pw).toBe(false)
    }
  })

  it("accepts compliant passwords, counting code points like the server", () => {
    for (const pw of ["Abcdefg1", "abcdef1!", "Str0ng!pass", "密码Abc12345"]) {
      expect(meetsPolicy(pw), pw).toBe(true)
    }
  })

  it("scores longer and more varied passwords higher", () => {
    expect(scorePassword("").score).toBe(0)
    expect(scorePassword("abcdefg1").score).toBe(1)
    expect(scorePassword("Abcdefg1").score).toBe(2)
    expect(scorePassword("Abcdefgh1234").score).toBe(3)
    expect(scorePassword("Abcdefgh123!").score).toBe(4)
  })

  it("generates passwords that always satisfy the policy", () => {
    for (let i = 0; i < 100; i++) {
      const pw = generatePassword()
      expect(pw).toHaveLength(16)
      expect(meetsPolicy(pw)).toBe(true)
    }
  })
})
