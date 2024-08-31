"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
let currentSearchProcess = null;
let ffplayProcess = null;
let currentQuery = '';
let resultCount = 0;
let isPaused = false;
let currentVolume = 1.0; // Default volume (100%)
// Add this near the top of the file with other global variables
let currentPlaybackTime = 0;
let playbackInterval = null;
let currentUrl = null;
let tempAudioFile = null;
let audioWriteStream = null;
let pausedPosition = 0;
// Add these global variables
let isPlaying = false;
let currentPlaylist = [];
let currentPlaylistIndex = -1;
let playlists = {};
let currentPlaylistName = null;
function activate(context) {
    console.log('YouTube Music Extension is now active!');
    findAndSetYtdlpPath();
    let searchDisposable = vscode.commands.registerCommand('extension.searchYouTubeMusic', () => __awaiter(this, void 0, void 0, function* () {
        const query = yield vscode.window.showInputBox({
            prompt: 'Enter a music search query'
        });
        if (query) {
            currentQuery = query;
            resultCount = 0;
            const quickPick = vscode.window.createQuickPick();
            quickPick.placeholder = 'Select a music video';
            quickPick.busy = true;
            quickPick.show();
            searchYouTube(query, quickPick);
            quickPick.onDidAccept(() => __awaiter(this, void 0, void 0, function* () {
                const selected = quickPick.selectedItems[0];
                if (selected && selected.url) {
                    quickPick.hide();
                    yield playAudio(selected.url);
                }
                else if (selected && selected.label === "Load More Results") {
                    searchYouTube(currentQuery, quickPick, true);
                }
            }));
        }
    }));
    let stopDisposable = vscode.commands.registerCommand('extension.stopYouTubeMusic', () => {
        stopAudio();
    });
    let pauseResumeDisposable = vscode.commands.registerCommand('extension.pauseResumeYouTubeMusic', () => {
        pauseResumeAudio();
    });
    let adjustVolumeDisposable = vscode.commands.registerCommand('extension.adjustYouTubeMusicVolume', () => {
        adjustVolume();
    });
    let addToPlaylistDisposable = vscode.commands.registerCommand('extension.addToYouTubeMusicPlaylist', addToPlaylist);
    let showPlaylistDisposable = vscode.commands.registerCommand('extension.showYouTubeMusicPlaylist', showPlaylist);
    let nextTrackDisposable = vscode.commands.registerCommand('extension.nextYouTubeMusicTrack', nextTrack);
    let previousTrackDisposable = vscode.commands.registerCommand('extension.previousYouTubeMusicTrack', previousTrack);
    let restartTrackDisposable = vscode.commands.registerCommand('extension.restartYouTubeMusicTrack', restartTrack);
    let createPlaylistDisposable = vscode.commands.registerCommand('extension.createYouTubeMusicPlaylist', createPlaylist);
    context.subscriptions.push(searchDisposable, stopDisposable, pauseResumeDisposable, adjustVolumeDisposable, addToPlaylistDisposable, showPlaylistDisposable, nextTrackDisposable, previousTrackDisposable, restartTrackDisposable, createPlaylistDisposable);
}
exports.activate = activate;
function findAndSetYtdlpPath() {
    return __awaiter(this, void 0, void 0, function* () {
        const config = vscode.workspace.getConfiguration('youtubeMusic');
        let ytdlpPath = config.get('ytdlpPath');
        if (!ytdlpPath || !fs.existsSync(ytdlpPath)) {
            ytdlpPath = yield findYtdlp();
            if (ytdlpPath) {
                yield config.update('ytdlpPath', ytdlpPath, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`yt-dlp found and path set to: ${ytdlpPath}`);
            }
            else {
                vscode.window.showErrorMessage('yt-dlp not found. Please install it and set the path manually in settings.');
            }
        }
    });
}
function findYtdlp() {
    return __awaiter(this, void 0, void 0, function* () {
        const isWindows = os.platform() === 'win32';
        const executable = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
        const searchPaths = [
            process.env.PATH,
            process.env.LOCALAPPDATA,
            process.env.APPDATA,
            process.env.HOME,
            '/usr/local/bin',
            '/usr/bin',
            'C:\\Program Files',
            'C:\\Program Files (x86)',
            'D:\\',
        ].filter(Boolean);
        for (const searchPath of searchPaths) {
            const fullPath = path.join(searchPath, executable);
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
        try {
            const { stdout } = yield execAsync(isWindows ? 'where yt-dlp' : 'which yt-dlp');
            return stdout.trim();
        }
        catch (error) {
            console.error('Error finding yt-dlp:', error);
        }
        return undefined;
    });
}
function getYtdlpPath() {
    const config = vscode.workspace.getConfiguration('youtubeMusic');
    const configuredPath = config.get('ytdlpPath');
    if (configuredPath && fs.existsSync(configuredPath)) {
        return configuredPath;
    }
    throw new Error('yt-dlp path not configured or invalid. Please set it in the extension settings.');
}
function searchYouTube(query, quickPick, getMore = false) {
    var _a, _b;
    if (currentSearchProcess) {
        currentSearchProcess.kill();
    }
    const ytdlpPath = getYtdlpPath();
    const startIndex = getMore ? resultCount + 1 : 1;
    const searchLimit = getMore ? 5 : 1;
    const command = `"${ytdlpPath}" "ytsearch${searchLimit}:${query}" -O "%(title)s\t%(id)s\t%(duration)s\t%(view_count)s" --no-playlist --match-filter "!is_shorts"`;
    currentSearchProcess = cp.spawn(command, [], { shell: true });
    let buffer = '';
    let errorBuffer = '';
    (_a = currentSearchProcess.stdout) === null || _a === void 0 ? void 0 : _a.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        const newItems = [];
        for (const line of lines) {
            const [title, id, duration, viewCount] = line.split('\t');
            if (title && id) {
                resultCount++;
                newItems.push({
                    label: title,
                    description: `${formatDuration(parseInt(duration) || 0)} | Views: ${formatViews(parseInt(viewCount) || 0)}`,
                    url: `https://www.youtube.com/watch?v=${id}`
                });
            }
        }
        if (getMore) {
            quickPick.items = [...quickPick.items.filter(item => item.label !== "Load More Results"), ...newItems, createMoreResultsItem()];
        }
        else {
            quickPick.items = [...newItems, createMoreResultsItem()];
        }
    });
    (_b = currentSearchProcess.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (data) => {
        errorBuffer += data.toString();
    });
    currentSearchProcess.on('close', (code) => {
        quickPick.busy = false;
        if (code !== 0) {
            console.error(`Search process exited with code ${code}`);
            console.error('Error output:', errorBuffer);
            vscode.window.showErrorMessage(`Search failed. Error: ${errorBuffer}`);
        }
    });
}
function createMoreResultsItem() {
    return {
        label: "Load More Results",
        description: "",
        url: ""
    };
}
function playAudio(url, startTime = 0) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        if (ffplayProcess) {
            ffplayProcess.kill();
            ffplayProcess = null;
        }
        console.log(`Playing audio from URL: ${url}, starting at ${startTime} seconds`);
        currentUrl = url;
        currentPlaybackTime = startTime;
        isPaused = false;
        isPlaying = true;
        const ytdlpPath = getYtdlpPath();
        console.log(`Using yt-dlp path: ${ytdlpPath}`);
        const ytdlpProcess = cp.spawn(ytdlpPath, ['-o', '-', '-f', 'bestaudio', url]);
        console.log('yt-dlp process spawned');
        ffplayProcess = cp.spawn('ffplay', [
            '-nodisp',
            '-autoexit',
            '-i', 'pipe:0',
            '-ss', startTime.toString(),
            '-volume', `${Math.round(currentVolume * 100)}`,
            '-loglevel', 'info',
            '-stats',
            '-vn',
            '-window_title', 'VSCode YouTube Music'
        ]);
        console.log('ffplay process spawned');
        if (ytdlpProcess.stdout && ffplayProcess.stdin) {
            ytdlpProcess.stdout.pipe(ffplayProcess.stdin);
            console.log('yt-dlp output piped to ffplay');
        }
        else {
            console.error('Failed to pipe yt-dlp output to ffplay');
        }
        (_a = ytdlpProcess.stderr) === null || _a === void 0 ? void 0 : _a.on('data', (data) => {
            console.error('yt-dlp error:', data.toString());
        });
        (_b = ffplayProcess.stderr) === null || _b === void 0 ? void 0 : _b.on('data', (data) => {
            console.log('ffplay output:', data.toString());
        });
        ffplayProcess.on('close', (code) => {
            console.log(`ffplay process exited with code ${code}`);
            isPlaying = false;
            if (!isPaused) {
                playNextTrack();
            }
        });
        vscode.window.showInformationMessage('Audio playback started');
    });
}
function playNextTrack() {
    if (currentPlaylist.length === 0) {
        return;
    }
    currentPlaylistIndex++;
    if (currentPlaylistIndex >= currentPlaylist.length) {
        currentPlaylistIndex = 0; // Loop back to the beginning
    }
    const nextTrack = currentPlaylist[currentPlaylistIndex];
    playAudio(nextTrack.url);
    vscode.window.showInformationMessage(`Now playing: ${nextTrack.label}`);
}
function pauseResumeAudio() {
    if (!currentUrl) {
        vscode.window.showInformationMessage('No audio is currently playing');
        return;
    }
    if (isPaused) {
        // Resume playback
        console.log('Resuming playback from:', pausedPosition);
        playAudio(currentUrl, pausedPosition);
        isPaused = false;
        vscode.window.showInformationMessage('Audio playback resumed');
    }
    else {
        // Pause playback
        if (ffplayProcess && isPlaying) {
            console.log('Pausing playback at:', currentPlaybackTime);
            ffplayProcess.kill('SIGSTOP');
            pausedPosition = currentPlaybackTime;
            isPaused = true;
            isPlaying = false;
            vscode.window.showInformationMessage('Audio playback paused');
        }
    }
}
function stopAudio() {
    if (ffplayProcess) {
        ffplayProcess.kill();
        ffplayProcess = null;
    }
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    currentUrl = null;
    currentPlaybackTime = 0;
    pausedPosition = 0;
    isPaused = false;
    isPlaying = false;
    currentPlaylistIndex = -1; // Reset playlist index when stopping
}
function adjustVolume() {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        const volumeInput = yield vscode.window.showInputBox({
            prompt: 'Enter volume (0-100)',
            validateInput: (value) => {
                const num = Number(value);
                return (num >= 0 && num <= 100) ? null : 'Please enter a number between 0 and 100';
            }
        });
        if (volumeInput) {
            currentVolume = Number(volumeInput) / 100;
            if (ffplayProcess) {
                stopAudio();
                if (ffplayProcess) {
                    (_a = ffplayProcess.stdin) === null || _a === void 0 ? void 0 : _a.write(`v ${Math.round(currentVolume * 100)}\n`);
                    vscode.window.showInformationMessage(`Volume set to ${Math.round(currentVolume * 100)}%`);
                }
            }
            else {
                vscode.window.showInformationMessage(`Volume will be set to ${Math.round(currentVolume * 100)}% for the next playback`);
            }
        }
    });
}
function formatDuration(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
function formatViews(views) {
    if (views >= 1000000) {
        return `${(views / 1000000).toFixed(1)}M`;
    }
    else if (views >= 1000) {
        return `${(views / 1000).toFixed(1)}K`;
    }
    else {
        return views.toString();
    }
}
function execAsync(command) {
    return new Promise((resolve, reject) => {
        cp.exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            }
            else {
                resolve({ stdout, stderr });
            }
        });
    });
}
function addToPlaylist() {
    return __awaiter(this, void 0, void 0, function* () {
        if (Object.keys(playlists).length === 0) {
            vscode.window.showInformationMessage('No playlists available. Create a playlist first.');
            return;
        }
        const playlistNames = Object.keys(playlists);
        const selectedPlaylist = yield vscode.window.showQuickPick(playlistNames, {
            placeHolder: 'Select a playlist to add to'
        });
        if (!selectedPlaylist) {
            return;
        }
        const query = yield vscode.window.showInputBox({
            prompt: `Enter a music search query to add to "${selectedPlaylist}"`
        });
        if (query) {
            const quickPick = vscode.window.createQuickPick();
            quickPick.placeholder = 'Select a music video to add to the playlist';
            quickPick.busy = true;
            quickPick.show();
            searchYouTube(query, quickPick);
            quickPick.onDidAccept(() => __awaiter(this, void 0, void 0, function* () {
                const selected = quickPick.selectedItems[0];
                if (selected && selected.url) {
                    playlists[selectedPlaylist].push(selected);
                    quickPick.hide();
                    vscode.window.showInformationMessage(`Added "${selected.label}" to the playlist "${selectedPlaylist}"`);
                }
            }));
        }
    });
}
function showPlaylist() {
    return __awaiter(this, void 0, void 0, function* () {
        if (Object.keys(playlists).length === 0) {
            vscode.window.showInformationMessage('No playlists available. Create a playlist first.');
            return;
        }
        const playlistNames = Object.keys(playlists);
        const selectedPlaylist = yield vscode.window.showQuickPick(playlistNames, {
            placeHolder: 'Select a playlist to view'
        });
        if (selectedPlaylist) {
            currentPlaylistName = selectedPlaylist;
            currentPlaylist = playlists[selectedPlaylist];
            currentPlaylistIndex = -1;
            if (currentPlaylist.length === 0) {
                vscode.window.showInformationMessage(`The playlist "${selectedPlaylist}" is empty`);
                return;
            }
            const quickPick = vscode.window.createQuickPick();
            quickPick.items = currentPlaylist;
            quickPick.placeholder = 'Select a track to play';
            quickPick.show();
            quickPick.onDidAccept(() => __awaiter(this, void 0, void 0, function* () {
                const selected = quickPick.selectedItems[0];
                if (selected && selected.url) {
                    currentPlaylistIndex = currentPlaylist.findIndex(item => item.url === selected.url);
                    quickPick.hide();
                    yield playAudio(selected.url);
                }
            }));
        }
    });
}
function nextTrack() {
    return __awaiter(this, void 0, void 0, function* () {
        if (currentPlaylist.length === 0) {
            vscode.window.showInformationMessage('No playlist is currently active');
            return;
        }
        playNextTrack();
    });
}
function previousTrack() {
    return __awaiter(this, void 0, void 0, function* () {
        if (currentPlaylist.length === 0) {
            vscode.window.showInformationMessage('No playlist is currently active');
            return;
        }
        currentPlaylistIndex--;
        if (currentPlaylistIndex < 0) {
            currentPlaylistIndex = currentPlaylist.length - 1; // Loop to the end
        }
        const prevTrack = currentPlaylist[currentPlaylistIndex];
        yield playAudio(prevTrack.url);
        vscode.window.showInformationMessage(`Now playing: ${prevTrack.label}`);
    });
}
function restartTrack() {
    return __awaiter(this, void 0, void 0, function* () {
        if (currentUrl) {
            yield playAudio(currentUrl, 0);
            vscode.window.showInformationMessage('Restarting current track');
        }
        else {
            vscode.window.showInformationMessage('No track is currently playing');
        }
    });
}
function createPlaylist() {
    return __awaiter(this, void 0, void 0, function* () {
        const playlistName = yield vscode.window.showInputBox({
            prompt: 'Enter a name for the new playlist'
        });
        if (playlistName) {
            if (playlists[playlistName]) {
                vscode.window.showErrorMessage(`A playlist named "${playlistName}" already exists.`);
            }
            else {
                playlists[playlistName] = [];
                currentPlaylistName = playlistName;
                currentPlaylist = playlists[playlistName];
                currentPlaylistIndex = -1;
                vscode.window.showInformationMessage(`Playlist "${playlistName}" created and set as current playlist.`);
            }
        }
    });
}
function deactivate() {
    stopAudio();
    if (currentSearchProcess) {
        currentSearchProcess.kill();
    }
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map