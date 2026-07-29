# Dev Mode & Webhooks

Dev Mode resource endpoints and Figma webhook setup/handling for design-to-code automation.

## Dev Mode Integration

### Code Snippets from Dev Mode
```typescript
// Get Dev Resources (annotations, measurements)
GET https://api.figma.com/v1/files/:file_key/dev_resources

// Create Dev Resource
POST https://api.figma.com/v1/dev_resources
{
  "dev_resource": {
    "name": "React Component",
    "url": "https://github.com/...",
    "file_key": "abc123",
    "node_id": "1:2"
  }
}
```

## Webhooks

### Setup Webhook
```typescript
POST https://api.figma.com/v2/webhooks

{
  "event_type": "FILE_UPDATE",
  "team_id": "123456",
  "endpoint": "https://your-server.com/figma-webhook",
  "passcode": "your-secret-passcode"
}

// Available events:
// - FILE_UPDATE
// - FILE_DELETE  
// - FILE_VERSION_UPDATE
// - LIBRARY_PUBLISH
// - FILE_COMMENT
```

### Handle Webhook
```typescript
app.post('/figma-webhook', async (req, res) => {
  const { passcode } = req.body;
  
  if (passcode !== process.env.FIGMA_WEBHOOK_SECRET) {
    return res.status(401).send('Unauthorized');
  }
  
  const { event_type, file_key, timestamp } = req.body;
  
  switch (event_type) {
    case 'FILE_UPDATE':
      await syncDesignTokens(file_key);
      break;
    case 'LIBRARY_PUBLISH':
      await regenerateComponents(file_key);
      break;
    case 'FILE_COMMENT':
      await notifyTeam(req.body);
      break;
  }
  
  res.status(200).send('OK');
});
```
