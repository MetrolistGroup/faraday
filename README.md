# Faraday

Faraday watches YouTube `player.js` rotations, derives cipher configs (`sig`,
`nClass`, `sts`, `aliases`), validates them against real CDN streams, and
updates the registry automatically.

Validation requires two distinct test-video ciphers. The probe tries an ordered
pool of four videos and skips videos that remain unavailable after retries. Set
`VALIDATION_VIDEO_IDS` to override the pool with at least two distinct video
IDs. Both selected streams must pass the strict HTTP 206 audio range checks
before a config can be published. Failed player requests retry once after a
one-second pause, with at least 15 seconds for the retry.

## Used by

- Metrolist KMP (WIP)
- Metrolist
- InnerTubeX and all projects using it

## Acknowledgments

- [zemer-cipher](https://github.com/ZemerTeam/zemer-cipher) - config schema and
  parser rules
- [zemer-app](https://github.com/ZemerTeam/zemer-app) - deriver and HTTP 206
  validator patterns
