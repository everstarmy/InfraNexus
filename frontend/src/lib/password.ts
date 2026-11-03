export interface PasswordChecks {
  length: boolean
  upper: boolean
  lower: boolean
  digit: boolean
  symbol: boolean
}

export interface PasswordScore {
  score: 0 | 1 | 2 | 3 | 4
  label: string
  checks: PasswordChecks
  valid: boolean
}

const MIN_LENGTH = 8
const LABELS = ["", "弱", "中", "良好", "强"] as const

function classify(password: string) {
  const checks: PasswordChecks = { length: [...password].length >= MIN_LENGTH, upper: false, lower: false, digit: false, symbol: false }
  for (const ch of password) {
    if (/\p{Lu}/u.test(ch)) checks.upper = true
    else if (/\p{Ll}/u.test(ch)) checks.lower = true
    else if (/\p{Nd}/u.test(ch)) checks.digit = true
    else if (/[\p{P}\p{S}]/u.test(ch)) checks.symbol = true
  }
  const classes = [checks.upper, checks.lower, checks.digit, checks.symbol].filter(Boolean).length
  return { checks, classes }
}

export function meetsPolicy(password: string) {
  const { checks, classes } = classify(password)
  return checks.length && classes >= 3
}

export function scorePassword(password: string): PasswordScore {
  const { checks, classes } = classify(password)
  const valid = checks.length && classes >= 3
  let score: PasswordScore["score"] = 0
  if (password) score = 1
  if (valid) score = 2
  if (valid && [...password].length >= 12) score = 3
  if (score === 3 && classes === 4) score = 4
  return { score, label: LABELS[score], checks, valid }
}

const POOLS = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%^&*-_=+?"]

function randomIndex(max: number) {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return buf[0] % max
}

export function generatePassword(length = 16) {
  const all = POOLS.join("")
  const chars = POOLS.map((pool) => pool[randomIndex(pool.length)])
  while (chars.length < length) chars.push(all[randomIndex(all.length)])
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join("")
}
