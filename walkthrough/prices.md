# Prices

Costs are token counts times a price table in US dollars per million tokens. The built-in table was taken on 2026-11-06. Add a row in the `aiUsageMeter.prices` setting to change a price or to price a new model.

```json
"aiUsageMeter.prices": {
  "claude-opus-5-5": { "input": 4, "output": 20, "cacheWrite": 5, "cacheRead": 0.2 },
  "gpt-6.1-sol": { "input": 2, "output": 10, "cacheRead": 0.1 }
}
```

A row matches the model id itself or any id that starts with it, so `claude-opus-4-5` also prices `claude-opus-4-5-20251101`. On a Pro, Max or ChatGPT plan you aren't billed per token, so read the number as what the same work would cost on the API.
