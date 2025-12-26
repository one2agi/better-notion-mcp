# Users Tool - Full Documentation

## Overview
User info: list, get, me, from_workspace.

## Important
- `list` may fail without user:read permission
- Use `from_workspace` as fallback (extracts from page metadata)

## Actions

### me
```json
{"action": "me"}
```
Returns bot/integration info.

### list
```json
{"action": "list"}
```
Requires user:read permission.

### get
```json
{"action": "get", "user_id": "xxx"}
```

### from_workspace
```json
{"action": "from_workspace"}
```
Extracts users from created_by/last_edited_by in accessible pages.

## Parameters
- `user_id` - User ID (for get action)
