---
name: ReviewFlow request identity
description: Non-obvious behavior around the demo cookie and project lookup in the API request lifecycle.
---

The API middleware must write a newly generated demo identity into the current request before downstream handlers call the project lookup again.

**Why:** The response cookie is not available in `req.signedCookies` during the same request. Without a request-local update, middleware and the route handler create different demo projects, causing first-request writes to target a project the following route cannot see.

**How to apply:** Preserve request-local demo identity when changing project bootstrap, cookie middleware, or route-level project lookup.