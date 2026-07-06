const youtubeUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export function youtubeWatchHeaders(): HeadersInit {
  return {
    "User-Agent": youtubeUserAgent,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

export function youtubePlayerHeaders(): HeadersInit {
  return {
    "User-Agent": youtubeUserAgent,
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.youtube.com/",
  };
}
