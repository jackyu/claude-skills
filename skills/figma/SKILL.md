---
name: figma
description: Integrate with Figma API for design automation and code generation. Use when extracting design tokens, generating React/CSS code from Figma components, syncing design systems, building Figma plugins, or automating design-to-code workflows. Triggers on Figma API, design tokens, Figma plugin, design-to-code, Figma export, Figma component, Dev Mode.
---

# Figma API Integration

Extract design data, generate code from components, and automate design workflows with Figma's API.

## Workflow

1. **Authenticate** with a Figma personal access token (see Quick Start below).
2. **Locate the file and node** — parse the file key and node id out of the Figma URL (Quick Start below).
3. **Pick the task** and jump to the matching reference — each one has working, runnable code:
   - Generate React components or Tailwind classes from Figma nodes, or export every component + run the full design-to-code pipeline → `references/code-generation.md`
   - Extract color/typography tokens, generate CSS variables or a Tailwind config, or read the Variables API (Design Tokens 2.0) → `references/design-tokens.md`
   - Pull Dev Mode resources or set up/handle a Figma webhook (file update, library publish, comment) → `references/webhooks.md`
   - Scaffold a Figma plugin (manifest + code.ts + UI messaging) → `references/plugin-development.md`

## Quick Start

### Authentication
```typescript
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;

const headers = {
  'X-Figma-Token': FIGMA_TOKEN
};

// Get file
const response = await fetch(
  `https://api.figma.com/v1/files/${FILE_KEY}`,
  { headers }
);
```

### File Key & Node IDs
```typescript
// Extract from Figma URL: figma.com/file/FILE_KEY/Name?node-id=NODE_ID
const figmaUrl = 'https://www.figma.com/file/abc123/MyDesign?node-id=1%3A2';
const fileKey = figmaUrl.match(/file\/([^/]+)/)?.[1];  // abc123
const nodeId = new URL(figmaUrl).searchParams.get('node-id');  // 1:2
```

## Core API Endpoints

### Get File
```typescript
// Full file
GET https://api.figma.com/v1/files/:file_key

// Specific nodes (components)
GET https://api.figma.com/v1/files/:file_key/nodes?ids=1:2,1:3

// With geometry for SVG paths
GET https://api.figma.com/v1/files/:file_key?geometry=paths

// With plugin data
GET https://api.figma.com/v1/files/:file_key?plugin_data=shared
```

### Get Components
```typescript
// Get all components in a file
GET https://api.figma.com/v1/files/:file_key/components

// Get component sets (variants)
GET https://api.figma.com/v1/files/:file_key/component_sets

// Get team's published components
GET https://api.figma.com/v1/teams/:team_id/components
```

### Export Images
```typescript
// Export nodes as images
GET https://api.figma.com/v1/images/:file_key?ids=1:2,1:3&format=png&scale=2

// Export as SVG
GET https://api.figma.com/v1/images/:file_key?ids=1:2&format=svg

// Response
{
  "images": {
    "1:2": "https://s3.amazonaws.com/...",
    "1:3": "https://s3.amazonaws.com/..."
  }
}
```

## References

- `references/code-generation.md` — Figma node → React component, Figma node → Tailwind CSS classes, extracting all components from a file, and the complete design-to-code pipeline
- `references/design-tokens.md` — color and typography token extraction, CSS variable and Tailwind config generation, Variables API (Design Tokens 2.0)
- `references/webhooks.md` — Dev Mode code snippets/resources, webhook setup and handler
- `references/plugin-development.md` — plugin manifest.json and code.ts scaffold

## Resources

- **Figma API Docs**: https://www.figma.com/developers/api
- **Figma REST API Reference**: https://www.figma.com/developers/api#intro
- **Plugin API Docs**: https://www.figma.com/plugin-docs/
- **Variables API**: https://www.figma.com/developers/api#variables
- **Dev Mode**: https://www.figma.com/dev-mode/
- **Figma Community Plugins**: https://www.figma.com/community/plugins
