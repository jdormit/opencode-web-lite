export const strings = {
  productName: 'OpenCode Web Lite',
  navigation: {
    home: 'Home',
    newSession: 'New session',
    settings: 'Settings',
  },
  home: {
    eyebrow: 'Fast, focused, connected',
    title: 'Your OpenCode work, without the weight.',
    description:
      'Connect to an OpenCode server to continue recent sessions or start something new.',
    connectionPending: 'Connection setup is the next implementation step.',
    connection: {
      connected: 'Connected',
      'authentication-failed': 'Authentication failed',
      incompatible: 'Incompatible server',
      'invalid-configuration': 'Invalid server configuration',
      unavailable: 'Server unavailable',
    },
    connectionDescription: {
      connected: 'The OpenCode server is ready.',
      'authentication-failed': 'Update the configured username or password, then retry.',
      incompatible: 'This address does not provide the supported OpenCode v1 API.',
      'invalid-configuration': 'Set OPENCODE_SERVER_URL to a plain HTTP or HTTPS origin.',
      unavailable: 'Check that OpenCode is running and this server address is correct.',
    },
  },
  newSession: {
    eyebrow: 'New session',
    title: 'What are you working on?',
    description: 'Project, model, and agent selection will appear here.',
  },
  settings: {
    eyebrow: 'Settings',
    title: 'Shape the workspace.',
    description: 'Server connections and preferences will appear here.',
  },
  session: {
    eyebrow: 'Session',
    loadingTitle: 'Preparing this session',
    description: 'Messages and live status will load here.',
  },
  errors: {
    title: 'This view could not be loaded.',
    description: 'Your work is unchanged. Reload this page or return home.',
    notFoundTitle: 'This page is not here.',
    notFoundDescription: 'The address may be incomplete or no longer valid.',
    reload: 'Reload page',
    returnHome: 'Return home',
    copyDetails: 'Copy details',
  },
  theme: {
    label: 'Color scheme',
    system: 'System',
    light: 'Light',
    dark: 'Dark',
  },
} as const
