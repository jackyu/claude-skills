# Code Generation

Turning Figma nodes into React components, Tailwind classes, and a full component-export pipeline.

## Component Code Generation

### Figma Node to React Component
```typescript
interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: Fill[];
  strokes?: Stroke[];
  effects?: Effect[];
  cornerRadius?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  characters?: string;
  style?: TextStyle;
}

async function getComponentCode(fileKey: string, nodeId: string): Promise<string> {
  const response = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}`,
    { headers: { 'X-Figma-Token': process.env.FIGMA_TOKEN! } }
  );
  const data = await response.json();
  const node = data.nodes[nodeId].document;
  
  return generateReactComponent(node);
}

function generateReactComponent(node: FigmaNode): string {
  const componentName = toPascalCase(node.name);
  const styles = extractStyles(node);
  const children = node.children?.map(child => generateJSX(child)).join('\n') || '';
  
  return `
import React from 'react';

export function ${componentName}() {
  return (
    <div style={${JSON.stringify(styles, null, 2)}}>
      ${children}
    </div>
  );
}
`;
}

function extractStyles(node: FigmaNode): React.CSSProperties {
  const styles: React.CSSProperties = {};
  
  // Dimensions
  if (node.absoluteBoundingBox) {
    styles.width = node.absoluteBoundingBox.width;
    styles.height = node.absoluteBoundingBox.height;
  }
  
  // Background
  if (node.fills?.length) {
    const fill = node.fills.find(f => f.visible !== false && f.type === 'SOLID');
    if (fill?.color) {
      styles.backgroundColor = rgbaToHex(fill.color);
    }
  }
  
  // Border radius
  if (node.cornerRadius) {
    styles.borderRadius = node.cornerRadius;
  }
  
  // Padding
  if (node.paddingLeft) styles.paddingLeft = node.paddingLeft;
  if (node.paddingRight) styles.paddingRight = node.paddingRight;
  if (node.paddingTop) styles.paddingTop = node.paddingTop;
  if (node.paddingBottom) styles.paddingBottom = node.paddingBottom;
  
  // Flexbox (Auto Layout)
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    styles.display = 'flex';
    styles.flexDirection = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
    styles.gap = node.itemSpacing;
    
    // Alignment
    const alignMap: Record<string, string> = {
      'MIN': 'flex-start',
      'CENTER': 'center',
      'MAX': 'flex-end',
      'SPACE_BETWEEN': 'space-between',
    };
    if (node.primaryAxisAlignItems) {
      styles.justifyContent = alignMap[node.primaryAxisAlignItems] || 'flex-start';
    }
    if (node.counterAxisAlignItems) {
      styles.alignItems = alignMap[node.counterAxisAlignItems] || 'flex-start';
    }
  }
  
  return styles;
}

