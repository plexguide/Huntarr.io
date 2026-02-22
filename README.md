<h1 align="center">Huntarr</h1>

<p align="center">
  <img src="frontend/static/logo/128.png" alt="Huntarr Logo" width="100" height="100">
</p>

<p align="center">
  A media automation platform that goes beyond the *arr ecosystem. Huntarr hunts for missing content and quality upgrades across your existing Sonarr, Radarr, Lidarr, Readarr, and Whisparr instances — while also providing its own built-in Movie Hunt, TV Hunt, Index Master, NZB Hunt, and Requestarr modules that can replace or complement your existing stack.
</p>

<p align="center">
  <a href="https://hub.docker.com/r/huntarr/huntarr"><img src="https://img.shields.io/docker/pulls/huntarr/huntarr?style=flat-square&label=Docker%20Pulls" alt="Docker Pulls"></a>
  <a href="https://github.com/plexguide/Huntarr.io/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="License"></a>
  <a href="https://discord.com/invite/PGJJjR5Cww"><img src="https://img.shields.io/discord/1370922258247454821?color=7289DA&label=Discord&style=flat-square&logo=discord" alt="Discord"></a>
</p>

<p align="center">
  <a href="https://github.com/plexguide/Huntarr.io/stargazers"><img src="https://img.shields.io/github/stars/plexguide/Huntarr.io?style=social&label=Star%20Huntarr" alt="GitHub Stars"></a>
</p>

<h2 align="center">Stars help others discover Huntarr — if you find it useful, click the ⭐ in the upper-right corner!</h2>

## PayPal Donations — Building My Daughter's Future

My 12-year-old daughter loves singing, dancing, and exploring STEM. She's an A-B honor roll student with big dreams for the future. Any donation you make will go directly toward her college fund, helping her turn those dreams into reality. Thank you for your support!

