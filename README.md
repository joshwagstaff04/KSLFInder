# KSL Finder

## UI

Launch:

```bash
cd /Users/joshwagstaff/.openclaw/workspace/ksl-finder
zsh ./start.sh
```

Stop:

```bash
zsh ./stop.sh
```

## Watcher

Start background watcher:

```bash
zsh ./start-watcher.sh
```

Stop watcher:

```bash
zsh ./stop-watcher.sh
```

## Defaults

- poll every 180 seconds
- Telegram alerts for new listings with score >= 20
- max 3 alerts per cycle per saved search
- hard price cap filter: 10000
- blocked title terms: service, dealer, financing, call for quote, wanted

## Files

- `config.json` controls interval/thresholds/filtering
- `data/saved-searches.json` stores searches
- `data/seen-listings.json` tracks seen URLs
- `data/watch-state.json` tracks watcher state
- `/tmp/ksl-finder.log` UI logs
- `/tmp/ksl-watcher.log` watcher logs
