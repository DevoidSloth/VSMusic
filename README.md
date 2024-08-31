# YouTube Music for VS Code

This extension allows you to search and play YouTube music directly from within VS Code.

## Features

- Search for music on YouTube
- Play audio of selected videos
- Exclude YouTube Shorts from search results
- Stop currently playing audio

## Requirements

- [yt-dlp](https://github.com/yt-dlp/yt-dlp#installation) must be installed on your system
- [FFmpeg](https://ffmpeg.org/download.html) must be installed on your system (for the ffplay component)

## Extension Settings

This extension contributes the following settings:

* `youtubeMusic.ytdlpPath`: Path to the yt-dlp executable

## Usage

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette
2. Type "YouTube Music: Search and Play" and select the command
3. Enter your search query
4. Select a video from the results to play it
5. To stop playback, use the "YouTube Music: Stop Playback" command

## Known Issues

- The extension requires yt-dlp and FFmpeg to be installed separately.
- Audio playback is handled through the system's default audio output.

## Release Notes

### 0.0.4

- Improved search speed
- Added caching for recent searches
- Excluded YouTube Shorts from search results

### 0.0.3

- Added stop playback functionality

### 0.0.2

- Initial release of YouTube Music for VS Code

---

## For more information

* [yt-dlp GitHub repository](https://github.com/yt-dlp/yt-dlp)
* [FFmpeg official website](https://ffmpeg.org/)

**Enjoy!**