[![Donate with PayPal](https://www.paypalobjects.com/en_US/i/btn/btn_donate_LG.gif)](https://www.paypal.com/donate?hosted_button_id=58AYJ68VVMGSC)

---

> **🚀 PlexGuide is back.** Rebuilt from the ground up for 2026 — a self-hosted server management platform running as a single Docker container. App store, Cloudflare Tunnels, Traefik, MergerFS drive pooling, backups, and more. One-line install on Ubuntu & Debian.
> 
> [![PlexGuide on GitHub](https://img.shields.io/github/stars/plexguide/PlexGuide.com?style=social&label=PlexGuide)](https://github.com/plexguide/PlexGuide.com)

---

<p align="center">
  <img src="docs/readme/Main.jpg" alt="Huntarr Dashboard" width="800">
</p>

---

## Table of Contents

- [What Huntarr Does](#what-huntarr-does)
- [Third-Party *arr Support](#third-party-arr-support)
- [Movie Hunt & TV Hunt](#movie-hunt--tv-hunt)
- [Index Master](#index-master)
- [NZB Hunt](#nzb-hunt)
- [Requestarr](#requestarr)
- [Add to Library](#add-to-library)
- [How It Works](#how-it-works)
- [Installation](#installation)
- [The Classic](#the-classic)
- [Other Projects](#other-projects)
- [Huntarr + Cleanuparr](#huntarr--cleanuparr)
- [Contributors](#contributors)
- [Change Log](#change-log)
- [License](#license)

---

## What Huntarr Does

Your *arr apps monitor RSS feeds for new releases, but they don't go back and search for missing episodes or movies already sitting in your library. Over time, gaps build up — missing seasons, unavailable albums, content stuck below your quality cutoff. Nobody goes back to fix it.

Huntarr does. It systematically scans your entire library, finds all missing content, and searches for it in small batches that won't overwhelm your indexers or get you banned. It also finds content below your quality cutoff and triggers upgrades automatically.

But Huntarr has grown well beyond a missing content hunter. It now includes its own built-in modules that can replace parts of your stack entirely:

| Module | What It Does |
|--------|-------------|
| **Movie Hunt** | A built-in movie management system — browse, discover, and track movies without needing Radarr |
| **TV Hunt** | A built-in TV show management system — track series, seasons, and episodes without needing Sonarr |
| **Index Master** | Manage and search your indexers directly from Huntarr — a Prowlarr alternative built right in |
| **NZB Hunt** | A full Usenet download client — connect your NNTP servers and download NZBs without a separate app |
| **Requestarr** | Let users request movies and TV shows through an approval queue you control |

The key thing: third-party *arr support is always front and center. You can use Huntarr's built-in modules, your existing *arr apps, or both at the same time. Nothing is forced — you pick what works for your setup.

---

## Third-Party *arr Support

Huntarr connects to your existing *arr stack and works alongside it. Configure multiple instances of each app and Huntarr will hunt across all of them.

| Sonarr | Radarr | Lidarr | Readarr | Whisparr v2 | Whisparr v3 |
|:------:|:------:|:------:|:-------:|:-----------:|:-----------:|
| ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

<p align="center">
  <img src="docs/readme/ThirdParty.jpg" alt="Third-Party App Connections" width="800">
</p>

---

## Movie Hunt & TV Hunt

Browse, discover, and manage your media collection with a visual interface. Movie Hunt and TV Hunt are built-in alternatives to Radarr and Sonarr — see what's in your library, what's missing, and what needs upgrading, all in one place.

Use them standalone or alongside your existing *arr apps. They share the same indexer and download client configuration through Index Master and NZB Hunt.

<p align="center">
  <img src="docs/readme/MediaHunt.jpg" alt="Movie Hunt & TV Hunt" width="800">
</p>

---

## Index Master

Manage your indexers directly inside Huntarr. Add Usenet and torrent indexers, test connections, and search across all of them — no need for a separate Prowlarr instance. Index Master feeds into both the built-in Movie Hunt / TV Hunt modules and the third-party *arr hunting engine.

---

## NZB Hunt

A full Usenet download client built into Huntarr. Connect your NNTP servers and download NZBs directly — no SABnzbd or NZBGet required. Supports multiple server connections with up to 120 threads, speed limiting, and a download queue you can manage from the web UI.

<p align="center">
  <img src="docs/readme/NZBHunt.jpg" alt="NZB Hunt" width="800">
</p>

---

## Requestarr

Let users request movies and TV shows through a clean request interface. Requests flow through an approval queue so you stay in control of what gets added to your library. Works with both the built-in Movie Hunt / TV Hunt and your external *arr instances.

<p align="center">
  <img src="docs/readme/Requests.jpg" alt="Requestarr" width="800">
</p>

---

## Add to Library

Quickly add new movies and TV shows. Search by title, pick your quality profile, and send it straight to your library — whether that's through Movie Hunt, TV Hunt, Sonarr, or Radarr.

<p align="center">
  <img src="docs/readme/AddToLibrary.jpg" alt="Add to Library" width="800">
</p>

---

## How It Works

1. **Connect** — Point Huntarr at your Sonarr, Radarr, Lidarr, Readarr, or Whisparr instances (or use the built-in modules)
2. **Hunt Missing** — Scans your library for missing content and searches in small, indexer-friendly batches
3. **Hunt Upgrades** — Finds content below your quality cutoff and triggers upgrade searches
4. **API Management** — Hourly caps prevent indexer overload; pauses when download queues are full
5. **Repeat** — Waits for your configured interval, then runs again. Hands-off, continuous improvement

---

## Installation

### Docker (Recommended)

```bash
docker run -d \
  --name huntarr \
  --restart unless-stopped \
  -p 9705:9705 \
  -v /path/to/config:/config \
  -v /path/to/media:/media       # Optional — for Movie Hunt / TV Hunt library access
  -v /path/to/downloads:/downloads # Optional — for NZB Hunt download output
  -e TZ=America/New_York \
  -e PUID=1000 \                  # Optional — run as specific user ID
  -e PGID=1000 \                  # Optional — run as specific group ID
  huntarr/huntarr:latest
```

### Docker Compose

```yaml
services:
  huntarr:
    image: huntarr/huntarr:latest
    container_name: huntarr
    restart: unless-stopped
    ports:
      - "9705:9705"
    volumes:
      - /path/to/config:/config
      - /path/to/media:/media           # Optional — for Movie Hunt / TV Hunt library access
      - /path/to/downloads:/downloads   # Optional — for NZB Hunt download output
    environment:
      - TZ=America/New_York
      - PUID=1000    # Optional — run as specific user ID (default: 0 = root)
      - PGID=1000    # Optional — run as specific group ID (default: 0 = root)
```

### Volume & Environment Reference

| Path / Variable | Required | Purpose |
|----------------|----------|---------|
| `/config` | Yes | Persistent config, database, and settings |
| `/media` | No | Media library root for Movie Hunt / TV Hunt |
| `/downloads` | No | NZB Hunt download output directory |
| `TZ` | No | Timezone (e.g. `America/New_York`, default: `UTC`) |
| `PUID` | No | User ID to run as (default: `0` = root). Unraid: `99`, Linux: `1000` |
| `PGID` | No | Group ID to run as (default: `0` = root). Unraid: `100`, Linux: `1000` |

### More Installation Methods

- [Unraid Installation](https://plexguide.github.io/Huntarr.io/getting-started/installation.html#unraid-installation)
- [Windows Installation](https://plexguide.github.io/Huntarr.io/getting-started/installation.html#windows-installation)
- [macOS Installation](https://plexguide.github.io/Huntarr.io/getting-started/installation.html#macos-installation)
- [Linux Installation](https://plexguide.github.io/Huntarr.io/getting-started/installation.html#linux-installation)

Once running, open your browser to `http://<your-server-ip>:9705`.

For full documentation, visit the [Huntarr Wiki](https://plexguide.github.io/Huntarr.io/).

---

## The Classic

For those who remember where it all started.

<p align="center">
  <img src="docs/readme/OldSchool.png" alt="The Original" width="800">
</p>

---

## Other Projects

- [PlexGuide](https://github.com/plexguide/PlexGuide.com) — Self-hosted server management platform with Docker app store, reverse proxies, and MergerFS
- [Seekandwatch](https://github.com/softerfish/seekandwatch) — A streamlined media discovery and watchlist tool for finding and tracking content across your media stack
- [Unraid Intel ARC Deployment](https://github.com/plexguide/Unraid_Intel-ARC_Deployment) — Convert videos to AV1 format

---

## Huntarr + Cleanuparr

<p align="center">
  <img src="frontend/static/logo/128.png" alt="Huntarr" width="64" height="64">
  &nbsp;&nbsp;&nbsp;&nbsp;
  <img src="https://github.com/cleanuparr/cleanuparr/blob/main/Logo/128.png?raw=true" alt="Cleanuparr" width="64" height="64">
</p>

Huntarr fills your library. [Cleanuparr](https://github.com/cleanuparr/cleanuparr) protects it.

While Huntarr is out hunting for missing content and upgrading quality, Cleanuparr watches your download queue like a hawk — removing stalled downloads, blocking malicious files, and cleaning up the clutter that builds up over time. One brings content in, the other makes sure only clean downloads get through.

Together they form a self-sustaining media automation loop: Huntarr searches, Cleanuparr filters, and your library grows with zero manual intervention.

[![Cleanuparr on GitHub](https://img.shields.io/github/stars/cleanuparr/cleanuparr?style=flat-square&label=Cleanuparr&logo=github)](https://github.com/cleanuparr/cleanuparr)

---

## Contributors

<a href="https://github.com/plexguide/Huntarr.io/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=plexguide/Huntarr.io" alt="Contributors" />
</a>

## Change Log

Visit the [Releases](https://github.com/plexguide/Huntarr.io/releases/) page.

## License

Licensed under the [GNU General Public License v3.0](https://github.com/plexguide/Huntarr.io/blob/main/LICENSE).
