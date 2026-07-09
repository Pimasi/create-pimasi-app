# @pimasi/lib

Shared **types**, **schemas** (request/response via `@pimasi/utils` `Schema`), and **static values** used by both the server and web apps.

## What belongs here

- TypeScript types and interfaces
- API request/response schemas
- Static constants

## What does NOT belong here

- Business logic
- DB/Redis/queue runtime code
- React/UI code

## Imports

- `@pimasi/lib/schemas/api/<name>.schema`
- `@pimasi/lib/values/<name>`
