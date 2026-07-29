# Design Tokens

Extracting colors and typography from a Figma file, generating CSS variables / Tailwind config, and the Variables API (Design Tokens 2.0).

## Design Token Extraction

### Extract Colors
```typescript
async function extractColors(fileKey: string) {
  const file = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/styles`,
    { headers }
  ).then(r => r.json());
  
  const colors = {};
  
  for (const style of file.meta.styles) {
    if (style.style_type === 'FILL') {
      const nodeData = await getStyleNode(fileKey, style.node_id);
      const fill = nodeData.fills[0];
      
      if (fill.type === 'SOLID') {
        colors[style.name] = rgbaToHex(fill.color);
      }
    }
  }
  
  return colors;
}

function rgbaToHex({ r, g, b, a = 1 }) {
  const toHex = (n) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 1 ? toHex(a) : ''}`;
}
```

### Extract Typography Tokens
```typescript
async function extractTypography(fileKey: string) {
  const response = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/styles`,
    { headers: { 'X-Figma-Token': process.env.FIGMA_TOKEN! } }
  );
  const data = await response.json();
  
  const typography: Record<string, any> = {};
  
  for (const style of data.meta.styles) {
    if (style.style_type === 'TEXT') {
      const nodeResponse = await fetch(
        `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${style.node_id}`,
        { headers: { 'X-Figma-Token': process.env.FIGMA_TOKEN! } }
      );
      const nodeData = await nodeResponse.json();
      const node = nodeData.nodes[style.node_id].document;
      
      typography[style.name] = {
        fontFamily: node.style?.fontFamily,
        fontWeight: node.style?.fontWeight,
        fontSize: node.style?.fontSize,
        lineHeight: node.style?.lineHeightPx,
        letterSpacing: node.style?.letterSpacing,
      };
    }
  }
  
  return typography;
}
```

### Generate Complete Design Tokens
```typescript
interface DesignTokens {
  colors: Record<string, string>;
  typography: Record<string, any>;
  spacing: Record<string, number>;
  shadows: Record<string, string>;
  radii: Record<string, number>;
}

async function generateDesignTokens(fileKey: string): Promise<DesignTokens> {
  const [colors, typography] = await Promise.all([
    extractColors(fileKey),
    extractTypography(fileKey),
  ]);
  
  return {
    colors,
    typography,
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },  // Extract from file
    shadows: {},  // Extract from effect styles
    radii: {},    // Extract from nodes
  };
}

// Generate CSS Variables
function tokensToCSSVariables(tokens: DesignTokens): string {
  let css = ':root {\n';
  
  // Colors
  for (const [name, value] of Object.entries(tokens.colors)) {
    const cssName = name.toLowerCase().replace(/[\s/]+/g, '-');
    css += `  --color-${cssName}: ${value};\n`;
  }
  
  // Typography
  for (const [name, style] of Object.entries(tokens.typography)) {
    const cssName = name.toLowerCase().replace(/[\s/]+/g, '-');
    css += `  --font-${cssName}-family: "${style.fontFamily}";\n`;
    css += `  --font-${cssName}-size: ${style.fontSize}px;\n`;
    css += `  --font-${cssName}-weight: ${style.fontWeight};\n`;
    css += `  --font-${cssName}-line-height: ${style.lineHeight}px;\n`;
  }
  
  css += '}\n';
  return css;
}

// Generate Tailwind Config
function tokensToTailwindConfig(tokens: DesignTokens): string {
  const colors: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens.colors)) {
    const key = name.toLowerCase().replace(/[\s/]+/g, '-');
    colors[key] = value;
  }
  
  return `
module.exports = {
  theme: {
    extend: {
      colors: ${JSON.stringify(colors, null, 6)},
      fontFamily: {
        ${Object.entries(tokens.typography).map(([name, style]) => 
          `'${name.toLowerCase()}': ['${style.fontFamily}', 'sans-serif']`
        ).join(',\n        ')}
      },
    },
  },
};
`;
}
```

## Variables API (Design Tokens 2.0)

```typescript
// Get variables (requires enterprise/organization plan)
GET https://api.figma.com/v1/files/:file_key/variables/local

// Get variable collections
GET https://api.figma.com/v1/files/:file_key/variables/local/collections

// Response structure
interface VariableCollection {
  id: string;
  name: string;
  modes: { modeId: string; name: string }[];
  variableIds: string[];
}

interface Variable {
  id: string;
  name: string;
  resolvedType: 'BOOLEAN' | 'FLOAT' | 'STRING' | 'COLOR';
  valuesByMode: Record<string, any>;
}

async function getVariables(fileKey: string) {
  const response = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/variables/local`,
    { headers: { 'X-Figma-Token': process.env.FIGMA_TOKEN! } }
  );
  return response.json();
}
```