function generateJSX(node: FigmaNode): string {
  const styles = extractStyles(node);
  
  if (node.type === 'TEXT') {
    return `<span style={${JSON.stringify(styles)}}>${node.characters || ''}</span>`;
  }
  
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') {
    return `{/* Vector: ${node.name} - export as SVG */}`;
  }
  
  const children = node.children?.map(child => generateJSX(child)).join('\n') || '';
  return `<div style={${JSON.stringify(styles)}}>${children}</div>`;
}
```

### Generate Tailwind CSS from Figma
```typescript
function figmaToTailwind(node: FigmaNode): string {
  const classes: string[] = [];
  
  // Dimensions
  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    classes.push(`w-[${Math.round(width)}px]`, `h-[${Math.round(height)}px]`);
  }
  
  // Background color
  if (node.fills?.length) {
    const fill = node.fills.find(f => f.visible !== false && f.type === 'SOLID');
    if (fill?.color) {
      const hex = rgbaToHex(fill.color);
      classes.push(`bg-[${hex}]`);
    }
  }
  
  // Border radius
  if (node.cornerRadius) {
    const radiusMap: Record<number, string> = {
      4: 'rounded-sm', 6: 'rounded-md', 8: 'rounded-lg',
      12: 'rounded-xl', 16: 'rounded-2xl', 9999: 'rounded-full'
    };
    classes.push(radiusMap[node.cornerRadius] || `rounded-[${node.cornerRadius}px]`);
  }
  
  // Padding
  if (node.paddingLeft === node.paddingRight && 
      node.paddingTop === node.paddingBottom &&
      node.paddingLeft === node.paddingTop) {
    classes.push(`p-[${node.paddingLeft}px]`);
  } else {
    if (node.paddingLeft) classes.push(`pl-[${node.paddingLeft}px]`);
    if (node.paddingRight) classes.push(`pr-[${node.paddingRight}px]`);
    if (node.paddingTop) classes.push(`pt-[${node.paddingTop}px]`);
    if (node.paddingBottom) classes.push(`pb-[${node.paddingBottom}px]`);
  }
  
  // Flexbox
  if (node.layoutMode && node.layoutMode !== 'NONE') {
    classes.push('flex');
    classes.push(node.layoutMode === 'HORIZONTAL' ? 'flex-row' : 'flex-col');
    if (node.itemSpacing) classes.push(`gap-[${node.itemSpacing}px]`);
    
    const justifyMap: Record<string, string> = {
      'MIN': 'justify-start', 'CENTER': 'justify-center',
      'MAX': 'justify-end', 'SPACE_BETWEEN': 'justify-between'
    };
    const alignMap: Record<string, string> = {
      'MIN': 'items-start', 'CENTER': 'items-center', 'MAX': 'items-end'
    };
    if (node.primaryAxisAlignItems) classes.push(justifyMap[node.primaryAxisAlignItems]);
    if (node.counterAxisAlignItems) classes.push(alignMap[node.counterAxisAlignItems]);
  }
  
  return classes.join(' ');
}
```

### Extract All Components from File
```typescript
interface ComponentInfo {
  key: string;
  name: string;
  description: string;
  nodeId: string;
  thumbnailUrl?: string;
}

async function getAllComponents(fileKey: string): Promise<ComponentInfo[]> {
  const response = await fetch(
    `https://api.figma.com/v1/files/${fileKey}/components`,
    { headers: { 'X-Figma-Token': process.env.FIGMA_TOKEN! } }
  );
  const data = await response.json();
  
  return data.meta.components.map((comp: any) => ({
    key: comp.key,
    name: comp.name,
    description: comp.description || '',
    nodeId: comp.node_id,
    thumbnailUrl: comp.thumbnail_url,
  }));
}

// Generate code for all components
async function generateAllComponentsCode(fileKey: string): Promise<Map<string, string>> {
  const components = await getAllComponents(fileKey);
  const codeMap = new Map<string, string>();
  
  for (const comp of components) {
    const code = await getComponentCode(fileKey, comp.nodeId);
    codeMap.set(comp.name, code);
  }
  
  return codeMap;
}
```

## Complete Design-to-Code Pipeline

```typescript
// Full pipeline: Figma file → React components + tokens
async function figmaToCode(fileKey: string, outputDir: string) {
  // 1. Get all components
  const components = await getAllComponents(fileKey);
  
  // 2. Generate design tokens
  const tokens = await generateDesignTokens(fileKey);
  await fs.writeFile(
    `${outputDir}/tokens.css`,
    tokensToCSSVariables(tokens)
  );
  await fs.writeFile(
    `${outputDir}/tailwind.config.js`,
    tokensToTailwindConfig(tokens)
  );
  
  // 3. Generate React components
  for (const comp of components) {
    const code = await getComponentCode(fileKey, comp.nodeId);
    const fileName = toPascalCase(comp.name) + '.tsx';
    await fs.writeFile(`${outputDir}/components/${fileName}`, code);
  }
  
  // 4. Export icons as SVGs
  const icons = components.filter(c => c.name.startsWith('Icon/'));
  if (icons.length) {
    const iconIds = icons.map(i => i.nodeId).join(',');
    const svgResponse = await fetch(
      `https://api.figma.com/v1/images/${fileKey}?ids=${iconIds}&format=svg`,
      { headers: { 'X-Figma-Token': process.env.FIGMA_TOKEN! } }
    );
    const svgData = await svgResponse.json();
    
    for (const icon of icons) {
      const svgUrl = svgData.images[icon.nodeId];
      const svg = await fetch(svgUrl).then(r => r.text());
      await fs.writeFile(`${outputDir}/icons/${icon.name}.svg`, svg);
    }
  }
  
  console.log(`Generated ${components.length} components and ${Object.keys(tokens.colors).length} color tokens`);
}
```
