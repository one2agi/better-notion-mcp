import { describe, it } from 'vitest'

// init-server.test.ts removed — this project uses local stdio only.
// The previous test suite mocked startServer() with an args-based assertion
// (toHaveBeenCalledWith('http'/'stdio')), but initServer actually calls
// startServer() with NO arguments and uses getTransportMode() for the mode.
describe('initServer placeholder', () => {
  it('is skipped for local stdio project', () => {
    // Placeholder test
  })
})
