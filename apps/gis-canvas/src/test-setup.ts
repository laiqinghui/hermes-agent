// Registers jest-dom matchers (toBeInTheDocument, toHaveTextContent, ...) with vitest.
import '@testing-library/jest-dom/vitest'

// Radix primitives (tabs roving-focus, scroll-area) use DOM APIs jsdom lacks.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
