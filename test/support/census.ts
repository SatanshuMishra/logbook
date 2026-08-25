export type Classified<T> = { item: T; verdict: 'allowed' | 'forbidden' }

const describeItem = (item: unknown): string => {
  try {
    return JSON.stringify(item)
  } catch {
    return String(item)
  }
}

export const census = <T>(
  items: T[],
  classify: (item: T) => Classified<T>['verdict'] | 'unclassifiable'
): void => {
  for (const item of items) {
    const verdict = classify(item)
    if (verdict === 'unclassifiable') {
      throw new Error(`census halted on an unclassifiable item: ${describeItem(item)}`)
    }
    if (verdict === 'forbidden') {
      throw new Error(`census rejected a forbidden item: ${describeItem(item)}`)
    }
  }
}
