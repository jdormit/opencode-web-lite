export type McpEntry = { name: string; status: 'connected' | 'disabled' | 'failed' | 'needs_auth' | 'needs_client_registration'; error?: string }
export type LspEntry = { id: string; name: string; root: string; status: 'connected' | 'error' }
export type WorkspaceStatus = { mcp: McpEntry[]; lsp: LspEntry[]; plugins: string[]; mcpError?: string; lspError?: string; pluginError?: string }
