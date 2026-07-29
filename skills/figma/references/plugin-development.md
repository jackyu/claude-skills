# Figma Plugin Development

Scaffold for a Figma plugin: manifest, main thread code, and UI messaging.

## Plugin Manifest (manifest.json)
```json
{
  "name": "My Figma Plugin",
  "id": "123456789",
  "api": "1.0.0",
  "main": "code.js",
  "ui": "ui.html",
  "editorType": ["figma", "figjam"],
  "capabilities": ["codegen"],
  "codegenLanguages": [
    { "label": "React", "value": "react" },
    { "label": "Vue", "value": "vue" }
  ]
}
```

## Plugin Code (code.ts)
```typescript
// Show UI
figma.showUI(__html__, { width: 400, height: 500 });

// Handle selection
figma.on('selectionchange', () => {
  const selection = figma.currentPage.selection;
  figma.ui.postMessage({ type: 'selection', nodes: selection.map(nodeToJSON) });
});

// Handle messages from UI
figma.ui.onmessage = async (msg) => {
  if (msg.type === 'export-code') {
    const node = figma.currentPage.selection[0];
    const code = generateCode(node);
    figma.ui.postMessage({ type: 'code-generated', code });
  }
};

function nodeToJSON(node: SceneNode) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    width: node.width,
    height: node.height,
  };
}
```
