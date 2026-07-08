// init-server.test.ts removed — this project uses local stdio only.
// The previous test suite mocked startServer() with an args-based assertion
// (toHaveBeenCalledWith('http'/'stdio')), but initServer actually calls
// startServer() with NO arguments and uses getTransportMode() for the mode.
// The mock pattern was wrong, and the project doesn't ship a remote deploy.
// Re-add if/when remote deploy is reintroduced, with the correct mock pattern:
//   const getTransportModeMock = vi.mocked(getTransportMode)
//   expect(getTransportModeMock).toHaveBeenCalled()
export {}